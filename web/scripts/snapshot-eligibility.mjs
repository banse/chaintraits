// Read-only, keyless regeneration. Run from the repository root; see web/README.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  encodeFunctionData,
  decodeFunctionResult,
  parseAbiItem,
  encodeEventTopics,
  decodeEventLog,
  toHex,
} from "viem";

export const FACT_IDS = [701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105];
export const FROM = 25769870,
  TO = 25789604;
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const stringify = (v, space) =>
  JSON.stringify(
    v,
    (_, x) => (typeof x === "bigint" ? x.toString() : x),
    space,
  );
const same = (a, b) => stringify(a) === stringify(b);
const root = fileURLToPath(new URL("../../", import.meta.url));
const defaults = [
  "https://1.rpc.thirdweb.com",
  "https://gateway.tenderly.co/public/mainnet",
  "https://rpc.mevblocker.io/fast",
];
const exec = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let requestId = 0;

export function canonicalLogs(logs, from, to, target, topics) {
  if (!Array.isArray(logs)) throw Error("Missing logs");
  const seen = new Set();
  const hex = (v, bytes) =>
    typeof v === "string" &&
    new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, "i").test(v);
  return logs
    .map((l) => {
      const block = Number(BigInt(l.blockNumber)),
        index = Number(BigInt(l.logIndex));
      if (
        l.removed ||
        !/^0x[0-9a-f]+$/i.test(l.blockNumber) ||
        !/^0x[0-9a-f]+$/i.test(l.logIndex) ||
        l.address?.toLowerCase() !== target.toLowerCase() ||
        !hex(l.blockHash, 32) ||
        !hex(l.transactionHash, 32) ||
        !Number.isSafeInteger(block) ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        block < from ||
        block > to ||
        !Array.isArray(l.topics) ||
        !l.topics.every((t) => hex(t, 32)) ||
        !topics.includes(l.topics[0]?.toLowerCase()) ||
        !/^0x(?:[0-9a-f]{64})*$/i.test(l.data)
      )
        throw Error("Invalid or out-of-range log");
      const key = `${l.blockHash.toLowerCase()}:${index}`;
      if (seen.has(key)) throw Error("Duplicate log");
      seen.add(key);
      return {
        address: l.address.toLowerCase(),
        blockNumber: toHex(block),
        blockHash: l.blockHash.toLowerCase(),
        transactionHash: l.transactionHash.toLowerCase(),
        logIndex: toHex(index),
        topics: l.topics.map((t) => t.toLowerCase()),
        data: l.data.toLowerCase(),
      };
    })
    .sort(
      (a, b) =>
        Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) ||
        Number(BigInt(a.logIndex) - BigInt(b.logIndex)),
    );
}

