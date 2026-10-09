// Script-level interaction smoke test. This deliberately does not claim browser/layout QA.
// Real-browser checks live in scripts/browser-smoke.mjs (requires Playwright; see RED_TEAM_REPORT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createProvider } from '../src/providers.js';
import { compareSnapshots } from '../src/compare.js';
import { esc,toCsv,filterRows,catalogDrift } from '../public/format.js';

const provider=createProvider({BOM_MODE:'demo'});
const demoApi=async(path,options)=>{
  if(path==='/api/catalog')return {mode:'demo',provider:'Synthetic demo catalog',loadedAt:new Date().toISOString(),snapshots:await provider.list()};
  const body=JSON.parse(options.body);return compareSnapshots(await provider.get(body.leftId),await provider.get(body.rightId));
};
async function bootUi(api=demoApi){
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const code=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/,'');
  const elements=new Map(),listeners=new Map(),calls=[];
  class Element{
    constructor(id){this.id=id;this.value='';this.checked=['changes-only'].includes(id);this.hidden=false;this.disabled=false;this.open=false;this.dataset={};this.textContent='';this.classList={toggle(){},add(){},remove(){}};}
    set innerHTML(s){this._html=s;for(const [,id]of s.matchAll(/\bid="([^"]+)"/g))if(!elements.has(id))elements.set(id,new Element(id));}
    get innerHTML(){return this._html||'';}
    setAttribute(){} showModal(){this.open=true;} close(){this.open=false;} scrollIntoView(){} click(){}
  }
  for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))elements.set(id,new Element(id));
  const context={esc,toCsv,filterRows,catalogDrift,console,URL,Blob,matchMedia:()=>({matches:true}),setTimeout:()=>1,clearTimeout(){},
    document:{getElementById:id=>{assert.ok(elements.has(id),`Missing element ${id}`);return elements.get(id);},addEventListener:(name,fn)=>listeners.set(name,fn),createElement:()=>new Element('download')},
    fetch:async(path,options)=>{calls.push(path);try{const data=await api(path,options);return {ok:true,status:200,json:async()=>data};}catch(e){return {ok:false,status:502,json:async()=>({error:e.message})};}},
  };
  await runInNewContext(`(async()=>{${code}\n})()`,context);
  return {e:id=>elements.get(id),listeners,calls};
}

test('UI bootstraps, switches views, filters, swaps, opens evidence and restores history',async()=>{
  const {e,listeners}=await bootUi();
  assert.equal(e('results').hidden,false);assert.match(e('metrics').innerHTML,/Changed occurrences/);assert.match(e('row-count').textContent,/8 occurrences/);assert.match(e('table-container').innerHTML,/DEMO-2110/);
  e('search').value='V-OX-01';e('search').oninput();assert.match(e('row-count').textContent,/1 occurrences/);
  e('clear-filters').onclick();e('tab-references').onclick();assert.match(e('table-container').innerHTML,/Reference/);assert.match(e('table-container').innerHTML,/TT-203/);
  e('tab-differences').onclick();e('swap').onclick();assert.equal(e('stale').hidden,false);await e('compare').onclick();assert.equal(e('stale').hidden,true);
  e('table-container').onclick({target:{closest:selector=>selector==='[data-row]'?{dataset:{row:'row-3'}}:null}});assert.equal(e('detail-dialog').open,true);assert.match(e('detail-content').innerHTML,/DEMO-NC-1042/);e('close-detail').onclick();assert.equal(e('detail-dialog').open,false);
  e('nav-history').onclick();assert.match(e('info-content').innerHTML,/data-history="1"/);
  e('info-content').onclick({target:{closest:()=>({dataset:{history:'1'}})}});assert.equal(e('stale').hidden,false);
  e('nav-sources').onclick();assert.match(e('info-content').innerHTML,/Synthetic demo/);e('nav-guide').onclick();assert.match(e('info-content').innerHTML,/Match occurrences/);
  assert.equal(listeners.has('change'),true);
});

