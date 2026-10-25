import test from "node:test";
import assert from "node:assert/strict";
import {
  agentResult,
  verificationPhase,
  unsubmittedFactIds,
} from "../src/progress-experience.mjs";
const wallet = "0x1000000000000000000000000000000000000001";
const fact = { id: 601, requestId: "0xrequest" };
const positive = {
  status: "assessing",
  panelSize: 11,
  quorum: 7,
  answerType: "bool",
  members: Array.from({ length: 7 }, () => ({
    ok: true,
    answer: { answer: true },
  })),
};
const event = {
  eventName: "Verified",
  args: { claimant: wallet, traitId: 601, requestId: fact.requestId },
};
test("a saved request alone is not a confirmed verification", () => {
  assert.equal(verificationPhase({ fact, wallet }).kind, "unconfirmed");
  assert.equal(
    verificationPhase({ fact, wallet, requestConfirmed: true }).kind,
    "checking",
  );
});
test("preflight warnings disappear for submitted facts while unsent batch facts retain their check", () => {
  assert.deepEqual(
    unsubmittedFactIds(
      [601, 701],
      [{ result: { facts: [{ id: 601 }] } }],
      false,
    ),
    [701],
  );
  assert.deepEqual(unsubmittedFactIds([601], [], false), [601]);
  assert.deepEqual(unsubmittedFactIds([601], [], true), []);
});
test("agent symbols distinguish positive, negative, unavailable and unanswered", () => {
  assert.equal(
    agentResult({ ok: true, answer: { answer: true } }).kind,
    "positive",
  );
  assert.equal(
    agentResult({ ok: true, answer: { answer: false } }).kind,
    "negative",
  );
  assert.equal(agentResult({ ok: false, reason: "No evidence" }).kind, "error");
  assert.equal(agentResult({}).kind, "waiting");
  assert.equal(agentResult({}, null, null, true).kind, "missing");
  assert.equal(
    agentResult({ ok: true, answer: { answer: "unknown" } }).kind,
    "received",
  );
});
test("numeric and shared list answers are checked by meaning rather than ok alone", () => {
  assert.equal(
    agentResult(
      { ok: true, answer: { answer: "2" } },
      { kind: 1, threshold: 3n },
    ).kind,
    "negative",
  );
  assert.equal(
    agentResult(
      { ok: true, answer: { answer: "3" } },
      { kind: 1, threshold: 3n },
    ).kind,
    "positive",
  );
  assert.equal(
    agentResult({ ok: true, answer: { answer: [wallet] } }, null, [wallet])
      .kind,
    "positive",
  );
  assert.equal(
    agentResult({ ok: true, answer: { answer: [wallet] } }, null, null).kind,
    "received",
  );
});
test("votes and even a signed positive answer cannot celebrate a wallet fact", () => {
  assert.equal(
    verificationPhase({ fact, wallet, progress: positive }).kind,
    "quorum",
  );
  assert.equal(
    verificationPhase({
      fact,
      wallet,
      progress: { ...positive, status: "attested" },
    }).kind,
    "approved",
  );
  assert.notEqual(
    verificationPhase({ fact, wallet, event, hasFact: false }).kind,
    "proven",
  );
  assert.notEqual(verificationPhase({ fact, wallet, event }).kind, "proven");
  assert.equal(
    verificationPhase({ fact, wallet, event, hasFact: true }).kind,
    "proven",
  );
});
test("completion is bound to request, fact and claimant; shared storage is not wallet proof", () => {
  for (const args of [
    { ...event.args, requestId: "0xother" },
    { ...event.args, traitId: 701 },
    { ...event.args, claimant: "0xother" },
  ])
    assert.notEqual(
      verificationPhase({
        fact,
        wallet,
        event: { ...event, args },
        hasFact: true,
      }).kind,
      "proven",
    );
  assert.equal(
    verificationPhase({
      fact,
      wallet,
      event: {
        eventName: "SharedFactStored",
        args: { requestId: fact.requestId, factId: 601 },
      },
      hasFact: true,
    }).kind,
    "shared",
  );
  assert.equal(
    verificationPhase({
      fact,
      wallet,
      event: { eventName: "NoVerdict", args: { requestId: fact.requestId } },
    }).kind,
    "failed",
  );
});
test("shared approval describes list storage and a failed panel never celebrates", () => {
  const approved = verificationPhase({
    fact: { ...fact, id: 1201 },
    wallet,
    progress: { ...positive, status: "attested" },
  });
  assert.equal(approved.title, "Panel approved · saving shared result");
  assert.equal(
    verificationPhase({
      fact,
      wallet,
      progress: { ...positive, status: "failed" },
    }).kind,
    "panel-failed",
  );
  assert.equal(
    verificationPhase({
      fact,
      wallet,
      progress: {
        ...positive,
        status: "attested",
        members: positive.members.map(() => ({
          ok: true,
          answer: { answer: false },
        })),
      },
    }).kind,
    "panel-negative",
  );
});
test("built-in Swarmed stays personal even when specOf exposes a generic shared-kind fixture", () => {
  const approved = verificationPhase({
    fact,
    wallet,
    spec: { kind: 3 },
    progress: { ...positive, status: "attested" },
  });
  assert.equal(approved.title, "Panel approved · saving your fact");
  const community = verificationPhase({
    fact: { ...fact, id: 10001 },
    wallet,
    spec: { kind: 3 },
    progress: { ...positive, status: "attested" },
  });
  assert.equal(community.title, "Panel approved · saving shared result");
});
