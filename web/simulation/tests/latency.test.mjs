import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, multicall3Abi, parseAbi } from 'viem';
import { defaults, configure, freezeRequest } from '../_settings.mjs';
import { walletTiming, rpcDelaySeconds } from '../_latency.mjs';

const addresses = {
  imd: '0x1000000000000000000000000000000000000001',
  registry: '0x2000000000000000000000000000000000000002',
  renderer: '0x3000000000000000000000000000000000000003',
};
const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11';
const abi = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function tokenURI(uint256 token) view returns (string)',
  'function tokenURIOf(address registry, uint256 token) view returns (string)',
  'function tokenOf(address wallet) view returns (uint256)',
]);
const data = (functionName, args) => encodeFunctionData({ abi, functionName, args });
const settings = { ...defaults, walletSeconds: 2, transactionSeconds: 8, preflightSeconds: 3, artworkSeconds: 4 };
const approval = { to: addresses.imd, data: data('approve', [addresses.registry, 100n]) };
const uri = { to: addresses.registry, data: data('tokenURI', [1n]) };

test('approval inherits the transaction delay until explicitly configured, including explicit zero', () => {
  assert.deepEqual(walletTiming(approval, settings, addresses), { walletSeconds: 2, miningSeconds: 8, isApproval: true });
  assert.deepEqual(walletTiming(approval, { ...settings, approvalSeconds: 0 }, addresses), { walletSeconds: 2, miningSeconds: 0, isApproval: true });
  assert.equal(walletTiming({ ...approval, to: addresses.registry }, { ...settings, approvalSeconds: 15 }, addresses).miningSeconds, 8);
  assert.equal(walletTiming({ ...approval, data: '0x095ea7b3' }, settings, addresses).isApproval, false);
});

test('in-flight wallet timing cannot change when later controls change', () => {
  const controls = { ...settings };
  const pending = freezeRequest(controls);
  configure(controls, { walletSeconds: 10, transactionSeconds: 20, approvalSeconds: 30 });
  assert.deepEqual(walletTiming(approval, pending, addresses), { walletSeconds: 2, miningSeconds: 8, isApproval: true });
});

test('preflight latency does not slow receipt polling, event history, or ordinary contract reads', () => {
  assert.equal(rpcDelaySeconds({ method: 'eth_estimateGas', params: [approval] }, settings, addresses), 3);
  for (const method of ['eth_getTransactionReceipt', 'eth_getLogs', 'eth_blockNumber']) {
    assert.equal(rpcDelaySeconds({ method, params: [] }, settings, addresses), 0);
  }
  assert.equal(rpcDelaySeconds({ method: 'eth_call', params: [{ to: addresses.registry, data: data('tokenOf', [addresses.imd]) }] }, settings, addresses), 0);
});

test('artwork latency covers real registry reads and renderer previews without matching foreign contracts', () => {
  assert.equal(rpcDelaySeconds({ method: 'eth_call', params: [uri, 'latest'] }, settings, addresses), 4);
  const preview = { to: addresses.renderer, data: data('tokenURIOf', [addresses.registry, 1n]) };
  assert.equal(rpcDelaySeconds({ method: 'eth_call', params: [preview, 'latest', {}] }, settings, addresses), 4);
  assert.equal(rpcDelaySeconds({ method: 'eth_call', params: [{ ...uri, to: addresses.imd }] }, settings, addresses), 0);
  assert.equal(rpcDelaySeconds({ method: 'eth_call', params: [{ ...uri, data: '0xc87b56dd' }] }, settings, addresses), 0);
});

test('one aggregate3 response incurs artwork latency once, only if it contains an actual artwork read', () => {
  const rpc = calls => ({ method: 'eth_call', params: [{ to: multicall, data: encodeFunctionData({
    abi: multicall3Abi, functionName: 'aggregate3', args: [calls.map(call => ({ target: call.to, allowFailure: true, callData: call.data }))],
  }) }] });
  const plain = { to: addresses.registry, data: data('tokenOf', [addresses.imd]) };
  assert.equal(rpcDelaySeconds(rpc([plain, uri, uri]), settings, addresses), 4);
  assert.equal(rpcDelaySeconds(rpc([plain]), settings, addresses), 0);
  assert.equal(rpcDelaySeconds({ method: 'eth_call', params: [{ to: multicall, data: '0x82ad56cb' }] }, settings, addresses), 0);
});
