// Round 8, item 1: no reads after a check gives up, and a range is split only
// when every endpoint that refused it refused it for size. Fake RPCs only.
import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, parseAbiItem, toHex } from "viem";
import { resilientRpc, READ_RPCS } from "../src/rpc.mjs";
import { checkEligibility } from "../src/eligibility.mjs";

const wallet = "0x2000000000000000000000000000000000000001";
const seat = "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D";
const FROM = 25090085n;
const [publicnode, tenderly, mevblocker, thirdweb] = READ_RPCS;
const spec = { kind: 6, target: seat, fromBlock: FROM, toBlock: 0n, threshold: 1n };
const transfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const json = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Each endpoint is a function (method, params) => result | Response | throw.
function fakeNet(behaviour, { latency = 1, head = FROM + 64n + 3000n } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, method: body.method, params: body.params, at: Date.now() });
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, latency);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(init.signal.reason);
      });
    });
    if (body.method === "eth_chainId")
      return json({ jsonrpc: "2.0", id: body.id, result: "0x1" });
    if (body.method === "eth_blockNumber")
      return json({ jsonrpc: "2.0", id: body.id, result: toHex(head) });
    const out = behaviour[url](body.params[0]);
    if (out instanceof Response) return out;
    if (out?.error) return json({ jsonrpc: "2.0", id: body.id, error: out.error });
    return json({ jsonrpc: "2.0", id: body.id, result: out });
  };
  return { calls, fetcher, logs: () => calls.filter((c) => c.method === "eth_getLogs") };
}
const size = { error: { code: -32602, message: "block range is too large; max 1000 blocks" } };
const rateLimited = () => new Response("rate limited", { status: 429 });
const archive = () => new Response("Archive requests require a personal token", { status: 403 });
const seatLog = (f) => {
  const block = FROM + 10n;
  if (BigInt(f.fromBlock) > block || BigInt(f.toBlock) < block) return [];
  return [
    {
      address: seat,
      blockNumber: toHex(block),
      blockHash: "0x" + "11".repeat(32),
      transactionHash: "0x" + "22".repeat(32),
      logIndex: "0x0",
      removed: false,
      topics: encodeEventTopics({
        abi: [transfer],
        eventName: "Transfer",
        args: { from: "0x3000000000000000000000000000000000000002", to: wallet, tokenId: 1n },
      }),
      data: "0x",
    },
  ];
};
const sized = (f) =>
  BigInt(f.toBlock) - BigInt(f.fromBlock) + 1n > 1000n ? size : seatLog(f);
const client = (net) => {
  const pool = resilientRpc({ fetcher: net.fetcher });
  return { pool, request: pool.request };
};
const check = (c, options) =>
  checkEligibility(c, async () => spec, wallet, 601, options);

test("601 with tenderly 429, thirdweb size refusal, publicnode archive 403: returns within 20 s, no split, no request after return", async () => {
  const net = fakeNet({
    [publicnode]: archive,
    [tenderly]: rateLimited,
    [mevblocker]: seatLog,
    [thirdweb]: () => size,
  });
  const started = Date.now();
  const result = await check(client(net));
  const returned = Date.now();
  assert.ok(returned - started < 20000, `took ${returned - started} ms`);
  assert.equal(result.state, "unknown");
  // The refusals were not all for size: the whole window was never halved.
  const head = FROM + 64n + 3000n;
  for (const c of net.logs()) {
    assert.equal(BigInt(c.params[0].fromBlock), FROM);
    assert.equal(BigInt(c.params[0].toBlock), head - 64n);
  }
  const count = net.calls.length;
  await sleep(600);
  assert.equal(net.calls.length, count, "no request after the check returned");
  console.log(`  mixed refusals: ${count} calls, ${returned - started} ms, ${net.logs().length} eth_getLogs`);
});

