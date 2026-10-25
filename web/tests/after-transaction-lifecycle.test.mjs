import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolveReceipt } from "../src/transaction-intent.mjs";
import { assertWalletContext } from "../src/controllers/wallet-connection.mjs";
import { checkSubmission } from "../src/controllers/submission-check.mjs";
import { restoreJournal as readJournal, encodeJournal } from "../src/models/transaction-journal.mjs";

const source = fs.readFileSync(
  new URL("../src/controllers/transactions.tsx", import.meta.url),
  "utf8",
);
const address = "0x2000000000000000000000000000000000000001";
const registry = "0x0000000000000000000000000000000000000002";
const hash = "0x" + "aa".repeat(32);
const extract = (start, end) => {
  const from = source.indexOf(start),
    to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, "transaction behavior remains testable");
  return stripTypeScriptTypes(source.slice(from, to));
};
const compile = (env, body) =>
  new Function(...Object.keys(env), body)(...Object.values(env));

test("Close cannot discard an unanswered wallet request", () => {
  let cleared = false;
  const env = {
    steps: [{ state: "awaiting signature" }],
    lock: { current: true },
    generation: { current: 0 },
    setBusy() {},
    setPlan() {
      cleared = true;
    },
    setSteps() {},
    setError() {},
    setRegistered() {},
    setOpen() {},
    setAck() {},
  };
  const discard = compile(
    env,
    extract("  function discard()", "\n  async function recover(") +
      ";return discard;",
  );
  assert.equal(discard(), false);
  assert.equal(cleared, false);
  assert.equal(env.generation.current, 0);
  assert.equal(env.lock.current, true);
});

async function preparation({
  payment = "IMD",
  balance = 0n,
  chainId = 1,
  freshChainId = chainId,
} = {}) {
  const fee = 100000000000000000n;
  let plan,
    steps,
    quoted = 0;
  const env = {
    lock: { current: false },
    steps: [],
    history: [],
    setHistory() {},
    setError() {},
    account: { address, chainId },
    getAccount: () => ({ address, chainId: freshChainId }),
    config: {},
    opener: { current: null },
    document: { activeElement: null },
    site: {
      health: true,
      r: { deployment: { chainId: 1 } },
      client: {
        readContract: async ({ functionName }) =>
          functionName === "balanceOf" ? balance : 0n,
      },
    },
    generation: { current: 0 },
    health: async () => ({
      mintFee: fee,
      specFee: fee,
      price: fee,
      deps: { imd: registry },
    }),
    sharedSafety: async () => {},
    read: async () => 0n,
    quoteEth: async (_client, _r, output) => {
      quoted++;
      return { output, maximum: 1n };
    },
    tokenAbi: [],
    contract: () => ({ address: registry }),
    swapCall: () => ({ functionName: "execute", args: [] }),
    imd: (value) => String(Number(value) / 1e18),
    setPlan: (value) => {
      plan = value;
    },
    setSteps: (value) => {
      steps = value;
    },
    setAck() {},
    setRegistered() {},
    setOpen() {},
  };
  const prepare = compile(
    env,
    extract("  async function prepare(", "\n  async function checkedCall(") +
      ";return prepare;",
  );
  await prepare(
    "Mint card",
    "mint",
    [{ label: "Mint card", functionName: "mintCard", args: [], amount: fee }],
    [],
    payment,
    { token: 0n },
  );
  return { plan, steps, quoted };
}

test("zero and partial IMD balances cannot expose a payable approval", async () => {
  for (const balance of [0n, 50000000000000000n])
    await assert.rejects(
      preparation({ balance }),
      /insufficient IMD|need .*more IMD/i,
    );
});

test("ETH funding uses existing IMD and purchases only the deficit", async () => {
  const result = await preparation({
    payment: "ETH",
    balance: 40000000000000000n,
  });
  assert.equal(result.plan.quote.output, 60000000000000000n);
  assert.equal(result.quoted, 1);
  assert.deepEqual(
    result.steps.map((s) => s.call.functionName),
    ["execute", "approve", "mintCard"],
  );
});

test("already-funded ETH route adds no swap", async () => {
  const result = await preparation({
    payment: "ETH",
    balance: 100000000000000000n,
  });
  assert.equal(result.quoted, 0);
  assert.deepEqual(
    result.steps.map((s) => s.call.functionName),
    ["approve", "mintCard"],
  );
});

test("preparation uses the current account chain immediately after a switch", async () => {
  const result = await preparation({
    balance: 100000000000000000n,
    chainId: 8453,
    freshChainId: 1,
  });
  assert.equal(result.plan.account, address);
});

test("a stale correct-chain render cannot prepare after switching away", async () => {
  await assert.rejects(
    preparation({
      balance: 100000000000000000n,
      chainId: 1,
      freshChainId: 8453,
    }),
    /Switch to Ethereum/,
  );
});

