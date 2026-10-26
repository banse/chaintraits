import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSettings } from '../_profiles.mjs';

test('delayed profile covers each wait without mutating the default instance', () => {
  const ordinary = profileSettings('default');
  const delayed = profileSettings('delayed');
  for (const key of ['walletSeconds', 'approvalSeconds', 'preflightSeconds', 'artworkSeconds',
    'transactionSeconds', 'pickup', 'firstAnswerSeconds', 'answerEverySeconds',
    'attestAfterSeconds', 'deliverAfterSeconds', 'registrySeconds']) assert.ok(delayed[key] > 0, key);
  delayed.pickup = 0;
  assert.equal(profileSettings('delayed').pickup, 12, 'reset restores the profile');
  assert.equal(ordinary.walletSeconds, 0, 'existing default behavior stays unchanged');
  assert.equal(ordinary.approvalSeconds, null);
});

test('unknown profiles fail before any runtime is started', () => {
  assert.throws(() => profileSettings('typo'), /Unknown simulation profile/);
});
