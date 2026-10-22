import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  registryLog,
  wallet,
} from "./fake-chain.mjs";
import { server } from "./harness.mjs";

const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/oracle-feed-${engine}/`,
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
const requestId = "0x" + "a1".repeat(32);
const questionHash = "0x" + "b1".repeat(32);
const tx = "0x" + "66".repeat(32);
const requestedAt = 1792600000n;
const confirmedId = "23474d49-bf7c-40e0-8dad-41636c73ea84";
const confirmedBytes = "0x23474d49bf7c40e08dad41636c73ea84" + "00".repeat(16);
const other = "0xabcdef0123456789abcdef0123456789abcdef01";
const waiting = "Waiting for the swarm to pick up the request…";
const finishing =
  "Panel agreed: 7 of 7 needed said true. Finishing: the oracle signs the answer and delivers it to the Registry; the fact appears on your card once the Registry stores it.";
const longQuestion = `Up to the last block of the request's pinned Ethereum window, did wallet ${wallet.toUpperCase()} operate an IdentityMD seat through at least three accepted swarm jobs while holding that seat? Count each accepted entry using complete historical logs, keep each holding interval in its original log order, and answer true only when the complete evidence establishes the required number. A pruned, unavailable or partial read is no evidence; do not infer an answer from an incomplete read.`;
const record = (id = "oracle-current", question = longQuestion) => ({
  id,
  question,
  jobId: "panel-job-for-" + id,
  createdAt: new Date(Number(requestedAt) * 1000).toISOString(),
  consumer: { verifyingContract: registry, chainId: 1 },
  questionHash,
  answerType: "bool",
  status: "assessing",
  panelSize: 11,
  quorum: 7,
  members: [],
  agreement: null,
});
const answer = (value, i) => ({
  tokenId: String(110 + i),
  ok: true,
  answer: { answer: value, figure: "42" },
});
const evidence = {
  engine,
  checks: [],
  errors: [],
  api: [],
  widths: [],
  contrast: [],
};
let browser, context, page, fixture;
async function run(name, fn) {
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup({
  records = [],
  exact,
  confirmed = false,
  dialog = false,
  shared = false,
} = {}) {
  if (page && !page.isClosed())
    assert.deepEqual(await page.evaluate(() => window.__signing), []);
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context);
  await context.addInitScript(() => {
    const set = window.setInterval.bind(window),
      clear = window.clearInterval.bind(window);
    const callbacks = new Map();
    let next = -1;
    window.setInterval = (fn, delay, ...args) => {
      if (delay !== 5000) return set(fn, delay, ...args);
      const id = next--;
      callbacks.set(id, () => fn(...args));
      return id;
    };
    window.clearInterval = (id) => {
      callbacks.delete(id);
      clear(id);
    };
    window.__pollSwarm = () =>
      Promise.all([...callbacks.values()].map((fn) => fn()));
  });
  if (dialog)
    await context.addInitScript(
      ({ wallet, tx, requestId }) => {
        const call = {
          label: "Request 601 / Swarmed",
          functionName: "upgrade",
          args: [601, 500000000000000000n],
          amount: 500000000000000000n,
        };
        localStorage.setItem(
          "sworn.transaction-journal",
          JSON.stringify(
            {
              plan: {
                title: "Request wallet facts",
                account: wallet,
                payment: "IMD",
                amount: call.amount,
                balance: 1000000000000000000000n,
                price: call.amount,
                lines: [{ id: 601, name: "Swarmed", amount: call.amount }],
                calls: [call],
              },
              steps: [
                {
                  label: call.label,
                  state: "confirmed",
                  hash: tx,
                  call,
                  result: { facts: [{ id: 601, name: "Swarmed", requestId }] },
                },
              ],
            },
            (_, value) =>
              typeof value === "bigint" ? { bigint: String(value) } : value,
          ),
        );
      },
      { wallet, tx, requestId },
    );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400)
      evidence.errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  fixture = fakeChain({
    token: 1n,
    allowance: 10n ** 22n,
    pending: [
      {
        id: shared ? 1201 : 601,
        requestId,
        questionHash,
        requestedAt,
        transactionHash: tx,
        ...(shared ? { claimant: "0x" + "0".repeat(40) } : {}),
      },
    ],
  });
  if (confirmed)
    fixture.state.verifiedEvents = [
      registryLog("Verified", {
        claimant: wallet,
        traitId: 601,
        requestId,
        oracleRequestId: confirmedBytes,
      }),
    ];
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", async (route) => {
    const u = new URL(route.request().url());
    evidence.api.push(u.pathname + u.search);
    assert.equal(route.request().method(), "GET");
    let body;
    if (u.pathname.startsWith("/intake/"))
      body = {
        entries: exact
          ? [{ requestId, admission: { result: { requestId: exact } } }]
          : [],
      };
    else if (u.pathname === "/oracle/requests")
      body = {
        requests: records.map(({ id, createdAt, question, jobId }) => ({
          id,
          createdAt,
          question,
          jobId,
        })),
      };
    else body = records.find((r) => u.pathname === `/oracle/requests/${r.id}`);
    assert.ok(body, "only mocked request URLs may be read");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
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
  if (dialog)
    await page
      .getByRole("button", { name: "Review transaction steps", exact: true })
      .click();
  return page.locator(
    dialog ? ".payment-dialog .swarm-request" : "#swarm-" + requestId,
  );
}
const poll = () => page.evaluate(() => window.__pollSwarm());
async function capture(feed, name) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await feed.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
    evidence.widths.push({ state: name, width, overflow: false });
    const screenshot = {
      path: new URL(`${name}-${width}.png`, output).pathname,
    };
    if (name === "dialog") {
      assert.equal(
        await page
          .locator(".payment-dialog")
          .evaluate((node) => node.scrollWidth > node.clientWidth),
        false,
      );
      await page.screenshot(screenshot);
    } else await feed.screenshot(screenshot);
  }
}
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  evidence.browserVersion = browser.version();
  await run(
    "1 matched listing rejects another wallet despite correct Registry/hash; accepts full address in uppercase",
    async () => {
      const wrong = record("aaa-wrong", `Did ${other} qualify?`);
      wrong.members = [answer(false, 999)];
      const right = record();
      right.members = [answer(true, 0)];
      const before = evidence.api.length;
      const feed = await setup({ records: [wrong, right] });
      await feed
        .getByText("Oracle request: oracle-current · matched", { exact: true })
        .waitFor();
      assert.equal(
        evidence.api.slice(before).some((url) => url.endsWith("/aaa-wrong")),
        false,
      );
      await feed.getByText("Wallet: 0X2000…0001", { exact: true }).waitFor();
      assert.doesNotMatch(await feed.innerText(), /#1109|Answer: false/);
      await capture(feed, "matched");
    },
  );
  await run(
    "1 exact Intake and Verified mismatches show refusal and named wallet, with no panel answers",
    async () => {
      for (const confirmed of [false, true]) {
        const wrong = record(
          confirmed ? confirmedId : "wrong-exact",
          `Did ${other} qualify?`,
        );
        wrong.members = [answer(true, 0)];
        const feed = await setup({
          records: [wrong, record()],
          exact: wrong.id,
          confirmed,
        });
        await feed
          .getByText("This request is not about your wallet.", { exact: true })
          .waitFor();
        assert.equal(await feed.locator(".swarm-seats").count(), 0);
        assert.equal(await feed.getByText(/Answer:/).count(), 0);
        await feed.getByText("Wallet: 0xabcd…ef01", { exact: true }).waitFor();
      }
    },
  );
  await run(
    "2 confirmed request waits with an indicator through empty listing and panel formation",
    async () => {
      const records = [];
      const feed = await setup({ records });
      await feed.getByText(waiting, { exact: true }).waitFor();
      assert.equal(await feed.locator(".swarm-loading").count(), 1);
      assert.equal(await feed.getByRole("listitem").count(), 0);
      await capture(feed, "waiting");
      const live = { ...record(), panelSize: 0, members: null };
      records.push(live);
      await poll();
      await feed.getByText(waiting, { exact: true }).waitFor();
      live.panelSize = 11;
      live.members = [];
      await poll();
      await feed
        .getByText("0 / 11 answers · 0 true / 7 needed", { exact: true })
        .waitFor();
      assert.equal(await feed.getByRole("listitem").count(), 11);
    },
  );
  await run(
    "3 unanswered seats load until their own answer; attested and failed seats stop with No answer; reduced motion stays still",
    async () => {
      const live = record();
      const feed = await setup({ records: [live] });
      await feed.getByRole("listitem").last().waitFor();
      assert.equal(await feed.locator("li .swarm-loading").count(), 11);
      const duration = await feed
        .locator(".swarm-loading")
        .first()
        .evaluate((node) => getComputedStyle(node).animationDuration);
      assert.equal(duration, "1s");
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await feed.evaluate((node) =>
        [...node.querySelectorAll(".swarm-loading")].map((spinner) => ({
          animation: getComputedStyle(spinner).animationName,
          animations: spinner.getAnimations().length,
        })),
      );
      assert.ok(
        reduced.every(
          (item) => item.animation === "none" && item.animations === 0,
        ),
      );
      live.members = [answer(true, 0)];
      await poll();
      await feed.getByText("Answer: true", { exact: true }).waitFor();
      assert.equal(await feed.locator("li .swarm-loading").count(), 10);
      live.status = "attested";
      live.attestedAt = "2026-10-22T00:02:00.000Z";
      await poll();
      await feed.getByText("attested", { exact: true }).waitFor();
      assert.equal(
        await feed.getByText("No answer", { exact: true }).count(),
        10,
      );
      assert.equal(await feed.locator(".swarm-loading").count(), 0);
      live.status = "failed";
      live.attestedAt = null;
      await poll();
      await feed.getByText("failed", { exact: true }).waitFor();
      assert.equal(
        await feed.getByText("No answer", { exact: true }).count(),
        10,
      );
      assert.equal(await feed.locator(".swarm-loading").count(), 0);
      await capture(feed, "failed");
    },
  );
  await run(
    "4 explorer link uses jobId below the request, opens a new tab and disappears without jobId",
    async () => {
      const live = record("oracle-current");
      const feed = await setup({ records: [live], exact: live.id });
      const link = feed.getByRole("link", {
        name: "View on the IMD explorer",
        exact: true,
      });
      await link.waitFor();
      const expected = "https://explorer.imd.fun/jobs/" + live.jobId;
      assert.equal(await link.getAttribute("href"), expected);
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.match(await link.getAttribute("rel"), /noopener/);
      const boxes = await feed.evaluate((node) => ({
        request: [...node.querySelectorAll("p")]
          .find((p) => p.textContent.startsWith("Oracle request:"))
          .getBoundingClientRect().bottom,
        link: node.querySelector("a").getBoundingClientRect().top,
      }));
      assert.ok(boxes.link >= boxes.request);
      await context.route(expected, (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Mock explorer panel job</title>",
        }),
      );
      const popupPromise = context.waitForEvent("page");
      await link.click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(popup.url(), expected);
      await popup.close();
      // A fresh request has no remembered job identity.
      const without = record("job-unknown");
      delete without.jobId;
      const unknown = await setup({ records: [without], exact: without.id });
      await unknown
        .getByText("Oracle request: job-unknown · exact", { exact: true })
        .waitFor();
      assert.equal(
        await unknown
          .getByRole("link", { name: "View on the IMD explorer" })
          .count(),
        0,
      );
    },
  );
  await run(
    "5 long question expands and collapses by mouse, Enter and Space; short question has no control",
    async () => {
      const live = record();
      const feed = await setup({ records: [live] });
      const toggle = feed.locator(".swarm-question button");
      await toggle.getByText("Show full question", { exact: true }).waitFor();
      const text = feed.locator(".swarm-question p");
      assert.equal(await text.textContent(), longQuestion);
      const collapsed = await text.evaluate((node) => node.clientHeight);
      await toggle.click();
      assert.equal(await toggle.textContent(), "Show less");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.ok((await text.evaluate((node) => node.clientHeight)) > collapsed);
      assert.equal(
        await text.evaluate(
          (node) => node.scrollHeight <= node.clientHeight + 1,
        ),
        true,
      );
      await poll();
      assert.equal(
        await toggle.textContent(),
        "Show less",
        "polling preserves expansion",
      );
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.focus();
      await page.keyboard.press("Enter");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Space");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(
        await toggle.evaluate(
          (node) =>
            node.matches(":focus-visible") &&
            parseFloat(getComputedStyle(node).outlineWidth) >= 2,
        ),
        true,
      );
      await feed.screenshot({
        path: new URL("question-keyboard-focus.png", output).pathname,
      });
      await capture(feed, "question");
      live.question = `${wallet}?`;
      await poll();
      await text.getByText(live.question, { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector(".swarm-question p")?.scrollHeight <=
          document.querySelector(".swarm-question p")?.clientHeight + 1,
      );
      assert.equal(await toggle.count(), 0);
    },
  );
  await run(
    "6 and 7 literal true/false counts, both quorum messages, attestation precedence and answer-only rows",
    async () => {
      const live = record();
      live.members = [
        ...Array.from({ length: 6 }, (_, i) => answer(true, i)),
        answer(false, 6),
        answer(false, 7),
      ];
      live.agreement = null;
      const feed = await setup({ records: [live] });
      await feed
        .getByText("8 / 11 answers · 6 true / 7 needed", { exact: true })
        .waitFor();
      assert.equal(
        await feed.getByText("Answer: true", { exact: true }).count(),
        6,
      );
      assert.equal(
        await feed.getByText("Answer: false", { exact: true }).count(),
        2,
      );
      assert.doesNotMatch(await feed.innerText(), /Figure|Panel agreed/);
      live.members.push(answer(true, 8));
      await poll();
      await feed.getByText(finishing, { exact: true }).waitFor();
      assert.equal(await page.locator("#pick-601 input").isDisabled(), true);
      assert.equal(
        await page
          .locator("#pick-601")
          .getByText("Already proven", { exact: true })
          .count(),
        0,
      );
      await capture(feed, "true-quorum");
      live.members = Array.from({ length: 7 }, (_, i) => answer(false, i));
      await poll();
      await feed
        .getByText("Panel agreed: false. The fact is not proven.", {
          exact: true,
        })
        .waitFor();
      await capture(feed, "false-quorum");
      live.status = "attested";
      live.attestedAt = "2026-10-22T00:02:00.000Z";
      await poll();
      await feed.getByText("attested", { exact: true }).waitFor();
      assert.equal(await feed.getByText(/Panel agreed:/).count(), 0);
      assert.equal(await feed.getByText(/Attested:/).count(), 1);
      assert.equal(
        await feed.getByText("No answer", { exact: true }).count(),
        4,
      );
    },
  );
  await run(
    "6 nonboolean summaries retain the plane agreement and say no agreement yet when absent",
    async () => {
      const live = {
        ...record(),
        answerType: "uint256",
        members: [answer("42", 0)],
      };
      const feed = await setup({ records: [live] });
      await feed
        .getByText("1 / 11 answers · no agreement yet / 7 quorum", {
          exact: true,
        })
        .waitFor();
      live.agreement = { agreed: 1 };
      await poll();
      await feed
        .getByText("1 / 11 answers · 1 agree / 7 quorum", { exact: true })
        .waitFor();
      live.agreement = { agreed: 0 };
      await poll();
      await feed
        .getByText("1 / 11 answers · no agreement yet / 7 quorum", {
          exact: true,
        })
        .waitFor();
    },
  );
  await run(
    "six-domain review: feed text, seat text, link and question control use readable rendered color pairs",
    async () => {
      const feed = page.locator("#swarm-" + requestId);
      const pairs = await feed.evaluate((node) =>
        [
          node,
          node.querySelector(".swarm-seats span"),
          node.querySelector("a"),
          node.querySelector("button"),
        ].map((element) => {
          const foreground = getComputedStyle(element).color;
          let parent = element,
            background;
          while (parent) {
            const color = getComputedStyle(parent).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
              background = color;
              break;
            }
            parent = parent.parentElement;
          }
          return { element: element.tagName, foreground, background };
        }),
      );
      const luminance = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
            0,
          );
      evidence.contrast = pairs.map((pair) => {
        const a = luminance(pair.foreground),
          b = luminance(pair.background);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(ratio >= 4.5);
        return { ...pair, ratio: Number(ratio.toFixed(2)) };
      });
    },
  );
  await run(
    "1–7 confirmed result dialog uses the same waiting, wallet guard, job link, question and live quorum rows",
    async () => {
      const live = record();
      const records = [];
      const feed = await setup({ records, dialog: true });
      await feed.getByText(waiting, { exact: true }).waitFor();
      records.push(live);
      live.members = [
        ...Array.from({ length: 6 }, (_, i) => answer(true, i)),
        answer(false, 6),
        answer(false, 7),
      ];
      await poll();
      await feed
        .getByText("8 / 11 answers · 6 true / 7 needed", { exact: true })
        .waitFor();
      assert.equal(
        await feed
          .getByRole("link", { name: "View on the IMD explorer" })
          .count(),
        1,
      );
      await feed.getByRole("button", { name: "Show full question" }).click();
      await capture(feed, "dialog");
      live.members.push(answer(true, 8));
      await poll();
      await feed.getByText(finishing, { exact: true }).waitFor();
      assert.doesNotMatch(await feed.innerText(), /Figure/);
      live.question = `Did ${other} qualify?`;
      fixture.state.verifiedEvents = [
        registryLog("Verified", {
          claimant: wallet,
          traitId: 601,
          requestId,
          oracleRequestId: confirmedBytes,
        }),
      ];
      records.push({ ...live, id: confirmedId });
      await poll();
      await feed
        .getByText("This request is not about your wallet.", { exact: true })
        .waitFor();
      assert.equal(await feed.getByRole("listitem").count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );
  assert.deepEqual(evidence.errors, []);
} catch (error) {
  evidence.failure = error.stack;
  process.exitCode = 1;
  console.error(error);
  if (page) {
    evidence.body = await page
      .locator("body")
      .innerText()
      .catch(() => null);
    await page
      .screenshot({
        path: new URL("failure.png", output).pathname,
        fullPage: true,
      })
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
