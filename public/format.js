export const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function catalogDrift(report,catalog) {
  const fields=['partNumber','revision','type','source','releaseStatus','serialNumber','configuration','capturedAt','nodeCount','synthetic'];
  return ['left','right'].flatMap((side,i)=>{
    const actual=report[side], selected=catalog.find(s=>s.id===actual.id);
    if(!selected)return [];
    const differences=fields.filter(k=>selected[k]!=null&&selected[k]!==actual[k] || k==='serialNumber'&&(selected[k]??null)!==(actual[k]??null))
      .map(k=>k==='nodeCount'?`${selected[k]} occurrences in catalog vs ${actual[k]} compared`:`${k}: ${selected[k]??'none'} in catalog vs ${actual[k]??'none'} compared`);
    return differences.length?[`${i?'B':'A'} snapshot ${actual.id} differs from its catalog entry (${differences.join('; ')}). Refresh the catalog and compare again.`]:[];
  });
}
export function toCsv(report) {
  const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
  // Paths alone do not identify repeated occurrences, so each row also carries occurrence ids, keys and the
  // exact snapshots compared. New columns are appended to keep existing column positions stable.
  const lines=[['Change','Match method','Path A','Path B','Part A','Part B','Revision A','Revision B','Qty A','Qty B','Unit A','Unit B','Reference A','Reference B','Records','Correspondence unresolved','Explanation','Changes without declared explanation','Occurrence A','Occurrence B','Canonical key A','Canonical key B','Baseline snapshot','Comparison snapshot','Baseline SHA-256','Comparison SHA-256']];
  const record=e=>`${e.side}:${e.source}:${e.id} (${e.relationship}${e.changes?': '+e.changes.join('/'):''}${e.excludedReason?', not counted':''})`;
  for(const r of report.rows)lines.push([r.changes.join('; ')||'Unchanged',r.matchMethod,r.pathA,r.pathB,r.left?.partNumber,r.right?.partNumber,r.left?.revision,r.right?.revision,r.left?.quantity,r.right?.quantity,r.left?.unit,r.right?.unit,r.left?.refDes.join('; '),r.right?.refDes.join('; '),r.evidence.map(record).join('; '),r.uncertain,r.explanation?.status,(r.explanation?.unexplained||[]).join('; '),r.left?.id,r.right?.id,r.left?.occurrenceKey,r.right?.occurrenceKey,report.left.id,report.right.id,report.left.fingerprint,report.right.fingerprint]);
  return '\uFEFF'+lines.map(line=>line.map(cell).join(',')).join('\r\n');
}
export function filterRows(report,{search='',change='',changesOnly=true,needsReview=false,assembly=null,treeSide='left'}={}){
  const q=search.trim().toLowerCase();
  return report.rows.filter(r=>(!changesOnly||r.changes.length||r.uncertain)&&(!change||r.changes.includes(change))&&(!needsReview||r.uncertain||(r.changes.length&&!r.explained))&&(!assembly||(treeSide==='left'?r.ancestorsA:r.ancestorsB).includes(assembly))&&(!q||[r.pathA,r.pathB,r.left?.partNumber,r.right?.partNumber,...r.left?.refDes||[],...r.right?.refDes||[],...r.evidence.map(e=>e.id)].join(' ').toLowerCase().includes(q)));
}
