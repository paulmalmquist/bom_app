// Real-browser smoke test (headless Chromium via Playwright). Not part of `npm test`: the app has no
// third-party dependencies, so install Playwright separately and point to it if it is not resolvable:
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/browser-smoke.mjs [screenshot-dir]
// Uses only the synthetic demo catalog and in-process fake providers. Never point it at live data.
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from '../src/server.js';
import { createProvider, ProviderError } from '../src/providers.js';

const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.argv[2]||join(tmpdir(),'bom-browser-smoke');await mkdir(out,{recursive:true});
const results=[];const check=(name,ok,detail='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?'  · '+detail:''}`);};
async function serve(provider,token=''){const s=createServer({provider,token});s.listen(0,'127.0.0.1');await once(s,'listening');return {close:()=>{s.closeAllConnections();s.close();},base:`http://127.0.0.1:${s.address().port}`};}
const demo=createProvider({BOM_MODE:'demo'});
const browser=await chromium.launch();
try {
  { // Initial result, keyboard, explanation labels, history restore and export consistency.
    const {close,base}=await serve(demo);const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForSelector('#metrics .metric');
    const metrics=await page.$$eval('#metrics .metric-value',els=>els.map(e=>e.textContent.trim()));
    check('initial demo result: 8 changed, 4 explained, 6 reference changes',metrics[0].startsWith('8')&&metrics[1].startsWith('4')&&metrics[3]==='6',metrics.join(' | '));
    const labels=await page.$$eval('.record-indicator',els=>els.map(e=>e.textContent.trim()));
    check('record column distinguishes explained, related and unlinked',labels.includes('↗ DEMO-NC-1042')&&labels.includes('Related record')&&labels.includes('— Unlinked'),labels.join(' | '));
    await page.screenshot({path:`${out}/desktop.png`,fullPage:true});
    await page.focus('.part-link');await page.keyboard.press('Enter');const open=await page.$eval('#detail-dialog',d=>d.open);
    const detail=await page.$eval('#detail-content',d=>d.textContent);await page.keyboard.press('Escape');
    check('keyboard opens detail, Escape closes it',open&&await page.$eval('#detail-dialog',d=>!d.open));
    check('detail states explanation is not approval',/not an approval/.test(detail));
    await page.selectOption('#b-type','eBOM');await page.selectOption('#b-id','ebom-rB');
    check('selection change marks result stale',await page.$eval('#stale',e=>!e.hidden));
    await page.click('#compare');await page.waitForFunction(()=>document.querySelector('#run-context').textContent.includes('eBOM B'));
    await page.click('#nav-history');await page.click('[data-history="1"]');
    const ctx=await page.$eval('#run-context',e=>e.textContent);
    const [json]=await Promise.all([page.waitForEvent('download'),page.click('#export-json')]);const exported=JSON.parse(await readFile(await json.path(),'utf8'));
    const [csv]=await Promise.all([page.waitForEvent('download'),page.click('#export-csv')]);const csvText=await readFile(await csv.path(),'utf8');
    check('restored run, JSON and CSV exports describe the same comparison',ctx.includes('aBOM')&&exported.right.id==='abom-sn120'&&csvText.includes('"abom-sn120"')&&!csvText.includes('"ebom-rB"'),`context="${ctx}"`);
    check('no page errors',errors.length===0,errors.join('; '));
    await page.close();close();
  }
  { // In-flight selection change and failed re-compare.
    const {close,base}=await serve(demo);const page=await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(base);await page.waitForSelector('#metrics .metric');let mode='delay';
    await page.route('**/api/compare',async route=>{if(mode==='delay'){await new Promise(r=>setTimeout(r,800));return route.continue();}return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Gateway returned HTTP 503'})});});
    const pending=page.click('#compare');await page.waitForTimeout(100);await page.selectOption('#b-type','mBOM');await pending;await page.waitForFunction(()=>!document.querySelector('#compare').disabled);
    check('in-flight result for the old selection is marked stale',await page.$eval('#stale',e=>!e.hidden));
    await page.selectOption('#b-type','aBOM');await page.selectOption('#b-id','abom-sn120');mode='fail';await page.click('#compare');await page.waitForFunction(()=>!document.querySelector('#alert').hidden);
    const st=await page.evaluate(()=>({stale:!document.querySelector('#stale').hidden,text:document.querySelector('#stale').textContent}));
    check('failed re-compare marks prior result as not current',st.stale&&/failed/.test(st.text),st.text);
    await page.screenshot({path:`${out}/failed-recompare.png`});await page.close();close();
  }
  { // Source failure on load.
    const {close,base}=await serve({mode:'gateway',label:'Gateway',list:async()=>{throw new ProviderError('Gateway returned HTTP 503');},get:async()=>{throw new ProviderError('down');}});
    const page=await browser.newPage();await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#alert').hidden);
    const st=await page.evaluate(()=>({mode:document.querySelector('#mode-label').textContent,results:!document.querySelector('#results').hidden,compare:document.querySelector('#compare').disabled}));
    check('source failure: unavailable, no results, compare disabled, no demo fallback',st.mode==='Source unavailable'&&!st.results&&st.compare,JSON.stringify(st));
    await page.close();close();
  }
  { // Hostile source text and gateway-controlled catalog fields.
    const a=structuredClone(await demo.get('ebom-rA'));a.synthetic=false;a.name='<img src=x onerror="window.__pwned=1">Engine';a.nodes[2].name='<script>window.__pwned=2</script>';
    a.nodes[2].records=[{id:'NC-<b>1</b>',type:'NC',status:'Open',summary:'<a href="https://evil.example">click</a>',source:'QMS',relationship:'explains',url:'https://evil.example/x?"onmouseover="alert(1)'}];
    const b=structuredClone(a);b.id='other';b.nodes[2].revision='Z';
    const headers=[a,b].map(x=>{const {nodes,...h}=x;return {...h,nodeCount:'<a id="injected" href="https://evil.example">Re-enter your token</a>'};});
    const {close,base}=await serve({mode:'gateway',label:'Gateway',list:async()=>headers,get:async id=>id===a.id?a:b});
    const page=await browser.newPage();await page.goto(base);await page.waitForSelector('#side-a select');
    check('catalog fields cannot inject markup',!(await page.$('#injected')));
    await page.selectOption('#b-type','eBOM');await page.selectOption('#b-id','other');await page.click('#compare');await page.waitForSelector('.part-link');
    await page.click('.part-link');check('source text never executes script',await page.evaluate(()=>window.__pwned)===undefined);
    await page.close();close();
  }
  { // Narrow layout.
    const {close,base}=await serve(demo);const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(base);await page.waitForSelector('#metrics .metric');
    const o=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,vw:innerWidth}));check('390 px: no horizontal page overflow',o.doc<=o.vw,JSON.stringify(o));
    await page.screenshot({path:`${out}/mobile.png`,fullPage:true});await page.close();close();
  }
  { // Shared token handling.
    const {close,base}=await serve(demo,'smoke-only-token');const page=await browser.newPage();const urls=[];page.on('request',r=>urls.push(r.url()));
    await page.goto(base);await page.waitForSelector('#login-dialog[open]');await page.fill('#access-token','smoke-only-token');await page.click('#login-form button');await page.waitForSelector('#metrics .metric');
    const leaked=await page.evaluate(()=>[JSON.stringify(localStorage),JSON.stringify(sessionStorage),document.cookie].some(v=>v.includes('smoke-only')));
    check('token required and never stored or placed in URLs',!leaked&&!urls.some(u=>u.includes('smoke-only')));await page.close();close();
  }
} finally { await browser.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} browser checks passed · screenshots in ${out}`);
process.exitCode=results.every(Boolean)?0:1;
