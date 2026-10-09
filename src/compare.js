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
  return { nodes, paths, idPaths, depths, root: s.nodes.find(n => n.parentId === null), children: groups(s.nodes, n => n.parentId) };
};
const groups = (nodes, key) => {
  const map = new Map();
  for (const n of nodes) { const k = key(n); if (k == null) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(n); }
  return map;
};
const sorted = a => [...a].sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const recordKey = r => JSON.stringify([r.source,r.id]);
// Lazy subtree signatures exclude local ids but retain shared canonical anchors. Hash only repeated candidates.
const signatures = (children, sharedKeys) => {
  const memo = new Map();
  const canonicalRecords = rs => sorted(rs.map(r => JSON.stringify(Object.keys(r).sort().map(k => [k, k==='changes'&&Array.isArray(r[k])?sorted(r[k]):r[k]]))));
  const sig = n => {
    if (!memo.has(n.id)) {
      const kids = sorted((children.get(n.id) || []).map(sig));
      memo.set(n.id, createHash('sha256').update(JSON.stringify([sharedKeys.has(n.occurrenceKey)?n.occurrenceKey:null,n.partNumber,n.revision,n.quantity,n.unit,sorted(n.refDes),n.name,canonicalRecords(n.records),kids])).digest('hex'));
    }
    return memo.get(n.id);
  };
  return sig;
};

