import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, configure, freezeRequest } from '../_settings.mjs';

test('each request retains timing and outcome after controls change', () => {
  const settings = { ...defaults };
  configure(settings, { nextAnswer: 'false', pickup: 7, delivery: 'hold', transactionSeconds: 3 });
  const request = freezeRequest(settings);
  configure(settings, { nextAnswer: 'true', pickup: 0, delivery: 'normal', transactionSeconds: 0 });
  assert.equal(request.nextAnswer, 'false');
  assert.equal(request.pickup, 7);
  assert.equal(request.delivery, 'hold');
  assert.equal(request.transactionSeconds, 3);
  assert.ok(Object.isFrozen(request));
});

test('invalid delay or outcome cannot mutate settings', () => {
  const settings = { ...defaults };
  assert.throws(() => configure(settings, { pickup: -1 }), /pickup/);
  assert.throws(() => configure(settings, { delivery: 'pretend' }), /delivery/);
  assert.throws(() => configure(settings, { attestAfterSeconds: Infinity }), /attestAfterSeconds/);
  assert.deepEqual(settings, defaults);
});

test('wallet and read delays freeze with the submitted request', () => {
  const settings = { ...defaults };
  configure(settings, { walletSeconds: 4, approvalSeconds: 9, preflightSeconds: 2, artworkSeconds: 5 });
  const request = freezeRequest(settings);
  configure(settings, { walletSeconds: 0, approvalSeconds: null, preflightSeconds: 0, artworkSeconds: 0 });
  assert.deepEqual(
    [request.walletSeconds, request.approvalSeconds, request.preflightSeconds, request.artworkSeconds],
    [4, 9, 2, 5],
  );
  assert.equal(settings.approvalSeconds, null);
});

test('new delays accept bounded fractional seconds and reject invalid patches atomically', () => {
  for (const key of ['walletSeconds', 'approvalSeconds', 'preflightSeconds', 'artworkSeconds']) {
    const settings = { ...defaults };
    configure(settings, { [key]: 0.25 });
    assert.equal(settings[key], 0.25);
    configure(settings, { [key]: 600 });
    for (const value of [-1, 601, Infinity, NaN, '3', false, ...(key === 'approvalSeconds' ? [] : [null])]) {
      const before = { ...settings };
      assert.throws(() => configure(settings, { nextAnswer: 'false', [key]: value }), new RegExp(key));
      assert.deepEqual(settings, before);
    }
  }
});
