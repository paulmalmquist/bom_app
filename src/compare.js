import { createHash } from 'node:crypto';
import { fingerprint, header, validateSnapshot } from './model.js';

const index = s => {
  const nodes = new Map(s.nodes.map(n => [n.id, n]));
  const paths = new Map(), idPaths = new Map(), depths = new Map();
  for (const n of s.nodes) {
    const lineage = []; let p = n;
    while (p) { lineage.unshift(p); p = nodes.get(p.parentId); }
    paths.set(n.id, lineage.map(p => `${p.name} [${p.partNumber}]`).join(' / '));
    idPaths.set(n.id, lineage.map(p => p.id));
    depths.set(n.id, lineage.length - 1);
  }
  return { nodes, paths, idPaths, depths, root: s.nodes.find(n => n.parentId === null) };
};
const groups = (nodes, key) => {
  const map = new Map();
  for (const n of nodes) { const k = key(n); if (k == null) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(n); }
  return map;
};
const sorted = a => [...a].sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const recordKey = r => JSON.stringify([r.source,r.id]);
// Content signature of an occurrence and its whole subtree, excluding snapshot-local ids and keys.
// Occurrences with equal signatures are interchangeable: any pairing between them yields identical rows.
const signatures = s => {
  const children = groups(s.nodes, n => n.parentId), memo = new Map();
  const canonicalRecords = rs => sorted(rs.map(r => JSON.stringify(Object.keys(r).sort().map(k => [k, r[k]]))));
  const sig = n => {
    if (!memo.has(n.id)) {
      const kids = sorted((children.get(n.id) || []).map(sig));
      memo.set(n.id, createHash('sha256').update(JSON.stringify([n.partNumber,n.revision,n.quantity,n.unit,sorted(n.refDes),n.name,canonicalRecords(n.records),kids])).digest('hex'));
    }
    return memo.get(n.id);
  };
  for (const n of s.nodes) sig(n);
  return memo;
};

