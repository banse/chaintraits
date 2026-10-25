import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { snapshotReader } from "../src/eligibility-snapshot.mjs";
import pin from "../src/eligibility-snapshot-pin.mjs";
import {
  checkEligibility,
  eligibilityText,
  NOT_CHECKABLE,
} from "../src/eligibility.mjs";
import { canonicalLogs } from "../scripts/snapshot-eligibility.mjs";

const data = new URL("../public/data/eligibility/", import.meta.url);
const manifestBytes = fs.readFileSync(new URL("manifest.json", data));
const manifest = JSON.parse(manifestBytes);
const digest = (b) => createHash("sha256").update(b).digest("hex");
const absent = "0x2000000000000000000000000000000000000001";
function reader(fetcher) {
  const calls = [];
  return {
    calls,
    snapshot: snapshotReader({
      base: () => "https://static.example/preview/",
      fetcher: async (url) => {
        calls.push(url);
        if (fetcher) return fetcher(url);
        return new Response(
          fs.readFileSync(new URL(url.split("/").pop(), data)),
        );
      },
    }),
  };
}
const refused = {
  request: () => {
    throw Error("All RPC refused");
  },
};
const noSpec = () => {
  throw Error("No live spec allowed for a snapshot fact");
};

test("a stalled IPFS shard is aborted, evicted and can be retried by all consumers", async () => {
  for (const mode of ["headers", "body"]) {
    let stalled = true, calls = 0, signal;
    const snapshot = snapshotReader({
      base: () => "https://gateway.example/ipfs/cid/",
      timeoutMs: 50,
      digest: (bytes) => createHash("sha256").update(Buffer.from(bytes)).digest(),
      fetcher: async (url, options) => {
        calls++;
        signal = options?.signal;
        if (!stalled) return new Response(fs.readFileSync(new URL(url.split("/").pop(), data)));
        const hanging = new Promise(() => {});
        return mode === "headers" ? hanging : { ok: true, arrayBuffer: () => hanging };
      },
    });
    let guard;
    try {
      const results = await Promise.race([
        Promise.allSettled([snapshot(absent, 701), snapshot(absent, 801)]),
        new Promise((_, reject) => { guard = setTimeout(() => reject(Error("Shard remained stuck")), 1000); }),
      ]);
      assert.equal(calls, 1, "concurrent readers share one request");
      assert.ok(results.every(r => r.status === "rejected" && /timed out/i.test(r.reason.message)));
      assert.equal(signal.aborted, true);
      stalled = false;
      assert.equal((await snapshot(absent, 701)).state, "not-met");
      assert.equal(calls, 2, "retry starts a new fetch after timeout");
    } finally { clearTimeout(guard); }
  }
});

test("exported snapshot pins manifest, every shard, exact counts, windows and byte budget", () => {
  assert.equal(digest(manifestBytes), pin.manifestSha256);
  assert.deepEqual(manifest.files, pin.files);
  assert.deepEqual(manifest.facts, pin.facts);
  assert.deepEqual(manifest.events, {
    Deposited: { logs: 28353, wallets: 19522 },
    HourSaved: { logs: 41, wallets: 33 },
    FirstDeposit: { logs: 19522, wallets: 19522 },
  });
  assert.deepEqual(manifest.firstDepositIndices, {
    from: 1,
    to: 19522,
    unique: 19522,
  });
  const counts = pin.factIds.map(() => 0),
    wallets = pin.factIds.map(() => 0);
  let bytes = manifestBytes.length;
  for (const [name, file] of Object.entries(pin.files)) {
    const buffer = fs.readFileSync(new URL(name, data));
    assert.equal(digest(buffer), file.sha256);
    assert.equal(buffer.length, file.bytes);
    assert.ok(file.bytes < 24000);
    bytes += buffer.length;
    for (const [wallet, row] of Object.entries(JSON.parse(buffer))) {
      assert.equal(wallet[2], name.slice(8, 9));
      assert.equal(row.length, pin.factIds.length);
      row.forEach((n, i) => {
        counts[i] += n;
        wallets[i] += Number(n > 0);
      });
    }
    assert.deepEqual(
      buffer,
      fs.readFileSync(
        new URL(`../../dist/data/eligibility/${name}`, import.meta.url),
      ),
    );
  }
  assert.ok(bytes < 1500000);
  pin.factIds.forEach((id, i) => {
    assert.equal(counts[i], manifest.facts[id].matchingLogs);
    assert.equal(wallets[i], manifest.facts[id].matchingWallets);
  });
  assert.deepEqual(counts, [5958, 8, 1, 41, 1, 1, 1, 1, 1000]);
  let next = manifest.fromBlock,
    logs = 0;
  for (const range of manifest.comparison.ranges) {
    assert.equal(range.fromBlock, next);
    next = range.toBlock + 1;
    logs += range.logs;
    assert.match(range.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(next, manifest.toBlock + 1);
  assert.equal(logs, 47916);
});

test("all four ordinal wallets meet exactly their own ordinal; case independent and zero RPC/spec reads", async () => {
  for (const [index, expected] of [
    [1, 1101],
    [1000, 1102],
    [10000, 1103],
    [19522, 1104],
  ]) {
    const { snapshot, calls } = reader();
    const wallet = manifest.samples[`index${index}`]
      .toUpperCase()
      .replace("0X", "0x");
    for (const id of [1101, 1102, 1103, 1104]) {
      const result = await checkEligibility(refused, noSpec, wallet, id, {
        snapshot,
      });
      assert.equal(result.state, id === expected ? "met" : "not-met");
      assert.equal(
        result.found,
        `${id === expected ? "1 matching event" : "0 matching events"}; at least 1 required`,
      );
      assert.match(
        eligibilityText(result, 1250000000000000000n),
        id === expected
          ? /^Our check of the public chain data finds this rule met/
          : /^This wallet does not meet this rule/,
      );
    }
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].startsWith("https://static.example/preview/data/eligibility/"),
    );
  }
});

