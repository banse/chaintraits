// Round 8, items 2 and 4 to 7, on the built export with a fake EIP-1193
// wallet, fake RPC answers and a fake progress API. Nothing is signed or sent.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { fakeChain, fakeWallet, mockPage, wallet } from "./fake-chain.mjs";
import { server } from "./harness.mjs";

const output = new URL("../../test/scratch/round8/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const deployment = JSON.parse(
  fs.readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
);
const registry = deployment.contracts
  .find((c) => c.name === "Registry")
  .address.toLowerCase();
const LAUNCH = 26242885n;
const requestId = "0x" + "a1".repeat(32),
  questionHash = "0x" + "b1".repeat(32);
const oracleId = "23474d49-bf7c-40e0-8dad-41636c73ea84",
  oracleBytes = "0x23474d49bf7c40e08dad41636c73ea84" + "00".repeat(16);
const spec = {
  kind: 1,
  target: "0x3000000000000000000000000000000000000002",
  item: "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount)",
  arg: "contributor",
  fixedArg: "hour",
  fixedVal: 64n,
  sumArg: "",
  op: 0,
  threshold: 1n,
  fromBlock: 25769870n,
  toBlock: 25789604n,
  name: "Community Holdout",
};
const STALE = "Requested more than 2 hours ago.";
const evidence = { checks: [], errors: [], widths: [] };
let browser, context, page, fixture, control;
async function run(name, fn) {
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
const nowMs = Date.now();
async function setup({
  pending = null,
  head,
  failHistory = false,
  route = "#/claim",
  connect = true,
  prepare,
  records = [],
} = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  // The clock is fixed so request ages are exact to the second.
  await context.clock.setFixedTime(nowMs);
  await fakeWallet(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  control = { logs: [], head, failHistory, api: [] };
  fixture = fakeChain({
    nextSpecId: 10002,
    token: 1n,
    allowance: 10n ** 22n,
    price: 1250000000000000000n,
    specs: { 10001: spec },
    pending: pending
      ? [
          {
            id: pending.id,
            requestId,
            questionHash,
            requestedAt: pending.requestedAt,
            transactionHash: "0x" + "66".repeat(32),
          },
        ]
      : [],
  });
  const base = fixture.answer;
  fixture.answer = async (p) => {
    const f = p.params?.[0];
    if (p.method === "eth_getLogs") {
      control.logs.push(f);
      if (control.failHistory && f.address.toLowerCase() === registry)
        throw Error("Historical logs unavailable");
    }
    if (control.head !== undefined) {
      if (p.method === "eth_blockNumber")
        return "0x" + control.head.toString(16);
      if (p.method === "eth_getBlockByNumber" && p.params[0] === "latest")
        return {
          ...(await base(p)),
          number: "0x" + control.head.toString(16),
        };
    }
    return base(p);
  };
  prepare?.(fixture, control);
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", async (r) => {
    const u = new URL(r.request().url());
    control.api.push(u.pathname);
    const body =
      u.pathname === "/oracle/requests"
        ? { requests: [] }
        : u.pathname.startsWith("/intake/")
          ? { entries: [] }
          : records.find((x) => u.pathname.endsWith("/" + x.id)) || {};
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(body),
    });
  });
  await page.goto(preview.url + route);
  await page.getByText(/Dependencies verified/).waitFor();
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
async function noOverflow(name) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForTimeout(150);
    const actual = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(actual <= width, `${name}: overflow ${actual} at ${width}`);
    evidence.widths.push({ name, width, actual });
    await page.screenshot({
      path: new URL(`${name}-${width}.png`, output).pathname,
      fullPage: false,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
const rows = () => page.locator("#step-02 .picker-row");
try {
  browser = await chromium.launch();
  const age = (s) => BigInt(Math.floor(nowMs / 1000) - s);

  await run(
    "2 a pending request 7,201 s old shows the stale line while 200 blocks behind head",
    async () => {
      await setup({
        pending: { id: 801, requestedAt: age(7201) },
        route: "#/mint",
      });
      const feed = page.locator(".swarm-request").first();
      await feed.getByText(STALE, { exact: true }).waitFor();
    },
  );
  await run("2 one 7,199 s old does not", async () => {
    await setup({
      pending: { id: 801, requestedAt: age(7199) },
      route: "#/mint",
    });
    const feed = page.locator(".swarm-request").first();
    await feed
      .getByText("Waiting for the swarm to pick up the request…")
      .waitFor();
    await page.waitForTimeout(800);
    assert.equal(await feed.getByText(STALE).count(), 0);
  });

  await run(
    "4 every history read answering: no row shows Check older blocks or No request found since launch.",
    async () => {
      await setup({ pending: { id: 801, requestedAt: age(600) } });
      await page
        .locator("#pick-901")
        .getByRole("button", { name: /Mint this fact/ })
        .waitFor();
      await page.waitForTimeout(800);
      assert.equal(await rows().getByText("Check older blocks").count(), 0);
      assert.equal(
        await rows().getByText("No request found since launch.").count(),
        0,
      );
    },
  );
  await run(
    "4 a failed row read uses Retry reads; no older-block row control remains",
    async () => {
      await setup({ failHistory: true });
      await page.locator("#pick-901 button").waitFor();
      await page.waitForTimeout(300);
      assert.equal(await rows().getByText("Check older blocks").count(), 0);
      control.failHistory = false;
      const before = control.logs.length;
      await page
        .getByRole("button", { name: "Retry reads", exact: true })
        .click();
      await page.waitForTimeout(400);
      assert.ok(control.logs.length > before);
    },
  );
  await run(
    "4 an open request older than 24 hours reads back to launch automatically",
    async () => {
      await setup({
        pending: { id: 801, requestedAt: age(90000) },
        head: 26260000n,
      });
      await page.waitForFunction(() =>
        document.querySelector(".swarm-request"),
      );
      await page.waitForTimeout(500);
      assert.equal(
        await page.getByText("Check older blocks", { exact: true }).count(),
        0,
      );
      assert.ok(
        control.logs.some(
          (f) =>
            f.address.toLowerCase() === registry &&
            BigInt(f.fromBlock) === LAUNCH,
        ),
      );
    },
  );

  await run(
    "5 Mint this fact on 901 opens the dialog for 901 alone with its eligibility line, price and Request anyway; other selections stay",
    async () => {
      await setup({
        pending: { id: 801, requestedAt: age(600) },
        prepare: (f) => {
          f.state.proven = [701];
        },
      });
      await page.locator("#step-02 .eligibility-toggle").click();
      const r1001 = page.locator("#pick-1001");
      await r1001.getByRole("button", { name: /Mint this fact/ }).waitFor();
      await r1001.locator("input").check();
      for (const id of [701, 801])
        assert.equal(
          await page
            .locator(`#pick-${id}`)
            .getByRole("button", { name: /Mint this fact/ })
            .count(),
          0,
          `no button on ${id === 701 ? "proven" : "pending"} row`,
        );
      await page
        .locator("#pick-901")
        .getByRole("button", { name: /Mint this fact/ })
        .click();
      const dialog = page.locator(".payment-dialog");
      await dialog.getByText(/This wallet does not meet this rule/).waitFor();
      await dialog
        .getByText(/1\.25 IMD/)
        .first()
        .waitFor();
      await dialog
        .getByRole("button", { name: "Request anyway", exact: true })
        .waitFor();
      const text = await dialog.innerText();
      assert.match(text, /901 \/ Final Token/);
      assert.doesNotMatch(text, /1001 \/ Hotfix/);
      assert.equal(await r1001.locator("input").isChecked(), true);
      assert.equal(await page.locator("#pick-901 input").isChecked(), false);
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await page.screenshot({
        path: new URL("mint-this-fact-dialog.png", output).pathname,
      });
    },
  );

  await run(
    "6 row order text, card preview, buttons: one line at 1280, same order and no overflow at 390; community rows text then buttons",
    async () => {
      await setup({});
      await page
        .locator("#pick-901")
        .getByRole("button", { name: /Mint this fact/ })
        .waitFor();
      await page
        .locator("#pick-10001")
        .getByRole("button", { name: /Mint this fact/ })
        .waitFor();
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(150);
        const boxes = await rows().evaluateAll((list) =>
          list.map((row) => {
            const box = (el) => el && el.getBoundingClientRect().toJSON();
            return {
              id: row.id,
              order: [...row.children].map(
                (c) => c.tagName + "." + c.className,
              ),
              text: box(
                row.querySelector(":scope > label, :scope > .picker-text"),
              ),
              card: box(row.querySelector(":scope > .mini-card")),
              actions: box(row.querySelector(":scope > .row-actions")),
            };
          }),
        );
        for (const b of boxes) {
          if (!b.actions) continue;
          const parts = b.card
            ? ["text", "card", "actions"]
            : ["text", "actions"];
          assert.deepEqual(
            b.order.map((o) =>
              o.startsWith("LABEL") || o.includes("picker-text")
                ? "text"
                : o.includes("mini-card")
                  ? "card"
                  : "actions",
            ),
            parts,
            b.id,
          );
          if (width === 1280) {
            const mid = (x) => x.top + x.height / 2;
            for (const p of parts.slice(1)) {
              assert.ok(
                b[p].left >= b.text.right - 1,
                `${b.id} ${p} right of text`,
              );
              assert.ok(
                b[p].top < mid(b.text) && b[p].bottom > b.text.top,
                `${b.id} ${p} on the text's line`,
              );
            }
            if (b.card)
              assert.ok(
                b.actions.left >= b.card.right - 1,
                `${b.id} buttons after card`,
              );
          } else {
            if (b.card)
              assert.ok(
                b.card.left >= b.text.right - 1 ||
                  b.card.top >= b.text.bottom - 1,
              );
            const prev = b.card || b.text;
            assert.ok(
              b.actions.top >= prev.top,
              `${b.id} buttons after the preview`,
            );
          }
        }
        const actual = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        assert.ok(actual <= width, `overflow ${actual} at ${width}`);
        evidence.widths.push({ name: "rows", width, actual });
        await page.locator("#pick-901").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: new URL(`rows-${width}.png`, output).pathname,
        });
      }
    },
  );

  await run(
    "7 Mint retains progress and Check swarm; Wallet follows the same pending request",
    async () => {
      await setup({ pending: { id: 801, requestedAt: age(600) } });
      const nav = await page
        .locator('nav[aria-label="Main navigation"] a')
        .allInnerTexts();
      assert.equal(nav[nav.indexOf("Mint") + 1], "Wallet");
      assert.equal(
        await page.getByText("Swarm progress: Wallet Facts").count(),
        0,
      );
      const section = page.locator('section[aria-label="Swarm progress"]');
      await section
        .getByText(
          "Live panel progress, not proof. Facts and card updates come from the Registry.",
        )
        .waitFor();
      await section
        .locator(".swarm-request")
        .getByText("801 / Holdout")
        .waitFor();
      await page
        .locator(".settlement")
        .filter({ hasText: requestId })
        .getByRole("button", { name: "Check swarm", exact: true })
        .waitFor();
      await noOverflow("mint-open");
      await page.getByRole("link", { name: "Wallet", exact: true }).click();
      await page.getByRole("heading", { name: "Wallet", level: 1 }).waitFor();
      await page.locator(".swarm-feed .swarm-request").waitFor();
      assert.equal(await page.locator(".swarm-feed .swarm-request").count(), 1);
      await page.getByRole("heading", { name: "Claimed facts" }).waitFor();
      await noOverflow("wallet-open");
    },
  );
  await run("7 without a wallet, and with no open request", async () => {
    await setup({ route: "#/wallet-facts", connect: false });
    await page
      .getByText("Connect a wallet to see its facts.", { exact: true })
      .waitFor();
    await noOverflow("wallet-disconnected");
    await setup({ route: "#/mint" });
    await page
      .locator("#pick-901")
      .getByRole("button", { name: /Mint this fact/ })
      .waitFor();
    assert.equal(await page.locator(".swarm-feed").count(), 0);
    await page.goto(preview.url + "#/wallet");
    await page.getByRole("heading", { name: "Claimed facts" }).waitFor();
    assert.equal(await page.locator(".swarm-feed").count(), 0);
  });
  await run(
    "7 history: direct at the mint block's date, panel-sworn catalog fact and community fact with request link, evidence window and attested time; no eth_getLogs older than 7,200 blocks",
    async () => {
      const attestedAt = "2026-10-20T08:15:00.000Z";
      await setup({
        route: "#/wallet-facts",
        records: [
          { id: oracleId, jobId: "job-801", attestedAt, status: "attested" },
        ],
        prepare: (f) => {
          f.state.proven = [801];
          f.state.verifiedSpecs = [10001];
          f.state.mintedAtBlock = 26245000n;
          f.state.verifiedRecords = {
            801: ["0x" + "a2".repeat(32), oracleBytes, 25769870n, 25789604n],
            10001: ["0x" + "a3".repeat(32), oracleBytes, 25769870n, 25789604n],
          };
        },
      });
      const list = page.locator(".fact-history");
      await page
        .locator(".direct-note")
        .getByText(
          /Direct · frozen at the card's mint, block 26,245,000 · 2026-10-21 \d\d:\d\d UTC/,
        )
        .waitFor();
      assert.equal(await page.locator(".direct-note").count(), 1);
      assert.doesNotMatch(
        await list.locator("#held-101").innerText(),
        /Direct ·/,
      );
      for (const id of [801, 10001]) {
        const row = list.locator(`#held-${id}`);
        await row.getByText("Panel-sworn", { exact: true }).waitFor();
        await row
          .getByText("Evidence window: blocks 25,769,870 → 25,789,604")
          .waitFor();
        const a = row.getByRole("link", { name: oracleId });
        assert.equal(
          await a.getAttribute("href"),
          "https://explorer.imd.fun/jobs/job-801",
        );
        await row.getByText("Attested: 2026-10-20 08:15 UTC").waitFor();
      }
      await list
        .locator("#held-10001")
        .getByText("10001 / Community Holdout")
        .waitFor();
      assert.equal(await page.getByText("Check older blocks").count(), 0);
      const head = 26250000n;
      for (const f of control.logs)
        assert.ok(
          BigInt(f.fromBlock) >= head - 7199n,
          `getLogs from ${BigInt(f.fromBlock)}`,
        );
      await noOverflow("wallet-facts-history");
    },
  );
  assert.deepEqual(evidence.errors, []);
} catch (error) {
  evidence.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
  if (page) {
    evidence.body = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    await page
      .screenshot({ path: new URL("failure.png", output).pathname })
      .catch(() => {});
  }
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2),
  );
  await context?.close();
  await browser?.close();
  await preview.close();
}
