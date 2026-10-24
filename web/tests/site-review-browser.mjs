// Reopened review regressions against the served production export.
// Wallet, RPC and API fixtures are synthetic; nothing is signed or sent.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { fakeChain, fakeWallet, mockPage, sharedSpec } from "./fake-chain.mjs";
import { server } from "./harness.mjs";

const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/site-review-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const evidence = { checks: [], failures: [], errors: [], measurements: [] };
let browser, context, page;
const community = {
  ...sharedSpec,
  name: "Shared community weights",
  threshold: 2n,
};

async function setup({
  route = "#/mint",
  width = 1280,
  delay = 0,
  connect = false,
} = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width, height: 844 },
    hasTouch: true,
  });
  await fakeWallet(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().startsWith(preview.url) && response.status() >= 400)
      evidence.errors.push(`Local HTTP ${response.status()}`);
  });
  const fixture = fakeChain({
    token: 1n,
    allowance: 10n ** 22n,
    nextSpecId: 10003,
    specs: {
      10001: community,
      10002: {
        ...community,
        name: 'Other <shared> & "weights"',
        threshold: 3n,
      },
    },
  });
  const answer = fixture.answer;
  fixture.answer = async (payload) => {
    if (delay && payload.method === "eth_call")
      await new Promise((resolve) => setTimeout(resolve, delay));
    return answer(payload);
  };
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ requests: [], entries: [] }),
    }),
  );
  await page.goto(preview.url + route);
  if (connect) {
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
  }
}

