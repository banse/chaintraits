import test from "node:test";
import assert from "node:assert/strict";
// These pre-indexer regressions deliberately verify the retained chain fallback.
test.beforeEach(t => {
  const original = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, options) => String(url).startsWith("https://sworn.vibingco.de/api/")
    ? Promise.resolve(new Response("null")) : original(url, options));
});
import {
  parseAbiItem,
  encodeAbiParameters,
  encodeEventTopics,
  toHex,
} from "viem";
import {
  checkEligibility,
  eligibilityText,
  NOT_CHECKABLE,
} from "../src/eligibility.mjs";
import {
  progressCounts,
  panelAgreement,
  agreedList,
  sameList,
  oracleProgressReader,
  questionWallet,
  WalletQuestionMismatch,
} from "../src/oracle-progress.mjs";
import {
  lastPersonalRequests,
  lastRequestText,
  registryOutcome,
  NO_FACT,
} from "../src/request-outcomes.mjs";
const wallet = "0x2000000000000000000000000000000000000001";
const other = "0x3000000000000000000000000000000000000002";
const spec = {
  kind: 1,
  target: other,
  item: "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount)",
  arg: "contributor",
  fixedArg: "hour",
  fixedVal: 64n,
  sumArg: "",
  threshold: 2n,
  fromBlock: 10n,
  toBlock: 4010n,
};
function log({
  who = wallet,
  hour = 64n,
  amount = 1n,
  block = 10n,
  index = 0,
  s = spec,
} = {}) {
  const event = parseAbiItem(s.item);
  return {
    address: s.target,
    blockNumber: toHex(block),
    blockHash: "0x" + "ab".repeat(32),
    transactionHash: "0x" + "cd".repeat(32),
    logIndex: toHex(index),
    removed: false,
    topics: encodeEventTopics({
      abi: [event],
      eventName: event.name,
      args: { contributor: who, hour, to: who },
    }),
    data: encodeAbiParameters(
      event.inputs.filter((p) => !p.indexed),
      [amount],
    ),
  };
}
const member = (answer) => ({ ok: true, answer: { answer } });
const panel = (answers, extra = {}) => ({
  status: "assessing",
  answerType: "uint256",
  panelSize: 5,
  quorum: 3,
  members: answers.map(member),
  ...extra,
});
for (const kind of [1, 2])
  test(`1 kind ${kind} counts threshold votes, not identical answers; quorum survives attestation`, () => {
    const s = { kind, threshold: 20n };
    for (const status of ["assessing", "attested"]) {
      const r = panel(["20", "21", "90071992547409930", "19"], { status });
      const counts = progressCounts(r, s);
      assert.equal(counts.met, 3);
      assert.equal(counts.below, 1);
      assert.equal(
        panelAgreement(r, s),
        "Panel agreed: 3 of 3 needed found the rule met (at least 20). Finishing: the oracle signs the answer and delivers it to the Registry; the fact appears on your card once the Registry stores it.",
      );
      assert.equal(
        panelAgreement(panel(["0", "1", "19"], { status }), s),
        "Panel agreed: below 20. The fact is not proven.",
      );
    }
    assert.equal(
      progressCounts(panel([true, "-1", null, Number.MAX_SAFE_INTEGER + 1]), s)
        .met,
      0,
    );
  });
