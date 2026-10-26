// Local chain of the Sworn mock: anvil (chain id 1) with the launch's real Registry, Composer and
// Renderer code at their mainnet addresses, stand-ins for the dependencies, sample wallets, and a
// JSON-RPC front that answers the history before the local genesis (the WhitelistCurator window).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import {
  encodeAbiParameters,
  encodeDeployData,
  encodeEventTopics,
  encodeFunctionData,
  decodeFunctionResult,
  decodeEventLog,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseEther,
  stringToHex,
  toEventSelector,
  toHex,
  pad,
} from "viem";

export const A = {
  registry: "0x0da2679000ea5380d1361cc3cca7d4e8c881f766",
  composer: "0xf564dd76bd081554170c5e0b78144abfb39f7061",
  renderer: "0x3039eaf3b979759c77a2a3fc62850f9534162c3b",
  curator: "0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91",
  imd: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
  intake: "0xa43e6f75ee006411f79ac1c84120606c2330de82",
  burnExecutor: "0xe29386719c155b6847ad5a4e97c6674f10ffc750",
  quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
  router: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  stubs: [
    "0x000000000004444c5dc75cb358380d2e3de08a90",
    "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
    "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    "0x000000000022d473030f116ddee9f6b43ac78ba3",
  ],
};
export const ACTION = stringToHex("oracle.request@oracle-1", { size: 32 });
// Local attester key: a fixed, public test key. It signs attestations on this chain only.
export const ATTESTER_KEY = keccak256(stringToHex("sworn-local attester, not a secret"));
// Mainnet-like heights: the launch block is 26,242,885; the local genesis sits above it.
export const GENESIS = 26244000n;
const DEPLOYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"; // anvil's first prefunded account
const REENTRANCY_SLOT = "0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00";

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

