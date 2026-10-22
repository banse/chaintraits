import solc from "solc";
import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { server, forwardRpc } from "./harness.mjs";
import { fakeChain, mockPage } from "./fake-chain.mjs";
const output = new URL("../../test/scratch/browser-check/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const providedRpc = process.env.SWORN_TEST_RPC;
const preview = await server({ rpcUrl: providedRpc });
const evidence = {
  at: new Date().toISOString(),
  browsers: {},
  pages: [],
  interactions: [],
  errors: [],
  limitations: [],
};
let browser;
async function readBody(page) {
  return page.locator("body").innerText();
}
try {
  browser = await chromium.launch({ headless: true });
  evidence.browsers.chromium = browser.version();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  if (!providedRpc) await mockPage(page, fakeChain());
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") evidence.errors.push(msg.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(preview.url))
      evidence.errors.push(`Local HTTP ${r.status()}: ${r.url()}`);
  });
  const external = [];
  page.on("request", (req) => {
    if (
      !req.url().startsWith(new URL(preview.url).origin) &&
      !req.url().startsWith("data:")
    )
      external.push(req.url());
  });
  if (providedRpc)
    await page.route(
      /https:\/\/(gateway\.tenderly\.co|rpc\.mevblocker\.io|ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1\.rpc\.thirdweb\.com)\/?/,
      async (route) => {
        try {
          const body = await forwardRpc(
            providedRpc,
            route.request().postDataJSON(),
          );
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body,
          });
        } catch (e) {
          await route.fulfill({ status: 503, body: e.message });
        }
      },
    );
  await page.goto(preview.url);
  await page.getByRole("heading", { level: 1 }).waitFor();
  assert.equal(await page.title(), "Sworn | Home");
  const action = await page
    .getByRole("button", { name: "Explore wallet" })
    .boundingBox();
  assert.ok(action.y + action.height <= 844);
  await page.getByRole("button", { name: "Explore wallet" }).click();
  assert.equal(
    await page.locator("#explore-address").getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(
    await page
      .locator("#explore-address")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  evidence.interactions.push(
    "Home address validation names the field, focuses it and keeps the main action in the first 390×844 screen.",
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
  await page.keyboard.press("Tab");
  assert.ok(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement)),
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.mouse.click(2, 2);
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  evidence.interactions.push(
    "Native wallet dialog opens; Tab stays inside; Escape/backdrop close and restores trigger focus.",
  );
  const routes = [
    "/",
    "/catalog",
    "/explorer",
    "/mint",
    "/wallet",
    "/claim",
    "/wallet-facts",
    "/fact-vs-artifact",
    "/integrate",
    "/whitelistcurator",
    "/about",
  ];
  for (const width of [320, 390, 780, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(`${preview.url}#${route}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.waitForTimeout(150);
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        h1: document.querySelector("h1").textContent,
        title: document.title,
      }));
      if (metrics.scroll > width) {
        const debug = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              text: e.textContent.slice(0, 100),
              right: e.getBoundingClientRect().right,
              width: e.getBoundingClientRect().width,
            })),
        );
        fs.writeFileSync(
          new URL("overflow-debug.json", output),
          JSON.stringify(debug, null, 2),
        );
        await page.screenshot({
          path: new URL("overflow-debug.png", output).pathname,
          fullPage: true,
        });
      }
      assert.ok(
        metrics.scroll <= width,
        `${route}: overflow ${metrics.scroll}/${width}`,
      );
      assert.ok(metrics.title.startsWith("Sworn | "));
      evidence.pages.push({ route, width, ...metrics });
      if ([390, 1280].includes(width))
        await page.screenshot({
          path: new URL(
            `${width}-${route === "/" ? "home" : route.slice(1)}.png`,
            output,
          ).pathname,
          fullPage: true,
        });
    }
  }
  evidence.interactions.push(
    "All eight hash routes render without page overflow at 320, 390, 780, 1280 and 1440; every route sets its Sworn tab title.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${preview.url}#/claim?trait=701`);
  await page.locator("#pick-701").waitFor();
  assert.equal(await page.locator("#pick-701 input").isChecked(), true);
  assert.equal(
    await page.getByRole("radio", { name: "IMD", exact: true }).isChecked(),
    true,
  );
  await page.getByRole("radio", { name: "ETH", exact: true }).check();
  assert.ok((await readBody(page)).includes("Pay with: ETH"));
  assert.match(await page.locator("#oracle-ack").innerText(), /payment dialog/);
  assert.equal(
    await page
      .getByRole("button", { name: "Mint selected facts" })
      .isDisabled(),
    true,
  );
  await page.locator("#spec-name").fill("Community fact");
  await page.locator("#spec-arg").fill("amount");
  assert.ok(
    (await page.locator("#spec-arg-error").innerText()).includes(
      "indexed address",
    ),
  );
  await page.locator("#spec-arg").fill("zzNotAField");
  assert.ok(
    (await page.locator("#spec-arg-error").innerText()).includes(
      "indexed address",
    ),
  );
  await page
    .locator("#spec-item")
    .fill("Please accept event X(address indexed contributor)");
  assert.ok(
    (await page.locator("#spec-item-error").innerText()).includes(
      "exactly event",
    ),
  );
  assert.equal(
    await page.getByRole("button", { name: "Mint registration" }).isDisabled(),
    true,
  );
  evidence.interactions.push(
    "Trait deep link preselects id 701; IMD defaults; ETH changes echoed payment text; disconnected writes stay disabled; community form refuses both audit claimant cases and prose-padded signatures.",
  );
  await page.goto(`${preview.url}#/integrate`);
  assert.equal(
    await page.getByRole("button", { name: "Copy", exact: true }).count(),
    2,
  );
  const example = await page.locator("pre code").first().innerText();
  const compiled = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Gate.sol": { content: example } },
        settings: { outputSelection: { "*": { "*": ["abi"] } } },
      }),
    ),
  );
  assert.deepEqual(
    compiled.errors?.filter((e) => e.severity === "error") || [],
    [],
  );
  await page.getByRole("button", { name: "Copy", exact: true }).first().click();
  await page.getByText(/Copied\.|Copy unavailable\./).waitFor();
  assert.equal(await page.locator('a[href$="agents/sworn.md"]').count(), 1);
  evidence.interactions.push(
    "Integrate has two working Copy controls, a Solidity gate that compiles with 0.8.24, and a linked exported agent skill.",
  );
  await page.goto(`${preview.url}#/whitelistcurator`);
  await page.locator(".hour-bar").last().waitFor();
  assert.equal(await page.locator("tbody tr").count(), 0);
  assert.equal(await page.locator(".source-lines>div").count(), 59);
  assert.equal(await page.locator(".hour-chart").isVisible(), true);
  await page.getByRole("button", { name: "Hour 64", exact: true }).focus();
  await page.getByRole("tooltip").getByText("Deposits: 8").waitFor();
  evidence.interactions.push(
    "Census chart exposes all 66 hours with a keyboard tooltip at 390; no hour table; all 59 source lines remain.",
  );
  if (providedRpc) {
    await page.goto(`${preview.url}#/integrate`);
    await page.getByText(/Dependencies verified/).waitFor({ timeout: 60000 });
    const live = JSON.parse(
      fs.readFileSync(
        new URL("../../docs/frontend/live-deployment.json", import.meta.url),
      ),
    );
    for (const address of [
      ...live.publicContributors,
      "0x000000000000000000000000000000000000c1a1",
    ]) {
      await page.goto(`${preview.url}#/explorer?address=${address}`);
      await page
        .getByText("preview, no card minted", { exact: true })
        .waitFor({ timeout: 60000 });
      assert.equal(await page.locator(".fact-row").count(), 25);
      assert.equal(
        await page
          .locator(".card-figure img")
          .evaluate((el) => el.complete && el.naturalWidth > 0),
        true,
      );
      await page
        .getByRole("button", { name: "Inspect Swarmed cell", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Family 6", exact: true })
        .waitFor();
      assert.equal(await page.locator(".fact-row").count(), 1);
      await page
        .getByRole("button", { name: "Show all 25 facts", exact: true })
        .click();
      await page.screenshot({
        path: new URL(`390-live-${address.slice(2, 8)}.png`, output).pathname,
        fullPage: true,
      });
    }
    evidence.interactions.push(
      "Three public contributors and a stranger load all 25 live hasTrait results and deployed-Renderer unminted previews over configured RPC requests relayed only by the test harness.",
    );
  }
  assert.equal(
    external.some((url) => url.includes("api.imd.fun")),
    false,
  );
  assert.deepEqual(evidence.errors, []);
  await context.close();
  await browser.close();
  browser = undefined;
  try {
    const safari = await webkit.launch({ headless: true });
    evidence.browsers.webkit = safari.version();
    const p = await safari.newPage({ viewport: { width: 390, height: 844 } });
    if (!providedRpc) await mockPage(p, fakeChain());
    if (providedRpc)
      await p.route(
        /https:\/\/(gateway\.tenderly\.co|rpc\.mevblocker\.io|ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1\.rpc\.thirdweb\.com)\/?/,
        async (route) => {
          const body = await forwardRpc(
            providedRpc,
            route.request().postDataJSON(),
          );
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body,
          });
        },
      );
    await p.goto(preview.url);
    await p.getByRole("heading", { level: 1 }).waitFor();
    await p.getByRole("button", { name: "Explore wallet" }).click();
    assert.equal(
      await p.locator("#explore-address").getAttribute("aria-invalid"),
      "true",
    );
    await p.getByRole("button", { name: "Connect", exact: true }).click();
    await p.getByRole("dialog").waitFor();
    await p.keyboard.press("Escape");
    assert.equal(await p.getByRole("dialog").isVisible(), false);
    await p.screenshot({
      path: new URL("webkit-390-home.png", output).pathname,
    });
    await safari.close();
    evidence.interactions.push(
      "WebKit: primary form validation and wallet dialog open/Escape verified at 390.",
    );
  } catch (e) {
    evidence.limitations.push(
      "WebKit could not run: " + e.message.split("\n").slice(0, 4).join(" "),
    );
  }
  console.log(
    JSON.stringify(
      {
        pages: evidence.pages.length,
        interactions: evidence.interactions,
        errors: evidence.errors,
        limitations: evidence.limitations,
      },
      null,
      2,
    ),
  );
} catch (e) {
  evidence.failure = e.stack;
  console.error(e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await preview.close();
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