test("an exact-intent successful replacement can resolve the blocked journal", async () => {
  const original = "0x" + "11".repeat(32),
    replacement = "0x" + "22".repeat(32);
  let steps = [{ state: "unknown", hash: original, replacement }],
    records = 0;
  const tx = {
    from: address,
    to: registry,
    nonce: 4,
    input: "0xabcdef",
    value: 0n,
  };
  const env = {
    steps,
    lock: { current: false },
    setBusy() {},
    setError() {},
    setSteps(fn) {
      steps = fn(steps);
    },
    update(i, patch) {
      steps[i] = { ...steps[i], ...patch };
    },
    site: {
      client: {
        getTransactionReceipt: async () => ({
          transactionHash: replacement,
          status: "success",
          logs: [],
        }),
        getTransaction: async () => tx,
      },
      refresh: async () => {},
    },
    recordResult() {
      records++;
    },
    explain: String,
    resolveReceipt,
    checkSubmission,
    assertWalletContext,
    refreshAction: async () => {},
  };
  const recover = compile(
    env,
    extract("  async function recover(", "\n  return {") + ";return recover;",
  );
  await recover(replacement);
  assert.equal(steps[0].state, "confirmed");
  assert.equal(records, 1);
});

test("a late wallet hash survives Close and locks through authoritative refresh", async () => {
  let reply,
    promptStarted,
    refreshStarted,
    finishRefresh,
    receiptChecks = 0,
    recorded = 0,
    busy = false;
  const prompt = new Promise((resolve) => {
    promptStarted = resolve;
  });
  const walletReply = new Promise((resolve) => {
    reply = resolve;
  });
  const refreshing = new Promise((resolve) => {
    refreshStarted = resolve;
  });
  const refresh = new Promise((resolve) => {
    finishRefresh = resolve;
  });
  const steps = [{ state: "simulated", call: { functionName: "approve" } }];
  const intent = {
    from: address,
    to: registry,
    nonce: 4,
    input: "0xabcdef",
    value: 0n,
  };
  const env = {
    lock: { current: false },
    generation: { current: 0 },
    next: 0,
    plan: { account: address },
    steps,
    stepsRef: { current: steps },
    eligibilityConfirmed: true,
    ack: true,
    available: true,
    setBusy(value) {
      busy = value;
    },
    setError() {},
    checkedCall: async () => ({ address: registry, value: 0n }),
    site: {
      client: {
        simulateContract: async () => ({ request: {} }),
        estimateContractGas: async () => 21000n,
        getGasPrice: async () => 1n,
        getTransactionCount: async () => 4,
        getTransaction: async () => intent,
        waitForTransactionReceipt: async () => {
          receiptChecks++;
          return { status: "success", transactionHash: hash };
        },
      },
      r: { chain: { id: 1 }, deployment: { chainId: 1 } },
    },
    connectedProvider: async () => ({
      request: async () => {
        promptStarted();
        return walletReply;
      },
    }),
    config: { connectors: [] },
    getAccount: () => ({ address, chainId: 1, connector: { uid: "chosen" } }),
    latestEligibility: {
      current: { eligibilityNegative: false, requestAnyway: false },
    },
    createWalletClient: ({ transport }) => ({
      getChainId: async () => 1,
      getAddresses: async () => [address],
      writeContract: () => transport.request({ method: "eth_sendTransaction" }),
    }),
    custom: (x) => x,
    encodeFunctionData: () => intent.input,
    update: (i, patch) => Object.assign(steps[i], patch),
    recordResult: () => recorded++,
    explain: String,
    resolveReceipt,
    checkSubmission,
    assertWalletContext,
    refreshAction: async () => {
      refreshStarted();
      await refresh;
    },
    setPlan() {
      assert.fail("pending plan must stay");
    },
    setSteps() {
      assert.fail("pending steps must stay");
    },
    setRegistered() {},
    setOpen() {},
    setAck() {},
  };
  const execute = compile(
    env,
    extract("  async function execute(", "\n  function recordResult(") +
      ";return execute;",
  );
  const discard = compile(
    env,
    extract("  function discard()", "\n  async function recover(") +
      ";return discard;",
  );
  const running = execute();
  await prompt;
  assert.equal(steps[0].state, "awaiting signature");
  assert.equal(discard(), false);
  reply(hash);
  await refreshing;
  assert.equal(steps[0].hash, hash);
  assert.equal(steps[0].state, "refreshing");
  assert.equal(recorded, 0);
  assert.equal(busy, true);
  assert.equal(env.lock.current, true);
  await execute();
  assert.equal(receiptChecks, 1);
  finishRefresh();
  await running;
  assert.equal(steps[0].state, "confirmed");
  assert.equal(recorded, 1);
  assert.equal(busy, false);
  assert.equal(env.lock.current, false);
});

const restoreJournal = (saved) => {
  const binding = {chainId:1,registry};
  return readJournal({getItem:()=>encodeJournal(binding,saved)},binding);
};
test("reload retains an unresolved wallet intent without making it signable again", () => {
  const intent = {
    from: address,
    to: registry,
    nonce: 1,
    input: "0xab",
    value: 0n,
  };
  const result = restoreJournal({
    plan: { account: address },
    steps: [{ state: "awaiting signature", intent }],
  });
  assert.equal(result.steps[0].state, "unknown");
  assert.deepEqual(result.steps[0].intent, intent);
});
test("reload keeps both replacement hashes and a settled cancellation", () => {
  const replacement = "0x" + "bb".repeat(32);
  const result = restoreJournal({
    steps: [{ state: "cancelled", hash, replacement }],
  });
  assert.equal(result.steps[0].state, "cancelled");
  assert.equal(result.steps[0].hash, hash);
  assert.equal(result.steps[0].replacement, replacement);
});
test("cleared settled receipt history survives reload with no active preparation", () => {
  const history = [
    { plan: { title: "Mint" }, steps: [{ state: "confirmed", hash }] },
  ];
  assert.deepEqual(
    restoreJournal({ plan: null, steps: [], history }).history,
    history,
  );
});
