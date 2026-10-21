import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { execFileSync } from "node:child_process";
import { canonical } from "../src/pure.mjs";
import { keccak256, stringToHex } from "viem";
const root = path.resolve(import.meta.dirname, "../..");
const handoff = JSON.parse(
  fs.readFileSync(path.join(root, "web/deployment-handoff.json")),
);
const sources = {};
for (const file of fs
  .readdirSync(path.join(root, "src"))
  .filter((f) => f.endsWith(".sol")))
  sources[`src/${file}`] = {
    content: execFileSync(
      "git",
      ["show", `${handoff.sourceCommit}:src/${file}`],
      { cwd: root, encoding: "utf8" },
    ),
  };
const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "cancun",
        metadata: { bytecodeHash: "none", appendCBOR: false },
        outputSelection: {
          "*": { "*": ["abi", "storageLayout", "evm.deployedBytecode.object"] },
        },
      },
    }),
    {
      import: (p) => {
        const file = p.replace(
          "@openzeppelin/contracts/",
          "lib/openzeppelin-contracts/contracts/",
        );
        try {
          return { contents: fs.readFileSync(path.join(root, file), "utf8") };
        } catch {
          return { error: `Cannot read ${file}` };
        }
      },
    },
  ),
);
const errors = output.errors?.filter((e) => e.severity === "error");
if (errors?.length) throw Error(JSON.stringify(errors));
const contracts = {};
for (const c of handoff.contracts) {
  const o = output.contracts[`src/${c.name}.sol`][c.name];
  const pinned = JSON.parse(
    fs.readFileSync(path.join(root, `docs/abi/${c.name}.json`)),
  );
  if (
    JSON.stringify(o.abi.map(canonical).sort()) !==
    JSON.stringify(pinned.map(canonical).sort())
  )
    throw Error(`Compiler ABI entries drift: ${c.name}`);
  contracts[c.name] = {
    runtimeHash: keccak256(`0x${o.evm.deployedBytecode.object}`),
  };
}
const layout = output.contracts["src/Registry.sol"].Registry.storageLayout;
const slots = Object.fromEntries(
  ["tokenOf", "claimantOf", "frozenDirect"].map((label) => {
    const entry = layout.storage.find((s) => s.label === label);
    if (!entry) throw Error(`Missing ${label}`);
    return [label, entry.slot];
  }),
);
const previewPath = path.join(root, "web/public/data/renderer-preview.json");
const previewData =
  JSON.stringify(
    {
      sourceCommit: handoff.sourceCommit,
      compiler: solc.version(),
      slots,
      contracts,
    },
    null,
    2,
  ) + "\n";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(previewPath, "utf8") !== previewData)
    throw Error("Preview layout or runtime hash drift.");
} else fs.writeFileSync(previewPath, previewData);
fs.mkdirSync(path.join(root, "test/scratch/compile"), { recursive: true });
fs.writeFileSync(
  path.join(root, "test/scratch/compile/output.json"),
  JSON.stringify(output),
);
console.log(
  "Compiled pinned contracts; ABI hashes match. Preview slots derived:",
  slots,
);