// Counts retain every matching event (including repeat deposits/saves), not a boolean.
export function aggregate(specs, logs) {
  const events = Object.fromEntries(
    Object.values(specs).map((s) => {
      const event = parseAbiItem(s.item);
      return [
        encodeEventTopics({ abi: [event], eventName: event.name })[0],
        event,
      ];
    }),
  );
  const wallets = new Map(),
    totals = {},
    indices = new Set(),
    samples = {};
  for (const event of Object.values(events))
    totals[event.name] = { logs: 0, wallets: new Set() };
  for (const l of logs) {
    const event = events[l.topics[0]];
    const args = decodeEventLog({
      abi: [event],
      topics: l.topics,
      data: l.data,
      strict: true,
    }).args;
    const wallet = (args.contributor || args.savior).toLowerCase();
    totals[event.name].logs++;
    totals[event.name].wallets.add(wallet);
    if (event.name === "FirstDeposit") {
      const index = Number(args.index);
      if (indices.has(index) || index < 1 || index > 19522)
        throw Error("Nonunique/out-of-range FirstDeposit index");
      indices.add(index);
      if ([1, 1000, 10000, 19522].includes(index))
        samples[`index${index}`] = wallet;
    }
    if (event.name === "Deposited" && args.hour === 65n)
      samples.hour65 = wallet;
    FACT_IDS.forEach((id, column) => {
      const s = specs[id],
        block = BigInt(l.blockNumber);
      if (
        parseAbiItem(s.item).name !== event.name ||
        block < BigInt(s.fromBlock) ||
        block > BigInt(s.toBlock)
      )
        return;
      if (s.fixedArg && BigInt(args[s.fixedArg]) !== BigInt(s.fixedVal)) return;
      if (!wallets.has(wallet))
        wallets.set(
          wallet,
          FACT_IDS.map(() => 0),
        );
      wallets.get(wallet)[column]++;
    });
  }
  const eventTotals = Object.fromEntries(
    Object.entries(totals).map(([name, t]) => [
      name,
      { logs: t.logs, wallets: t.wallets.size },
    ]),
  );
  if (
    !same(eventTotals.Deposited, { logs: 28353, wallets: 19522 }) ||
    !same(eventTotals.FirstDeposit, { logs: 19522, wallets: 19522 }) ||
    indices.size !== 19522 ||
    !same(eventTotals.HourSaved, { logs: 41, wallets: 33 })
  )
    throw Error(`Incomplete chain read: ${stringify(eventTotals)}`);
  const facts = Object.fromEntries(
    FACT_IDS.map((id, col) => [
      id,
      {
        spec: specs[id],
        matchingLogs: [...wallets.values()].reduce((n, row) => n + row[col], 0),
        matchingWallets: [...wallets.values()].filter((row) => row[col] > 0)
          .length,
      },
    ]),
  );
  if (facts[1105].matchingLogs !== 1000 || facts[901].matchingLogs !== 1)
    throw Error("Unexpected window/filter totals");
  for (const id of [1101, 1102, 1103, 1104])
    if (facts[id].matchingLogs !== 1) throw Error("Missing ordinal");
  const shards = Object.fromEntries(
    [..."0123456789abcdef"].map((prefix) => [prefix, {}]),
  );
  for (const [wallet, counts] of [...wallets].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    shards[wallet[2]][wallet] = counts;
  return { shards, eventTotals, facts, samples };
}

async function main() {
  const args = process.argv.slice(2),
    option = (key, fallback) => {
      const i = args.indexOf(key);
      return i < 0 ? fallback : args[i + 1];
    };
  const urls = [
    ...new Set(
      args.flatMap((arg, i) => (arg === "--rpc" ? [args[i + 1]] : [])),
    ),
  ];
  const out = path.resolve(
    root,
    option("--out", "web/public/data/eligibility"),
  );
  const pins = path.resolve(
    root,
    option("--pins", "web/src/eligibility-snapshot-pin.mjs"),
  );
  const raw = option("--raw", null),
    check = args.includes("--check");
  const handoff = JSON.parse(
    fs.readFileSync(path.join(root, "web/deployment-handoff.json")),
  );
  const registry = handoff.contracts.find((c) => c.name === "Registry").address;
  const curator = handoff.manifest.contracts
    .find((c) => c.contract === "Registry")
    .constructorArgs[0].toLowerCase();
  const abi = JSON.parse(
    fs.readFileSync(path.join(root, "web/public/abi/Registry.json")),
  );
  async function rpc(url, method, params = []) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { stdout } = await exec(
          "curl",
          [
            "--silent",
            "--show-error",
            "--max-time",
            "45",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
            url,
          ],
          { maxBuffer: 32 * 1024 * 1024 },
        );
        const body = JSON.parse(stdout);
        if (body.error) throw Error(stringify(body.error));
        if (!("result" in body)) throw Error("Missing RPC result");
        return body.result;
      } catch (e) {
        if (!/429|503|rate|too many/i.test(e.message) || attempt === 2) throw e;
        await pause(1000 * 3 ** attempt);
      }
    }
  }
  async function specsAt(url) {
    const specs = {};
    for (const id of FACT_IDS) {
      const data = await rpc(url, "eth_call", [
        {
          to: registry,
          data: encodeFunctionData({ abi, functionName: "specOf", args: [id] }),
        },
        "latest",
      ]);
      const s = decodeFunctionResult({ abi, functionName: "specOf", data });
      if (
        s.kind !== 1 ||
        s.target.toLowerCase() !== curator ||
        s.threshold < 1n ||
        s.fromBlock < BigInt(FROM) ||
        s.toBlock > BigInt(TO) ||
        s.fromBlock > s.toBlock
      )
        throw Error("Unexpected deployed catalog spec");
      specs[id] = JSON.parse(stringify(s));
      specs[id].target = specs[id].target.toLowerCase();
      await pause(200);
    }
    return specs;
  }
  const endpoints = [];
  for (const url of urls.length ? urls : defaults) {
    try {
      if ((await rpc(url, "eth_chainId")) !== "0x1") throw Error("Wrong chain");
      const close = await rpc(url, "eth_getBlockByNumber", [toHex(TO), false]);
      if (!close?.hash || Number(BigInt(close.number)) !== TO)
        throw Error("Missing closing block");
      const specs = await specsAt(url);
      if (
        endpoints.length &&
        (!same(specs, endpoints[0].specs) ||
          close.hash !== endpoints[0].close.hash)
      )
        throw Error("Endpoints disagree on catalog or closing block");
      endpoints.push({ url, close, specs });
      console.log(`Verified chain, closing block and nine specs: ${url}`);
    } catch (e) {
      if (/Endpoints disagree/.test(e.message)) throw e;
      console.log(`Endpoint unavailable: ${url}: ${e.message.slice(0, 240)}`);
    }
    if (endpoints.length === 2) break;
  }
  if (!endpoints.length) throw Error("No public RPC can read the snapshot");
  const [primary, secondary = primary] = endpoints;
  const topics = [
    ...new Set(
      Object.values(primary.specs).map((s) => {
        const e = parseAbiItem(s.item);
        return encodeEventTopics({ abi: [e], eventName: e.name })[0];
      }),
    ),
  ];
  const logs = [],
    ranges = [];
  async function readRange(from, to) {
    const filter = {
      address: curator,
      topics: [topics],
      fromBlock: toHex(from),
      toBlock: toHex(to),
    };
    let a, b;
    try {
      a = await rpc(primary.url, "eth_getLogs", [filter]);
      await pause(650);
      b = await rpc(secondary.url, "eth_getLogs", [filter]);
      if (
        !Array.isArray(a) ||
        !Array.isArray(b) ||
        a.length >= 5000 ||
        b.length >= 5000
      )
        throw Error("Possibly capped logs");
    } catch (e) {
      if (
        from === to ||
        !/limit|range|block|result|capped|size|exceed|1000/i.test(e.message)
      )
        throw e;
      const mid = Math.floor((from + to) / 2);
      await readRange(from, mid);
      await readRange(mid + 1, to);
      return;
    }
    a = canonicalLogs(a, from, to, curator, topics);
    b = canonicalLogs(b, from, to, curator, topics);
    if (!same(a, b))
      throw Error(`Disagreeing logs ${from}-${to}; no snapshot written`);
    ranges.push({
      fromBlock: from,
      toBlock: to,
      logs: a.length,
      sha256: sha256(stringify(a)),
    });
    logs.push(...a);
    console.log(`Compared ${from}-${to}: ${a.length} logs`);
    await pause(650);
  }
  for (let from = FROM; from <= TO; from += 1000)
    await readRange(from, Math.min(TO, from + 999));
  const after = await rpc(secondary.url, "eth_getBlockByNumber", [
    toHex(TO),
    false,
  ]);
  if (after.hash !== primary.close.hash) throw Error("Closing block changed");
  const { shards, eventTotals, facts, samples } = aggregate(
    primary.specs,
    logs,
  );
  const files = Object.fromEntries(
    Object.entries(shards).map(([p, rows]) => [
      `wallets-${p}.json`,
      stringify(rows) + "\n",
    ]),
  );
  const manifest = {
    schema: 1,
    chainId: 1,
    registry,
    curator,
    fromBlock: FROM,
    toBlock: TO,
    closingBlockHash: primary.close.hash,
    factIds: FACT_IDS,
    firstDepositIndices: { from: 1, to: 19522, unique: 19522 },
    events: eventTotals,
    facts,
    samples,
    generatorCommand: `node web/scripts/snapshot-eligibility.mjs --rpc ${primary.url} --rpc ${secondary.url}`,
    comparison: {
      method:
        primary === secondary
          ? "two separate reads of every range on one endpoint"
          : "every range compared on two independent endpoints",
      endpoints: endpoints.map((e) => e.url),
      canonicalFields: [
        "address",
        "blockNumber",
        "blockHash",
        "transactionHash",
        "logIndex",
        "topics",
        "data",
      ],
      logsSha256: sha256(stringify(logs)),
      ranges,
    },
    files: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        name,
        { sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) },
      ]),
    ),
  };
  files["manifest.json"] = stringify(manifest, 2) + "\n";
  const pin = `// Generated by web/scripts/snapshot-eligibility.mjs; pins the shipped manifest and every shard.\n// prettier-ignore\nexport default ${stringify({ manifestSha256: sha256(files["manifest.json"]), factIds: FACT_IDS, facts, files: manifest.files }, 2)};\n`;
  const bytes = Object.values(files).reduce(
    (n, text) => n + Buffer.byteLength(text),
    0,
  );
  if (bytes >= 1500000) throw Error(`Snapshot exceeds budget: ${bytes}`);
  if (check) {
    for (const [name, bytes] of Object.entries(files)) {
      // Provenance endpoints can differ; all deterministic data files must match byte for byte.
      if (
        name !== "manifest.json" &&
        fs.readFileSync(path.join(out, name), "utf8") !== bytes
      )
        throw Error(`Snapshot drift: ${name}`);
    }
    const existing = JSON.parse(
      fs.readFileSync(path.join(out, "manifest.json")),
    );
    for (const field of [
      "events",
      "facts",
      "samples",
      "closingBlockHash",
      "files",
    ])
      if (!same(existing[field], manifest[field]))
        throw Error(`Manifest drift: ${field}`);
    console.log(
      `Fresh chain read reproduces all 16 shard hashes (${bytes} bytes including manifest).`,
    );
  } else {
    fs.mkdirSync(out, { recursive: true });
    for (const [name, bytes] of Object.entries(files))
      fs.writeFileSync(path.join(out, name), bytes);
    fs.writeFileSync(pins, pin);
    console.log(
      `Wrote verified snapshot: ${bytes} bytes, ${logs.length} logs.`,
    );
  }
  if (raw) {
    fs.mkdirSync(path.dirname(path.resolve(root, raw)), { recursive: true });
    fs.writeFileSync(path.resolve(root, raw), stringify(logs));
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