async function run(name, check) {
  try {
    await check();
    evidence.checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.failures.push({ name, detail: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

try {
  browser = await (engine === "webkit" ? webkit : chromium).launch();
  for (const width of [1280, 390]) {
    await run(`community previews render and align at ${width}px`, async () => {
      await setup({ width, connect: true });
      await page.locator("#pick-10002 .row-actions button").waitFor();
      for (const id of [1201, 10001, 10002]) {
        const row = page.locator(`#pick-${id}`);
        assert.equal(
          await row.locator(":scope > .mini-card").count(),
          1,
          `preview for ${id}`,
        );
        await page.waitForFunction((id) => {
          const image = document.querySelector(`#pick-${id} .mini-card img`);
          return image?.complete && image.naturalWidth > 0;
        }, id);
      }
      const previews = await page
        .locator("#step-02 .picker-row")
        .evaluateAll((rows) =>
          rows.map((row) => {
            const card = row.querySelector(":scope > .mini-card");
            const button = row.querySelector(":scope > .row-actions");
            const box = (node) => node?.getBoundingClientRect().toJSON();
            return {
              id: row.id,
              row: box(row),
              card: box(card),
              button: box(button),
              text: box(row.firstElementChild),
              border: card && [
                getComputedStyle(card).borderTopWidth,
                getComputedStyle(card).borderTopColor,
              ],
              src: card?.querySelector("img")?.src,
            };
          }),
        );
      const shared = previews.filter((row) =>
        ["pick-1201", "pick-10001", "pick-10002"].includes(row.id),
      );
      for (const row of shared) {
        assert.deepEqual(row.border, ["1px", "rgb(31, 31, 31)"]);
        assert.ok(Math.abs(row.card.left - shared[0].card.left) < 1);
        assert.ok(Math.abs(row.button.left - shared[0].button.left) < 1);
        if (width === 1280) {
          const mid = (box) => box.top + box.height / 2;
          assert.ok(Math.abs(mid(row.card) - mid(row.row)) < 1);
          assert.ok(Math.abs(mid(row.button) - mid(row.row)) < 1);
        } else {
          assert.ok(row.card.top >= row.text.bottom);
          assert.ok(row.button.left > row.card.right);
        }
      }
      const generated = shared
        .slice(1)
        .map((row) => decodeURIComponent(row.src.split(",")[1]));
      assert.notEqual(
        generated[0],
        generated[1],
        "previews are derived from each community fact",
      );
      assert.ok(generated[0].includes("Shared community weights"));
      assert.ok(
        generated[1].includes("&lt;shared&gt; &amp; &quot;weights&quot;"),
      );
      assert.ok(previews.every((row) => !row.src?.includes("art/trait-1000")));
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await page.locator("#pick-10001").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: new URL(`community-${width}.png`, output).pathname,
      });
      evidence.measurements.push({
        width,
        shared: shared.map(({ src, ...row }) => row),
      });
    });
  }
  for (const width of [320, 390, 1440]) {
    await run(
      `hour tooltip is hoverable, dismissible and focusable at ${width}px`,
      async () => {
        await setup({ route: "#/whitelistcurator", width });
        // Let the alias's scheduled anchor navigation finish before scrolling
        // to the chart; otherwise it can move the pointer target mid-hover.
        await page.waitForFunction(
          () =>
            document.getElementById("whitelistcurator")?.getBoundingClientRect()
              .top < 30,
        );
        await page
          .locator("#hours")
          .evaluate((node) => node.scrollIntoView({ block: "start" }));
        await page
          .getByRole("heading", { name: "Every hour", exact: true })
          .click();
        const bar = page.getByRole("button", { name: "Hour 64", exact: true });
        const tooltip = page.getByRole("tooltip");
        await bar.hover();
        await tooltip.waitFor();
        const text = await tooltip.innerText();
        const target = await tooltip.boundingBox();
        const origin = await bar.boundingBox();
        // Travel below the bars before moving across the tooltip; crossing other
        // bars intentionally changes the active hour and is a different gesture.
        await page.mouse.move(
          origin.x + origin.width / 2,
          target.y + target.height / 2,
          { steps: 20 },
        );
        await tooltip.hover();
        assert.equal(
          await tooltip.count(),
          1,
          "tooltip survives pointer travel from bar to its text",
        );
        assert.equal(await tooltip.innerText(), text);
        await page.screenshot({
          path: new URL(`tooltip-${width}.png`, output).pathname,
        });
        await page.mouse.move(0, 0);
        assert.equal(
          await tooltip.count(),
          0,
          "pointer departure dismisses an unfocused tooltip",
        );
        await bar.focus();
        await tooltip.getByText("Deposits: 8", { exact: true }).waitFor();
        await tooltip.getByText("ETH: 11", { exact: true }).waitFor();
        await tooltip.getByText("First deposits: 6", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await tooltip.count(), 0);
        await bar.tap();
        await tooltip.waitFor();
        await page.keyboard.press("Tab");
        assert.equal(await tooltip.count(), 0, "keyboard blur still dismisses");
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      },
    );
  }
  for (const route of [
    "#/claim#shared-10001",
    "#/claim?trait=10001#shared-10001",
    "#/mint#pick-10001",
  ]) {
    await run(`delayed community anchor scrolls for ${route}`, async () => {
      await setup({ route, width: 390, delay: 150 });
      await page.locator("#pick-10001").waitFor();
      await page.waitForTimeout(500);
      const position = await page.locator("#pick-10001").evaluate((node) => ({
        top: node.getBoundingClientRect().top,
        scroll: scrollY,
      }));
      evidence.measurements.push({ route, ...position });
      assert.equal(await page.title(), "Sworn | Mint");
      assert.ok(
        position.scroll > 0 && position.top >= -1 && position.top < 844,
        JSON.stringify(position),
      );
      if (route.includes("?trait="))
        assert.equal(await page.locator("#pick-10001 input").isChecked(), true);
    });
  }
  await run("navigation cancels an unresolved anchor", async () => {
    await setup({ route: "#/mint#later-row", width: 390 });
    await page.getByText(/Dependencies verified/).waitFor();
    await page.evaluate(() => {
      location.hash = "/mint";
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const target = document.createElement("div");
      target.id = "later-row";
      target.textContent = "Delayed target";
      document.querySelector("main").append(target);
    });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => scrollY), 0);
  });
  assert.deepEqual(evidence.errors, []);
  if (evidence.failures.length) process.exitCode = 1;
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await context?.close();
  await browser?.close();
  await preview.close();
}
