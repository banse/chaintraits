import test from 'node:test';
import assert from 'node:assert/strict';
import { routeInfo } from '../src/task-navigation.mjs';
import { oracleHistoryLink, oracleRequestLink, oracleRequestSelection, pendingRequestSnapshots } from '../src/fact-check/request-model.mjs';

const wallet = '0x1111111111111111111111111111111111111111';
const hash = `0x${'22'.repeat(32)}`;
const requestId = `0x${'33'.repeat(32)}`;
const fact = { id: 601, name: 'Swarmed', requestId, blockNumber: 26274285n };
const step = { state: 'pending', hash, call: { functionName: 'upgrade', args: [601] } };

test('a saved fact links to its actual request and historical agents without treating its completion block as the request block', () => {
  const link = oracleHistoryLink(wallet, { factId: 601, requestId, blockNumber: 26299999n });
  const route = routeInfo(link);
  assert.equal(route.query.get('view'), 'history');
  assert.equal(route.query.has('block'), false);
  assert.deepEqual(oracleRequestSelection(route.query), { wallet, requestId, factId: 601, blockNumber: undefined });
  assert.equal(routeInfo(oracleRequestLink(wallet, fact)).query.has('view'), false);
});
const journal = { plan: { account: wallet, lines: [{ id: 601, name: 'Swarmed' }] }, steps: [step] };

test('a live request link round-trips only its public request identity', () => {
  const link = oracleRequestLink(wallet, fact);
  const route = routeInfo(link);
  assert.match(link, /^#\/fact-check\?/);
  assert.equal(route.route, '/fact-check');
  assert.deepEqual(oracleRequestSelection(route.query), {
    wallet, requestId, factId: 601, blockNumber: 26274285n,
  });
  assert.equal(routeInfo('#/fact-check').route, '/fact-check');
  assert.equal(routeInfo('#/fact-check-demo').route, '/fact-check');
});

test('old oracle bookmarks open Fact Check without losing the selected request', () => {
  const link = oracleRequestLink(wallet, fact).replace('#/fact-check', '#/oracle');
  const route = routeInfo(link);
  assert.equal(route.route, '/fact-check');
  assert.deepEqual(oracleRequestSelection(route.query), {
    wallet, requestId, factId: 601, blockNumber: 26274285n,
  });
});

test('wallet-only Fact Check links select history without inventing an oracle request', () => {
  for (const target of [wallet, 'example.eth']) {
    const route = routeInfo(`#/fact-check?wallet=${target}`);
    assert.equal(oracleRequestSelection(route.query), null);
    assert.equal(route.query.get('wallet'), target);
  }
});

test('empty and malformed links cannot select fabricated requests', () => {
  assert.equal(oracleRequestSelection(new URLSearchParams()), null);
  for (const query of [
    `wallet=${wallet}&request=${requestId}&fact=NaN`,
    `wallet=not-a-wallet&request=${requestId}&fact=601`,
    `wallet=${wallet}&request=0x1234&fact=601`,
    `wallet=${wallet}&request=${requestId}&fact=601&block=-1`,
  ]) assert.throws(() => oracleRequestSelection(new URLSearchParams(query)), /valid|incomplete/i);
});

test('only a broadcast oracle fee action starts the transaction hive', () => {
  const [snapshot] = pendingRequestSnapshots(journal, wallet);
  assert.equal(snapshot.phase, 'tx');
  assert.equal(snapshot.factId, 601);
  assert.equal(snapshot.transactionHash, hash);
  assert.equal(snapshot.mode, 'live');
  assert.equal(snapshot.requestId, undefined);
  assert.equal(snapshot.result, null);
  assert.equal(snapshot.registryStored, false);
  assert.equal(snapshot.quorum, null);
  assert.equal(snapshot.question, '');
  assert.deepEqual(snapshot.agents, []);
  for (const state of ['ready', 'awaiting signature', 'unknown', 'failed', 'rejected', 'cancelled', 'replaced']) {
    assert.deepEqual(pendingRequestSnapshots({ ...journal, steps: [{ ...step, state }] }, wallet), []);
  }
  for (const functionName of ['approve', 'mintCard', 'registerSpec', 'applySharedFact']) {
    assert.deepEqual(pendingRequestSnapshots({ ...journal, steps: [{ ...step, call: { ...step.call, functionName } }] }, wallet), []);
  }
  assert.deepEqual(pendingRequestSnapshots({ ...journal, steps: [{ ...step, hash: undefined }] }, wallet), []);
  assert.deepEqual(pendingRequestSnapshots(journal, '0x9999999999999999999999999999999999999999'), []);
});

test('a confirmed request bridges to admission without claiming quorum or a fact', () => {
  const confirmed = { ...step, state: 'confirmed', result: { facts: [fact] } };
  const [snapshot] = pendingRequestSnapshots({ ...journal, steps: [confirmed] }, wallet);
  assert.equal(snapshot.phase, 'admission');
  assert.equal(snapshot.requestId, requestId);
  assert.equal(snapshot.registryStored, false);
  assert.equal(snapshot.result, null);
  assert.deepEqual(pendingRequestSnapshots({ ...journal, steps: [{ ...step, state: 'confirmed' }] }, wallet), []);
  assert.equal(pendingRequestSnapshots({ ...journal, steps: [{ ...step, call: { functionName: 'requestSharedFact', args: [1201] } }] }, wallet)[0].factId, 1201);
});