export function compareSnapshots(leftInput, rightInput, { quantityTolerance = 1e-9 } = {}) {
  if (!Number.isFinite(quantityTolerance) || quantityTolerance < 0 || quantityTolerance > 1) throw new Error('Invalid quantityTolerance');
  const left = validateSnapshot(leftInput), right = validateSnapshot(rightInput);
  const li = index(left), ri = index(right), pairs = new Map(), reverse = new Map(), methods = new Map();
  const pair = (a,b,method) => { pairs.set(a.id,b.id); reverse.set(b.id,a.id); methods.set(a.id,method); };
  // Canonical keys are authoritative and take precedence over root alignment: A may be a subassembly inside B.
  const rk = new Map(right.nodes.filter(n=>n.occurrenceKey).map(n=>[n.occurrenceKey,n]));
  for (const a of left.nodes) {
    const b = rk.get(a.occurrenceKey);
    if (b && !pairs.has(a.id) && !reverse.has(b.id)) pair(a,b,'Canonical occurrence');
  }
  // Roots are alignment anchors, not assertions that the two products are identical.
  if (!pairs.has(li.root.id) && !reverse.has(ri.root.id)) pair(li.root, ri.root, 'Root alignment');
  // Conservative fallback only inside already aligned parents. Never globally match by PN.
  const sigL = signatures(left), sigR = signatures(right);
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of ['reference','part','identical']) {
      // JSON identity avoids delimiter collisions between ["R1","R2"] and a single "R1|R2" value.
      const identity = n => field === 'reference' ? (n.refDes.length ? JSON.stringify(sorted(n.refDes)) : null) : n.partNumber;
      const keyLeft = n => {
        if (n.parentId === null || !pairs.has(n.parentId)) return null;
        const id = identity(n);
        return id ? JSON.stringify([pairs.get(n.parentId),id]) : null;
      };
      const keyRight = n => {
        if (n.parentId === null || !reverse.has(n.parentId)) return null;
        const id = identity(n);
        return id ? JSON.stringify([n.parentId,id]) : null;
      };
      const ag = groups(left.nodes.filter(n=>!pairs.has(n.id)),keyLeft);
      const bg = groups(right.nodes.filter(n=>!reverse.has(n.id)),keyRight);
      for (const [key, aa] of ag) {
        const bb = bg.get(key);
        if (!bb) continue;
        if (field === 'identical') {
          // Repeated same-PN occurrences under one aligned parent pair only when the whole group is the same
          // multiset of content on both sides. Partial overlaps stay unresolved: no residual becomes "unique".
          if (aa.length === 1 && bb.length === 1) continue;
          if (aa.length !== bb.length || aa.some(n=>n.occurrenceKey) && bb.some(n=>n.occurrenceKey)) continue;
          const order = (sig, nodes) => [...nodes].sort((x,y)=>sig.get(x.id).localeCompare(sig.get(y.id))||(x.id<y.id?-1:x.id>y.id?1:0));
          const oa = order(sigL,aa), ob = order(sigR,bb);
          if (!oa.every((x,i)=>sigL.get(x.id)===sigR.get(ob[i].id))) continue;
          oa.forEach((x,i)=>pair(x,ob[i],'Identical content + aligned parent')); changed = true;
          continue;
        }
        if (aa.length === 1 && bb.length === 1) {
          // Conflicting authoritative mappings must never be overridden by a heuristic.
          if (aa[0].occurrenceKey && bb[0].occurrenceKey && aa[0].occurrenceKey !== bb[0].occurrenceKey) continue;
          pair(aa[0],bb[0],field === 'reference' ? 'Reference + aligned parent' : 'Part + aligned parent'); changed = true;
        }
      }
    }
  }
  // A designator-based pairing that changes PN is contested when a same-PN candidate exists under the same
  // aligned parent (e.g. two parts swapped designators). Report it as unresolved instead of a confident replacement.
  const childrenL = groups(left.nodes, n => n.parentId), childrenR = groups(right.nodes, n => n.parentId);
  const contested = new Set();
  for (const a of left.nodes) {
    if (methods.get(a.id) !== 'Reference + aligned parent') continue;
    const b = ri.nodes.get(pairs.get(a.id));
    if (a.partNumber === b.partNumber) continue;
    // A sibling competes only if it is not already matched to an occurrence of its own part number.
    const competesR = y => y.id!==b.id && y.partNumber===a.partNumber && li.nodes.get(reverse.get(y.id))?.partNumber!==y.partNumber;
    const competesL = x => x.id!==a.id && x.partNumber===b.partNumber && ri.nodes.get(pairs.get(x.id))?.partNumber!==x.partNumber;
    if ((childrenR.get(b.parentId)||[]).some(competesR) || (childrenL.get(a.parentId)||[]).some(competesL)) contested.add(a.id);
  }
  // Canonical keys are never overridden, but a key that now names a different part while an unmatched occurrence of
  // the original part sits in the original location is the signature of a reused or unstable key. Flag it for review.
  const suspectKeys = new Set();
  for (const a of left.nodes) {
    if (methods.get(a.id) !== 'Canonical occurrence' || a.parentId === null) continue;
    const b = ri.nodes.get(pairs.get(a.id));
    if (b.parentId === null || a.partNumber === b.partNumber) continue;
    const stayedR = (childrenR.get(pairs.get(a.parentId))||[]).some(y=>!reverse.has(y.id) && y.partNumber===a.partNumber);
    const stayedL = (childrenL.get(reverse.get(b.parentId))||[]).some(x=>!pairs.has(x.id) && x.partNumber===b.partNumber);
    if (stayedR || stayedL) suspectKeys.add(a.id);
  }
  const unmatchedL = left.nodes.filter(n=>!pairs.has(n.id));
  const unmatchedR = right.nodes.filter(n=>!reverse.has(n.id));
  const unresolvedIndex = ns => ({parts:new Set(ns.map(n=>n.partNumber)),refs:new Set(ns.flatMap(n=>n.refDes))});
  const unmatchedIndexL=unresolvedIndex(unmatchedL),unmatchedIndexR=unresolvedIndex(unmatchedR);
  const ambiguity = (n,side) => {
    const opposite = side === 'left' ? unmatchedIndexR : unmatchedIndexL;
    return opposite.parts.has(n.partNumber) || n.refDes.some(r=>opposite.refs.has(r));
  };
  const rows = [];
  function add(a,b) {
    const changes = [];
    if (!a) changes.push('Added');
    else if (!b) changes.push('Removed');
    else {
      if (a.partNumber !== b.partNumber) changes.push('Replaced');
      if (a.revision !== b.revision) changes.push('Revision');
      if (Math.abs(a.quantity - b.quantity) > quantityTolerance) changes.push('Quantity');
      if (a.unit !== b.unit) changes.push('Unit');
      if (!same(sorted(a.refDes),sorted(b.refDes))) changes.push('Reference');
      // A root mapped to a non-root occurrence is a scope difference (reported as a warning), not a move.
      if (a.parentId !== null && b.parentId !== null && pairs.get(a.parentId) !== b.parentId) changes.push('Moved');
      if (a.name !== b.name) changes.push('Description');
    }
    const evidence = explainEvidence(a,b,changes);
    const isContested = !!a && contested.has(a.id), isSuspectKey = !!a && suspectKeys.has(a.id);
    const uncertain = (!a && ambiguity(b,'right')) || (!b && ambiguity(a,'left')) || isContested || isSuspectKey;
    const pathA = a ? li.paths.get(a.id) : null, pathB = b ? ri.paths.get(b.id) : null;
    const aTop = a ? li.idPaths.get(a.id)[1] : null, bTop = b ? ri.idPaths.get(b.id)[1] : null;
    rows.push({
      id:`row-${rows.length+1}`, left:a??null, right:b??null,
      pathA, pathB, ancestorsA:a?li.idPaths.get(a.id):[], ancestorsB:b?ri.idPaths.get(b.id):[],
      depth:a?li.depths.get(a.id):ri.depths.get(b.id),
      assemblyA:aTop?li.nodes.get(aTop).name:'Assembly root', assemblyB:bTop?ri.nodes.get(bTop).name:'Assembly root',
      changes, status:changes.length?changes[0]:'Unchanged', uncertain,
      ...(isContested?{correspondence:'Reference designator and part number indicate different correspondences. Review before treating this as a replacement.'}:{}),
      ...(isSuspectKey?{correspondence:'The canonical key now names a different part while an unmatched occurrence of the original part remains in the original location. The key may have been reused; verify source lineage.'}:{}),
      matchMethod:a&&b?methods.get(a.id):uncertain?'Unresolved correspondence':'No matched occurrence',
      evidence:evidence.items, explanation:evidence.explanation, explained:evidence.explanation.status==='Explained',
    });
  }
  // "Explained" requires every change type on the row to be declared by a qualifying explanatory record.
  // Related records, unscoped links, records unchanged on both snapshots, and records for another serial do not count.
  const serials = new Set([left.serialNumber,right.serialNumber].filter(Boolean));
  const excludedSerialRecords = new Set();
  function explainEvidence(a,b,changes) {
    const ra = a?.records||[], rb = b?.records||[];
    const state = new Map(ra.map(r=>[recordKey(r),r.status]));
    const common = new Set(a && b ? rb.filter(r=>state.get(recordKey(r))===r.status).map(recordKey) : []);
    const items = [...ra.map(r=>({...r,side:'A'})),...rb.map(r=>({...r,side:'B'}))].map(r=>{
      let excludedReason;
      if (r.relationship==='explains' && common.has(recordKey(r))) excludedReason = 'Present unchanged on both snapshots: pre-existing context, not an explanation of this difference';
      else if (r.relationship==='explains' && r.serialNumber!=null && !serials.has(r.serialNumber)) { excludedReason = `Scoped to serial ${r.serialNumber}, which is not part of this comparison`; excludedSerialRecords.add(recordKey(r)); }
      return excludedReason ? {...r,excludedReason} : r;
    });
    const qualifying = items.filter(r=>r.relationship==='explains' && !r.excludedReason);
    const covered = new Set(qualifying.flatMap(r=>r.changes||[]).filter(c=>changes.includes(c)));
    const unexplained = changes.filter(c=>!covered.has(c));
    const status = !changes.length ? 'Not applicable'
      : !unexplained.length ? 'Explained'
      : covered.size ? 'Partially explained'
      : qualifying.length ? 'Linked, scope not declared'
      : items.length ? 'Related records only' : 'No linked record';
    return { items, explanation:{ status, unexplained, records:qualifying.filter(r=>(r.changes||[]).some(c=>covered.has(c))).map(r=>r.id) } };
  }
  for (const a of left.nodes) add(a,ri.nodes.get(pairs.get(a.id)));
  for (const b of unmatchedR) add(null,b);
  const assignments = (s,idx) => {
    const g = new Map();
    for (const n of s.nodes) for (const ref of n.refDes) {
      if (!g.has(ref)) g.set(ref,[]);
      g.get(ref).push({partNumber:n.partNumber,revision:n.revision,path:idx.paths.get(n.id),occurrenceId:n.id});
    }
    return g;
  };
  const al = assignments(left,li), ar = assignments(right,ri);
  const refRows = sorted(new Set([...al.keys(),...ar.keys()])).map(ref=>{
    const a=al.get(ref)||[], b=ar.get(ref)||[];
    const content = v => v.map(x=>`${x.partNumber}@${x.revision}`).sort();
    const assignmentsAligned = a.length === b.length && a.every(x=>b.some(y=>pairs.get(x.occurrenceId)===y.occurrenceId));
    // A revision bump on the same mapped occurrence is not a reassignment of the designator.
    const parts = v => v.map(x=>x.partNumber).sort();
    return {ref,left:a,right:b,status:!a.length?'Added':!b.length?'Removed':!same(content(a),content(b))?(assignmentsAligned&&same(parts(a),parts(b))?'Revised':'Reassigned'):!assignmentsAligned?'Relocated':'Unchanged',duplicate:a.length>1||b.length>1};
  });
  const warnings=[];
  if(left.synthetic||right.synthetic) warnings.push('Synthetic demonstration data. No production source is connected.');
  if(left.releaseStatus==='Unreleased'||right.releaseStatus==='Unreleased') warnings.push('This comparison includes an unreleased snapshot. It is not an approved baseline.');
  if(left.type!==right.type) warnings.push('Different BOM views can intentionally use different structures. Unmapped occurrences remain additions/removals; review their correspondence.');
  if(left.partNumber!==right.partNumber) warnings.push('Root part numbers differ. Confirm these products are comparable.');
  if(left.configuration!==right.configuration) warnings.push('Configuration contexts differ. Confirm revision rule and effectivity before drawing conclusions.');
  if(left.serialNumber && right.serialNumber && left.serialNumber!==right.serialNumber) warnings.push('You are comparing different serialized units.');
  if(pairs.get(li.root.id)!==ri.root.id) warnings.push('Comparison scopes differ: a root occurrence maps to a non-root occurrence on the other side by canonical key. Structure outside the shared scope appears as added or removed.');
  else if(li.root.occurrenceKey && ri.root.occurrenceKey && li.root.occurrenceKey!==ri.root.occurrenceKey) warnings.push('Root occurrence keys differ. The roots are aligned only as comparison anchors.');
  if(excludedSerialRecords.size) warnings.push(`${excludedSerialRecords.size} explanatory record(s) are scoped to a serial outside this comparison and were not counted as explanations.`);
  if(rows.some(r=>r.changes.length && ['Partially explained','Linked, scope not declared'].includes(r.explanation.status))) warnings.push('Some explanatory links do not declare every changed field. Those occurrences are not counted as explained and remain in the review queue.');
  if(rows.some(r=>r.uncertain)) warnings.push('Some occurrence correspondence is unresolved. Supply canonical mappings to distinguish replacements, moves, and repeated parts.');
  if(rows.some(r=>r.changes.includes('Unit'))) warnings.push('Units differ on some lines. Quantities have not been converted and must not be interpreted as equivalent.');
  if(refRows.some(r=>r.duplicate)) warnings.push('Reference designators have multiple occurrences. Their complete assignment sets are shown; uniqueness depends on source scope.');
  const modified=rows.filter(r=>r.changes.length);
  return {
    schemaVersion:1,engineVersion:'1.1.0', comparedAt:new Date().toISOString(),
    left:{...header(left),fingerprint:fingerprint(left)}, right:{...header(right),fingerprint:fingerprint(right)},
    options:{quantityTolerance,quantityBasis:'Local occurrence quantity; no unit conversion or exploded totals'},
    summary:{total:rows.length,changed:modified.length,unchanged:rows.length-modified.length,added:rows.filter(r=>r.status==='Added').length,removed:rows.filter(r=>r.status==='Removed').length,explained:modified.filter(r=>r.explained).length,partiallyExplained:modified.filter(r=>r.explanation.status==='Partially explained').length,linkedUnscoped:modified.filter(r=>r.explanation.status==='Linked, scope not declared').length,unresolved:modified.filter(r=>r.uncertain).length,referenceChanges:refRows.filter(r=>r.status!=='Unchanged').length},
    warnings,rows,referenceDesignators:refRows,
    trees:{left:left.nodes.map(n=>({id:n.id,parentId:n.parentId,name:n.name,partNumber:n.partNumber,depth:li.depths.get(n.id)})),right:right.nodes.map(n=>({id:n.id,parentId:n.parentId,name:n.name,partNumber:n.partNumber,depth:ri.depths.get(n.id)}))},
  };
}
