// Opt-in read-only mainnet observation. No wallet is installed or called.
// Serve this export at the named site's browser origin using static-file routes;
// RPC requests remain native browser fetches, so their real CORS rules apply.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { build } from "vite";
import { encodeFunctionData } from "viem";
const out = new URL("../../test/scratch/mainnet-browser/", import.meta.url);
fs.mkdirSync(out, { recursive: true });
const root = new URL("../../dist/", import.meta.url);
const manifest = JSON.parse(
  fs.readFileSync(new URL("imd-deployment.json", root)),
);
const Registry = JSON.parse(
  fs.readFileSync(new URL("abi/Registry.json", root)),
);
const registry = manifest.contracts.find((c) => c.name === "Registry").address;
const wallet = JSON.parse(
  fs.readFileSync(
    new URL("../../docs/frontend/live-deployment.json", import.meta.url),
  ),
).publicContributors[0];
const origin = "https://swornbyswarm.site.identitymd.eth.limo";
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const entry = new URL("probe-entry.mjs", out);
fs.writeFileSync(
  entry,
  `import { resilientRpc, READ_RPCS } from "../../../web/src/rpc.mjs";
import { checkEligibility } from "../../../web/src/eligibility.mjs";
import { decodeFunctionResult } from "../../../web/node_modules/viem/_esm/index.js";
window.__probe = { resilientRpc, READ_RPCS, checkEligibility, decodeFunctionResult };`,
);
const bundled = await build({
  configFile: false,
  logLevel: "error",
  build: {
    write: false,
    emptyOutDir: false,
    minify: false,
    lib: { entry: entry.pathname, formats: ["iife"], name: "Probe" },
    outDir: out.pathname,
  },
});
const code = (Array.isArray(bundled) ? bundled[0] : bundled).output.find(
  (o) => o.type === "chunk",
).code;
const evidence = {
  at: new Date().toISOString(),
  origin,
  serving:
    "Current local dist export supplied through same-origin static-file routing; external RPC fetches unmodified except the explicitly blocked endpoint or 429 scenario.",
  browser: "",
  scenarios: [],
};
const browser = await chromium.launch();
try {
  evidence.browser = browser.version();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route(origin + "/**", async (route) => {
    const name =
      decodeURIComponent(new URL(route.request().url()).pathname.slice(1)) ||
      "index.html";
    const file = new URL(name, root);
    if (!file.pathname.startsWith(root.pathname)) return route.abort();
    try {
      await route.fulfill({
        status: 200,
        contentType:
          mime[path.extname(file.pathname)] || "application/octet-stream",
        body: fs.readFileSync(file),
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
  // Keep app health reads separate from the measured sequence; the probe itself
  // uses the exact production pool and eligibility checker bundled above.
  await page.route("https://api.imd.fun/**", (route) => route.abort());
  await page.goto(origin + "/#/about");
  await page.addScriptTag({ content: code });
  const args = {
    registry,
    wallet,
    Registry,
    supply: encodeFunctionData({ abi: Registry, functionName: "totalSupply" }),
    spec: encodeFunctionData({
      abi: Registry,
      functionName: "specOf",
      args: [601],
    }),
  };
  const urls = [
    null,
    "https://ethereum-rpc.publicnode.com",
    "https://gateway.tenderly.co/public/mainnet",
    "https://rpc.mevblocker.io/fast",
    "https://1.rpc.thirdweb.com",
    "tenderly-429",
  ];
  for (const blocked of urls) {
    const scenario = await page.evaluate(
      async ({ args, blocked }) => {
        const {
          resilientRpc,
          READ_RPCS,
          checkEligibility,
          decodeFunctionResult,
        } = window.__probe;
        let kind = "",
          head = null;
        const calls = [],
          answered = [],
          reads = [];
        const native = window.fetch.bind(window);
        const pool = resilientRpc({
          timeout: 4000,
          onRead: (read) => answered.push({ kind, ...read }),
          fetcher: async (url, init) => {
            const payload = JSON.parse(init.body),
              start = performance.now();
            const call = {
              kind,
              url,
              method: payload.method,
              startedMs: start,
            };
            calls.push(call);
            try {
              if (url === blocked)
                throw TypeError("Endpoint blocked for this scenario");
              if (blocked === "tenderly-429" && url === READ_RPCS[1])
                return new Response("rate limited", { status: 429 });
              const result = await native(url, init);
              call.status = result.status;
              return result;
            } catch (error) {
              call.error = error.message;
              throw error;
            } finally {
              call.durationMs = Math.round(performance.now() - start);
            }
          },
        });
        const attempt = async (name, run) => {
          kind = name;
          const start = performance.now(),
            before = answered.length;
          try {
            const result = await run();
            reads.push({
              kind,
              result: Array.isArray(result)
                ? `${result.length} logs`
                : typeof result === "object"
                  ? result.state || "answered"
                  : String(result).slice(0, 80),
              durationMs: Math.round(performance.now() - start),
              answeredBy: [
                ...new Set(answered.slice(before).map((r) => r.url)),
              ],
            });
            return result;
          } catch (error) {
            reads.push({
              kind,
              error: error.message,
              durationMs: Math.round(performance.now() - start),
              answeredBy: [
                ...new Set(answered.slice(before).map((r) => r.url)),
              ],
            });
          }
        };
        const request = (method, params = []) =>
          pool.request({ method, params });
        if (blocked !== "tenderly-429") {
          await attempt("eth_chainId", () => request("eth_chainId"));
          await attempt("eth_getCode", () =>
            request("eth_getCode", [args.registry, "latest"]),
          );
          await attempt("eth_call", () =>
            request("eth_call", [
              { to: args.registry, data: args.supply },
              "latest",
            ]),
          );
          head = await attempt("eth_blockNumber", () =>
            request("eth_blockNumber"),
          );
          await attempt("block reads", () =>
            request("eth_getBlockByNumber", [head || "latest", false]),
          );
          if (head) {
            for (const [name, size] of [
              ["recent logs", 600n],
              ["24-hour logs", 7200n],
            ])
              await attempt(name, () =>
                request("eth_getLogs", [
                  {
                    address: args.registry,
                    fromBlock: "0x" + (BigInt(head) - size + 1n).toString(16),
                    toBlock: head,
                  },
                ]),
              );
          }
          await attempt("old-block nonce", () =>
            request("eth_getTransactionCount", [args.wallet, "0x189378e"]),
          );
        }
        await attempt("601 seat read", () =>
          checkEligibility(
            { pool, request: pool.request },
            async (id, signal) => {
              const data = await pool.scoped(signal).request({
                method: "eth_call",
                params: [{ to: args.registry, data: args.spec }, "latest"],
              });
              return decodeFunctionResult({
                abi: args.Registry,
                functionName: "specOf",
                data,
              });
            },
            args.wallet,
            601,
          ),
        );
        const done = calls.length;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          blocked,
          reads,
          answered,
          calls,
          requestsAfterReturn: calls.length - done,
        };
      },
      { args, blocked },
    );
    evidence.scenarios.push(scenario);
    fs.writeFileSync(
      new URL("results.json", out),
      JSON.stringify(evidence, null, 2),
    );
    console.log(
      JSON.stringify({
        blocked,
        reads: scenario.reads,
        requestsAfterReturn: scenario.requestsAfterReturn,
      }),
    );
  }
  await context.close();
} finally {
  await browser.close();
  fs.writeFileSync(
    new URL("results.json", out),
    JSON.stringify(evidence, null, 2),
  );
}
