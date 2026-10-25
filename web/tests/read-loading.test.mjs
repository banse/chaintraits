import test from "node:test";
import assert from "node:assert/strict";
import { cachedReads, boundedRefresh } from "../src/read-loading.mjs";
import { createServer } from "vite";
import { keccak256 } from "viem";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("validated deployment reads are shared; failed reads can retry", async () => {
  const cache = cachedReads();
  let loads = 0;
  const load = async () => {
    loads++;
    await wait(5);
    return { registry: "pinned" };
  };
  const [a, b] = await Promise.all([
    cache.read("deployment", load),
    cache.read("deployment", load),
  ]);
  assert.equal(a, b);
  assert.equal(await cache.read("deployment", load), a);
  assert.equal(loads, 1);
  let fail = true;
  const retry = () => {
    if (fail) throw Error("offline");
    return "online";
  };
  await assert.rejects(cache.read("retry", retry), /offline/);
  fail = false;
  assert.equal(await cache.read("retry", retry), "online");
});

test("a changed community count or expiry reloads the list; new cache scopes do not share data", async () => {
  let now = 100,
    loads = 0;
  const cache = cachedReads({ now: () => now });
  const read = (version) =>
    cache.read("specs", async () => ++loads, { version, ttlMs: 300000 });
  assert.equal(await read(10002), 1);
  assert.equal(await read(10002), 1);
  assert.equal(await read(10003), 2);
  now += 300001;
  assert.equal(await read(10003), 3);
  assert.equal(await cachedReads().read("specs", async () => ++loads), 4);
});

test("refreshes do not overlap and a deadline aborts the in-flight read", async () => {
  const refresh = boundedRefresh({ timeoutMs: 30 });
  let starts = 0,
    aborted = false;
  const task = (signal) => {
    starts++;
    return new Promise((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  };
  const first = refresh.run(task),
    second = refresh.run(task);
  assert.equal(first, second);
  await assert.rejects(first, /timed out/i);
  assert.equal(starts, 1);
  assert.equal(aborted, true);
  assert.equal(await refresh.run(async () => 42), 42);
});

test("hidden pages do not start refreshes and stop cancels an active read", async () => {
  let visible = false,
    starts = 0;
  const refresh = boundedRefresh({ visible: () => visible, timeoutMs: 1000 });
  assert.equal(await refresh.run(() => ++starts), undefined);
  assert.equal(starts, 0);
  visible = true;
  const pending = refresh.run(
    (signal) =>
      new Promise((resolve, reject) => {
        starts++;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  await wait(1);
  refresh.stop();
  await assert.rejects(pending, /cancelled/i);
  assert.equal(starts, 1);
});

test("stopping before a refresh starts sends nothing and immediate resume is fresh", async () => {
  const refresh = boundedRefresh();
  let starts = 0;
  const cancelled = refresh.run(() => ++starts);
  refresh.stop();
  const resumed = refresh.run(() => ++starts);
  await assert.rejects(cancelled, /cancelled/i);
  assert.equal(await resumed, 1);
  assert.equal(starts, 1);
});

test("health caches deployment validation per pool and pin, but refreshes price, supply, head and new rules", async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { health, community } = await vite.ssrLoadModule("/src/chain.ts");
    const address = (i) => "0x" + i.toString(16).padStart(40, "0");
    const contracts = ["Registry", "Renderer", "Composer"].map((name, i) => ({
      name,
      address: address(i + 1),
    }));
    const runtime = {
      deployment: {
        chainId: 1,
        contracts,
        network: { pairToken: { address: address(10) } },
      },
      preview: {
        contracts: Object.fromEntries(
          contracts.map((c) => [c.name, { runtimeHash: keccak256("0x6000") }]),
        ),
      },
      abis: { Registry: [], IntakeV2: [] },
    };
    const counts = {};
    const count = (name) => {
      counts[name] = (counts[name] || 0) + 1;
    };
    const deps = {
      imd: address(10),
      renderer: address(2),
      composer: address(3),
      intake: address(11),
      attester: address(12),
      curator: address(13),
      burnExecutor: address(14),
    };
    let tip = 100n,
      price = 5n,
      supply = 2n,
      next = 10003;
    const client = {
      pool: {},
      getChainId: async () => {
        count("chain");
        return 1;
      },
      getBytecode: async () => {
        count("bytecode");
        return "0x6000";
      },
      getBlockNumber: async () => {
        count("block");
        return tip;
      },
      readContract: async ({ functionName, args }) => {
        count(functionName);
        if (functionName in deps) return deps[functionName];
        if (functionName === "priceOf") return price;
        if (functionName === "totalSupply") return supply;
        if (functionName === "nextSpecId") return BigInt(next);
        if (functionName === "specOf") return { name: `Rule ${args[0]}` };
        return 1n;
      },
    };
    await health(client, runtime);
    await community(client, runtime);
    const initial = Object.values(counts).reduce((sum, n) => sum + n, 0);
    tip++;
    price++;
    supply++;
    // A fresh scoped viem client shares its underlying original pool.
    const refreshed = await health({ ...client }, runtime);
    await community({ ...client }, runtime);
    const repeated =
      Object.values(counts).reduce((sum, n) => sum + n, 0) - initial;
    assert.equal(refreshed.block, tip);
    assert.equal(refreshed.price, price);
    assert.equal(refreshed.supply, supply);
    assert.equal(counts.bytecode, 3);
    assert.equal(counts.curator, 1);
    assert.equal(counts.specOf, 2);
    assert.equal(initial, 19);
    assert.equal(repeated, 6);
    next++;
    assert.equal((await community(client, runtime)).length, 3);
    assert.equal(counts.specOf, 5);
    await health({ ...client, pool: {} }, runtime);
    assert.equal(counts.bytecode, 6, "new provider validates again");
    await health(client, { ...runtime });
    assert.equal(counts.bytecode, 9, "new deployment pin validates again");
    console.log(
      `  cached refresh: ${initial} initial logical reads -> ${repeated} repeated reads; dynamic values changed`,
    );
  } finally {
    await vite.close();
  }
});
