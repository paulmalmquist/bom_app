// Red-team regression tests. Each test names the RED_TEAM_REPORT.md finding it guards.
// Every finding test failed against commit de22eaa before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { compareSnapshots } from '../src/compare.js';
import { validateHeader, validateSnapshot } from '../src/model.js';
import { createProvider } from '../src/providers.js';
import { createServer } from '../src/server.js';
import { toCsv, filterRows } from '../public/format.js';

const n=(id,parentId,partNumber='PN',extra={})=>({id,parentId,partNumber,name:extra.name??partNumber,revision:'A',quantity:1,unit:'EA',refDes:[],records:[],...extra});
const snap=(nodes,extra={})=>({id:'t',name:'T',partNumber:'ROOT',revision:'A',source:'Test',type:'eBOM',releaseStatus:'Released',serialNumber:null,configuration:'All units',capturedAt:'2026-10-09T12:00:00Z',synthetic:true,nodes,...extra});
const rec=(id,extra={})=>({id,type:'NC',status:'Closed',summary:'Synthetic record',source:'QMS',relationship:'explains',...extra});
const row=(r,id)=>r.rows.find(x=>x.left?.id===id||x.right?.id===id);

test('F1 identical repeated occurrences without keys are not reported as changes',()=>{
  const bolts=snap([n('r',null,'ROOT'),n('b1','r','BOLT'),n('b2','r','BOLT'),n('b3','r','BOLT')]);
  let r=compareSnapshots(bolts,bolts);assert.equal(r.summary.changed,0);assert.equal(r.summary.unresolved,0);
  const subs=snap([n('r',null,'ROOT'),n('s1','r','SUB'),n('s2','r','SUB'),n('x1','s1','BOLT'),n('x2','s2','BOLT'),n('y1','s1','NUT'),n('y2','s2','NUT')]);
  r=compareSnapshots(subs,subs);assert.equal(r.summary.changed,0);
  // A real change inside repeated identical subassemblies remains visible and is not hidden by identical pairing.
  const changed=structuredClone(subs);changed.nodes.find(x=>x.id==='x2').quantity=3;
  r=compareSnapshots(subs,changed);assert.ok(r.summary.changed>=1);assert.ok(r.rows.some(x=>x.changes.length));
  // Repeated parts that differ only by snapshot-local id still pair; different content remains unresolved.
  const other=snap([n('r',null,'ROOT'),n('c1','r','BOLT'),n('c2','r','BOLT'),n('c3','r','BOLT',{revision:'B'})]);
  r=compareSnapshots(bolts,other);assert.equal(r.summary.changed,r.summary.unresolved,'differing repeats stay flagged as unresolved');
});

test('F2 reference-designator and part-number evidence that disagree are flagged, not asserted as replacements',()=>{
  const a=snap([n('r',null,'ROOT'),n('p1','r','RES-10K',{refDes:['R1']}),n('p2','r','RES-22K',{refDes:['R2']})]);
  const b=snap([n('r',null,'ROOT'),n('q1','r','RES-10K',{refDes:['R2']}),n('q2','r','RES-22K',{refDes:['R1']})]);
  const r=compareSnapshots(a,b);
  for(const id of ['p1','p2']){const x=row(r,id);assert.equal(x.uncertain,true,`${id} correspondence must be unresolved`);assert.ok(x.correspondence);}
  assert.equal(r.summary.unresolved,2);
  // A plain substitution at a designator with no competing candidate stays a confident replacement.
  const c=snap([n('r',null,'ROOT'),n('q1','r','RES-12K',{refDes:['R1']}),n('q2','r','RES-22K',{refDes:['R2']})]);
  assert.equal(row(compareSnapshots(a,c),'p1').uncertain,false);
  // Substituting the PN already used (and still matched) at a neighbouring designator is not contested.
  const d=snap([n('r',null,'ROOT'),n('q1','r','RES-22K',{refDes:['R1']}),n('q2','r','RES-22K',{refDes:['R2']})]);
  assert.equal(row(compareSnapshots(a,d),'p1').uncertain,false);
  // An unmatched same-PN candidate does compete.
  const e=snap([n('r',null,'ROOT'),n('q1','r','RES-22K',{refDes:['R1']}),n('q2','r','RES-22K',{refDes:['R2']}),n('q3','r','RES-10K',{refDes:['R9']})]);
  assert.equal(row(compareSnapshots(a,e),'p1').uncertain,true);
});

