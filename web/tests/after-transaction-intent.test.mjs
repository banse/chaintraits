import test from "node:test";
import assert from "node:assert/strict";
import {
  sameIntent,
  replacementOutcome,
  resolveReceipt,
} from "../src/transaction-intent.mjs";

const tx = {
  from: "0x1111",
  nonce: 3,
  to: "0x2222",
  input: "0xabcdef",
  value: 5n,
};
const success = { status: "success", transactionHash: "0xreplacement" };
test("an exact speed-up accepts changed fees but matches all five intent fields", () => {
  assert.equal(sameIntent(tx, { ...tx, gasPrice: 999n, from: "0x1111" }), true);
  assert.equal(
    replacementOutcome(tx, { ...tx, gasPrice: 999n }, success).state,
    "confirmed",
  );
  for (const change of [{ to: "0x3333" }, { input: "0x00" }, { value: 6n }])
    assert.equal(
      replacementOutcome(tx, { ...tx, ...change }, success).state,
      "replaced",
    );
  for (const change of [{ from: "0x4444" }, { nonce: 4 }])
    assert.throws(
      () => replacementOutcome(tx, { ...tx, ...change }, success),
      /sender and nonce/,
    );
});
test("self-transfer cancellation and failed replacement are explicit terminal outcomes", () => {
  assert.equal(
    replacementOutcome(
      tx,
      { ...tx, to: tx.from, input: "0x", value: 0n },
      success,
    ).state,
    "cancelled",
  );
  assert.equal(
    replacementOutcome(tx, tx, { status: "reverted" }).state,
    "failed",
  );
});
test("reload recovery resolves a stored replacement from the original intent", async () => {
  const queried = [];
  const client = {
    getTransaction: async ({ hash }) => {
      queried.push(hash);
      return tx;
    },
  };
  const result = await resolveReceipt(
    client,
    { hash: "0xoriginal", replacement: "0xreplacement", intent: tx },
    success,
  );
  assert.equal(result.state, "confirmed");
  assert.deepEqual(queried, ["0xreplacement"]);
});
test("a pending wallet outcome can only attach the hash of that exact intent", async () => {
  const client = {
    getTransaction: async () => ({ ...tx, input: "0xdifferent" }),
  };
  await assert.rejects(
    resolveReceipt(client, { intent: tx }, success),
    /saved wallet request/,
  );
});
test("legacy receipt recovery retrieves both transactions instead of trusting the hash", async () => {
  const queried = [];
  const client = {
    getTransaction: async ({ hash }) => {
      queried.push(hash);
      return tx;
    },
  };
  assert.equal(
    (await resolveReceipt(client, { hash: "0xoriginal" }, success)).state,
    "confirmed",
  );
  assert.deepEqual(queried, ["0xoriginal", "0xreplacement"]);
});