test("a range every endpoint refuses for size is still read in parts", async () => {
  const net = fakeNet({
    [publicnode]: sized,
    [tenderly]: sized,
    [mevblocker]: sized,
    [thirdweb]: sized,
  });
  const result = await check(client(net));
  assert.equal(result.state, "met");
  const answered = net
    .logs()
    .filter((c) => BigInt(c.params[0].toBlock) - BigInt(c.params[0].fromBlock) < 1000n);
  assert.ok(answered.length >= 2, "parts were read");
  console.log(`  all size refusals: ${net.logs().length} eth_getLogs, result met`);
});

test("the deadline stops the pool's split reads: nothing is sent after the check returns", async () => {
  // Every endpoint refuses for size at every range above 1 block, slowly:
  // the pool would halve for a long time without the deadline.
  const tiny = (f) =>
    BigInt(f.toBlock) > BigInt(f.fromBlock) ? size : [];
  const net = fakeNet(
    { [publicnode]: tiny, [tenderly]: tiny, [mevblocker]: tiny, [thirdweb]: tiny },
    { latency: 15 },
  );
  const started = Date.now();
  const result = await check(client(net), { timeoutMs: 300 });
  const returned = Date.now();
  assert.equal(result.state, "unknown");
  assert.ok(returned - started < 1000);
  const count = net.calls.length;
  await sleep(800);
  const late = net.calls.filter((c) => c.at > returned);
  assert.deepEqual(late, [], "no request after the deadline");
  assert.equal(net.calls.length, count);
  console.log(`  deadline: ${count} calls before return, 0 after`);
});

test("a page or wallet change during a read stops its requests", async () => {
  const tiny = (f) =>
    BigInt(f.toBlock) > BigInt(f.fromBlock) ? size : [];
  const net = fakeNet(
    { [publicnode]: tiny, [tenderly]: tiny, [mevblocker]: tiny, [thirdweb]: tiny },
    { latency: 15 },
  );
  const page = new AbortController();
  const running = check(client(net), { signal: page.signal });
  await sleep(150);
  page.abort();
  const aborted = Date.now();
  const result = await running;
  assert.equal(result.state, "unknown");
  await sleep(600);
  assert.deepEqual(net.calls.filter((c) => c.at > aborted), []);
});

test("a scoped pool read sends nothing once its signal aborts", async () => {
  const net = fakeNet({
    [publicnode]: (f) => (BigInt(f.toBlock) > BigInt(f.fromBlock) ? size : []),
    [tenderly]: (f) => (BigInt(f.toBlock) > BigInt(f.fromBlock) ? size : []),
    [mevblocker]: (f) => (BigInt(f.toBlock) > BigInt(f.fromBlock) ? size : []),
    [thirdweb]: (f) => (BigInt(f.toBlock) > BigInt(f.fromBlock) ? size : []),
  }, { latency: 10 });
  const pool = resilientRpc({ fetcher: net.fetcher });
  const controller = new AbortController();
  const read = pool
    .scoped(controller.signal)
    .request({
      method: "eth_getLogs",
      params: [{ address: seat, fromBlock: toHex(1n), toBlock: toHex(1n << 20n) }],
    })
    .catch((e) => e);
  await sleep(100);
  controller.abort();
  const at = Date.now();
  const error = await read;
  assert.match(String(error.message), /stopped/i);
  await sleep(300);
  assert.deepEqual(net.calls.filter((c) => c.at > at), []);
});

test("a range refused for size by one endpoint and rate-limited by others is not split", async () => {
  const net = fakeNet({
    [publicnode]: rateLimited,
    [tenderly]: rateLimited,
    [mevblocker]: rateLimited,
    [thirdweb]: () => size,
  });
  const pool = resilientRpc({ fetcher: net.fetcher });
  await assert.rejects(
    pool.request({
      method: "eth_getLogs",
      params: [{ address: seat, fromBlock: toHex(1n), toBlock: toHex(5000n) }],
    }),
  );
  for (const c of net.logs()) assert.equal(c.params[0].toBlock, toHex(5000n));
});
