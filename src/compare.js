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

export function compareSnapshots(leftInput, rightInput, { quantityTolerance = 1e-9 } = {}) {
  if (!Number.isFinite(quantityTolerance) || quantityTolerance < 0 || quantityTolerance > 1) throw new Error('Invalid quantityTolerance');
  const left = validateSnapshot(leftInput), right = validateSnapshot(rightInput);
  const li = index(left), ri = index(right), pairs = new Map(), reverse = new Map(), methods = new Map();
  const pair = (a,b,method) => { pairs.set(a.id,b.id); reverse.set(b.id,a.id); methods.set(a.id,method); };
  // Roots are alignment anchors, not assertions that the two products are identical.
  pair(li.root, ri.root, 'Root alignment');
  const rk = new Map(right.nodes.filter(n=>n.occurrenceKey).map(n=>[n.occurrenceKey,n]));
  for (const a of left.nodes) {
    const b = rk.get(a.occurrenceKey);
    if (b && !pairs.has(a.id) && !reverse.has(b.id)) pair(a,b,'Canonical occurrence');
  }
  // Conservative fallback only inside already aligned parents. Never globally match by PN.
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of ['reference','part']) {
      const keyLeft = n => {
        if (n.parentId === null || !pairs.has(n.parentId)) return null;
        const identity = field === 'reference' ? sorted(n.refDes).join('|') : n.partNumber;
        return identity ? JSON.stringify([pairs.get(n.parentId),identity]) : null;
      };
      const keyRight = n => {
        if (n.parentId === null || !reverse.has(n.parentId)) return null;
        const identity = field === 'reference' ? sorted(n.refDes).join('|') : n.partNumber;
        return identity ? JSON.stringify([n.parentId,identity]) : null;
      };
      const ag = groups(left.nodes.filter(n=>!pairs.has(n.id)),keyLeft);
      const bg = groups(right.nodes.filter(n=>!reverse.has(n.id)),keyRight);
      for (const [key, aa] of ag) {
        const bb = bg.get(key);
        if (aa.length === 1 && bb?.length === 1) {
          // Conflicting authoritative mappings must never be overridden by a heuristic.
          if (aa[0].occurrenceKey && bb[0].occurrenceKey && aa[0].occurrenceKey !== bb[0].occurrenceKey) continue;
          pair(aa[0],bb[0],field === 'reference' ? 'Reference + aligned parent' : 'Part + aligned parent'); changed = true;
        }
      }
    }
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
      if (a.parentId !== null && pairs.get(a.parentId) !== b.parentId || a.parentId === null && b.parentId !== null) changes.push('Moved');
      if (a.name !== b.name) changes.push('Description');
    }
    const evidence = [...(a?.records||[]).map(r=>({...r,side:'A'})),...(b?.records||[]).map(r=>({...r,side:'B'}))];
    const uncertain = (!a && ambiguity(b,'right')) || (!b && ambiguity(a,'left'));
    const pathA = a ? li.paths.get(a.id) : null, pathB = b ? ri.paths.get(b.id) : null;
    const aTop = a ? li.idPaths.get(a.id)[1] : null, bTop = b ? ri.idPaths.get(b.id)[1] : null;
    rows.push({
      id:`row-${rows.length+1}`, left:a??null, right:b??null,
      pathA, pathB, ancestorsA:a?li.idPaths.get(a.id):[], ancestorsB:b?ri.idPaths.get(b.id):[],
      depth:a?li.depths.get(a.id):ri.depths.get(b.id),
      assemblyA:aTop?li.nodes.get(aTop).name:'Assembly root', assemblyB:bTop?ri.nodes.get(bTop).name:'Assembly root',
      changes, status:changes.length?changes[0]:'Unchanged', uncertain,
      matchMethod:a&&b?methods.get(a.id):uncertain?'Unresolved correspondence':'No matched occurrence',
      evidence, explained:changes.length>0 && evidence.some(r=>r.relationship==='explains'),
    });
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
    return {ref,left:a,right:b,status:!a.length?'Added':!b.length?'Removed':!same(content(a),content(b))?'Reassigned':!assignmentsAligned?'Relocated':'Unchanged',duplicate:a.length>1||b.length>1};
  });
  const warnings=[];
  if(left.synthetic||right.synthetic) warnings.push('Synthetic demonstration data. No production source is connected.');
  if(left.releaseStatus==='Unreleased'||right.releaseStatus==='Unreleased') warnings.push('This comparison includes an unreleased snapshot. It is not an approved baseline.');
  if(left.type!==right.type) warnings.push('Different BOM views can intentionally use different structures. Unmapped occurrences remain additions/removals; review their correspondence.');
  if(left.partNumber!==right.partNumber) warnings.push('Root part numbers differ. Confirm these products are comparable.');
  if(left.configuration!==right.configuration) warnings.push('Configuration contexts differ. Confirm revision rule and effectivity before drawing conclusions.');
  if(left.serialNumber && right.serialNumber && left.serialNumber!==right.serialNumber) warnings.push('You are comparing different serialized units.');
  if(rows.some(r=>r.uncertain)) warnings.push('Some occurrence correspondence is unresolved. Supply canonical mappings to distinguish replacements, moves, and repeated parts.');
  if(rows.some(r=>r.changes.includes('Unit'))) warnings.push('Units differ on some lines. Quantities have not been converted and must not be interpreted as equivalent.');
  if(refRows.some(r=>r.duplicate)) warnings.push('Reference designators have multiple occurrences. Their complete assignment sets are shown; uniqueness depends on source scope.');
  const modified=rows.filter(r=>r.changes.length);
  return {
    schemaVersion:1,engineVersion:'1.0.0', comparedAt:new Date().toISOString(),
    left:{...header(left),fingerprint:fingerprint(left)}, right:{...header(right),fingerprint:fingerprint(right)},
    options:{quantityTolerance,quantityBasis:'Local occurrence quantity; no unit conversion or exploded totals'},
    summary:{total:rows.length,changed:modified.length,unchanged:rows.length-modified.length,added:rows.filter(r=>r.status==='Added').length,removed:rows.filter(r=>r.status==='Removed').length,explained:modified.filter(r=>r.explained).length,unresolved:modified.filter(r=>r.uncertain).length,referenceChanges:refRows.filter(r=>r.status!=='Unchanged').length},
    warnings,rows,referenceDesignators:refRows,
    trees:{left:left.nodes.map(n=>({id:n.id,parentId:n.parentId,name:n.name,partNumber:n.partNumber,depth:li.depths.get(n.id)})),right:right.nodes.map(n=>({id:n.id,parentId:n.parentId,name:n.name,partNumber:n.partNumber,depth:ri.depths.get(n.id)}))},
  };
}
