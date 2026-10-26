import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { pendingOutcomeRead } from "../src/swarm-polling.mjs";

test("pending outcome reads catch up after a hidden tab misses more than 600 blocks", async () => {
  const vite = await createServer({
    root: new URL("../", import.meta.url).pathname,
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "error",
  });
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { baseURI: "https://sworn.test/" };
    globalThis.fetch = async () => Response.json({ blockNumber: 100 });
    const { registryEvents } = await vite.ssrLoadModule("/src/settlement.ts");
    const pending = { blockNumber: 950n };
    let head = 1000n;
    const delivered = {
      eventName: "Verified",
      blockNumber: 1100n,
      logIndex: 0,
      args: { traitId: 1301 },
    };
    const ranges = [];
    const client = {
      request: async () => `0x${head.toString(16)}`,
      getLogs: async (range) => {
        ranges.push(range);
        return range.fromBlock <= delivered.blockNumber && range.toBlock >= delivered.blockNumber
          ? [delivered]
          : [];
      },
    };
    const runtime = {
      deployment: { contracts: [{ name: "Registry", address: "0x2000000000000000000000000000000000000001" }] },
      abis: { Registry: [{ type: "event", name: "Verified", inputs: [] }] },
    };
    const before = await registryEvents(client, runtime, ["Verified"], 1301, pendingOutcomeRead(pending));
    assert.equal(before.length, 0);
    pending.outcomesThrough = before.toBlock;

    // No polls run while the browser sleeps; delivery happens during this gap.
    head = 1801n;
    const resumed = await registryEvents(client, runtime, ["Verified"], 1301, pendingOutcomeRead(pending));
    assert.deepEqual([...resumed], [delivered]);
    pending.outcomesThrough = resumed.toBlock;

    // Once caught up, another unresolved request need not reread its full life.
    head++;
    await registryEvents(client, runtime, ["Verified"], 1301, pendingOutcomeRead(pending));
    const next = ranges.at(-1);
    assert.equal(next.toBlock - next.fromBlock + 1n, 601n);
    assert.ok(next.fromBlock > pending.blockNumber);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    await vite.close();
  }
});

test("outcome cursors stay scoped to their request and never precede its origin", () => {
  const first = { blockNumber: 950n, outcomesThrough: 1000n };
  const other = { blockNumber: 400n, outcomesThrough: 1400n };
  assert.deepEqual(pendingOutcomeRead(first), { fromBlock: 950n });
  assert.deepEqual(pendingOutcomeRead(other), { fromBlock: 801n });
  assert.deepEqual(pendingOutcomeRead({ blockNumber: 300n }), { fromBlock: 300n });
});
