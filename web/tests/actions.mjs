import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { fakeChain, fakeWallet, mockPage, wallet } from "./fake-chain.mjs";
import { decodeCompletion } from "../src/oracle.mjs";
import { server } from "./harness.mjs";
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/actions-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const deployment = JSON.parse(
  fs.readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
);
const registry = deployment.contracts.find(
  (c) => c.name === "Registry",
).address;
const registryAbi = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
);
const intakeAbi = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/IntakeV2.json", import.meta.url)),
);
const recorded = JSON.parse(
  fs.readFileSync(new URL("fixtures/completion-mainnet.json", import.meta.url)),
);
const completion = decodeCompletion(
  intakeAbi,
  registryAbi,
  recorded.requestId,
  recorded.input,
);
const evidence = {
  at: new Date().toISOString(),
  engine,
  checks: [],
  errors: [],
};
let browser, page;
const paid = [
  {
    fn: "mintCard",
    button: "Mint card",
    label: "Mint Card",
    error: "AlreadyMinted",
    args: [wallet],
    reason: /already has a card/,
  },
  {
    fn: "upgrade",
    button: "Mint selected facts",
    label: "Request 601 / Swarmed",
    error: "AlreadyPending",
    args: [wallet, 601],
    reason: /Fact 601 already has a pending request/,
  },
  {
    fn: "requestSharedFact",
    button: "Mint this fact: 1201 / Top Weights",
    label: "Request shared fact 1201 / Top Weights",
    error: "PriceAboveMax",
    args: [2n, 1n],
    reason: /live oracle price increased/,
  },
  {
    fn: "registerSpec",
    button: "Mint registration",
    label: "Mint Rule",
    error: "UnexpectedSpecId",
    args: [10001, 10002],
    reason: /Another spec was registered first/,
  },
  {
    fn: "approve",
    button: "Mint card",
    label: "Approve IMD",
    allowance: 0n,
    error: "Error",
    args: ["The token refused this approval. Check its allowance and retry."],
    reason: /token refused this approval/,
  },
  {
    fn: "approve",
    button: "Mint card",
    label: "Reset allowance",
    allowance: 1n,
    error: "Error",
    args: ["The token refused this reset. Check its allowance and retry."],
    reason: /token refused this reset/,
  },
  {
    fn: "execute",
    button: "Mint card",
    label: "Buy IMD",
    balance: 0n,
    error: "Error",
    args: ["The swap quote is no longer available. Start the action again."],
    reason: /swap quote is no longer available/,
  },
];
paid.push({
  fn: "registerSpec",
  button: "Mint registration",
  label: "Mint Rule",
  error: "BadSpec",
  args: ["window"],
  reason: /Composer refused the block window/,
});
const supplemental = [
  {
    fn: "applySharedFact",
    label: "Apply shared fact",
    callArgs: [1201, [wallet]],
    error: "NotInList",
    args: [],
    reason: /wallet is not in the shared list/,
  },
  {
    fn: "settle",
    label: "Store the verdict",
    callArgs: [
      recorded.requestId,
      completion.attestation,
      completion.signature,
    ],
    error: "NotSettleable",
    args: [recorded.requestId, 5],
    reason: /Cannot store the verdict/,
  },
  {
    fn: "abandon",
    label: "Abandon pending request",
    callArgs: [recorded.requestId],
    error: "TooEarly",
    args: [],
    reason: /cannot be cleared yet/,
  },
];
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  evidence.browserVersion = browser.version();
  for (const scenario of [...paid, ...supplemental]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await fakeWallet(context);
    const f = fakeChain({
      allowance: scenario.allowance ?? 10n ** 22n,
      balance: scenario.balance ?? 10n ** 21n,
      failFunction: scenario.fn,
      revertName: scenario.error,
      revertArgs: scenario.args,
    });
    if (scenario.callArgs) {
      const call = {
        label: scenario.label,
        functionName: scenario.fn,
        args: scenario.callArgs,
        amount: 0n,
      };
      const saved = {
        plan: {
          title: "Recovered test action",
          from: "step-02",
          calls: [call],
          price: f.state.price,
          amount: 0n,
          balance: f.state.balance,
          account: wallet,
          payment: "IMD",
          lines: [],
        },
        steps: [
          // Only a journal containing a sent transaction can be restored.
          {
            label: "Previously sent setup",
            state: "confirmed",
            hash: "0x" + "77".repeat(32),
          },
          { label: scenario.label, state: "ready", call },
        ],
        ack: false,
      };
      const encoded = JSON.stringify(saved, (_, v) =>
        typeof v === "bigint" ? { bigint: String(v) } : v,
      );
      await context.addInitScript(
        (value) => localStorage.setItem("sworn.transaction-journal", value),
        encoded,
      );
    }
    page = await context.newPage();
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") evidence.errors.push(m.text());
    });
    await mockPage(page, f);
    await page.goto(preview.url + "#/claim");
    await page.getByText(/Dependencies verified/).waitFor();
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
    await page.getByText("preview, no card minted", { exact: true }).waitFor();
    if (scenario.callArgs)
      await page
        .getByRole("button", { name: "Review transaction steps", exact: true })
        .click();
    else {
      if (scenario.fn === "upgrade")
        await page.locator("#pick-601 input").check();
      if (scenario.fn === "execute")
        await page.getByRole("radio", { name: "ETH", exact: true }).check();
      if (scenario.fn === "registerSpec") {
        await page.locator("#spec-kind").selectOption("1");
        for (const [field, value] of Object.entries({
          name: "Browser test fact",
          target: registry,
          item: "event Deposited(address indexed contributor, uint256 amount)",
          arg: "contributor",
          threshold: "1",
          fromBlock: "25769870",
          toBlock: "25789604",
        }))
          await page.locator("#spec-" + field).fill(value);
      }
      if (scenario.error === "BadSpec") {
        f.state.failFunction = "validateSpec";
        await page
          .getByRole("button", { name: scenario.button, exact: true })
          .click();
        await page
          .locator(".community-form")
          .getByText(scenario.reason)
          .waitFor();
        assert.equal(await page.locator(".payment-dialog[open]").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.__signing), []);
        f.state.failFunction = scenario.fn;
      }
      await page
        .getByRole("button", { name: scenario.button, exact: true })
        .click();
    }
    const dialog = page.locator(".payment-dialog");
    await dialog.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: /^Simulate\b|^Prepare\b/ })
        .count(),
      0,
    );
    const action = dialog.getByRole("button", {
      name: scenario.label,
      exact: true,
    });
    assert.equal(
      await action.isDisabled(),
      true,
      "consent gates automatic checks",
    );
    await dialog.locator("#payment-ack").check();
    await dialog.getByText("failed", { exact: true }).waitFor();
    assert.match(await dialog.innerText(), scenario.reason);
    assert.equal(await action.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__signing), []);
    f.state.failFunction = "";
    await dialog
      .getByRole("button", { name: "Retry check", exact: true })
      .click();
    await dialog.getByText("simulated", { exact: true }).waitFor();
    assert.equal(await action.isEnabled(), true);
    assert.deepEqual(
      await page.evaluate(() => window.__signing),
      [],
      "a successful check must not sign",
    );
    f.state.failFunction = scenario.fn;
    await action.click();
    await dialog.getByText("failed", { exact: true }).waitFor();
    assert.match(await dialog.innerText(), scenario.reason);
    assert.equal(await action.isDisabled(), true);
    assert.deepEqual(
      await page.evaluate(() => window.__signing),
      [],
      "recheck immediately before signing must stop a changed call",
    );
    evidence.checks.push({
      action: scenario.label,
      function: scenario.fn,
      entry: scenario.callArgs ? "restored journal" : "primary UI",
      passed: true,
    });
    console.log(
      "PASS silent check, plain refusal, retry and signing recheck: " +
        scenario.label,
    );
    await context.close();
  }
  assert.deepEqual(evidence.errors, []);
} catch (e) {
  evidence.failure = e.stack;
  process.exitCode = 1;
  console.error(e);
  if (page) {
    evidence.body = await page
      .locator("body")
      .innerText()
      .catch(() => null);
    await page
      .screenshot({ path: new URL("failure.png", output).pathname })
      .catch(() => {});
  }
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser?.close();
  await preview.close();
}
