import test from "node:test";
import assert from "node:assert/strict";
import {
  liveSnapshot,
  discoverRequests,
  bindProgress,
  matchedOutcome,
  selectionGuard,
} from "../src/fact-check/live-model.mjs";
import {
  visiblePolling,
  boundedRange,
} from "../src/fact-check/live-polling.mjs";
import { completionKind } from "../src/fact-check/canvas-model.mjs";

const registry = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const requestId = `0x${"a".repeat(64)}`;
const questionHash = `0x${"b".repeat(64)}`;
const origin = {
  address: registry,
  eventName: "TraitRequested",
  blockNumber: 100n,
  transactionHash: `0x${"c".repeat(64)}`,
  logIndex: 0,
  args: { requestId, claimant: wallet, traitId: 601, questionHash },
};
const identity = {
  registry,
  chainId: 1,
  requestId,
  wallet,
  claimant: wallet,
  questionHash,
  requestedAt: 1000n,
  blockNumber: 100n,
  factId: 601,
  factName: "Swarmed",
  origin,
};
const progress = {
  id: "oracle-1",
  question: `Did ${wallet} work?`,
  questionHash,
  consumer: { verifyingContract: registry, chainId: 1 },
  createdAt: new Date(1000 * 1000).toISOString(),
  status: "attested",
  answerType: "bool",
  panelSize: 3,
  quorum: 2,
  members: [
    { tokenId: "123", ok: true, answer: { answer: true } },
    { tokenId: "456", ok: true, answer: { answer: true } },
  ],
};
const terminal = {
  ...origin,
  eventName: "Verified",
  blockNumber: 101n,
  args: { requestId, traitId: 601, claimant: wallet },
};
const image = "data:image/svg+xml;base64,PHN2Zy8+";

