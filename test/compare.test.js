import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots } from '../src/compare.js';
import { validateSnapshot, fingerprint } from '../src/model.js';
import { createProvider } from '../src/providers.js';
import { toCsv, filterRows, esc } from '../public/format.js';
const n=(id,parentId,partNumber='PN',extra={})=>({id,parentId,partNumber,name:id,revision:'A',quantity:1,unit:'EA',refDes:[],records:[],...extra});
const snapshot=(nodes,extra={})=>({id:'test',name:'Test assembly',partNumber:'ROOT',revision:'A',source:'Test',type:'eBOM',releaseStatus:'Released',serialNumber:null,configuration:'All units',capturedAt:'2026-10-09T12:00:00Z',synthetic:true,nodes,...extra});
const basic=()=>snapshot([n('root',null,'ROOT'),n('branch','root','SUB'),n('part','branch')]);

test('identical snapshots yield no changes and fingerprints are key-order independent',()=>{
  const a=basic(),result=compareSnapshots(a,a);assert.equal(result.summary.changed,0);assert.equal(result.summary.unchanged,3);
  const b=Object.fromEntries(Object.entries(a).reverse());assert.equal(fingerprint(a),fingerprint(b));assert.equal(result.left.fingerprint,result.right.fingerprint);
});
test('demo fulfills ticket scenarios, exact paths and explicit record relationships',async()=>{
  const p=createProvider({BOM_MODE:'demo'});const r=compareSnapshots(await p.get('ebom-rA'),await p.get('abom-sn120'));
  assert.deepEqual(r.summary,{total:19,changed:8,unchanged:11,added:1,removed:1,explained:4,partiallyExplained:0,linkedUnscoped:0,unresolved:0,referenceChanges:6});
  const valve=r.rows.find(r=>r.left?.id==='valve-ox');assert.deepEqual(valve.changes,['Replaced','Revision','Description']);assert.match(valve.pathA,/Propellant feed/);assert.match(valve.pathB,/alternate/);assert.equal(valve.evidence[0].id,'DEMO-NC-1042');
  const harness=r.rows.find(r=>r.left?.id==='harness');assert.deepEqual(harness.changes,['Moved']);assert.equal(harness.explained,false);assert.equal(harness.evidence[0].relationship,'related');
  assert.equal(r.referenceDesignators.find(r=>r.ref==='V-OX-01').right[0].partNumber,'DEMO-2110');assert.equal(r.referenceDesignators.find(r=>r.ref==='TT-203').status,'Added');
});
test('all 36 demo BOM pairings and reversed direction are valid',async()=>{
  const p=createProvider({BOM_MODE:'demo'}),snapshots=await Promise.all((await p.list()).map(s=>p.get(s.id)));
  for(const a of snapshots)for(const b of snapshots){const r=compareSnapshots(a,b);assert.equal(r.rows.filter(r=>r.left).length,a.nodes.length);assert.equal(r.rows.filter(r=>r.right).length,b.nodes.length);const reverse=compareSnapshots(b,a);assert.equal(r.summary.added,reverse.summary.removed);assert.equal(r.summary.changed,reverse.summary.changed);}
});
test('repeated part numbers in different branches are never collapsed',()=>{
  const a=snapshot([n('r',null,'ROOT'),n('x','r','X'),n('y','r','Y'),n('p1','x','BOLT',{quantity:2}),n('p2','y','BOLT',{quantity:8})]);
  const b=structuredClone(a);b.nodes[4].quantity=10;const r=compareSnapshots(a,b);assert.equal(r.summary.changed,1);assert.equal(r.rows.find(r=>r.changes.length).left.id,'p2');
});
test('ambiguous repeated parts are unresolved rather than paired arbitrarily',()=>{
  const a=snapshot([n('root',null,'ROOT'),n('a','root','BOLT'),n('b','root','BOLT')]);
  const b=snapshot([n('root2',null,'ROOT',{name:'root'}),n('c','root2','BOLT'),n('d','root2','BOLT')]);
  const r=compareSnapshots(a,b);assert.equal(r.summary.unresolved,4);assert.equal(r.summary.added,2);assert.equal(r.summary.removed,2);
});
test('stable mappings detect a move without adding and removing the part',()=>{
  const a=snapshot([n('root',null,'ROOT'),n('x','root','X'),n('y','root','Y'),n('p','x','PN',{occurrenceKey:'canonical-part'})]);
  const b=structuredClone(a);b.nodes[3].id='other-id';b.nodes[3].parentId='y';const r=compareSnapshots(a,b);assert.deepEqual(r.rows.find(r=>r.left?.id==='p').changes,['Moved']);assert.equal(r.summary.added,0);
});
test('conflicting canonical keys override attractive heuristic matches',()=>{
  const a=basic(),b=basic();a.nodes[2].occurrenceKey='first';b.nodes[2].occurrenceKey='second';a.nodes[2].refDes=['V1'];b.nodes[2].refDes=['V1'];const r=compareSnapshots(a,b);assert.equal(r.summary.unresolved,2);assert.equal(r.summary.added,1);assert.equal(r.summary.removed,1);
});
test('unique reference plus parent identifies a replacement without canonical keys',()=>{
  const a=basic(),b=basic();a.nodes[2].refDes=['V1'];b.nodes[2].refDes=['V1'];b.nodes[2].id='new';b.nodes[2].partNumber='OTHER';const r=compareSnapshots(a,b);assert.equal(r.summary.changed,1);assert.equal(r.rows[2].status,'Replaced');assert.equal(r.rows[2].matchMethod,'Reference + aligned parent');
});
test('reference order is irrelevant and multiple uses remain fully visible',()=>{
  const a=basic(),b=basic();a.nodes[1].refDes=['R1','R2'];b.nodes[1].refDes=['R2','R1'];a.nodes[2].refDes=['R1'];b.nodes[2].refDes=['R1'];const r=compareSnapshots(a,b);assert.equal(r.summary.changed,0);const ref=r.referenceDesignators.find(r=>r.ref==='R1');assert.equal(ref.duplicate,true);assert.equal(ref.left.length,2);assert.ok(r.warnings.some(w=>w.includes('multiple occurrences')));
});
test('quantity changes are local, tolerant of float noise, and do not convert units',()=>{
  const a=basic(),b=basic();a.nodes[1].quantity=2;b.nodes[1].quantity=3;b.nodes[2].quantity=1+1e-12;b.nodes[2].unit='KG';const r=compareSnapshots(a,b);assert.deepEqual(r.rows[1].changes,['Quantity']);assert.deepEqual(r.rows[2].changes,['Unit']);assert.ok(r.warnings.some(w=>w.includes('not been converted')));
});
test('added and removed branches retain all child paths',()=>{
  const a=basic(),b=snapshot([n('root',null,'ROOT')]);const r=compareSnapshots(a,b);assert.equal(r.summary.removed,2);assert.match(r.rows[2].pathA,/branch \[SUB\] \/ part \[PN\]/);assert.equal(r.rows[2].pathB,null);
});
test('context warnings identify unreleased and differently configured serials',()=>{
  const a=snapshot(basic().nodes,{type:'aBOM',serialNumber:'001'}),b=snapshot(basic().nodes,{type:'aBOM',serialNumber:'002',releaseStatus:'Unreleased',configuration:'Other'});const r=compareSnapshots(a,b);assert.ok(r.warnings.some(w=>w.includes('unreleased')));assert.ok(r.warnings.some(w=>w.includes('different serialized')));assert.ok(r.warnings.some(w=>w.includes('Configuration')));
});
test('invalid graphs and malformed data fail closed',()=>{
  for(const mutate of [
    s=>s.nodes.push({...s.nodes[0]}),s=>s.nodes[2].parentId='missing',s=>s.nodes[1].parentId='part',s=>s.nodes[2].quantity=-1,s=>s.nodes[2].quantity=NaN,s=>s.nodes[2].quantity='2',s=>s.nodes[2].refDes=['R','R'],s=>s.nodes[2].parentId=null,s=>{s.type='aBOM';s.serialNumber=null;},s=>s.nodes[2].records=[{id:'NC',type:'NC',summary:'Example',source:'test',status:'open',relationship:'related',url:'javascript:alert(1)'}],s=>s.capturedAt='2026-10-09',s=>{s.nodes[1].occurrenceKey='same';s.nodes[2].occurrenceKey='same';},
  ]){const s=basic();mutate(s);assert.throws(()=>validateSnapshot(s));}
});
test('exports quote commas and guard spreadsheet formula injection',()=>{
  const a=basic(),b=basic();a.nodes[2].occurrenceKey='part';b.nodes[2].occurrenceKey='part';b.nodes[2].name='=CMD(),"danger"';b.nodes[2].partNumber='  @evil';const csv=toCsv(compareSnapshots(a,b));assert.match(csv,/"'  @evil"/);assert.match(csv,/""danger""/);assert.equal(csv.split('\r\n').length,4);
});
test('view filtering is path-aware and explanation-aware',async()=>{
  const p=createProvider({BOM_MODE:'demo'}),r=compareSnapshots(await p.get('ebom-rA'),await p.get('abom-sn120'));
  assert.equal(filterRows(r,{search:'V-OX-01'}).length,1);assert.equal(filterRows(r,{needsReview:true}).length,4);assert.equal(filterRows(r,{assembly:'power',treeSide:'left'}).length,2);assert.equal(filterRows(r,{change:'Moved'}).length,1);assert.equal(filterRows(r,{changesOnly:false}).length,19);assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('large repeated-part structures compare without quadratic unresolved scans',()=>{
  const a=snapshot([n('root',null,'ROOT'),...Array.from({length:5000},(_,i)=>n(`a${i}`,'root','BOLT'))]);
  const b=snapshot([n('root',null,'ROOT'),...Array.from({length:5000},(_,i)=>n(`b${i}`,'root','BOLT'))]);
  const start=performance.now(),r=compareSnapshots(a,b);assert.equal(r.summary.unresolved,10000);assert.ok(performance.now()-start<10000,'5,000 repeated parts should complete within 10s');
});
