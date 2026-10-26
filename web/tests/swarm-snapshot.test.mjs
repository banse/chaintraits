import test from 'node:test';
import assert from 'node:assert/strict';
import { swarmSnapshot, readCardArtwork } from '../src/fact-check/swarm-snapshot.mjs';

const wallet = `0x${'2'.repeat(40)}`;
const registry = `0x${'1'.repeat(40)}`;
const requestId = `0x${'a'.repeat(64)}`;
const questionHash = `0x${'b'.repeat(64)}`;
const fact = { id: 601, name: 'Swarmed', requestId };
const origin = { eventName:'TraitRequested', address:registry, blockNumber:100n, transactionHash:`0x${'c'.repeat(64)}`, args:{requestId, traitId:601n, claimant:wallet, questionHash} };
const identity = { chainId:1, registry, requestId, claimant:wallet, questionHash, blockNumber:100n, requestedAt:1000n, origin, spec:{kind:5}, shortQuestion:'Did this wallet complete three jobs?' };
const view = { address:wallet, requestId, requestConfirmed:true, identity, progress:null };
const terminal = { ...origin, eventName:'Verified', blockNumber:101n };
const image = 'data:image/svg+xml,%3Csvg/%3E';

test('browser request records alone never establish a confirmed request', () => {
  assert.equal(swarmSnapshot({fact,wallet,view:null}), null);
  assert.equal(swarmSnapshot({fact,wallet,view:{...view,requestConfirmed:false}}), null);
  assert.equal(swarmSnapshot({fact,wallet,view:{...view,identity:null}}), null);
  assert.equal(swarmSnapshot({fact,wallet:registry,view}), null);
});

test('a confirmed request must bind its Registry event, wallet, fact, chain and question', () => {
  const result = swarmSnapshot({fact,wallet,view});
  assert.equal(result.phase,'admission');
  assert.equal(result.mode,'live');
  assert.deepEqual(result.agents,[]);
  assert.equal(result.panelSize,null);
  for (const changed of [
    {...identity,chainId:2},
    {...identity,registry:wallet},
    {...identity,questionHash:`0x${'d'.repeat(64)}`},
    {...identity,origin:{...origin,removed:true}},
    {...identity,origin:{...origin,args:{...origin.args,traitId:602n}}},
    {...identity,origin:{...origin,args:{...origin.args,claimant:registry}}},
  ]) assert.throws(()=>swarmSnapshot({fact,wallet,view:{...view,identity:changed}}),/request binding/i);
});

test('shared zero claimant is permitted only for shared list requests', () => {
  const zero=`0x${'0'.repeat(40)}`;
  const sharedFact={...fact,id:1201,name:'Shared ranking'};
  const shared={...identity,claimant:zero,spec:{kind:3},origin:{...origin,args:{...origin.args,claimant:zero,traitId:1201n}}};
  assert.equal(swarmSnapshot({fact:sharedFact,wallet,view:{...view,identity:shared}}).result,null);
  assert.throws(()=>swarmSnapshot({fact,wallet,view:{...view,identity:{...shared,origin:{...shared.origin,args:{...shared.origin.args,traitId:601n}},spec:{kind:5}}}}),/request binding/i);
});

test('Registry success waits for actual artwork and survives an API outage', () => {
  const confirmed={...view,event:terminal,hasFact:true,token:1n};
  assert.equal(swarmSnapshot({fact,wallet,view:confirmed}).phase,'registry');
  const saved=swarmSnapshot({fact,wallet,view:{...confirmed,cardImage:image,apiError:'temporarily unavailable'}});
  assert.equal(saved.phase,'saved');
  assert.equal(saved.result,true);
  assert.equal(saved.cardImage,image);
  assert.match(saved.notice,/temporarily unavailable/);
  const cardless=swarmSnapshot({fact,wallet,view:{...confirmed,token:0n}});
  assert.equal(cardless.phase,'saved');
  assert.equal(cardless.cardless,true);
  assert.equal(cardless.cardImage,undefined);
  const unavailable=swarmSnapshot({fact,wallet,view:{...confirmed,apiError:'API unavailable',cardError:'Renderer unavailable'}});
  assert.equal(unavailable.phase,'registry');
  assert.equal(unavailable.result,null);
  assert.equal(unavailable.cardError,'Renderer unavailable');
});

test('artwork loader distinguishes no card, real metadata and renderer failure', async () => {
  const calls=[];
  const noCard=await readCardArtwork(async (name,args)=>{calls.push([name,args]);return 0n;},wallet);
  assert.equal(noCard.token,0n);
  assert.equal(noCard.cardImage,undefined);
  assert.deepEqual(calls,[['tokenOf',[wallet]]]);
  const uri=`data:application/json;base64,${Buffer.from(JSON.stringify({image})).toString('base64')}`;
  const actual=await readCardArtwork(async name=>name==='tokenOf'?1n:uri,wallet);
  assert.equal(actual.cardImage,image);
  const failed=await readCardArtwork(async name=>{if(name==='tokenOf')return 1n;throw Error('renderer unavailable');},wallet);
  assert.equal(failed.token,1n);
  assert.equal(failed.cardImage,undefined);
  assert.match(failed.cardError,/renderer unavailable/);
  await assert.rejects(readCardArtwork(async()=>{throw Error('RPC unavailable');},wallet),/RPC unavailable/);
});

test('missing or unsafe artwork is an explicit error and remote artwork remains usable', async () => {
  for (const image of [undefined,42,{},'javascript:alert(1)','data:text/html,invalid']) {
    const uri=`data:application/json;base64,${Buffer.from(JSON.stringify({image})).toString('base64')}`;
    const result=await readCardArtwork(async name=>name==='tokenOf'?1n:uri,wallet);
    assert.equal(result.cardImage,undefined);
    assert.match(result.cardError,/artwork.*unavailable/i);
  }
  for (const image of ['https://example.test/card.svg','http://localhost/card.svg','ipfs://QmArtwork','ar://Artwork']) {
    const uri=`data:application/json;base64,${Buffer.from(JSON.stringify({image})).toString('base64')}`;
    const result=await readCardArtwork(async name=>name==='tokenOf'?1n:uri,wallet);
    assert.equal(typeof result.cardImage,'string');
    assert.equal(result.cardError,undefined);
  }
});
