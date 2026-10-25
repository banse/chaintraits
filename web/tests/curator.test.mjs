import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCuratorSnapshot,filterCandidates,consumeFacts,gateSource,buildCuratorExport,formatWei,parseCuratorQuery,curatorDraftKey,readCuratorDraft} from '../src/curator-model.mjs';

const registry='0x0da2679000ea5380d1361cc3cca7d4e8c881f766';
const expected={chainId:1,registry,sourceCommit:'c4ff3238390fc51962fb67e86affc20cf418126e'};
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const row=(n,fields={})=>({address:address(n),tokenId:'0',owner:null,censusMember:true,directFacts:[101],verifiedFacts:[],historicalFacts:[101,1201],pendingFacts:[],checkedFacts:[101,601,1201,10001],unknownFacts:[],readStatus:'current',metrics:{hour:0,deposits:3,largestWei:'1000000000000000001',points:20,index:n},...fields});
const snapshot=()=>({...expected,mock:false,blockNumber:26250000,generatedAt:'2026-10-25T12:00:00Z',facts:[{id:101,name:'Spawned',kind:0,builtin:true},{id:601,name:'Swarmed',kind:6,builtin:true},{id:1201,name:'Top Weights',kind:3,builtin:true},{id:10001,name:'My fact',kind:4,builtin:false}],wallets:[row(1,{verifiedFacts:[601,10001]}),row(2,{pendingFacts:[601]}),row(3,{censusMember:false,directFacts:[],historicalFacts:[],verifiedFacts:[601],metrics:{hour:null,deposits:null,largestWei:null,points:null,index:null}})]});

