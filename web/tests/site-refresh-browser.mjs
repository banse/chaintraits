// This assignment's production-export checks. Synthetic EIP-1193/RPC/API only.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { zeroAddress } from "viem";
import { fakeChain, fakeWallet, mockPage, wallet } from "./fake-chain.mjs";
import { server } from "./harness.mjs";
const preview = await server();
const output = new URL("../../test/scratch/site-refresh/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const evidence = {
  checks: [],
  widths: [],
  errors: [],
  startupRequests: [],
  limits: ["Synthetic wallet, API and RPC only; no signing or sending."],
};
const uuid = "23474d49-bf7c-40e0-8dad-41636c73ea84";
const bytes = "0x" + uuid.replaceAll("-", "") + "00".repeat(16);
const rid = "0x" + "a1".repeat(32),
  questionHash = "0x" + "b1".repeat(32);
const proof = [rid, bytes, 25769870n, 25789604n];
const image =
  "data:image/svg+xml;base64," +
  fs
    .readFileSync(new URL("../../dist/art/full-house.svg", import.meta.url))
    .toString("base64");
const uri =
  "data:application/json;base64," +
  Buffer.from(
    JSON.stringify({ name: "Synthetic card fixture", image }),
  ).toString("base64");
let browser, context, page, fixture;
async function run(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup({
  route = "#/mint",
  options = {},
  connected = true,
  init,
  delay = false,
} = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context);
  // Trigger scheduled checks explicitly; no five-second test sleeps.
  await context.addInitScript(() => {
    const interval = window.setInterval.bind(window),
      clear = window.clearInterval.bind(window),
      polls = new Map();
    let id = -1;
    window.setInterval = (fn, ms, ...args) => {
      if (![5000, 45000].includes(ms)) return interval(fn, ms, ...args);
      const n = id--;
      polls.set(n, { ms, fn: () => fn(...args) });
      return n;
    };
    window.clearInterval = (n) => {
      polls.delete(n);
      clear(n);
    };
    window.__poll = (ms) =>
      Promise.all(
        [...polls.values()].filter((p) => p.ms === ms).map((p) => p.fn()),
      );
  });
  if (init) await context.addInitScript(init);
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.url().startsWith(preview.url) && r.status() >= 400)
      evidence.errors.push(`Local ${r.status()}: ${r.url()}`);
  });
  fixture = fakeChain({ allowance: 10n ** 22n, uri, ...options });
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", async (r) => {
    const u = new URL(r.request().url());
    const id = u.pathname.match(/\/oracle\/requests\/([^/]+)$/)?.[1];
    const body = id
      ? {
          id,
          jobId: "synthetic-progress",
          attestedAt: "2026-10-20T08:15:00.000Z",
          question: `Fact about ${wallet}`,
          panelSize: 5,
          quorum: 3,
          status: "attested",
          seats: [],
        }
      : u.pathname === "/oracle/requests"
        ? { requests: [] }
        : { entries: [] };
    await r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  if (delay)
    await page.route(
      /\/(imd-deployment\.json|abi\/[^/]+\.json|data\/renderer-preview\.json)$/,
      async (r) => {
        evidence.startupRequests.push(r.request().url());
        await new Promise((done) => setTimeout(done, 400));
        await r.continue();
      },
    );
  await page.goto(preview.url + route);
  await page.getByRole("heading", { level: 1 }).waitFor();
  if (connected) {
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
  }
  await page.getByText(/Dependencies verified/).waitFor();
}
async function widths(name, shot = false) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (name === "footer")
      await page.locator(".footer-bottom").scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(scroll <= width, `${name}: ${scroll}/${width}`);
    const bad = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      const bad = [];
      while (walker.nextNode()) {
        const p = walker.currentNode.parentElement;
        if (p?.closest("code,script,style") || !p?.checkVisibility()) continue;
        const t = walker.currentNode.textContent;
        if (/\btraits?\b/i.test(t) || /hasTrait|TraitRequested/.test(t))
          bad.push(t);
      }
      return bad;
    });
    assert.deepEqual(bad, [], name + " fact-only visible prose");
    const padding = await page
      .locator(".catalog-row,.picker-row,.fact-row,.fact-history li")
      .evaluateAll((es) =>
        es
          .filter((e) => e.checkVisibility())
          .map((e) => [
            getComputedStyle(e).paddingTop,
            getComputedStyle(e).paddingBottom,
          ]),
      );
    assert.ok(
      padding.every((v) => v.every((p) => parseFloat(p) <= 8)),
      name + " row padding",
    );
    const footer = await page.locator(".footer-bottom").boundingBox();
    const rpc = await page
      .locator(".footer-bottom .rpc-controls")
      .boundingBox();
    assert.ok(
      Math.abs(footer.x + footer.width - rpc.x - rpc.width) < 1,
      name + " footer RPC right edge",
    );
    evidence.widths.push({ name, width, scroll });
    if (shot)
      await page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
      });
  }
}
try {
  browser = await (
    process.argv.includes("--webkit") ? webkit : chromium
  ).launch();
  await run(
    "1 bundled startup renders shell and home action without seven delayed host reads",
    async () => {
      await setup({ route: "#/", connected: false, delay: true });
      await page.locator(".site-header").waitFor();
      assert.equal(
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .isVisible(),
        true,
      );
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        "Facts about wallets, onchain and sworn by the swarm.",
      );
      assert.deepEqual(evidence.startupRequests, []);
      await page.setViewportSize({ width: 390, height: 844 });
      const box = await page
        .getByRole("button", { name: "Explore wallet" })
        .boundingBox();
      assert.ok(box.y + box.height <= 844);
      await page.screenshot({ path: new URL("home-390.png", output).pathname });
    },
  );
  await run(
    "2 and 5 every route uses fact prose, compact rows and footer-bottom RPC controls",
    async () => {
      await setup({ connected: false });
      for (const route of [
        "#/",
        "#/catalog",
        "#/mint",
        "#/wallet",
        "#/integrate",
        "#/about",
        "#/claim",
        "#/wallet-facts",
        "#/explorer",
      ]) {
        await page.goto(preview.url + route);
        await page.getByRole("heading", { level: 1 }).waitFor();
        await widths(route.replace(/\W/g, ""));
        assert.equal(
          await page.locator(".footer-bottom .rpc-controls").count(),
          1,
        );
        const align = await page
          .locator(".rpc-controls")
          .evaluate((e) => getComputedStyle(e).justifyContent);
        assert.equal(align, "flex-end");
        const padding = await page
          .locator(".catalog-row,.picker-row,.fact-row,.fact-history li")
          .evaluateAll((es) =>
            es
              .filter((e) => e.checkVisibility())
              .map((e) => [
                getComputedStyle(e).paddingTop,
                getComputedStyle(e).paddingBottom,
              ]),
          );
        assert.ok(
          padding.every((v) => v.every((p) => parseFloat(p) <= 8)),
          JSON.stringify(padding),
        );
      }
    },
  );
  await run(
    "5 footer controls stay on the bottom row and align right at desktop and phone widths",
    async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator(".footer-bottom").scrollIntoViewIfNeeded();
      await widths("footer", true);
      assert.equal(
        await page
          .locator(".footer-bottom > :last-child")
          .getAttribute("class"),
        "rpc-controls",
      );
    },
  );
  await run(
    "2b metadata preview uses fact wording while the download preserves every original byte and integer",
    async () => {
      const raw = `{"name":"Synthetic card","description":"Every trait is a fact; traits use hasTrait.","image":${JSON.stringify(image)},"traits":[101],"exact":9007199254740993123456789}`;
      await setup({
        route: `#/explorer?address=${wallet}`,
        connected: false,
        options: {
          uri:
            "data:application/json;base64," +
            Buffer.from(raw).toString("base64"),
        },
      });
      await page.getByText("Wallet facts loaded.", { exact: true }).waitFor();
      await page
        .getByText("Lossless raw tokenURI metadata", { exact: true })
        .click();
      const details = page.locator("#explorer details").filter({
        has: page.getByText("Lossless raw tokenURI metadata", {
          exact: true,
        }),
      });
      const shown = await details.locator("pre").innerText();
      assert.doesNotMatch(shown, /\btraits?\b/i);
      assert.ok(shown.includes('"facts":[101]'));
      assert.ok(shown.includes("9007199254740993123456789"));
      assert.ok(shown.includes("hasTrait"));
      const href = await details
        .getByRole("link", { name: "Download exact metadata", exact: true })
        .getAttribute("href");
      assert.equal(decodeURIComponent(href.split(",")[1]), raw);
      await widths("metadata");
    },
  );
  await run(
    "3 Mint and Explorer hide impossible facts, toggle counts, unknown facts stay; Catalog retains every fact",
    async () => {
      await setup({ options: { joined: false, traits: [] } });
      assert.equal(
        await page.locator("#step-01 .eligibility-toggle").count(),
        0,
      );
      assert.equal(
        await page.locator("#step-01 .direct-summary > span").count(),
        0,
      );
      const toggle = page.locator("#step-02 .eligibility-toggle");
      await toggle.filter({ hasText: "10 hidden" }).waitFor();
      for (const id of [
        701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201,
      ])
        assert.equal(await page.locator(`#pick-${id}`).isVisible(), false);
      assert.equal(await page.locator("#pick-601").isVisible(), true);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "true");
      assert.match(await toggle.innerText(), /10 shown/);
      assert.equal(await page.locator("#pick-701").isVisible(), true);
      await toggle.click();
      await page.goto(preview.url + `#/explorer?address=${wallet}`);
      await page.getByText("Wallet facts loaded.", { exact: true }).waitFor();
      const et = page.locator("#wallet-facts .eligibility-toggle");
      await et.filter({ hasText: "23 hidden" }).waitFor();
      assert.equal(await page.locator("#trait-701").isVisible(), false);
      await et.click();
      assert.equal(await page.locator("#trait-701").isVisible(), true);
      assert.equal(await page.locator("#wallet-facts .fact-row").count(), 25);
      assert.equal(
        await page.locator(".catalog-table .catalog-row").count(),
        25,
      );
      await widths("ineligible", true);
    },
  );
  await run(
    "3b an existing negative eligibility check hides its row and the table control restores it",
    async () => {
      await setup();
      await page.locator("#pick-701 input").click();
      await page
        .locator("#step-02 .eligibility-toggle")
        .filter({ hasText: "1 hidden" })
        .waitFor();
      assert.equal(await page.locator("#pick-701").isVisible(), false);
      await page.locator("#step-02 .eligibility-toggle").click();
      await page.locator("#pick-701").waitFor();
      await page
        .locator("#pick-701 .eligibility-advice")
        .filter({ hasText: "does not meet this rule" })
        .waitFor();
      assert.equal(await page.locator("#pick-601").isVisible(), true);
    },
  );
  await run(
    "4 held requested facts show UTC attestation and direct facts show mint block and UTC time",
    async () => {
      await setup({
        options: {
          token: 7n,
          mintedAtBlock: 26242890n,
          proven: [801, 1201],
          verifiedRecords: { 801: proof, 1201: proof },
        },
      });
      const row = page.locator("#pick-801 .row-actions");
      await row.getByText("Minted", { exact: true }).waitFor();
      await row.getByText("2026-10-20 08:15:00 UTC", { exact: true }).waitFor();
      assert.equal(
        await row.getByRole("button", { name: /Mint this fact/ }).count(),
        0,
      );
      await page.locator("#pick-1201 .minted-fact time").waitFor();
      await page.goto(preview.url + `#/explorer?address=${wallet}`);
      await page.getByText("Wallet facts loaded.", { exact: true }).waitFor();
      await page.locator("#trait-801 .minted-fact time").waitFor();
      assert.match(
        await page.locator("#trait-101 .minted-fact").innerText(),
        /Minted\nBlock 26,242,890\n.* UTC/,
      );
      await widths("minted", true);
    },
  );
  await run(
    "6 Explorer is immediately after Catalog intro; aliases and home form load the wallet and fact",
    async () => {
      await setup({
        route: `#/explorer?address=${wallet}&trait=101`,
        connected: false,
      });
      await page.getByText("Wallet facts loaded.", { exact: true }).waitFor();
      assert.equal(await page.title(), "Sworn | Catalog");
      assert.equal(
        await page.locator("main > h1 + p.prose + #explorer").count(),
        1,
      );
      assert.match(
        await page.locator("#trait-101").getAttribute("class"),
        /highlight/,
      );
      await page.goto(preview.url + "#/mint");
      assert.equal(await page.locator("#explorer").count(), 0);
      await page.goto(preview.url + "#/");
      await page.getByLabel("Explore a wallet", { exact: true }).fill(wallet);
      await page.getByRole("button", { name: "Explore wallet" }).click();
      await page.getByText("Wallet facts loaded.", { exact: true }).waitFor();
      assert.equal(await page.title(), "Sworn | Catalog");
      assert.equal(
        await page.getByLabel("Explore a wallet", { exact: true }).inputValue(),
        wallet,
      );
    },
  );
  await run(
    "7 and 8 compact table rows and correct Step 02 payment and explanation order",
    async () => {
      await setup();
      assert.equal(
        await page.locator("#step-02 > p + fieldset.payment").count(),
        1,
      );
      assert.match(
        await page
          .locator("#step-02 > fieldset.payment")
          .evaluate((e) => e.previousElementSibling.textContent),
        /^\s*Chain-proven facts use 5 agents \/ quorum 3/,
      );
      assert.equal(
        await page
          .locator("#mint-facts > h2 + p + .why-facts")
          .getByRole("heading", {
            name: "Why add facts after minting?",
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(
        await page.locator("#mint-facts > .why-facts .flow a").count(),
        4,
      );
      assert.equal(
        await page.getByRole("radio", { name: "IMD", exact: true }).isChecked(),
        true,
      );
      await page.getByRole("radio", { name: "ETH", exact: true }).check();
      assert.equal(
        await page.getByRole("radio", { name: "ETH", exact: true }).isChecked(),
        true,
      );
      await widths("mint-order", true);
    },
  );
  await run(
    "9 transaction result has progress link, no oracle feed or live mint card; Wallet follows pending and delivery",
    async () => {
      const saved = {
        plan: {
          title: "Synthetic saved request",
          from: "step-02",
          calls: [],
          price: { bigint: "1" },
          amount: { bigint: "1" },
          balance: { bigint: "1" },
          account: wallet,
          payment: "IMD",
          lines: [],
        },
        steps: [
          {
            label: "Synthetic confirmed request",
            state: "confirmed",
            hash: "0x" + "66".repeat(32),
            result: {
              facts: [{ id: 801, name: "Last Stand", requestId: rid }],
            },
          },
        ],
      };
      await setup({
        options: {
          token: 7n,
          mintedAtBlock: 26242890n,
          pending: [
            { id: 801, requestId: rid, questionHash, requestedAt: 1792600000n },
          ],
        },
      });
      await page.evaluate(
        (saved) =>
          localStorage.setItem(
            "sworn.transaction-journal",
            JSON.stringify(saved),
          ),
        saved,
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Review transaction steps" })
        .click();
      const d = page.locator(".payment-dialog");
      assert.equal(await d.locator(".swarm-panel,.card-figure").count(), 0);
      await d.getByText("Progress continues on the Wallet page.").waitFor();
      await d
        .getByRole("button", { name: "Follow progress on the Wallet page" })
        .click();
      await page.getByRole("heading", { level: 1, name: "Wallet" }).waitFor();
      await page.locator(".swarm-feed").waitFor();
      await page.locator(".wallet-card img").waitFor();
      assert.equal(await page.locator(".swarm-feed details").count(), 1);
      fixture.state.pending[0].cleared = true;
      fixture.state.proven.push(801);
      fixture.state.verifiedRecords = { 801: proof };
      await page.evaluate(() => window.__poll(5000));
      await page.locator("#held-801").waitFor();
      await page.waitForFunction(() => !document.querySelector(".swarm-feed"));
      assert.equal((await page.evaluate(() => window.__signing)).length, 0);
      await widths("wallet-delivered", true);
    },
  );
  await run(
    "9b Wallet follows the connected requester’s shared receipt, checks Registry state and removes completed progress",
    async () => {
      await setup({
        options: {
          token: 7n,
          pending: [
            {
              id: 1201,
              claimant: zeroAddress,
              requestId: rid,
              questionHash,
              requestedAt: 1792600000n,
            },
          ],
        },
      });
      const saved = {
        plan: {
          account: wallet,
          title: "Synthetic shared request",
          from: "step-02",
          calls: [],
          price: { bigint: "1" },
          amount: { bigint: "1" },
          balance: { bigint: "1" },
          payment: "IMD",
          lines: [],
        },
        steps: [
          {
            label: "Synthetic confirmed shared request",
            state: "confirmed",
            hash: "0x" + "66".repeat(32),
            result: {
              facts: [{ id: 1201, name: "Top Weights", requestId: rid }],
            },
          },
        ],
      };
      await page.evaluate(
        (saved) =>
          localStorage.setItem(
            "sworn.transaction-journal",
            JSON.stringify(saved),
          ),
        saved,
      );
      await page.goto(preview.url + "#/wallet");
      await page.locator(".swarm-feed .swarm-request").waitFor();
      assert.equal(await page.locator(".swarm-feed .swarm-request").count(), 1);
      fixture.state.pending[0].cleared = true;
      await page.evaluate(() => window.__poll(5000));
      await page.waitForFunction(() => !document.querySelector(".swarm-feed"));
      assert.equal((await page.evaluate(() => window.__signing)).length, 0);
    },
  );
  await run(
    "10 and 11 authentic card right at desktop and above phone facts; family toggles every held tier and empty cells do nothing",
    async () => {
      await setup({
        route: "#/wallet",
        options: {
          token: 7n,
          mintedAtBlock: 26242890n,
          traits: [101, 201, 202, 301, 302, 303, 1101, 1105],
          proven: [1101, 1105],
          verifiedRecords: { 1101: proof, 1105: proof },
        },
      });
      await page.locator("#held-1105").waitFor();
      for (const width of [1280, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        const facts = await page.locator(".wallet-facts").boundingBox(),
          card = await page.locator(".wallet-card").boundingBox();
        assert.ok(
          width === 1280
            ? card.x >= facts.x + facts.width
            : card.y + card.height <= facts.y,
          JSON.stringify({ width, facts, card }),
        );
        const pid = page.getByRole("button", {
          name: "Inspect PID cell",
          exact: true,
        });
        await pid.click();
        assert.deepEqual(
          await page
            .locator(".fact-history li.highlight")
            .evaluateAll((es) => es.map((e) => e.id)),
          ["held-1101", "held-1105"],
        );
        assert.equal(await pid.getAttribute("aria-pressed"), "true");
        await pid.click();
        assert.equal(
          await page.locator(".fact-history li.highlight").count(),
          0,
        );
        await page.getByRole("button", { name: /Inspect Hopper/ }).click();
        assert.deepEqual(
          await page
            .locator(".fact-history li.highlight")
            .evaluateAll((es) => es.map((e) => e.id)),
          ["held-301", "held-302", "held-303"],
        );
        await page.getByRole("button", { name: /Inspect Zero-Shot/ }).click();
        assert.deepEqual(
          await page
            .locator(".fact-history li.highlight")
            .evaluateAll((es) => es.map((e) => e.id)),
          ["held-201", "held-202"],
        );
        assert.equal(
          await page
            .getByRole("button", { name: "Inspect Swarmed cell", exact: true })
            .count(),
          0,
        );
        await page.locator(".wallet-card .card-image").evaluate((el) => {
          const b = el.getBoundingClientRect();
          document
            .elementFromPoint(b.x + b.width * 0.5, b.y + b.height * 0.48)
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        assert.equal(
          await page.locator(".fact-history li.highlight").count(),
          2,
        );
        await page.keyboard.press("Tab");
        await page.keyboard.press("Space");
        await page.screenshot({
          path: new URL(`wallet-card-${width}.png`, output).pathname,
        });
      }
      await widths("wallet-card");
      assert.equal(
        await page.locator(".wallet-card img").getAttribute("src"),
        image,
      );
    },
  );
  await run(
    "11 community rings and a catalog fill in the same cell highlight together without moving the facts",
    async () => {
      const ids = Array.from({ length: 40 }, (_, i) => 10001 + i);
      await setup({
        route: "#/wallet",
        options: {
          token: 7n,
          proven: [601],
          verifiedSpecs: ids,
          nextSpecId: 10041,
          verifiedRecords: Object.fromEntries(
            [601, ...ids].map((id) => [id, proof]),
          ),
        },
      });
      await page.locator("#held-10040").waitFor();
      await page
        .getByRole("button", { name: "Inspect Swarmed cell", exact: true })
        .click();
      assert.deepEqual(
        await page
          .locator(".fact-history li.highlight")
          .evaluateAll((es) => es.map((e) => e.id)),
        ["held-601", "held-10001", "held-10014", "held-10027"],
      );
      // The fortieth community fact advances the frame, outside the family cells.
      assert.equal(await page.locator("#held-10040").getAttribute("class"), "");
      const before = await page.locator("#held-601").boundingBox();
      await page
        .getByRole("button", { name: "Inspect Swarmed cell", exact: true })
        .click();
      const after = await page.locator("#held-601").boundingBox();
      assert.deepEqual(before, after);
      await widths("community-family");
    },
  );
  await run(
    "10 without a minted card Wallet retains its detailed list",
    async () => {
      await setup({ route: "#/wallet" });
      await page.locator("#held-101").waitFor();
      assert.equal(await page.locator(".wallet-card").count(), 0);
      await page
        .getByText("Direct · read live; no card minted", { exact: true })
        .waitFor();
      await widths("wallet-no-card");
    },
  );
  assert.deepEqual(evidence.errors, []);
  console.log(
    JSON.stringify({ passed: evidence.checks.length, errors: evidence.errors }),
  );
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await context?.close();
  await browser?.close();
  await preview.close();
}