export async function startChain({ root, samples, log = () => {} }) {
  const chainDir = path.join(root, "mock", "chain");
  const art = (name) => JSON.parse(fs.readFileSync(path.join(chainDir, `${name}.json`)));
  const abis = Object.fromEntries(
    ["Registry", "Composer", "Renderer", "WhitelistCurator", "IntakeV2"].map((n) => [
      n,
      JSON.parse(fs.readFileSync(path.join(root, "mock", "site", "abi", `${n}.json`))),
    ]),
  );
  const port = await freePort();
  const genesisFile = path.join(chainDir, "genesis.json");
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(
    genesisFile,
    JSON.stringify({
      config: {
        chainId: 1, homesteadBlock: 0, eip150Block: 0, eip155Block: 0, eip158Block: 0, byzantiumBlock: 0,
        constantinopleBlock: 0, petersburgBlock: 0, istanbulBlock: 0, berlinBlock: 0, londonBlock: 0,
        shanghaiTime: 0, cancunTime: 0, pragueTime: 0,
      },
      nonce: "0x0", timestamp: toHex(now - 12), extraData: "0x", gasLimit: toHex(36000000), difficulty: "0x0",
      mixHash: pad("0x0"), coinbase: "0x0000000000000000000000000000000000000000", number: toHex(GENESIS),
      baseFeePerGas: toHex(1000000000n), alloc: {},
    }),
  );
  const bin = process.env.ANVIL || path.join(process.env.HOME, ".foundry", "bin", "anvil");
  const anvil = spawn(bin, ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "1", "--init", genesisFile, "--silent"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const lifetime = new AbortController();
  const stop = () => {
    lifetime.abort(Error("Local simulation chain stopped"));
    anvil.kill("SIGTERM");
  };
  let anvilError = "";
  anvil.stderr.on("data", (d) => { anvilError = (anvilError + d).slice(-4000); });
  anvil.once("error", error => lifetime.abort(Error(`Anvil failed to start (${bin}): ${error.message}`)));
  anvil.once("exit", (code, signal) => lifetime.abort(Error(`Local Anvil exited (${signal || code}): ${anvilError || "no output"}`)));
  const url = `http://127.0.0.1:${port}`;
  let id = 0;
  async function rpc(method, params = []) {
    lifetime.signal.throwIfAborted();
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]),
    });
    const body = await r.json();
    if (body.error) throw Object.assign(Error(body.error.message), { rpc: body.error });
    return body.result;
  }
  try {
  for (let i = 0; ; i++) {
    try {
      await rpc("eth_chainId");
      break;
    } catch {
      lifetime.signal.throwIfAborted();
      if (i > 50) throw Error(`anvil did not start: ${anvilError || "no output"}`);
      await sleep(100, undefined, { signal: lifetime.signal });
    }
  }

  async function waitTx(hash) {
    for (let i = 0; i < 100; i++) {
      const rc = await rpc("eth_getTransactionReceipt", [hash]);
      if (rc) {
        if (rc.status !== "0x1") throw Error(`setup transaction reverted: ${hash}`);
        return rc;
      }
      await sleep(50, undefined, { signal: lifetime.signal });
    }
    throw Error(`no receipt for ${hash}`);
  }
  // Serialize mining changes, so another request cannot accidentally mine a delayed transaction.
  let miningQueue = Promise.resolve();
  let miningPending = false;
  async function sendDelayed(from, to, data, value, seconds = 0) {
    lifetime.signal.throwIfAborted();
    const previous = miningQueue;
    let unlock;
    miningQueue = new Promise(resolve => { unlock = resolve; });
    await previous;
    async function releaseMining() {
      try {
        if (seconds && !lifetime.signal.aborted) await rpc("evm_setAutomine", [true]);
      } finally {
        miningPending = false;
        unlock();
      }
    }
    try {
      lifetime.signal.throwIfAborted();
      miningPending = true;
      if (seconds) await rpc("evm_setAutomine", [false]);
      const hash = await rpc("eth_sendTransaction", [{ from, to, data,
        ...(value ? { value: typeof value === "string" ? value : toHex(value) } : {}) }]);
      const receipt = (async () => {
        try {
          if (seconds) { await sleep(seconds * 1000, undefined, { signal: lifetime.signal }); await rpc("evm_mine"); }
          return await waitTx(hash);
        } finally {
          await releaseMining();
        }
      })();
      return { hash, receipt };
    } catch (error) {
      await releaseMining().catch(cleanupError => log(`Failed to restore local automining: ${cleanupError.message}`));
      throw error;
    }
  }
  const send = async (from, to, data, value) => (await sendDelayed(from, to, data, value)).receipt;
  async function deploy(bytecode) {
    const rc = waitTx(await rpc("eth_sendTransaction", [{ from: DEPLOYER, data: bytecode }]));
    return (await rc).contractAddress;
  }
  async function place(target, bytecode) {
    const temp = await deploy(bytecode);
    await rpc("anvil_setCode", [target, await rpc("eth_getCode", [temp, "latest"])]);
    return temp;
  }
  const call = async (to, abi, functionName, args = [], from) =>
    decodeFunctionResult({
      abi,
      functionName,
      data: await rpc("eth_call", [{ to, data: encodeFunctionData({ abi, functionName, args }), ...(from ? { from } : {}) }, "latest"]),
    });
  const tx = (from, to, abi, functionName, args = [], value) =>
    send(from, to, encodeFunctionData({ abi, functionName, args }), value);

  // Stand-ins at the dependency addresses.
  const mocks = Object.fromEntries(
    ["MockCurator", "MockIMD", "MockIntake", "MockQuoter", "MockRouter"].map((n) => [n, art(n)]),
  );
  await place(A.curator, mocks.MockCurator.bytecode);
  await place(A.imd, mocks.MockIMD.bytecode);
  await place(A.intake, mocks.MockIntake.bytecode);
  await place(A.quoter, mocks.MockQuoter.bytecode);
  await place(
    A.router,
    encodeDeployData({ abi: mocks.MockRouter.abi, bytecode: mocks.MockRouter.bytecode, args: [A.imd, A.quoter] }),
  );
  for (const a of [A.burnExecutor, ...A.stubs]) await rpc("anvil_setCode", [a, "0x00"]);
  // Multicall3 at its canonical address, as on mainnet (runtime vendored from mainnet in multicall3.json).
  const mc3 = JSON.parse(fs.readFileSync(new URL("./multicall3.json", import.meta.url), "utf8"));
  await rpc("anvil_setCode", [mc3.address, mc3.runtime]);
  await tx(DEPLOYER, A.intake, mocks.MockIntake.abi, "setPrice", [ACTION, A.imd, parseEther(samples.price.oracleImd)]);
  await tx(DEPLOYER, A.quoter, mocks.MockQuoter.abi, "setPrice", [BigInt(samples.price.weiPerImd)]);

  // The launch's code, unchanged, at the mainnet addresses. Renderer and Composer hold no state.
  const built = art("contracts");
  for (const n of ["Renderer", "Composer"])
    await rpc("anvil_setCode", [A[n.toLowerCase()], built[n].runtime]);
  // The Registry keeps its dependencies in storage: run its constructor elsewhere with the local
  // attester, then move code and every constructor-written slot to the mainnet address.
  const { privateKeyToAccount } = await import("viem/accounts");
  const attester = privateKeyToAccount(ATTESTER_KEY);
  const temp = await deploy(
    encodeDeployData({
      abi: abis.Registry,
      bytecode: built.Registry.creation,
      args: [A.curator, A.imd, A.intake, attester.address, A.renderer, A.composer, A.burnExecutor],
    }),
  );
  await rpc("anvil_setCode", [A.registry, built.Registry.runtime]);
  for (const slot of [...Array.from({ length: 26 }, (_, i) => toHex(i, { size: 32 })), REENTRANCY_SLOT])
    await rpc("anvil_setStorageAt", [A.registry, slot, await rpc("eth_getStorageAt", [temp, slot, "latest"])]);
  if ((await call(A.registry, abis.Registry, "attester")).toLowerCase() !== attester.address.toLowerCase())
    throw Error("Registry storage move failed");
  if ((await call(A.registry, abis.Registry, "name")) !== "Sworn") throw Error("Registry name missing after the move");

  // Sample wallets: balances, curator rows, and their seeded history through the real Registry.
  const wallets = samples.wallets.map((w) => ({ ...w, address: getAddress(w.address.toLowerCase()) }));
  for (const w of wallets) {
    await rpc("anvil_setBalance", [w.address, toHex(parseEther(w.eth))]);
    await rpc("anvil_impersonateAccount", [w.address]);
    await tx(DEPLOYER, A.imd, mocks.MockIMD.abi, "mint", [w.address, parseEther(w.imd)]);
    const c = w.curator;
    await tx(DEPLOYER, A.curator, mocks.MockCurator.abi, "set", [
      w.address, BigInt(c.hour), c.joined, BigInt(c.txs), parseEther(c.contributedEth), BigInt(c.points),
    ]);
  }

  // History before the local genesis: the WhitelistCurator logs every shared (kind 3) catalog fact
  // ranks. One synthetic Deposited log per contributor per deposit, inside each spec's window.
  const specs = {};
  for (const id of [601, 701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201, 1301])
    specs[id] = { id, ...(await call(A.registry, abis.Registry, "specOf", [id])) };
  const sharedSpecs = Object.values(specs).filter((s) => Number(s.kind) === 3);
  const history = syntheticHistory({ specs: sharedSpecs, wallets });
  factHistory({ history, specs, wallets });

  const chain = {
    url, rpc, call, tx, send, sendDelayed, abis, mocks, wallets, attester, history, sharedSpecs, specs,
    get miningPending() { return miningPending; },
    stop,
    genesisTime: now - 12,
  };
  log(`local chain ready: anvil ${url}, genesis ${GENESIS}, ${wallets.length} sample wallets`);
  return chain;
  } catch (error) {
    stop();
    throw error;
  }
}

