import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { compareSnapshots } from '../src/compare.js';
import { validateHeader, validateSnapshot } from '../src/model.js';
import { createServer } from '../src/server.js';
import { filterRows } from '../public/format.js';

const node=(id,parentId,partNumber='PART',extra={})=>({id,parentId,partNumber,name:partNumber,revision:'A',quantity:1,unit:'EA',refDes:[],records:[],...extra});
const snapshot=(nodes,extra={})=>({id:'test',name:'Test',partNumber:'ROOT',revision:'A',source:'Test',type:'eBOM',releaseStatus:'Released',configuration:'All units',capturedAt:'2026-10-09T12:00:00Z',synthetic:true,nodes,...extra});
const record=(extra={})=>({id:'NC-1',type:'NC',source:'QMS',status:'Closed',summary:'Synthetic',relationship:'explains',changes:['Quantity'],...extra});
const basic=()=>snapshot([node('root',null,'ROOT'),node('p','root','PART',{occurrenceKey:'p'})]);

test('T1 keyed descendants anchor otherwise identical keyless parent assemblies',()=>{
  const a=snapshot([node('r',null,'ROOT'),node('a1','r','SUB'),node('a2','r','SUB'),node('left','a1','BOLT',{occurrenceKey:'left'}),node('right','a2','BOLT',{occurrenceKey:'right'})]);
  const b=snapshot([node('r',null,'ROOT'),node('b1','r','SUB'),node('b2','r','SUB'),node('right2','b1','BOLT',{occurrenceKey:'right'}),node('left2','b2','BOLT',{occurrenceKey:'left'})]);
  const r=compareSnapshots(a,b);
  assert.equal(r.summary.changed,0);assert.equal(r.rows.find(x=>x.left?.id==='a1').right.id,'b2');
  assert.equal(compareSnapshots(b,a).summary.changed,0);
});

test('T2 duplicate reference assignments compare each mapped occurrence, not aggregate sets',()=>{
  const a=snapshot([node('r',null,'ROOT'),node('x','r','P1',{occurrenceKey:'x',refDes:['R1']}),node('y','r','P2',{occurrenceKey:'y',refDes:['R1']})]);
  const b=structuredClone(a);[b.nodes[1].partNumber,b.nodes[2].partNumber]=['P2','P1'];
  assert.equal(compareSnapshots(a,b).referenceDesignators[0].status,'Reassigned');
  a.nodes[1].revision='B';a.nodes[2].revision='C';const c=structuredClone(a);[c.nodes[1].revision,c.nodes[2].revision]=['C','B'];
  assert.equal(compareSnapshots(a,c).referenceDesignators[0].status,'Revised');
  const d=basic(),e=basic();Object.assign(d.nodes[1],{partNumber:'A@B',revision:'C',refDes:['R1']});Object.assign(e.nodes[1],{partNumber:'A',revision:'B@C',refDes:['R1']});
  assert.equal(compareSnapshots(d,e).referenceDesignators[0].status,'Reassigned');
});

test('T3 explanatory record must match its own snapshot serial, not the opposite side',()=>{
  const a={...basic(),type:'aBOM',serialNumber:'SN100'},b={...basic(),type:'aBOM',serialNumber:'SN120'};
  b.nodes[1].quantity=2;b.nodes[1].records=[record({serialNumber:'SN100'})];
  const r=compareSnapshots(a,b),p=r.rows.find(r=>r.left?.id==='p');
  assert.equal(p.explained,false);assert.match(p.evidence[0].excludedReason,/SN100/);
  b.nodes[1].records[0].serialNumber='SN120';assert.equal(compareSnapshots(a,b).summary.explained,1);
});

test('T4 uncertain parent matches cannot certify descendants or remove them from review',()=>{
  const a=snapshot([node('r',null,'ROOT'),node('s1','r','SUB1',{refDes:['S1']}),node('s2','r','SUB2',{refDes:['S2']}),node('c1','s1','BOLT'),node('c2','s2','BOLT')]);
  const b=structuredClone(a);b.nodes[1].refDes=['S2'];b.nodes[2].refDes=['S1'];
  b.nodes[1].records=[record({changes:['Replaced','Description']})];
  b.nodes[3].quantity=2;b.nodes[3].records=[record()];
  const r=compareSnapshots(a,b),child=r.rows.find(x=>x.right?.id==='c1');
  assert.equal(child.uncertain,true);assert.equal(child.explained,false);assert.equal(r.rows.find(x=>x.right?.id==='s1').explained,false);
  assert.ok(filterRows(r,{needsReview:true}).some(x=>x.id===child.id));
  const unchangedChild=r.rows.find(x=>x.right?.id==='c2');assert.ok(filterRows(r,{needsReview:true}).some(x=>x.id===unchangedChild.id));
});

test('T5 duplicate source record identities are rejected instead of making evidence depend on order',()=>{
  const s=basic();s.nodes[1].records=[record(),record({status:'Open'})];
  assert.throws(()=>validateSnapshot(s),/Duplicate.*record/);
});

test('T6 live snapshots require a declared source count; synthetic fixtures may omit it',()=>{
  const s={...basic(),synthetic:false};assert.throws(()=>validateSnapshot(s),/nodeCount/);assert.throws(()=>validateHeader(s),/nodeCount/);
  validateSnapshot({...s,nodeCount:2});validateSnapshot(basic());
});

test('T7 self-comparison reads one source version even when the provider is mutable',async()=>{
  let calls=0;
  const server=createServer({token:'',provider:{mode:'test',get:async()=>{const s=basic();s.nodes[1].quantity=++calls;return s;}}});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/compare`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leftId:'test',rightId:'test'})});
    assert.equal(response.status,200);const r=await response.json();assert.equal(calls,1);assert.equal(r.summary.changed,0);assert.equal(r.left.fingerprint,r.right.fingerprint);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('parent-queue matching preserves coverage, self-comparison, direction symmetry and input-order invariance',()=>{
  let seed=781;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32),pick=n=>Math.floor(random()*n);
  const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=pick(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
  const substantive=r=>JSON.stringify({summary:r.summary,rows:r.rows.map(x=>JSON.stringify([x.left?.id,x.right?.id,x.changes,x.uncertain,x.explained])).sort(),refs:r.referenceDesignators.map(x=>[x.ref,x.status])});
  for(let run=0;run<150;run++){
    const a=snapshot([node('root',null,'ROOT')]);
    for(let i=1;i<45;i++)a.nodes.push(node(`n${i}`,a.nodes[pick(i)].id,`PN-${pick(7)}`,{...(random()<.5?{occurrenceKey:`k${i}`}:{})}));
    const b=structuredClone(a);
    for(let i=0;i<5;i++){const n=b.nodes[1+pick(44)];if(i%3===0)n.quantity+=1;else if(i%3===1)n.revision='B';else n.partNumber=`ALT-${pick(4)}`;}
    const r=compareSnapshots(a,b),reverse=compareSnapshots(b,a);
    assert.equal(r.rows.filter(x=>x.left).length,a.nodes.length);assert.equal(r.rows.filter(x=>x.right).length,b.nodes.length);
    assert.equal(compareSnapshots(a,a).summary.changed,0);assert.equal(r.summary.changed,reverse.summary.changed);assert.equal(r.summary.unresolved,reverse.summary.unresolved);
    assert.equal(substantive(r),substantive(compareSnapshots({...a,nodes:shuffle(a.nodes)},{...b,nodes:shuffle(b.nodes)})));
  }
});
