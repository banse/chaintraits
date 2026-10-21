// Opt-in mainnet reads. No signer, no eth_sendTransaction, no account impersonation.
import fs from "node:fs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createPublicClient,
  http,
  parseAbi,
  encodeFunctionData,
  decodeFunctionResult,
} from "viem";
import { mainnet } from "viem/chains";
import { server } from "./harness.mjs";
import { blocks, compileGate } from "./skill.test.mjs";
const supplied = process.env.SWORN_TEST_RPC;
if (!supplied) throw Error("Set SWORN_TEST_RPC to run opt-in mainnet examples");
const preview = await server({ rpcUrl: supplied });
const output = new URL("../../test/scratch/skill-live/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const results = {
  source: "https://ethereum-rpc.publicnode.com",
  examples: [],
  limitations: [],
};
try {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(preview.rpcUrl),
  });
  const wallet = JSON.parse(
    fs.readFileSync(
      new URL("../../docs/frontend/live-deployment.json", import.meta.url),
    ),
  ).publicContributors[0];
  const blockNumber = (await client.getBlockNumber()) - 64n;
  results.block = String(blockNumber);
  results.blockHash = (await client.getBlock({ blockNumber })).hash;
  const cast = process.env.SWORN_CAST || "cast";
  const shell = blocks
    .find((b) => b.language === "sh")
    .code.replace(
      "RPC=https://ethereum-rpc.publicnode.com",
      `RPC=${preview.rpcUrl}`,
    );
  try {
    const env = {
      ...process.env,
      WALLET: wallet,
      PATH: cast.includes("/")
        ? cast.slice(0, cast.lastIndexOf("/")) + ":" + process.env.PATH
        : process.env.PATH,
    };
    const { stdout } = await promisify(execFile)("bash", ["-e", "-c", shell], {
      env,
      timeout: 60000,
    });
    results.examples.push({
      name: "cast call (all five calls)",
      output: stdout.trim(),
    });
  } catch (e) {
    throw Error("cast example failed: " + e.message);
  }
  const script = blocks
    .find((b) => b.code.includes("const present ="))
    .code.replace(/^import .+;\n/gm, "")
    .replace("http('https://ethereum-rpc.publicnode.com')", "http(rpc)");
  const batch = blocks.find((b) => b.code.includes("const batch =")).code;
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)(
    "createPublicClient",
    "http",
    "parseAbi",
    "mainnet",
    "rpc",
    "process",
    "console",
    script +
      "\n" +
      batch +
      "\nreturn {present,traits,proof,community,token,claimant,batch};",
  );
  const read = await fn(
    createPublicClient,
    http,
    parseAbi,
    mainnet,
    preview.rpcUrl,
    { env: { WALLET: wallet } },
    { log() {} },
  );
  assert.equal(read.present, true);
  assert.equal(read.batch.length, 3);
  results.examples.push({ name: "viem reads", result: read });
  results.examples.push({
    name: "Multicall3 deployless batch",
    result: read.batch,
  });
  const gate = compileGate();
  const d = JSON.parse(
    fs.readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
  );
  const address = d.contracts.find((c) => c.name === "Renderer").address;
  const data = encodeFunctionData({
    abi: gate.abi,
    functionName: "eligible",
    args: [wallet],
  });
  const response = await client.call({
    to: address,
    data,
    blockNumber,
    stateOverride: [{ address, code: "0x" + gate.evm.deployedBytecode.object }],
  });
  const eligible = decodeFunctionResult({
    abi: gate.abi,
    functionName: "eligible",
    data: response.data,
  });
  assert.equal(eligible, true);
  results.examples.push({
    name: "Solidity gate via eth_call code override (no deployment)",
    result: eligible,
  });
  const registry = d.contracts.find((c) => c.name === "Registry").address;
  const registryAbi = JSON.parse(
    fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
  );
  const ids = [
    101, 201, 202, 301, 302, 303, 401, 402, 403, 404, 501, 502, 503, 601, 701,
    801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201, 1301,
  ];
  const catalog = await Promise.all(
    ids.map(async (id) => ({
      id,
      name: await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "traitName",
        args: [id],
        blockNumber,
      }),
    })),
  );
  results.catalog = catalog;
  if (read.token === 0n)
    results.limitations.push(
      "The real claimant has no card; the claimantOf branch correctly skipped a nonexistent token. Card #1 behavior is exercised by the fake-wallet browser test.",
    );
  console.log("All four read-only skill examples passed on Ethereum mainnet.");
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(
      results,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
  await preview.close();
}
