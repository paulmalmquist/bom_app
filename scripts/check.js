import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const dir of ['src','public','scripts','test'])for(const f of await readdir(dir))if(/\.m?js$/.test(f)){
  const result=spawnSync(process.execPath,['--check',`${dir}/${f}`],{stdio:'inherit'});if(result.status)process.exit(result.status);
}
console.log('JavaScript syntax checks passed');
