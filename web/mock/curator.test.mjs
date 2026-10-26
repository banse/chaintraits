import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeFunctionData,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  decodeAbiParameters,
  keccak256,
} from "viem";
import { createEngine, addresses, abis, WALLET } from "./engine.mjs";
import { decodeCompletion } from "../src/oracle.mjs";
import fs from "node:fs";
const intakeAbi = JSON.parse(
  fs.readFileSync(new URL("../public/abi/IntakeV2.json", import.meta.url)),
);
const fee = 500000000000000000n;
const spec = (kind = 1) => ({
  kind,
  target: "0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91",
  item: "event Deposited(address indexed contributor, uint256 amount)",
  arg: "contributor",
  fixedArg: "",
  fixedVal: 0n,
  sumArg: kind === 3 ? "amount" : "",
  op: 0,
  threshold: kind === 3 ? 2n : 1n,
  fromBlock: 25769870n,
  toBlock: 25789604n,
  name: "Local contributors",
});
function harness() {
  let time = 1000;
  const e = createEngine({ now: () => time });
  e.configure({
    allowance: String(10n ** 24n),
    imdBalance: String(10n ** 24n),
    txDelayMs: 0,
    swarmDelayMs: 10,
  });
  return {
    e,
    tick: () => {
      time += 10;
      e.state();
    },
  };
}
async function send(e, functionName, args = []) {
  const hash = await e.rpc({
    method: "eth_sendTransaction",
    params: [
      {
        from: WALLET,
        to: addresses.Registry,
        data: encodeFunctionData({ abi: abis.Registry, functionName, args }),
      },
    ],
  });
  return e.rpc({ method: "eth_getTransactionReceipt", params: [hash] });
}
async function read(e, functionName, args = []) {
  const data = await e.rpc({
    method: "eth_call",
    params: [
      {
        to: addresses.Registry,
        data: encodeFunctionData({ abi: abis.Registry, functionName, args }),
      },
      "latest",
    ],
  });
  return decodeFunctionResult({ abi: abis.Registry, functionName, data });
}
const metadata = (uri) =>
  JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
