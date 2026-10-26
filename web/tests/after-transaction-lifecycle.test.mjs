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

test("ETH payment cannot prepare a swap, whether the wallet is funded or not", async () => {
  for (const balance of [40000000000000000n, 100000000000000000n])
    await assert.rejects(preparation({ payment: "ETH", balance }), /only IMD/i);
});

test("a funded IMD route prepares only the approval and fee action", async () => {
  const result = await preparation({
    balance: 100000000000000000n,
  });
  assert.equal(result.plan.payment, "IMD");
  assert.equal(result.plan.quote, undefined);
  assert.equal(result.quoted, 0);
  assert.deepEqual(
    result.steps.map((s) => s.call.functionName),
    ["approve", "mintCard"],
  );
});

test("restored ETH plans and native-value or swap calls cannot reach preflight", async () => {
  for (const override of [
    { payment: "ETH" },
    { quote: { maximum: 1n } },
    { call: { functionName: "execute", args: [], amount: 0n } },
    { call: { functionName: "mintCard", args: [], amount: 1n, value: 1n } },
  ]) {
    const env = {
      getAccount: () => ({ address, chainId: 1 }), config: {},
      plan: { account: address, payment: "IMD", calls: [], ...override },
      ack: true, available: true, next: 0,
      steps: [{ call: override.call || { functionName: "mintCard", args: [], amount: 1n } }],
      site: { r: { deployment: { chainId: 1 } } },
      health: () => assert.fail("unsupported payment must stop before RPC preflight"),
    };
    const checkedCall = compile(env,
      extract("  async function checkedCall(", "\n  async function simulate(") + ";return checkedCall;",
    );
    await assert.rejects(checkedCall(0), /only IMD/i);
  }
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

for (const action of ["approve", "upgrade", "requestSharedFact", "mintCard", "rejected-upgrade"]) test(`a late ${action} hash survives Close and only fact requests navigate before receipt`, async () => {
  let reply,
    promptStarted,
    refreshStarted,
    finishRefresh,
    receiptChecks = 0,
    recorded = 0,
    busy = false,
    dialogOpen = true,
    hashSubmitted,
    finishLookup,
    rejectWallet;
  const submitted = new Promise(resolve => { hashSubmitted = resolve; });
  const lookup = new Promise(resolve => { finishLookup = resolve; });
  const prompt = new Promise((resolve) => {
    promptStarted = resolve;
  });
  const walletReply = new Promise((resolve, reject) => {
    reply = resolve;
    rejectWallet = reject;
  });
  const refreshing = new Promise((resolve) => {
    refreshStarted = resolve;
  });
  const refresh = new Promise((resolve) => {
    finishRefresh = resolve;
  });
  const steps = [{ state: "simulated", call: { functionName: action === "rejected-upgrade" ? "upgrade" : action } }];
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
    location: { hash: "#/request" },
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
        getTransaction: async () => { await lookup; return intent; },
        waitForTransactionReceipt: async () => {
          receiptChecks++;
          return { status: "success", transactionHash: hash };
        },
      },
      r: { chain: { id: 1 }, deployment: { chainId: 1 }, abis: { Registry: [], Composer: [] } },
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
    update: (i, patch) => { Object.assign(steps[i], patch); if (patch.hash) hashSubmitted(); },
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
    setOpen(value) { dialogOpen = value; },
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
  assert.equal(env.location.hash, "#/request", "Signing has not submitted a transaction yet");
  if (action === "rejected-upgrade") {
    rejectWallet(Error("User rejected the request"));
    await running;
    assert.equal(env.location.hash, "#/request");
    assert.equal(dialogOpen, true);
    assert.equal(steps[0].state, "rejected");
    assert.equal(receiptChecks, 0);
    return;
  }
  reply(hash);
  await submitted;
  const isFact = ["upgrade", "requestSharedFact"].includes(action);
  assert.equal(env.location.hash, isFact ? `#/fact-check?wallet=${address}` : "#/request");
  assert.equal(dialogOpen, !isFact, "Only a submitted fact request closes the dialog");
  assert.equal(receiptChecks, 0, "Navigation must not wait for the receipt lookup");
  finishLookup();
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
test("old submitted ETH swap receipts remain recoverable without dropping their intent", () => {
  const intent = { from: address, to: registry, nonce: 1, input: "0xab", value: 1n };
  const result = restoreJournal({
    plan: { account: address, payment: "ETH", quote: { maximum: 1n } },
    steps: [{ state: "pending", hash, intent, call: { functionName: "execute", value: 1n } }],
  });
  assert.equal(result.steps[0].state, "unknown");
  assert.equal(result.steps[0].hash, hash);
  assert.deepEqual(result.steps[0].intent, intent);
  assert.equal(result.plan.payment, "ETH");
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
