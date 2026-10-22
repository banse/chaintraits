import test from "node:test";
import assert from "node:assert/strict";
import { resilientRpc, READ_RPCS } from "../src/rpc.mjs";
import {
  lastPersonalRequests,
  lastRequestText,
} from "../src/request-outcomes.mjs";

// Deterministic checks of carried-forward round 7 requirements; no live RPC.
test("R7.1 failed endpoints sit out for at most 60 seconds and rejoin after recovery", async () => {
  let now = 0,
    recovered = false;
  const hits = [];
  const pool = resilientRpc({
    now: () => now,
    fetcher: async (url) => {
      hits.push(url);
      if (url === READ_RPCS[0] && !recovered)
        return new Response("busy", { status: 429 });
      return Response.json({ result: "0x1" });
    },
  });
  for (let i = 0; i < 5; i++) {
    await pool.request({ method: "eth_chainId" });
    const until = pool.pausedUntil(READ_RPCS[0]);
    assert.ok(until - now > 0 && until - now <= 60000);
    const before = hits.filter((u) => u === READ_RPCS[0]).length;
    now = until - 1;
    await pool.request({ method: "eth_chainId" });
    assert.equal(hits.filter((u) => u === READ_RPCS[0]).length, before);
    now = until;
  }
  recovered = true;
  await pool.request({ method: "eth_chainId" });
  assert.equal(hits.at(-1), READ_RPCS[0]);
  assert.equal(pool.pausedUntil(READ_RPCS[0]), 0);
});

test("R7.1 a wrong-chain endpoint never supplies contract reads", async () => {
  const calls = [];
  const pool = resilientRpc({
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, method: body.method });
      return Response.json({
        result:
          body.method === "eth_chainId"
            ? url === READ_RPCS[0]
              ? "0x2"
              : "0x1"
            : "0x6000",
      });
    },
  });
  assert.equal(
    await pool.request({
      method: "eth_getCode",
      params: ["0x2000000000000000000000000000000000000001", "latest"],
    }),
    "0x6000",
  );
  assert.equal(
    calls.some((c) => c.url === READ_RPCS[0] && c.method === "eth_getCode"),
    false,
  );
});

test("R7.1/2 every registry scan gets a fresh head and keeps its inclusive recent window", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: new URL("../", import.meta.url).pathname,
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "error",
  });
  const previousFetch = globalThis.fetch,
    previousDocument = globalThis.document;
  try {
    globalThis.document = { baseURI: "https://sworn.test/" };
    globalThis.fetch = async () => Response.json({ blockNumber: 26242885 });
    const { registryEvents } = await vite.ssrLoadModule("/src/settlement.ts");
    let head = 26251000n;
    const ranges = [],
      requests = [];
    const client = {
      request: async (p) => {
        requests.push(p);
        return "0x" + head.toString(16);
      },
      getBlockNumber: () => {
        throw Error("cached head forbidden");
      },
      getLogs: async (p) => {
        ranges.push(p);
        return [];
      },
    };
    const runtime = {
      contracts: [],
      deployment: {
        contracts: [
          {
            name: "Registry",
            address: "0x2000000000000000000000000000000000000001",
          },
        ],
      },
      abis: {
        Registry: [{ type: "event", name: "TraitRequested", inputs: [] }],
      },
    };
    await registryEvents(client, runtime, ["TraitRequested"], undefined, {
      window: 600n,
    });
    head += 1000n;
    await registryEvents(client, runtime, ["TraitRequested"], undefined, {
      window: 7200n,
    });
    assert.deepEqual(
      requests.map((r) => r.method),
      ["eth_blockNumber", "eth_blockNumber"],
    );
    assert.equal(ranges[0].fromBlock, 26251000n - 599n);
    assert.equal(ranges[1].fromBlock, head - 7199n);
    assert.equal(ranges[1].toBlock, head);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    await vite.close();
  }
});

test("R7.4 a later Missed(requestId,0,1) never replaces an ended request", () => {
  const wallet = "0x2000000000000000000000000000000000000001";
  const request = {
    eventName: "TraitRequested",
    args: { claimant: wallet, traitId: 801, requestId: "one" },
  };
  const later = {
    eventName: "Missed",
    args: { requestId: "one", traitId: 0, reason: 1 },
  };
  for (const eventName of ["Abandoned", "Verified", "Missed", "NoVerdict"]) {
    const first = {
      eventName,
      args: { requestId: "one", traitId: 801, reason: 8 },
    };
    const rows = lastPersonalRequests([request, first, later], wallet);
    if (eventName === "Verified") assert.deepEqual(rows, []);
    else {
      assert.equal(rows[0][1].outcome, first);
      if (eventName === "Abandoned")
        assert.match(
          lastRequestText(rows[0][1].outcome, 1792600000n),
          /: abandoned$/,
        );
    }
  }
});
