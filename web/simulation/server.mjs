// Local copies of the Sworn site. --shipped serves the export exactly as hosted (it reads mainnet
// and api.imd.fun like the hosted site); --mock serves the same export with a shim that sends every
// chain, wallet and swarm request to this server, which answers from a local chain with sample data.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseEther, encodeFunctionData, maxUint256 } from "viem";
import { startChain, answerRpc, A, ACTION } from "./_chain.mjs";
import { createOracle } from "./_oracle.mjs";
import { configure, freezeRequest } from "./_settings.mjs";
import { profileSettings } from "./_profiles.mjs";
import { rpcDelaySeconds, walletTiming } from "./_latency.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  root: { type: 'string' }, port: { type: 'string', default: '8812' },
  profile: { type: 'string', default: 'default' }, help: { type: 'boolean' },
} });
const mode = "mock";
if (values.help) { console.log("node simulation/server.mjs [--port 8812] [--root simulation/.runtime] [--profile default|delayed]\nLocal synthetic wallets and oracle on loopback Anvil. Build the matching --root first."); process.exit(0); }
const root = path.resolve(values.root ?? path.join(here, '.runtime'));
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Port must be an integer from 1024 to 65535');
const initialSettings = profileSettings(values.profile);
const siteDir = mode === "mock" ? path.join(root, "mock", "site") : path.join(root, "shipped");
const samples = JSON.parse(fs.readFileSync(path.join(here, "samples.json")));
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
if (!fs.existsSync(path.join(siteDir, "index.html")))
  throw Error(`No site at ${siteDir}. Run: node simulation/build.mjs`);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon", ".woff2": "font/woff2",
};
function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(siteDir, rel);
  if (!file.startsWith(siteDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  serveFile(res, file);
}
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (d) => {
      b += d;
      if (b.length > 2e6) reject(Error("body too large"));
    });
    req.on("end", () => resolve(b));
  });
const localHost = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "");

let chain, oracle, miner, lifetime;
const instance = { id: randomUUID(), profile: values.profile, runtimeRoot: root, port };
const state = { active: null, exactIntake: true, blocked: [], ready: false, error: null, walletRequests: 0, transactions: [] };

async function boot() {
  state.ready = false;
  state.error = null;
  state.transactions = [];
  lifetime = new AbortController();
  chain = await startChain({ root, samples, log });
  oracle = createOracle(chain, samples, log);
  state.active = chain.wallets[0].address;
  await seed();
  configure(oracle.settings, initialSettings);
  // Idle blocks continue, but never mine a transaction before its configured delay.
  miner = setInterval(() => { if (!chain.miningPending) chain.rpc("evm_mine").catch(() => {}); }, 12000);
  state.ready = true;
  log(`mock ready on http://127.0.0.1:${port}/ (sample wallet ${state.active})`);
}

async function seed() {
  const reg = chain.abis.Registry;
  const imd = chain.mocks.MockIMD.abi;
  const price = await chain.call(A.intake, chain.abis.IntakeV2, "priceOf", [ACTION, A.imd]);
  for (const w of chain.wallets) {
    const s = w.seed || {};
    if (!s.card && !(s.requests || []).length) continue;
    await chain.tx(w.address, A.imd, imd, "approve", [A.registry, maxUint256]);
    if (s.card) await chain.tx(w.address, A.registry, reg, "mintCard");
    for (const r of s.requests || []) {
      const rc = await chain.tx(w.address, A.registry, reg, "upgrade", [[r.id], price]);
      await oracle.fromReceipt(rc, {
        answer: String(r.answer),
        deliver: !!r.deliver,
        createdAt: r.deliver ? Date.now() - 3 * 3600 * 1000 : undefined,
      });
    }
    // The site shows the approval step to a wallet that has not approved this action yet.
    await chain.tx(w.address, A.imd, imd, "approve", [A.registry, 0n]);
  }
}

async function shutdown() {
  state.ready = false;
  lifetime?.abort();
  clearInterval(miner);
  oracle?.stop();
  chain?.stop();
}

