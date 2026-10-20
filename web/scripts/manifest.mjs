import {readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const root=resolve('../dist');
const config=JSON.parse(readFileSync(resolve(root,'imd-deployment.json'),'utf8'));
function files(dir){return readdirSync(dir).sort().flatMap(name=>{const path=resolve(dir,name),s=lstatSync(path);if(s.isSymbolicLink())throw Error('Export cannot contain symlinks');return s.isDirectory()?files(path):[path];});}
let total=0;
config.assets=files(root).filter(path=>relative(root,path)!=='imd-deployment.json').map(file=>{const bytes=readFileSync(file);if(bytes.length>8388608)throw Error('Export file exceeds 8 MiB');total+=bytes.length;return {path:relative(root,file).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex')};});
if(config.assets.length>128||total>24*1024*1024)throw Error('Export exceeds verification budget');
writeFileSync(resolve(root,'imd-deployment.json'),JSON.stringify(config,null,2)+'\n');
console.log(`Deployment manifest: ${config.assets.length} assets, ${total.toLocaleString('en-US')} bytes; all SHA-256 hashes recorded.`);
