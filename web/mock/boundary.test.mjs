import test from 'node:test';
import assert from 'node:assert/strict';
import { mockRoute, makeMockWallet } from '../src/mock-boundary.mjs';

test('only known RPC and swarm URLs are mapped locally; arbitrary outbound traffic is refused', () => {
  const origin = 'http://127.0.0.1:8798';
  assert.equal(mockRoute('/abi/Registry.json', origin), origin + '/abi/Registry.json');
  assert.equal(mockRoute('https://ethereum-rpc.publicnode.com', origin), origin + '/__mock/rpc');
  assert.match(mockRoute('https://api.imd.fun/oracle/requests?limit=20', origin), /\/__mock\/swarm\?path=/);
  assert.throws(() => mockRoute('https://example.com/rpc', origin), /blocked/);
  assert.throws(() => mockRoute('http://127.0.0.1:8545', origin), /blocked/);
  assert.throws(() => mockRoute('wss://api.imd.fun/swarm', origin), /blocked/);
});

test('wallet uses only its supplied mock transport and keeps authorization separate from balances', async () => {
  const calls = [];
  let state = {wallet:'0x2000000000000000000000000000000000000001',chainId:8453,walletDelayMs:0};
  const wallet = makeMockWallet({state:async()=>state,configure:async(p)=>{state={...state,...p}},rpc:async(p)=>{calls.push(p);return '0x'+'ab'.repeat(32)}});
  assert.deepEqual(await wallet.request({method:'eth_accounts'}), []);
  assert.deepEqual(await wallet.request({method:'eth_requestAccounts'}), [state.wallet]);
  assert.equal(await wallet.request({method:'eth_chainId'}),'0x2105');
  const events=[];wallet.on('chainChanged',x=>events.push(x));
  await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1'}]});
  assert.deepEqual(events,['0x1']);
  await wallet.request({method:'eth_sendTransaction',params:[{to:state.wallet}]});
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'eth_sendTransaction');
  await assert.rejects(wallet.request({method:'personal_sign',params:['secret']}), /not supported/);
  await assert.rejects(wallet.request({method:'eth_sendRawTransaction',params:['0x00']}), /not supported/);
  assert.equal(calls.length,1);
});
