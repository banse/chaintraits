import test from 'node:test';
import assert from 'node:assert/strict';
import { factMintState } from '../src/fact-mint-action.mjs';

const wallet = '0x2000000000000000000000000000000000000001';
const facts = { address: wallet, joined: true, traits: [], verifiedSpecs: [], pending: {} };
const base = { wallet, facts, id: 601, kind: 5, check: { state: 'met' } };
const zero = `0x${'0'.repeat(64)}`;
const request = `0x${'1'.repeat(64)}`;

test('known ineligible, already claimed and pending facts cannot be requested', () => {
  assert.equal(factMintState(base), 'request');
  assert.equal(factMintState({ ...base, check: { state: 'not-met' } }), 'ineligible');
  assert.equal(factMintState({ ...base, facts: { ...facts, traits: [601] } }), 'claimed');
  assert.equal(factMintState({ ...base, facts: { ...facts, verifiedSpecs: [601] } }), 'claimed');
  assert.equal(factMintState({ ...base, facts: { ...facts, pending: { 601: request } } }), 'pending');
  assert.equal(factMintState({ ...base, id: 701, facts: { ...facts, joined: false } }), 'ineligible');
});

test('wallet transitions and unfinished/unavailable checks never expose an old eligible action', () => {
  assert.equal(factMintState({ ...base, wallet: undefined }), 'wallet-unavailable');
  assert.equal(factMintState({ ...base, wallet: '0x3000000000000000000000000000000000000001' }), 'wallet-unavailable');
  assert.equal(factMintState({ ...base, facts: null }), 'wallet-unavailable');
  assert.equal(factMintState({ ...base, check: undefined }), 'checking');
  assert.equal(factMintState({ ...base, check: { state: 'checking' } }), 'checking');
  assert.equal(factMintState({ ...base, check: { state: 'unknown' } }), 'unavailable');
});

test('Swarmed may request panel verification of accepted work without claiming local eligibility', () => {
  assert.equal(factMintState({ ...base, check: { state: 'unknown', reason: 'accepted-work-unchecked' } }), 'request');
  assert.equal(factMintState({ ...base, id: 1301, check: { state: 'unknown', reason: 'accepted-work-unchecked' } }), 'unavailable');
});

test('shared requests and gas-only application require readable list state and actual membership', () => {
  const shared = { fact: [zero, 0n, 0n], pending: zero };
  const input = { ...base, id: 1201, kind: 3, shared };
  assert.equal(factMintState(input), 'request');
  assert.equal(factMintState({ ...input, shared: undefined }), 'checking');
  assert.equal(factMintState({ ...input, readError: true }), 'unavailable');
  assert.equal(factMintState({ ...input, shared: { ...shared, pending: request } }), 'pending');
  assert.equal(factMintState({ ...input, facts: { ...facts, joined: false } }), 'ineligible');
  const stored = { ...shared, fact: [request, 0n, 1n], result: { attestation: {} }, list: [wallet] };
  assert.equal(factMintState({ ...input, shared: stored }), 'apply');
  assert.equal(factMintState({ ...input, shared: { ...stored, list: ['0x3000000000000000000000000000000000000001'] } }), 'excluded');
  assert.equal(factMintState({ ...input, shared: { ...stored, result: null } }), 'unavailable');
  assert.equal(factMintState({ ...input, shared: stored, facts: { ...facts, traits: [1201] } }), 'claimed');
});
