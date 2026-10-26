// Integration test against the running local EVM. Resets synthetic state; never uses a real wallet.
import assert from 'node:assert/strict';
import { encodeFunctionData, maxUint256, parseAbi } from 'viem';
import { A } from '../_chain.mjs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8812');
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.protocol, 'http:');
const abiResponse = await fetch(new URL('/abi/Registry.json', base), { signal: AbortSignal.timeout(10000) });
assert.equal(abiResponse.status, 200, 'Read ABI from the selected isolated instance');
const abi = await abiResponse.json();
const token = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
async function post(route, body) {
  const response = await fetch(new URL(route, base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.error) throw Error(JSON.stringify(data));
  return data;
}
const state = () => fetch(new URL('/__mock__/state', base)).then(r => r.json());
const control = body => post('/__mock__/state', body);
const wallet = '0xB0b00000000000000000000000000000000Bc1a1';
async function send(to, abi, functionName, args) {
  return post('/__mock__/wallet', { method: 'eth_sendTransaction', params: [{ from: wallet, to, data: encodeFunctionData({ abi, functionName, args }) }] });
}
async function until(check, label, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw Error(`Timed out: ${label}`);
}
const record = async () => (await state()).records.find(r => r.factId === 1301);
async function prepare(delivery) {
  await control({ reset: true, active: wallet, nextAnswer: 'true', delivery, transactionSeconds: .2, pickup: .2,
    walletSeconds: 0, approvalSeconds: null, preflightSeconds: 0, artworkSeconds: 0,
    firstAnswerSeconds: .1, answerEverySeconds: .1, attestAfterSeconds: .1, deliverAfterSeconds: .1, registrySeconds: .2 });
  await send(A.imd, token, 'approve', [A.registry, maxUint256]);
  await send(A.registry, abi, 'upgrade', [[1301], 500000000000000000n]);
  return until(async () => { const r = await record(); return r?.status === 'attested' && r; }, 'attested');
}

const initial = await state();
assert.equal(initial.simulation, true, 'Refuse to reset a non-simulator endpoint');
assert.equal(initial.ready, true, 'The selected simulator must be ready');
try {
  const held = await prepare('hold');
  assert.equal(held.attempted, false);
  await control({ nextAnswer: 'false', delivery: 'starved', pickup: 50 });
  assert.equal((await record()).config.delivery, 'hold');
  assert.equal((await record()).config.nextAnswer, 'true');
  await control({ releaseDelivery: held.oracleId });
  const delivered = await record();
  assert.equal(delivered.deliveryReceipt.delivered, true);
  assert.ok(delivered.deliveryReceipt.events.includes('Verified'));
  console.log('PASS: held delivery; frozen settings; real Verified callback');

  await prepare('starved');
  const failed = await until(async () => { const r = await record(); return r?.attempted && r; }, 'failed callback');
  assert.equal(failed.deliveryReceipt.delivered, false);
  assert.equal(failed.deliveryReceipt.events.includes('Verified'), false);
  await control({ recoverDelivery: failed.oracleId });
  assert.ok((await record()).recoveryReceipt.events.includes('Verified'));
  console.log('PASS: starved callback cannot pretend success; real Registry.settle recovery');

  await control({ reset: true, active: wallet, transactionSeconds: 0,
    walletSeconds: 0, approvalSeconds: null, preflightSeconds: 0, artworkSeconds: 0 });
  await send(A.imd, token, 'approve', [A.registry, maxUint256]);
  await control({ transactionSeconds: 600 });
  await send(A.registry, abi, 'upgrade', [[1301], 500000000000000000n]);
  await control({ reset: true });
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.deepEqual((await state()).records, []);
  console.log('PASS: reset cancels a 600-second pending transaction and leaves the replacement oracle empty');
} finally {
  await control({ reset: true });
}
