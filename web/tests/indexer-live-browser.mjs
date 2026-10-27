// Opt-in read-only mainnet integration. The injected provider rejects all writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { server, forwardRpc } from "./harness.mjs";
import { fakeWallet, inspectAllFacts } from "./fake-chain.mjs";

if (!process.env.SWORN_TEST_RPC) {
  console.log("SKIP: supply SWORN_TEST_RPC for read-only mainnet validation.");
  process.exit(0);
}
const output = new URL("../../test/scratch/indexer-live/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const report = {
  source: "https://ethereum-rpc.publicnode.com",
  indexer: "https://sworn.vibingco.de/api",
  checks: [],
  errors: [],
  timings: [],
  requests: [],
};
const wallets = [
  ["0x887b86b6b6957f7bbea88b8cefd392f39236a88c", 5, true],
  ["0xe5b1275fb926613d983da33fbfe1f331b7f64f2a", 47, true],
  ["0x84f4b7424e1b0464f9c749725c1f34bed9aa8ada", 0, false],
];
const readRpc =
  /^https:\/\/(ethereum-rpc\.publicnode\.com|gateway\.tenderly\.co|rpc\.mevblocker\.io|1\.rpc\.thirdweb\.com)(\/|$)/;
const cache = new Map();
const preview = await server();
const browser = await chromium.launch({ headless: true });
let context;
try {
  for (const [wallet, count, met] of wallets) {
    await context?.close();
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await fakeWallet(context, wallet);
    await context.route(readRpc, async (route) => {
      const payload = route.request().postDataJSON();
      assert.ok(
        /^(eth_(chainId|blockNumber|call|get)|net_version)/.test(
          payload.method,
        ),
        "Only read-only RPC methods are forwarded",
      );
      const key = JSON.stringify({
        method: payload.method,
        params: payload.params,
      });
      let response = cache.get(key);
      if (!response) {
        response = JSON.parse(
          await forwardRpc(process.env.SWORN_TEST_RPC, payload),
        );
        if (!response.error) cache.set(key, response);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...response, id: payload.id }),
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.url().startsWith(report.indexer))
        report.requests.push(request.url());
    });
    await page.goto(preview.url + "#/request?trait=10001");
    await page
      .locator("footer [role=status]")
      .filter({ hasText: /Ethereum mainnet · block/ })
      .waitFor({ timeout: 60000 });
    const started = performance.now();
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
    await inspectAllFacts(page);
    const row = page.locator("#pick-10001");
    await row.getByText(/Source: indexer, block/).waitFor({ timeout: 5000 });
    const elapsedMs = Math.round(performance.now() - started);
    assert.ok(elapsedMs < 5000);
    const text = await row.innerText();
    assert.ok(text.includes(`${count} matching`));
    assert.ok(
      text.includes(met ? "finds this rule met" : "does not meet this rule"),
    );
    report.timings.push({ wallet, count, met, elapsedMs });
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: new URL(`rule-${count}-390.png`, output).pathname,
    });
    report.checks.push(`Live rule 10001: ${count}, met=${met}`);
    assert.equal(await page.evaluate(() => window.__signing.length), 0);
    if (count === 5) {
      await page.goto(preview.url + `#/fact-check?wallet=${wallet}`);
      await page
        .getByText("All fact history loaded.", { exact: true })
        .waitFor();
      const list = page.locator(".fc-history-list");
      for (const id of [601, 701, 1105, 1301])
        assert.ok((await list.innerText()).includes(`Fact ${id}`));
      await list.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: new URL("history-390.png", output).pathname,
      });
      await list
        .getByRole("link", { name: "View agents and results" })
        .first()
        .click();
      await page.getByText("✓ FACT SAVED", { exact: true }).waitFor();
      await page.getByText("✓ FACT SAVED", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: new URL("fact-check-390.png", output).pathname,
      });
      report.checks.push(
        "Live card 2 wallet: four verified requests and saved request details",
      );
    }
    console.log(`PASS live wallet ${wallet}: count ${count}, ${elapsedMs}ms`);
  }
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(
    new URL("report.json", output),
    JSON.stringify(report, null, 2) + "\n",
  );
  await context?.close();
  await browser.close();
  await preview.close();
}
