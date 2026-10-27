import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkEligibility, eligibilityText } from "../src/eligibility.mjs";
import { indexedRules, indexedWallet } from "../src/indexer.mjs";
import {
  communityFact,
  describeCommunityRule,
  fixedRuleValue,
  summarizeCommunityRule,
} from "../src/community-rule.mjs";
import {
  factHistoryRows,
  mergeFactHistory,
  shortFactQuestion,
  shortFactRule,
} from "../src/fact-check/history-model.mjs";
import {
  discoverRequests,
  matchedOutcome,
} from "../src/fact-check/live-model.mjs";

const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`./fixtures/indexer/${name}.json`, import.meta.url),
    ),
  );
const eligible = fixture("eligible"),
  wallet = fixture("wallet");
const rule = fixture("rules").rules[0];
const deployment = JSON.parse(
  fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
);
const registry = deployment.contracts.find(
  (contract) => contract.name === "Registry",
).address;
const noChain = {
  request() {
    assert.fail("The supported indexer answer must avoid RPC");
  },
};
const noSpec = () =>
  assert.fail("The supported indexer answer must avoid specOf");
const reply = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

test("community eligibility uses complete indexer counts 5, 47 and 0 and names the source", async (t) => {
  for (const name of ["eligible", "eligible-47", "ineligible"]) {
    const data = fixture(name);
    t.mock.method(globalThis, "fetch", async (url) => {
      assert.equal(
        String(url),
        `https://sworn.vibingco.de/api/rules/10001/eligibility?wallet=${data.wallet}`,
      );
      return reply(data);
    });
    const result = await checkEligibility(noChain, noSpec, data.wallet, 10001);
    assert.equal(result.state, data.met ? "met" : "not-met");
    for (const field of [
      "count",
      "threshold",
      "op",
      "met",
      "windowFullyIndexed",
      "lastIndexedBlock",
      "transfers",
    ])
      assert.deepEqual(result[field], data[field]);
    assert.match(
      eligibilityText(result, 500000000000000000n),
      /indexer, block 26,/,
    );
    assert.match(
      result.found,
      new RegExp(`^${data.count} matching .*threshold 5$`),
    );
    t.mock.restoreAll();
  }
});

test("unavailable, unsupported, partial and malformed eligibility all retain the chain scan", async (t) => {
  const cases = [
    null,
    { supported: false },
    { ...eligible, windowFullyIndexed: false },
    { ...eligible, wallet: rule.registrant },
    { ...eligible, met: false },
  ];
  for (const response of cases) {
    t.mock.method(globalThis, "fetch", async () => reply(response));
    const calls = [];
    const result = await checkEligibility(
      {
        request: async (payload) => {
          calls.push(payload);
          return [];
        },
      },
      async () => ({ ...rule, fromBlock: 1n, toBlock: 1n }),
      eligible.wallet,
      10001,
    );
    assert.equal(calls[0].method, "eth_getLogs");
    assert.equal(result.state, "not-met");
    assert.equal(result.source, "chain scan");
    assert.match(eligibilityText(result, 1n), /Source: chain scan/);
    t.mock.restoreAll();
  }
});

test("an unanswered indexer times out promptly and aborts its request before fallback", async (t) => {
  let aborted = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (_, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(options.signal.reason);
          },
          { once: true },
        );
      }),
  );
  const started = performance.now();
  const result = await checkEligibility(
    { request: async () => [] },
    async () => ({ ...rule, fromBlock: 1n, toBlock: 1n }),
    eligible.wallet,
    10001,
  );
  assert.equal(aborted, true);
  assert.ok(performance.now() - started < 2200);
  assert.equal(result.source, "chain scan");
});

