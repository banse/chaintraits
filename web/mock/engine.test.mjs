import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, encodeAbiParameters } from "viem";
import { createEngine, addresses, abis, WALLET } from "./engine.mjs";
const tx = (name, args = []) => ({
  from: WALLET,
  to: name === "approve" ? addresses.imd : addresses.Registry,
  data: encodeFunctionData({
    abi: name === "approve" ? abis.token : abis.Registry,
    functionName: name,
    args,
  }),
});
const rpc = (e, method, ...params) => e.rpc({ method, params });
const fee = 100000000000000000n;
test("approval and mint change balances only on their receipts", async () => {
  let now = 1000;
  const e = createEngine({ now: () => now });
  const a = await rpc(
    e,
    "eth_sendTransaction",
    tx("approve", [addresses.Registry, fee]),
  );
  assert.equal(e.state().allowance, "0");
  assert.equal(await rpc(e, "eth_getTransactionReceipt", a), null);
  now += 3000;
  assert.equal((await rpc(e, "eth_getTransactionReceipt", a)).status, "0x1");
  assert.equal(e.state().allowance, String(fee));
  const before = BigInt(e.state().imdBalance);
  const m = await rpc(e, "eth_sendTransaction", tx("mintCard"));
  assert.equal(e.state().token, "0");
  now += 3000;
  const r = await rpc(e, "eth_getTransactionReceipt", m);
  assert.equal(r.status, "0x1");
  assert.equal(e.state().token, "1");
  assert.equal(BigInt(e.state().imdBalance), before - fee);
  assert.equal(e.state().allowance, "0");
  assert.equal(r.logs.length, 1);
});
test("independent engines keep transactions and balances isolated", async () => {
  const a = createEngine(),
    b = createEngine();
  a.configure({ imdBalance: "0", chainId: 8453 });
  assert.notEqual(a.state().imdBalance, b.state().imdBalance);
  assert.equal(b.state().chainId, 1);
  const h = await rpc(
    b,
    "eth_sendTransaction",
    tx("approve", [addresses.Registry, fee]),
  );
  assert.equal(await rpc(a, "eth_getTransactionReceipt", h), null);
});
test("rejection queues nothing and reverted mint changes no token balance", async () => {
  let now = 1000;
  const e = createEngine({ now: () => now });
  e.configure({ outcome: "reject" });
  await assert.rejects(
    rpc(e, "eth_sendTransaction", tx("mintCard")),
    (err) => err.code === 4001,
  );
  assert.equal(e.state().transactions.length, 0);
  e.configure({ outcome: "revert", allowance: String(fee) });
  const before = e.state().imdBalance;
  const h = await rpc(e, "eth_sendTransaction", tx("mintCard"));
  now += 3000;
  assert.equal((await rpc(e, "eth_getTransactionReceipt", h)).status, "0x0");
  assert.equal(e.state().token, "0");
  assert.equal(e.state().imdBalance, before);
});
test("swarm display delay starts after request receipt and stores mock result later", async () => {
  let now = 1000;
  const e = createEngine({ now: () => now });
  e.configure({ allowance: String(10n ** 20n) });
  const h = await rpc(
    e,
    "eth_sendTransaction",
    tx("upgrade", [[601], 500000000000000000n]),
  );
  assert.equal(e.state().requests.length, 0);
  now += 3000;
  await rpc(e, "eth_getTransactionReceipt", h);
  assert.equal(e.state().requests[0].status, "assessing");
  now += 11999;
  assert.equal(e.state().requests[0].status, "assessing");
  now += 1;
  assert.equal(e.state().requests[0].status, "attested");
  assert.ok(e.state().proven.includes(601));
});
test("invalid configuration, foreign sender and unknown RPC fail closed", async () => {
  const e = createEngine();
  assert.throws(() => e.configure({ txDelayMs: -1 }));
  assert.throws(() => e.configure({ imdBalance: "-1" }));
  assert.throws(() => e.configure({ chainId: 999 }));
  await assert.rejects(rpc(e, "eth_sendRawTransaction", "0x11"));
  await assert.rejects(
    rpc(e, "eth_sendTransaction", {
      ...tx("mintCard"),
      from: "0x3000000000000000000000000000000000000001",
    }),
  );
});
test("mock RPC target stays Ethereum while simulated wallet can be wrong-chain", async () => {
  const e = createEngine();
  e.configure({ chainId: 8453 });
  assert.equal(await rpc(e, "eth_chainId"), "0x1");
  assert.equal(e.state().chainId, 8453);
});
test("failed mock swarm records no fact and clears the pending request", async () => {
  let now = 1000;
  const e = createEngine({ now: () => now });
  e.configure({ allowance: String(10n ** 20n), swarmOutcome: "failed" });
  const h = await rpc(
    e,
    "eth_sendTransaction",
    tx("upgrade", [[601], 500000000000000000n]),
  );
  now += 3000;
  await rpc(e, "eth_getTransactionReceipt", h);
  now += 12000;
  assert.equal(e.state().requests[0].status, "failed");
  assert.ok(!e.state().proven.includes(601));
});
test("reset presets are isolated and invalid settings leave balances unchanged", () => {
  const e = createEngine();
  assert.equal(e.reset({ scenario: "no-imd" }).imdBalance, "0");
  assert.equal(e.reset({ scenario: "already-minted" }).token, "1");
  assert.equal(e.reset({ scenario: "wrong-chain" }).chainId, 8453);
  e.reset();
  const before = e.state();
  assert.throws(() => e.configure({ imdBalance: "1", txDelayMs: -1 }));
  assert.equal(e.state().imdBalance, before.imdBalance);
});
test("HTTP API requires session identity and blocks foreign origins", async () => {
  const { createServer } = await import("../../../server.mjs");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/__mock/state")).status, 400);
    const headers = {
      "X-Sworn-Mock-Session": "11111111-1111-4111-8111-111111111111",
      "content-type": "application/json",
    };
    const a = await (await fetch(base + "/__mock/state", { headers })).json();
    assert.equal(a.mock, true);
    const curator = await (
      await fetch(base + "/__mock/curator", { headers })
    ).json();
    assert.equal(curator.mock, true);
    assert.equal(
      curator.registry.toLowerCase(),
      addresses.Registry.toLowerCase(),
    );
    assert.equal(curator.wallets.length, 8);
    assert.equal(
      (
        await fetch(base + "/__mock/curator", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + "/__mock/control", {
          method: "POST",
          headers: { ...headers, Origin: "https://example.com" },
          body: JSON.stringify({ action: "reset" }),
        })
      ).status,
      403,
    );
    await fetch(base + "/__mock/control", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "reset", scenario: "no-imd" }),
    });
    const b = await (
      await fetch(base + "/__mock/state", {
        headers: {
          ...headers,
          "X-Sworn-Mock-Session": "22222222-2222-4222-8222-222222222222",
        },
      })
    ).json();
    assert.notEqual(b.imdBalance, "0");
    const receipt = await fetch(
      base + "/__mock/explorer/tx/0x" + "11".repeat(32),
    );
    assert.equal(receipt.status, 200);
    assert.match(await receipt.text(), /LOCAL MOCK/);
    assert.match(
      receipt.headers.get("Content-Security-Policy"),
      /connect-src 'self'/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("mock wallet refuses missing gas without queueing a transaction", async () => {
  const e = createEngine();
  e.configure({ ethBalance: "0" });
  await assert.rejects(
    rpc(e, "eth_sendTransaction", tx("approve", [addresses.Registry, fee])),
    /Insufficient ETH/,
  );
  assert.equal(e.state().transactions.length, 0);
});
test("ETH purchase credits only quoted IMD after the scripted receipt", async () => {
  let now = 1000;
  const e = createEngine({ now: () => now });
  e.configure({ imdBalance: "0" });
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [addresses.imd, fee],
  );
  const swap = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    ["0x080c0f", ["0x", "0x", take]],
  );
  const call = {
    from: WALLET,
    to: addresses.router,
    value: "0x5bdbb83d9000",
    data: encodeFunctionData({
      abi: abis.router,
      functionName: "execute",
      args: ["0x1004", [swap, "0x"], 120n],
    }),
  };
  const before = e.state().ethBalance,
    h = await rpc(e, "eth_sendTransaction", call);
  assert.equal(e.state().imdBalance, "0");
  now += 3000;
  assert.equal((await rpc(e, "eth_getTransactionReceipt", h)).status, "0x1");
  assert.equal(e.state().imdBalance, String(fee));
  assert.ok(BigInt(e.state().ethBalance) < BigInt(before));
});
test("registration creates the actual ABI event and deducts its fee once", async () => {
  const { sharedSpec } = await import("./fixture-chain.mjs");
  let now = 1000;
  const e = createEngine({ now: () => now });
  e.configure({ allowance: String(10n ** 20n) });
  const before = BigInt(e.state().imdBalance),
    h = await rpc(
      e,
      "eth_sendTransaction",
      tx("registerSpec", [sharedSpec, 0n]),
    );
  now += 3000;
  const receipt = await rpc(e, "eth_getTransactionReceipt", h);
  assert.equal(receipt.status, "0x1");
  assert.equal(receipt.logs.length, 1);
  assert.equal(BigInt(e.state().imdBalance), before - 6400000000000000000n);
});
