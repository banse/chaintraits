import test from "node:test";
import assert from "node:assert/strict";
import { attestedRecords } from "../src/attested-records.mjs";
import { pageReads } from "../src/page-reads.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (id) => ({
  id,
  jobId: "record-job",
  attestedAt: "2026-10-20T08:15:00.000Z",
});

test("2 a network failure retries, records and duplicate ids share a serial queue", async () => {
  const calls = [],
    counts = new Map();
  let active = 0,
    maximum = 0;
  const reader = attestedRecords({
    retryMs: 5,
    fetcher: async (url) => {
      const id = url.split("/").at(-1);
      calls.push(id);
      maximum = Math.max(maximum, ++active);
      await sleep(4);
      active--;
      const n = (counts.get(id) || 0) + 1;
      counts.set(id, n);
      if (n === 1) throw TypeError("Failed to fetch");
      return Response.json(record(id));
    },
  });
  const [a, b, duplicate] = await Promise.all([
    reader.read("a"),
    reader.read("b"),
    reader.read("a"),
  ]);
  assert.deepEqual(a, record("a"));
  assert.deepEqual(b, record("b"));
  assert.equal(a, duplicate);
  assert.equal(maximum, 1);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 2);
  reader.stop();
});

test("2 four failed attempts stop until explicit Retry, with a fresh four-attempt budget", async () => {
  let calls = 0,
    recovered = false;
  const reader = attestedRecords({
    retryMs: 5,
    fetcher: async () => {
      calls++;
      if (!recovered) throw TypeError("Failed to fetch");
      return Response.json(record("a"));
    },
  });
  await assert.rejects(reader.read("a"));
  assert.equal(calls, 4);
  await sleep(30);
  await assert.rejects(reader.read("a"));
  assert.equal(calls, 4, "a re-render cannot restart a failed batch");
  recovered = true;
  assert.deepEqual(await reader.read("a", { retry: true }), record("a"));
  assert.equal(calls, 5);
  reader.stop();
});

test("2 leaving Wallet cancels queued reads and retry timers", async () => {
  let calls = 0;
  const reader = attestedRecords({
    retryMs: 25,
    fetcher: async () => {
      calls++;
      throw TypeError("Failed to fetch");
    },
  });
  const pending = reader.read("a");
  const rejected = assert.rejects(pending);
  await sleep(5);
  reader.stop();
  await rejected;
  await sleep(40);
  assert.equal(calls, 1);
});

test("6 launch reads cache successes and failures for the page; Retry reads clears failures only", async () => {
  const cache = pageReads();
  let good = 0,
    bad = 0;
  const loadGood = async () => ++good;
  const loadBad = async () => {
    bad++;
    throw Error("unavailable");
  };
  assert.deepEqual(
    await Promise.all([
      cache.once("good", loadGood),
      cache.once("good", loadGood),
    ]),
    [1, 1],
  );
  await assert.rejects(cache.once("bad", loadBad));
  await assert.rejects(cache.once("bad", loadBad));
  assert.equal(bad, 1);
  cache.retryFailed();
  assert.equal(await cache.once("good", loadGood), 1);
  await assert.rejects(cache.once("bad", loadBad));
  assert.equal(bad, 2);
  cache.stop();
});
