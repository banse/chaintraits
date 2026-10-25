import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationDismissalKey, verificationDismissed, dismissVerification } from '../src/verification-dismissal.mjs';

test('dismissed progress stays hidden after remount while new requests and other wallets remain visible', () => {
  const entries=new Map();
  const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  const request={chainId:1,registry:'0xRegistry',account:'0xWallet',requestId:'0xFirst'};
  const key=verificationDismissalKey(request);
  assert.equal(verificationDismissed(storage,key),false);
  dismissVerification(storage,key);
  assert.equal(verificationDismissed(storage,verificationDismissalKey({...request,account:'0xwallet'})),true);
  for(const changed of [{requestId:'0xSecond'},{account:'0xOther'},{registry:'0xOther'},{chainId:8453}])
    assert.equal(verificationDismissed(storage,verificationDismissalKey({...request,...changed})),false);
  assert.equal(entries.size,1); // Hides only this display entry; no request journal is removed.
});

test('unavailable browser storage does not crash progress dismissal', () => {
  const storage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.equal(verificationDismissed(storage,'key'),false);
  assert.doesNotThrow(()=>dismissVerification(storage,'key'));
});
