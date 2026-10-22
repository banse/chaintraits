// Independent verification of the raw, compared chain read retained by --raw.
// Run after generation: node web/tests/verify-snapshot-read.mjs test/scratch/eligibility-mainnet-logs.json
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { parseAbiItem, encodeEventTopics, decodeEventLog } from "viem";
const raw = process.argv[2];
if (!raw) throw Error("Pass the generator's --raw JSON path");
const logs = JSON.parse(fs.readFileSync(raw));
const data = new URL("../../dist/data/eligibility/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", data)));
assert.equal(
  createHash("sha256").update(JSON.stringify(logs)).digest("hex"),
  manifest.comparison.logsSha256,
);
const allWallets = new Set();
for (const log of logs) allWallets.add("0x" + log.topics[1].slice(-40));
assert.equal(allWallets.size, 19522);
assert.equal(
  allWallets.has("0x2000000000000000000000000000000000000001"),
  false,
);
const rows = Object.assign(
  {},
  ...Object.keys(manifest.files).map((name) =>
    JSON.parse(fs.readFileSync(new URL(name, data))),
  ),
);
const results = [];
for (const [column, id] of manifest.factIds.entries()) {
  const spec = manifest.facts[id].spec,
    event = parseAbiItem(spec.item);
  const topic = encodeEventTopics({ abi: [event], eventName: event.name })[0];
  const counts = new Map();
  for (const log of logs) {
    if (
      log.address.toLowerCase() !== spec.target.toLowerCase() ||
      log.topics[0] !== topic ||
      BigInt(log.blockNumber) < BigInt(spec.fromBlock) ||
      BigInt(log.blockNumber) > BigInt(spec.toBlock)
    )
      continue;
    const { args } = decodeEventLog({
      abi: [event],
      topics: log.topics,
      data: log.data,
      strict: true,
    });
    if (spec.fixedArg && BigInt(args[spec.fixedArg]) !== BigInt(spec.fixedVal))
      continue;
    const wallet = args[spec.arg].toLowerCase();
    counts.set(wallet, (counts.get(wallet) || 0) + 1);
  }
  for (const wallet of allWallets)
    assert.equal(
      rows[wallet]?.[column] || 0,
      counts.get(wallet) || 0,
      `${id}: ${wallet}`,
    );
  for (const wallet of Object.keys(rows))
    assert.equal(allWallets.has(wallet), true);
  assert.equal(counts.size, manifest.facts[id].matchingWallets);
  const matchingLogs = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.equal(matchingLogs, manifest.facts[id].matchingLogs);
  results.push({
    id,
    matchingLogs,
    matchingWallets: counts.size,
    walletComparisons: allWallets.size,
  });
}
console.log(
  JSON.stringify(
    {
      check:
        "Independently decoded event, window, fixed field and claimant for every wallet/fact",
      rawLogs: logs.length,
      depositedWallets: allWallets.size,
      exactCountComparisons: allWallets.size * manifest.factIds.length,
      results,
    },
    null,
    2,
  ),
);
