import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,decodeEventLog} from 'viem';
import {createEngine,addresses,abis,WALLET} from './engine.mjs';
test('a shared result stores the list and does not claim a wallet has verified it',async()=>{
  let now=1000;const e=createEngine({now:()=>now});
  e.configure({allowance:String(10n**18n)});
  await e.rpc({method:'eth_sendTransaction',params:[{from:WALLET,to:addresses.Registry,data:encodeFunctionData({abi:abis.Registry,functionName:'requestSharedFact',args:[1201,500000000000000000n]})}]});
  now+=3000;e.state();now+=12000;e.state();
  const head=await e.rpc({method:'eth_blockNumber',params:[]});
  const logs=await e.rpc({method:'eth_getLogs',params:[{address:addresses.Registry,fromBlock:'0x0',toBlock:head,topics:[]}]});
  const events=logs.map(log=>decodeEventLog({abi:abis.Registry,data:log.data,topics:log.topics}));
  assert.ok(events.some(event=>event.eventName==='SharedFactStored' && event.args.factId===1201));
  assert.ok(!events.some(event=>event.eventName==='Verified'));
  assert.ok(!e.state().proven.includes(1201));
});
