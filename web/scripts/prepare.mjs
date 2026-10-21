import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {keccak256,toHex} from 'viem';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const handoff=read('deployment-handoff.json'),network=read('network.json'),extra=read('dependencies.json');
const contracts=handoff.contracts.map(({name,address,abiHash})=>({name,address,abiHash,abiPath:`abi/${name}.json`}));
mkdirSync('public/abi',{recursive:true});mkdirSync('public/data',{recursive:true});
for(const c of contracts){
 const source=`../docs/abi/${c.name}.json`,abi=read(source);
 if(keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2)!==c.abiHash)throw Error(`${c.name} does not match attested ABI`);
 if(JSON.stringify(abi)!==JSON.stringify(read(`src/abi/${c.name}.json`)))throw Error(`${c.name} source ABI copy differs`);
 copyFileSync(source,`public/${c.abiPath}`);
}
const config={version:1,launchId:handoff.launchId,chainId:handoff.chainId,sourceCommit:handoff.sourceCommit,attestationHash:handoff.attestationHash,contracts,assets:[],...(handoff.poolKey?{poolKey:handoff.poolKey}:{}),...network};
writeFileSync('public/imd-deployment.json',JSON.stringify(config,null,2)+'\n');
// Compatibility downloads for existing integrators; the application never imports these.
const addresses={chainId:config.chainId,...Object.fromEntries(contracts.map(c=>[c.name,c.address])),...extra,publicRpcs:config.network.rpcUrls};
for(const path of ['addresses.json','public/data/addresses.json'])writeFileSync(path,JSON.stringify(addresses,null,2)+'\n');
writeFileSync('public/data/launch-record.json',JSON.stringify(handoff,null,2)+'\n');
console.log('Prepared attested deployment and three verified ABI files.');