// Deterministic pre-genesis history for the shared ranking windows.
function syntheticHistory({ specs, wallets }) {
  const logs = [];
  const blocks = new Map();
  for (const s of specs) {
    const event = parseAbiItem(s.item);
    const from = BigInt(s.fromBlock), to = BigInt(s.toBlock);
    const head = Number(s.threshold);
    // Sample wallets that joined rank by their own weight: A near the top, C inside the head, B below
    // it. Fillers complete a list longer than the head; every address is above 2**80.
    const people = [];
    const weights = { A: 1500n, B: 50n, C: 700n };
    for (const w of wallets.filter((w) => w.curator.joined))
      people.push({ address: w.address, weight: weights[w.label[0]] ?? 400n });
    for (let i = 0; i < head + 12; i++) {
      const address = getAddress(`0x5ea1${(i + 1).toString(16).padStart(32, "0")}c1a1`);
      people.push({ address, weight: BigInt(1000 - i * 23) });
    }
    let n = 0;
    for (const p of people) {
      const parts = [p.weight / 2n, p.weight - p.weight / 2n];
      for (const w of parts) {
        const block = from + ((BigInt(n) * 7919n) % (to - from + 1n));
        n++;
        const inputs = event.inputs.filter((x) => !x.indexed);
        const values = inputs.map((x) => (x.name === s.sumArg ? w : x.name === "newWeight" ? p.weight : 1n));
        logs.push({
          address: s.target.toLowerCase(),
          blockNumber: toHex(block),
          blockHash: blockHash(block),
          transactionHash: keccak256(stringToHex(`sworn-local tx ${s.id} ${n}`)),
          transactionIndex: "0x0",
          logIndex: toHex(n % 50),
          removed: false,
          topics: encodeEventTopics({ abi: [event], eventName: event.name, args: { [s.arg]: p.address, hour: 0n } }),
          data: encodeAbiParameters(inputs, values),
        });
      }
    }
  }
  logs.sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : 0));
  // Unique log index per block, as a node would return them.
  const perBlock = new Map();
  for (const l of logs) {
    const k = l.blockNumber;
    const i = perBlock.get(k) || 0;
    l.logIndex = toHex(i);
    perBlock.set(k, i + 1);
  }
  return { logs, blocks };
}