test('F3 canonical keys take precedence over root alignment when scopes differ',()=>{
  const a=snap([n('e',null,'ENG',{occurrenceKey:'k:eng'}),n('t','e','TURBO',{occurrenceKey:'k:turbo'}),n('v','e','VALVE',{occurrenceKey:'k:valve'})],{partNumber:'ENG'});
  const b=snap([n('veh',null,'VEH',{occurrenceKey:'k:veh'}),n('e2','veh','ENG',{occurrenceKey:'k:eng'}),n('t2','e2','TURBO',{occurrenceKey:'k:turbo'}),n('v2','e2','VALVE',{occurrenceKey:'k:valve'}),n('tank','veh','TANK',{occurrenceKey:'k:tank'})],{partNumber:'VEH'});
  const r=compareSnapshots(a,b);
  assert.equal(row(r,'e').right.id,'e2');assert.deepEqual(row(r,'e').changes,[]);
  assert.deepEqual(row(r,'t').changes,[]);assert.deepEqual(row(r,'v').changes,[]);
  assert.deepEqual(r.rows.filter(x=>x.status==='Added').map(x=>x.right.id).sort(),['tank','veh']);
  assert.ok(r.warnings.some(w=>w.includes('scope')));
  // Equal-key or keyless roots still align as before.
  const k=snap([n('r',null,'ROOT'),n('x','r','X')]);assert.equal(compareSnapshots(k,k).rows[0].matchMethod,'Root alignment');
});

test('F4 ref-des values must be single, trimmed designators',()=>{
  for(const refs of [['R1 '],[' R1'],['R1,R2'],['R1;R2'],['R1|R2'],['R1\tR2']])
    assert.throws(()=>validateSnapshot(snap([n('r',null,'ROOT'),n('p','r','X',{refDes:refs})])),/designator/,JSON.stringify(refs));
  validateSnapshot(snap([n('r',null,'ROOT'),n('p','r','X',{refDes:['R1','J1-A','U3.2']})]));
});

test('F5 declared node counts expose truncated or incomplete extraction',()=>{
  const full=snap([n('r',null,'ROOT'),n('s','r','SUB'),n('x','s','X'),n('y','s','Y')]);
  const truncated=structuredClone(full);truncated.nodes=truncated.nodes.slice(0,2);truncated.nodeCount=4;
  assert.throws(()=>validateSnapshot(truncated),/nodeCount/);
  validateSnapshot({...full,nodeCount:4});
  const h={...full};delete h.nodes;
  for(const bad of ['<a href="https://evil.example">x</a>',-1,1.5,'4'])assert.throws(()=>validateHeader({...h,nodeCount:bad}),/nodeCount/);
});