test("1 boolean quorum true and false survives attestation, and Registry end states are exact", () => {
  for (const status of ["assessing", "attested"]) {
    assert.match(
      panelAgreement(
        panel([true, true, true], { answerType: "bool", status }),
        { kind: 5 },
      ),
      /^Panel agreed: 3 of 3 needed said true\. Finishing:/,
    );
    assert.equal(
      panelAgreement(
        panel([false, false, false], { answerType: "bool", status }),
        { kind: 5 },
      ),
      "Panel agreed: false. The fact is not proven.",
    );
  }
  assert.equal(
    registryOutcome({ eventName: "Verified" }),
    "Stored by the Registry for this wallet. If it has a card, the card reflects this fact.",
  );
  assert.equal(
    registryOutcome({ eventName: "Missed", args: { reason: 8 } }),
    "Not stored by the Registry: The answer was false. The request price is spent; you can request this fact again.",
  );
  assert.equal(registryOutcome({ eventName: "NoVerdict" }), NO_FACT);
});
test("2 history joins by request id, ignores another wallet, and suppresses a prior failure after a newer request", () => {
  const req = (id, claimant = wallet) => ({
    eventName: "TraitRequested",
    args: { traitId: 701, claimant, requestId: id },
    blockNumber: 10n,
  });
  for (const [eventName, reason, ending] of [
    ["Missed", 8, "answer false"],
    ["Missed", 9, "not stored, Malformed answer"],
    ["NoVerdict", 0, "no verdict"],
    ["Abandoned", 0, "abandoned"],
  ]) {
    const outcome = { eventName, args: { requestId: "one", reason } };
    const rows = lastPersonalRequests(
      [
        req("one"),
        outcome,
        req("other", other),
        { ...outcome, args: { requestId: "other", reason: 9 } },
      ],
      wallet,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0][1].outcome, outcome);
    assert.equal(
      lastRequestText(outcome, 1792600000n),
      `Last request 2026-10-21 16:26 UTC: ${ending}`,
    );
    assert.equal(
      lastPersonalRequests([req("one"), outcome, req("new")], wallet).length,
      0,
    );
    assert.equal(
      lastPersonalRequests(
        [req("one"), { eventName: "Verified", args: { requestId: "one" } }],
        wallet,
      ).length,
      0,
    );
  }
});
test("3 list comparison is ordered and case-insensitive; attested list overrides the most common", () => {
  const a = [wallet, other],
    b = [other, wallet];
  const r = panel([a, a.map((v) => v.toUpperCase()), b], {
    answerType: "address[]",
  });
  assert.deepEqual(agreedList(r), a);
  assert.ok(
    sameList(
      a,
      a.map((v) => v.toUpperCase()),
    ),
  );
  assert.ok(!sameList(a, b));
  assert.deepEqual(
    agreedList({ ...r, status: "attested", answer: { answer: b } }),
    b,
  );
});
test("4/5 claimant matching without a connected wallet, no curator mislabel, job retained across matched/exact/confirmed", async () => {
  const id = "23474d49-bf7c-40e0-8dad-41636c73ea84";
  const pending = {
    claimant: wallet,
    registry: other,
    chainId: 1,
    questionHash: "hash",
    requestedAt: 1n,
    requestId: "request",
    transactionHash: "0x" + "aa".repeat(32),
  };
  let exact = false;
  const r = {
    ...panel([true], { answerType: "bool" }),
    id,
    createdAt: new Date(1000).toISOString(),
    consumer: { verifyingContract: other },
    questionHash: "hash",
    question: `At the Curator ${other}, was ${wallet} pretrained?`,
  };
  const load = oracleProgressReader(async (url) => ({
    ok: true,
    json: async () =>
      url.includes("/intake/")
        ? {
            entries: exact
              ? [
                  {
                    requestId: "request",
                    admission: { result: { requestId: id } },
                  },
                ]
              : [],
          }
        : url.includes("?q=")
          ? { requests: [{ ...r, jobId: "retained-job" }] }
          : r,
  }));
  assert.equal((await load(pending)).jobId, "retained-job");
  exact = true;
  assert.equal((await load(pending)).jobId, "retained-job");
  const confirmed = {
    ...pending,
    oracleRequestId: "0x23474d49bf7c40e08dad41636c73ea84" + "00".repeat(16),
  };
  assert.equal((await load(confirmed)).jobId, "retained-job");
  assert.equal(questionWallet(r, pending), wallet);
  r.question = `At ${other}, was this wallet pretrained?`;
  assert.equal(questionWallet(r, pending), null);
  await assert.rejects(
    load(confirmed),
    (e) =>
      e instanceof WalletQuestionMismatch &&
      e.wallet === wallet &&
      e.message === "This request is not about this wallet.",
  );
});
test("6 count reads bounded inclusive chunks, filters claimant/fixed value, sums raw integers", async () => {
  const calls = [];
  const rows = [
    log(),
    log({ index: 1 }),
    log({ who: other, index: 2 }),
    log({ hour: 63n, index: 3 }),
  ];
  const client = {
    request: async (p) => {
      calls.push(p);
      const f = p.params[0];
      return rows.filter(
        (l) =>
          BigInt(l.blockNumber) >= BigInt(f.fromBlock) &&
          BigInt(l.blockNumber) <= BigInt(f.toBlock),
      );
    },
  };
  const met = await checkEligibility(client, async () => spec, wallet, 10001);
  assert.equal(met.state, "met");
  assert.match(met.found, /2 matching events/);
  assert.deepEqual(
    calls.map((p) => [p.params[0].fromBlock, p.params[0].toBlock]),
    [
      [toHex(10), toHex(2009)],
      [toHex(2010), toHex(4009)],
      [toHex(4010), toHex(4010)],
    ],
  );
  assert.equal(calls[0].params[0].topics[1].slice(-40), wallet.slice(2));
  assert.equal(BigInt(calls[0].params[0].topics[2]), 64n);
  const summed = await checkEligibility(
    client,
    async () => ({ ...spec, kind: 2, sumArg: "amount", threshold: 3n }),
    wallet,
    10001,
  );
  assert.equal(summed.state, "not-met");
  assert.match(summed.found, /sum 2 in raw units/);
  assert.equal(
    eligibilityText(summed, 1250000000000000000n),
    `This wallet does not meet this rule (${summed.found}). The panel will most likely answer false and the 1.25 IMD request price is spent. Source: chain scan.`,
  );
  assert.match(
    eligibilityText(met, 1n),
    /^Our check of the public chain data finds this rule met \(.+\)\. The panel decides\. Source: chain scan\.$/,
  );
});
test("6 no matching logs is not-met; refusal, malformed logs and timeout are advisory unknown", async () => {
  assert.equal(
    (
      await checkEligibility(
        { request: async () => [] },
        async () => spec,
        wallet,
        10001,
      )
    ).state,
    "not-met",
  );
  for (const request of [
    async () => {
      throw Error("RPC refuses");
    },
    async () => [{}],
  ]) {
    const r = await checkEligibility(
      { request },
      async () => spec,
      wallet,
      10001,
    );
    assert.equal(r.state, "unknown");
    assert.equal(eligibilityText(r, 1n), NOT_CHECKABLE + " Source: chain scan.");
  }
  let resolve,
    calls = 0;
  const r = await checkEligibility(
    {
      request: () => {
        calls++;
        return new Promise((r) => {
          resolve = r;
        });
      },
    },
    async () => spec,
    wallet,
    10001,
    { timeoutMs: 5 },
  );
  assert.equal(r.state, "unknown");
  resolve([]);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
});
test("6 provider caps split bounded chunks instead of treating a capped response as complete", async () => {
  const calls = [];
  const r = await checkEligibility(
    {
      request: async (p) => {
        const f = p.params[0];
        calls.push(f);
        return BigInt(f.toBlock) - BigInt(f.fromBlock) >= 1000n
          ? Array(1000).fill({})
          : [];
      },
    },
    async () => spec,
    wallet,
    10001,
  );
  assert.equal(r.state, "not-met");
  assert.ok(calls.length > 3);
  assert.ok(
    calls.every((f) => BigInt(f.toBlock) - BigInt(f.fromBlock) < 2000n),
  );
});
test("6 1301 nonce at block 25769870, kind 4 historical view and all comparisons", async () => {
  const calls = [];
  const r = await checkEligibility(
    {
      request: async (p) => {
        calls.push(p);
        return "0x14";
      },
    },
    async () => ({ ...spec, kind: 5, threshold: 20n, toBlock: 25769870n }),
    wallet,
    1301,
  );
  assert.equal(r.state, "met");
  assert.deepEqual(calls, [
    { method: "eth_getTransactionCount", params: [wallet, toHex(25769870)] },
  ]);
  for (const [op, met] of [
    [1, true],
    [2, false],
    [3, true],
    [4, false],
    [5, true],
  ]) {
    const r = await checkEligibility(
      {
        request: async (p) => {
          assert.equal(p.method, "eth_call");
          assert.equal(p.params[1], toHex(spec.toBlock));
          return encodeAbiParameters([{ type: "uint256" }], [2n]);
        },
      },
      async () => ({
        ...spec,
        kind: 4,
        item: "function balanceOf(address) view returns (uint256)",
        op,
      }),
      wallet,
      10001,
    );
    assert.equal(r.state, met ? "met" : "not-met");
  }
});
test("6 601 seat history alone never confirms accepted-work eligibility", async () => {
  const s = {
    ...spec,
    kind: 6,
    target: "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D",
    fromBlock: 25090085n,
    toBlock: 0n,
  };
  const event = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  );
  const calls = [];
  const r = await checkEligibility(
    {
      request: async (p) => {
        calls.push(p);
        if (p.method === "eth_blockNumber") return toHex(25100000);
        return [
          {
            ...log({ s: { ...s, item: spec.item }, block: s.fromBlock }),
            data: "0x",
            topics: encodeEventTopics({
              abi: [event],
              eventName: "Transfer",
              args: { from: other, to: wallet, tokenId: 1n },
            }),
          },
        ];
      },
    },
    async () => s,
    wallet,
    601,
  );
  assert.equal(r.state, "unknown");
  assert.equal(r.reason, "accepted-work-unchecked");
  assert.match(eligibilityText(r, 1n), /eligibility is not confirmed/i);
  assert.match(eligibilityText(r, 1n), /3 accepted feedback entries/);
  assert.doesNotMatch(eligibilityText(r, 1n), /finds this rule met/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params[0].address, s.target);
  assert.equal(calls[1].params[0].fromBlock, toHex(25090085));
  assert.equal(calls[1].params[0].topics[2].slice(-40), wallet.slice(2));
});