test("API agreement or pending disappearance never means a Registry fact", () => {
  const s = liveSnapshot({
    identity,
    progress,
    hasFact: true,
    cardImage: image,
  });
  assert.equal(s.phase, "delivery");
  assert.equal(s.result, null);
  assert.equal(s.registryStored, false);
});
test("Verified requires fresh hasTrait and real card image before success", () => {
  assert.equal(
    liveSnapshot({
      identity,
      progress,
      terminal,
      hasFact: false,
      token: 1n,
      cardImage: image,
    }).phase,
    "registry",
  );
  assert.equal(
    liveSnapshot({ identity, progress, terminal, hasFact: true, token: 1n })
      .phase,
    "registry",
  );
  const s = liveSnapshot({
    identity,
    progress,
    terminal,
    hasFact: true,
    token: 1n,
    cardImage: image,
  });
  assert.equal(s.phase, "saved");
  assert.equal(s.result, true);
  assert.equal(s.registryStored, true);
});
test("cardless wallet facts are explicit and never invent a card", () => {
  const s = liveSnapshot({ identity, terminal, hasFact: true, token: 0n });
  assert.equal(s.phase, "saved");
  assert.equal(s.cardless, true);
  assert.equal(s.cardImage, undefined);
});
test("wrong wallet, registry, chain, question, time or request cannot bind", () => {
  for (const change of [
    { wallet: registry },
    { registry: wallet },
    { requestId: `0x${"d".repeat(64)}` },
  ])
    assert.equal(matchedOutcome(terminal, { ...identity, ...change }), null);
  for (const change of [
    { consumer: { ...progress.consumer, chainId: 10 } },
    { consumer: { verifyingContract: wallet, chainId: 1 } },
    { questionHash: "0x00" },
    { question: "Another wallet" },
    { createdAt: new Date(0).toISOString() },
  ])
    assert.throws(
      () => bindProgress({ ...progress, ...change }, identity),
      /binding/i,
    );
});
test("chain negative is different from no quorum or unavailable API", () => {
  const missed = {
    ...terminal,
    eventName: "Missed",
    args: { requestId, traitId: 601, reason: 8 },
  };
  const negative = liveSnapshot({
    identity,
    terminal: missed,
    token: 1n,
    cardImage: image,
  });
  assert.equal(negative.phase, "negative");
  assert.equal(negative.result, false);
  assert.equal(completionKind(negative), "negative");
  const failed = liveSnapshot({
    identity,
    terminal: { ...missed, eventName: "NoVerdict" },
  });
  assert.equal(failed.phase, "failed");
  assert.equal(failed.result, null);
  const offline = liveSnapshot({ identity, apiError: "Service unavailable" });
  assert.equal(offline.phase, "offline");
  assert.equal(offline.panelSize, null);
  assert.equal(offline.result, null);
});
test("API outage cannot erase a verified Registry outcome", () => {
  const s = liveSnapshot({
    identity,
    terminal,
    hasFact: true,
    token: 1n,
    cardImage: image,
    apiError: "Service unavailable",
  });
  assert.equal(s.phase, "saved");
  assert.match(s.notice, /unavailable/);
  assert.equal(s.agents.length, 0);
});
test("an API outage retains the bound question without inventing live agents", () => {
  const s = liveSnapshot({
    identity: { ...identity, oracleQuestion: progress.question },
    apiError: "unavailable",
  });
  assert.equal(s.question, progress.question);
  assert.equal(s.agents.length, 0);
  assert.equal(s.panelSize, null);
});
test("restored onchain requests do not need sessionStorage and deduplicate pages", () => {
  const rows = discoverRequests(
    [
      origin,
      { ...origin },
      { ...origin, args: { ...origin.args, claimant: registry } },
    ],
    wallet,
    registry,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requestId, requestId);
  assert.equal(
    discoverRequests([{ ...origin, removed: true }], wallet, registry).length,
    0,
  );
});
test("obsolete wallet/request loads cannot publish after a switch", () => {
  const guard = selectionGuard();
  const first = guard.next("wallet-one");
  assert.equal(first.current(), true);
  const second = guard.next("wallet-two");
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
  guard.stop();
  assert.equal(second.current(), false);
});
test("shared stored lists stay neutral and do not become wallet YES", () => {
  const shared = {
    ...identity,
    factId: 1201,
    claimant: "0x0000000000000000000000000000000000000000",
  };
  const s = liveSnapshot({
    identity: shared,
    terminal: {
      ...terminal,
      eventName: "SharedFactStored",
      args: { requestId, factId: 1201 },
    },
    token: 1n,
    cardImage: image,
  });
  assert.equal(s.result, null);
  assert.equal(s.registryStored, true);
  assert.match(s.notice, /shared/i);
});
test("real identity numbers and count/list answer semantics are retained", () => {
  const count = {
    ...progress,
    answerType: "uint256",
    members: [
      { tokenId: "9007199254740993000", ok: true, answer: { answer: "8" } },
      { ok: true, answer: { answer: "2" } },
    ],
  };
  const s = liveSnapshot({
    identity: { ...identity, spec: { kind: 1, threshold: 5 } },
    progress: count,
  });
  assert.equal(s.agents[0].tokenId, "9007199254740993000");
  assert.equal(s.agents[0].state, "agree");
  assert.equal(s.agents[1].tokenId, undefined);
  assert.equal(s.agents[1].state, "disagree");
});
test("count quorum requires identical values, not distinct counts above a threshold", () => {
  const s = liveSnapshot({
    identity: { ...identity, spec: { kind: 1, threshold: 5 } },
    progress: {
      ...progress,
      status: "assessing",
      answerType: "uint256",
      panelSize: 11,
      quorum: 7,
      members: Array.from({ length: 7 }, (_, i) => ({
        tokenId: String(i + 1),
        ok: true,
        answer: { answer: String(10 + i) },
      })),
    },
  });
  assert.equal(s.quorumReached, false);
  assert.equal(s.matchingAnswers, 1);
  assert.equal(s.agents.filter((a) => a.state === "agree").length, 1);
  assert.equal(s.agents.filter((a) => a.state === "disagree").length, 6);
});
test("canonical identical counts reach quorum even when below the rule threshold", () => {
  const s = liveSnapshot({
    identity: { ...identity, spec: { kind: 2, threshold: 50 } },
    progress: {
      ...progress,
      status: "assessing",
      answerType: "uint256",
      panelSize: 11,
      quorum: 7,
      members: Array.from({ length: 7 }, (_, i) => ({
        tokenId: String(i + 1),
        ok: true,
        answer: { answer: i % 2 ? "0008" : 8 },
      })),
    },
  });
  assert.equal(s.quorumReached, true);
  assert.equal(s.matchingAnswers, 7);
  assert.equal(s.result, null);
  assert.ok(
    s.agents.every((a) => a.state === "agree" && a.detail === "Matching count"),
  );
});
test("attested count is the reference instead of a different largest group", () => {
  const s = liveSnapshot({
    identity: { ...identity, spec: { kind: 1, threshold: 5 } },
    progress: {
      ...progress,
      answerType: "uint256",
      panelSize: 11,
      quorum: 7,
      agreement: { answer: "12", agreed: 7 },
      members: [
        ...Array.from({ length: 7 }, () => ({
          ok: true,
          answer: { answer: "10" },
        })),
        { ok: true, answer: { answer: "12" } },
      ],
    },
  });
  assert.equal(s.quorumReached, false);
  assert.equal(s.matchingAnswers, 1);
  assert.equal(s.agents.at(-1).state, "agree");
});
test("a request-bound encoded attested count overrides the reported group", () => {
  const id = "328faf29-cd5c-43f8-a39f-9f4e9d6cc7ad";
  const s = liveSnapshot({
    identity: { ...identity, spec: { kind: 1, threshold: 5 } },
    progress: {
      ...progress,
      id,
      answerType: "uint256",
      panelSize: 11,
      quorum: 7,
      agreement: { answer: "10", agreed: 7 },
      attestation: {
        requestId: `0x${id.replaceAll("-", "")}${"0".repeat(32)}`,
        chainId: 1,
        questionHash,
        answer: `0x${"c".padStart(64, "0")}`,
      },
      members: [
        ...Array.from({ length: 7 }, () => ({
          ok: true,
          answer: { answer: "10" },
        })),
        { ok: true, answer: { answer: "12" } },
      ],
    },
  });
  assert.equal(s.matchingAnswers, 1);
  assert.equal(s.quorumReached, false);
  assert.equal(s.agents.at(-1).state, "agree");
});
test("list quorum follows the exact member group even without API agreement", () => {
  const list = [wallet];
  const shared = { ...identity, factId: 1201, spec: { kind: 3 } };
  const input = {
    ...progress,
    status: "assessing",
    answerType: "address[]",
    panelSize: 11,
    quorum: 7,
    members: Array.from({ length: 7 }, () => ({
      ok: true,
      answer: { answer: list },
    })),
  };
  const snapshot = liveSnapshot({ identity: shared, progress: input });
  assert.equal(snapshot.matchingAnswers, 7);
  assert.equal(snapshot.quorumReached, true);
  assert.equal(snapshot.agents.filter((a) => a.state === "agree").length, 7);
  const differing = liveSnapshot({
    identity: shared,
    progress: {
      ...input,
      members: Array.from({ length: 7 }, (_, i) => ({
        ok: true,
        answer: { answer: [`0x${String(i + 1).padStart(40, "0")}`] },
      })),
    },
  });
  assert.equal(differing.matchingAnswers, 1);
  assert.equal(differing.quorumReached, false);
});

test("history windows stay bounded and cannot cross deployment", () => {
  assert.deepEqual(boundedRange(20000n, 100n), {
    fromBlock: 12801n,
    toBlock: 20000n,
  });
  assert.deepEqual(boundedRange(20000n, 100n, 200n), {
    fromBlock: 100n,
    toBlock: 199n,
  });
  assert.equal(boundedRange(20000n, 100n, 100n), null);
});
test("hidden and unmounted pages abort live polling and reject stale completions", async () => {
  const listeners = new Set();
  const doc = {
    hidden: false,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  };
  const calls = [];
  const timers = [];
  const stop = visiblePolling({
    document: doc,
    load: (signal, current) =>
      new Promise((resolve) => calls.push({ signal, current, resolve })),
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => {},
  });
  assert.equal(calls.length, 1);
  doc.hidden = true;
  for (const fn of listeners) fn();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[0].current(), false);
  doc.hidden = false;
  for (const fn of listeners) fn();
  assert.equal(calls.length, 2);
  stop();
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(listeners.size, 0);
  for (const call of calls) call.resolve();
  await Promise.resolve();
});