test('F6 one explanatory record does not explain changes it does not declare',()=>{
  const a=snap([n('r',null,'ROOT'),n('s1','r','S1',{occurrenceKey:'s1'}),n('s2','r','S2',{occurrenceKey:'s2'}),n('v','s1','VALVE',{occurrenceKey:'v'})]);
  const scoped=structuredClone(a);Object.assign(scoped.nodes[3],{parentId:'s2',revision:'B',quantity:3,records:[rec('NC-9',{changes:['Revision']})]});
  let r=compareSnapshots(a,scoped),x=row(r,'v');
  assert.equal(x.explained,false);assert.equal(x.explanation.status,'Partially explained');assert.deepEqual(x.explanation.unexplained,['Quantity','Moved']);
  assert.equal(r.summary.explained,0);assert.equal(r.summary.partiallyExplained,1);
  assert.equal(filterRows(r,{needsReview:true}).length,1,'partially explained rows stay in the review queue');
  const unscoped=structuredClone(scoped);unscoped.nodes[3].records=[rec('NC-9')];
  r=compareSnapshots(a,unscoped);x=row(r,'v');assert.equal(x.explained,false);assert.equal(x.explanation.status,'Linked, scope not declared');assert.equal(r.summary.linkedUnscoped,1);
  const full=structuredClone(scoped);full.nodes[3].records=[rec('NC-9',{changes:['Revision','Quantity','Moved']})];
  r=compareSnapshots(a,full);assert.equal(row(r,'v').explained,true);assert.equal(r.summary.explained,1);
  assert.throws(()=>validateSnapshot({...a,nodes:a.nodes.map(x=>x.id==='v'?{...x,records:[rec('NC-1',{changes:['Everything']})]}:x)}),/changes/);
});

test('F7 an unchanged record on both snapshots cannot explain a new difference; a serial-scoped record applies only to that serial',()=>{
  const old=rec('NC-OLD',{changes:['Quantity']});
  const a=snap([n('r',null,'ROOT'),n('v','r','VALVE',{occurrenceKey:'v',records:[old]})],{type:'aBOM',serialNumber:'SN100'});
  const b=structuredClone(a);b.nodes[1].quantity=2;
  let r=compareSnapshots(a,b),x=row(r,'v');assert.equal(x.explained,false);assert.ok(x.evidence.every(e=>e.excludedReason));
  const closed=structuredClone(b);closed.nodes[1].records=[{...old,status:'Dispositioned'}];
  assert.equal(row(compareSnapshots(a,closed),'v').explained,true,'a record whose state changed between snapshots may explain');
  const e=snap([n('r',null,'ROOT'),n('v','r','VALVE',{occurrenceKey:'v'})]);
  const sn120=snap([n('r',null,'ROOT'),n('v','r','VALVE-ALT',{occurrenceKey:'v',records:[rec('NC-77',{serialNumber:'SN121',changes:['Replaced','Description']})]})],{type:'aBOM',serialNumber:'SN120'});
  r=compareSnapshots(e,sn120);x=row(r,'v');assert.equal(x.explained,false);assert.match(x.evidence[0].excludedReason,/SN121/);assert.ok(r.warnings.some(w=>w.includes('serial')));
  sn120.nodes[1].records[0].serialNumber='SN120';assert.equal(row(compareSnapshots(e,sn120),'v').explained,true);
});