test("6 601 never-held wallet is not-met; unavailable seat history is unknown", async () => {
  const s = { ...spec, kind: 6, fromBlock: 25090085n, toBlock: 0n,
    target: "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D" };
  for (const unavailable of [false, true]) {
    const r = await checkEligibility({ request: async (p) => {
      if (p.method === "eth_blockNumber") return toHex(25100000);
      if (unavailable) throw Error("Cannot read the chain");
      return [];
    } }, async () => s, wallet, 601);
    assert.equal(r.state, unavailable ? "unknown" : "not-met");
  }
});

test("4 matched detail rechecks the claimant even when the listing question was correct", async () => {
  const pending = {
    claimant: wallet,
    registry: other,
    chainId: 1,
    questionHash: "hash",
    requestedAt: 1n,
  };
  const row = {
    ...panel([true], { answerType: "bool" }),
    id: "matched",
    createdAt: new Date(1000).toISOString(),
    consumer: { verifyingContract: other },
    questionHash: "hash",
    question: `At ${other}, did ${wallet} qualify?`,
  };
  const load = oracleProgressReader(async (url) => ({
    ok: true,
    json: async () =>
      url.includes("?q=")
        ? { requests: [row] }
        : { ...row, question: `Did ${other} qualify?` },
  }));
  await assert.rejects(
    load(pending),
    (e) => e instanceof WalletQuestionMismatch && e.wallet === wallet,
  );
});

test("6 an unavailable live price never renders a stale amount or throws", () => {
  assert.equal(
    eligibilityText(
      { state: "not-met", found: "0 matching events" },
      undefined,
    ),
    NOT_CHECKABLE,
  );
});

test("6 a noncanonical boolean filter cannot be coerced into a matching true log", async () => {
  const result = await checkEligibility(
    {
      request: async () => {
        throw Error("No read expected");
      },
    },
    async () => ({
      ...spec,
      item: "event Flag(address indexed contributor, bool indexed active)",
      fixedArg: "active",
      fixedVal: 2n,
    }),
    wallet,
    10001,
  );
  assert.equal(result.state, "unknown");
});
