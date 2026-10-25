import test from 'node:test';
import assert from 'node:assert/strict';
import { requestHistory, feeKey, savedRequestFees, saveRequestFees, savedRequests, installRequestHistoryRecorder } from '../src/request-history.mjs';

test('request recorder stays in its browser tab and does not change origin-wide history', () => {
  const previous = Object.fromEntries(['window', 'localStorage', 'sessionStorage'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const values = new Map();
  try {
    globalThis.window = new EventTarget();
    Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{getItem:()=>null, setItem:()=>assert.fail('must not mutate another browser session')} });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable:true, value:{getItem:k=>values.get(k), setItem:(k,v)=>values.set(k,v)} });
    installRequestHistoryRecorder();
    const event = new Event('sworn-request-confirmed');
    event.detail = {chainId:1,registry:'0xREG',account:'0xABC',feePerRequest:'500',facts:[{id:601,requestId:'0x1'}]};
    window.dispatchEvent(event);
    assert.equal(savedRequests(sessionStorage,1,'0xreg','0xABC').length,1);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});

const wallet = '0xABC';
const request = (requestId, claimant = wallet) => ({eventName:'TraitRequested', args:{claimant,traitId:601,requestId}, transactionHash:'0xtx', blockNumber:1n});
const end = (eventName, requestId, extra={}) => ({eventName,args:{requestId,...extra},blockNumber:2n});

test('failed attempts remain visible alongside a later successful retry after reconstruction', () => {
  const events = [request('0x1'),end('NoVerdict','0x1'),request('0x2'),end('Verified','0x2')];
  const rows = requestHistory(events,wallet);
  assert.equal(rows.length,2);
  assert.equal(rows[0].status,'Stored');
  assert.equal(rows[1].status,'No verdict');
  assert.match(rows[1].message,/(fee|price).*spent/i);
  assert.equal(rows[1].transactionHash,'0xtx');
  assert.deepEqual(requestHistory(events,wallet),rows);
});
test('missing terminal evidence is unknown, never inferred from absence in pending', () => {
  assert.equal(requestHistory([request('0x1')],wallet)[0].status,'Outcome not yet confirmed');
});
test('history is scoped to claimant and retains only the first terminal outcome', () => {
  const rows=requestHistory([request('0x1'),end('Missed','0x1',{reason:8}),end('Verified','0x1'),request('0x2','0xDEF'),end('NoVerdict','0x2')],wallet);
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,'Answer false');
  assert.equal(requestHistory([request('0x1')],'0xDEF').length,0);
});
test('confirmed fee records survive reload and cannot bleed across wallet or Registry scopes', () => {
  const values=new Map(); const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  saveRequestFees(storage,{chainId:1,registry:'0xREG',account:wallet,feePerRequest:'500',facts:[{requestId:'0x1'}]});
  assert.equal(savedRequestFees(storage)[feeKey(1,'0xreg',wallet,'0x1')],'500');
  assert.equal(savedRequestFees(storage)[feeKey(8453,'0xreg',wallet,'0x1')],undefined);
  assert.equal(savedRequestFees(storage)[feeKey(1,'0xreg','0xOTHER','0x1')],undefined);
  assert.equal(savedRequestFees(storage)[feeKey(1,'0xOTHER',wallet,'0x1')],undefined);
});
test('shared attempts survive changing the current journal and do not imply wallet verification', () => {
  const values=new Map(); const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  saveRequestFees(storage,{chainId:1,registry:'0xREG',account:wallet,feePerRequest:'500',facts:[{id:1201,requestId:'0xshared',name:'Top Weights'}]});
  const saved=savedRequests(storage,1,'0xreg',wallet);
  assert.equal(saved[0].id,1201);
  assert.equal(savedRequests(storage,1,'0xreg','0xOTHER').length,0);
  const event={...request('0xshared','0x000'),args:{claimant:'0x000',traitId:1201,requestId:'0xshared'}};
  const row=requestHistory([event,end('SharedFactStored','0xshared')],wallet,saved.map(r=>r.requestId))[0];
  assert.equal(row.status,'Stored');
  assert.match(row.message,/Apply it to your wallet/);
});
