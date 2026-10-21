import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { createPublicClient, defineChain, http } from "viem";
import { server } from "../tests/harness.mjs";
const rpcUrl = process.argv[2];
if (!rpcUrl) throw Error("Pass an RPC URL for independent read verification.");
const exec = promisify(execFile);
const proxy = await server({ rpcUrl });
let vite;
try {
  globalThis.document = { baseURI: proxy.url };
  vite = await createViteServer({
    root: new URL("../", import.meta.url).pathname,
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
  const { loadRuntime, health, lookup, contract } =
    await vite.ssrLoadModule("/src/chain.ts");
  const r = await loadRuntime();
  const client = createPublicClient({
    chain: r.chain,
    transport: http(proxy.rpcUrl, { timeout: 60000 }),
  });
  const h = await health(client, r);
  const evidence = JSON.parse(
    fs.readFileSync(
      new URL("../../docs/frontend/live-deployment.json", import.meta.url),
    ),
  );
  const wallets = [
    ...evidence.publicContributors,
    "0x000000000000000000000000000000000000c1a1",
  ];
  const ids = [
    101, 201, 202, 301, 302, 303, 401, 402, 403, 404, 501, 502, 503, 601, 701,
    801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201, 1301,
  ];
  const rows = [];
  for (const address of wallets) {
    const facts = await lookup(client, r, h, address, ids);
    const answers = [];
    for (const id of ids) {
      const { stdout } = await exec(
        "cast",
        [
          "call",
          contract(r, "Registry").address,
          "hasTrait(address,uint16)(bool)",
          address,
          String(id),
          "--rpc-url",
          proxy.rpcUrl,
        ],
        { maxBuffer: 10000 },
      );
      answers.push(stdout.trim() === "true");
    }
    if (JSON.stringify(answers) !== JSON.stringify(facts.answers))
      throw Error(`Independent cast result mismatch: ${address}`);
    const { stdout } = await exec("cast", [
      "call",
      contract(r, "Registry").address,
      "tokenOf(address)(uint256)",
      address,
      "--rpc-url",
      proxy.rpcUrl,
    ]);
    if (BigInt(stdout.trim()) !== facts.token)
      throw Error("Independent tokenOf mismatch");
    rows.push({
      address,
      tokenOf: facts.token.toString(),
      joined: facts.joined,
      firstHour: facts.hour.toString(),
      answers: Object.fromEntries(ids.map((id, i) => [id, answers[i]])),
      metadataSha256: createHash("sha256").update(facts.raw).digest("hex"),
      lookup: facts.token === 0n ? "live Renderer preview" : "own tokenURI",
    });
    console.log("25 independent hasTrait calls and tokenOf match:", address);
  }
  const result = {
    at: new Date().toISOString(),
    rpcSource: r.deployment.network.rpcUrls[0],
    chainId: r.deployment.chainId,
    sourceCommit: r.deployment.sourceCommit,
    blockNumber: h.block.toString(),
    wallets: rows,
  };
  fs.writeFileSync(
    new URL("../../docs/frontend/independent-reads.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
  );
} finally {
  if (vite) await vite.close();
  await proxy.close();
}
