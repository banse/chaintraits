import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSpec, mockRecipe, mockAnswer } from './question-fixtures.mjs';
import { createEngine } from './engine.mjs';
import {encodeEventTopics,parseAbi} from 'viem';
const wallet='0x2000000000000000000000000000000000000001';
test('Swarmed shows the complete source recipe with a synthetic fixed request window',()=>{
  const r=mockRecipe(601,wallet,26250002n);
  assert.equal(r.panelSize,11);assert.equal(r.quorum,7);
  assert.equal(r.window.toBlock,26249938);
  assert.match(r.question,new RegExp(wallet));
  assert.match(r.definitions.seats,/25090085/);
  assert.match(r.definitions.accepted,/second data word/);
  assert.doesNotMatch(JSON.stringify(r),/~[A-M]/);
});
test('shared rankings and nonce rules use 11/7 with their proper answer types',()=>{
  const shared=mockRecipe(1201,wallet,26250002n);
  assert.equal(shared.answerType,'address[]');assert.equal(shared.panelSize,11);
  assert.match(shared.question,/weightAdded/);
  assert.equal(mockAnswer(shared,true,wallet).length,32);
  assert.ok(mockAnswer(shared,true,wallet).every(address=>BigInt(address)>=2n**80n));
  const nonce=mockRecipe(1301,wallet,26250002n);
  assert.equal(nonce.answerType,'bool');assert.equal(nonce.panelSize,11);
  assert.equal(mockAnswer(nonce,false,wallet),false);
});
test('chain-proven counts use numeric answers and a real threshold spec',()=>{
  const r=mockRecipe(701,wallet,26250002n);
  assert.equal(r.panelSize,5);assert.equal(r.quorum,3);
  assert.equal(r.answerType,'uint256');assert.equal(catalogSpec(701).kind,1);
  assert.equal(mockAnswer(r,true,wallet),'1');assert.equal(mockAnswer(r,false,wallet),'0');
});
test('the mock wallet has a synthetic seat receipt for the Swarmed preflight',async()=>{
  const e=createEngine();
  const topics=encodeEventTopics({abi:parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']),eventName:'Transfer',args:{to:wallet}});
  const logs=await e.rpc({method:'eth_getLogs',params:[{address:catalogSpec(601).target,fromBlock:'0x'+(25090085).toString(16),toBlock:'0x'+(26249938).toString(16),topics}]});
  assert.equal(logs.length,1);
  assert.equal(logs[0].topics[2],topics[2]);
});