export function compareSnapshots(leftInput, rightInput, { quantityTolerance = 1e-9 } = {}) {
  if (!Number.isFinite(quantityTolerance) || quantityTolerance < 0 || quantityTolerance > 1) throw new Error('Invalid quantityTolerance');
  const left = validateSnapshot(leftInput), right = validateSnapshot(rightInput);
  const li = index(left), ri = index(right), pairs = new Map(), reverse = new Map(), methods = new Map(), queue = [];
  const pair = (a,b,method) => { pairs.set(a.id,b.id); reverse.set(b.id,a.id); methods.set(a.id,method); queue.push([a,b]); };
  // Canonical keys are authoritative and take precedence over root alignment: A may be a subassembly inside B.
  const rk = new Map(right.nodes.filter(n=>n.occurrenceKey).map(n=>[n.occurrenceKey,n]));
  for (const a of left.nodes) {
    const b = rk.get(a.occurrenceKey);
    if (b && !pairs.has(a.id) && !reverse.has(b.id)) pair(a,b,'Canonical occurrence');
  }
  // Roots are alignment anchors, not assertions that the two products are identical.
  if (!pairs.has(li.root.id) && !reverse.has(ri.root.id)) pair(li.root, ri.root, 'Root alignment');
  // Each aligned parent is processed once. Canonical matches seed the queue; fallback matches extend it.
  const sharedKeys = new Set(left.nodes.filter(n => n.occurrenceKey && rk.has(n.occurrenceKey)).map(n => n.occurrenceKey));
  const sigL = signatures(li.children,sharedKeys), sigR = signatures(ri.children,sharedKeys);
  const order = (signature, nodes) => [...nodes].sort((a,b) => signature(a).localeCompare(signature(b)) || (a.id<b.id?-1:a.id>b.id?1:0));
  for (const [parentA,parentB] of queue) {
    for (const field of ['reference','part','identical']) {
      const identity = n => field === 'reference' ? (n.refDes.length ? JSON.stringify(sorted(n.refDes)) : null) : n.partNumber;
      const ag = groups((li.children.get(parentA.id)||[]).filter(n=>!pairs.has(n.id)),identity);
      const bg = groups((ri.children.get(parentB.id)||[]).filter(n=>!reverse.has(n.id)),identity);
      for (const [key,aa] of ag) {
        const bb = bg.get(key);
        if (!bb) continue;
        if (field === 'identical') {
          // Pair only a whole equal multiset; mapped descendant keys constrain which parents are interchangeable.
          if (aa.length < 2 || aa.length !== bb.length || aa.some(n=>n.occurrenceKey) && bb.some(n=>n.occurrenceKey)) continue;
          const oa=order(sigL,aa), ob=order(sigR,bb);
          if (oa.every((n,i)=>sigL(n)===sigR(ob[i]))) oa.forEach((n,i)=>pair(n,ob[i],'Identical content + aligned parent'));
        } else if (aa.length === 1 && bb.length === 1) {
          if (aa[0].occurrenceKey && bb[0].occurrenceKey && aa[0].occurrenceKey !== bb[0].occurrenceKey) continue;
          pair(aa[0],bb[0],field === 'reference' ? 'Reference + aligned parent' : 'Part + aligned parent');
        }
      }
    }
  }
  // Index competing parts once instead of scanning every sibling for every matched occurrence.
  const partSets = ns => new Map([...groups(ns,n=>n.parentId)].map(([id,ns])=>[id,new Set(ns.map(n=>n.partNumber))]));
  const competingL=partSets(left.nodes.filter(n=>ri.nodes.get(pairs.get(n.id))?.partNumber!==n.partNumber));
  const competingR=partSets(right.nodes.filter(n=>li.nodes.get(reverse.get(n.id))?.partNumber!==n.partNumber));
  const remainingL=partSets(left.nodes.filter(n=>!pairs.has(n.id))), remainingR=partSets(right.nodes.filter(n=>!reverse.has(n.id)));
  const correspondence = new Map();
  for (const [a,b] of queue) {
    if (a.partNumber === b.partNumber) continue;
    if (methods.get(a.id)==='Reference + aligned parent' && (competingR.get(b.parentId)?.has(a.partNumber)||competingL.get(a.parentId)?.has(b.partNumber)))
      correspondence.set(a.id,'Reference designator and part number indicate different correspondences. Review before treating this as a replacement.');
    if (methods.get(a.id)==='Canonical occurrence' && a.parentId!==null && b.parentId!==null && (remainingR.get(pairs.get(a.parentId))?.has(a.partNumber)||remainingL.get(reverse.get(b.parentId))?.has(b.partNumber)))
      correspondence.set(a.id,'The canonical key may have been reused: an unmatched original part remains in its original location. Verify source lineage.');
  }
  // Heuristic child matches depend on the parent match. Independent canonical identities do not.
  for (const a of [...left.nodes].sort((a,b)=>li.depths.get(a.id)-li.depths.get(b.id))) {
    if (pairs.has(a.id) && methods.get(a.id)!=='Canonical occurrence' && correspondence.has(a.parentId))
      correspondence.set(a.id,'This correspondence depends on an unresolved parent match. Verify the assembly mapping first.');
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
    const uncertain = (!a && ambiguity(b,'right')) || (!b && ambiguity(a,'left')) || !!a && correspondence.has(a.id);
    const evidence = explainEvidence(a,b,changes,uncertain);
    const pathA = a ? li.paths.get(a.id) : null, pathB = b ? ri.paths.get(b.id) : null;
    const aTop = a ? li.idPaths.get(a.id)[1] : null, bTop = b ? ri.idPaths.get(b.id)[1] : null;
    rows.push({
      id:`row-${rows.length+1}`, left:a??null, right:b??null,
      pathA, pathB, ancestorsA:a?li.idPaths.get(a.id):[], ancestorsB:b?ri.idPaths.get(b.id):[],
      depth:a?li.depths.get(a.id):ri.depths.get(b.id),
      assemblyA:aTop?li.nodes.get(aTop).name:'Assembly root', assemblyB:bTop?ri.nodes.get(bTop).name:'Assembly root',
      changes, status:changes.length?changes[0]:'Unchanged', uncertain,
      ...(a && correspondence.has(a.id)?{correspondence:correspondence.get(a.id)}:{}),
      matchMethod:a&&b?methods.get(a.id):uncertain?'Unresolved correspondence':'No matched occurrence',
      evidence:evidence.items, explanation:evidence.explanation, explained:evidence.explanation.status==='Explained',
    });
  }
  // "Explained" requires every change type on the row to be declared by a qualifying explanatory record.
  // Related records, unscoped links, records unchanged on both snapshots, and records for another serial do not count.
  const excludedSerialRecords = new Set();
  function explainEvidence(a,b,changes,uncertain) {
    const ra = a?.records||[], rb = b?.records||[];
    const state = new Map(ra.map(r=>[recordKey(r),r.status]));
    const common = new Set(a && b ? rb.filter(r=>state.get(recordKey(r))===r.status).map(recordKey) : []);
    const items = [...ra.map(r=>({...r,side:'A'})),...rb.map(r=>({...r,side:'B'}))].map(r=>{
      let excludedReason;
      if (r.relationship==='explains' && common.has(recordKey(r))) excludedReason = 'Present unchanged on both snapshots: pre-existing context, not an explanation of this difference';
      else if (r.relationship==='explains' && r.serialNumber!=null && r.serialNumber!==(r.side==='A'?left:right).serialNumber) { excludedReason = `Scoped to serial ${r.serialNumber}, which does not match its side ${r.side} snapshot`; excludedSerialRecords.add(recordKey(r)); }
      return excludedReason ? {...r,excludedReason} : r;
    });
    const qualifying = items.filter(r=>r.relationship==='explains' && !r.excludedReason);
    const covered = new Set(qualifying.flatMap(r=>r.changes||[]).filter(c=>changes.includes(c)));
    const unexplained = uncertain ? [...changes] : changes.filter(c=>!covered.has(c));
    const status = uncertain ? 'Unresolved correspondence' : !changes.length ? 'Not applicable'
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
    const byId=new Map(b.map(x=>[x.occurrenceId,x]));
    const mapped=a.map(x=>byId.get(pairs.get(x.occurrenceId)));
    const aligned=a.length===b.length && mapped.every(Boolean);
    const content = v => sorted(v.map(x=>JSON.stringify([x.partNumber,x.revision])));
    let status;
    if (!a.length) status='Added';
    else if (!b.length) status='Removed';
    else if (!aligned) status=same(content(a),content(b))?'Relocated':'Reassigned';
    else if (a.some((x,i)=>x.partNumber!==mapped[i].partNumber)) status='Reassigned';
    else status=a.some((x,i)=>x.revision!==mapped[i].revision)?'Revised':'Unchanged';
    return {ref,left:a,right:b,status,duplicate:a.length>1||b.length>1};
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
  if(excludedSerialRecords.size) warnings.push(`${excludedSerialRecords.size} explanatory record(s) do not match the serial of their attached snapshot and were not counted as explanations.`);
  if(rows.some(r=>r.changes.length && ['Partially explained','Linked, scope not declared'].includes(r.explanation.status))) warnings.push('Some explanatory links do not declare every changed field. Those occurrences are not counted as explained and remain in the review queue.');
  if(rows.some(r=>r.uncertain)) warnings.push('Some occurrence correspondence is unresolved. Supply canonical mappings to distinguish replacements, moves, and repeated parts.');
  if(rows.some(r=>r.changes.includes('Unit'))) warnings.push('Units differ on some lines. Quantities have not been converted and must not be interpreted as equivalent.');
  if(refRows.some(r=>r.duplicate)) warnings.push('Reference designators have multiple occurrences. Their complete assignment sets are shown; uniqueness depends on source scope.');
  const modified=rows.filter(r=>r.changes.length);
  return {
    schemaVersion:1,engineVersion:'1.2.0', comparedAt:new Date().toISOString(),
    left:{...header(left),fingerprint:fingerprint(left)}, right:{...header(right),fingerprint:fingerprint(right)},
    options:{quantityTolerance,quantityBasis:'Local occurrence quantity; no unit conversion or exploded totals'},
    summary:{total:rows.length,changed:modified.length,unchanged:rows.length-modified.length,added:rows.filter(r=>r.status==='Added').length,removed:rows.filter(r=>r.status==='Removed').length,explained:modified.filter(r=>r.explained).length,partiallyExplained:modified.filter(r=>r.explanation.status==='Partially explained').length,linkedUnscoped:modified.filter(r=>r.explanation.status==='Linked, scope not declared').length,unresolved:rows.filter(r=>r.uncertain).length,referenceChanges:refRows.filter(r=>r.status!=='Unchanged').length},
    warnings,rows,referenceDesignators:refRows,
    trees:{left:left.nodes.map(n=>({id:n.id,parentId:n.parentId,name:n.name,partNumber:n.partNumber,depth:li.depths.get(n.id)})),right:right.nodes.map(n=>({id:n.id,parentId:n.parentId,name:n.name,partNumber:n.partNumber,depth:ri.depths.get(n.id)}))},
  };
}
