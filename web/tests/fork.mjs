import fs from "node:fs";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  encodeAbiParameters,
  keccak256,
  pad,
  toHex,
  decodeEventLog,
} from "viem";
import { createServer as createViteServer } from "vite";
import { server, forwardRpc } from "./harness.mjs";
import { walletBrowserChecks } from "./wallet-browser.mjs";
const rpcUrl = process.env.SWORN_TEST_RPC;
if (!rpcUrl)
  throw Error(
    "Set SWORN_TEST_RPC to run the read-only mainnet fork rehearsal. No mainnet writes are sent.",
  );
if (
  !fs.existsSync(
    new URL("../../test/scratch/compile/output.json", import.meta.url),
  )
)
  execFileSync(
    process.execPath,
    [
      new URL("../scripts/derive-storage.mjs", import.meta.url).pathname,
      "--check",
    ],
    { stdio: "inherit" },
  );
const output = new URL("../../test/scratch/fork/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const evidence = {
  at: new Date().toISOString(),
  checks: [],
  limitations: [
    "Anvil impersonation is used only inside an isolated fork. No private key is required and no mainnet transaction is broadcast.",
    "Shared application uses an explicitly injected verified-state fixture after a real kind-3 request; it does not test a real panel callback or signature.",
  ],
};
const proxy = await server({ rpcUrl });
let anvil, vite;
try {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const mainnet = JSON.parse(
    await forwardRpc(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: [],
    }),
  ).result;
  evidence.blockNumber = Number(BigInt(mainnet));
  const log = fs.openSync(new URL("anvil.log", output), "w");
  anvil = spawn(
    "anvil",
    [
      "--silent",
      "--accounts",
      "0",
      "--chain-id",
      "1",
      "--fork-url",
      proxy.rpcUrl,
      "--fork-block-number",
      String(evidence.blockNumber),
      "--port",
      String(port),
    ],
    { stdio: ["ignore", log, log] },
  );
  const chain = defineChain({
    id: 1,
    name: "Ethereum fork",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(`http://127.0.0.1:${port}`, { timeout: 90000 }),
  });
  for (let i = 0; i < 50; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      if (i === 49) throw Error("Anvil did not start.");
    }
  }
  vite = await createViteServer({
    root: new URL("../", import.meta.url).pathname,
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
  const source = await vite.ssrLoadModule("/src/chain.ts");
  const swaps = await vite.ssrLoadModule("/src/swap.ts");
  globalThis.document = { baseURI: proxy.url };
  const r = await source.loadRuntime();
  const h = await source.health(client, r);
  assert.equal(h.price > 0n, true);
  evidence.checks.push(
    "Configured chain, deployed bytecode and all seven dependencies match on the pinned fork.",
  );
  const contributor = JSON.parse(
    fs.readFileSync(
      new URL("../../docs/frontend/live-deployment.json", import.meta.url),
    ),
  ).publicContributors[0];
  const wallet = createWalletClient({
    account: contributor,
    chain,
    transport: http(`http://127.0.0.1:${port}`, { timeout: 90000 }),
  });
  await client.request({
    method: "anvil_impersonateAccount",
    params: [contributor],
  });
  await client.request({
    method: "anvil_setBalance",
    params: [contributor, toHex(10n ** 20n)],
  });
  const ids = [
    101, 201, 202, 301, 302, 303, 401, 402, 403, 404, 501, 502, 503, 601, 701,
    801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201, 1301,
  ];
  const before = await source.lookup(client, r, h, contributor, ids);
  assert.equal(before.token, 0n);
  assert.ok(before.metadata.image.startsWith("data:image/svg+xml"));
  evidence.checks.push(
    "Actual source lookup before mint returns tokenOf=0 and a decoded live Renderer preview using compiler-derived storage slots.",
  );
  async function send(call) {
    const simulated = await client.simulateContract({
      ...call,
      account: contributor,
    });
    const hash = await wallet.writeContract(simulated.request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  }
  const token = source.tokenAbi;
  const initialBalance = await client.readContract({
    address: h.deps.imd,
    abi: token,
    functionName: "balanceOf",
    args: [contributor],
  });
  const quote = await swaps.quoteEth(client, r, 12000000000000000000n);
  assert.equal(quote.maximum, (quote.input * 101n + 99n) / 100n);
  assert.ok(quote.deadline - BigInt(Math.floor(Date.now() / 1000)) <= 120n);
  const ethBefore = await client.getBalance({ address: contributor });
  const swapReceipt = await send(swaps.swapCall(r, quote, contributor));
  const ethAfter = await client.getBalance({ address: contributor });
  const balance = await client.readContract({
    address: h.deps.imd,
    abi: token,
    functionName: "balanceOf",
    args: [contributor],
  });
  assert.equal(balance - initialBalance, quote.output);
  const spent =
    ethBefore - ethAfter - swapReceipt.gasUsed * swapReceipt.effectiveGasPrice;
  assert.ok(spent <= quote.maximum);
  assert.ok(spent > 0n);
  evidence.swap = {
    output: quote.output.toString(),
    quotedInputWei: quote.input.toString(),
    maximumWei: quote.maximum.toString(),
    actualInputWei: spent.toString(),
    refundedWei: (quote.maximum - spent).toString(),
    deadlineSeconds: 120,
  };
  evidence.checks.push(
    "Exact-output ETH→IMD swap executes against live fork contracts; receives exactly 12 IMD, respects 1% maximum, and refunds unspent ETH in the same transaction.",
  );
  const registry = source.contract(r, "Registry").address;
  const fee = 100000000000000000n;
  await send({
    address: h.deps.imd,
    abi: token,
    functionName: "approve",
    args: [registry, fee],
  });
  const sinkBefore = await client.readContract({
    address: h.deps.imd,
    abi: token,
    functionName: "balanceOf",
    args: [h.deps.burnExecutor],
  });
  await send({
    address: registry,
    abi: r.abis.Registry,
    functionName: "mintCard",
    args: [],
  });
  const sinkAfter = await client.readContract({
    address: h.deps.imd,
    abi: token,
    functionName: "balanceOf",
    args: [h.deps.burnExecutor],
  });
  assert.equal(sinkAfter - sinkBefore, fee);
  assert.equal(
    await client.readContract({
      address: h.deps.imd,
      abi: token,
      functionName: "allowance",
      args: [contributor, registry],
    }),
    0n,
  );
  const after = await source.lookup(client, r, h, contributor, ids);
  assert.equal(after.token > 0n, true);
  assert.ok(after.raw.includes("Sworn"));
  assert.equal(
    after.uri,
    await source.read(client, r, "Registry", "tokenURI", [after.token]),
  );
  evidence.checks.push(
    "Mint consumes an exact 0.10 IMD approval, forwards the fee to the live executor, and the actual source lookup switches to the minted wallet’s own tokenURI.",
  );
  await assert.rejects(() =>
    client.simulateContract({
      address: registry,
      abi: r.abis.Registry,
      functionName: "upgrade",
      args: [[701, 801], h.price],
      account: contributor,
    }),
  );
  evidence.checks.push("Registry simulation refuses a multi-id upgrade.");
  const spec = {
    kind: 3,
    target: h.deps.curator,
    item: "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount)",
    arg: "contributor",
    fixedArg: "",
    fixedVal: 0n,
    sumArg: "amount",
    op: 0,
    threshold: 1n,
    fromBlock: 25769870n,
    toBlock: 25789604n,
    name: "Frontend fork check",
  };
  await source.read(client, r, "Composer", "validateSpec", [spec, h.block]);
  await send({
    address: h.deps.imd,
    abi: token,
    functionName: "approve",
    args: [registry, 6400000000000000000n + h.price],
  });
  const registered = await send({
    address: registry,
    abi: r.abis.Registry,
    functionName: "registerSpec",
    args: [spec, 0n],
  });
  let id;
  for (const log of registered.logs) {
    try {
      const ev = decodeEventLog({
        abi: r.abis.Registry,
        data: log.data,
        topics: log.topics,
      });
      if (ev.eventName === "SpecRegistered") id = Number(ev.args.traitId);
    } catch {}
  }
  assert.ok(id >= 10001);
  const requested = await send({
    address: registry,
    abi: r.abis.Registry,
    functionName: "requestSharedFact",
    args: [id, h.price],
  });
  const requestId = await source.read(client, r, "Registry", "sharedPending", [
    id,
  ]);
  assert.notEqual(requestId, pad("0x0", { size: 32 }));
  assert.equal(
    Number(
      (
        await source.read(client, r, "Registry", "pendingRequest", [requestId])
      )[1],
    ),
    id,
  );
  evidence.checks.push(
    `Kind-3 spec id ${id} is read from SpecRegistered; requestSharedFact requests that own id, never 1201 or upgrade.`,
  );
  const compilation = JSON.parse(
    fs.readFileSync(
      new URL("../../test/scratch/compile/output.json", import.meta.url),
    ),
  );
  const layout =
    compilation.contracts["src/Registry.sol"].Registry.storageLayout;
  const mapping = layout.storage.find((s) => s.label === "_requests");
  const type = layout.types[layout.types[mapping.type].value];
  const base = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [requestId, BigInt(mapping.slot)],
      ),
    ),
  );
  const state = type.members.find((m) => m.label === "state");
  const stateSlot = toHex(base + BigInt(state.slot), { size: 32 });
  const old = BigInt(
    await client.getStorageAt({ address: registry, slot: stateSlot }),
  );
  const offset = BigInt(state.offset * 8);
  await client.request({
    method: "anvil_setStorageAt",
    params: [
      registry,
      stateSlot,
      toHex((old & ~(255n << offset)) | (2n << offset), { size: 32 }),
    ],
  });
  const answer = type.members.find((m) => m.label === "answerHash");
  await client.request({
    method: "anvil_setStorageAt",
    params: [
      registry,
      toHex(base + BigInt(answer.slot), { size: 32 }),
      keccak256(encodeAbiParameters([{ type: "address[]" }], [[contributor]])),
    ],
  });
  await send({
    address: registry,
    abi: r.abis.Registry,
    functionName: "applySharedFact",
    args: [id, [contributor]],
  });
  assert.equal(
    await source.read(client, r, "Registry", "hasTrait", [contributor, id]),
    true,
  );
  assert.equal(
    await source.read(client, r, "Registry", "hasTrait", [contributor, 1201]),
    false,
  );
  evidence.checks.push(
    "With a labelled verified-state fixture, applySharedFact grants the registered community id and leaves catalog id 1201 unclaimed.",
  );
  const browserWallet = JSON.parse(
    fs.readFileSync(
      new URL("../../docs/frontend/live-deployment.json", import.meta.url),
    ),
  ).publicContributors[1];
  await client.request({
    method: "anvil_impersonateAccount",
    params: [browserWallet],
  });
  await client.request({
    method: "anvil_setBalance",
    params: [browserWallet, toHex(10n ** 20n)],
  });
  await send({
    address: h.deps.imd,
    abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
    functionName: "transfer",
    args: [browserWallet, 3000000000000000000n],
  });
  evidence.checks.push(
    ...(await walletBrowserChecks({
      url: proxy.url,
      client,
      account: browserWallet,
      r,
      output,
    })),
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (e) {
  evidence.failure = e.stack;
  console.error(e);
  process.exitCode = 1;
} finally {
  if (vite) await vite.close();
  if (anvil) {
    anvil.kill("SIGTERM");
    await new Promise((r) => anvil.once("exit", r));
  }
  await proxy.close();
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
