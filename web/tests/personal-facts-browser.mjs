import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import {
  parseAbiItem,
  encodeAbiParameters,
  encodeEventTopics,
  toHex,
} from "viem";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  registryLog,
  wallet,
} from "./fake-chain.mjs";
import { server } from "./harness.mjs";
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const group = process.argv.find((a) => a.startsWith("--group="))?.split("=")[1];
let groupIndex = 0;
const output = new URL(
  `../../test/scratch/personal-facts-${engine}${group ? `-${group}` : ""}/`,
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
const target = "0x3000000000000000000000000000000000000002";
const curator = "0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91";
const requestId = "0x" + "a1".repeat(32),
  questionHash = "0x" + "b1".repeat(32),
  tx = "0x" + "66".repeat(32);
const oracleId = "23474d49-bf7c-40e0-8dad-41636c73ea84",
  oracleBytes = "0x23474d49bf7c40e08dad41636c73ea84" + "00".repeat(16);
const spec = {
  kind: 1,
  target,
  item: "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount)",
  arg: "contributor",
  fixedArg: "hour",
  fixedVal: 64n,
  sumArg: "",
  op: 0,
  threshold: 1n,
  fromBlock: 25769870n,
  toBlock: 25789604n,
  name: "Holdout",
};
const member = (v) => ({ ok: true, answer: { answer: v } });
const record = (answers = [], extra = {}) => ({
  id: oracleId,
  createdAt: new Date(1792600000000).toISOString(),
  consumer: { verifyingContract: registry, chainId: 1 },
  questionHash,
  question: `At Curator ${curator}, did wallet ${wallet} meet the rule?`,
  panelSize: 5,
  quorum: 3,
  answerType: "uint256",
  status: "assessing",
  members: answers.map(member),
  ...extra,
});
const noFact =
  "No fact was added. The request price is spent; you can request this fact again.";
const unknown =
  "Could not check eligibility; the request price is spent whatever the answer.";
const ending = (eventName, reason = 8, id = requestId) =>
  registryLog(
    eventName,
    {
      requestId: id,
      traitId: 801,
      claimant: wallet,
      oracleRequestId: oracleBytes,
      reason: eventName === "NoVerdict" ? "0x" + "00".repeat(32) : reason,
      status: 1,
      agreed: 1,
      answered: 5,
    },
    { logIndex: "0x10" },
  );
let browser, context, page, fixture, control;
const evidence = {
  engine,
  checks: [],
  errors: [],
  widths: [],
  screenshots: [],
  contrast: [],
};
async function run(name, fn) {
  if (group && ++groupIndex !== Number(group)) return;
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup({
  records = [],
  id = 801,
  kind = 1,
  pending = true,
  connect = true,
  explorer = false,
  history,
  mode = "met",
  listJob,
  prepare,
  // Round 8: an open request's feed is on Wallet Facts, not Claim.
  feed = pending && !explorer && kind !== 3,
} = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context);
  // Round 8: the two-hour notice follows the clock. Pin it 10 minutes after
  // the fixtures' request time so their requests are not yet two hours old.
  await context.clock.setFixedTime(1792600000 * 1000 + 600000);
  await context.addInitScript((slow) => {
    const set = window.setInterval.bind(window),
      clear = window.clearInterval.bind(window),
      callbacks = new Map();
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
    window.__poll = () =>
      Promise.all([...callbacks.values()].map((fn) => fn()));
    // Exercise the production deadline branch without a real 20-second wait.
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) =>
      timeout(fn, delay === 20000 && slow ? 150 : delay, ...args);
    window.__walletReads = [];
    const request = window.ethereum.request;
    window.ethereum.request = (arg) => {
      window.__walletReads.push(arg.method);
      return request(arg);
    };
  }, mode === "slow");
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.url().startsWith(preview.url) && r.status() >= 400)
      evidence.errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  control = {
    records,
    exact: false,
    mode,
    listJob,
    reads: [],
    api: [],
    held: [],
    logs: [],
  };
  const s = {
    ...spec,
    kind,
    threshold: kind === 5 ? 20n : 1n,
    ...(kind === 5 ? { toBlock: 25769870n } : {}),
  };
  fixture = fakeChain({
    nextSpecId: id >= 10001 ? id + 1 : 10001,
    token: 1n,
    allowance: 10n ** 22n,
    price: 1250000000000000000n,
    specs: {
      [id]: s,
      1301: { ...spec, kind: 5, threshold: 20n, toBlock: 25769870n },
      601: {
        ...spec,
        kind: 6,
        target: "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D",
        fromBlock: 25090085n,
        toBlock: 0n,
        threshold: 3n,
        item: "",
        arg: "",
        fixedArg: "",
        fixedVal: 0n,
      },
    },
    pending:
      pending || history
        ? [
            {
              id,
              requestId,
              questionHash,
              requestedAt: 1792600000n,
              transactionHash: tx,
              cleared: !!history,
              ...(kind === 3 ? { claimant: "0x" + "0".repeat(40) } : {}),
            },
          ]
        : [],
  });
  if (history)
    fixture.state.verifiedEvents = [ending(history.eventName, history.reason)];
  const base = fixture.answer;
  fixture.answer = async (p) => {
    const f = p.params?.[0];
    const logs =
      p.method === "eth_getLogs" &&
      [
        target.toLowerCase(),
        "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d",
      ].includes(f.address.toLowerCase());
    if (logs || p.method === "eth_getTransactionCount") {
      control.reads.push(p);
      if (control.mode === "refused") throw Error("Archive state unavailable");
      if (control.mode === "slow") return new Promise(() => {});
      if (control.mode === "held")
        return new Promise((resolve) =>
          control.held.push(() =>
            resolve(p.method === "eth_getTransactionCount" ? "0x0" : []),
          ),
        );
      if (p.method === "eth_getTransactionCount") return "0x14";
      if (control.mode === "not-met") return [];
      const seat = f.address.toLowerCase().startsWith("0x0000ec");
      const event = parseAbiItem(
        seat
          ? "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"
          : spec.item,
      );
      const block = seat ? 25090085n : 25769871n;
      if (BigInt(f.fromBlock) > block || BigInt(f.toBlock) < block) return [];
      return [
        {
          address: f.address,
          blockNumber: toHex(block),
          blockHash: "0x" + "11".repeat(32),
          transactionHash: "0x" + "22".repeat(32),
          logIndex: "0x0",
          removed: false,
          topics: encodeEventTopics({
            abi: [event],
            eventName: event.name,
            args: seat
              ? { from: target, to: wallet, tokenId: 1n }
              : { contributor: wallet, hour: 64n },
          }),
          data: seat ? "0x" : encodeAbiParameters([{ type: "uint256" }], [1n]),
        },
      ];
    }
    if (p.method === "eth_getLogs") control.logs.push(f);
    if (control.head !== undefined) {
      if (p.method === "eth_blockNumber") return toHex(control.head);
      if (p.method === "eth_getBlockByNumber" && p.params[0] === "latest")
        return { ...(await base(p)), number: toHex(control.head) };
    }
    return base(p);
  };
  prepare?.(fixture, control);
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", async (route) => {
    const u = new URL(route.request().url());
    control.api.push(u.pathname + u.search);
    assert.equal(route.request().method(), "GET");
    const body = u.pathname.startsWith("/intake/")
      ? {
          entries: control.exact
            ? [{ requestId, admission: { result: { requestId: oracleId } } }]
            : [],
        }
      : u.pathname === "/oracle/requests"
        ? {
            requests: control.records.map((r) => ({
              ...r,
              ...(control.listJob ? { jobId: control.listJob } : {}),
            })),
          }
        : control.records.find((r) => u.pathname.endsWith("/" + r.id));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body || {}),
    });
  });
  await page.goto(
    preview.url + (explorer ? "#/explorer?address=" + wallet : "#/claim"),
  );
  await page.getByText(/Dependencies verified/).waitFor();
  if (connect) {
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
    await page.locator(`#pick-${id >= 10001 ? id : 801}`).waitFor();
    if (feed) await page.evaluate(() => (location.hash = "#/wallet-facts"));
  }
  if (kind === 3)
    await page
      .locator("#shared-fact")
      .getByRole("button", { name: "Check swarm", exact: true })
      .click();
  if (explorer) {
    await page
      .getByRole("heading", { name: "All 25 facts", exact: true })
      .waitFor();
    await page
      .locator(".settlement")
      .filter({ hasText: requestId })
      .getByRole("button", { name: "Check swarm", exact: true })
      .click();
  }
  return page.locator(".swarm-request").first();
}
const poll = () => page.evaluate(() => window.__poll());
async function capture(name, element) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (element) await element.scrollIntoViewIfNeeded();
    const actual = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(actual <= width, `overflow ${actual} at ${width}`);
    evidence.widths.push({ name, width, actual });
    if (width === 390) {
      const pairs = await page
        .locator(
          ".eligibility-advice, .payment-dialog p.danger, .swarm-list-answer > span",
        )
        .evaluateAll((nodes) =>
          nodes
            .filter((n) => n.getClientRects().length)
            .slice(0, 4)
            .map((node) => {
              let parent = node,
                background;
              while (parent) {
                background = getComputedStyle(parent).backgroundColor;
                if (background !== "rgba(0, 0, 0, 0)") break;
                parent = parent.parentElement;
              }
              return { foreground: getComputedStyle(node).color, background };
            }),
        );
      for (const pair of pairs) {
        const luminance = (color) =>
          color
            .match(/\d+/g)
            .slice(0, 3)
            .map((v) => Number(v) / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(pair.foreground),
          b = luminance(pair.background);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(ratio >= 4.5, `text contrast ${ratio}`);
        evidence.contrast.push({ name, ...pair, ratio });
      }
    }
    const filename = `${name}-${width}.png`;
    await page.screenshot({ path: new URL(filename, output).pathname });
    evidence.screenshots.push(filename);
  }
}
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  await run(
    "1 count quorum met/below, boolean true/false, and persistence after attestation",
    async () => {
      for (const [kind, answers, summary, agreement] of [
        [
          1,
          ["1", "2", "3"],
          "3 meet the rule / 3 needed",
          "Panel agreed: 3 of 3 needed found the rule met (at least 1). Finishing: the oracle signs the answer and delivers it to the Registry; the fact appears on your card once the Registry stores it.",
        ],
        [
          2,
          ["0", "0", "0"],
          "0 meet the rule / 3 needed",
          "Panel agreed: below 1. The fact is not proven.",
        ],
        [
          5,
          [true, true, true],
          "3 true / 3 needed",
          "Panel agreed: 3 of 3 needed said true. Finishing: the oracle signs the answer and delivers it to the Registry; the fact appears on your card once the Registry stores it.",
        ],
        [
          5,
          [false, false, false],
          "0 true / 3 needed",
          "Panel agreed: false. The fact is not proven.",
        ],
      ]) {
        const live = record(answers, {
            answerType: kind === 5 ? "bool" : "uint256",
          }),
          feed = await setup({ records: [live], kind });
        await feed
          .getByText(`3 / 5 answers · ${summary}`, { exact: true })
          .waitFor();
        await feed.getByText(agreement, { exact: true }).waitFor();
        live.status = "attested";
        live.attestedAt = "2026-10-22T00:02:00.000Z";
        await poll();
        await feed.getByText("attested", { exact: true }).waitFor();
        await feed.getByText(agreement, { exact: true }).waitFor();
        await capture(`quorum-${kind}-${String(answers[0])}`, feed);
      }
    },
  );
  await run(
    "1 Verified, Missed reason 8, NoVerdict and failed API show exact end text",
    async () => {
      for (const [eventName, line] of [
        ["Verified", "Stored by the Registry; your card shows the fact."],
        [
          "Missed",
          "Not stored by the Registry: The answer was false. The request price is spent; you can request this fact again.",
        ],
        ["NoVerdict", noFact],
        ["failed", noFact],
      ]) {
        const live = record(["1", "2", "3"]),
          feed = await setup({ records: [live] });
        await feed.getByText(/Panel agreed:/).waitFor();
        live.status = eventName === "failed" ? "failed" : "attested";
        if (eventName !== "failed") {
          fixture.state.verifiedEvents = [ending(eventName)];
          fixture.state.pending[0].cleared = true;
        }
        await poll();
        await feed.getByText(line, { exact: true }).waitFor();
        if (eventName !== "failed")
          assert.equal(await feed.getByText(/Panel agreed:/).count(), 0);
        await capture(`end-${eventName}`, feed);
      }
    },
  );
  await run(
    "2 row histories for Missed 8/9, NoVerdict, Abandoned; other wallet does not alter history",
    async () => {
      for (const [eventName, reason, endingText] of [
        ["Missed", 8, "answer false"],
        ["Missed", 9, "not stored, Malformed answer"],
        ["NoVerdict", 0, "no verdict"],
        ["Abandoned", 0, "abandoned"],
      ]) {
        await setup({ pending: false, history: { eventName, reason } });
        const row = page.locator("#pick-801"),
          line = `Last request 2026-10-21 16:26 UTC: ${endingText}`;
        await row.getByText(line, { exact: true }).waitFor();
        fixture.state.pending.push({
          id: 801,
          requestId: "0x" + "c1".repeat(32),
          questionHash,
          requestedAt: 1792600000n,
          claimant: target,
          cleared: true,
        });
        fixture.state.verifiedEvents.push(
          ending("Missed", 7, "0x" + "c1".repeat(32)),
        );
        await page.reload();
        await row.getByText(line, { exact: true }).waitFor();
        assert.equal(await row.getByText(/Last request/).count(), 1);
        await capture(`history-${eventName}-${reason}`, row);
      }
    },
  );
  await run(
    "3 32-wallet list summaries, rank, majority then attested list, mouse/keyboard full disclosure",
    async () => {
      const list = Array.from(
        { length: 32 },
        (_, i) =>
          "0x2" +
          BigInt(i + 1)
            .toString(16)
            .padStart(39, "0"),
      );
      const reversed = [...list].reverse();
      const live = record([list, list, list, reversed], {
          answerType: "address[]",
        }),
        feed = await setup({ records: [live], id: 1201, kind: 3 });
      await feed
        .getByText(
          "Answer: list of 32 wallets · same as the agreed list · your wallet at #1",
          { exact: true },
        )
        .first()
        .waitFor();
      assert.equal(
        await feed
          .getByText(
            "Answer: list of 32 wallets · same as the agreed list · your wallet at #1",
            { exact: true },
          )
          .count(),
        3,
      );
      await feed
        .getByText(
          "Answer: list of 32 wallets · differs from the agreed list · your wallet at #32",
          { exact: true },
        )
        .waitFor();
      const seat = feed.locator(".swarm-seats > li").first();
      await seat
        .getByRole("button", { name: "Show list", exact: true })
        .click();
      assert.equal(await seat.locator(".swarm-wallet-list li").count(), 32);
      assert.equal(await seat.locator(".swarm-wallet-list").isVisible(), true);
      for (const a of list) assert.ok((await seat.innerText()).includes(a));
      await capture("list-expanded", seat);
      await seat
        .getByRole("button", { name: "Hide list", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      assert.equal(await seat.locator(".swarm-wallet-list").isVisible(), false);
      await page.keyboard.press("Space");
      assert.equal(await seat.locator(".swarm-wallet-list").isVisible(), true);
      assert.equal(
        await seat.getByRole("button").getAttribute("aria-expanded"),
        "true",
      );
      await capture("list-keyboard", seat);
      live.status = "attested";
      live.answer = { answer: reversed };
      await poll();
      await seat
        .getByText(
          "Answer: list of 32 wallets · differs from the agreed list · your wallet at #1",
          { exact: true },
        )
        .waitFor();
    },
  );
  await run(
    "4/5 Explorer without wallet uses claimant, shows expected wallet on mismatch, retains listing job after Registry confirmation",
    async () => {
      const live = record(["1"]),
        feed = await setup({
          records: [live],
          connect: false,
          explorer: true,
          listJob: "listing-only-job",
        });
      await feed.getByText("Answer: 1", { exact: true }).waitFor();
      await feed.getByText("Wallet: 0x2000…0001", { exact: true }).waitFor();
      const link = feed.getByRole("link", { name: "View on the IMD explorer" });
      assert.equal(
        await link.getAttribute("href"),
        "https://explorer.imd.fun/jobs/listing-only-job",
      );
      control.exact = true;
      control.listJob = undefined;
      await poll();
      await feed.getByText(/· exact/).waitFor();
      assert.match(await link.getAttribute("href"), /listing-only-job$/);
      fixture.state.verifiedEvents = [ending("Verified")];
      await poll();
      await feed.getByText(/confirmed by the Registry/).waitFor();
      assert.match(await link.getAttribute("href"), /listing-only-job$/);
      live.question = `At Curator ${curator}, did ${target} qualify?`;
      await poll();
      await feed
        .getByText("This request is not about this wallet.", { exact: true })
        .waitFor();
      await feed
        .getByText("Expected wallet: 0x2000…0001", { exact: true })
        .waitFor();
      assert.equal(await feed.locator(".swarm-seats").count(), 0);
      assert.equal(
        await feed.getByText("Wallet: 0xcb0b…da91", { exact: true }).count(),
        0,
      );
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await capture("explorer-mismatch", feed);
    },
  );
  await run(
    "6 met and not-met results match row/dialog; negative request requires Request anyway before fake signing prompt",
    async () => {
      for (const mode of ["met", "not-met"]) {
        await setup({ pending: false, mode, id: 10001 });
        const row = page.locator("#pick-10001");
        await row.locator("input").check();
        const found =
          mode === "met"
            ? "1 matching event; at least 1 required"
            : "0 matching events; at least 1 required";
        const text =
          mode === "met"
            ? `Our check of the public chain data finds this rule met (${found}). The panel decides.`
            : `This wallet does not meet this rule (${found}). The panel will most likely answer false and the 1.25 IMD request price is spent.`;
        await row.getByText(text, { exact: true }).waitFor();
        const reads = control.reads.length;
        const walletReads = await page.evaluate(() =>
          window.__walletReads.slice(),
        );
        await page
          .getByRole("button", { name: "Mint selected facts", exact: true })
          .click();
        const dialog = page.locator(".payment-dialog");
        await dialog.getByText(text, { exact: true }).waitFor();
        assert.ok(control.reads.length > reads, "dialog rechecks public logs");
        assert.deepEqual(
          await page.evaluate(() => window.__walletReads),
          walletReads,
          "eligibility did not call the wallet",
        );
        await dialog.locator("#payment-ack").check();
        const action = dialog.getByRole("button", {
          name: "Request 10001 / Holdout",
          exact: true,
        });
        await dialog.getByText("simulated", { exact: true }).waitFor();
        if (mode === "not-met") {
          assert.equal(await action.isDisabled(), true);
          assert.deepEqual(await page.evaluate(() => window.__signing), []);
          await capture("eligibility-negative", dialog);
          await dialog
            .getByRole("button", { name: "Request anyway", exact: true })
            .click();
        }
        await action.click();
        await page.waitForFunction(() => window.__signing.length === 1);
        await dialog.getByText("rejected", { exact: true }).waitFor();
        await dialog
          .getByRole("button", { name: "Close payment dialog" })
          .click();
        await row.getByText(text, { exact: true }).waitFor();
        await capture("eligibility-" + mode, row);
        if (mode === "not-met") {
          fixture.state.allowance = 0n;
          await page
            .getByRole("button", { name: "Mint selected facts", exact: true })
            .click();
          await dialog.getByText(text, { exact: true }).waitFor();
          await dialog.locator("#payment-ack").check();
          await dialog.getByText("simulated", { exact: true }).waitFor();
          const approval = dialog.getByRole("button", {
            name: "Approve IMD",
            exact: true,
          });
          assert.equal(
            await approval.isDisabled(),
            true,
            "new plan resets the extra confirmation before approval",
          );
          await dialog
            .getByRole("button", { name: "Request anyway", exact: true })
            .focus();
          await page.keyboard.press("Enter");
          await approval.click();
          await page.waitForFunction(() => window.__signing.length === 2);
          await dialog.getByText("rejected", { exact: true }).waitFor();
        }
      }
    },
  );
  await run(
    "6 refused and slow reads show advisory warning and still reach the fake wallet; no extra confirmation",
    async () => {
      for (const mode of ["refused", "slow"]) {
        await setup({ pending: false, mode, id: 10001 });
        const row = page.locator("#pick-10001");
        await row.locator("input").check();
        await row.getByText(unknown, { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "Mint selected facts", exact: true })
          .click();
        const dialog = page.locator(".payment-dialog");
        await dialog.getByText(unknown, { exact: true }).waitFor();
        assert.equal(
          await dialog.getByRole("button", { name: "Request anyway" }).count(),
          0,
        );
        await dialog.locator("#payment-ack").check();
        const action = dialog.getByRole("button", {
          name: "Request 10001 / Holdout",
          exact: true,
        });
        await dialog.getByText("simulated", { exact: true }).waitFor();
        await action.click();
        await page.waitForFunction(() => window.__signing.length === 1);
        await capture("eligibility-" + mode, dialog);
      }
    },
  );
  await run(
    "6 nonce uses block 25769870; Swarmed queries seat transfers from 25090085 and stops after first hit",
    async () => {
      await setup({ pending: false });
      await page.locator("#pick-1301 input").check();
      await page
        .locator("#pick-1301")
        .getByText(/nonce 20 at block 25769870/)
        .waitFor();
      const nonces = control.reads.filter(
        (p) => p.method === "eth_getTransactionCount",
      );
      assert.equal(nonces.length, 1);
      assert.deepEqual(nonces[0].params, [wallet, toHex(25769870)]);
      await page.locator("#pick-601 input").check();
      await page
        .locator("#pick-601")
        .getByText(/received an IdentityMD seat/)
        .waitFor();
      const seats = control.reads.filter(
        (p) =>
          p.method === "eth_getLogs" &&
          p.params[0].address.toLowerCase().startsWith("0x0000ec"),
      );
      assert.equal(
        seats.length,
        2,
        "two endpoint agreement, one bounded chunk",
      );
      assert.equal(seats[0].params[0].fromBlock, toHex(25090085));
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await capture("eligibility-seat", page.locator("#pick-601"));
    },
  );
  // Revision: reviewer findings on read windows, history and late consent.
  const launchBlock = 26242885n;
  const registryLogs = (from = 0) =>
    control.logs
      .slice(from)
      .filter((f) => f.address.toLowerCase() === registry.toLowerCase());
  await run(
    "R1 another wallet's Registry outcome keeps this wallet's Last request line and row controls",
    async () => {
      const otherWallet = "0x3000000000000000000000000000000000000003",
        other = "0x" + "c3".repeat(32);
      await setup({
        pending: false,
        history: { eventName: "Missed", reason: 8 },
        prepare: (f) => {
          f.state.pending.push({
            id: 901,
            requestId: other,
            questionHash,
            requestedAt: 1792600000n,
            cleared: true,
            claimant: otherWallet,
          });
          f.state.verifiedEvents.push(
            registryLog(
              "Abandoned",
              {
                requestId: other,
                traitId: 901,
                claimant: otherWallet,
                oracleRequestId: oracleBytes,
                reason: 0,
                status: 1,
                agreed: 1,
                answered: 5,
              },
              { logIndex: "0x11" },
            ),
          );
        },
      });
      await page
        .locator("#pick-801")
        .getByText(/^Last request .* UTC: answer false$/)
        .waitFor();
      assert.ok((await page.locator(".row-history button").count()) > 0);
      await capture("history-other-wallet", page.locator("#pick-801"));
    },
  );
  await run(
    "R2 rows and shared line read only the last 7,200 blocks; one row's Check older blocks shows the result on every row",
    async () => {
      const head = 26260000n;
      await setup({
        pending: false,
        prepare: (f, c) => {
          c.head = Number(head);
        },
      });
      await page
        .locator("#shared-fact")
        .getByText(
          /Attempts in the last 24 hours: 0\. Last panel result: none in the last 24 hours\./,
        )
        .waitFor();
      await page
        .getByRole("button", { name: "Check older blocks for fact 901" })
        .waitFor();
      const before = control.logs.length;
      assert.ok(before > 0);
      for (const f of control.logs)
        assert.ok(BigInt(f.fromBlock) >= head - 7199n, f.fromBlock);
      await page
        .getByRole("button", { name: "Check older blocks for fact 801" })
        .click();
      for (const id of [801, 901])
        await page
          .locator(`#pick-${id}`)
          .getByText("No request found since launch.", { exact: true })
          .waitFor();
      assert.ok(
        registryLogs(before).some((f) => BigInt(f.fromBlock) === launchBlock),
      );
      await capture("history-older", page.locator("#pick-901"));
    },
  );
  await run(
    "R3 a stored shared fact reads its completion only inside 24 hours until Check older blocks",
    async () => {
      const head = 26260000n;
      await setup({
        pending: false,
        prepare: (f, c) => {
          c.head = Number(head);
          f.state.sharedFact = [
            "0x" + "d4".repeat(32),
            "0x" + "e5".repeat(32),
            1,
          ];
        },
      });
      const shared = page.locator("#shared-fact");
      await shared.getByText(/^Stored · no further request needed/).waitFor();
      await shared.getByText(/Attempts in the last 24 hours: 0\./).waitFor();
      const before = control.logs.length;
      for (const f of control.logs)
        assert.ok(BigInt(f.fromBlock) >= head - 7199n, f.fromBlock);
      await shared
        .getByRole("button", { name: "Check older blocks", exact: true })
        .click();
      await shared
        .getByText(/Attempts: 0\. Last panel result: none\./)
        .waitFor();
      const older = control.logs.slice(before);
      assert.ok(
        older.some(
          (f) =>
            BigInt(f.fromBlock) === launchBlock &&
            f.address.toLowerCase() !== registry.toLowerCase(),
        ),
        "intake completion read from launch on demand",
      );
      assert.ok(
        registryLogs(before).some((f) => BigInt(f.fromBlock) === launchBlock),
      );
    },
  );
  await run(
    "R4 a watched request that ages past the 600-block feed window shows the stale line and Check older blocks",
    async () => {
      const feed = await setup({});
      await feed
        .getByText("Waiting for the swarm to pick up the request…")
        .waitFor();
      await feed
        .getByRole("button", { name: "Check older blocks", exact: true })
        .waitFor();
      const before = control.logs.length;
      control.head = 26250700;
      await poll();
      await feed
        .getByText("Requested more than 2 hours ago.", { exact: true })
        .waitFor();
      const recent = registryLogs(before);
      assert.ok(recent.length > 0);
      for (const f of recent)
        assert.ok(BigInt(f.fromBlock) >= 26250700n - 599n, f.fromBlock);
      const marker = control.logs.length;
      await feed
        .getByRole("button", { name: "Check older blocks", exact: true })
        .click();
      await feed
        .getByText("No Registry outcome found since launch.", { exact: true })
        .waitFor();
      assert.ok(
        registryLogs(marker).some((f) => BigInt(f.fromBlock) === launchBlock),
      );
      await capture("feed-stale", feed);
    },
  );
  await run(
    "R5 a not-met result arriving during the wallet's own chain check still needs Request anyway before signing",
    async () => {
      await setup({ pending: false, mode: "held" });
      const row = page.locator("#pick-1301");
      await row.locator("input").check();
      await row.getByText("Checking eligibility…", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Mint selected facts", exact: true })
        .click();
      const dialog = page.locator(".payment-dialog");
      await dialog.locator("#payment-ack").check();
      await dialog.getByText("simulated", { exact: true }).waitFor();
      await dialog.getByText("Checking eligibility…").first().waitFor();
      // Hold the eth_chainId viem sends inside writeContract (the first one
      // after the explicit account check), as a slow wallet would.
      await page.evaluate(() => {
        const request = window.ethereum.request;
        let accounts = false;
        window.__held = null;
        window.ethereum.request = (arg) => {
          if (arg.method === "eth_accounts") accounts = true;
          else if (arg.method === "eth_chainId" && accounts && !window.__held)
            return new Promise((resolve) => {
              window.__held = () => resolve(request(arg));
            });
          return request(arg);
        };
      });
      await dialog
        .getByRole("button", { name: "Request 1301 / Pretrained", exact: true })
        .click();
      await page.waitForFunction(() => !!window.__held);
      control.mode = "not-met";
      control.held.splice(0).forEach((release) => release());
      await dialog
        .getByText(/does not meet this rule \(nonce 0 at block 25769870\)/)
        .first()
        .waitFor();
      await dialog
        .getByRole("button", { name: "Request anyway", exact: true })
        .waitFor();
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await page.evaluate(() => window.__held());
      await dialog
        .getByText(
          "This wallet does not meet this rule. Press Request anyway to continue.",
        )
        .first()
        .waitFor();
      await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      assert.equal(
        await dialog.getByText("rejected", { exact: true }).count(),
        0,
      );
      await dialog
        .getByRole("button", { name: "Request anyway", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Request 1301 / Pretrained", exact: true })
        .click();
      await page.waitForFunction(() => window.__signing.length === 1);
      await capture("late-consent", dialog);
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
      .catch(() => "unavailable");
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
