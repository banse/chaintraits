// This assignment's ten items against the production export. All network and
// wallet replies are synthetic. No signing, send, real RPC or live API calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit, expect } from "@playwright/test";
import { encodeFunctionData, parseAbi } from "viem";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  rpcCalls,
  sharedSpec,
  wallet,
} from "./fake-chain.mjs";
import { emptySeparators } from "./separators.mjs";
import { server } from "./harness.mjs";

const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const group = process.argv.find((a) => a.startsWith("--group="))?.split("=")[1];
let index = 0;
const output = new URL(
  `../../test/scratch/wallet-mint-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const evidence = { engine, checks: [], geometry: [], errors: [] };
const normal = (s) => s.replace(/\s+/g, " ").trim();
const nonceSpec = {
  ...sharedSpec,
  kind: 5,
  threshold: 20n,
  fromBlock: 25769870n,
  toBlock: 25769870n,
  name: "Pretrained",
};
const communitySpec = {
  ...sharedSpec,
  kind: 4,
  item: "function balanceOf(address) view returns (uint256)",
  op: 1,
  threshold: 1n,
  name: "Community balance",
};
const rule = "Account nonce ≥ 20 at launch of WhitelistCurator";
const hint =
  "Select a non-empty hive cell to highlight its claimed facts. Select it again to clear.";
const mintedLine =
  "Your Sworn card #7 is minted. It is on the Wallet page with every fact it holds.";
const fee =
  "The fee is forwarded to the BurnExecutor for bridging and burning on Base.";
const routes = [
  "#/",
  "#/catalog",
  "#/mint",
  "#/wallet",
  "#/integrate",
  "#/about",
];
const deployment = JSON.parse(
  fs.readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
);
const registry = deployment.contracts.find(
  (c) => c.name === "Registry",
).address;
const image =
  "data:image/svg+xml;base64," +
  fs
    .readFileSync(new URL("../../dist/art/full-house.svg", import.meta.url))
    .toString("base64");
const uri =
  "data:application/json;base64," +
  Buffer.from(JSON.stringify({ name: "Synthetic test card", image })).toString(
    "base64",
  );
const held = {
  token: 7n,
  traits: [101, 201, 202, 301, 601, 701, 1201, 1301],
  verifiedSpecs: [10001, 10002, 10003],
  nextSpecId: 10004,
  specs: {
    1301: nonceSpec,
    10001: communitySpec,
    10002: { ...communitySpec, kind: 3, name: "Community ranking" },
    10003: { ...nonceSpec, name: "Community nonce" },
  },
};
const pending = [
  {
    id: 601,
    requestId: "0x" + "a1".repeat(32),
    questionHash: "0x" + "b1".repeat(32),
    requestedAt: 1792600000n,
  },
];
const request = {
  id: "current-wallet-mint",
  createdAt: new Date(Number(pending[0].requestedAt) * 1000).toISOString(),
  consumer: { verifyingContract: registry, chainId: 1 },
  questionHash: pending[0].questionHash,
  question: `Did wallet ${wallet} meet the rule?`,
  answerType: "bool",
  status: "assessing",
  panelSize: 11,
  quorum: 7,
  members: [
    { tokenId: "110", ok: true, answer: { answer: true } },
    { tokenId: "111", ok: true, answer: { answer: false } },
    { tokenId: "112", ok: false, reason: "Synthetic failed check" },
  ],
  agreement: null,
};
let browser, context, page, fixture;
async function run(name, fn) {
  index++;
  if (group && index !== Number(group)) return;
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup({
  route = "#/mint",
  connected = true,
  options = {},
  configure,
  record,
  deadline = false,
} = {}) {
  if (page && !page.isClosed())
    assert.deepEqual(await page.evaluate(() => window.__signing), []);
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context);
  if (deadline)
    await context.addInitScript(() => {
      const timeout = window.setTimeout.bind(window);
      window.__checkDeadlines = 0;
      window.setTimeout = (fn, delay, ...args) =>
        timeout(
          () => {
            if (delay === 20000) window.__checkDeadlines++;
            fn(...args);
          },
          delay === 20000 ? 200 : delay,
        );
    });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.url().startsWith(preview.url) && r.status() >= 400)
      evidence.errors.push(`Local ${r.status()}: ${r.url()}`);
  });
  fixture = fakeChain({
    allowance: 10n ** 22n,
    uri,
    specs: { 1301: nonceSpec },
    ...options,
  });
  const answer = fixture.answer;
  fixture.answer = (p) => {
    if (p.method === "eth_getTransactionCount") {
      fixture.state.calls.push(p);
      return "0x5";
    }
    return answer(p);
  };
  configure?.(fixture);
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", (r) => {
    const u = new URL(r.request().url());
    assert.equal(r.request().method(), "GET");
    const body = u.pathname.startsWith("/intake/")
      ? { entries: [] }
      : u.pathname === "/oracle/requests"
        ? { requests: record ? [record] : [] }
        : record || { requests: [] };
    return r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(preview.url + route);
  await page.getByText(/Dependencies verified/).waitFor();
  if (connected) {
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
    await page.getByRole("button", { name: /Disconnect/ }).waitFor();
  }
}
async function geometry(label, widths = [1280, 390, 320]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(scroll <= width, `${label} at ${width}: overflow ${scroll}`);
    const empty = await page.evaluate(emptySeparators);
    assert.deepEqual(empty, [], `${label} at ${width}: empty separator pair`);
    evidence.geometry.push({ label, width, scroll, empty });
  }
}
const box = (selector) => page.locator(selector).boundingBox();
const near = (a, b, name) =>
  assert.ok(Math.abs(a - b) < 1, `${name}: ${a} vs ${b}`);
async function shot(name, fullPage = false) {
  await page.screenshot({
    path: new URL(name + ".png", output).pathname,
    fullPage,
  });
}
try {
  browser = await { chromium, webkit }[engine].launch();
  await run(
    "1 Wallet card: Mint-style title/claimant/status, responsive order, hint only, pointer/keyboard family toggles",
    async () => {
      await setup({ route: "#/wallet", options: held });
      await page.locator("#held-10003").waitFor();
      await expect(page.locator("#wallet-card-title")).toHaveText(
        "Your Sworn card #7",
      );
      await expect(page.locator(".claim-copy .accent")).toHaveText(
        `Card #7 · Original claimant: ${wallet}`,
      );
      await expect(page.locator(".claim-copy .status")).toHaveText(
        "already minted",
      );
      await expect(page.locator(".wallet-card > p")).toHaveText(hint);
      assert.equal(
        await page
          .locator(".wallet-card figcaption,.wallet-card .status")
          .count(),
        0,
      );
      assert.equal(
        await page.locator(".wallet-card img").getAttribute("src"),
        image,
      );
      for (const width of [1280, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        const intro = await box("main > p.prose"),
          block = await box(".wallet-record > .mint-panel"),
          copy = await box(".claim-copy"),
          card = await box(".wallet-card"),
          facts = await box(".wallet-facts");
        assert.ok(block.y >= intro.y + intro.height);
        assert.ok(facts.y >= block.y + block.height);
        assert.ok(
          width === 1280
            ? card.x >= copy.x + copy.width
            : card.y >= copy.y + copy.height,
        );
        const cell = page.getByRole("button", {
          name: "Inspect Swarmed cell",
          exact: true,
        });
        await cell.click();
        await expect(cell).toHaveAttribute("aria-pressed", "true");
        assert.deepEqual(
          await page
            .locator(".fact-history li.highlight")
            .evaluateAll((es) => es.map((e) => e.id)),
          ["held-601", "held-10001"],
        );
        await cell.click();
        await expect(cell).toHaveAttribute("aria-pressed", "false");
        assert.equal(
          await page.locator(".fact-history li.highlight").count(),
          0,
        );
        await cell.focus();
        await page.keyboard.press("Space");
        await expect(cell).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Enter");
        await expect(cell).toHaveAttribute("aria-pressed", "false");
        assert.equal(
          await page
            .getByRole("button", { name: "Inspect Bullfrog cell", exact: true })
            .count(),
          0,
        );
        await page.evaluate(() => scrollTo(0, 0));
        await shot(`wallet-${width}`, width === 1280);
      }
      await geometry("Wallet with card");
    },
  );
  await run(
    "2 Wallet full-width groups: two direct facts per row; one sworn fact per row, three aligned columns and Mint colors",
    async () => {
      await setup({ route: "#/wallet", options: held });
      await page.locator("#held-10003").waitFor();
      await expect(page.locator(".fact-group-title")).toHaveText([
        "Direct facts",
        "Sworn WhitelistCurator facts",
        "Sworn Community facts",
      ]);
      const section = await box(".wallet-facts"),
        block = await box(".wallet-record");
      near(section.x, block.x, "facts left");
      near(section.width, block.width, "facts width");
      const direct = await page.locator(".direct-facts li").evaluateAll((es) =>
        es.map((e) => ({
          y: e.getBoundingClientRect().y,
          children: e.children.length,
        })),
      );
      assert.equal(direct.length, 4);
      near(direct[0].y, direct[1].y, "first direct pair");
      near(direct[2].y, direct[3].y, "second direct pair");
      direct.forEach((r) => assert.equal(r.children, 2));
      const rows = await page.locator(".sworn-facts li").evaluateAll((es) =>
        es.map((e) => ({
          id: e.id,
          y: e.getBoundingClientRect().y,
          width: e.getBoundingClientRect().width,
          cells: [...e.children].map((c) => ({
            x: c.getBoundingClientRect().x,
            text: c.textContent.trim(),
            color: getComputedStyle(c).color,
          })),
        })),
      );
      const colors = {
        "Chain-proven": "rgb(0, 255, 65)",
        Shared: "rgb(219, 254, 230)",
        "Panel-sworn": "rgb(143, 240, 164)",
      };
      assert.equal(rows.length, 7);
      for (const r of rows) {
        assert.equal(r.cells.length, 3);
        near(r.width, section.width, `${r.id} width`);
        r.cells.forEach((c, i) =>
          near(c.x, rows[0].cells[i].x, `${r.id} col ${i}`),
        );
        assert.equal(r.cells[2].color, colors[r.cells[2].text]);
      }
      for (const title of await page.locator(".fact-group-title").all())
        assert.equal(
          await title.evaluate((e) => getComputedStyle(e).color),
          "rgb(0, 255, 65)",
        );
      evidence.contrast = await page
        .locator(
          ".wallet-card > p,.fact-group-title,.sworn-facts .meaning,.sworn-facts .class-mark",
        )
        .evaluateAll((es) => {
          const luminance = (color) =>
            color
              .match(/\d+/g)
              .slice(0, 3)
              .map((n) => Number(n) / 255)
              .map((v) =>
                v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
              )
              .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
          return es.map((e) => {
            let parent = e;
            while (
              parent.parentElement &&
              getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)"
            )
              parent = parent.parentElement;
            const foreground = getComputedStyle(e).color,
              background = getComputedStyle(parent).backgroundColor;
            const a = luminance(foreground),
              b = luminance(background);
            return {
              foreground,
              background,
              ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            };
          });
        });
      for (const pair of evidence.contrast)
        assert.ok(pair.ratio >= 4.5, JSON.stringify(pair));
      await expect(page.locator("#held-1301 .meaning")).toHaveText(rule);
      assert.ok(
        !(await page.locator(".wallet-facts").innerText()).includes(
          "Every fact this wallet holds",
        ),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      for (const row of await page.locator(".fact-history li").all()) {
        const cells = await row
          .locator(":scope > *")
          .evaluateAll((es) =>
            es.map((e) => e.getBoundingClientRect().toJSON()),
          );
        for (let i = 1; i < cells.length; i++)
          assert.ok(cells[i].y >= cells[i - 1].bottom - 1);
      }
      await geometry("Wallet groups");
    },
  );
  await run(
    "1,3 Wallet without a card has no card block; a minted empty card has neither hint nor selectable cells",
    async () => {
      await setup({ route: "#/wallet", options: { token: 0n, traits: [101] } });
      await page.locator("#held-101").waitFor();
      assert.equal(
        await page.locator(".wallet-record > .mint-panel,.wallet-card").count(),
        0,
      );
      await geometry("Wallet no card");
      await setup({ route: "#/wallet", options: { token: 7n, traits: [] } });
      await page
        .getByText("No claimed fact for this wallet.", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator(
            ".wallet-card > p,.wallet-card button,.wallet-card figcaption,.wallet-card .status",
          )
          .count(),
        0,
      );
      await geometry("Wallet empty card");
    },
  );
  await run(
    "3 Mint with card is exactly one linked line; without card retains mint controls and capitalized fee",
    async () => {
      await setup({ options: { token: 7n } });
      await expect(page.locator("#mint")).toHaveText(mintedLine);
      assert.equal(
        await page.locator("#mint .card-figure,#mint h2,.mint-panel").count(),
        0,
      );
      await expect(
        page.getByRole("link", { name: "Wallet page", exact: true }),
      ).toHaveAttribute("href", "#/wallet");
      await page
        .getByRole("link", { name: "Wallet page", exact: true })
        .click();
      await expect(page.locator("#wallet-card-title")).toHaveText(
        "Your Sworn card #7",
      );
      await setup({ options: { token: 0n } });
      await page
        .getByRole("button", { name: "Mint card", exact: true })
        .waitFor();
      await expect(
        page.locator(".mint-panel").getByText(fee, { exact: true }),
      ).toBeVisible();
      assert.equal(await page.locator(".mint-panel .card-figure").count(), 1);
      await geometry("Mint without card");
    },
  );
  await run(
    "4,7 Mint 02 intro uses full width; three Why columns have equal top edges",
    async () => {
      await setup({ connected: false });
      const width = (await box("#step-01 > p.prose")).width;
      for (const selector of [
        ".step-intros > p",
        ".step-note",
        "#step-03 > p.prose",
      ])
        for (const el of await page.locator(selector).all())
          near((await el.boundingBox()).width, width, selector);
      const tops = await page
        .locator(".why-steps > li")
        .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().y));
      assert.equal(tops.length, 3);
      tops.forEach((y) => near(y, tops[0], "Why column top"));
      await page
        .locator(".why-facts")
        .screenshot({ path: new URL("why-1280.png", output).pathname });
      await page
        .locator("#step-02 .step-intros")
        .screenshot({ path: new URL("intros-1280.png", output).pathname });
    },
  );
  await run(
    "5 Community rows stay in picker; no trailing heading/empty/success copy; loading and failure have one line above payment notice",
    async () => {
      const gate = Promise.withResolvers();
      const selector = encodeFunctionData({
        abi: parseAbi(["function nextSpecId() view returns (uint16)"]),
        functionName: "nextSpecId",
      }).slice(0, 10);
      await setup({
        options: {
          nextSpecId: 10002,
          specs: { 1301: nonceSpec, 10001: communitySpec },
        },
        configure(f) {
          const answer = f.answer;
          f.answer = async (p) => {
            if (
              rpcCalls(p).some(
                (c) =>
                  c.method === "eth_call" &&
                  c.params[0].data.startsWith(selector),
              )
            )
              await gate.promise;
            return answer(p);
          };
        },
      });
      await expect(
        page.locator("#oracle-ack").locator("xpath=preceding-sibling::*[1]"),
      ).toHaveText("Reading community specs…");
      gate.resolve();
      await page.locator("#pick-10001").waitFor();
      assert.equal(
        await page
          .locator("#step-02")
          .getByRole("heading", { name: "Community facts", exact: true })
          .count(),
        0,
      );
      assert.ok(
        !(await page.locator("#step-02").innerText()).includes(
          "Community facts appear in the picker above.",
        ),
      );
      await setup();
      await page
        .getByRole("button", { name: "Mint card", exact: true })
        .waitFor();
      assert.ok(
        !(await page.locator("#step-02").innerText()).includes(
          "No community specs registered yet.",
        ),
      );
      await setup({ options: { failFunction: "nextSpecId" } });
      const line = page
        .locator("#oracle-ack")
        .locator("xpath=preceding-sibling::*[1]");
      await expect(line).toContainText("Community specs unavailable.");
      await expect(line).toHaveAttribute("role", "status");
      assert.equal(
        await page
          .locator("#step-02 > .status")
          .filter({ hasText: "Community specs unavailable." })
          .count(),
        1,
      );
    },
  );
  await run(
    "6 Paid facts checked on load: nonce 5 hides 1301 and increases count; selected row/note survive hiding",
    async () => {
      await setup({ options: { token: 7n } });
      await page.waitForFunction(
        () =>
          document.querySelector(".minted-card") &&
          !document.querySelector("#pick-1301"),
      );
      assert.ok(
        fixture.state.calls.some(
          (p) =>
            p.method === "eth_getTransactionCount" &&
            p.params[0].toLowerCase() === wallet &&
            BigInt(p.params[1]) === 25769870n,
        ),
      );
      const toggle = page.locator("#step-02 .eligibility-toggle");
      await expect(toggle).toHaveText(
        /Show ineligible facts \([1-9]\d* hidden\)/,
      );
      await toggle.click();
      const row = page.locator("#pick-1301");
      await row.locator("input").check();
      await expect(row.locator(".eligibility-advice")).toContainText(
        "does not meet this rule (nonce 5 at block 25769870)",
      );
      const note = normal(await row.locator(".eligibility-advice").innerText());
      await toggle.click();
      await expect(row).toBeVisible();
      await expect(row.locator("input")).toBeChecked();
      await expect(row.locator(".eligibility-advice")).toHaveText(note);
      await page
        .getByRole("button", { name: "Mint selected facts", exact: true })
        .click();
      await expect(
        page.locator(".payment-dialog").getByText(note, { exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      // Unchecking unmounts the now-hidden row in the same event.
      await row.locator("input").evaluate((e) => e.click());
      await expect(row).toHaveCount(0);
      await setup({ options: { token: 7n, traits: [101, 1301] } });
      await expect(page.locator("#pick-1301 .minted-fact strong")).toHaveText(
        "Minted",
      );
      assert.equal(
        fixture.state.calls.filter(
          (p) => p.method === "eth_getTransactionCount",
        ).length,
        0,
      );
    },
  );
  await run(
    "6 Failed or unanswered eligibility stays visible; a deadline stops the check without implying ineligibility",
    async () => {
      await setup({
        configure(f) {
          const answer = f.answer;
          f.answer = (p) => {
            if (p.method === "eth_getTransactionCount")
              throw Error("Synthetic unavailable history");
            return answer(p);
          };
        },
      });
      await page
        .getByRole("button", { name: "Mint card", exact: true })
        .waitFor();
      await page.locator("#pick-1301 input").check();
      await expect(
        page.locator("#pick-1301 .eligibility-advice"),
      ).toContainText("Could not check eligibility", { timeout: 30000 });
      await expect(page.locator("#pick-1301")).toBeVisible();
      const gate = Promise.withResolvers();
      await setup({
        deadline: true,
        configure(f) {
          const answer = f.answer;
          f.answer = async (p) =>
            p.method === "eth_getTransactionCount" ? gate.promise : answer(p);
        },
      });
      await page.waitForFunction(() => window.__checkDeadlines > 0);
      await expect(page.locator("#pick-1301")).toBeVisible();
      gate.resolve("0x5");
      await page.locator("#pick-1301 input").check();
      // A fresh, explicitly selected check can find not-met, but keeps its row.
      await expect(page.locator("#pick-1301")).toBeVisible();
    },
  );
  await run(
    "8 Pending seats: final seat has no trailing rule; one rule before each numbered step; no empty boundary on any route",
    async () => {
      await setup({ options: { token: 7n, pending }, record: request });
      const feed = page.locator("#step-02 .swarm-request");
      await expect(feed).toHaveJSProperty("open", true);
      await expect(feed.locator(".swarm-seats li")).toHaveCount(11);
      await expect(
        feed.getByText("Failed: Synthetic failed check", { exact: true }),
      ).toBeVisible();
      assert.equal(
        await feed
          .locator(".swarm-seats li:last-child")
          .evaluate((e) => getComputedStyle(e).borderBottomWidth),
        "0px",
      );
      assert.equal(
        await feed
          .locator(".swarm-seats li:first-child")
          .evaluate((e) => getComputedStyle(e).borderBottomWidth),
        "1px",
      );
      for (const id of ["step-01", "step-02", "step-03"])
        assert.equal(
          await page
            .locator("#" + id)
            .evaluate((e) => getComputedStyle(e).borderTopWidth),
          "1px",
        );
      await geometry("Mint populated pending seats");
      await page.setViewportSize({ width: 1280, height: 900 });
      await feed.screenshot({
        path: new URL("pending-seats-1280.png", output).pathname,
      });
      for (const connected of [false, true]) {
        await setup({ route: "#/", connected, options: held });
        for (const route of routes) {
          await page.goto(preview.url + route);
          await page.getByRole("heading", { level: 1 }).waitFor();
          if (connected && route === "#/wallet")
            await page.locator("#held-10003").waitFor();
          await geometry(`${route} connected=${connected}`);
        }
      }
    },
  );
  await run(
    "9,10 Exact BurnExecutor/1301 copy on Mint, Catalog, About and held Wallet; other labels remain protected by unit suite",
    async () => {
      for (const route of ["#/mint", "#/catalog", "#/wallet", "#/about"]) {
        await setup({ route, options: held });
        if (route === "#/wallet") await page.locator("#held-1301").waitFor();
        const text = normal(await page.locator("body").innerText());
        assert.doesNotMatch(
          text,
          /BurnExecutor V2|external dependencies|fees? (?:are |is )?burned/i,
        );
        if (route !== "#/about")
          assert.ok(text.includes(rule), `${route}: 1301 rule`);
        else
          await expect(
            page.getByText(
              "For minting and registration, the fee is forwarded to the BurnExecutor for bridging and burning on Base.",
              { exact: true },
            ),
          ).toBeVisible();
      }
    },
  );
  await run(
    "Primary action/metadata: Explore and Connect on first 390px screen; relative assets, keyboard, no errors or signing",
    async () => {
      await setup({ route: "#/", connected: false });
      await page.setViewportSize({ width: 390, height: 844 });
      const action = await page
        .getByRole("button", { name: "Explore wallet" })
        .boundingBox();
      assert.ok(action.y + action.height <= 844);
      await page.getByRole("button", { name: "Explore wallet" }).click();
      await expect(page.locator("#explore-address")).toBeFocused();
      await page.locator("#explore-address").fill(wallet);
      await page.keyboard.press("Enter");
      await expect(page.locator("#trait-101")).toBeVisible();
      await page.goto(preview.url);
      await expect(page).toHaveTitle("Sworn | Home");
      await page.locator("#explore-address").focus();
      await shot("home-focus-390");
      for (const selector of [
        'link[rel="icon"]',
        'meta[name="description"]',
        'meta[property="og:title"]',
        'meta[property="og:image"]',
      ])
        assert.equal(await page.locator(selector).count(), 1);
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      assert.deepEqual(evidence.errors, []);
    },
  );
} finally {
  fs.writeFileSync(
    new URL("evidence.json", output),
    JSON.stringify(evidence, null, 2),
  );
  await context?.close();
  await browser?.close();
  await preview.close();
}
