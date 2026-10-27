import test from 'node:test';
import assert from 'node:assert/strict';
import { claimedFactRows, factGroup, FACT_GROUPS } from '../src/claimed-facts.mjs';

const traits = [
  { id: 101, name: 'Direct', class: 'direct', rule: 'A direct snapshot' },
  { id: 601, name: 'Swarmed', class: 'panel', rule: 'Accepted jobs' },
];
const community = { id: 10001, name: 'Community rule', kind: 4, threshold: 1n, fromBlock: 2n, toBlock: 3n,
  item: 'function balanceOf(address) view returns (uint256)', op: 1, target: '0x1111111111111111111111111111111111111111' };

test('claimed facts combine held builtin and community records without duplicates', () => {
  const rows = claimedFactRows({ token: 7n, traits: [601, 101], verifiedSpecs: [601, 10001] }, traits, [community]);
  assert.deepEqual(rows.map(row => row.id), [101, 601, 10001]);
  assert.deepEqual(rows.map(row => row.group), ['direct', 'oracle', 'community']);
  assert.equal(rows[1].meaning, 'Did this wallet complete at least 3 accepted IMD swarm jobs while holding an IDMD seat?');
  assert.equal(rows[2].name, 'Community rule');
  assert.equal(rows[2].meaning, 'Did balanceOf(this wallet) on 0x1111…1111 return at least 1 at block 3?');
});

test('a cardless wallet shows verified facts but never labels a live direct preview as claimed', () => {
  const rows = claimedFactRows({ token: 0n, traits: [101, 601], verifiedSpecs: [10001] }, traits, [community]);
  assert.deepEqual(rows.map(row => row.id), [601, 10001]);
  assert.deepEqual(claimedFactRows(null, traits), []);
});

test('claimed facts include every verified community record beyond the artwork display limit', () => {
  const ids = Array.from({ length: 42 }, (_, i) => 10001 + i);
  const rows = claimedFactRows({ token: 7n, traits: [], verifiedSpecs: ids }, traits, [community]);
  assert.equal(rows.length, 42);
  assert.equal(rows.at(-1).id, 10042);
  assert.match(rows.at(-1).meaning, /could not be read/);
});

test('Claimed Wallet Facts and Choose facts to mint share three groups with the same titles', () => {
  assert.deepEqual(FACT_GROUPS.map(([, title]) => title), ['Direct facts', 'Oracle-verified facts', 'Community facts']);
  assert.deepEqual([101, 601, 10001].map(id => factGroup(id, traits)), ['direct', 'oracle', 'community']);
});
