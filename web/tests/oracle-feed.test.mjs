import test from "node:test";
import assert from "node:assert/strict";
import {
  oracleProgressReader,
  progressCounts,
  WalletQuestionMismatch,
} from "../src/oracle-progress.mjs";

const wallet = "0xaBcDef0123456789Abcdef0123456789AbcdeF01";
const other = "0x9876543210abcdef9876543210abcdef98765432";
const pending = {
  registry: "0x1000000000000000000000000000000000000001",
  claimant: wallet,
  wallet,
  chainId: 1,
  requestId: "0x" + "11".repeat(32),
  transactionHash: "0x" + "22".repeat(32),
  questionHash: "0x" + "33".repeat(32),
  requestedAt: 1792600000n,
};
const confirmed = "23474d49-bf7c-40e0-8dad-41636c73ea84";
const confirmedBytes = "0x23474d49bf7c40e08dad41636c73ea84" + "00".repeat(16);
const record = (id, question) => ({
  id,
  question,
  jobId: `panel-${id}`,
  createdAt: new Date(Number(pending.requestedAt) * 1000).toISOString(),
  consumer: { verifyingContract: pending.registry, chainId: 1 },
  questionHash: pending.questionHash,
  answerType: "bool",
  status: "assessing",
  panelSize: 11,
  quorum: 7,
  members: [],
});
function reader(records, exactId) {
  const urls = [];
  const load = oracleProgressReader(async (url) => {
    urls.push(url);
    const u = new URL(url);
    let value;
    if (u.pathname.startsWith("/intake/"))
      value = {
        entries: exactId
          ? [
              {
                requestId: pending.requestId,
                admission: { result: { requestId: exactId } },
              },
            ]
          : [],
      };
    else if (u.pathname === "/oracle/requests") {
      if (u.searchParams.has("q"))
        assert.equal(u.searchParams.get("q"), pending.claimant);
      value = {
        requests: records.map(({ id, createdAt, question, jobId }) => ({
          id,
          createdAt,
          question,
          jobId,
        })),
      };
    } else value = records.find((r) => u.pathname.endsWith("/" + r.id));
    return { ok: true, json: async () => value };
  });
  return { load, urls };
}

test("1 listing questions filter other wallets before detail, despite matching Registry/hash", async () => {
  const wrong = record("aaa-wrong", `Did ${other} qualify?`);
  const right = record("bbb-right", `Did ${wallet.toUpperCase()} qualify?`);
  const { load, urls } = reader([wrong, right]);
  const result = await load(pending);
  assert.equal(result.id, right.id);
  assert.equal(result.wallet, wallet.toUpperCase());
  assert.equal(result.foundBy, "matched");
  assert.equal(result.jobId, right.jobId);
  assert.equal(
    urls.some((url) => url.endsWith("/aaa-wrong")),
    false,
  );
  assert.equal(await reader([wrong]).load(pending), null);
});

test("1 full wallet is required for exact, matched and Registry-confirmed requests, in any case", async () => {
  for (const mode of ["exact", "matched", "confirmed"]) {
    const id = mode === "confirmed" ? confirmed : "request";
    const p =
      mode === "confirmed"
        ? { ...pending, oracleRequestId: confirmedBytes }
        : pending;
    for (const question of [
      `Did ${wallet.toLowerCase()} qualify?`,
      `Did ${wallet.toUpperCase()} qualify?`,
      `Did ${wallet} qualify?`,
    ]) {
      const { load } = reader(
        [record(id, question)],
        mode === "exact" ? id : undefined,
      );
      assert.equal((await load(p)).id, id, mode);
    }
    for (const question of [
      `Did ${other} qualify?`,
      `Did ${wallet.slice(0, 6)}…${wallet.slice(-4)} qualify?`,
      `Did ${wallet}a qualify?`,
      `Did a${wallet} qualify?`,
      "Did this wallet qualify?",
      undefined,
    ]) {
      const { load } = reader(
        [record(id, question)],
        mode === "exact" ? id : undefined,
      );
      if (mode === "matched") assert.equal(await load(p), null);
      else await assert.rejects(load(p), WalletQuestionMismatch);
    }
  }
});

