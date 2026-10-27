import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeDirectFacts,
  factHistoryRows,
  mergeFactHistory,
  historyEmpty,
  updateHistory,
  mergeHistoryCoverage,
  shortFactQuestion,
} from "../src/fact-check/history-model.mjs";
const wallet = "0x2222222222222222222222222222222222222222";
const registry = "0x1111111111111111111111111111111111111111";
const traits = [
  { id: 101, name: "Spawned", class: "direct" },
  { id: 201, name: "Zero-shot", class: "direct" },
  { id: 601, name: "Swarmed", class: "panel" },
];
const verified = (block, log = 0, extra = {}) => ({
  address: registry,
  eventName: "Verified",
  blockNumber: BigInt(block),
  logIndex: log,
  transactionHash: `0x${String(block).padStart(64, "0")}`,
  args: {
    claimant: wallet,
    traitId: 601,
    requestId: `0x${String(block).padStart(64, "a")}`,
    oracleRequestId: `0x${"b".repeat(64)}`,
  },
  ...extra,
});
const options = { wallet, registry, traits, frozen: { 12: 17n } };
test("history explains the actual fact, including the seat condition for Swarmed", () => {
  assert.equal(
    shortFactQuestion(601, traits),
    "Did this wallet complete at least 3 accepted IMD swarm jobs while holding an IDMD seat?",
  );
  assert.equal(
    shortFactQuestion(101, [{ id: 101, rule: "Joined WhitelistCurator.sol" }]),
    "Joined WhitelistCurator.sol",
  );
  assert.equal(shortFactQuestion(10001, traits), "");
});
test("community history questions retain the registered condition and block window", () => {
  const spec = {
    id: 10001,
    kind: 1,
    target: registry,
    item: "event Deposited(address indexed contributor, uint256 hour)",
    arg: "contributor",
    fixedArg: "hour",
    fixedVal: 24n,
    threshold: 3n,
    fromBlock: 100n,
    toBlock: 200n,
  };
  const count = shortFactQuestion(10001, traits, [spec]);
  assert.match(count, /at least 3 Deposited events/);
  assert.match(count, /contributor = this wallet/);
  assert.match(count, /hour = 24/);
  assert.match(count, /between blocks 100 and 200/);
  assert.ok(count.includes(`${registry.slice(0, 6)}…${registry.slice(-4)}`));
  assert.match(
    shortFactQuestion(10001, traits, [{ ...spec, kind: 2, sumArg: "amount" }]),
    /summed amount \(raw units\) at least 3/,
  );
  assert.match(
    shortFactQuestion(10001, traits, [
      { ...spec, kind: 3, sumArg: "amount", fixedArg: "" },
    ]),
    /top 3 by summed amount/,
  );
  assert.match(
    shortFactQuestion(10001, traits, [
      {
        ...spec,
        kind: 4,
        item: "function balanceOf(address) view returns (uint256)",
        op: 1,
      },
    ]),
    /balanceOf\(this wallet\) on 0x\w{4}…\w{4} return at least 3 at block 200/,
  );
  assert.match(
    shortFactQuestion(10001, traits, [{ ...spec, kind: 5 }]),
    /nonce at least 3 at block 200/,
  );
});
test("history contains only wallet-bound Verified and nonempty frozen card snapshots", () => {
  const good = verified(10);
  const card = {
    ...verified(12),
    eventName: "CardMinted",
    args: { claimant: wallet, tokenId: 12n },
  };
  const rows = factHistoryRows(
    [
      good,
      card,
      { ...good, eventName: "TraitRequested", blockNumber: 20n },
      { ...good, eventName: "Missed" },
      { ...good, args: { ...good.args, claimant: registry } },
      { ...good, address: wallet },
    ],
    options,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "direct");
  assert.equal(rows[1].kind, "verified");
  assert.equal(rows[1].terminal, good);
});
test("sort uses successful write block and log index, never newer pending request time", () => {
  const rows = factHistoryRows(
    [
      verified(9),
      verified(10, 1),
      verified(10, 4),
      { ...verified(30), eventName: "TraitRequested" },
    ],
    options,
  );
  assert.deepEqual(
    rows.map((r) => [r.blockNumber, r.logIndex]),
    [
      [10n, 4],
      [10n, 1],
      [9n, 0],
    ],
  );
});
test("direct bits use Registry formula and remain a simultaneous single group", () => {
  assert.deepEqual(
    decodeDirectFacts(17n, traits).map((t) => t.id),
    [101, 201],
  );
  const card = {
    ...verified(20),
    eventName: "CardMinted",
    args: { claimant: wallet, tokenId: 12n },
  };
  const rows = factHistoryRows([card], options);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].factId, 0);
  assert.equal(rows[0].directFacts.length, 2);
  assert.equal(
    factHistoryRows([card], { ...options, frozen: { 12: 0n } }).length,
    0,
  );
  assert.throws(
    () => factHistoryRows([card], { ...options, frozen: {} }),
    /snapshot unavailable/i,
  );
});
test("history pages deduplicate successful events and preserve ordering", () => {
  const first = factHistoryRows([verified(10)], options),
    second = factHistoryRows([verified(10), verified(9)], options);
  assert.equal(mergeFactHistory(first, second).length, 2);
  assert.equal(mergeFactHistory(first, second)[0].blockNumber, 10n);
});
test("removed logs never appear as saved facts", () => {
  assert.equal(
    factHistoryRows([verified(10, 0, { removed: true })], options).length,
    0,
  );
});
test("empty means fully scanned without errors, never partial or loading", () => {
  const base = {
    scope: "a",
    rows: [],
    loading: false,
    error: "",
    coverage: { first: 1n, from: 1n, to: 10n, complete: true },
  };
  assert.equal(historyEmpty(base), true);
  assert.equal(historyEmpty({ ...base, loading: true }), false);
  assert.equal(historyEmpty({ ...base, error: "RPC unavailable" }), false);
  assert.equal(
    historyEmpty({ ...base, coverage: { ...base.coverage, complete: false } }),
    false,
  );
});
test("wallet switches reject stale pages and errors preserve known history", () => {
  const state = {
    scope: "new-wallet",
    rows: factHistoryRows([verified(10)], options),
    loading: false,
    error: "",
    coverage: { complete: false },
  };
  assert.equal(updateHistory(state, "old-wallet", { rows: [] }), state);
  const error = updateHistory(state, "new-wallet", {
    error: "Unavailable",
    loading: false,
  });
  assert.equal(error.rows.length, 1);
  assert.equal(historyEmpty(error), false);
});
test("older pages extend the floor without advertising an unscanned new head", () => {
  assert.deepEqual(
    mergeHistoryCoverage(
      { first: 1n, from: 8n, to: 10n, complete: false },
      { first: 1n, from: 1n, to: 7n },
    ),
    { first: 1n, from: 1n, to: 10n, complete: true },
  );
});
test("refresh preserves complete older coverage only when the fresh tail touches it", () => {
  const old = { first: 1n, from: 1n, to: 10n, complete: true };
  assert.deepEqual(
    mergeHistoryCoverage(old, { first: 1n, from: 9n, to: 12n }),
    { first: 1n, from: 1n, to: 12n, complete: true },
  );
  assert.deepEqual(
    mergeHistoryCoverage(old, { first: 1n, from: 11n, to: 13n }),
    { first: 1n, from: 1n, to: 13n, complete: true },
  );
  assert.deepEqual(
    mergeHistoryCoverage(old, { first: 1n, from: 15n, to: 20n }),
    { first: 1n, from: 15n, to: 20n, complete: false },
  );
});
