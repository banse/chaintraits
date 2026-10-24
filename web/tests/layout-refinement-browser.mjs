// Current eleven-item refinement: the production export with synthetic wallet/RPC/API.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { fakeChain, fakeWallet, mockPage } from "./fake-chain.mjs";
import { server } from "./harness.mjs";

const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/layout-refinement-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const evidence = {
  engine,
  checks: [],
  matrix: [],
  errors: [],
  limits: [
    "Fake EIP-1193, RPC and API only; no real signing, broadcast or service verification.",
  ],
};
let browser, context, page, fixture;
const normal = (s) => s.replace(/\s+/g, " ").trim();
async function run(name, fn) {
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup({
  route = "#/mint",
  connected = true,
  options = {},
} = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context);
  await context.addInitScript(() => {
    const request = window.ethereum.request.bind(window.ethereum);
    window.ethereum.request = (args) => {
      if (args.method === "eth_sendTransaction" && window.__holdSignature) {
        window.__signing.push(args);
        return new Promise((resolve, reject) => {
          window.__resolveSignature = resolve;
          window.__rejectSignature = () =>
            reject(
              Object.assign(Error("Fake wallet rejected; nothing sent"), {
                code: 4001,
              }),
            );
        });
      }
      return request(args);
    };
  });
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
  fixture = fakeChain({ allowance: 10n ** 22n, ...options });
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ requests: [], entries: [] }),
    }),
  );
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
// Horizontal structural borders, compared with actual rendered text/control/image
// rectangles. Box outlines (fields, buttons, code, blockquotes) are not separators.
function emptySeparators() {
  const visible = (el) =>
    el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true });
  const name = (e) =>
    e.id
      ? `#${e.id}`
      : `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`;
  const rect = (r) => ({
    x: r.x,
    y: r.y + scrollY,
    right: r.right,
    bottom: r.bottom + scrollY,
  });
  const content = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (
      !n.textContent.trim() ||
      !visible(n.parentElement) ||
      n.parentElement.closest("script,style,dialog:not([open])")
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects())
      if (r.width && r.height) content.push(rect(r));
  }
  for (const e of document.querySelectorAll(
    "img,input,button,select,textarea,svg,canvas",
  ))
    if (visible(e)) content.push(rect(e.getBoundingClientRect()));
  const lines = [];
  for (const e of document.querySelectorAll("main,main *,footer,footer *")) {
    if (
      !visible(e) ||
      e.closest(
        "button,input,select,textarea,fieldset,pre,blockquote,dialog,.code-block,.hour-tooltip",
      )
    )
      continue;
    const s = getComputedStyle(e),
      r = rect(e.getBoundingClientRect());
    if (
      r.right - r.x < 100 ||
      parseFloat(s.borderLeftWidth) ||
      parseFloat(s.borderRightWidth)
    )
      continue;
    for (const [side, y] of [
      ["Top", r.y],
      ["Bottom", r.bottom],
    ])
      if (
        parseFloat(s[`border${side}Width`]) > 0 &&
        s[`border${side}Style`] !== "none"
      )
        lines.push({ ...r, y, name: name(e) + ":" + side });
  }
  lines.sort((a, b) => a.y - b.y);
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const next = lines
      .slice(i + 1)
      .find(
        (b) =>
          b.y > a.y + 1 &&
          Math.min(a.right, b.right) - Math.max(a.x, b.x) >=
            Math.min(a.right - a.x, b.right - b.x) * 0.8,
      );
    if (!next) continue;
    const left = Math.max(a.x, next.x),
      right = Math.min(a.right, next.right);
    const between = content.some(
      (r) =>
        r.right > left &&
        r.x < right &&
        (r.y + r.bottom) / 2 > a.y &&
        (r.y + r.bottom) / 2 < next.y,
    );
    if (!between) bad.push({ from: a.name, to: next.name, y: [a.y, next.y] });
  }
  return bad;
}
async function geometry(label, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const metrics = await page.evaluate(() => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    };
    return {
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      footer: rect(document.querySelector(".footer-bottom")),
      group: rect(document.querySelector(".rpc-controls")),
      controls: [...document.querySelector(".rpc-controls").children].map(rect),
      headings: [
        ...document.querySelectorAll("main h1,main h2,main h3,main h4"),
      ]
        .filter((e) => e.checkVisibility())
        .map((e) => ({
          tag: e.tagName,
          text: e.textContent.trim(),
          size: parseFloat(getComputedStyle(e).fontSize),
          subpart: e.classList.contains("subpart-title"),
        })),
    };
  });
  assert.ok(
    metrics.scroll <= width,
    `${label}: overflow ${metrics.scroll}/${width}`,
  );
  if (width === 1280) {
    const [labelBox, selector, retry] = metrics.controls;
    assert.ok(
      Math.abs(selector.y - retry.y) < 1,
      `${label}: footer controls wrapped`,
    );
    assert.ok(
      Math.abs(metrics.group.right - metrics.footer.right) < 1,
      `${label}: footer right alignment`,
    );
    assert.ok(labelBox.right <= selector.x && selector.right <= retry.x);
    assert.ok(
      metrics.group.y >= metrics.footer.y &&
        metrics.group.bottom <= metrics.footer.bottom,
    );
  }
  for (const h of metrics.headings) {
    const expected =
      h.subpart || h.tag === "H4" ? 13 : { H1: 34, H2: 24, H3: 15 }[h.tag];
    assert.equal(h.size, expected, `${label}: ${h.text}`);
  }
  const empty = await page.evaluate(emptySeparators);
  assert.deepEqual(empty, [], `${label} ${width}: empty duplicate boundaries`);
  evidence.matrix.push({ label, ...metrics, emptySeparators: empty.length });
}
try {
  browser = await { chromium, webkit }[engine].launch();
  await run(
    "1,5,8 all routes at 1280/390, connected/disconnected: aligned footer, distinct headings, no empty separator pairs, overflow or errors",
    async () => {
      for (const connected of [false, true]) {
        await setup({
          route: "#/",
          connected,
          options: { token: 7n, traits: [101, 201, 301] },
        });
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
          "#/whitelistcurator",
          "#/fact-vs-artifact",
        ]) {
          await page.goto(preview.url + route);
          await page.getByRole("heading", { level: 1 }).waitFor();
          await page.getByText(/Dependencies verified/).waitFor();
          if (connected && ["#/mint", "#/claim"].includes(route))
            await page
              .getByText("3 direct facts present.", { exact: false })
              .waitFor();
          if (connected && ["#/wallet", "#/wallet-facts"].includes(route))
            await page.locator("#held-101").waitFor();
          for (const width of [1280, 390])
            await geometry(`${route} wallet=${connected}`, width);
        }
      }
    },
  );
  await run(
    "5,10 a pending fact keeps its Swarm progress inside 02; the populated Explorer ends its fact list with one rule",
    async () => {
      const pending = [
        {
          id: 601,
          requestId: "0x" + "a1".repeat(32),
          questionHash: "0x" + "b2".repeat(32),
          requestedAt: 1792600000n,
        },
      ];
      await setup({
        route: "#/mint",
        options: { token: 7n, traits: [101, 201, 301], pending },
      });
      await page.locator(".swarm-feed .swarm-request").waitFor();
      const placement = await page.evaluate(() => ({
        afterWhy: document.querySelector(".why-facts").nextElementSibling.id,
        feedStep: document.querySelector(".swarm-feed").closest(".step")?.id,
        feedRule: getComputedStyle(document.querySelector(".swarm-feed"))
          .borderTopWidth,
      }));
      assert.deepEqual(placement, {
        afterWhy: "add-traits",
        feedStep: "step-02",
        feedRule: "0px",
      });
      for (const width of [1280, 390])
        await geometry("#/mint pending wallet=true", width);
      for (const connected of [false, true]) {
        await setup({
          route: "#/",
          connected,
          options: { token: 7n, traits: [101, 201, 301] },
        });
        await page.goto(
          preview.url +
            "#/explorer?address=0x2000000000000000000000000000000000000001",
        );
        await page.locator("#trait-101").waitFor();
        assert.equal(
          await page.evaluate(
            () =>
              getComputedStyle(
                document.querySelector(".fact-rows > .fact-row:last-child"),
              ).borderBottomWidth,
          ),
          "0px",
        );
        for (const width of [1280, 390])
          await geometry(`#/explorer populated wallet=${connected}`, width);
      }
    },
  );
  await run(
    "3 six Catalog sources keep commit, file and anchors in the deployed repository",
    async () => {
      await setup({ route: "#/catalog", connected: false });
      const sources = await page
        .locator("a.source")
        .filter({ hasText: /^CATALOG ·/ })
        .evaluateAll((es) => es.map((e) => e.href));
      assert.equal(sources.length, 6);
      const base =
        "https://github.com/identity-md-launches/launch-2404-renderer-composer-registry/blob/c4ff3238390fc51962fb67e86affc20cf418126e/CATALOG.md#";
      assert.deepEqual(
        sources,
        [
          "2-ids-and-tiers",
          "3-trait-table-25-slots-working-names",
          "4-what-the-callback-accepts-per-class",
          "8-operational-limits",
          "5-spec-registration-community-traits",
          "6-fees-and-sharing",
        ].map((a) => base + a),
      );
      const direct = normal(await page.locator("#direct > p").innerText());
      const topics = await page
        .locator("#chain > p,#shared > p,#panel > p")
        .allInnerTexts();
      const community = normal(
        await page.locator("#community > p").first().innerText(),
      );
      evidence.catalog = { sources, direct, topics, community };
      assert.equal(await page.locator("#direct .catalog-row").count(), 13);
    },
  );
  await run(
    "4,6,7,8,10 Mint structure, exact titles, Read Contract, shared intros, small muted subparts and moved four-link explanation",
    async () => {
      await setup();
      assert.equal(
        await page
          .getByRole("heading", { name: "Add facts", exact: true })
          .count(),
        0,
      );
      assert.equal(await page.locator(".step .info-grid").count(), 0);
      for (const label of ["Who can", "Cost and risk", "Who benefits"])
        assert.equal(
          await page.locator("main").getByText(label, { exact: true }).count(),
          0,
        );
      assert.deepEqual(
        (await page.locator(".step-title").allTextContents()).map(normal),
        [
          "01 – Direct WhitelistCurator facts – written onchain, readable from the contract",
          "02 – Sworn WhitelistCurator facts – provable onchain, sworn by the swarm",
          "03 – Sworn Community facts – not limited to WhitelistCurator",
        ],
      );
      const link = page.locator("#step-01 h3 + a");
      assert.equal(
        await link.innerText(),
        "WhitelistCurator.sol on Etherscan: Read Contract ↗",
      );
      assert.equal(
        await link.getAttribute("href"),
        "https://etherscan.io/address/0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91#readContract",
      );
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.equal(
        normal(await page.locator("#step-01 > p.prose").innerText()),
        evidence.catalog.direct,
      );
      assert.equal(
        normal(await page.locator("#step-03 > p.prose").innerText()),
        evidence.catalog.community,
      );
      const topicDescriptions = (
        await page.locator(".step-intros > p").allTextContents()
      ).map(normal);
      assert.deepEqual(
        await page.locator(".step-intros strong").allTextContents(),
        ["Chain-proven", "Shared facts", "Panel-sworn"],
      );
      evidence.catalog.topics.forEach((intro, i) =>
        assert.equal(
          topicDescriptions[i].split(" · ")[1],
          normal(intro).replace(
            / Request(?: or apply a shared)? (?:a )?fact in step 02\.$/,
            "",
          ),
        ),
      );
      assert.doesNotMatch(topicDescriptions.join(" "), /in step 02/);
      assert.equal(
        await page.locator("#mint-facts > h2 + p + .why-facts").count(),
        1,
      );
      assert.equal(await page.locator(".why-facts .flow a").count(), 4);
      assert.deepEqual(
        await page
          .locator(".why-facts .flow a")
          .evaluateAll((es) => es.map((e) => e.getAttribute("href"))),
        ["#/mint#mint", "#/mint#step-02", "#/wallet", "#/wallet"],
      );
      for (const width of [1280, 390]) {
        await geometry("Mint content", width);
        const style = await page
          .locator(".step-title")
          .first()
          .evaluate((e) => ({
            size: getComputedStyle(e).fontSize,
            weight: getComputedStyle(e).fontWeight,
            number: getComputedStyle(e.querySelector(".step-number")).color,
            description: getComputedStyle(e.querySelector(".step-description"))
              .fontWeight,
          }));
        assert.deepEqual(style, {
          size: "15px",
          weight: "600",
          number: "rgb(0, 255, 65)",
          description: "400",
        });
        for (const el of await page.locator(".subpart-title,#step-02 h4").all())
          assert.deepEqual(
            await el.evaluate((e) => [
              getComputedStyle(e).textTransform,
              getComputedStyle(e).color,
              getComputedStyle(e).fontSize,
            ]),
            ["uppercase", "rgb(140, 150, 142)", "13px"],
          );
        assert.equal(
          await page
            .locator("#step-01")
            .evaluate((e) => getComputedStyle(e).borderTopWidth),
          "0px",
        );
        assert.equal(
          await page
            .locator(".why-facts")
            .evaluate((e) => getComputedStyle(e).borderBottomWidth),
          "0px",
        );
        for (const id of ["02", "03"])
          assert.equal(
            await page
              .locator(`#step-${id}`)
              .evaluate((e) => getComputedStyle(e).borderTopWidth),
            "1px",
          );
        await page.locator("#mint-facts").evaluate((e) => e.scrollIntoView());
        await page.screenshot({
          path: new URL(`mint-facts-${width}.png`, output).pathname,
        });
      }
    },
  );
  await run(
    "9,11 zero hidden controls absent; direct facts are held-only before/after connection; Catalog stays complete",
    async () => {
      await setup({ connected: false });
      assert.equal(await page.locator(".eligibility-toggle").count(), 0);
      assert.equal(await page.locator(".direct-summary > span").count(), 0);
      await setup({ options: { traits: [101, 301] } });
      await page
        .getByText("2 direct facts present.", { exact: false })
        .waitFor();
      assert.equal(
        await page.locator("#step-01 .eligibility-toggle").count(),
        0,
      );
      assert.deepEqual(
        await page
          .locator(".direct-summary > span")
          .allTextContents()
          .then((a) => a.map(normal)),
        ["101 / Spawned · present", "301 / Hopper >= 3 · present"],
      );
      assert.equal(
        await page.locator("#step-02 .eligibility-toggle").count(),
        0,
      );
      await setup({ options: { joined: false, traits: [] } });
      const toggle = page.locator("#step-02 .eligibility-toggle");
      await toggle.filter({ hasText: "10 hidden" }).waitFor();
      assert.equal(
        await page.locator("#step-01 .eligibility-toggle").count(),
        0,
      );
      assert.equal(await page.locator(".direct-summary > span").count(), 0);
      assert.equal(await page.locator("#pick-701").isVisible(), false);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#pick-701").isVisible(), true);
      await toggle.click();
      assert.equal(await page.locator("#pick-701").isVisible(), false);
      await page.goto(preview.url + "#/catalog");
      assert.equal(await page.locator("#direct .catalog-row").count(), 13);
    },
  );
  await run(
    "2 busy transaction navigation stays enabled and keyboard activation follows Wallet without signing or sending",
    async () => {
      await setup();
      await page
        .locator("#mint")
        .getByRole("button", { name: "Mint card", exact: true })
        .click();
      const dialog = page.locator(".payment-dialog");
      await dialog.locator("#payment-ack").check();
      await dialog.getByText("simulated", { exact: true }).waitFor();
      await page.evaluate(() => {
        window.__holdSignature = true;
      });
      await dialog
        .getByRole("button", { name: "Mint one Sworn card", exact: true })
        .click();
      await dialog.getByText("awaiting signature", { exact: true }).waitFor();
      const follow = dialog.getByRole("button", {
        name: "Follow progress on the Wallet page",
      });
      assert.equal(await follow.isEnabled(), true);
      await follow.focus();
      await page.keyboard.press("Enter");
      await page
        .getByRole("heading", { name: "Wallet", exact: true, level: 1 })
        .waitFor();
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(
        await page.evaluate(() => window.__signing.length),
        1,
        "only the held fake provider call",
      );
      await page.evaluate(() => window.__rejectSignature());
      assert.equal(
        fixture.state.calls.filter((p) => /send|sign/i.test(p.method)).length,
        0,
      );
    },
  );
  await run(
    "first 390px screen retains product/action, share metadata, keyboard focus and reflow at 320",
    async () => {
      await setup({ route: "#/", connected: false });
      await page.setViewportSize({ width: 390, height: 844 });
      const action = await page
        .getByRole("button", { name: "Explore wallet" })
        .boundingBox();
      assert.ok(action.y + action.height < 844);
      await page.getByLabel("Explore a wallet", { exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "Explore wallet" })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.screenshot({
        path: new URL("home-focus-390.png", output).pathname,
      });
      for (const sel of [
        "title",
        'link[rel="icon"]',
        'meta[name="description"]',
        'meta[property="og:title"]',
        'meta[property="og:image"]',
      ])
        assert.equal(await page.locator(sel).count(), 1);
      await page.setViewportSize({ width: 320, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );
  assert.deepEqual(evidence.errors, []);
  console.log(
    JSON.stringify({
      passed: evidence.checks.length,
      routeWidths: evidence.matrix.length,
      errors: evidence.errors,
    }),
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
