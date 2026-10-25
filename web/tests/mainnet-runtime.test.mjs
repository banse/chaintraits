import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectedProvider } from '../src/controllers/wallet-connection.mjs';
import { checkSubmission } from '../src/controllers/submission-check.mjs';
import { journalKey, restoreJournal, encodeJournal } from '../src/models/transaction-journal.mjs';

const binding = { chainId: 1, registry: '0x1111111111111111111111111111111111111111' };
const storage = value => ({ getItem: () => value });

test('connection uses the selected live connector and refuses stale providers', async () => {
  const provider = { request() {} };
  const stale = { uid:'selected', id:'wallet', getProvider() { throw Error('stale'); } };
  const live = { uid:'selected', id:'wallet', async getProvider() { return provider; } };
  assert.equal(await connectedProvider([live], stale), provider);
  await assert.rejects(connectedProvider([], stale), /Reconnect/);
  await assert.rejects(connectedProvider([{uid:'selected',getProvider:async()=>null}], stale), /provider/);
});

test('mainnet journals are bound to chain and Registry; old mock data does not restore', () => {
  assert.notEqual(journalKey(binding), journalKey({...binding,chainId:31337}));
  assert.notEqual(journalKey(binding), journalKey({...binding,registry:'0x2222222222222222222222222222222222222222'}));
  const draft = {plan:{amount:'2'},steps:[{state:'ready'}]};
  assert.deepEqual(restoreJournal(storage(JSON.stringify(draft)),binding),{});
  const submitted={plan:{amount:2n},steps:[{state:'pending',hash:'0x123'}]};
  const encoded=encodeJournal(binding,submitted);
  assert.equal(restoreJournal(storage(encoded),binding).plan.amount,2n);
  assert.equal(restoreJournal(storage(encoded),binding).steps[0].state,'unknown');
  assert.deepEqual(restoreJournal(storage(encoded),{...binding,chainId:31337}),{});
});

test('restored intent cannot become a confirmed receipt and unsent consent is dropped', () => {
  const submitted={steps:[{state:'awaiting signature',intent:{nonce:4}}]};
  assert.equal(restoreJournal(storage(encodeJournal(binding,submitted)),binding).steps[0].state,'unknown');
  assert.deepEqual(restoreJournal(storage(encodeJournal(binding,{steps:[{state:'simulated'}],history:[]})),binding),{history:[]});
  assert.deepEqual(restoreJournal({getItem(){throw Error('storage blocked');}},binding),{});
  assert.deepEqual(restoreJournal(()=>{throw Error('access denied');},binding),{});
});

test('submission checks simulation and gas before returning an executable request', async () => {
  const events=[];
  const client={
    async simulateContract(request){events.push('simulate');return {request};},
    async estimateContractGas(){events.push('gas');return 123n;},
    async getGasPrice(){return 2n;}
  };
  const call={address:binding.registry};
  const result=await checkSubmission(client,call);
  assert.deepEqual(events,['simulate','gas']);
  assert.equal(result.request,call);
  assert.equal(result.gas,123n);
  assert.equal(result.cost,246n);
  await assert.rejects(checkSubmission({...client,estimateContractGas:async()=>{throw Error('unavailable');}},call),/unavailable/);
  await assert.rejects(checkSubmission({...client,estimateContractGas:async()=>0n},call),/gas estimate/);
  assert.equal((await checkSubmission({...client,getGasPrice:async()=>{throw Error('unavailable');}},call)).cost,undefined);
});

test('signing context refuses a changed account, chain or connector', async () => {
  const { assertWalletContext } = await import('../src/controllers/wallet-connection.mjs');
  const expected={address:binding.registry,chainId:1,connector:{uid:'chosen',id:'wallet'}};
  assert.doesNotThrow(()=>assertWalletContext({...expected},expected));
  for(const patch of [{address:undefined},{address:'0x2222222222222222222222222222222222222222'},{chainId:31337},{connector:{uid:'different',id:'other'}}])
    assert.throws(()=>assertWalletContext({...expected,...patch},expected),/Wallet or network changed/);
});
