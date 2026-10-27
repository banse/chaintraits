import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import solc from "solc";
import { getAddress, keccak256, stringToHex, parseAbi } from "viem";
import { canonical } from "../src/pure.mjs";
export const skill = fs.readFileSync(
  new URL("../../agents/sworn/SKILL.md", import.meta.url),
  "utf8",
);
export const blocks = [...skill.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map(
  (m) => ({ language: m[1], code: m[2] }),
);
export function compileGate() {
  const code = blocks.find((b) => b.code.includes("contract SwornGate")).code;
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "SwornGate.sol": { content: code } },
        settings: {
          evmVersion: "cancun",
          outputSelection: {
            "*": { "*": ["abi", "evm.deployedBytecode.object"] },
          },
        },
      }),
    ),
  );
  assert.deepEqual(
    output.errors?.filter((e) => e.severity === "error") || [],
    [],
  );
  return output.contracts["SwornGate.sol"].SwornGate;
}
test("B skill frontmatter, deployment addresses, source commit, ABI hashes and all contract function/event names agree with exported artifacts", () => {
  const d = JSON.parse(
    fs.readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
  );
  const h = JSON.parse(
    fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
  );
  assert.match(skill, /^---\nname: sworn\ndescription: .+\n---\n/);
  assert.ok(!/website|this job|this assignment|frontend/i.test(skill));
  assert.ok(skill.includes(d.sourceCommit));
  assert.ok(skill.includes("chain 1"));
  assert.ok(skill.includes("launch #2404"));
  const allowed = new Set(
    [
      ...d.contracts.map((c) => c.address),
      ...h.manifest.contracts
        .find((c) => c.contract === "Registry")
        .constructorArgs.filter((a) => /^0x/.test(a)),
    ].map((a) => getAddress(a)),
  );
  for (const m of skill.matchAll(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g))
    assert.ok(allowed.has(getAddress(m[0])), m[0]);
  const abis = [
    "Registry",
    "Composer",
    "Renderer",
    "WhitelistCurator",
    "IntakeV2",
  ].flatMap((n) =>
    JSON.parse(
      fs.readFileSync(new URL(`../../dist/abi/${n}.json`, import.meta.url)),
    ),
  );
  for (const c of d.contracts) {
    const abi = JSON.parse(
      fs.readFileSync(
        new URL(`../../dist/abi/${c.name}.json`, import.meta.url),
      ),
    );
    assert.ok(skill.toLowerCase().includes(c.address.toLowerCase()));
    assert.ok(skill.includes(c.abiHash));
    assert.equal(keccak256(stringToHex(canonical(abi))).slice(2), c.abiHash);
  }
  const runtime = JSON.parse(
    fs.readFileSync(
      new URL("../public/data/renderer-preview.json", import.meta.url),
    ),
  );
  for (const c of d.contracts)
    assert.ok(
      skill.includes(runtime.contracts[c.name].runtimeHash),
      c.name + " runtime hash",
    );
  const named = [
    "hasTrait",
    "traitsOf",
    "verified",
    "verifiedSpecsOf",
    "claimantOf",
    "tokenOf",
    "nextSpecId",
    "specOf",
    "composer",
    "renderer",
    "curator",
    "imd",
    "intake",
    "attester",
    "burnExecutor",
    "ownerOf",
    "firstHourOf",
    "txCountOf",
    "contributedBy",
    "pointsOf",
    "totalContributors",
    "sharedFact",
    "sharedPending",
    "MINT_FEE",
    "SPEC_FEE",
    "ACTION",
    "priceOf",
    "mintCard",
    "registerSpec",
    "upgrade",
    "requestSharedFact",
    "applySharedFact",
    "pendingOf",
  ];
  for (const name of named) {
    assert.ok(skill.includes(name), name);
    assert.ok(
      abis.some((x) => x.type === "function" && x.name === name),
      name,
    );
  }
  const events = [
    "Verified",
    "SpecRegistered",
    "FirstDeposit",
    "SharedFactStored",
    "TraitRequested",
    "Missed",
    "NoVerdict",
  ];
  for (const name of events) {
    assert.ok(skill.includes(name));
    assert.ok(
      abis.some((x) => x.type === "event" && x.name === name),
      name,
    );
  }
  // TransferSingle/TransferBatch are prohibited input recipe names, never Registry events.
  for (const b of blocks.filter((b) => b.language === "text"))
    for (const sig of b.code.trim().split("\n")) {
      const parsed = parseAbi(["function " + sig])[0];
      assert.ok(
        abis.some(
          (x) =>
            x.name === parsed.name &&
            canonical(x.inputs.map((i) => i.type)) ===
              canonical(parsed.inputs.map((i) => i.type)) &&
            canonical(x.outputs.map((i) => i.type)) ===
              canonical(parsed.outputs.map((i) => i.type)),
        ),
        sig,
      );
    }
});
test("B all 25 skill ids match the pinned catalog source exactly", () => {
  const ids = [...skill.matchAll(/^\| (\d+) \|/gm)]
    .map((m) => Number(m[1]))
    .filter((i) => i > 100);
  const source = fs
    .readFileSync(new URL("./fixtures/pinned-Catalog.sol", import.meta.url), "utf8")
    .split("function ids()")[1]
    .split("function family")[0];
  const pinned = [
    ...source.matchAll(
      /\b(101|201|202|301|302|303|401|402|403|404|501|502|503|601|701|801|901|1001|1101|1102|1103|1104|1105|1201|1301)\b/g,
    ),
  ].map((m) => Number(m[1]));
  assert.equal(ids.length, 25);
  assert.deepEqual(ids, pinned);
  const lines = JSON.parse(
    fs.readFileSync(
      new URL("../public/data/curator-source.json", import.meta.url),
    ),
  )
    .lines.filter((l) => l.line >= 32 && l.line <= 53)
    .map((l) => l.text)
    .join("\n");
  assert.ok(skill.includes(lines));
});
test("B Solidity gate compiles and exported skills plus llms copies are complete", () => {
  compileGate();
  for (const file of [
    "../public/agents/sworn/SKILL.md",
    "../../dist/agents/sworn/SKILL.md",
    "../public/agents/sworn.md",
    "../../dist/agents/sworn.md",
  ])
    assert.equal(
      fs.readFileSync(new URL(file, import.meta.url), "utf8"),
      file.endsWith("sworn.md") ? skill.replaceAll("(../../", "(../") : skill,
    );
  const llms = fs.readFileSync(
    new URL("../../llms.txt", import.meta.url),
    "utf8",
  );
  assert.match(llms, /^# Sworn\n\n> /);
  assert.equal(
    llms,
    fs.readFileSync(new URL("../../dist/llms.txt", import.meta.url), "utf8"),
  );
});
