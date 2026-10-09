import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';
import { createProvider, ProviderError } from '../src/providers.js';
import { toCsv } from '../public/format.js';

async function withServer(fn,options={}){
  const server=createServer({provider:createProvider({BOM_MODE:'demo'}),token:'',...options});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('complete catalog → compare → export flow and required frontend assets',async()=>withServer(async base=>{
  for(const path of ['/','/app.js','/format.js','/style.css','/favicon.svg']){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.ok(r.headers.get('content-security-policy'));}
  const catalog=await(await fetch(base+'/api/catalog')).json();assert.equal(catalog.snapshots.length,6);assert.equal(catalog.mode,'demo');
  const args={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leftId:'ebom-rA',rightId:'abom-sn120'})};
  const response=await fetch(base+'/api/compare',args);assert.equal(response.status,200);const report=await response.json();assert.equal(report.summary.changed,8);
  const csv=await(await fetch(base+'/api/export',args)).text();assert.equal(csv.replace(/^\uFEFF/,''),toCsv(report).replace(/^\uFEFF/,''));
  for(const body of [null,[],{leftId:'../.env',rightId:'abom-sn120'},{leftId:'missing',rightId:'abom-sn120'}]){const r=await fetch(base+'/api/compare',{...args,body:JSON.stringify(body)});assert.equal(r.status,400);}
  assert.equal((await fetch(base+'/api/compare',{method:'POST',body:'bad'})).status,400);assert.equal((await fetch(base+'/.env')).status,404);
}));
test('application token protects API without leaking through the public shell',async()=>withServer(async base=>{
  assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/api/catalog')).status,401);
  assert.equal((await fetch(base+'/api/catalog',{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(base+'/api/catalog',{headers:{Authorization:'Bearer test-only-token'}})).status,200);
},{token:'test-only-token'}));
test('provider failure surfaces honestly as a 502 without demo fallback',async()=>withServer(async base=>{
  const response=await fetch(base+'/api/catalog');assert.equal(response.status,502);assert.equal((await response.json()).error,'Gateway unavailable');
},{provider:{mode:'gateway',label:'Gateway',list:async()=>{throw new ProviderError('Gateway unavailable');}}}));
test('gateway validates transport, forwards server credential and refreshes per call',async t=>{
  assert.throws(()=>createProvider({BOM_MODE:'gateway',BOM_GATEWAY_URL:'http://example.test'}));assert.throws(()=>createProvider({BOM_MODE:'other'}));
  const demo=createProvider({BOM_MODE:'demo'}),snap=await demo.get('ebom-rA'),catalog=await demo.list(),calls=[];
  t.mock.method(globalThis,'fetch',async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(url.endsWith('/boms')?catalog:snap));});
  const p=createProvider({BOM_MODE:'gateway',BOM_GATEWAY_URL:'https://internal.example/api/',BOM_GATEWAY_TOKEN:'server-only'});
  assert.equal((await p.list()).length,6);assert.equal((await p.get('ebom-rA')).id,'ebom-rA');await p.get('ebom-rA');assert.equal(calls.length,3);assert.equal(calls[1].url,'https://internal.example/api/boms/ebom-rA');assert.equal(calls[1].opts.headers.Authorization,'Bearer server-only');assert.equal(calls[1].opts.redirect,'error');
});
test('gateway rejects wrong snapshot identity and malformed catalog',async t=>{
  const demo=createProvider({BOM_MODE:'demo'}),snap=await demo.get('ebom-rA');
  t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify(url.endsWith('/boms')?{}:snap)));
  const p=createProvider({BOM_MODE:'gateway',BOM_GATEWAY_URL:'https://internal.example'});await assert.rejects(p.list(),/catalog/);await assert.rejects(p.get('another-snapshot'),/wrong snapshot/);
});
