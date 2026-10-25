import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadHistoricalCandidates, readCurrentWallet, consumeCurrentFacts, mergeCandidateRows, rowsFromCensus} from '../src/models/curator-live.mjs';
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const facts=[{id:101,kind:0},{id:601,kind:6},{id:10001,kind:4}];
const digest=async bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest();
const fixture=()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({[address(1)]:[2]}));
 const pin={factIds:[701],facts:{701:{spec:{threshold:'1'}}},files:{'wallets-0.json':{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}};
 return {bytes,pin};
};
test('historical discovery verifies the shipped shard hash and never manufactures current eligibility',async()=>{
 const {bytes,pin}=fixture();const rows=await loadHistoricalCandidates({pin,digest,base:'https://local.test/ipfs/cid/',fetcher:async url=>{assert.equal(url,'https://local.test/ipfs/cid/data/eligibility/wallets-0.json');return new Response(bytes);}});
 assert.equal(rows.length,1);assert.deepEqual(rows[0].historicalFacts,[101,701]);assert.deepEqual(rows[0].directFacts,[]);assert.equal(rows[0].readStatus,'historical');assert.equal(rows[0].tokenId,null);
 await assert.rejects(loadHistoricalCandidates({pin,digest,base:'https://local.test/',fetcher:async()=>new Response('bad')}),/length|hash/);
 await assert.rejects(loadHistoricalCandidates({pin,digest,base:'https://local.test/',fetcher:async()=>new Response('',{status:503})}),/unavailable/);
});
test('cancelled historical discovery stops before further shards and never returns a partial directory',async()=>{
 const {bytes,pin}=fixture(),controller=new AbortController();let calls=0;
 await assert.rejects(loadHistoricalCandidates({pin,digest,base:'https://local.test/',signal:controller.signal,fetcher:async()=>{calls++;controller.abort();return new Response(bytes);}}),e=>e.name==='AbortError');assert.equal(calls,1);
});
function reader(overrides={}){return async(fn,args)=>{
 if(fn in overrides){if(overrides[fn] instanceof Error)throw overrides[fn];return typeof overrides[fn]==='function'?overrides[fn](args):overrides[fn];}
 return {tokenOf:0n,ownerOf:null,pendingOf:'0x'+'0'.repeat(64),hasTrait:args[1]===10001,firstHourOf:[0n,false],txCountOf:0n,contributedBy:0n,pointsOf:0n}[fn];
};}
test('current read accepts a cardless outside-census wallet and community facts from hasTrait',async()=>{
 const read=reader();const row=await readCurrentWallet({address:address(8),facts,readRegistry:read,readCurator:read,blockNumber:123});
 assert.equal(row.tokenId,'0');assert.equal(row.censusMember,false);assert.deepEqual(row.verifiedFacts,[10001]);assert.deepEqual(row.unknownFacts,[]);assert.equal(row.blockNumber,123);
 const result=await consumeCurrentFacts({address:address(8),ids:[10001],match:'all',readRegistry:read,blockNumber:123});assert.equal(result.status,'eligible');assert.equal(result.facts[0].state,'present');
});
test('RPC failures remain unknown and never become negative credentials; OR/AND remain three-state',async()=>{
 const read=reader({hasTrait:args=>{if(args[1]===601)throw Error('offline');return args[1]===10001;}});
 const result=await consumeCurrentFacts({address:address(8),ids:[601],match:'all',readRegistry:read,blockNumber:123});assert.equal(result.status,'unknown');assert.equal(result.facts[0].state,'unknown');
 assert.equal((await consumeCurrentFacts({address:address(8),ids:[601,10001],match:'any',readRegistry:read,blockNumber:123})).status,'eligible');
 assert.equal((await consumeCurrentFacts({address:address(8),ids:[601,10001],match:'all',readRegistry:read,blockNumber:123})).status,'unknown');
 const row=await readCurrentWallet({address:address(8),facts,readRegistry:read,readCurator:read,blockNumber:123});assert.deepEqual(row.unknownFacts,[601]);assert.equal(row.readStatus,'partial');
});
test('aborted wallet reads cannot return stale results or schedule later calls',async()=>{
 const c=new AbortController();c.abort();let calls=0;await assert.rejects(consumeCurrentFacts({address:address(1),ids:[601],readRegistry:async()=>{calls++;return true;},blockNumber:1,signal:c.signal}),e=>e.name==='AbortError');assert.equal(calls,0);
});
test('census only admits complete unique pinned-window FirstDeposit records; metrics stay historical',()=>{
 const meta={contributors:2,launchTime:1000,hourDuration:3600};const logs=[{args:{contributor:address(1),index:1n,timestamp:1000n}},{args:{contributor:address(2),index:2n,timestamp:4600n}}];
 const rows=rowsFromCensus(logs,meta);assert.equal(rows.length,2);assert.equal(rows[1].metrics.hour,1);assert.deepEqual(rows[0].directFacts,[]);
 assert.throws(()=>rowsFromCensus(logs.slice(0,1),meta),/incomplete/i);assert.throws(()=>rowsFromCensus([logs[0],logs[0]],meta),/duplicate/i);
});
test('merging discovery does not overwrite current credentials and permits wallets outside census',()=>{
 const old={address:address(1),historicalFacts:[101],directFacts:[101],verifiedFacts:[601],readStatus:'current',metrics:{hour:2}};
 const merged=mergeCandidateRows([old],[{address:address(1),historicalFacts:[701],readStatus:'historical',metrics:{hour:null}},{address:address(2),readStatus:'current',historicalFacts:[],metrics:{}}]);
 assert.equal(merged.length,2);assert.deepEqual(merged[0].verifiedFacts,[601]);assert.deepEqual(merged[0].historicalFacts,[101,701]);assert.equal(merged[0].metrics.hour,2);
});
test('a newer current read never relabels stale non-null metrics with its new block',()=>{
 const old={address:address(1),historicalFacts:[101],directFacts:[101],verifiedFacts:[],readStatus:'current',blockNumber:100,metrics:{hour:2,deposits:12,points:1500,largestWei:'2000000000000000000',index:4}};
 const fresh={...old,blockNumber:200,metrics:{hour:null,deposits:null,points:null,largestWei:null,index:null}};
 const [merged]=mergeCandidateRows([old],[fresh]);assert.equal(merged.blockNumber,200);assert.deepEqual(merged.metrics,fresh.metrics);
});
