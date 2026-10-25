import test from 'node:test';
import assert from 'node:assert/strict';
import { cardSuccessKey, cardSuccessDismissed, dismissCardSuccess } from '../src/card-success.mjs';

const mint = {chainId:1, registry:'0xREGISTRY', account:'0xWALLET', token:1n, hash:'0xMINT'};
const memory = () => {
  const data = new Map();
  return {getItem:key=>data.get(key), setItem:(key,value)=>data.set(key,value)};
};
test('dismissing a mint survives remount and reload using the same session storage', () => {
  const storage=memory(), key=cardSuccessKey(mint);
  assert.equal(cardSuccessDismissed(storage,key),false);
  dismissCardSuccess(storage,key);
  assert.equal(cardSuccessDismissed(storage,cardSuccessKey({...mint})),true);
  assert.equal(cardSuccessDismissed(memory(),key),false);
});
test('dismissal is scoped to chain, Registry, wallet, token and mint transaction', () => {
  const storage=memory(), key=cardSuccessKey(mint);
  dismissCardSuccess(storage,key);
  assert.equal(cardSuccessDismissed(storage,cardSuccessKey({...mint,account:'0xwallet',hash:'0xmint'})),true);
  for (const change of [{chainId:8453},{registry:'0xother'},{account:'0xother'},{token:2n},{hash:'0xnewmint'}])
    assert.equal(cardSuccessDismissed(storage,cardSuccessKey({...mint,...change})),false);
});
test('an unavailable store does not break rendering or dismissal', () => {
  const unavailable={getItem(){throw Error('unavailable')},setItem(){throw Error('unavailable')}};
  assert.equal(cardSuccessDismissed(unavailable,cardSuccessKey(mint)),false);
  assert.doesNotThrow(()=>dismissCardSuccess(unavailable,cardSuccessKey(mint)));
});