async function walletRequest({ method, params = [] }) {
  if (method !== "eth_sendTransaction") throw Error(`mock wallet: ${method} is not sent to the server`);
  const requestChain = chain;
  const requestOracle = oracle;
  const requestLifetime = lifetime;
  state.walletRequests++;
  const t = { ...params[0] };
  if (!t.from || t.from.toLowerCase() !== state.active.toLowerCase())
    throw Object.assign(Error("The mock wallet signs only for the selected sample wallet."), { code: 4100 });
  for (const k of ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "chainId", "type"]) delete t[k];
  const config = freezeRequest(requestOracle.settings);
  const timing = walletTiming(t, config, A);
  const transaction = { kind: timing.isApproval ? 'approval' : 'transaction', requestedAt: Date.now(), config };
  state.transactions = [...state.transactions, transaction].slice(-50);
  try {
    await delay(timing.walletSeconds * 1000, undefined, { signal: requestLifetime.signal });
    if (chain !== requestChain || oracle !== requestOracle || !state.ready || t.from.toLowerCase() !== state.active.toLowerCase())
      throw Error('The local chain or selected wallet changed during confirmation. Review the request again.');
  } catch (error) {
    transaction.error = error.name === 'AbortError' ? 'Local simulation reset during wallet confirmation' : error.message;
    throw Error(transaction.error);
  }
  let submission;
  try {
    submission = await requestChain.sendDelayed(t.from, t.to, t.data, t.value, timing.miningSeconds);
  } catch (error) { transaction.error = error.message; throw error; }
  const { hash, receipt } = submission;
  transaction.hash = hash;
  transaction.submittedAt = Date.now();
  receipt.then(async rc => {
    // A reset can replace both services while this transaction waits for mining.
    if (chain !== requestChain || oracle !== requestOracle || !state.ready) return;
    transaction.confirmedAt = Date.now();
    transaction.status = rc.status;
    if (rc.status === "0x1") await requestOracle.fromReceipt(rc, { settings: config });
    log(`wallet ${t.from.slice(0, 8)}… confirmed ${hash}`);
  }).catch(e => {
    if (chain === requestChain && oracle === requestOracle && state.ready)
      log(`wallet receipt: ${e.message}`);
  });
  return hash;
}