// One log per (wallet, catalog fact) the samples list, meeting that fact's rule, and a seat transfer.
const IDMD = "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d";
function factHistory({ history, specs, wallets }) {
  let n = 0;
  const add = (address, event, args, block) => {
    const inputs = event.inputs.filter((x) => !x.indexed);
    history.logs.push({
      address,
      blockNumber: toHex(block),
      blockHash: blockHash(block),
      transactionHash: keccak256(stringToHex(`sworn-local fact tx ${n++}`)),
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false,
      topics: encodeEventTopics({ abi: [event], eventName: event.name, args }),
      data: encodeAbiParameters(inputs, inputs.map((x) => args[x.name] ?? (x.type === "bool" ? false : x.type === "address" ? "0x0000000000000000000000000000000000000000" : 1n))),
    });
  };
  for (const w of wallets) {
    const h = w.history || {};
    for (const id of h.facts || []) {
      const s = specs[id];
      if (!s || Number(s.kind) > 2) continue;
      const event = parseAbiItem(s.item);
      const args = { [s.arg]: w.address };
      if (s.fixedArg) args[s.fixedArg] = BigInt(s.fixedVal);
      for (const x of event.inputs) if (x.indexed && args[x.name] === undefined) args[x.name] = x.type === "address" ? w.address : 7n;
      const from = BigInt(s.fromBlock), to = BigInt(s.toBlock);
      add(s.target.toLowerCase(), event, args, from + ((to - from) * BigInt(37 + n * 13)) / 1000n);
    }
    if (h.seatToken) {
      const event = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
      add(IDMD, event, { from: "0x0000000000000000000000000000000000000000", to: w.address, tokenId: BigInt(h.seatToken) }, 25600000n);
    }
  }
  history.logs.sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : 0));
  const perBlock = new Map();
  for (const l of history.logs) {
    const i = perBlock.get(l.blockNumber) || 0;
    l.logIndex = toHex(i);
    perBlock.set(l.blockNumber, i + 1);
  }
  history.nonces = Object.fromEntries(wallets.map((w) => [w.address.toLowerCase(), w.history?.nonceAtLaunch ?? 0]));
}

// What the chain data says for a fact: the count (kinds 1, 2), the nonce (5) or a seat (6).
export function factValue(chain, spec, wallet) {
  const k = Number(spec.kind);
  const who = wallet.toLowerCase();
  if (k === 5) return BigInt(chain.history.nonces?.[who] ?? 0);
  if (k === 6)
    return BigInt(chain.history.logs.filter((l) => l.address === IDMD && `0x${l.topics[2]?.slice(26)}` === who).length);
  if (k > 2) return 0n;
  const event = parseAbiItem(spec.item);
  const sel = toEventSelector(event);
  const indexed = event.inputs.filter((x) => x.indexed);
  const at = (name) => indexed.findIndex((x) => x.name === name) + 1;
  const ai = at(spec.arg), fi = spec.fixedArg ? at(spec.fixedArg) : 0;
  const fixed = spec.fixedArg ? pad(toHex(BigInt(spec.fixedVal))).toLowerCase() : null;
  let total = 0n;
  for (const l of chain.history.logs) {
    const b = BigInt(l.blockNumber);
    if (l.address !== spec.target.toLowerCase() || l.topics[0] !== sel || b < BigInt(spec.fromBlock) || b > BigInt(spec.toBlock)) continue;
    if (!ai || `0x${l.topics[ai]?.slice(26)}` !== who) continue;
    if (fi && l.topics[fi]?.toLowerCase() !== fixed) continue;
    if (k === 1) total += 1n;
    else {
      const inputs = event.inputs.filter((x) => !x.indexed);
      const i = inputs.findIndex((x) => x.name === spec.sumArg);
      if (i >= 0) total += BigInt(`0x${l.data.slice(2 + i * 64, 2 + (i + 1) * 64)}`);
    }
  }
  return total;
}

export const blockHash = (n) => keccak256(stringToHex(`sworn-local block ${BigInt(n)}`));

