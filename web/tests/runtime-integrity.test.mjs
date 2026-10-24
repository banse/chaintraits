import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateRuntimeAssets } from "../src/runtime-integrity.mjs";
const load = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const deployment = load("../../dist/imd-deployment.json");
const preview = load("../public/data/renderer-preview.json");
const abis = Object.fromEntries(
  ["Registry", "Renderer", "Composer", "WhitelistCurator", "IntakeV2"].map(
    (n) => [n, load(`../public/abi/${n}.json`)],
  ),
);
test("bundled runtime shares the export's exact pinned deployment, network and five ABI inputs", () => {
  const handoff = load("../deployment-handoff.json"),
    network = load("../network.json");
  assert.deepEqual(
    handoff.contracts
      .map((c) => ({ ...c, abiPath: `abi/${c.name}.json` }))
      .map(({ name, address, abiHash, abiPath }) => ({
        name,
        address,
        abiHash,
        abiPath,
      })),
    deployment.contracts,
  );
  assert.deepEqual(network.network, deployment.network);
  assert.deepEqual(network.walletAddChain, deployment.walletAddChain);
  assert.equal(
    validateRuntimeAssets(deployment, abis, preview).preview,
    preview,
  );
});
test("runtime still refuses network, every application ABI, unsafe path, and preview source mismatches", () => {
  assert.throws(
    () => validateRuntimeAssets({ ...deployment, chainId: 2 }, abis, preview),
    /network mismatch/,
  );
  assert.throws(
    () => validateRuntimeAssets({ ...deployment, version: 2 }, abis, preview),
    /network mismatch/,
  );
  for (const c of deployment.contracts) {
    assert.throws(
      () =>
        validateRuntimeAssets(deployment, { ...abis, [c.name]: [] }, preview),
      new RegExp(`${c.name} ABI integrity check failed`),
    );
    assert.throws(
      () =>
        validateRuntimeAssets(
          { ...deployment, contracts: [{ ...c, abiPath: "../outside.json" }] },
          abis,
          preview,
        ),
      /Unsafe ABI path/,
    );
  }
  assert.throws(
    () =>
      validateRuntimeAssets(deployment, abis, {
        ...preview,
        sourceCommit: "wrong",
      }),
    /source mismatch/,
  );
});
