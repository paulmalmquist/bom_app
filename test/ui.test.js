// Script-level interaction smoke test. This deliberately does not claim browser/layout QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createProvider } from '../src/providers.js';
import { compareSnapshots } from '../src/compare.js';
import { esc,toCsv,filterRows } from '../public/format.js';

test('UI bootstraps, switches views, filters, swaps, opens evidence and restores history',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const code=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/,'');
  const elements=new Map(),listeners=new Map();
  class Element{
    constructor(id){this.id=id;this.value='';this.checked=['changes-only'].includes(id);this.hidden=false;this.disabled=false;this.open=false;this.dataset={};this.classList={toggle(){},add(){},remove(){}};}
    set innerHTML(s){this._html=s;for(const [,id]of s.matchAll(/\bid="([^"]+)"/g))if(!elements.has(id))elements.set(id,new Element(id));}
    get innerHTML(){return this._html||'';}
    setAttribute(){} showModal(){this.open=true;} close(){this.open=false;} scrollIntoView(){} click(){}
  }
  for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))elements.set(id,new Element(id));
  const provider=createProvider({BOM_MODE:'demo'});
  const context={esc,toCsv,filterRows,console,URL,Blob,matchMedia:()=>({matches:true}),setTimeout:()=>1,clearTimeout(){},
    document:{getElementById:id=>{assert.ok(elements.has(id),`Missing element ${id}`);return elements.get(id);},addEventListener:(name,fn)=>listeners.set(name,fn),createElement:()=>new Element('download')},
    fetch:async(path,options)=>({ok:true,status:200,json:async()=>{
      if(path==='/api/catalog')return {mode:'demo',provider:'Synthetic demo catalog',loadedAt:new Date().toISOString(),snapshots:await provider.list()};
      const body=JSON.parse(options.body);return compareSnapshots(await provider.get(body.leftId),await provider.get(body.rightId));
    }}),
  };
  await runInNewContext(`(async()=>{${code}\n})()`,context);
  const e=id=>elements.get(id);
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
