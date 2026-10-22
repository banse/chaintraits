import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { decodeFunctionData } from "viem";
import { fakeChain, fakeWallet, mockPage, wallet } from "./fake-chain.mjs";
import { server } from "./harness.mjs";
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(`../../test/scratch/swarm-${engine}/`, import.meta.url);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const deployment = JSON.parse(
  fs.readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
);
const abi = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
);
const registry = deployment.contracts.find(
  (c) => c.name === "Registry",
).address;
const requestId = "0x" + "a1".repeat(32),
  questionHash = "0x" + "b1".repeat(32);
const requestedAt = 1792600000n;
const at = (seconds) =>
  new Date((Number(requestedAt) + seconds) * 1000).toISOString();
const evidence = {
  at: new Date().toISOString(),
  engine,
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  resourceErrors: [],
  api: [],
};
let browser, page;
async function run(name, check) {
  await check();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  evidence.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context);
  await context.addInitScript(() => {
    const interval = window.setInterval.bind(window),
      clear = window.clearInterval.bind(window);
    const callbacks = new Map();
    window.setInterval = (callback, delay, ...args) => {
      const id = interval(callback, delay, ...args);
      if (delay === 5000) callbacks.set(id, () => callback(...args));
      return id;
    };
    window.clearInterval = (id) => {
      callbacks.delete(id);
      clear(id);
    };
    window.__pollSwarm = () => callbacks.forEach((fn) => fn());
  });
  page = await context.newPage();
  page.on("pageerror", (e) => evidence.pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.consoleErrors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400)
      evidence.resourceErrors.push({ url: r.url(), status: r.status() });
  });
  const f = fakeChain({
    token: 1n,
    allowance: 10n ** 22n,
    pending: [{ id: 601, requestId, questionHash, requestedAt }],
  });
  await mockPage(page, f);
  let unavailable = false;
  const live = {
    id: "swarm-current",
    createdAt: at(2),
    consumer: { verifyingContract: registry.toUpperCase(), chainId: 1 },
    questionHash: questionHash.toUpperCase(),
    question: `Did wallet ${wallet} meet the condition?`,
    answerType: "bool",
    status: "assessing",
    panelSize: 5,
    quorum: 3,
    members: [
      { tokenId: "110", ok: true, answer: { answer: true, figure: "42" } },
    ],
    agreement: { agreed: 1 },
    attestedAt: null,
  };
  const records = [
    {
      ...live,
      id: "wrong-consumer",
      createdAt: at(5),
      consumer: {
        verifyingContract: deployment.contracts.find(
          (c) => c.name === "Renderer",
        ).address,
      },
    },
    {
      ...live,
      id: "wrong-hash",
      createdAt: at(4),
      questionHash: "0x" + "cc".repeat(32),
    },
    {
      ...live,
      id: "later-match",
      createdAt: at(3),
      members: [
        { tokenId: "999", ok: true, answer: { answer: false, figure: "999" } },
      ],
    },
    { ...live, id: "predates-request", createdAt: at(-1) },
    live,
  ];
  await page.route("https://api.imd.fun/**", async (route) => {
    const url = new URL(route.request().url());
    evidence.api.push(url.pathname);
    if (url.pathname.startsWith("/intake/"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [] }),
      });
    if (url.pathname === "/oracle/requests")
      assert.equal(url.searchParams.get("q"), wallet);
    assert.match(url.pathname, /^\/oracle\/requests(?:\/[a-z-]+)?$/);
    assert.equal(route.request().method(), "GET");
    if (unavailable)
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "unreadable API answer",
      });
    const data =
      url.pathname === "/oracle/requests"
        ? {
            requests: records.map(({ id, createdAt, question, jobId }) => ({
              id,
              createdAt,
              question,
              jobId,
            })),
          }
        : records.find((r) => url.pathname.endsWith("/" + r.id));
    assert.ok(
      data,
      "Only request listing and known detail URLs may be requested",
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto(preview.url + "#/claim");
  await page.getByText(/Dependencies verified/).waitFor();
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Browser wallet", exact: true })
    .click();
  const feed = page.locator(".swarm-request");
  await run(
    "3 pending notice names the fact, exact Registry timestamp and per-fact lock",
    async () => {
      await page.locator(".pending-notice time").waitFor();
      assert.match(
        await page.locator(".pending-notice").innerText(),
        /601 \/ Swarmed/,
      );
      assert.equal(
        await page.locator(".pending-notice time").getAttribute("datetime"),
        at(0),
      );
      assert.match(
        await page.locator(".pending-notice").innerText(),
        /cannot be requested again until its answer arrives/,
      );
      assert.equal(await page.locator("#pick-601 input").isDisabled(), true);
      assert.equal(await page.locator("#pick-701 input").isEnabled(), true);
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent === "Mint shared fact" && !b.disabled,
        ),
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Mint shared fact", exact: true })
          .isEnabled(),
        true,
      );
    },
  );
  await run(
    "4 summary-only API matches oldest consumer + event questionHash at or after request",
    async () => {
      await feed
        .getByText("1 / 5 answers · 1 true / 3 needed", { exact: true })
        .waitFor();
      assert.match(await feed.innerText(), /Seat 1 · #110/);
      assert.doesNotMatch(await feed.innerText(), /#999/);
      assert.equal(
        evidence.api.some(
          (p) => p.endsWith("/later-match") || p.endsWith("/predates-request"),
        ),
        false,
      );
      assert.equal(await feed.getByRole("listitem").count(), 5);
    },
  );
  await run(
    "3 another fact still opens a plan and silently unlocks its own checked call",
    async () => {
      await page.locator("#pick-701 input").check();
      await page
        .getByRole("button", { name: "Mint selected facts", exact: true })
        .click();
      const dialog = page.locator(".payment-dialog");
      await dialog.locator("#payment-ack").check();
      const sign = dialog.getByRole("button", {
        name: "Request 701 / Uptime",
        exact: true,
      });
      await sign.waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".payment-dialog button")].some(
          (b) => b.textContent === "Request 701 / Uptime" && !b.disabled,
        ),
      );
      assert.equal(
        await dialog.getByRole("button", { name: /Simulate/ }).count(),
        0,
      );
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await dialog
        .getByRole("button", { name: "Clear journal", exact: true })
        .click();
    },
  );
  await run(
    "5 Check swarm opens the existing feed and focuses its disclosure",
    async () => {
      await feed.locator("summary").click();
      assert.equal(await feed.getAttribute("open"), null);
      await page
        .getByRole("button", { name: "Check swarm", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".swarm-request").open,
      );
      assert.equal(
        await page
          .getByRole("button", { name: /Check verdict delivery/ })
          .count(),
        0,
      );
      assert.equal(
        await feed
          .locator("summary")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.keyboard.press("Enter");
      assert.equal(await feed.getAttribute("open"), null);
      await page.keyboard.press("Enter");
      assert.notEqual(await feed.getAttribute("open"), null);
    },
  );
  await run(
    "4 new true/false/failed seats update without reload; figures stay hidden",
    async () => {
      await page.evaluate(
        () => (window.__originalMain = document.querySelector("main")),
      );
      live.members.push(
        { tokenId: "111", ok: true, answer: { answer: false, figure: "0" } },
        { tokenId: "112", ok: false, reason: "Archive read timed out" },
      );
      await page.evaluate(() => window.__pollSwarm());
      await feed
        .getByText("3 / 5 answers · 1 true / 3 needed", { exact: true })
        .waitFor();
      assert.match(await feed.innerText(), /Answer: true/);
      assert.match(await feed.innerText(), /Answer: false/);
      assert.match(await feed.innerText(), /Failed: Archive read timed out/);
      assert.doesNotMatch(await feed.innerText(), /Figure/);
      assert.equal(
        await page.evaluate(
          () => window.__originalMain === document.querySelector("main"),
        ),
        true,
      );
    },
  );
  await run(
    "6 desktop middle column; phone DOM and visual order; no overflow",
    async () => {
      for (const width of [1280, 1000, 780, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const boxes = await page.evaluate(() => ({
          copy: document
            .querySelector(".claim-copy")
            .getBoundingClientRect()
            .toJSON(),
          feed: document
            .querySelector(".swarm-feed")
            .getBoundingClientRect()
            .toJSON(),
          card: document
            .querySelector(".mint-panel>.card-figure")
            .getBoundingClientRect()
            .toJSON(),
          overflow: document.documentElement.scrollWidth > innerWidth,
          order: [...document.querySelector(".mint-panel").children].map(
            (e) => e.className,
          ),
        }));
        assert.equal(boxes.overflow, false, `overflow at ${width}`);
        if (width === 1280)
          assert.ok(
            boxes.copy.right <= boxes.feed.left &&
              boxes.feed.right <= boxes.card.left,
          );
        else
          assert.ok(
            boxes.copy.bottom <= boxes.feed.top &&
              boxes.feed.bottom <= boxes.card.top,
          );
        assert.deepEqual(boxes.order, [
          "claim-copy",
          "swarm-feed",
          "card-figure",
        ]);
        if ([1280, 390].includes(width)) {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: new URL(`claim-first-${width}.png`, output).pathname,
          });
          await page.locator("#mint").screenshot({
            path: new URL(`claim-panel-${width}.png`, output).pathname,
          });
          await page.screenshot({
            path: new URL(`claim-${width}.png`, output).pathname,
            fullPage: true,
          });
        }
      }
    },
  );
  const countReads = (name) =>
    f.state.calls.filter((p) => {
      try {
        return (
          p.method === "eth_call" &&
          p.params[0].to.toLowerCase() === registry.toLowerCase() &&
          decodeFunctionData({ abi, data: p.params[0].data }).functionName ===
            name
        );
      } catch {
        return false;
      }
    }).length;
  await run(
    "4 attestation re-reads hasTrait and Registry card; API verdict alone proves nothing",
    async () => {
      const before = {
        hasTrait: countReads("hasTrait"),
        tokenURI: countReads("tokenURI"),
      };
      live.status = "attested";
      live.attestedAt = at(120);
      live.agreement = { agreed: 3 };
      live.members.push(
        { tokenId: "113", ok: true, answer: { answer: true, figure: "42" } },
        { tokenId: "114", ok: true, answer: { answer: true, figure: "42" } },
      );
      await page.evaluate(() => window.__pollSwarm());
      await feed.getByText("attested", { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector(".pending-notice") &&
          document
            .querySelector(".card-figure figcaption")
            ?.textContent.includes("minted"),
      );
      await new Promise((resolve, reject) => {
        const end = Date.now() + 5000;
        const poll = () => {
          if (
            countReads("hasTrait") > before.hasTrait &&
            countReads("tokenURI") > before.tokenURI
          )
            return resolve();
          if (Date.now() > end)
            return reject(
              Error("Attestation did not refresh Registry card and facts"),
            );
          setTimeout(poll, 20);
        };
        poll();
      });
      assert.equal(await page.locator(".pending-notice").count(), 1);
      assert.match(
        await page.locator("#pick-601").innerText(),
        /Request pending/,
      );
    },
  );
  await run(
    "4 unreadable API says progress unavailable while chain delivery and other actions continue",
    async () => {
      unavailable = true;
      await page.evaluate(() => window.__pollSwarm());
      await feed.getByText("progress unavailable", { exact: true }).waitFor();
      assert.equal(await page.locator("#pick-701 input").isEnabled(), true);
      await page.locator("#pick-701 input").check();
      await page
        .getByRole("button", { name: "Mint selected facts", exact: true })
        .click();
      await page.locator("#payment-ack").check();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".payment-dialog button")].some(
          (b) => b.textContent === "Request 701 / Uptime" && !b.disabled,
        ),
      );
      await page
        .getByRole("button", { name: "Clear journal", exact: true })
        .click();
      const before = countReads("tokenURI");
      f.state.pending[0].cleared = true;
      f.state.proven = [601];
      await page.evaluate(() => window.__pollSwarm());
      await page
        .locator("#pick-601")
        .getByText("Already proven", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".pending-notice").count(), 0);
      assert.ok(countReads("tokenURI") > before);
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );
  await run(
    "4 progress retry recovers after independent chain completion",
    async () => {
      unavailable = false;
      await feed
        .getByRole("button", { name: "Retry progress", exact: true })
        .click();
      await feed.getByText("attested", { exact: true }).waitFor();
      assert.equal(await page.locator(".pending-notice").count(), 0);
    },
  );
  await run(
    "4 every pending fact gets its own feed, including a failed panel",
    async () => {
      const second = {
        id: 1301,
        requestId: "0x" + "d1".repeat(32),
        questionHash: "0x" + "e1".repeat(32),
        requestedAt,
      };
      const third = {
        id: 701,
        requestId: "0x" + "f1".repeat(32),
        questionHash: "0x" + "f2".repeat(32),
        requestedAt,
      };
      f.state.pending.push(second, third);
      records.push({
        ...live,
        id: "swarm-other",
        questionHash: third.questionHash,
        status: "assessing",
        attestedAt: null,
        createdAt: at(4),
      });
      const failed = {
        ...live,
        id: "swarm-failed",
        questionHash: second.questionHash,
        createdAt: at(3),
        status: "failed",
        attestedAt: null,
        panelSize: 11,
        quorum: 7,
        agreement: { agreed: 0 },
        members: [{ tokenId: "201", ok: false, reason: "No archive answered" }],
      };
      records.push(failed);
      unavailable = false;
      await page
        .getByRole("button", { name: "Retry reads", exact: true })
        .click();
      const failedFeed = page.locator("#swarm-" + second.requestId);
      await failedFeed.getByText("failed", { exact: true }).waitFor();
      await failedFeed
        .getByText("1 / 11 answers · 0 true / 7 needed", { exact: true })
        .waitFor();
      assert.match(await failedFeed.innerText(), /Failed: No archive answered/);
      assert.match(
        await page.locator(".pending-notice").innerText(),
        /1301 \/ Pretrained/,
      );
      await page
        .locator("#swarm-" + third.requestId)
        .getByText("assessing", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".swarm-request").count(), 3);
      assert.equal(await page.locator(".pending-notice p").count(), 2);
      assert.equal(await page.locator("#pick-1301 input").isDisabled(), true);
      assert.equal(await page.locator("#pick-701 input").isDisabled(), true);
      assert.equal(await page.locator("#pick-801 input").isEnabled(), true);
      await page.goto(preview.url + "#/explorer?address=" + wallet);
      await page
        .getByRole("heading", { name: "All 25 facts", exact: true })
        .waitFor();
      const settlement = page
        .locator(".settlement")
        .filter({ hasText: second.requestId });
      await settlement
        .getByRole("button", { name: "Check swarm", exact: true })
        .click();
      const explorerFeed = settlement.locator(".swarm-request");
      await explorerFeed.getByText("failed", { exact: true }).waitFor();
      await explorerFeed.locator("summary").click();
      assert.equal(await explorerFeed.getAttribute("open"), null);
      await settlement
        .getByRole("button", { name: "Check swarm", exact: true })
        .click();
      await page.waitForFunction(
        () => !!document.querySelector(".swarm-request[open]"),
      );
      await page.goto(preview.url + "#/claim");
      await page.locator(".pending-notice").waitFor();
      await page.getByRole("button", { name: /Disconnect/ }).click();
      await page.waitForFunction(
        () =>
          !document.querySelector(".swarm-feed") &&
          !document.querySelector(".pending-notice"),
      );
    },
  );
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.consoleErrors, []);
  assert.deepEqual(evidence.resourceErrors, []);
  await context.close();
} catch (e) {
  evidence.failure = e.stack;
  if (page) {
    evidence.body = await page
      .locator("body")
      .innerText()
      .catch(() => null);
    await page
      .screenshot({ path: new URL("failure.png", output).pathname })
      .catch(() => {});
  }
  process.exitCode = 1;
  console.error(e);
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser?.close();
  await preview.close();
}
