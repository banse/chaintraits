import { readFileSync } from 'node:fs';
import { keccak256, toHex } from 'viem';
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const deployment=JSON.parse(readFileSync('public/data/launch-record.json','utf8'));
const addresses=JSON.parse(readFileSync('addresses.json','utf8'));
const runtime=JSON.parse(readFileSync('tests/fixtures/runtime.json','utf8'));
for(const contract of deployment.contracts){
 const abi=JSON.parse(readFileSync(`src/abi/${contract.name}.json`,'utf8'));
 const actual=keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2);
 if(actual!==contract.abiHash)throw Error(`${contract.name}: ABI hash mismatch`);
 if(keccak256(runtime[contract.name])!==addresses.runtimeHashes[contract.name])throw Error(`${contract.name}: runtime fixture mismatch`);
 console.log(`${contract.name}: launch ABI and runtime hashes match`);
}