test("hour-65 and repeated-event counts are exact; nondepositor gets nine negative results from one shard", async () => {
  const { snapshot, calls } = reader();
  assert.equal(
    (
      await checkEligibility(refused, noSpec, manifest.samples.hour65, 901, {
        snapshot,
      })
    ).state,
    "met",
  );
  for (const name of Object.keys(pin.files)) {
    for (const [wallet, counts] of Object.entries(
      JSON.parse(fs.readFileSync(new URL(name, data))),
    )) {
      for (const id of [701, 801, 1001]) {
        const count = counts[pin.factIds.indexOf(id)];
        if (count > 1) {
          const r = await snapshot(wallet, id);
          assert.equal(
            r.found,
            `${count} matching events; at least 1 required`,
          );
        }
      }
    }
  }
  assert.equal(new Set(calls).size, 16);
  const absentReader = reader();
  const results = await Promise.all(
    pin.factIds.map((id) =>
      checkEligibility(refused, noSpec, absent, id, absentReader),
    ),
  );
  assert.ok(
    results.every(
      (r) =>
        r.state === "not-met" &&
        r.found === "0 matching events; at least 1 required",
    ),
  );
  assert.equal(absentReader.calls.length, 1);
});

test("wrong same-length hash, truncated file, HTTP failure and thrown fetch are advisory only, with retry", async () => {
  for (const mode of ["hash", "length", "http", "network"]) {
    let fail = true;
    const r = reader(async (url) => {
      const bytes = fs.readFileSync(new URL(url.split("/").pop(), data));
      if (!fail) return new Response(bytes);
      if (mode === "network") throw Error("Unavailable");
      if (mode === "http") return new Response("Missing", { status: 404 });
      if (mode === "length")
        return new Response(bytes.subarray(0, bytes.length - 1));
      const changed = Buffer.from(bytes);
      changed[1] = 32;
      return new Response(changed);
    });
    const result = await checkEligibility(
      refused,
      noSpec,
      manifest.samples.index1,
      1101,
      r,
    );
    assert.deepEqual(result, { state: "unknown" });
    assert.equal(eligibilityText(result, 1n), NOT_CHECKABLE);
    fail = false;
    assert.equal(
      (
        await checkEligibility(
          refused,
          noSpec,
          manifest.samples.index1,
          1101,
          r,
        )
      ).state,
      "met",
    );
    assert.equal(
      (
        await checkEligibility(
          { request: async () => "0x14" },
          async () => ({
            kind: 5,
            threshold: 20n,
            fromBlock: 25769870n,
            toBlock: 25769870n,
          }),
          absent,
          1301,
        )
      ).state,
      "met",
    );
  }
});

test("snapshot deadlines are bounded; rejected/late fetch cannot start RPC scanning", async () => {
  let finish;
  const snapshot = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const result = await checkEligibility(refused, noSpec, absent, 701, {
    snapshot,
    timeoutMs: 5,
  });
  assert.deepEqual(result, { state: "unknown" });
  finish({ state: "met", found: "late" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { state: "unknown" });
});

test("generator canonical comparison includes empty ranges, rejects duplicates, removed and out-of-window logs", () => {
  const target = manifest.curator,
    topic = "0x" + "aa".repeat(32);
  assert.deepEqual(canonicalLogs([], 1, 2, target, [topic]), []);
  const log = {
    address: target,
    blockNumber: "0x1",
    logIndex: "0x0",
    blockHash: "0x" + "bb".repeat(32),
    transactionHash: "0x" + "cc".repeat(32),
    topics: [topic],
    data: "0x",
  };
  assert.equal(canonicalLogs([log], 1, 2, target, [topic]).length, 1);
  for (const logs of [
    [log, log],
    [{ ...log, removed: true }],
    [{ ...log, blockNumber: "0x3" }],
    [{ ...log, topics: [] }],
  ])
    assert.throws(() => canonicalLogs(logs, 1, 2, target, [topic]));
});
