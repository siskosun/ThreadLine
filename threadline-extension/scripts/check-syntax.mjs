import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=path.resolve(new URL('..',import.meta.url).pathname);
let count=0;
function check(folder){
  for (const name of fs.readdirSync(folder)){
    const p=path.join(folder,name), stat=fs.statSync(p);
    if(stat.isDirectory()&&!['node_modules','.git'].includes(name))check(p);
    else if(name.endsWith('.js')||name.endsWith('.mjs')){execFileSync(process.execPath,['--check',p]);count++;}
  }
}
check(dir);console.log(`Syntax check passed: ${count} JavaScript files`);