test('F10 a failed re-compare marks the displayed result as not current',async()=>{
  let fail=false;const {e}=await bootUi(async(path,options)=>{if(fail&&path==='/api/compare')throw new Error('Gateway returned HTTP 503');return demoApi(path,options);});
  assert.equal(e('stale').hidden,true);fail=true;await e('compare').onclick();
  assert.equal(e('alert').hidden,false);assert.equal(e('stale').hidden,false,'prior result must not look current after a failed run');assert.match(e('stale').textContent,/failed/i);
  fail=false;await e('compare').onclick();assert.equal(e('stale').hidden,true);
});

test('F11 gateway-controlled catalog fields render as text and empty selections never call compare',async()=>{
  const {e,calls}=await bootUi(async(path,options)=>{
    if(path==='/api/catalog'){const data=await demoApi(path,options);data.snapshots=data.snapshots.filter(s=>s.type==='eBOM').map(s=>({...s,nodeCount:'<a id="injected">Re-enter your token</a>'}));return data;}
    return demoApi(path,options);
  });
  assert.doesNotMatch(e('side-a').innerHTML,/<a id="injected"/);assert.match(e('side-a').innerHTML,/&lt;a id=&quot;injected&quot;/);
  assert.equal(calls.filter(p=>p==='/api/compare').length,0,'side B has no aBOM snapshot in this catalog, so no request is sent');assert.equal(e('alert').hidden,true);
});

test('F12 explanation labels distinguish explained, partial, unscoped and related records',async()=>{
  const {e}=await bootUi(async(path,options)=>{
    const data=await demoApi(path,options);if(path!=='/api/compare')return data;
    const fastener=data.rows.find(r=>r.left?.id==='fastener');fastener.explained=false;fastener.explanation={status:'Partially explained',unexplained:['Quantity'],records:[]};
    return data;
  });
  const html=e('table-container').innerHTML;
  assert.match(html,/↗ DEMO-NC-1042/);assert.match(html,/Partially explained/);assert.match(html,/Related record/);
  assert.match(e('metrics').innerHTML,/every changed field/i);
});

test('a compared snapshot that differs from its selected catalog entry is called out',async()=>{
  const {e}=await bootUi(async(path,options)=>{const data=await demoApi(path,options);if(path==='/api/compare')data.right={...data.right,capturedAt:'2026-10-10T08:00:00Z',nodeCount:17};return data;});
  assert.match(e('warning-list').innerHTML,/abom-sn120 differs from its catalog entry/);assert.match(e('warning-list').innerHTML,/18 occurrences in catalog vs 17 compared/);
});

test('T8 a failed catalog refresh keeps comparison disabled after selection changes',async()=>{
  let fail=false;const {e,listeners}=await bootUi(async(path,options)=>{if(fail&&path==='/api/catalog')throw new Error('Source down');return demoApi(path,options);});
  fail=true;e('nav-sources').onclick();await e('refresh-sources').onclick();
  listeners.get('change')({target:{dataset:{side:'a',field:'id'},value:'ebom-rA'}});
  assert.equal(e('compare').disabled,true);assert.equal(e('stale').hidden,false);
});

test('T9 catalog drift covers serial/configuration changes and survives into the captured report',async()=>{
  let captured;const {e}=await bootUi(async(path,options)=>{const data=await demoApi(path,options);if(path==='/api/compare'){data.right={...data.right,serialNumber:'SN999',configuration:'Different configuration'};captured=data;}return data;});
  assert.match(e('warning-list').innerHTML,/SN999/);assert.match(e('warning-list').innerHTML,/Different configuration/);assert.ok(captured.warnings.some(w=>w.includes('SN999')),'captured JSON report retains the drift warning');
});

test('T10 snapshot option labels distinguish otherwise identical catalog entries',async()=>{
  const {e}=await bootUi(async(path,options)=>{const data=await demoApi(path,options);if(path==='/api/catalog')data.snapshots.push({...data.snapshots.find(s=>s.id==='ebom-rA'),id:'ebom-rA-history'});return data;});
  assert.match(e('side-a').innerHTML,/>[^<]*ebom-rA-history[^<]*<\/option>/);
});
