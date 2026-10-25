import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPLORER_SAMPLES, sampleForAddress, sampleWalletFacts, MOCK_WALLET } from './fixtures/explorer-samples.mjs';

const traits=[{id:101,family:1},{id:601,family:6},{id:1201,family:12}];
test('six distinct synthetic wallets never alias the active mock wallet',()=>{
  assert.equal(EXPLORER_SAMPLES.length,6);
  assert.equal(new Set(EXPLORER_SAMPLES.map(s=>s.address)).size,6);
  assert.equal(sampleForAddress(MOCK_WALLET),undefined);
  assert.equal(sampleForAddress('0x9999999999999999999999999999999999999999'),undefined);
  assert.equal(sampleForAddress(EXPLORER_SAMPLES[0].address.toUpperCase()),EXPLORER_SAMPLES[0]);
});
test('samples distinguish a card holder, facts without cards, and shared results not yet applied',()=>{
  const noCard=EXPLORER_SAMPLES.find(s=>s.key==='verified');
  assert.equal(sampleWalletFacts(noCard,traits,[]).token,0n);
  assert.ok(sampleWalletFacts(noCard,traits,[]).traits.includes(601));
  const transferred=EXPLORER_SAMPLES.find(s=>s.key==='transferred');
  assert.notEqual(transferred.owner,transferred.address);
  assert.ok(sampleWalletFacts(transferred,traits,[]).token>0n);
  const shared=EXPLORER_SAMPLES.find(s=>s.key==='shared');
  assert.equal(sampleWalletFacts(shared,traits,[]).answers[2],false);
  assert.match(shared.outcome,/not.*applied/i);
});
test('pending and failed samples are read-only narratives, never watchable request IDs',()=>{
  for(const sample of EXPLORER_SAMPLES){
    const facts=sampleWalletFacts(sample,traits,[]);
    assert.deepEqual(facts.pending,{});
    assert.deepEqual(facts.verified,{});
    assert.match(facts.metadata.description,/synthetic/i);
    assert.match(facts.metadata.image,/^data:image\/svg\+xml/);
    facts.traits.push(9999);
    assert.equal(sampleWalletFacts(sample,traits,[]).traits.includes(9999),false);
  }
});
