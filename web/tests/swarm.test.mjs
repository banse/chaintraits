import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesRequest,
  oracleProgressReader,
  progressCounts,
  progressStatus,
  answerText,
} from "../src/oracle-progress.mjs";
const pending = {
  registry: "0x1000000000000000000000000000000000000001",
  chainId: 1,
  questionHash: "0x" + "aa".repeat(32),
  requestedAt: 1792600000n,
};
const request = (id, seconds = 1) => ({
  id,
  createdAt: new Date(
    (Number(pending.requestedAt) + seconds) * 1000,
  ).toISOString(),
  consumer: { verifyingContract: pending.registry.toUpperCase(), chainId: 1 },
  questionHash: pending.questionHash.toUpperCase(),
  status: "assessing",
  panelSize: 5,
  quorum: 3,
  members: [],
  agreement: null,
});
test("progress identity requires Registry, event hash, chain and creation at or after request", () => {
  assert.equal(matchesRequest(request("match", 0), pending), true);
  for (const changed of [
    request("old", -1),
    { ...request("wrong-hash"), questionHash: "0x" + "bb".repeat(32) },
    {
      ...request("wrong-contract"),
      consumer: {
        verifyingContract: "0x2000000000000000000000000000000000000001",
      },
    },
    {
      ...request("wrong-chain"),
      consumer: { verifyingContract: pending.registry, chainId: 2 },
    },
    { ...request("bad-date"), createdAt: "invalid" },
  ])
    assert.equal(matchesRequest(changed, pending), false);
});
test("summary-only listing resolves newest matching detail; never follows API links", async () => {
  const rows = [
    request("older", 1),
    { ...request("wrong", 4), questionHash: "0x" + "bb".repeat(32) },
    request("newest", 2),
    request("too-old", -1),
  ];
  const urls = [];
  const load = oracleProgressReader(async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, "omit");
    return {
      ok: true,
      json: async () =>
        url.endsWith("/requests")
          ? { requests: rows.map(({ id, createdAt }) => ({ id, createdAt })) }
          : {
              ...rows.find((r) => url.endsWith("/" + r.id)),
              url: "https://malicious.invalid/other",
              jobUrl: "/jobs/never",
            },
    };
  });
  assert.equal((await load(pending)).id, "newest");
  assert.equal(
    urls.some((u) => u.endsWith("/older") || u.endsWith("/too-old")),
    false,
  );
  assert.ok(
    urls.every((u) =>
      /^https:\/\/api.imd.fun\/oracle\/requests(?:\/[a-z-]+)?$/.test(u),
    ),
  );
});
test("polling returns new members and agreement rather than cached progress", async () => {
  let current = request("live");
  const load = oracleProgressReader(async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith("/requests") ? { requests: [current] } : current,
  }));
  assert.deepEqual(progressCounts(await load(pending)), {
    answered: 0,
    agreed: null,
  });
  current = {
    ...current,
    members: [
      { ok: true, answer: { answer: false, figure: "0" } },
      { ok: false, reason: "Archive unavailable" },
      { ok: null },
    ],
    agreement: { agreed: 1 },
  };
  assert.deepEqual(progressCounts(await load(pending)), {
    answered: 2,
    agreed: 1,
  });
  assert.equal(answerText(current.members[0].answer.answer), "false");
  assert.equal(answerText(current.members[0].answer.figure), "0");
});
test("attested and failed statuses do not manufacture a Registry credential", () => {
  assert.equal(progressStatus({ status: "running" }), "assessing");
  for (const status of ["failed", "disagreed", "expired"])
    assert.equal(progressStatus({ status }), "failed");
  assert.equal(progressStatus({ status: "attested" }), "attested");
  assert.equal(
    progressStatus({ status: "running", attestedAt: new Date().toISOString() }),
    "attested",
  );
});
test("unavailable/malformed API fails locally and invalid ids cannot escape the requests route", async () => {
  for (const fetcher of [
    async () => {
      throw Error("CORS refused");
    },
    async () => ({ ok: false }),
    async () => ({
      ok: true,
      json: async () => ({ requests: [request("../jobs")] }),
    }),
  ]) {
    await assert.rejects(oracleProgressReader(fetcher)(pending));
  }
  assert.throws(
    () => progressCounts({ ...request("bad"), quorum: 6 }),
    /Incomplete/,
  );
  assert.throws(
    () =>
      progressCounts({
        ...request("bad"),
        members: [],
        agreement: { agreed: 1 },
      }),
    /Incomplete/,
  );
});
