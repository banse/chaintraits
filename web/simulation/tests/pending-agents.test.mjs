import test from 'node:test';
import assert from 'node:assert/strict';
import { createOracle } from '../_oracle.mjs';
import { defaults } from '../_settings.mjs';
import { liveSnapshot } from '../../src/fact-check/live-model.mjs';
import { progressCounts } from '../../src/oracle-progress.mjs';

const wallet = '0x2222222222222222222222222222222222222222';
const registry = '0x1111111111111111111111111111111111111111';
const identity = {
  wallet, claimant: wallet, registry, chainId: 1, factId: 1301,
  requestId: `0x${'a'.repeat(64)}`, questionHash: `0x${'b'.repeat(64)}`,
  requestedAt: 1000n, blockNumber: 100n,
};
const makeRecord = () => ({
  id: 'test-oracle', jobId: 'test-job', status: 'assessing',
  createdAt: new Date(1000000).toISOString(),
  question: `Does ${wallet} satisfy the rule?`, questionHash: identity.questionHash,
  consumer: { chainId: 1, verifyingContract: registry }, answerType: 'bool',
  panelSize: 3, quorum: 2, members: [], agreement: null,
  _seats: [601, 1203, 77], _config: { ...defaults, pickup: 0 },
});

test('assigned simulation agents expose identities while working without counting answers', () => {
  const oracle = createOracle({}, { panel: {} });
  try {
    const record = makeRecord();
    oracle.records.set(record.id, record);
    const detail = oracle.api(`/oracle/requests/${record.id}`, '').body;
    const snapshot = liveSnapshot({ identity, progress: detail });
    assert.deepEqual(snapshot.agents.map(agent => agent.tokenId), ['601', '1203', '77']);
    assert.ok(snapshot.agents.every(agent => agent.state === 'pending'));
    assert.equal(snapshot.phase, 'panel');
    assert.equal(snapshot.quorumReached, false);
    assert.equal(progressCounts(detail).answered, 0);
    assert.equal(record.members.length, 0, 'assigned seats are not submitted answers');
    assert.equal('_seats' in detail, false);
  } finally {
    oracle.stop();
  }
});

test('working simulation identities stay stable as responses arrive out of order', () => {
  const oracle = createOracle({}, { panel: {} });
  try {
    const record = makeRecord();
    const before = liveSnapshot({ identity, progress: oracle.publicDetail(record) });
    record.members.push({ tokenId: 1203, ok: true, answer: { answer: true } });
    const detail = oracle.publicDetail(record);
    const after = liveSnapshot({ identity, progress: detail });
    assert.deepEqual(after.agents.map(agent => agent.key), before.agents.map(agent => agent.key));
    assert.deepEqual(after.agents.map(agent => agent.state), ['pending', 'agree', 'pending']);
    assert.equal(progressCounts(detail).answered, 1);
    assert.equal(after.quorumReached, false);
    assert.equal(record.members.length, 1);
  } finally {
    oracle.stop();
  }
});
