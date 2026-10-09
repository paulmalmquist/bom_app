import {esc,toCsv,filterRows,catalogDrift} from '/format.js';
const $=id=>document.getElementById(id);
const state={catalog:[],mode:'demo',provider:'',a:{type:'eBOM',release:'',serial:'',id:'ebom-rA'},b:{type:'aBOM',release:'',serial:'SN120',id:'abom-sn120'},report:null,view:'differences',treeSide:'left',assembly:null,expanded:new Set(),history:[],token:'',busy:false,page:0,failure:null,catalogReady:false};
const formatDate=s=>new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const tag=s=>`<span class="tag ${['Added','Removed','Replaced','Revision','Quantity','Moved','Unchanged'].includes(s)?s.toLowerCase():''}">${esc(s)}</span>`;
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function error(message){$('alert').textContent=message;$('alert').hidden=!message;}
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(state.token?{Authorization:`Bearer ${state.token}`}:{})}});
  const data=await response.json();
  if(response.status===401){if(!$('login-dialog').open)$('login-dialog').showModal();throw new Error(data.error);}
  if(!response.ok)throw new Error(data.error||'Request failed');return data;
}
function options(items,value){return items.map(([v,label])=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(label)}</option>`).join('');}
function renderSide(side){
  const pick=state[side],typed=state.catalog.filter(s=>s.type===pick.type);
  const serials=[...new Set(typed.map(s=>s.serialNumber).filter(Boolean))].sort();
  if(pick.serial&&!serials.includes(pick.serial))pick.serial='';
  const available=typed.filter(s=>(!pick.release||s.releaseStatus===pick.release)&&(!pick.serial||s.serialNumber===pick.serial));
  if(!available.some(s=>s.id===pick.id))pick.id=available[0]?.id||'';
  const selected=state.catalog.find(s=>s.id===pick.id);
  $(`side-${side}`).classList.toggle('source-b',side==='b');
  $(`side-${side}`).innerHTML=`<div class="source-top"><div class="source-label"><span class="letter">${side.toUpperCase()}</span>${side==='a'?'Baseline':'Compare against'}</div><div class="source-provider"><span></span>${esc(selected?.source||'No source selected')}${selected?.synthetic?' · demo':''}</div></div>
  <div class="source-fields"><label for="${side}-type">BOM view<select id="${side}-type" data-side="${side}" data-field="type">${options(['eBOM','mBOM','aBOM'].map(t=>[t,t]),pick.type)}</select></label>
  <label for="${side}-release">Release state<select id="${side}-release" data-side="${side}" data-field="release">${options([['','All states'],['Released','Released'],['Unreleased','Unreleased']],pick.release)}</select></label>
  <label for="${side}-serial">Serial number<select id="${side}-serial" data-side="${side}" data-field="serial"${!serials.length?' disabled':''}>${options([['',serials.length?'All serials':'Not serialized'],...serials.map(s=>[s,s])],pick.serial)}</select></label></div>
  <label class="snapshot-field" for="${side}-id">Assembly / revision / snapshot<select id="${side}-id" data-side="${side}" data-field="id"${!available.length?' disabled':''}>${available.length?options(available.map(s=>[s.id,`${s.partNumber} · ${s.name} · ${s.revision}${s.serialNumber?' / '+s.serialNumber:''} · ${s.id}`]),pick.id):'<option>No snapshots match these filters</option>'}</select></label>
  <div class="source-meta"><span>${selected?`${esc(selected.nodeCount??'—')} occurrences · captured ${esc(formatDate(selected.capturedAt))}`:'Try another release state or BOM view'}</span><span class="${selected?.releaseStatus==='Released'?'release':'unreleased'}">${esc(selected?.releaseStatus||'')}</span></div>`;
}
function selectionsChanged(){
  $('compare').disabled=state.busy||!state.catalogReady||!state.a.id||!state.b.id;
  const moved=!!state.report&&(state.report.left.id!==state.a.id||state.report.right.id!==state.b.id||catalogDrift(state.report,state.catalog).length>0);
  $('stale').hidden=!state.report||(!moved&&!state.failure);
  // A failed run must not leave an older result looking current.
  $('stale').textContent=state.failure&&state.report?`The latest comparison failed (${state.failure}). Results below are from ${formatDate(state.report.comparedAt)} and may not reflect current sources.`:'Selection or source metadata changed. Compare BOMs to update the results below.';
}
async function loadCatalog(){
  state.catalogReady=false;selectionsChanged();error('');
  try {
    const data=await api('/api/catalog');state.catalog=data.snapshots;state.mode=data.mode;state.provider=data.provider;state.catalogReady=true;
    renderSide('a');renderSide('b');selectionsChanged();
    const allSynthetic=state.catalog.length>0&&state.catalog.every(s=>s.synthetic);
    $('mode-label').textContent=allSynthetic?'Demo workspace':data.mode==='gateway'?'Gateway connected':'Snapshot directory';
    $('catalog-note').innerHTML=`<b>${state.catalog.length} snapshots available</b> · ${allSynthetic?'Synthetic data for exploration':esc(data.provider)}<br>Catalog retrieved ${esc(formatDate(data.loadedAt))}`;
    $('footer-mode').textContent=allSynthetic?'SYNTHETIC DATA · NO LIVE SYSTEM CONNECTION':'Source capture times shown on each snapshot';
    if(!state.catalog.length)error('The catalog is empty. Add authorized snapshots to the configured provider.');
    return true;
  }catch(e){state.failure=`catalog refresh failed: ${e.message}`;error(e.message);$('mode-label').textContent='Source unavailable';selectionsChanged();return false;}
}
async function compare(){
  if(state.busy)return;if(!state.catalogReady||!state.a.id||!state.b.id){selectionsChanged();return;}state.busy=true;$('compare').disabled=true;$('compare').innerHTML='<span class="loading-spin">◈</span> Comparing…';error('');
  const leftId=state.a.id,rightId=state.b.id;
  const selected=state.catalog.filter(s=>s.id===leftId||s.id===rightId);
  try{
    const report=await api('/api/compare',{method:'POST',body:JSON.stringify({leftId,rightId})});
    report.warnings.push(...catalogDrift(report,selected));
    state.failure=null;state.history.unshift(report);state.history=state.history.slice(0,8);showReport(report);toast('Comparison ready');
  }catch(e){state.failure=e.message;error(e.message);}finally{state.busy=false;$('compare').innerHTML='<span>◈</span> Compare BOMs <span>→</span>';selectionsChanged();}
}
function showReport(report){
  state.report=report;state.assembly=null;state.page=0;state.expanded=new Set();
  $('results').hidden=false;$('empty-state').hidden=true;selectionsChanged();
  $('run-context').textContent=`${report.left.type} ${report.left.revision}${report.left.serialNumber?' / '+report.left.serialNumber:''} → ${report.right.type} ${report.right.revision}${report.right.serialNumber?' / '+report.right.serialNumber:''} · ${formatDate(report.comparedAt)}`;
  const s=report.summary;const affected=new Set();
  for(const r of report.rows.filter(r=>r.changes.length)){if(r.ancestorsA[1])affected.add('A:'+r.ancestorsA[1]);}
  const metrics=[['Changed occurrences',s.changed,`of ${s.total} aligned or unmatched lines`,'◈',` / ${s.total}`],['Source explained',s.explained,`Every changed field covered by a declared source record${(s.partiallyExplained||0)+(s.linkedUnscoped||0)?` · ${(s.partiallyExplained||0)+(s.linkedUnscoped||0)} more partially or unscoped`:''}`,'↗',` / ${s.changed}`],['Affected A subassemblies',affected.size,'Top-level branches in the baseline','⌘',''],['Reference changes',s.referenceChanges,'Added, removed, reassigned or revised assignments','⌁','']];
  $('metrics').innerHTML=metrics.map(([label,value,note,icon,denom])=>`<div class="metric"><div class="metric-label">${label}</div><span class="metric-icon" aria-hidden="true">${icon}</span><div class="metric-value">${value}<small>${denom}</small></div><div class="metric-note">${note}</div></div>`).join('');
  const notes=report.warnings;
  $('warnings').hidden=!notes.length;$('warnings-summary').textContent=`${notes.length} context notes · review before interpreting differences`;
  $('warning-list').innerHTML=notes.map(w=>`<li>${esc(w)}</li>`).join('');
  $('diff-count').textContent=s.changed;$('ref-count').textContent=s.referenceChanges;
  renderTree();renderTable();
}
function renderTree(){
  if(!state.report)return;
  const side=state.treeSide,nodes=state.report.trees[side],childMap=new Map();
  for(const n of nodes){if(!childMap.has(n.parentId))childMap.set(n.parentId,[]);childMap.get(n.parentId).push(n);}
  const counts=new Map();for(const r of state.report.rows.filter(r=>r.changes.length))for(const id of side==='left'?r.ancestorsA:r.ancestorsB)counts.set(id,(counts.get(id)||0)+1);
  const root=nodes.find(n=>n.parentId===null);const roots=childMap.get(root?.id)||[];
  $('assembly-count').textContent=`${roots.length} branches`;$('all-count').textContent=state.report.summary.changed;
  $('all-assemblies').classList.toggle('active',!state.assembly);
  $('tree-a').classList.toggle('active',side==='left');$('tree-b').classList.toggle('active',side==='right');
  function branch(n,depth){
    const children=childMap.get(n.id)||[],open=state.expanded.has(n.id);
    return `<div class="tree-row ${state.assembly===n.id?'active':''}" style="padding-left:${Math.min(depth,6)*10}px"><button class="tree-expand" data-expand="${esc(n.id)}" aria-label="${open?'Collapse':'Expand'} ${esc(n.name)}" aria-expanded="${open}"${!children.length?' disabled':''}>${children.length?(open?'⌄':'›'):'·'}</button><button class="tree-select" data-assembly="${esc(n.id)}" title="${esc(n.name+' · '+n.partNumber)}"><span></span><span class="tree-name">${esc(n.name)}</span><span class="tree-count">${counts.get(n.id)||'—'}</span></button></div>${open?children.map(c=>branch(c,depth+1)).join(''):''}`;
  }
  $('tree').innerHTML=roots.map(n=>branch(n,0)).join('')||'<p class="muted">No subassemblies.</p>';
}
function getFilters(){return {search:$('search').value,change:$('change-filter').value,changesOnly:$('changes-only').checked,needsReview:$('needs-review').checked,assembly:state.assembly,treeSide:state.treeSide};}
function renderTable(){
  if(!state.report)return;
  const ref=state.view==='references';
  $('tab-differences').classList.toggle('active',!ref);$('tab-references').classList.toggle('active',ref);
  $('tab-differences').setAttribute('aria-selected',String(!ref));$('tab-references').setAttribute('aria-selected',String(ref));
  $('change-filter').disabled=ref;$('needs-review').disabled=ref;
  $('footer-note').textContent=ref?'Reference assignment sets preserve repeated uses and show full paths on hover.':'Select an occurrence to inspect both paths and supporting records.';
  const filters=getFilters();let rows;
  if(!ref)rows=filterRows(state.report,filters);
  else{
    const q=filters.search.trim().toLowerCase();
    const allowed=new Set(state.report.rows.filter(r=>!state.assembly||(state.treeSide==='left'?r.ancestorsA:r.ancestorsB).includes(state.assembly)).flatMap(r=>state.treeSide==='left'?[r.left?.id]:[r.right?.id]).filter(Boolean));
    rows=state.report.referenceDesignators.filter(r=>(!filters.changesOnly||r.status!=='Unchanged')&&(!q||[r.ref,...r.left.map(x=>x.partNumber+' '+x.path),...r.right.map(x=>x.partNumber+' '+x.path)].join(' ').toLowerCase().includes(q))&&(!state.assembly||r[state.treeSide].some(x=>allowed.has(x.occurrenceId))));
  }
  const total=rows.length,pages=Math.max(1,Math.ceil(total/100));state.page=Math.min(state.page,pages-1);const slice=rows.slice(state.page*100,(state.page+1)*100);
  $('row-count').textContent=`${total} ${ref?'reference designators':'occurrences'}${state.assembly?' in selected branch':''}`;
  if(!rows.length){$('table-container').innerHTML='<div class="no-results">No matching differences.<p>Try another assembly, clear your filters, or include unchanged lines.</p></div>';return;}
  const assignment=items=>items.length?items.map(x=>`<span class="ref-assignment">${esc(x.partNumber)} <span class="muted">${esc(x.revision)}</span><small title="${esc(x.path)}">${esc(x.path)}</small></span>`).join(''):'<span class="muted">Not assigned</span>';
  const content=ref?`<table><thead><tr><th>Reference</th><th>Baseline A</th><th>Compare B</th><th>Assignment</th></tr></thead><tbody>${slice.map(r=>`<tr><td class="qty">${esc(r.ref)}${r.duplicate?'<br><span class="tag">Multiple uses</span>':''}</td><td>${assignment(r.left)}</td><td>${assignment(r.right)}</td><td>${tag(r.status)}</td></tr>`).join('')}</tbody></table>`:
  `<table><thead><tr><th>Part / occurrence</th><th>Change</th><th>Qty · A → B</th><th>Assembly</th><th>Source record</th></tr></thead><tbody>${slice.map(r=>{
    const n=r.right||r.left,pn=r.left&&r.right&&r.left.partNumber!==r.right.partNumber?`${esc(r.left.partNumber)} <span class="part-arrow">→</span> ${esc(r.right.partNumber)}`:esc(n.partNumber);
    return `<tr><td><button class="part-link" data-row="${r.id}">${pn}</button><span class="part-name" title="${esc(n.name)}">${esc(n.name)}${n.refDes.length?' · '+esc(n.refDes.join(', ')):''}</span></td><td>${(r.changes.length?r.changes:['Unchanged']).map(tag).join('')}${r.uncertain?'<br><span class="tag">Unresolved match</span>':''}</td><td class="qty">${r.left?esc(r.left.quantity):'—'} <span class="part-arrow">→</span> ${r.right?esc(r.right.quantity):'—'}<span class="part-name">${esc(r.left?.unit||'—')} / ${esc(r.right?.unit||'—')}</span></td><td class="path-cell" title="A: ${esc(r.pathA||'Not present')}\nB: ${esc(r.pathB||'Not present')}">${esc(r.assemblyB==='Assembly root'?r.assemblyA:r.assemblyB)}${r.changes.includes('Moved')?'<span class="part-name">↗ Location changed</span>':''}</td><td><span class="record-indicator ${!r.explained?'unexplained':''}">${explanationLabel(r)}</span></td></tr>`;
  }).join('')}</tbody></table>`;
  $('table-container').innerHTML=content+(pages>1?`<div class="filter-subrow" style="padding-top:12px"><button class="text-button" data-page="-1"${state.page===0?' disabled':''}>← Previous</button><span>Page ${state.page+1} of ${pages} · 100 lines per page</span><button class="text-button" data-page="1"${state.page===pages-1?' disabled':''}>Next →</button></div>`:'');
}
function explanationLabel(r){
  const x=r.explanation||{},status=x.status;
  if(r.explained)return '↗ '+esc(x.records?.[0]||r.evidence.find(e=>e.relationship==='explains')?.id||'');
  if(status==='Partially explained')return `Partially explained${x.unexplained?.length?' · '+esc(x.unexplained.join(', '))+' not covered':''}`;
  if(status==='Linked, scope not declared')return 'Linked · scope not declared';
  if(status==='Unresolved correspondence')return 'Unresolved match';
  return r.evidence.length?'Related record':r.changes.length?'— Unlinked':'—';
}
function evidenceNote(e){
  if(e.excludedReason)return `Not counted as an explanation: ${esc(e.excludedReason)}`;
  if(e.relationship!=='explains')return 'Related record · does not establish cause';
  return e.changes?.length?`Source declares this record explains: ${esc(e.changes.join(', '))}${e.serialNumber?' · serial '+esc(e.serialNumber):''}`:'Explanatory link without declared change scope · not counted as explaining any field';
}
function openRow(id){
  const r=state.report.rows.find(r=>r.id===id);if(!r)return;const n=r.right||r.left;
  const fields=[['Part number','partNumber'],['Revision','revision'],['Quantity','quantity'],['Unit','unit'],['Reference','refDes'],['Occurrence ID','id'],['Canonical key','occurrenceKey']];
  const val=(node,key)=>!node?'Not present':Array.isArray(node[key])?node[key].join(', ')||'—':node[key]??'—';
  $('detail-content').innerHTML=`<div class="dialog-title"><div class="eyebrow">OCCURRENCE DETAIL</div><button class="icon-button" id="close-detail" aria-label="Close occurrence detail">×</button></div><div>${(r.changes.length?r.changes:['Unchanged']).map(tag).join('')}</div><h2>${esc(n.partNumber)}</h2><p class="subtitle">${esc(n.name)}</p><div class="muted">Matched by: ${esc(r.matchMethod)}</div>${r.uncertain?`<div class="stale">${esc(r.correspondence||'Correspondence is unresolved. Do not assume this is a confirmed addition or removal until mappings are reviewed.')}</div>`:''}
  <div class="detail-section"><div class="section-label">Location in each assembly</div><div class="detail-path"><span>A · BASELINE</span>${esc(r.pathA||'Not present')}</div><div class="detail-path"><span>B · COMPARE</span>${esc(r.pathB||'Not present')}</div></div>
  <div class="detail-section"><div class="detail-grid"><div></div><div class="head">BASELINE A</div><div class="head">COMPARE B</div>${fields.map(([label,key])=>`<div class="label">${label}</div><div>${esc(val(r.left,key))}</div><div>${esc(val(r.right,key))}</div>`).join('')}</div></div>
  <div class="detail-section"><div class="section-label">Change & quality records</div>${r.changes.length?`<div class="muted">Explanation: ${esc(r.explanation?.status||'—')}${r.explanation?.unexplained?.length?' · not covered: '+esc(r.explanation.unexplained.join(', ')):''}. An explanation is not an approval; check the record's disposition status.</div>`:''}${r.evidence.length?r.evidence.map(e=>`<article class="evidence-card"><div class="evidence-head"><strong>${esc(e.id)}</strong>${tag(e.type)}<span class="muted">${esc(e.status)}</span></div><p>${esc(e.summary)}</p><div class="evidence-meta">${evidenceNote(e)}<br>${esc(e.source)} · side ${esc(e.side)}</div>${e.url?`<p><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Open source record ↗</a></p>`:''}</article>`).join(''):'<div class="detail-path">No source record is linked to this occurrence. The comparison does not infer a cause.</div>'}</div>
  <div class="detail-section"><div class="section-label">Snapshot provenance</div><div class="provenance">${['left','right'].map((side,i)=>`${i?'B':'A'} · ${esc(state.report[side].source)} / ${esc(state.report[side].id)}<br>Captured ${esc(state.report[side].capturedAt)}<br>Context: ${esc(state.report[side].configuration)}<br>SHA-256: ${esc(state.report[side].fingerprint)}<br><br>`).join('')}Quantity basis: local occurrence. Parent quantities are not multiplied; no unit conversion.</div></div>`;
  $('close-detail').onclick=()=>$('detail-dialog').close();$('detail-dialog').showModal();
}
function info(title,content){$('info-title').textContent=title;$('info-content').innerHTML=content;if(!$('info-dialog').open)$('info-dialog').showModal();}
function guide(){info('How comparison works',`<p>Choose a baseline and a second snapshot. Any pairing of eBOM, mBOM and aBOM is supported. The selected snapshot fixes revision, release state, configuration and, where applicable, the serial number.</p><ol><li><strong>Match occurrences.</strong> Canonical occurrence keys take priority. Otherwise, unique reference designators or part numbers within aligned parents provide a conservative match. Repeated parts with unresolved correspondence remain visible for review.</li><li><strong>Trace the change.</strong> Choose an assembly to scope differences. Open a part to see its full location on both sides, revisions, quantities and source records.</li><li><strong>Inspect the evidence.</strong> “Source explained” counts a changed occurrence only when explanatory records declare every changed field. Partial or unscoped links, records unchanged on both snapshots and records for another serial stay in the review queue. Related records provide context; no record establishes approval.</li><li><strong>Check context.</strong> Unreleased baselines, different configurations, units and BOM structures need engineering review. Quantities are local to each occurrence.</li><li><strong>Keep the result.</strong> JSON and CSV exports contain the current complete comparison, including unchanged rows, independent of table filters. Session history retains the last eight comparisons in this tab.</li></ol><p>Live mode requires your internal gateway to resolve Teamcenter revision rules, Manufacturo serial effectivity and quality-record relationships. Demo source names represent synthetic examples.</p>`);}
function sources(){
  const names=[...new Set(state.catalog.map(s=>s.source))];
  info('Data sources',`<p>Current provider: <strong>${esc(state.provider||'Unavailable')}</strong>. Catalogs refresh on demand; each comparison retrieves its selected snapshots again.</p>${names.map(name=>{const snapshots=state.catalog.filter(s=>s.source===name),demo=snapshots.every(s=>s.synthetic);return `<div class="source-status"><h3>${esc(name)}</h3><span class="tag">${demo?'Synthetic demo':state.mode==='gateway'?'Served by internal gateway':'Snapshot directory'}</span><p>${snapshots.length} catalog snapshots · ${[...new Set(snapshots.map(s=>s.type))].map(esc).join(', ')}</p></div>`;}).join('')}<p>Gateway integration is configured on the server. Credentials stay out of the browser. Native Teamcenter and Manufacturo mappings must be implemented within your authorized internal gateway; they are not connected in demo mode.</p><button class="button secondary" id="refresh-sources">Refresh catalog ↻</button>`);
  $('refresh-sources').onclick=async()=>{if(await loadCatalog()){sources();toast('Catalog refreshed');}};
}
function history(){info('Session history',state.history.length?`<p>Last ${state.history.length} comparisons in this tab. Opening a run restores its captured result; changing selections does not rewrite it.</p>${state.history.map((r,i)=>`<button class="history-entry" data-history="${i}">${esc(r.left.id)} → ${esc(r.right.id)}<small>${esc(formatDate(r.comparedAt))} · ${r.summary.changed} changed · ${r.summary.explained} source explained</small></button>`).join('')}`:'<p>No comparisons yet. Run a comparison to begin.</p>');}
function download(kind){if(!state.report)return;const json=kind==='json';const blob=new Blob([json?JSON.stringify(state.report,null,2):toCsv(state.report)],{type:json?'application/json':'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`bom-${state.report.left.id}-vs-${state.report.right.id}.${kind}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Complete comparison exported as ${kind.toUpperCase()}`);}
function view(name){state.view=name;state.page=0;renderTable();if(state.report)$('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
document.addEventListener('change',event=>{
  const t=event.target;
  if(t.dataset.side){state[t.dataset.side][t.dataset.field]=t.value;renderSide(t.dataset.side);selectionsChanged();}
  if(['change-filter','changes-only','needs-review'].includes(t.id)){state.page=0;renderTable();}
});
$('search').oninput=()=>{state.page=0;renderTable();};
$('compare').onclick=compare;$('swap').onclick=()=>{[state.a,state.b]=[state.b,state.a];renderSide('a');renderSide('b');selectionsChanged();};
$('clear-filters').onclick=()=>{$('search').value='';$('change-filter').value='';$('changes-only').checked=true;$('needs-review').checked=false;state.assembly=null;state.page=0;renderTree();renderTable();};
$('all-assemblies').onclick=()=>{state.assembly=null;state.page=0;renderTree();renderTable();};
for(const [id,side]of[['tree-a','left'],['tree-b','right']])$(id).onclick=()=>{state.treeSide=side;state.assembly=null;state.expanded.clear();state.page=0;renderTree();renderTable();};
$('tree').onclick=e=>{const expand=e.target.closest('[data-expand]'),select=e.target.closest('[data-assembly]');if(expand){const id=expand.dataset.expand;state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);renderTree();}if(select){state.assembly=select.dataset.assembly;state.page=0;renderTree();renderTable();}};
$('table-container').onclick=e=>{const row=e.target.closest('[data-row]'),page=e.target.closest('[data-page]');if(row)openRow(row.dataset.row);if(page){state.page+=Number(page.dataset.page);renderTable();$('table-container').scrollTop=0;}};
$('tab-differences').onclick=()=>view('differences');$('tab-references').onclick=()=>view('references');$('nav-references').onclick=()=>view('references');$('nav-compare').onclick=()=>view('differences');
$('nav-guide').onclick=guide;$('guide-button').onclick=guide;$('nav-sources').onclick=sources;$('mode-button').onclick=sources;$('nav-history').onclick=history;
$('export-json').onclick=()=>download('json');$('export-csv').onclick=()=>download('csv');$('close-info').onclick=()=>$('info-dialog').close();
$('info-content').onclick=e=>{const entry=e.target.closest('[data-history]');if(entry){showReport(state.history[Number(entry.dataset.history)]);$('info-dialog').close();}};
$('login-form').onsubmit=async e=>{e.preventDefault();state.token=$('access-token').value;$('access-token').value='';$('login-dialog').close();if(await loadCatalog())await compare();};
for(const id of ['info-dialog','detail-dialog'])$(id).onclick=e=>{if(e.target===$(id)){const r=$(id).getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$(id).close();}};
if(await loadCatalog())await compare();
