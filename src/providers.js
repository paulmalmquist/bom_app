import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, validateHeader, validateSnapshot, ValidationError } from './model.js';

export class ProviderError extends Error {}
const demoDirectory=fileURLToPath(new URL('../data/demo/',import.meta.url));
export function createProvider(env=process.env) {
  const mode=env.BOM_MODE||'demo';
  if(!['demo','directory','gateway'].includes(mode)) throw new Error('BOM_MODE must be demo, directory or gateway');
  if(mode==='gateway') {
    let url;
    try { url=new URL(env.BOM_GATEWAY_URL); } catch { throw new Error('BOM_GATEWAY_URL is required for gateway mode'); }
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw new Error('Gateway must use HTTPS without URL credentials, query or fragment');
    const base=url.href.replace(/\/$/,'');
    const get=async path=>{
      try {
        const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...(env.BOM_GATEWAY_TOKEN?{Authorization:`Bearer ${env.BOM_GATEWAY_TOKEN}`}:{})}});
        if(!response.ok) throw new ProviderError(`Gateway returned HTTP ${response.status}`);
        let size=0; const chunks=[];
        for await (const chunk of response.body) { size+=chunk.length; if(size>25_000_000){await response.body.cancel().catch(()=>{});throw new ProviderError('Gateway response exceeds 25 MB');} chunks.push(chunk); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch(e) { if(e instanceof ProviderError)throw e; throw new ProviderError('Gateway request failed or returned invalid JSON. Check server connectivity and source authorization.'); }
    };
    return {
      mode, label:'Internal BOM gateway',
      async list(){ const data=await get('/boms'); if(!Array.isArray(data)||data.length>5000)throw new ProviderError('Gateway catalog must be an array with at most 5,000 snapshots'); return checkCatalog(data.map(validateHeader)); },
      async get(id){ const s=validateSnapshot(await get(`/boms/${encodeURIComponent(id)}`)); if(s.id!==id)throw new ProviderError('Gateway returned the wrong snapshot id');return s; },
    };
  }
  const directory=mode==='demo'?demoDirectory:env.BOM_DATA_DIR;
  if(!directory)throw new Error('BOM_DATA_DIR is required in directory mode');
  async function all(){
    let files;
    try { files=(await readdir(directory)).filter(f=>f.endsWith('.json')).sort(); } catch { throw new ProviderError('Snapshot directory is unavailable'); }
    if(files.length>5000)throw new ProviderError('Catalog exceeds 5,000 snapshots');
    const snapshots=await Promise.all(files.map(async file=>validateSnapshot(JSON.parse(await readFile(resolve(directory,file),'utf8')))));
    checkCatalog(snapshots);return snapshots;
  }
  return {mode,label:mode==='demo'?'Synthetic demo catalog':'Service-populated snapshot directory',
    async list(){return (await all()).map(header);},
    async get(id){const s=(await all()).find(s=>s.id===id);if(!s)throw new ValidationError('Snapshot not found');return s;},
  };
}
function checkCatalog(items){
  const ids=new Set();for(const item of items){if(ids.has(item.id))throw new ProviderError(`Duplicate catalog snapshot id: ${item.id}`);ids.add(item.id);}return items;
}
