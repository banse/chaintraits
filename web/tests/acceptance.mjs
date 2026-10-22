import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { fakeChain, fakeWallet, mockPage } from "./fake-chain.mjs";
import { server } from "./harness.mjs";
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/acceptance-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
let browser, activePage;
const evidence = {
  at: new Date().toISOString(),
  engine,
  checks: [],
  errors: [],
  limitations: [],
};
async function run(name, fn) {
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await fakeWallet(context);
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  const f = fakeChain();
  await mockPage(page, f);
  async function loaded() {
    await page.getByText(/Dependencies verified/).waitFor();
  }
  async function claim() {
    await page.goto(preview.url + "#/claim");
    await loaded();
    await page.getByText("preview, no card minted", { exact: true }).waitFor();
  }
  async function connect() {
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
    await page.getByText("preview, no card minted", { exact: true }).waitFor();
  }
  async function dismiss() {
    await page.getByRole("button", { name: "Close payment dialog" }).click();
  }
  async function dialog() {
    const d = page.getByRole("dialog", { name: /Mint your|Request |Register/ });
    await d.waitFor();
    return d;
  }
  await run(
    "C first RPC always 429 still displays live values without recovered error text",
    async () => {
      f.state.failFirst = true;
      await page.goto(preview.url + "#/claim");
      await loaded();
      assert.equal(await page.getByText(/Cannot read the chain/).count(), 0);
      await connect();
    },
  );
  await run(
    "D form has empty values and no errors, template selection only changes placeholders",
    async () => {
      assert.equal(
        await page
          .locator(".community-form input")
          .evaluateAll((es) => es.every((e) => e.value === "")),
        true,
      );
      assert.equal(
        await page
          .locator(".field-error")
          .allTextContents()
          .then((xs) => xs.every((s) => s === "")),
        true,
      );
      await page.locator("#spec-kind").selectOption("3");
      assert.equal(
        await page
          .locator(".community-form input")
          .evaluateAll((es) => es.every((e) => e.value === "")),
        true,
      );
      await page.locator("#spec-arg").fill("from");
      await page
        .locator("#spec-item")
        .fill(
          "event Transfer(address indexed from, address indexed to, uint256 amount)",
        );
      assert.match(
        await page.locator("#spec-arg-error").innerText(),
        /Missed reason 9/,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Mint registration" })
          .isDisabled(),
        true,
      );
    },
  );
  await run(
    "E mint dialog: live fee, balance, card preview, disclaimer and simulation before signing; saved across close/reload",
    async () => {
      await page
        .getByRole("button", { name: "Mint card", exact: true })
        .click();
      const d = await dialog();
      const bounds = await d.boundingBox();
      assert.deepEqual(
        {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        { x: 0, y: 0, width: 390, height: 844 },
      );
      assert.match(await d.innerText(), /0.10 IMD/);
      assert.match(await d.innerText(), /IMD balance/);
      assert.equal(
        await d.getByRole("heading", { name: "Your card's facts" }).count(),
        1,
      );
      const action = d.getByRole("button", {
        name: "Mint one Sworn card",
        exact: true,
      });
      assert.equal(await action.isDisabled(), true);
      assert.equal(
        await d
          .getByRole("button", { name: "Approve IMD", exact: true })
          .isDisabled(),
        true,
      );
      await d.locator("#payment-ack").check();
      await d.getByText("simulated", { exact: true }).waitFor();
      assert.equal(await action.isDisabled(), true);
      await d.getByRole("button", { name: "Approve IMD", exact: true }).click();
      await d
        .getByText(/Rejected in your wallet/)
        .first()
        .waitFor();
      assert.equal((await page.evaluate(() => window.__signing)).length, 1);
      await dismiss();
      await page
        .getByRole("button", { name: "Review transaction steps" })
        .click();
      assert.match(await d.innerText(), /rejected/);
      await dismiss();
      await page.reload();
      await loaded();
      await page
        .getByRole("button", { name: "Review transaction steps" })
        .click();
      await d.waitFor();
      assert.equal(await d.locator("#payment-ack").isChecked(), false);
      assert.match(await d.innerText(), /rejected/);
      assert.equal(await action.isDisabled(), true);
      await page.screenshot({
        path: new URL("mint-dialog-390.png", output).pathname,
      });
      await d.getByRole("button", { name: "Clear journal" }).click();
    },
  );
  await run(
    "E approval receipt unlocks a separately simulated mint; no automatic second signature",
    async () => {
      await page
        .getByRole("button", { name: "Mint card", exact: true })
        .click();
      const d = await dialog();
      await d.locator("#payment-ack").check();
      await d.getByText("simulated", { exact: true }).waitFor();
      await page.evaluate(() => (window.__accept = true));
      await d.getByRole("button", { name: "Approve IMD", exact: true }).click();
      await d.getByText("confirmed", { exact: true }).waitFor();
      assert.equal((await page.evaluate(() => window.__signing)).length, 1);
      await d.getByText("simulated", { exact: true }).waitFor();
      await page.evaluate(() => (window.__accept = false));
      await d
        .getByRole("button", { name: "Mint one Sworn card", exact: true })
        .click();
      await d
        .getByText(/Rejected in your wallet/)
        .first()
        .waitFor();
      await d.getByRole("button", { name: "Clear journal" }).click();
    },
  );
  async function paidTest(button, action) {
    await page.getByRole("button", { name: button, exact: true }).click();
    const d = await dialog();
    assert.equal(
      await d.getByRole("button", { name: "Approve IMD", exact: true }).count(),
      0,
    );
    const sign = d.getByRole("button", { name: action, exact: true });
    assert.equal(await sign.isDisabled(), true);
    await d.locator("#payment-ack").check();
    await d.getByText("simulated", { exact: true }).waitFor();
    await sign.click();
    await d
      .getByText(/Rejected in your wallet/)
      .first()
      .waitFor();
    await d.getByRole("button", { name: "Clear journal" }).click();
  }
  await run(
    "E personal fact dialog uses live request price, no unnecessary approval and a simulated call",
    async () => {
      await page.locator("#pick-601 input").check();
      await paidTest("Mint selected facts", "Request 601 / Swarmed");
    },
  );
  await run(
    "A/E valid shared list reaches signing through the shared-fact dialog",
    async () => {
      await paidTest(
        "Mint shared fact",
        "Request shared fact 1201 / Top Weights",
      );
    },
  );
  await run(
    "A low shared top-head address and short list block a paid request before a dialog or signing",
    async () => {
      for (const key of ["unsafe", "short", "incomplete"]) {
        f.state[key] = true;
        const before = (await page.evaluate(() => window.__signing)).length;
        await page
          .getByRole("button", { name: "Mint shared fact", exact: true })
          .click();
        await page
          .getByText(
            key === "unsafe"
              ? /below 2\*\*80/
              : key === "short"
                ? /short list/
                : /not read in full/,
          )
          .first()
          .waitFor();
        assert.equal(await page.locator(".payment-dialog[open]").count(), 0);
        assert.equal(
          (await page.evaluate(() => window.__signing)).length,
          before,
        );
        f.state[key] = false;
      }
    },
  );
  await run(
    "D/E typed valid community registration opens the same payment dialog and reaches signing",
    async () => {
      await page.locator("#spec-kind").selectOption("3");
      for (const [field, value] of Object.entries({
        name: "Weighted wallets",
        target: sharedAddress(),
        item: "event Weighted(address indexed contributor, uint256 amount)",
        arg: "contributor",
        sumArg: "amount",
        threshold: "2",
        fromBlock: "25769870",
        toBlock: "25789604",
      }))
        await page.locator("#spec-" + field).fill(value);
      await paidTest(
        "Mint registration",
        "Register the immutable community spec",
      );
    },
  );
  function sharedAddress() {
    return JSON.parse(
      fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
    ).manifest.contracts.find((c) => c.contract === "Registry")
      .constructorArgs[0];
  }
  await run("E failed simulation never unlocks signing", async () => {
    f.state.failSimulation = true;
    await page.getByRole("button", { name: "Mint card", exact: true }).click();
    const d = await dialog();
    await d.locator("#payment-ack").check();
    await d.getByText("failed", { exact: true }).waitFor();
    assert.equal(
      await d
        .getByRole("button", { name: "Mint one Sworn card", exact: true })
        .isDisabled(),
      true,
    );
    f.state.failSimulation = false;
    await d.getByRole("button", { name: "Clear journal" }).click();
  });
  await run("C tokenOf=1 displays card #1 with no mint button", async () => {
    f.state.token = 1n;
    await page.reload();
    await loaded();
    await page
      .getByRole("heading", { name: "Your Sworn card #1", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Mint card", exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: new URL("owned-card-390.png", output).pathname,
    });
  });
  await run(
    "C every RPC failing disables paid actions and shows retrying; manual retry recovers",
    async () => {
      f.state.failAll = true;
      await page.reload();
      await page
        .getByText(/Cannot read the chain, retrying/)
        .first()
        .waitFor();
      for (const b of await page.getByRole("button", { name: /^Mint/ }).all())
        assert.equal(await b.isDisabled(), true);
      f.state.failAll = false;
      await page
        .getByRole("button", { name: "Retry reads", exact: true })
        .click();
      await loaded();
    },
  );
  await run(
    "B Agents is a direct Markdown link on every route; D layouts have no overflow at 390 and 1280",
    async () => {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const route of [
          "/",
          "/catalog",
          "/explorer",
          "/claim",
          "/fact-vs-artifact",
          "/integrate",
          "/whitelistcurator",
          "/about",
        ]) {
          await page.goto(preview.url + "#" + route);
          await page.getByRole("heading", { level: 1 }).waitFor();
          const link = page.getByRole("link", { name: "Agents", exact: true });
          assert.ok(
            (await link.getAttribute("href")).endsWith("agents/sworn/SKILL.md"),
          );
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${route} at ${width}`,
          );
        }
      }
      const r = await page.request.get(preview.url + "agents/sworn/SKILL.md");
      assert.match(r.headers()["content-type"], /text\//);
      assert.match(await r.text(), /^---\nname: sworn/);
      await page.goto(preview.url);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: new URL("home-390.png", output).pathname });
    },
  );
  assert.deepEqual(evidence.errors, []);
  await context.close();
} catch (e) {
  evidence.errors.push(e.stack);
  if (activePage) {
    evidence.body = await activePage
      .locator("body")
      .innerText()
      .catch(() => null);
    await activePage
      .screenshot({ path: new URL("failure.png", output).pathname })
      .catch(() => {});
  }
  throw e;
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2),
  );
  await browser?.close();
  await preview.close();
}
