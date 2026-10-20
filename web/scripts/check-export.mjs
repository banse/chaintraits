import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {keccak256,toHex} from 'viem';
import assert from 'node:assert/strict';
const root=resolve('../dist'),read=path=>JSON.parse(readFileSync(path,'utf8'));
const config=read(resolve(root,'imd-deployment.json')),handoff=read('deployment-handoff.json'),network=read('network.json');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const expectedKeys=['version','launchId','chainId','sourceCommit','attestationHash','contracts','assets',...Object.keys(network),...(handoff.poolKey?['poolKey']:[])];assert.deepEqual(Object.keys(config).sort(),expectedKeys.sort());
for(const key of ['launchId','chainId','sourceCommit','attestationHash'])assert.equal(config[key],handoff[key]);assert.equal(config.version,1);
for(const [key,value] of Object.entries(network))assert.deepEqual(config[key],value);
if(handoff.poolKey)assert.deepEqual(config.poolKey,handoff.poolKey);
assert.deepEqual(config.contracts.map(({name,address,abiHash})=>({name,address,abiHash})),handoff.contracts.map(({name,address,abiHash})=>({name,address,abiHash})));
const valid=path=>typeof path==='string'&&!path.startsWith('/')&&!path.includes('..')&&!path.includes(':')&&!path.includes('\\');
function files(dir){return readdirSync(dir).sort().flatMap(name=>{const p=resolve(dir,name),s=lstatSync(p);assert(!s.isSymbolicLink());return s.isDirectory()?files(p):[relative(root,p).replaceAll('\\','/')];});}
const exported=files(root).filter(path=>path!=='imd-deployment.json');assert.deepEqual(config.assets.map(a=>a.path).sort(),exported.sort());assert(config.assets.length<=128);
let total=0;
for(const a of config.assets){assert(valid(a.path));assert(/^[a-f0-9]{64}$/.test(a.sha256));const bytes=readFileSync(resolve(root,a.path));assert(bytes.length<=8388608);total+=bytes.length;assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256,`${a.path} hash`);}
for(const c of config.contracts){assert(valid(c.abiPath));const abi=read(resolve(root,c.abiPath));assert.equal(keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2),c.abiHash);}
assert(total<24*1024*1024);const html=readFileSync(resolve(root,'index.html'),'utf8');assert(!/(?:src|href)="\//.test(html));assert(html.includes('og:image')&&html.includes('name="description"')&&html.includes('rel="icon"'));
console.log(`PASS: exact handoff/network, ${config.contracts.length} attested ABIs, ${config.assets.length} asset hashes, ${total.toLocaleString('en-US')} exported bytes, relative entrypoint assets.`);