test("curator includes cardless active, immutable samples and accepted outsiders with current binding", () => {
  const { e } = harness(),
    s = e.curator();
  assert.equal(s.registry.toLowerCase(), addresses.Registry.toLowerCase());
  assert.equal(s.sourceCommit, "c4ff3238390fc51962fb67e86affc20cf418126e");
  assert.equal(s.chainId, 1);
  assert.equal(s.mock, true);
  assert(s.wallets.find((w) => w.address === WALLET).directFacts.includes(101));
  assert(
    s.wallets.some(
      (w) =>
        !w.censusMember && w.verifiedFacts.includes(601) && w.tokenId === "0",
    ),
  );
  const shared = s.wallets.find(
    (w) => w.address === "0x3000000000000000000000000000000000000006",
  );
  assert(shared.historicalFacts.includes(1201));
  assert(!shared.verifiedFacts.includes(1201));
});
test("registered community rule is not a fact until accepted; no card required; no builtin leakage", async () => {
  const { e, tick } = harness();
  assert.equal((await send(e, "registerSpec", [spec(), 10001n])).status, "0x1");
  assert.equal(await read(e, "hasTrait", [WALLET, 10001]), false);
  assert.deepEqual(await read(e, "verifiedSpecsOf", [WALLET]), []);
  assert.equal((await send(e, "upgrade", [[10001], fee])).status, "0x1");
  assert.equal(await read(e, "hasTrait", [WALLET, 10001]), false);
  tick();
  assert.equal(await read(e, "hasTrait", [WALLET, 10001]), true);
  assert.deepEqual(await read(e, "verifiedSpecsOf", [WALLET]), [10001]);
  assert.deepEqual(await read(e, "traitsOf", [WALLET]), [101]);
  assert.equal(await read(e, "tokenOf", [WALLET]), 0n);
  assert(
    e
      .curator()
      .wallets.find((w) => w.address === WALLET)
      .verifiedFacts.includes(10001),
  );
  assert(
    e
      .curator()
      .facts.some((f) => f.id === 10001 && f.name === "Local contributors"),
  );
  assert.equal((await send(e, "upgrade", [[10001], fee])).status, "0x0");
});
test("false and no-verdict community results never add credentials or artwork entries", async () => {
  for (const swarmOutcome of ["false", "failed"]) {
    const { e, tick } = harness();
    await send(e, "registerSpec", [spec(), 10001n]);
    e.configure({ swarmOutcome });
    await send(e, "upgrade", [[10001], fee]);
    tick();
    assert.equal(await read(e, "hasTrait", [WALLET, 10001]), false);
    assert.deepEqual(await read(e, "verifiedSpecsOf", [WALLET]), []);
    if (swarmOutcome === "failed") {
      const logs = await e.rpc({
        method: "eth_getLogs",
        params: [
          {
            address: addresses.Registry,
            fromBlock: "0x0",
            toBlock: await e.rpc({ method: "eth_blockNumber", params: [] }),
            topics: [],
          },
        ],
      });
      const event = logs
        .map((log) =>
          decodeEventLog({
            abi: abis.Registry,
            data: log.data,
            topics: log.topics,
          }),
        )
        .find((e) => e.eventName === "NoVerdict");
      const panel = e.swarm("/oracle/requests").requests[0];
      assert.equal(
        event.args.answered,
        panel.members.filter((m) => m.ok === true).length,
      );
      assert.equal(event.args.agreed, panel.agreement.agreed);
    }
  }
});
test("custom shared facts store per-ID lists and require exact list application before acceptance", async () => {
  const { e, tick } = harness();
  await send(e, "registerSpec", [spec(3), 10001n]);
  assert.equal((await send(e, "upgrade", [[10001], fee])).status, "0x0");
  assert.equal(
    (await send(e, "requestSharedFact", [10001, fee])).status,
    "0x1",
  );
  tick();
  const shared = await read(e, "sharedFact", [10001]);
  assert.equal(shared[2], 2);
  assert.equal((await read(e, "sharedFact", [1201]))[2], 0);
  assert.equal(await read(e, "hasTrait", [WALLET, 10001]), false);
  const list = [WALLET, "0x2000000000000000000000000000000000000002"];
  assert.equal(
    shared[1],
    keccak256(encodeAbiParameters([{ type: "address[]" }], [list])),
  );
  assert.equal(
    (await send(e, "applySharedFact", [10001, [WALLET]])).status,
    "0x0",
  );
  assert.equal((await send(e, "applySharedFact", [10001, list])).status, "0x1");
  assert.equal(await read(e, "hasTrait", [WALLET, 10001]), true);
  assert.deepEqual(await read(e, "verifiedSpecsOf", [WALLET]), [10001]);
  assert.equal((await send(e, "applySharedFact", [10001, list])).status, "0x0");
});
test("shared list is discoverable through the actual completion log and calldata reader", async () => {
  const { e, tick } = harness();
  await send(e, "registerSpec", [spec(3), 10001n]);
  await send(e, "requestSharedFact", [10001, fee]);
  tick();
  const stored = await read(e, "sharedFact", [10001]);
  const logs = await e.rpc({
    method: "eth_getLogs",
    params: [
      {
        address: addresses.intake,
        fromBlock: "0x0",
        toBlock: await e.rpc({ method: "eth_blockNumber", params: [] }),
        topics: [],
      },
    ],
  });
  assert.equal(logs.length, 1);
  const event = decodeEventLog({
    abi: intakeAbi,
    data: logs[0].data,
    topics: logs[0].topics,
  });
  assert.equal(event.eventName, "Completed");
  assert.equal(event.args.requestId, stored[0]);
  assert.equal(event.args.delivered, true);
  const tx = await e.rpc({
    method: "eth_getTransactionByHash",
    params: [logs[0].transactionHash],
  });
  assert.equal(tx.to, addresses.intake);
  const completion = decodeCompletion(
    intakeAbi,
    abis.Registry,
    stored[0],
    tx.input,
  );
  const list = decodeAbiParameters(
    [{ type: "address[]" }],
    completion.attestation.answer,
  )[0];
  assert.equal(list.length, 2);
  assert.equal(list[0].toLowerCase(), WALLET);
  assert.equal(keccak256(completion.attestation.answer), stored[1]);
  assert.equal((await send(e, "applySharedFact", [10001, list])).status, "0x1");
});
test("wallet reads cannot alias a different address to mutable active state", async () => {
  const { e } = harness();
  e.configure({ token: "1" });
  assert.equal(
    await read(e, "tokenOf", ["0x3000000000000000000000000000000000000001"]),
    0n,
  );
  assert.equal(
    await read(e, "hasTrait", [
      "0x4000000000000000000000000000000000000001",
      601,
    ]),
    true,
  );
  assert.equal(
    await read(e, "hasTrait", [
      "0x4000000000000000000000000000000000000001",
      101,
    ]),
    false,
  );
  await assert.rejects(
    read(e, "traitsOf", ["0x5000000000000000000000000000000000000001"]),
    /fixture/i,
  );
});
test("dynamic card has thirteen cells, accepted rings, full count, capped metadata and uncapped credentials", async () => {
  const { e, tick } = harness();
  await send(e, "mintCard");
  const before = metadata(await read(e, "tokenURI", [1n]));
  for (let i = 0; i < 40; i++) {
    await send(e, "registerSpec", [
      { ...spec(), name: "Community " + i },
      BigInt(10001 + i),
    ]);
    await send(e, "upgrade", [[10001 + i], fee]);
    tick();
  }
  const after = metadata(await read(e, "tokenURI", [1n]));
  assert.notEqual(after.image, before.image);
  assert.equal(
    after.attributes.find((x) => x.trait_type === "community_count").value,
    40,
  );
  assert.equal(after.verifiedSpecs.length, 32);
  assert.equal((await read(e, "verifiedSpecsOf", [WALLET])).length, 40);
  assert.equal(await read(e, "hasTrait", [WALLET, 10040]), true);
  const svg = Buffer.from(after.image.split(",")[1], "base64").toString();
  assert.equal((svg.match(/data-family=/g) || []).length, 13);
  assert.equal((svg.match(/data-community-ring=/g) || []).length, 39);
  assert.match(svg, /data-community-frame-step="[1-9]/);
  assert.match(svg, /LOCAL MOCK/);
  assert.deepEqual(after.traits, [101]);
});
test("cardless preview honors its explicit claimant override without minting", async () => {
  const { e } = harness(),
    outside = "0x4000000000000000000000000000000000000001";
  const data = await e.rpc({
    method: "eth_call",
    params: [
      {
        to: addresses.Renderer,
        data: encodeFunctionData({
          abi: abis.Renderer,
          functionName: "tokenURIOf",
          args: [addresses.Registry, 1n],
        }),
      },
      "latest",
      {
        [addresses.Registry]: {
          stateDiff: {
            ["0x" + "11".repeat(32)]: "0x" + outside.slice(2).padStart(64, "0"),
          },
        },
      },
    ],
  });
  const uri = decodeFunctionResult({
      abi: abis.Renderer,
      functionName: "tokenURIOf",
      data,
    }),
    m = metadata(uri);
  assert.equal(
    m.attributes.find((a) => a.trait_type === "Claimant").value,
    outside,
  );
  assert.deepEqual(m.traits, [601]);
  assert.equal(e.state().token, "0");
});
test("invalid registration and unresolved IDs fail without consuming a registration slot", async () => {
  const { e } = harness();
  for (const invalid of [
    { ...spec(), name: "" },
    { ...spec(), kind: 6 },
    { ...spec(3), threshold: 33n },
    { ...spec(), toBlock: 999999999n },
  ])
    assert.equal(
      (await send(e, "registerSpec", [invalid, 10001n])).status,
      "0x0",
    );
  assert.equal(await read(e, "nextSpecId"), 10001);
  assert.equal((await send(e, "upgrade", [[10001], fee])).status, "0x0");
  assert.equal(e.curator().facts.filter((f) => !f.builtin).length, 0);
});