test("1 exact mismatch cannot fall through to a plausible listing; wallet and question are rechecked each poll", async () => {
  const wrong = record("exact", `Did ${other} qualify?`);
  const right = record("matched", `Did ${wallet} qualify?`);
  const { load, urls } = reader([wrong, right], wrong.id);
  await assert.rejects(load(pending), {
    message: "This request is not about your wallet.",
  });
  assert.equal(
    urls.some((url) => new URL(url).pathname === "/oracle/requests"),
    false,
  );
  wrong.question = `Did ${wallet} qualify?`;
  assert.equal((await load(pending)).id, "exact");
  wrong.question = `Did ${other} qualify?`;
  await assert.rejects(load(pending), WalletQuestionMismatch);
  await assert.rejects(
    reader([right], right.id).load({ ...pending, wallet: undefined }),
    WalletQuestionMismatch,
  );
});

test("1 shared requests keep Registry/hash/time matching without requiring a named wallet", async () => {
  const shared = record("shared", "Which wallets have the highest weights?");
  const { load } = reader([shared]);
  const result = await load({
    ...pending,
    claimant: "0x" + "0".repeat(40),
    wallet: undefined,
  });
  assert.equal(result.id, "shared");
  assert.equal(result.wallet, null);
});

test("2 admission with a panel still forming stays in the waiting state", async () => {
  const forming = {
    ...record("forming", `Did ${wallet} qualify?`),
    panelSize: 0,
    members: null,
  };
  assert.equal(await reader([forming], forming.id).load(pending), null);
});

test("4 jobId survives detail responses that omit it", async () => {
  const r = record("job", `Did ${wallet} qualify?`);
  const load = oracleProgressReader(async (url) => ({
    ok: true,
    json: async () =>
      url.includes("/intake/")
        ? { entries: [] }
        : new URL(url).pathname === "/oracle/requests"
          ? {
              requests: [
                {
                  id: r.id,
                  createdAt: r.createdAt,
                  question: r.question,
                  jobId: r.jobId,
                },
              ],
            }
          : { ...r, jobId: undefined },
  }));
  assert.equal((await load(pending)).jobId, r.jobId);
});

test("6 boolean votes count successful literal answers and ignore the plane's agreement", () => {
  const members = [
    ...Array.from({ length: 6 }, () => ({
      ok: true,
      answer: { answer: true, figure: "1" },
    })),
    ...Array.from({ length: 2 }, () => ({
      ok: true,
      answer: { answer: false, figure: "0" },
    })),
  ];
  const r = {
    ...record("votes", "Question"),
    members,
    agreement: { agreed: 99 },
  };
  assert.deepEqual(progressCounts(r), {
    answered: 8,
    agreed: 99,
    boolean: true,
    trueAnswers: 6,
    falseAnswers: 2,
  });
  assert.equal(
    progressCounts({
      ...r,
      members: [...members, { ok: true, answer: { answer: true } }],
    }).trueAnswers,
    7,
  );
  assert.equal(
    progressCounts({
      ...r,
      members: Array.from({ length: 7 }, () => ({
        ok: true,
        answer: { answer: false },
      })),
    }).falseAnswers,
    7,
  );
  const invalid = [
    { ok: false, answer: { answer: true } },
    { ok: true, answer: { answer: "true" } },
    { ok: null, answer: { answer: true } },
  ];
  assert.equal(progressCounts({ ...r, members: invalid }).trueAnswers, 0);
});

test("6 other answer types preserve plane agreement without inferring boolean consensus", () => {
  for (const agreement of [null, 0, { agreed: 1 }]) {
    const r = {
      ...record("number", "Question"),
      answerType: "uint256",
      agreement,
      members: [{ ok: true, answer: { answer: "42" } }],
    };
    const counts = progressCounts(r);
    assert.equal(counts.boolean, false);
    assert.equal(counts.agreed, agreement?.agreed ?? agreement);
  }
});
