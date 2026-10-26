import test from 'node:test';
import assert from 'node:assert/strict';
import { demoFrame, demoSnapshot, DEMO_FRAMES } from './fixtures/fact-check/demo-model.mjs';

test('demo starts with a pending transaction and no agent answers', () => {
  const snapshot = demoFrame(0, 'test-run', './');
  assert.equal(snapshot.phase, 'tx');
  assert.equal(snapshot.mode, 'demo');
  assert.deepEqual(snapshot.agents, []);
  assert.equal(snapshot.result, null);
});

test('scripted quorum never becomes a Registry fact early', () => {
  const snapshot = demoSnapshot('quorum', 'test-run', './');
  assert.equal(snapshot.agents.filter(a => a.state === 'agree').length, 7);
  assert.equal(snapshot.registryStored, false);
  assert.equal(snapshot.result, null);
});

test('saved fixture returns exact canonical art with static-prefix-safe URL', () => {
  const snapshot = demoFrame(DEMO_FRAMES.length - 1, 'test-run', './');
  assert.equal(snapshot.result, true);
  assert.equal(snapshot.cardImage, './fact-check/after.svg');
  assert.equal(snapshot.wallet, '0x2000000000000000000000000000000000000001');
  assert.equal(snapshot.agents[0].tokenId, '1431');
  assert.equal(snapshot.agents[10].tokenId, '824');
});

test('failed panel is not a false verdict, and offline is last observed data', () => {
  assert.equal(demoSnapshot('failed', 'test-run', './').result, null);
  assert.equal(demoSnapshot('failed', 'test-run', './').quorumReached, false);
  assert.match(demoSnapshot('offline', 'test-run', './').notice, /last observed/i);
});

test('each demo frame retains the same request key and feeds only events already reached', () => {
  let previous = 0;
  for (let i = 0; i < DEMO_FRAMES.length; i++) {
    const snapshot = demoFrame(i, 'test-run', './');
    assert.equal(snapshot.key, 'demo:test-run');
    assert.ok(snapshot.events.length >= previous);
    previous = snapshot.events.length;
  }
});
