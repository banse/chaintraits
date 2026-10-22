import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesRequest,
  oracleProgressReader,
  progressCounts,
  progressStatus,
  answerText,
  oracleUuid,
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
test("summary-only listing resolves oldest matching detail; never follows API links", async () => {
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
  assert.equal((await load(pending)).id, "older");
  assert.equal(
    urls.some((u) => u.endsWith("/newest") || u.endsWith("/too-old")),
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

test("exact Intake admission selects only the Registry request id in a multi-entry transaction", async () => {
  const p = {
    ...pending,
    requestId: "0x" + "11".repeat(32),
    transactionHash: "0x" + "22".repeat(32),
  };
  const urls = [];
  const load = oracleProgressReader(async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () =>
        url.includes("/intake/")
          ? {
              entries: [
                {
                  requestId: "0x" + "33".repeat(32),
                  admission: { result: { requestId: "wrong" } },
                },
                {
                  requestId: p.requestId.toUpperCase(),
                  admission: { result: { requestId: "exact" } },
                },
              ],
            }
          : request("exact"),
    };
  });
  const result = await load(p);
  assert.equal(result.id, "exact");
  assert.equal(result.foundBy, "exact");
  assert.deepEqual(urls, [
    `https://api.imd.fun/intake/1/${p.transactionHash}`,
    "https://api.imd.fun/oracle/requests/exact",
  ]);
});
test("every Intake refusal silently falls back to claimant q and the oldest eligible request", async () => {
  const p = {
    ...pending,
    claimant: "0x2000000000000000000000000000000000000001",
    requestId: "0x" + "11".repeat(32),
    transactionHash: "0x" + "22".repeat(32),
  };
  for (const mode of [
    "cors",
    "http",
    "json",
    "empty",
    "unrelated",
    "invalid-id",
    "detail-error",
  ]) {
    let rows = [
      request("newer", 5),
      request("oldest", 0),
      request("predates", -1),
    ];
    const load = oracleProgressReader(async (url) => {
      if (url.includes("/intake/")) {
        if (mode === "cors") throw TypeError("Failed to fetch");
        return {
          ok: mode !== "http",
          json: async () => {
            if (mode === "json") throw SyntaxError("not json");
            return {
              entries:
                mode === "empty"
                  ? []
                  : [
                      {
                        requestId:
                          mode === "unrelated" ? "different" : p.requestId,
                        admission: {
                          result: {
                            requestId:
                              mode === "invalid-id" ? "../bad" : "unavailable",
                          },
                        },
                      },
                    ],
            };
          },
        };
      }
      const u = new URL(url);
      if (u.pathname === "/oracle/requests") {
        assert.equal(u.searchParams.get("q"), p.claimant);
        assert.equal(u.searchParams.has("consumer"), false);
        assert.equal(u.searchParams.has("questionHash"), false);
        return { ok: true, json: async () => ({ requests: rows }) };
      }
      return {
        ok: !url.endsWith("/unavailable"),
        json: async () =>
          request(
            u.pathname.split("/").at(-1),
            u.pathname.endsWith("oldest") ? 0 : 5,
          ),
      };
    });
    let result = await load(p);
    assert.equal(result.id, "oldest", mode);
    assert.equal(result.foundBy, "matched");
    rows = [request("later-duplicate", 20), request("newer", 5)];
    result = await load(p);
    assert.equal(
      result.id,
      "oldest",
      "old match survives newest-100 listing churn",
    );
    rows = [request("aaa-tied-duplicate", 0), request("newer", 5)];
    assert.equal(
      (await load(p)).id,
      "oldest",
      "equal timestamps retain the previously displayed oldest match",
    );
  }
});
test("Verified UUID uses the first 16 bytes and replaces API matches with an explicit correction", async () => {
  const id = "23474d49-bf7c-40e0-8dad-41636c73ea84";
  const bytes = "0x23474d49bf7c40e08dad41636c73ea84" + "00".repeat(16);
  assert.equal(oracleUuid(bytes), id);
  assert.equal(
    oracleUuid("0x" + "00".repeat(16) + "23474d49bf7c40e08dad41636c73ea84"),
    null,
  );
  assert.equal(oracleUuid("0x" + "00".repeat(32)), null);
  const urls = [];
  const load = oracleProgressReader(async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () =>
        url.endsWith("/requests")
          ? { requests: [request("original")] }
          : request(url.split("/").at(-1)),
    };
  });
  assert.equal((await load(pending)).id, "original");
  const result = await load({ ...pending, oracleRequestId: bytes });
  assert.equal(result.id, id);
  assert.equal(result.foundBy, "confirmed by the Registry");
  assert.equal(result.previousRequestId, "original");
  assert.equal(
    (await load({ ...pending, oracleRequestId: bytes })).previousRequestId,
    "original",
  );
  assert.equal(urls.at(-1), `https://api.imd.fun/oracle/requests/${id}`);
});