export function syntheticBlock(n, genesisTime) {
  n = BigInt(n);
  return {
    number: toHex(n),
    hash: blockHash(n),
    parentHash: blockHash(n - 1n),
    timestamp: toHex(BigInt(genesisTime) - (GENESIS - n) * 12n),
    gasLimit: toHex(36000000),
    gasUsed: "0x0",
    baseFeePerGas: "0x3b9aca00",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    miner: "0x0000000000000000000000000000000000000000",
    nonce: "0x0000000000000000",
    transactions: [],
    uncles: [],
    logsBloom: "0x" + "00".repeat(256),
    mixHash: pad("0x0"),
    receiptsRoot: pad("0x0"),
    sha3Uncles: pad("0x0"),
    size: "0x1",
    stateRoot: pad("0x0"),
    transactionsRoot: pad("0x0"),
  };
}

const num = (tag, latest) =>
  tag === undefined || tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized"
    ? latest
    : tag === "earliest"
      ? 0n
      : BigInt(tag);

// The site's JSON-RPC requests, answered by anvil above the genesis and by the synthetic history below.
export async function answerRpc(chain, { method, params = [] }) {
  if (method === "eth_getLogs") {
    const f = params[0] || {};
    const latest = BigInt(await chain.rpc("eth_blockNumber"));
    const from = num(f.fromBlock ?? "latest", latest), to = num(f.toBlock ?? "latest", latest);
    const out = [];
    // Test switch: history before the genesis unavailable, like a public RPC without archive logs.
    if (from < GENESIS && chain.failHistory) throw Object.assign(Error("historical logs unavailable"), { rpc: { code: -32000, message: "historical logs unavailable" } });
    if (from < GENESIS) {
      const addrs = [f.address].flat().filter(Boolean).map((a) => a.toLowerCase());
      for (const l of chain.history.logs) {
        const b = BigInt(l.blockNumber);
        if (b < from || b > to || b >= GENESIS) continue;
        if (addrs.length && !addrs.includes(l.address)) continue;
        if (!(f.topics || []).every((t, i) => t == null || (Array.isArray(t) ? t.map((x) => x.toLowerCase()).includes(l.topics[i]?.toLowerCase()) : t.toLowerCase() === l.topics[i]?.toLowerCase()))) continue;
        out.push(l);
      }
    }
    if (to >= GENESIS) {
      const q = { ...f, fromBlock: toHex(from < GENESIS ? GENESIS : from), toBlock: toHex(to) };
      out.push(...(await chain.rpc("eth_getLogs", [q])));
    }
    return out;
  }
  if (method === "eth_getBlockByNumber") {
    const latest = BigInt(await chain.rpc("eth_blockNumber"));
    const n = num(params[0], latest);
    if (n < GENESIS) return syntheticBlock(n, chain.genesisTime);
    return chain.rpc(method, [toHex(n), params[1] ?? false]);
  }
  if (method === "eth_getBlockByHash") {
    const real = await chain.rpc(method, params).catch(() => null);
    if (real) return real;
    for (const l of chain.history.logs) if (l.blockHash === params[0]) return syntheticBlock(BigInt(l.blockNumber), chain.genesisTime);
    return null;
  }
  if (method === "eth_getTransactionCount" && params[1] && /^0x[0-9a-f]+$/i.test(params[1]) && BigInt(params[1]) < GENESIS) {
    if (chain.failHistory) throw Object.assign(Error("missing trie node"), { rpc: { code: -32000, message: "missing trie node" } });
    return toHex(chain.history.nonces?.[String(params[0]).toLowerCase()] ?? 0);
  }
  if (["eth_call", "eth_getBalance", "eth_getCode", "eth_getStorageAt"].includes(method)) {
    const tag = params[method === "eth_getStorageAt" ? 2 : 1];
    if (tag && /^0x[0-9a-f]+$/i.test(tag) && BigInt(tag) < GENESIS) params = [...params.slice(0, -1), "latest"];
  }
  return chain.rpc(method, params);
}

export function registryEvents(chain, receipt) {
  const out = [];
  for (const l of receipt.logs || []) {
    if (l.address.toLowerCase() !== A.registry) continue;
    try {
      out.push({ ...decodeEventLog({ abi: chain.abis.Registry, data: l.data, topics: l.topics }), log: l });
    } catch {}
  }
  return out;
}

export function intakeRequests(chain, receipt) {
  const out = [];
  for (const l of receipt.logs || []) {
    if (l.address.toLowerCase() !== A.intake) continue;
    try {
      const e = decodeEventLog({ abi: chain.mocks.MockIntake.abi, data: l.data, topics: l.topics });
      if (e.eventName === "Requested") out.push(e.args);
    } catch {}
  }
  return out;
}

export { parseAbi, toEventSelector };