test('F8 loopback service without a token rejects foreign Host headers (DNS rebinding)',async()=>{
  const request=(port,host)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:'/api/catalog',headers:{Host:host}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  for(const [options,host,expected] of [[{},'attacker.example',403],[{},'127.0.0.1',200],[{},'localhost',200],[{allowedHosts:['bom.internal.example']},'bom.internal.example',200],[{token:'pilot'},'attacker.example',401]]){
    const server=createServer({provider:createProvider({BOM_MODE:'demo'}),token:'',...options});server.listen(0,'127.0.0.1');await once(server,'listening');
    try{const port=server.address().port;assert.equal(await request(port,host.includes(':')?host:`${host}:${port}`),expected,`${host} ${JSON.stringify(options)}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
  }
});

test('F9 CSV rows identify the comparison, each occurrence and its explanation status',async()=>{
  const p=createProvider({BOM_MODE:'demo'}),r=compareSnapshots(await p.get('ebom-rA'),await p.get('abom-sn120'));
  const lines=toCsv(r).replace(/^﻿/,'').split('\r\n'),head=lines[0];
  for(const col of ['Explanation','Occurrence A','Occurrence B','Canonical key A','Canonical key B','Baseline snapshot','Comparison snapshot','Baseline SHA-256','Comparison SHA-256'])assert.ok(head.includes(`"${col}"`),col);
  const valve=lines.find(l=>l.includes('"valve-ox"'));assert.ok(valve.includes('"Explained"'));assert.ok(valve.includes('"ebom-rA"')&&valve.includes('"abom-sn120"'));assert.ok(valve.includes(r.left.fingerprint));
});

test('F13 a canonical key reused for an unrelated part is flagged for review, not silently trusted',()=>{
  const a=snap([n('r',null,'ROOT'),n('sa','r','SA',{occurrenceKey:'sa'}),n('sb','r','SB',{occurrenceKey:'sb'}),n('v','sa','VALVE',{occurrenceKey:'k7'})]);
  const b=snap([n('r',null,'ROOT'),n('sa','r','SA',{occurrenceKey:'sa'}),n('sb','r','SB',{occurrenceKey:'sb'}),n('v2','sa','VALVE',{occurrenceKey:'k9'}),n('br','sb','BRACKET',{occurrenceKey:'k7'})]);
  const x=row(compareSnapshots(a,b),'v');assert.equal(x.right.id,'br','canonical pairing is kept');assert.equal(x.uncertain,true);assert.match(x.correspondence,/reused/);
  // A genuine keyed replacement with no leftover original part is not flagged.
  const c=snap([n('r',null,'ROOT'),n('sa','r','SA',{occurrenceKey:'sa'}),n('sb','r','SB',{occurrenceKey:'sb'}),n('br','sb','BRACKET',{occurrenceKey:'k7'})]);
  assert.equal(row(compareSnapshots(a,c),'v').uncertain,false);
});

test('F14 a revision bump on the same occurrence is not reported as a designator reassignment',async()=>{
  const p=createProvider({BOM_MODE:'demo'}),r=compareSnapshots(await p.get('ebom-rA'),await p.get('abom-sn120'));
  const status=ref=>r.referenceDesignators.find(x=>x.ref===ref).status;
  assert.equal(status('PT-101'),'Revised');assert.equal(status('ECU-01'),'Revised');assert.equal(status('V-OX-01'),'Reassigned');assert.equal(r.summary.referenceChanges,6);
});

// Invariance guard (passes before and after the fixes): substantive results must not depend on input order.
test('input order never changes the substantive result',async()=>{
  let seed=11;const rand=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  const mix=s=>({...s,nodes:shuffle(s.nodes).map(x=>({...x,refDes:shuffle(x.refDes),records:shuffle(x.records)}))});
  const substance=r=>JSON.stringify({s:r.summary,w:[...r.warnings].sort(),rows:r.rows.map(x=>JSON.stringify([x.left?.id??null,x.right?.id??null,[...x.changes].sort(),x.uncertain,x.explained,x.matchMethod,x.explanation?.status])).sort(),refs:r.referenceDesignators.map(x=>[x.ref,x.status,x.duplicate])});
  const p=createProvider({BOM_MODE:'demo'}),demo=await Promise.all((await p.list()).map(s=>p.get(s.id)));
  const pairs=[];for(const a of demo)for(const b of demo)pairs.push([a,b]);
  const reps=snap([n('r',null,'ROOT'),n('s1','r','SUB'),n('s2','r','SUB'),n('x1','s1','BOLT'),n('x2','s2','BOLT'),n('z1','r','BOLT'),n('z2','r','BOLT'),n('q','r','RES',{refDes:['R1','R2']})]);
  const reps2=structuredClone(reps);reps2.nodes.find(x=>x.id==='x2').revision='B';reps2.nodes.find(x=>x.id==='q').refDes=['R2','R3'];
  pairs.push([reps,reps2],[reps2,reps]);
  for(const [a,b] of pairs){const base=substance(compareSnapshots(a,b));for(let k=0;k<3;k++)assert.equal(substance(compareSnapshots(mix(a),mix(b))),base,`${a.id} -> ${b.id}`);}
});
