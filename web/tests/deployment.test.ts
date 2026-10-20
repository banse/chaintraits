import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {encodeFunctionData,decodeFunctionData,type Abi} from 'viem';
import {A,registryAbi,deployment,abiHash,configureRuntime,type Deployment} from '../src/config';
import {CATALOG} from '../src/catalog';
import {poolGuard,type Context} from '../src/eligibility';
import {BURN_REASONS,newJournal,validateIntent} from '../src/flow';
import {OPEN_IN} from '../src/open-in';
const json=(path:string)=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));

test('deployed contract set, canonical implementation ABIs and network match the attested handoff',()=>{
 const handoff=json('../deployment-handoff.json');const network=json('../network.json');
 assert.deepEqual(deployment.network,network.network);assert.deepEqual(deployment.walletAddChain,network.walletAddChain);
 for(const key of ['launchId','chainId','sourceCommit','attestationHash'])assert.equal((deployment as unknown as Record<string,unknown>)[key],handoff[key]);
 assert.deepEqual(deployment.contracts.map(({name,address,abiHash})=>({name,address,abiHash})),handoff.contracts.map(({name,address,abiHash}:{name:string;address:string;abiHash:string})=>({name,address,abiHash})));
 for(const c of deployment.contracts){const source=json(`../../docs/abi/${c.name}.json`);assert.equal(abiHash(source),c.abiHash);assert.deepEqual(source,json(`../src/abi/${c.name}.json`));assert.deepEqual(source,json(`../public/${c.abiPath}`));}
});
test('a mismatched ABI cannot initialize the runtime configuration',()=>{
 const abis=Object.fromEntries(deployment.contracts.map(c=>[c.name,json(`../public/${c.abiPath}`)]));
 assert.throws(()=>configureRuntime(deployment,{...abis,Registry:[]} as Record<string,Abi>),/ABI differs/);
 configureRuntime(deployment,abis);
});
test('new pool and registration selectors pin maxPrice and expectedId',()=>{
 const cap=500000000000000000n;const data=encodeFunctionData({abi:registryAbi,functionName:'claimSponsored',args:[701,cap]});
 assert.deepEqual(decodeFunctionData({abi:registryAbi,data}).args,[701,cap]);
 assert(!registryAbi.some(x=>'name' in x&&x.name==='upgradeSponsored'));
 const spec=registryAbi.find(x=>x.type==='function'&&x.name==='registerSpec');assert(spec?.type==='function');assert.equal(spec.inputs[1].name,'expectedId');
});
test('pool guard accepts exact eighth/cap boundaries and rejects zero, excess and the ninth verified count',()=>{
 const E=10n**18n;const ctx=(price:bigint,pool:bigint,count=0):Context=>({connected:true,chainId:1,acknowledged:true,failed:false,reads:{pool:{joined:true,used:false,lastDay:0n,pool,price,verified:false,sponsoredVerified:count},verifiedIds:[],sharedVerified:false}});
 assert.deepEqual(poolGuard(ctx(E,8n*E),100n),{ok:true});assert.deepEqual(poolGuard(ctx(2n*E,16n*E),100n),{ok:true});
 for(const c of [ctx(E,8n*E-1n),ctx(2n*E+1n,100n*E),ctx(0n,8n*E),ctx(E,8n*E,9)])assert.equal(poolGuard(c,100n).ok,false);
});
test('every burn reason matches the deployed event meaning',()=>{assert.deepEqual(BURN_REASONS,{1:'preview unavailable or reverted',2:'amount below the burn minimum',3:'fee above the cap',4:'attachment below the fee, refunded; the request stands',5:'bridge reverted'});});
test('donation intent is exact and is bound to this launch',()=>{
 const amount=25n*10n**18n;const j=newJournal({key:'donation',label:'Donate',data:encodeFunctionData({abi:registryAbi,functionName:'sponsor',args:[amount]}),amount},'IMD');validateIntent(j);
 assert.throws(()=>validateIntent({...j,amount:String(amount+1n)}),/does not match/);assert.throws(()=>validateIntent({...j,deploymentId:'another-launch'}),/another deployment/);
});
test('Armed has no population cap; About contains the exact dated test-deployment note and no stale address leaks',()=>{
 const armed=CATALOG.find(t=>t.id===601)!;assert.equal(armed.rule,'held an IDMD seat when the card was minted');assert.equal(armed.population,'no fixed population');
 const pages=readFileSync(new URL('../src/pages.tsx',import.meta.url),'utf8');
 assert(pages.includes('An earlier deployment (Registry 0x39bec764…95a6, swarm launch #2147, 2026-10-18) was a test, never announced; this registry replaced it on 2026-10-20.'));
 assert.equal((pages.match(/39bec764/gi)??[]).length,1);
});
test('shipped card SVGs have no token-id text and match the live-render evidence',()=>{
 const evidence=json('../../docs/renderer-assets.json');
 for(const a of evidence.assets){const svg=readFileSync(new URL(`../../${a.file}`,import.meta.url),'utf8');assert(!/<text\b[^>]*>[^<]*#\d+/i.test(svg));assert.equal(createHash('sha256').update(svg).digest('hex'),a.sha256);}
 assert.equal(evidence.assets.length,27);
});
test('phone wallet links retain the complete page URL and hash',()=>{
 const url='https://sworn.example/ipfs/path/#/claim?trait=701';for(const link of OPEN_IN){const href=link.href(url);assert(href.startsWith('https://'));assert(decodeURIComponent(href).includes(url)||decodeURIComponent(href).includes(url.replace('https://','')));}
});
