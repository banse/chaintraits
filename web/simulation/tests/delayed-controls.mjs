// Destructive only to the explicitly selected, loopback delayed simulation.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { encodeFunctionData, parseAbi } from 'viem';
import { A } from '../_chain.mjs';

const base = new URL(process.argv[2]);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
const wallet = '0xB0b00000000000000000000000000000000Bc1a1';
const other = '0xA11CE000000000000000000000000000000AC1a1';
const data = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [A.registry, 1n] });
async function request(path, body) {
  const response = await fetch(new URL(path, base), {
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json() };
}
const state = async () => (await request('/__mock__/state')).body;
const control = patch => request('/__mock__/state', patch);
const send = () => request('/__mock__/wallet', { method: 'eth_sendTransaction', params: [{ from: wallet, to: A.imd, data }] });
const rpc = (method, params) => request('/__mock__/rpc', { jsonrpc: '2.0', id: 1, method, params });
async function until(check) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await check()) return; await sleep(30); }
  throw Error('Timed out waiting for the local simulation');
}
assert.equal((await state()).instance?.profile, 'delayed', 'Only use the isolated delayed instance');
try {
  await control({ reset: true, active: wallet, walletSeconds: .6, approvalSeconds: .1 });
  const changed = send();
  await until(async () => (await state()).transactions.length === 1);
  await control({ active: other });
  assert.match((await changed).body.error.message, /selected wallet changed/);
  assert.equal((await state()).transactions[0].hash, undefined);
  console.log('PASS: wallet switch cancels confirmation before a transaction is sent');

  await control({ active: wallet });
  const interrupted = send();
  await until(async () => (await state()).transactions.length === 2);
  await control({ reset: true });
  assert.match((await interrupted).body.error.message, /reset during wallet confirmation/);
  assert.deepEqual((await state()).transactions, []);
  console.log('PASS: reset cancels delayed wallet confirmation');

  await control({ preflightSeconds: 2 });
  const reading = rpc('eth_estimateGas', [{ from: wallet, to: A.imd, data }]);
  await sleep(100);
  await control({ reset: true });
  assert.ok((await reading).body.error, 'Old delayed read must not return replacement-chain data');
  console.log('PASS: reset cancels delayed preflight reads');

  await control({ active: wallet, walletSeconds: 0, approvalSeconds: 1.5 });
  const { body: sent } = await send();
  assert.match(sent.result, /^0x[0-9a-f]{64}$/i);
  const advance = await control({ advanceDays: 32 });
  assert.notEqual(advance.status, 200);
  assert.match(advance.body.error, /pending transaction/);
  assert.equal((await rpc('eth_getTransactionReceipt', [sent.result])).body.result, null);
  await until(async () => !!(await rpc('eth_getTransactionReceipt', [sent.result])).body.result);
  console.log('PASS: advancing time cannot bypass pending transaction delay');

  const concurrent = await Promise.all([control({ reset: true }), control({ reset: true })]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  assert.equal((await state()).settings.pickup, 12);
  console.log('PASS: concurrent reset is refused and the startup profile is restored');

  await control({ active: wallet, walletSeconds: 0, approvalSeconds: 600 });
  const long = await send();
  await control({ reset: true });
  assert.equal((await rpc('eth_getTransactionReceipt', [long.body.result])).body.result, null);
  assert.deepEqual((await state()).transactions, []);
  console.log('PASS: reset cancels a 600-second mining wait without retaining its transaction');
} finally {
  await control({ reset: true });
}