test("network, HTTP and JSON failures fall back; malformed collections are optional reads", async (t) => {
  for (const fetcher of [
    async () => {
      throw Error("Network unavailable");
    },
    async () => new Response("Unavailable", { status: 503 }),
    async () => new Response("not JSON"),
    async () => reply({ ...eligible, transfers: [null] }),
  ]) {
    t.mock.method(globalThis, "fetch", fetcher);
    const result = await checkEligibility(
      { request: async () => [] },
      async () => ({ ...rule, fromBlock: 1n, toBlock: 1n }),
      eligible.wallet,
      10001,
    );
    assert.equal(result.source, "chain scan");
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => reply({ rules: [null] }));
  assert.equal(await indexedRules(), null);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () =>
    reply({ ...wallet, requests: [null] }),
  );
  assert.equal(await indexedWallet(wallet.wallet, registry), null);
});

test("catalog snapshot and live checks never ask the indexer", async (t) => {
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("No indexer request for catalog eligibility"),
  );
  for (const id of [701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105]) {
    const expected = { state: "met", found: "snapshot" };
    assert.deepEqual(
      await checkEligibility(noChain, noSpec, eligible.wallet, id, {
        snapshot: async () => expected,
      }),
      expected,
    );
  }
  const nonce = await checkEligibility(
    {
      request: async ({ method }) => {
        assert.equal(method, "eth_getTransactionCount");
        return "0x14";
      },
    },
    async () => ({ kind: 5, threshold: 20n, fromBlock: 1n, toBlock: 1n }),
    eligible.wallet,
    1301,
  );
  assert.equal(nonce.state, "met");
  const seat = await checkEligibility(
    {
      request: async ({ method }) =>
        method === "eth_blockNumber" ? "0x100" : [],
    },
    async () => ({ ...rule, kind: 6, fromBlock: 1n, toBlock: 0n }),
    eligible.wallet,
    601,
  );
  assert.equal(seat.state, "not-met");
});

test("cancelling a wallet check stops indexer and prevents a fallback scan", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_, options) => {
    controller.abort();
    assert.equal(options.signal.aborted, true);
    throw options.signal.reason;
  });
  const result = await checkEligibility(
    noChain,
    noSpec,
    eligible.wallet,
    10001,
    { signal: controller.signal },
  );
  assert.equal(result.state, "unknown");
});

test("rules carry typed fields, readable filters and address-valued fixed filters", async (t) => {
  t.mock.method(globalThis, "fetch", async () => reply({ rules: [rule] }));
  const [spec] = await indexedRules();
  assert.equal(spec.threshold, 5n);
  assert.equal(fixedRuleValue(spec), rule.fixedValAsAddress);
  assert.equal(
    fixedRuleValue({ ...spec, fixedValAsAddress: undefined }),
    rule.fixedValAsAddress,
  );
  assert.equal(communityFact(spec).registrant, rule.registrant);
  assert.equal(
    describeCommunityRule(spec),
    `at least 5 Transfer events of ${rule.target} sent by the wallet to ${rule.fixedValAsAddress} between blocks 26,038,414 and 26,279,931`,
  );
  assert.equal(
    fixedRuleValue({
      ...spec,
      item: "event Value(address indexed from, uint256 indexed to)",
      fixedVal: 5n,
    }),
    "5",
  );
  for (const [kind, text] of [
    [2, "summed value"],
    [3, "top 5 wallets"],
    [4, "returns at least 5"],
    [5, "nonce is at least 5"],
  ]) {
    assert.ok(
      describeCommunityRule({ ...spec, kind, sumArg: "value" }).includes(text),
    );
  }
});

test("wallet indexer reconstructs the same four verified requests and card 2 without fabricated log indices", async (t) => {
  t.mock.method(globalThis, "fetch", async () => reply(wallet));
  const indexed = await indexedWallet(wallet.wallet, registry);
  assert.equal(indexed.card.tokenId, 2);
  assert.equal(indexed.verifiedTraits.length, 4);
  assert.deepEqual(
    discoverRequests(indexed.events, wallet.wallet, registry).map(
      (row) => row.traitId,
    ),
    [1105, 1301, 701, 601],
  );
  const rows = factHistoryRows(indexed.events, {
    wallet: wallet.wallet,
    registry,
    traits: [],
    frozen: { 2: 0n },
  });
  assert.deepEqual(
    rows.map((row) => row.factId),
    [1105, 1301, 701, 601],
  );
  assert.ok(
    rows.every(
      (row) =>
        row.logIndex === undefined && row.origin.eventName === "TraitRequested",
    ),
  );
  assert.equal(mergeFactHistory(rows, rows).length, 4);
  const chainRow = {
    ...rows[0],
    key: `${rows[0].transactionHash}:0`,
    logIndex: 0,
    terminal: { ...rows[0].terminal, source: undefined },
  };
  const mixed = mergeFactHistory(rows, [chainRow]);
  assert.equal(
    mixed.length,
    4,
    "RPC refresh must replace the same indexed write, not duplicate it",
  );
  assert.equal(mixed[0], chainRow);
});

