import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { keccak256, stringToHex } from "viem";
import { canonical } from "../src/pure.mjs";
const handoff = JSON.parse(
  fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
);
for (const c of handoff.contracts) {
  const local = fs.readFileSync(
    new URL(`../public/abi/${c.name}.json`, import.meta.url),
    "utf8",
  );
  const pinned = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${c.name}.json`],
    { encoding: "utf8" },
  );
  if (local !== pinned)
    throw Error(`${c.name}: ABI differs from pinned source commit`);
  const hash = keccak256(stringToHex(canonical(JSON.parse(local)))).slice(2);
  if (hash !== c.abiHash) throw Error(`${c.name}: ABI hash mismatch ${hash}`);
  console.log(`${c.name}: pinned ABI and canonical Keccak match ${hash}`);
}
