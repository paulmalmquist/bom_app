export const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function toCsv(report) {
  const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
  const lines=[['Change','Match method','Path A','Path B','Part A','Part B','Revision A','Revision B','Qty A','Qty B','Unit A','Unit B','Reference A','Reference B','Records','Correspondence unresolved']];
  for(const r of report.rows)lines.push([r.changes.join('; ')||'Unchanged',r.matchMethod,r.pathA,r.pathB,r.left?.partNumber,r.right?.partNumber,r.left?.revision,r.right?.revision,r.left?.quantity,r.right?.quantity,r.left?.unit,r.right?.unit,r.left?.refDes.join('; '),r.right?.refDes.join('; '),r.evidence.map(e=>`${e.side}:${e.source}:${e.id} (${e.relationship})`).join('; '),r.uncertain]);
  return '\uFEFF'+lines.map(line=>line.map(cell).join(',')).join('\r\n');
}
export function filterRows(report,{search='',change='',changesOnly=true,needsReview=false,assembly=null,treeSide='left'}={}){
  const q=search.trim().toLowerCase();
  return report.rows.filter(r=>(!changesOnly||r.changes.length)&&(!change||r.changes.includes(change))&&(!needsReview||(r.changes.length&&!r.explained))&&(!assembly||(treeSide==='left'?r.ancestorsA:r.ancestorsB).includes(assembly))&&(!q||[r.pathA,r.pathB,r.left?.partNumber,r.right?.partNumber,...r.left?.refDes||[],...r.right?.refDes||[],...r.evidence.map(e=>e.id)].join(' ').toLowerCase().includes(q)));
}
