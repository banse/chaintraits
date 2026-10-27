import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeAgents, completionKind, phaseStatus, safeImageSource, quorumFamilies, progressSteps, matchingAnswerCount } from '../src/fact-check/canvas-model.mjs';

const agents = states => states.map((state, i) => ({ key: `member-${i}`, tokenId: `${100 + i}`, state }));

test('agreeing identities move into seven slots without copying or losing answers', () => {
  const input = agents(['agree', 'agree', 'disagree', 'agree', 'agree', 'agree', 'agree', 'agree', 'pending', 'queued', 'failed']);
  const result = arrangeAgents(input, 7);
  assert.equal(result.supported, true);
  assert.equal(result.members.filter(m => m.inside && m.agent.state === 'agree').length, 7);
  assert.equal(new Set(result.members.map(m => m.family)).size, input.length);
  assert.deepEqual(result.members.map(m => m.agent), input);
  assert.equal(result.members.find(m => m.agent.state === 'disagree').inside, false);
});

test('arbitrary supported quorum is used, unknown quorum does not become seven', () => {
  assert.equal(quorumFamilies(3).length, 3);
  assert.deepEqual(quorumFamilies(null), []);
  assert.equal(arrangeAgents(agents(['agree', 'agree', 'agree', 'pending', 'pending']), 3).members.filter(m => m.inside && m.agent.state === 'agree').length, 3);
});

test('large panels remain complete and explicitly unsupported by the canvas', () => {
  const input = agents(Array(17).fill('pending'));
  const result = arrangeAgents(input, 11);
  assert.equal(result.supported, false);
  assert.equal(result.members.length, 17);
  assert.ok(result.members.every(m => m.family === null));
  assert.equal(arrangeAgents(agents(['pending']), 13).supported, false);
});

test('unknown identities are preserved without made-up token IDs', () => {
  const input = [{ key: 'opaque-api-key', state: 'unknown' }];
  assert.equal(arrangeAgents(input, null).members[0].agent.tokenId, undefined);
});

test('quorum and delivery cannot reveal a wallet verdict', () => {
  for (const phase of ['panel', 'quorum', 'delivery', 'registry', 'offline']) {
    assert.equal(completionKind({ phase, registryStored: false, result: true }), null);
  }
  assert.equal(completionKind({ phase: 'saved', registryStored: true, result: true }), 'positive');
  assert.equal(completionKind({ phase: 'negative', registryStored: true, result: false }), 'negative');
  assert.equal(completionKind({ phase: 'negative', registryStored: false, result: false }), 'negative');
  assert.equal(completionKind({ phase: 'saved', registryStored: true, result: null }), 'neutral');
  assert.equal(completionKind({ phase: 'failed', registryStored: false, result: null }), null);
});

test('status normalizes pending ellipses and confirms receipt milestones', () => {
  assert.equal(phaseStatus('Waiting for the oracle job.', 'admission'), 'Waiting for the oracle job...');
  assert.equal(phaseStatus('Request confirmed', 'admission'), '✓ Request confirmed');
  assert.equal(phaseStatus('No verdict reached. No fact was added.', 'failed'), 'No verdict reached. No fact was added');
});

test('artwork URLs reject executable schemes and keep data, ipfs and ordinary images', () => {
  assert.equal(safeImageSource('javascript:alert(1)'), undefined);
  assert.equal(safeImageSource('data:text/html,hello'), undefined);
  assert.equal(safeImageSource('data:image/svg+xml;base64,PHN2Zy8+'), 'data:image/svg+xml;base64,PHN2Zy8+');
  assert.equal(safeImageSource('ipfs://bafytest/card.svg'), 'https://ipfs.io/ipfs/bafytest/card.svg');
  assert.equal(safeImageSource('./fact-check/after.svg'), './fact-check/after.svg');
});

test('the six-step overview never confirms signing at quorum or Registry while delivery is pending', () => {
  assert.equal(progressSteps('quorum')[3].state, 'current');
  assert.equal(progressSteps('quorum')[4].state, 'future');
  assert.equal(progressSteps('delivery')[3].state, 'done');
  assert.equal(progressSteps('registry')[5].state, 'current');
  assert.ok(progressSteps('saved').every(step => step.state === 'done'));
  assert.ok(progressSteps('offline').every(step => step.state === 'future'));
});

test('list and count meters never aggregate differing values into a matching quorum', () => {
  const members = agents(['agree', 'agree', 'agree', 'disagree', 'disagree', 'disagree', 'disagree']);
  assert.equal(matchingAnswerCount({ agents: members, answerKind: 'list' }), 3);
  assert.equal(matchingAnswerCount({ agents: members, answerKind: 'count' }), 3);
  assert.equal(matchingAnswerCount({ agents: members, answerKind: 'count', matchingAnswers: 2 }), 2);
  assert.equal(matchingAnswerCount({ agents: members, answerKind: 'boolean' }), 4);
});
