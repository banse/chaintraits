import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  toHex,
} from "viem";
import { validateSpec } from "../src/pure.mjs";
import { checkSharedSpec } from "../src/shared-safety.mjs";
import { resilientRpc, READ_RPCS } from "../src/rpc.mjs";
test("contract refusals preserve revert data and do not reject a healthy RPC", async () => {
  const calls = [];
  const rpc = resilientRpc({
    urls: ["https://first.invalid", "https://second.invalid"],
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push([url, body.method]);
      return {
        ok: true,
        json: async () =>
          body.method === "eth_call"
            ? {
                error: {
                  code: 3,
                  message: "execution reverted",
                  data: "0x12345678",
                },
              }
            : { result: "0x1" },
      };
    },
  });
  await assert.rejects(
    rpc.request({ method: "eth_call", params: [] }),
    (error) => error.code === 3 && error.data === "0x12345678",
  );
  assert.equal(await rpc.request({ method: "eth_chainId" }), "0x1");
  assert.deepEqual(calls, [
    ["https://first.invalid", "eth_chainId"],
    ["https://first.invalid", "eth_call"],
    ["https://first.invalid", "eth_chainId"],
  ]);
});
const target = "0x1000000000000000000000000000000000000000";
const spec = {
  kind: 3,
  target,
  item: "event Weighted(address indexed contributor, uint256 amount)",
  arg: "contributor",
  sumArg: "amount",
  fixedArg: "",
  fixedVal: 0n,
  op: 0,
  threshold: 2n,
  fromBlock: 100n,
  toBlock: 7299n,
  name: "Weighted wallets",
};
const addresses = [target, "0x2000000000000000000000000000000000000000"];
function logs(keys = addresses) {
  return keys.map((key, i) => ({
    address: target,
    blockNumber: toHex(101n),
    blockHash: "0x" + "11".repeat(32),
    transactionHash: "0x" + "22".repeat(32),
    logIndex: toHex(i),
    topics: encodeEventTopics({
      abi: [parseAbiItem(spec.item)],
      eventName: "Weighted",
      args: { contributor: key },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [BigInt(10 - i)]),
  }));
}
function client(answer = logs()) {
  return {
    getBlock: async () => ({ hash: "0x" + "33".repeat(32) }),
    request: async ({ params }) =>
      BigInt(params[0].fromBlock) <= 101n && BigInt(params[0].toBlock) >= 101n
        ? answer
        : [],
  };
}
for (const name of ["Transfer", "TransferSingle", "TransferBatch"])
  for (const arg of ["from", "to"])
    test(`A refuses ${name} grouped by ${arg}`, async () => {
      const s = {
        ...spec,
        item: `event ${name}(address indexed from, address indexed to, uint256 amount)`,
        arg,
      };
      assert.match(validateSpec(s, 8000n).arg, /Missed reason 9/);
      await assert.rejects(
        checkSharedSpec(client(), s),
        /request price is lost/,
      );
    });
for (const key of [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dEaD",
])
  test(`A refuses a low top-head address ${key}`, async () => {
    await assert.rejects(
      checkSharedSpec(client(logs([key, ...addresses])), spec),
      /below 2\*\*80/,
    );
  });
test("A refuses fewer keys than the required head", async () => {
  await assert.rejects(
    checkSharedSpec(client(logs([target])), spec),
    /short list/,
  );
});
test("A refuses incomplete historical logs", async () => {
  const c = client();
  c.request = async () => {
    throw Error("archive unavailable");
  };
  await assert.rejects(checkSharedSpec(c, spec), /not read in full/);
});
test("A refuses undecodable logs and changed closing block", async () => {
  const bad = logs();
  bad[0].data = "0x";
  await assert.rejects(checkSharedSpec(client(bad), spec));
  const c = client();
  let reads = 0;
  c.getBlock = async () => ({ hash: String(reads++) });
  await assert.rejects(checkSharedSpec(c, spec), /block changed/);
});
test("A valid ranking reads every range and sorts weight descending, addresses ascending on ties", async () => {
  const c = client();
  const ranges = [];
  const original = c.request;
  c.request = async (r) => {
    ranges.push(r.params[0]);
    return original(r);
  };
  const result = await checkSharedSpec(c, spec);
  assert.deepEqual(result.list, addresses);
  assert.equal(result.count, 2);
  assert.equal(ranges.length, 4);
  assert.equal(BigInt(ranges.at(-1).toBlock), 7299n);
});
test("C 429 retries once then recovers without exposing an error", async () => {
  const calls = [];
  const r = resilientRpc({
    fetcher: async (url) => {
      calls.push(url);
      return url === READ_RPCS[0]
        ? new Response("", { status: 429 })
        : Response.json({ result: "0x1" });
    },
  });
  assert.equal(await r.request({ method: "eth_chainId" }), "0x1");
  assert.deepEqual(calls, [READ_RPCS[0], READ_RPCS[0], READ_RPCS[1]]);
});
for (const failure of ["5xx", "timeout", "network", "cors", "malformed"])
  test(`C recovers from ${failure}`, async () => {
    let hits = 0;
    const r = resilientRpc({
      fetcher: async (url) => {
        if (url !== READ_RPCS[0]) return Response.json({ result: "0x1" });
        hits++;
        if (failure === "5xx") return new Response("", { status: 503 });
        if (failure === "malformed") return new Response("broken");
        throw Error(failure);
      },
    });
    assert.equal(await r.request({ method: "eth_chainId" }), "0x1");
    assert.equal(hits, 2);
  });
test("C every RPC failing reports unavailable and retries the entire row on the next read", async () => {
  let hits = 0;
  const r = resilientRpc({
    fetcher: async () => {
      hits++;
      throw Error("network");
    },
  });
  await assert.rejects(
    r.request({ method: "eth_chainId" }),
    /Cannot read the chain, retrying/,
  );
  assert.equal(hits, 8);
  await assert.rejects(r.request({ method: "eth_chainId" }));
  assert.equal(hits, 16);
});
test("C historical empty logs require a second agreeing endpoint; disagreement refuses evidence", async () => {
  const urls = [];
  const r = resilientRpc({
    fetcher: async (url, request) => {
      if (JSON.parse(request.body).method === "eth_chainId")
        return Response.json({ result: "0x1" });
      urls.push(url);
      return Response.json({ result: [] });
    },
  });
  assert.deepEqual(await r.request({ method: "eth_getLogs" }), []);
  assert.deepEqual(urls, READ_RPCS.slice(0, 2));
  const disagree = resilientRpc({
    fetcher: async (url, request) =>
      Response.json({
        result:
          JSON.parse(request.body).method === "eth_chainId"
            ? "0x1"
            : url === READ_RPCS[0]
              ? []
              : [{ data: "0x01" }],
      }),
  });
  await assert.rejects(disagree.request({ method: "eth_getLogs" }), /disagree/);
});
