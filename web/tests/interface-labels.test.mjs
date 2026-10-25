import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parsers } from "prettier/plugins/typescript";
export async function interfaceLabels(files) {
  const labels = new Set();
  const replacements = new Map([
    ["Mint abandon", "Abandon request"],
    ["Mint apply", "Apply shared fact"],
    [
      "Prepared, see Transaction steps.",
      "Ready: confirm the steps in the dialog.",
    ],
    ["Preparing…", "Checking…"],
  ]);
  function children(node, visit) {
    for (const [key, value] of Object.entries(node)) {
      if (["comments", "tokens", "loc", "range"].includes(key)) continue;
      if (Array.isArray(value))
        value.forEach((child) => {
          if (child?.type) visit(child);
        });
      else if (value?.type) visit(value);
    }
  }
  function collect(node) {
    if (
      node.type === "JSXText" ||
      ((node.type === "Literal" || node.type === "StringLiteral") &&
        typeof node.value === "string")
    ) {
      const text = node.value.replace(/\s+/g, " ").trim();
      if (text) labels.add(replacements.get(text) || text);
    } else if (node.type === "JSXElement" || node.type === "JSXFragment")
      node.children.forEach(collect);
    else if (node.type !== "JSXOpeningElement") children(node, collect);
  }
  for (const [name, contents] of files) {
    const source = await parsers.typescript.parse(contents, { filepath: name });
    function visit(node) {
      if (
        node.type === "JSXElement" &&
        /^(button|a|option|label|legend|summary)$/.test(
          node.openingElement.name.name,
        )
      )
        node.children.forEach(collect);
      children(node, visit);
    }
    visit(source);
  }
  return [...labels].sort();
}
const src = new URL("../src/", import.meta.url);
test("all original control/link/choice label fragments stay except the explicitly requested changes", async () => {
  const files = fs
    .readdirSync(src)
    .filter((p) => p.endsWith(".tsx"))
    .map((p) => [p, fs.readFileSync(new URL(p, src), "utf8")]);
  const expected = JSON.parse(
    fs.readFileSync(new URL("fixtures/interface-labels.json", import.meta.url)),
  );
  const labels = await interfaceLabels(files);
  // Snapshot is the accepted starting interface. Footer links are data-driven;
  // their exact labels/URLs are also checked by sworn-step-browser.mjs.
  // This mainnet version separates three tasks and restores real wallet controls.
  // Keep every unrelated accepted label under the original
  // assertion; do not regenerate the baseline snapshot from changed source.
  const taskChanges = new Set([
    // Request details now shows the entire question without a nested toggle.
    "Show full question",
    "Show less",
    "Add facts",
    "Connect to mint",
    "Mint card",
    "Mint registration",
    "Mint selected facts",
    "Mint this fact",
    "Mint your card",
    "Mint your card ↗",
    "Pay for minting and paid facts with",
    "Read the direct rules",
    "Register a fact",
    "Register the first rule",
    "Request a fact ↗",
    "Request this fact",
    "Request this fact ↗",
    "WhitelistCurator.sol on Etherscan: Read Contract ↗",
    "Receipt:",
    "Replacement:",
    "Recover a transaction hash",
    "I understand these transactions spend IMD and gas. Oracle requests spend their price whatever the answer, including false, no verdict or a refused answer; there is no refund.",
  ]);
  const unchanged = expected.filter((label) => !taskChanges.has(label));
  assert.deepEqual(
    labels.filter((label) => unchanged.includes(label)),
    unchanged.sort(),
  );
  for (const label of [
    "Mint Card",
    "Mint Card ↗",
    "Payment method",
    "Mint Facts",
    "Mint Facts ↗",
    "Mint Rule",
    "View the card and wallet facts",
    "Switch to Ethereum",
    "Ethereum receipt:",
    "Replacement receipt:",
    "Recover a saved transaction",
  ])
    assert.ok(labels.includes(label), `Missing after-version action: ${label}`);
});
test("4/5/7 export has the pinned README, prescribed read RPC order, exact new wording and no superseded labels", async () => {
  const { READ_RPCS } = await import("../src/rpc.mjs");
  assert.deepEqual(READ_RPCS, [
    "https://ethereum-rpc.publicnode.com",
    "https://gateway.tenderly.co/public/mainnet",
    "https://rpc.mevblocker.io/fast",
    "https://1.rpc.thirdweb.com",
  ]);
  const assets = new URL("../../dist/assets/", import.meta.url);
  const text = fs
    .readdirSync(assets)
    .filter((n) => n.endsWith(".js"))
    .map((n) => fs.readFileSync(new URL(n, assets), "utf8"))
    .join("\n");
  for (const label of [
    "Mint abandon",
    "Mint apply",
    "Prepared, see Transaction steps.",
    "Preparing…",
  ])
    assert.equal(text.includes(label), false, label);
  for (const label of [
    "Abandon request",
    "Apply shared fact",
    "Ready: confirm the steps in the dialog.",
    "Checking…",
  ])
    assert.equal(text.includes(label), true, label);
  assert.ok(
    text.includes(
      "https://github.com/identity-md-launches/launch-2404-renderer-composer-registry/blob/c4ff3238390fc51962fb67e86affc20cf418126e/README.md",
    ),
  );
});
