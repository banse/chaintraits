import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, decodeEventLog } from "viem";
import { createEngine, addresses, abis, WALLET } from "./engine.mjs";
async function request(settings = {}) {
  let now = 1000;
  const e = createEngine({ now: () => now });
  e.configure({
    allowance: String(10n ** 18n),
    txDelayMs: 0,
    swarmDelayMs: 11000,
    ...settings,
  });
  const hash = await e.rpc({
    method: "eth_sendTransaction",
    params: [
      {
        from: WALLET,
        to: addresses.Registry,
        data: encodeFunctionData({
          abi: abis.Registry,
          functionName: "upgrade",
          args: [[601], 500000000000000000n],
        }),
      },
    ],
  });
  await e.rpc({ method: "eth_getTransactionReceipt", params: [hash] });
  return {
    e,
    advance: (ms) => {
      now += ms;
      e.state();
    },
    panel: () => e.swarm().requests[0],
  };
}
test("each negative/refused answer is stable as the panel completes", async () => {
  const { e, advance, panel } = await request({ swarmOutcome: "failed" });
  advance(7000);
  const early = panel().members.slice(0, 7);
  assert.ok(early.some((m) => m.ok === true && m.answer.answer === false));
  assert.ok(early.some((m) => m.ok === false));
  advance(4000);
  const final = panel();
  assert.deepEqual(final.members.slice(0, 7), early);
  assert.equal(final.status, "failed");
  assert.equal(final.attestedAt, undefined);
  assert.equal(e.state().proven.length, 0);
});
test("panel attestation and Registry storage have distinct controllable delays", async () => {
  const { e, advance, panel } = await request({ deliveryDelayMs: 4000 });
  advance(11000);
  assert.equal(panel().status, "attested");
  assert.ok(panel().attestedAt);
  assert.equal(e.state().proven.length, 0);
  advance(3999);
  assert.equal(e.state().proven.length, 0);
  advance(1);
  assert.ok(e.state().proven.includes(601));
});
test("changing future delays never rewrites an active panel timeline", async () => {
  const { e, advance, panel } = await request();
  advance(5000);
  const before = panel().members.filter((m) => m.ok !== undefined).length;
  e.configure({ swarmDelayMs: 1000 });
  assert.equal(
    panel().members.filter((m) => m.ok !== undefined).length,
    before,
  );
});
test("an attested false result emits Missed, never wallet proof", async () => {
  const { e, advance, panel } = await request({ swarmOutcome: "false" });
  advance(11000);
  assert.equal(panel().status, "attested");
  assert.ok(
    panel().members.every((m) => m.ok === true && m.answer.answer === false),
  );
  const head = await e.rpc({ method: "eth_blockNumber" });
  const logs = await e.rpc({
    method: "eth_getLogs",
    params: [
      {
        address: addresses.Registry,
        fromBlock: "0x0",
        toBlock: head,
        topics: [],
      },
    ],
  });
  const events = logs.map((l) =>
    decodeEventLog({ abi: abis.Registry, data: l.data, topics: l.topics }),
  );
  assert.ok(
    events.some((e) => e.eventName === "Missed" && Number(e.args.reason) === 8),
  );
  assert.equal(e.state().proven.length, 0);
});