test("all request states map to the existing status models and cross-wallet replies are rejected", async (t) => {
  for (const [state, name] of [
    ["pending", null],
    ["verified", "Verified"],
    ["missed", "Missed"],
    ["noverdict", "NoVerdict"],
    ["abandoned", "Abandoned"],
  ]) {
    const request = {
      ...wallet.requests[0],
      state,
      missedReason: 8,
      noVerdict: {
        status: 2,
        reason: wallet.requests[0].questionHash,
        agreed: 1,
        answered: 2,
      },
    };
    t.mock.method(globalThis, "fetch", async () =>
      reply({ ...wallet, requests: [request] }),
    );
    const indexed = await indexedWallet(wallet.wallet, registry);
    assert.ok(indexed);
    const terminal = indexed.events.find((event) =>
      matchedOutcome(event, {
        registry,
        requestId: request.requestId,
        blockNumber: BigInt(request.requestedBlock),
        factId: request.traitId,
        wallet: wallet.wallet,
        claimant: wallet.wallet,
      }),
    );
    assert.equal(terminal?.eventName || null, name);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () =>
    reply({ ...wallet, wallet: rule.registrant }),
  );
  assert.equal(await indexedWallet(wallet.wallet, registry), null);
});
test("a community rule gets a short line, window and question like the builtin facts", async (t) => {
  t.mock.method(globalThis, "fetch", async () => reply({ rules: [rule] }));
  const [spec] = await indexedRules();
  const fact = communityFact(spec);
  assert.equal(fact.rule, "At least 5 paid requests to the swarm between the start and block 26,279,931");
  assert.equal(fact.window, "Until block 26,279,931");
  assert.equal(fact.detail, describeCommunityRule(spec));
  assert.equal(
    shortFactQuestion(10001, [], [spec]),
    "Did this wallet make at least 5 paid requests to the swarm between the start and block 26,279,931?",
  );
  // Block 26,279,931 was mined at 2026-10-26 22:43:35 UTC.
  const dated = { ...spec, toTime: Date.UTC(2026, 9, 26, 22, 43, 35) / 1000 };
  assert.equal(communityFact(dated).rule, "At least 5 paid requests to the swarm between the start and 2026-10-26");
  assert.equal(
    shortFactQuestion(10001, [], [dated]),
    "Did this wallet make at least 5 paid requests to the swarm between the start and 2026-10-26 (block 26,279,931)?",
  );
  const later = summarizeCommunityRule({ ...spec, fromBlock: 26100000n });
  assert.equal(later.rule, "At least 5 paid requests to the swarm");
  assert.equal(later.window, "Blocks 26,100,000–26,279,931");
  const other = summarizeCommunityRule({ ...spec, fixedVal: 0x1234567890123456789012345678901234567890n });
  assert.equal(other.rule, "At least 5 IMD transfers sent to 0x1234…7890");
  assert.equal(shortFactRule(10001, [], spec), fact.rule);
  assert.equal(shortFactRule(1301, [{ id: 1301, rule: "Account nonce ≥ 20" }], spec), "Account nonce ≥ 20");
  const network = JSON.parse(fs.readFileSync(new URL("../network.json", import.meta.url), "utf8"));
  assert.equal(network.network.pairToken.symbol, "IMD");
  assert.ok(summarizeCommunityRule({ ...spec, fixedVal: 1n, target: network.network.pairToken.address }).rule.includes(" IMD "));
});