test('snapshot is bound to current mainnet deployment and retains no-card/outside-census wallets',()=>{
 const s=validateCuratorSnapshot(snapshot(),expected);assert.equal(s.wallets.length,3);assert.equal(s.wallets[2].censusMember,false);assert.equal(s.wallets[0].tokenId,'0');
 for(const patch of [{mock:true},{registry:address(99)},{chainId:8453},{sourceCommit:'0'.repeat(40)}])assert.throws(()=>validateCuratorSnapshot({...snapshot(),...patch},expected),/deployment|synthetic/);
 assert.throws(()=>validateCuratorSnapshot({...snapshot(),wallets:[row(1),row(1)]},expected),/duplicate/i);
});
test('current mode selects accepted community and 601 without cards, never pending or historical',()=>{
 const s=snapshot();assert.deepEqual(filterCandidates(s,{selected:{601:1}}).map(r=>r.address),[address(1),address(3)]);
 assert.equal(filterCandidates(s,{selected:{10001:1}}).length,1);
 assert.equal(filterCandidates(s,{selected:{1201:1}}).length,0);
 assert.equal(filterCandidates(s,{selected:{1201:1},mode:'historical'}).length,2);
});
test('OR/AND membership and weight sums include zero weight; malformed weights fail closed',()=>{
 const s=snapshot();assert.deepEqual(filterCandidates(s,{selected:{101:2,601:3}}).map(r=>r.weight),[5,2,3]);
 assert.deepEqual(filterCandidates(s,{selected:{101:2,601:0},match:'all'}).map(r=>r.weight),[2]);
 for(const selected of [{601:1.2},{601:-1},{601:Number.NaN},{999:1}])assert.throws(()=>filterCandidates(s,{selected}),/weight|fact/i);
});
test('inclusive wei ranges remain exact; missing historical metrics are unknown and excluded only by a bound',()=>{
 const s=snapshot();assert.equal(filterCandidates(s,{}).length,3);
 assert.equal(filterCandidates(s,{ranges:{largestWei:{min:'1.000000000000000001',max:'1.000000000000000001'}}}).length,2);
 assert.equal(filterCandidates(s,{ranges:{largestWei:{max:'1'}}}).length,0);
 for(const ranges of [{points:{min:'3',max:'2'}},{hour:{min:'-1'}},{largestWei:{max:'0.0000000000000000001'}}])assert.throws(()=>filterCandidates(s,{ranges}),/range|decimal|minimum|number/i);
 assert.equal(formatWei('1000000000000000001'),'1.000000000000000001');
 assert.equal(formatWei(null),'Unknown');
});
test('consumer distinguishes unknown, unsatisfied, pending and accepted facts without checking tokens',()=>{
 const s=snapshot();assert.equal(consumeFacts(s,address(1),[10001],'all').status,'eligible');
 assert.equal(consumeFacts(s,address(2),[601],'all').status,'not-eligible');
 assert.equal(consumeFacts(s,address(2),[601],'all').facts[0].state,'pending');
 assert.equal(consumeFacts(s,address(3),[601],'all').status,'eligible');
 assert.equal(consumeFacts(s,address(99),[601],'all').status,'unknown');
 assert.equal(consumeFacts(s,address(1),[],'any').status,'no-rule');
 assert.throws(()=>consumeFacts(s,'nonsense',[601],'any'),/address/i);
});
test('consumer code pins current registry and supports community AND/OR but no token/weight/range gate',()=>{
 const all=gateSource(expected,[601,10001],'all');assert.match(all,/hasTrait\(wallet, 601\) && registry.hasTrait\(wallet, 10001\)/);assert.match(all,new RegExp(registry.slice(2),'i'));assert.doesNotMatch(all,/ownerOf|tokenOf|balanceOf/);
 assert.match(gateSource(expected,[101,601],'any'),/\|\|/);assert.match(gateSource(expected,[],'any'),/return false/);
});
test('generated contract uses the delivered uint16 selector and rejects out-of-range IDs',()=>{
 assert.match(gateSource(expected,[10001]),/hasTrait\(address wallet, uint16 id\)/);
 for(const id of [0,65536,1.2])assert.throws(()=>gateSource(expected,[id]),/fact rule/);
 assert.throws(()=>validateCuratorSnapshot({...snapshot(),facts:[{id:65536,name:'Too large',kind:4,builtin:false}]},expected),/fact definition/);
});
test('exports preserve full selection, exact amount, provenance and explicit read/history labels',async()=>{
 const s=snapshot();s.wallets=Array.from({length:75},(_,i)=>row(i+1));const selected=filterCandidates(s,{});
 const json=JSON.parse(await buildCuratorExport(s,selected,'json',{mode:'current',selected:{},match:'any',ranges:{}}));
 assert.equal(json.wallets.length,75);assert.equal(json.wallets.at(-1).address,address(75));assert.equal(json.registry,registry);assert.equal(json.wallets[0].largestETH,'1.000000000000000001');assert.equal(json.dataKind,'Ethereum mainnet — read evidence');
 const csv=await buildCuratorExport(s,selected,'csv',{mode:'historical',selected:{},match:'any',ranges:{}});assert.equal(csv.trim().split('\r\n').length,76);assert.equal(csv.split('historical candidates — not accepted facts').length-1,75);assert.match(csv,/historical-candidates/);
 await assert.rejects(buildCuratorExport(s,[],'json',{}),/no matching/i);
});
test('large export can be cancelled before download, no half-file is returned',async()=>{
 const s=snapshot();s.wallets=Array.from({length:1500},(_,i)=>row(i+1));const selected=filterCandidates(s,{});const controller=new AbortController();
 await assert.rejects(buildCuratorExport(s,selected,'json',{}, {signal:controller.signal,yieldControl:async()=>controller.abort()}),e=>e.name==='AbortError');
});
test('trait links accept uint16 IDs and surface malformed query errors',()=>{
 assert.deepEqual(parseCuratorQuery('#/curator?trait=10001').selected,{10001:1});
 assert.deepEqual(parseCuratorQuery('#/curator?fact=601').selected,{601:1});
 assert.equal(parseCuratorQuery('#/curator').selected,null);
 for(const value of ['abc','65536','-1','0','1.5'])assert.match(parseCuratorQuery('#/curator?trait='+value).error,/Invalid fact/);
});
test('curator draft restores selection and exported weights only in its session/deployment scope',()=>{
 const key=curatorDraftKey('session-a',expected),store=new Map();const storage={getItem:k=>store.get(k)||null};
 const draft={version:1,tab:'consume',selected:{10001:3},match:'all',mode:'current',ranges:{},search:'',format:'json',address:address(1),checkedAddress:address(1),queryToken:'10001',saved:{addresses:[address(1)],weights:{[address(1)]:3},generatedAt:'2026-10-25T12:00:00Z',mode:'current',registry,rule:'{}'}};
 store.set(key,JSON.stringify(draft));assert.deepEqual(readCuratorDraft(storage,key),draft);
 assert.equal(readCuratorDraft(storage,curatorDraftKey('session-b',expected)),null);
 assert.equal(readCuratorDraft(storage,curatorDraftKey('session-a',{...expected,sourceCommit:'1'.repeat(40)})),null);
 store.set(key,'{bad');assert.equal(readCuratorDraft(storage,key),null);
 store.set(key,JSON.stringify({...draft,saved:{...draft.saved,weights:{[address(1)]:-1}}}));assert.equal(readCuratorDraft(storage,key),null);
});
test('historical rows never enter current exports and unknown selected reads stay visibly unresolved',async()=>{
 const {unresolvedCandidates}=await import('../src/curator-model.mjs');
 const s=snapshot();s.wallets=[row(1,{readStatus:'historical',directFacts:[],verifiedFacts:[],checkedFacts:[]}),row(2,{readStatus:'partial',directFacts:[],verifiedFacts:[],checkedFacts:[101],unknownFacts:[601]}),row(3,{verifiedFacts:[601],metrics:{hour:null,deposits:null,points:null,largestWei:null,index:null}})];
 assert.deepEqual(filterCandidates(s,{selected:{601:1}}).map(r=>r.address),[address(3)]);
 assert.equal(unresolvedCandidates(s,[601],'all'),1);
 assert.equal(unresolvedCandidates(s,[601],'all',{points:{min:'1'}}),2);
 assert.equal(filterCandidates(s,{selected:{601:1},ranges:{points:{min:'1'}}}).length,0);
});
