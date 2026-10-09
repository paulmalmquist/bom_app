import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createProvider, ProviderError } from './providers.js';
import { compareSnapshots } from './compare.js';
import { toCsv } from '../public/format.js';
import { ValidationError } from './model.js';

const staticFiles=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/format.js',['format.js','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
  ['/favicon.svg',['favicon.svg','image/svg+xml']],
]);
function authorized(req,token){
  if(!token)return true;
  const provided=Buffer.from(req.headers.authorization||'');const expected=Buffer.from(`Bearer ${token}`);
  return provided.length===expected.length&&timingSafeEqual(provided,expected);
}
async function body(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new ValidationError('Content-Type must be application/json');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>10000)throw new ValidationError('Request exceeds 10 KB');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ValidationError('Invalid JSON body');}
}
const loopbackHosts=new Set(['127.0.0.1','localhost','[::1]']);
const envHosts=()=>(process.env.BOM_ALLOWED_HOSTS||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
// Without an app token the service relies on loopback binding. A browser on this machine can still be pointed at it
// through DNS rebinding, so the Host header must name loopback or an explicitly allowed internal hostname.
function hostAllowed(req,allowedHosts){
  let host;try{host=new URL(`http://${req.headers.host||''}`).hostname.toLowerCase();}catch{return false;}
  return loopbackHosts.has(host)||allowedHosts.includes(host);
}
export function createServer({provider=createProvider(),token=process.env.BOM_APP_TOKEN||'',allowedHosts=envHosts()}={}) {
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    res.setHeader('Cache-Control','no-store');
    const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/healthz')return send(200,{status:'ok'});
      if(req.method==='GET'&&staticFiles.has(url.pathname)){
        const[file,type]=staticFiles.get(url.pathname);return send(200,await readFile(new URL(`../public/${file}`,import.meta.url)),type);
      }
      if(!url.pathname.startsWith('/api/'))return send(404,{error:'Not found'});
      if(!token&&!hostAllowed(req,allowedHosts))return send(403,{error:'Host not allowed. Use a loopback address, set BOM_ALLOWED_HOSTS, or configure BOM_APP_TOKEN.'});
      if(!authorized(req,token))return send(401,{error:'Enter the application access token to continue'});
      if(req.method==='GET'&&url.pathname==='/api/catalog'){
        const snapshots=await provider.list();
        return send(200,{mode:provider.mode,provider:provider.label,loadedAt:new Date().toISOString(),snapshots});
      }
      if(req.method==='POST'&&['/api/compare','/api/export'].includes(url.pathname)){
        const data=await body(req);
        if(!data||typeof data!=='object'||Array.isArray(data))throw new ValidationError('Request must be an object');
        for(const key of ['leftId','rightId'])if(typeof data[key]!=='string'||!/^[a-zA-Z0-9_.:-]{1,500}$/.test(data[key]))throw new ValidationError(`${key} must identify a catalog snapshot`);
        // A same-id comparison must use one captured version even if the source behind that id is mutable.
        const first=provider.get(data.leftId);
        const [a,b]=await Promise.all([first,data.leftId===data.rightId?first:provider.get(data.rightId)]);
        const report=compareSnapshots(a,b);
        if(url.pathname==='/api/export') {
          // Exporting via this endpoint recomputes from sources. UI exports its exact displayed report.
          res.setHeader('Content-Disposition','attachment; filename="bom-comparison.csv"');return send(200,toCsv(report),'text/csv; charset=utf-8');
        }
        return send(200,report);
      }
      return send(404,{error:'Unknown API endpoint or method'});
    } catch(e){
      if(e instanceof ValidationError)return send(400,{error:e.message});
      if(e instanceof ProviderError)return send(502,{error:e.message});
      console.error('BOM request failed:',e.name);return send(500,{error:'The source could not be read. Check the server configuration and snapshot schema.'});
    }
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL(`file://${process.argv[1]}`))){
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);
  if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.BOM_APP_TOKEN)throw new Error('BOM_APP_TOKEN is required when binding beyond loopback');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const server=createServer();server.requestTimeout=20000;server.headersTimeout=15000;
  server.listen(port,host,()=>console.log(`BOM Compare · http://${host}:${port} · ${process.env.BOM_MODE||'demo'} mode`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