function explorerPage(res, jobId) {
  const r = oracle?.byJob(jobId);
  res.writeHead(r ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Mock explorer · ${esc(jobId.slice(0, 8))}</title>
<style>body{background:#0a0a0a;color:#d7d7d7;font:14px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:16px;max-width:900px}
h1{font-size:16px;color:#6bff8e}pre{white-space:pre-wrap;word-break:break-word;background:#111;padding:12px}</style>
<h1>Local mock explorer · oracle job ${esc(jobId)}</h1>
<p>This page stands in for explorer.imd.fun/jobs/${esc(jobId)} in the local mock. The data below is simulated.</p>
${r ? `<p>Oracle request ${esc(r.id)} · ${esc(r.status)} · ${r.members.length} / ${r.panelSize} answers</p><pre>${esc(JSON.stringify(oracle.publicDetail(r), null, 2))}</pre>` : "<p>No simulated oracle request has this job id.</p>"}`);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const p = u.pathname;
    // Loopback service is still protected against cross-origin form/fetch control requests.
    if (!localHost(req)) return json(res, 403, { error: "local host only" });
    if (req.method !== "GET" && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
      return json(res, 403, { error: "same origin only" });
    res.setHeader("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    if (mode === "shipped" || !p.startsWith("/__mock__/")) {
      if (mode === "mock" && (p === "/" || p === "/index.html") && !state.ready && !state.error) {
        res.writeHead(503, { "content-type": "text/plain", "retry-after": "2" });
        return res.end("The local chain is starting; reload in a few seconds.");
      }
      return serveStatic(req, res, p);
    }
    if (!localHost(req)) return json(res, 403, { error: "local host only" });
    if (p === "/__mock__/shim.js") return serveFile(res, path.join(root, "mock/shim.js"));
    if (p === "/__mock__/state") {
      if (req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        if (!state.ready) return json(res, 409, { error: 'The local chain is starting or resetting. Wait until it is ready.' });
        if (b.reset) {
          await shutdown();
          try { await boot(); }
          catch (error) { state.error = error.message; await shutdown(); throw error; }
        }
        if (b.active && chain.wallets.some((w) => w.address.toLowerCase() === b.active.toLowerCase()))
          state.active = chain.wallets.find((w) => w.address.toLowerCase() === b.active.toLowerCase()).address;
        if (typeof b.exactIntake === "boolean") state.exactIntake = b.exactIntake;
        configure(oracle.settings, b);
        if (typeof b.failHistory === "boolean") chain.failHistory = b.failHistory;
        if (b.releaseDelivery) await oracle.release(b.releaseDelivery);
        if (b.recoverDelivery) await oracle.recover(b.recoverDelivery);
        if (b.advanceBlocks !== undefined) {
          if (!Number.isInteger(b.advanceBlocks) || b.advanceBlocks < 1 || b.advanceBlocks > 1000) throw Error("advanceBlocks must be 1..1000");
          if (chain.miningPending) throw Error("Wait until pending transaction is mined before advancing blocks");
          await chain.rpc("anvil_mine", [`0x${b.advanceBlocks.toString(16)}`]);
        }
        if (Number(b.advanceDays) > 0 && Number(b.advanceDays) <= 400) {
          if (chain.miningPending) throw Error('Wait until pending transaction is mined before advancing time');
          await chain.rpc("evm_increaseTime", [Math.round(Number(b.advanceDays) * 86400)]);
          await chain.rpc("evm_mine");
          log(`chain clock advanced ${b.advanceDays} days`);
        }
        if (b.blocked) state.blocked = [...state.blocked, String(b.blocked).slice(0, 300)].slice(-50);
      }
      return json(res, 200, {
        ready: state.ready,
        simulation: true,
        instance: { ...instance, rpcUrl: chain?.url },
        transactions: state.transactions,
        settings: oracle?.settings,
        ...oracle?.settings,
        records: [...(oracle?.records.values() || [])].map(r => ({
          oracleId: r.id, requestId: r._requestId, requestTx: r._txHash, requestBlock: r._blockNumber,
          wallet: r._claimant, factId: r._traitId, status: r.status, members: r.members.length,
          quorum: r.quorum, panelSize: r.panelSize, agreement: r.agreement,
          config: r._config, timeline: r._timeline, attempted: r._attempted, delivered: r._delivered,
          deliveryTx: r._deliveryTx, deliveryReceipt: r._deliveryReceipt,
          recoveryReceipt: r._recoveryReceipt, deliveryError: r._deliveryError,
        })),
        error: state.error,
        active: state.active,
        wallets: (chain?.wallets || []).map((w) => ({ label: w.label, address: w.address })),
        exactIntake: state.exactIntake,
        nextAnswer: oracle?.settings.nextAnswer,
        delivery: oracle?.settings.delivery,
        speed: oracle?.settings.speed,
        pickup: oracle?.settings.pickup,
        questionWallet: oracle?.settings.questionWallet,
        detailJobId: oracle?.settings.detailJobId,
        failHistory: !!chain?.failHistory,
        walletRequests: state.walletRequests,
        chainTime: state.ready ? Number(BigInt((await chain.rpc("eth_getBlockByNumber", ["latest", false])).timestamp)) : null,
        blocked: state.blocked,
      });
    }
    if (!state.ready) return json(res, 503, { error: "the local chain is starting" });
    if (p === "/__mock__/rpc" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const requestChain = chain;
      const requestLifetime = lifetime;
      const config = freezeRequest(oracle.settings);
      const one = async (m) => {
        try {
          if (/^(anvil_|evm_|eth_send|eth_sign|personal_|wallet_)/.test(m.method))
            throw Error("Read-only RPC: use the isolated mock wallet for local transactions");
          await delay(rpcDelaySeconds(m, config, A) * 1000, undefined, { signal: requestLifetime.signal });
          if (chain !== requestChain || !state.ready) throw Error('Local simulation reset during read');
          return { jsonrpc: "2.0", id: m.id, result: await answerRpc(requestChain, m) };
        } catch (e) {
          return { jsonrpc: "2.0", id: m.id, error: e.rpc || { code: -32000, message: e.message } };
        }
      };
      return json(res, 200, Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body));
    }
    if (p === "/__mock__/wallet" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      try {
        return json(res, 200, { result: await walletRequest(b) });
      } catch (e) {
        return json(res, 200, { error: { code: e.code || e.rpc?.code || -32000, message: e.rpc?.message || e.message, data: e.rpc?.data } });
      }
    }
    if (p.startsWith("/__mock__/api/")) {
      const out = oracle.api(p.slice("/__mock__/api".length), u.search);
      const refuse = /^\/intake\//.test(p.slice("/__mock__/api".length)) && !state.exactIntake;
      // A refused /intake read answers 200 here, so the browser logs nothing; the shim then fails the
      // fetch the way a missing CORS header does live (where the browser also logs a CORS error).
      return json(res, refuse ? 200 : out.status, refuse ? {} : out.body, refuse ? { "x-mock-cors": "refuse" } : {});
    }
    const m = p.match(/^\/__mock__\/explorer\/jobs\/([A-Za-z0-9-]+)$/);
    if (m) return explorerPage(res, m[1]);
    return json(res, 404, { error: "unknown mock route" });
  } catch (e) {
    log(`error: ${e.stack || e.message}`);
    if (!res.headersSent) json(res, 500, { error: e.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  log(`mock copy (${values.profile}) serving ${siteDir} on http://127.0.0.1:${port}/`);
  boot().catch((e) => {
    state.error = e.message;
    log(`boot failed: ${e.stack || e.message}`);
    shutdown();
  });
});
server.on('error', async error => { await shutdown(); console.error(error.message); process.exitCode = 1; });
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    await shutdown();
    process.exit(0);
  });
