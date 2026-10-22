// Production-export interaction checks for the eight-item Mint/Wallet update.
// All wallets, API answers and RPC results in this file are synthetic.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  toHex,
  zeroAddress,
  zeroHash,
} from "viem";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  registryLog,
  sharedSpec,
  wallet,
} from "./fake-chain.mjs";
import { server } from "./harness.mjs";
const output = new URL("../../test/scratch/site-update/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const load = (file) =>
  JSON.parse(fs.readFileSync(new URL("../../dist/" + file, import.meta.url)));
const deployment = load("imd-deployment.json"),
  Registry = load("abi/Registry.json"),
  Intake = load("abi/IntakeV2.json");
const registry = deployment.contracts
  .find((c) => c.name === "Registry")
  .address.toLowerCase();
const intake =
  load("data/launch.json").intake ||
  load("../web/deployment-handoff.json").manifest.contracts.find(
    (c) => c.contract === "Registry",
  ).constructorArgs[2];
const LAUNCH = 26242885n;
const rid = "0x" + "a1".repeat(32),
  qh = "0x" + "b1".repeat(32),
  tx = "0x" + "66".repeat(32);
const uuidA = "23474d49-bf7c-40e0-8dad-41636c73ea84",
  uuidB = "33474d49-bf7c-40e0-8dad-41636c73ea84";
const bytes = (id) => "0x" + id.replaceAll("-", "") + "00".repeat(16);
const proof = (id) => [rid, bytes(id), 25769870n, 25789604n];
const community = {
  ...sharedSpec,
  name: "Shared community weights",
  threshold: 2n,
};
const evidence = { checks: [], errors: [], widths: [], recordCalls: [] };
let browser, context, page, fixture, control;
async function run(name, fn) {
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup({
  route = "#/mint",
  options = {},
  prepare,
  recordMode = "ok",
  connect = true,
  touch = false,
} = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: touch,
  });
  await fakeWallet(context);
  // Invoke scheduled polls directly, without waiting in real time.
  await context.addInitScript(() => {
    const set = window.setInterval.bind(window),
      clear = window.clearInterval.bind(window),
      polls = new Map();
    let next = -1;
    window.setInterval = (fn, ms, ...args) => {
      if (![5000, 45000].includes(ms)) return set(fn, ms, ...args);
      const id = next--;
      polls.set(id, { ms, fn: () => fn(...args) });
      return id;
    };
    window.clearInterval = (id) => {
      polls.delete(id);
      clear(id);
    };
    window.__poll = (ms) =>
      Promise.all(
        [...polls.values()].filter((p) => p.ms === ms).map((p) => p.fn()),
      );
  });
  page = await context.newPage();
  page.setDefaultTimeout(18000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    // Aborted fake record requests deliberately reproduce missing-CORS fetch failures.
    if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text()))
      evidence.errors.push(m.text());
  });
  control = {
    logs: [],
    mode: recordMode,
    records: new Map(),
    active: 0,
    maximum: 0,
    failHistory: false,
  };
  fixture = fakeChain({ token: 1n, allowance: 10n ** 22n, ...options });
  const base = fixture.answer;
  fixture.answer = async (p) => {
    if (p.method === "eth_getLogs") {
      control.logs.push(p.params[0]);
      if (control.failHistory && p.params[0].address.toLowerCase() === registry)
        throw Error("History unavailable");
    }
    return base(p);
  };
  prepare?.(fixture, control);
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", async (r) => {
    const u = new URL(r.request().url());
    const id = u.pathname.match(/^\/oracle\/requests\/([^/]+)$/)?.[1];
    if (id) {
      const count = (control.records.get(id) || 0) + 1;
      control.records.set(id, count);
      evidence.recordCalls.push({ id, count, at: Date.now() });
      control.maximum = Math.max(control.maximum, ++control.active);
      await new Promise((resolve) => setTimeout(resolve, 80));
      control.active--;
      if (control.mode === "fail" || (control.mode === "first" && count === 1))
        return r.abort("failed");
    }
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(
        id
          ? { id, jobId: "job-" + id, attestedAt: "2026-10-20T08:15:00.000Z" }
          : u.pathname === "/oracle/requests"
            ? { requests: [] }
            : { entries: [] },
      ),
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
async function widths(name, target) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (target) await target.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(scroll <= width, `${name}: ${scroll}/${width}`);
    assert.equal(
      await page.getByText("Check older blocks", { exact: true }).count(),
      0,
    );
    evidence.widths.push({ name, width, scroll });
    await page.screenshot({
      path: new URL(`${name}-${width}.png`, output).pathname,
    });
  }
}
const close = () =>
  page
    .locator(".payment-dialog")
    .getByRole("button", { name: "Close payment dialog" })
    .click();
try {
  browser = await chromium.launch();
  await run(
    "2 record network failures recover without reload; distinct records run one at a time",
    async () => {
      await setup({
        route: "#/wallet",
        recordMode: "first",
        options: {
          proven: [801, 901],
          verifiedRecords: { 801: proof(uuidA), 901: proof(uuidB) },
        },
      });
      for (const id of [801, 901]) {
        const row = page.locator(`#held-${id}`);
        await row.getByText("Attested: 2026-10-20 08:15 UTC").waitFor();
        assert.ok(
          (
            await row
              .getByRole("link", { name: id === 801 ? uuidA : uuidB })
              .getAttribute("href")
          ).startsWith("https://explorer.imd.fun/jobs/job-"),
        );
      }
      assert.equal(control.maximum, 1);
      assert.deepEqual([...control.records.values()], [2, 2]);
      for (const id of [uuidA, uuidB]) {
        const calls = evidence.recordCalls.filter((c) => c.id === id);
        assert.ok(calls.at(-1).at - calls.at(-2).at >= 1900);
      }
      await widths("record-recovered", page.locator("#held-901"));
    },
  );
  await run(
    "2 four failed reads stop across health refresh; only the row Retry starts another batch",
    async () => {
      await setup({
        route: "#/wallet",
        recordMode: "fail",
        options: { proven: [801], verifiedRecords: { 801: proof(uuidA) } },
      });
      const row = page.locator("#held-801");
      await row.getByText("Attested: time unavailable").waitFor();
      assert.equal(control.records.get(uuidA), 4);
      await row.getByRole("button", { name: "Retry", exact: true }).waitFor();
      await page.evaluate(() => window.__poll(45000));
      await page.waitForTimeout(500);
      assert.equal(control.records.get(uuidA), 4);
      control.mode = "ok";
      await row.getByRole("button", { name: "Retry", exact: true }).click();
      await row.getByText("Attested: 2026-10-20 08:15 UTC").waitFor();
      assert.equal(control.records.get(uuidA), 5);
      assert.equal(
        await row.getByRole("button", { name: "Retry", exact: true }).count(),
        0,
      );
    },
  );
  await run(
    "3 canonical routes and legacy queries/anchors; all published links use Mint and Wallet",
    async () => {
      await setup({ connect: false, route: "#/claim?trait=1201#shared-fact" });
      await page
        .getByRole("heading", { name: "Mint", exact: true, level: 1 })
        .waitFor();
      await page.locator("#pick-1201 input").waitFor();
      assert.equal(await page.locator("#pick-1201 input").isChecked(), true);
      const nav = await page.locator("nav a").allInnerTexts();
      assert.equal(nav[nav.indexOf("Mint") + 1], "Wallet");
      assert.equal(
        await page
          .locator('a[href^="#/claim"], a[href^="#/wallet-facts"]')
          .count(),
        0,
      );
      for (const route of [
        "#/wallet-facts?view=history#held-801",
        "#/wallet",
        "#/mint",
      ]) {
        await page.goto(preview.url + route);
        assert.equal(
          await page.title(),
          route.includes("mint") ? "Sworn | Mint" : "Sworn | Wallet",
        );
      }
      await page.goto(preview.url + "#/wallet-facts?view=history#held-801");
      await page
        .getByText("Connect a wallet to see its facts.", { exact: true })
        .waitFor();
      await widths("wallet-disconnected");
    },
  );
  await run(
    "4 Swarm progress is its own Mint section between Why and Add traits, and absent from Wallet",
    async () => {
      await setup({
        options: {
          pending: [
            {
              id: 801,
              requestId: rid,
              questionHash: qh,
              requestedAt: BigInt(Math.floor(Date.now() / 1000) - 600),
              transactionHash: tx,
            },
          ],
        },
      });
      const feed = page.locator('section[aria-label="Swarm progress"]');
      await feed.locator(".swarm-request").waitFor();
      assert.deepEqual(
        await feed.evaluate((el) => [
          el.previousElementSibling.querySelector("h2").textContent,
          el.nextElementSibling.querySelector("h2").textContent,
        ]),
        ["Why add traits after minting?", "Add traits"],
      );
      assert.equal(await feed.locator(".swarm-request").count(), 1);
      assert.equal(
        await page.getByText("Swarm progress: Wallet Facts").count(),
        0,
      );
      await widths("mint-progress", feed);
      await page.getByRole("link", { name: "Wallet", exact: true }).click();
      await page
        .getByRole("heading", { name: "Claimed facts", exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".swarm-feed, .swarm-request").count(),
        0,
      );
    },
  );
  await run(
    "5 every row uses the same centred preview/action columns and green 1 px border, including rows without buttons",
    async () => {
      await setup({
        options: {
          proven: [701],
          nextSpecId: 10002,
          specs: { 10001: community },
        },
      });
      await page.locator("#pick-10001 button").waitFor();
      await page.locator("#pick-1201 button").waitFor({ state: "visible" });
      const boxes = await page
        .locator("#step-02 .picker-row")
        .evaluateAll((rows) =>
          rows.map((row) => {
            const rect = (el) => el?.getBoundingClientRect().toJSON();
            const card = row.querySelector(":scope > .mini-card"),
              button = row.querySelector(":scope > .row-actions");
            return {
              id: row.id,
              row: rect(row),
              text: rect(row.firstElementChild),
              card: rect(card),
              button: rect(button),
              border: card && [
                getComputedStyle(card).borderTopWidth,
                getComputedStyle(card).borderTopColor,
              ],
              gap: getComputedStyle(row).columnGap,
            };
          }),
        );
      const cards = boxes.filter((b) => b.card),
        actions = boxes.filter((b) => b.button);
      for (const id of [1201, 10001])
        assert.ok(
          boxes.find((b) => b.id === `pick-${id}`)?.card,
          `preview for shared fact ${id}`,
        );
      const mid = (r) => r.top + r.height / 2;
      for (const b of boxes) {
        for (const key of ["card", "button"])
          if (b[key]) {
            assert.ok(
              Math.abs(mid(b.row) - mid(b[key])) < 1,
              `${b.id} ${key} centred`,
            );
            assert.ok(
              Math.abs(
                b[key].left -
                  (key === "card"
                    ? cards[0].card.left
                    : actions[0].button.left),
              ) < 1,
              `${b.id} ${key} column`,
            );
          }
        if (b.card) {
          assert.deepEqual(b.border, ["1px", "rgb(0, 255, 65)"]);
          assert.ok(
            Math.abs(b.card.left - b.text.right - parseFloat(b.gap)) < 1,
          );
          if (b.button)
            assert.ok(
              Math.abs(b.button.left - b.card.right - parseFloat(b.gap)) < 1,
            );
        }
      }
      assert.equal(await page.locator("#pick-701 button").count(), 0);
      assert.equal(await page.locator("#pick-701 .mini-card").count(), 1);
      await widths("aligned-rows", page.locator("#pick-1201"));
    },
  );
  await run(
    "6 an 8,000-block-old request finds its outcome automatically from launch, once per view; failed row reads use Retry reads",
    async () => {
      const head = 26260000n,
        old = head - 8000n;
      await setup({
        options: {
          pending: [
            {
              id: 801,
              requestId: rid,
              questionHash: qh,
              requestedAt: 1792600000n,
              transactionHash: tx,
            },
          ],
        },
        prepare: (f) => {
          const base = f.answer;
          const request = registryLog(
            "TraitRequested",
            {
              claimant: wallet,
              traitId: 801,
              requestId: rid,
              questionHash: qh,
            },
            { blockNumber: toHex(old) },
          );
          const missed = registryLog(
            "Missed",
            { requestId: rid, traitId: 801, reason: 8 },
            { blockNumber: toHex(old + 1n), logIndex: "0x1" },
          );
          f.answer = async (p) => {
            if (p.method === "eth_blockNumber") return toHex(head);
            if (p.method === "eth_getBlockByNumber" && p.params[0] === "latest")
              return { ...(await base(p)), number: toHex(head) };
            if (
              p.method === "eth_getLogs" &&
              p.params[0].address.toLowerCase() === registry
            ) {
              const result = await base(p),
                filter = p.params[0];
              return [
                ...result.filter(
                  (l) =>
                    l.topics[1] !== request.topics[1] ||
                    l.topics[0] !== request.topics[0],
                ),
                ...[request, missed].filter(
                  (l) =>
                    BigInt(filter.fromBlock) <= BigInt(l.blockNumber) &&
                    BigInt(filter.toBlock) >= BigInt(l.blockNumber) &&
                    filter.topics.every(
                      (t, i) =>
                        !t ||
                        (Array.isArray(t)
                          ? t.includes(l.topics[i])
                          : t === l.topics[i]),
                    ),
                ),
              ];
            }
            return base(p);
          };
        },
      });
      await page
        .locator(".swarm-feed")
        .getByText(/Not stored by the Registry: The answer was false/)
        .waitFor();
      const fromLaunch = () =>
        control.logs.filter((f) => BigInt(f.fromBlock) === LAUNCH).length;
      assert.ok(fromLaunch() >= 2);
      const count = fromLaunch();
      await page.evaluate(() => window.__poll(5000));
      await page.evaluate(() => window.__poll(45000));
      await page.waitForTimeout(400);
      assert.equal(
        fromLaunch(),
        count,
        "automatic polls reuse the launch read",
      );
      await widths("old-outcome", page.locator(".swarm-feed"));
      await setup({
        prepare: (f, c) => {
          c.failHistory = true;
        },
      });
      await page.locator("#pick-901 button").waitFor();
      await page.waitForTimeout(400);
      const before = control.logs.length;
      control.failHistory = false;
      await page
        .getByRole("button", { name: "Retry reads", exact: true })
        .click();
      await page.waitForTimeout(400);
      assert.ok(control.logs.length > before);
      assert.equal(
        await page.getByText("Check older blocks", { exact: true }).count(),
        0,
      );
    },
  );
  await run(
    "6 a shared fact stored 30,000 blocks ago reads its hash-checked list from launch and opens Apply shared fact",
    async () => {
      const head = LAUNCH + 31000n,
        storedAt = head - 30000n;
      const list = Array.from(
        { length: 32 },
        (_, i) =>
          "0x2" +
          BigInt(i + 1)
            .toString(16)
            .padStart(39, "0"),
      );
      const answer = encodeAbiParameters([{ type: "address[]" }], [list]);
      const a = {
        requestId: rid,
        chainId: 1n,
        questionHash: qh,
        answerType: 3,
        answer,
        figure: 32n,
        fromBlock: 25769870n,
        toBlock: 25789604n,
        blockHash: zeroHash,
        panelJobId: bytes(uuidA),
        panelSize: 11,
        quorum: 7,
        agreed: 7,
        issuedAt: 1792600000n,
        expiresAt: 1792603600n,
      };
      const payload = encodeAbiParameters(
        Registry.find((f) => f.name === "onResult").inputs,
        [rid, a, "0x" + "11".repeat(65)],
      );
      const input = encodeFunctionData({
        abi: Intake,
        functionName: "complete",
        args: [rid, 0, zeroHash, "", payload],
      });
      const event = Intake.find((e) => e.name === "Completed");
      const completed = {
        address: intake,
        blockNumber: toHex(storedAt),
        blockHash: zeroHash,
        transactionHash: tx,
        logIndex: "0x1",
        transactionIndex: "0x0",
        removed: false,
        topics: encodeEventTopics({
          abi: [event],
          eventName: "Completed",
          args: { requestId: rid },
        }),
        data: encodeAbiParameters(
          event.inputs.filter((p) => !p.indexed),
          [0, zeroHash, "", true],
        ),
      };
      await setup({
        options: { sharedFact: [rid, keccak256(answer), 32] },
        prepare: (f) => {
          const base = f.answer;
          f.answer = async (p) => {
            if (p.method === "eth_blockNumber") return toHex(head);
            if (
              p.method === "eth_getLogs" &&
              p.params[0].address.toLowerCase() === intake.toLowerCase()
            ) {
              await base(p);
              const range = p.params[0];
              return BigInt(range.fromBlock) <= storedAt &&
                BigInt(range.toBlock) >= storedAt
                ? [completed]
                : [];
            }
            if (p.method === "eth_getTransactionByHash")
              return {
                hash: tx,
                to: intake,
                from: wallet,
                input,
                nonce: "0x1",
                value: "0x0",
                gas: "0x100000",
                gasPrice: "0x1",
                blockNumber: toHex(storedAt),
                blockHash: zeroHash,
                transactionIndex: "0x0",
                v: "0x1b",
                r: zeroHash,
                s: zeroHash,
                type: "0x0",
              };
            return base(p);
          };
        },
      });
      const row = page.locator("#pick-1201"),
        apply = row.getByRole("button", { name: /Apply shared fact/ });
      await apply.waitFor();
      await page.waitForFunction(
        () => !document.querySelector("#pick-1201 button").disabled,
      );
      assert.ok(
        control.logs.some(
          (f) =>
            f.address.toLowerCase() === intake.toLowerCase() &&
            BigInt(f.fromBlock) === LAUNCH,
        ),
      );
      await apply.click();
      await page
        .locator(".payment-dialog")
        .getByText(/Apply shared fact 1201/)
        .first()
        .waitFor();
      assert.equal(await row.locator("input").isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await widths("old-shared-apply", page.locator(".payment-dialog"));
    },
  );
  await run(
    "7 shared catalog and community rows join selection, request dialog and pending rows in id order",
    async () => {
      await setup({
        options: { nextSpecId: 10002, specs: { 10001: community } },
      });
      const ids = await page
        .locator("#step-02 .picker-row")
        .evaluateAll((rows) => rows.map((r) => Number(r.id.slice(5))));
      assert.deepEqual(
        ids,
        [...ids].sort((a, b) => a - b),
      );
      assert.ok(ids.includes(1201) && ids.includes(10001));
      assert.equal(
        await page.locator(".shared-fact, #shared-fact, #shared-10001").count(),
        0,
      );
      for (const id of [1201, 10001]) {
        const row = page.locator(`#pick-${id}`);
        await row.getByRole("checkbox").waitFor();
        assert.equal(await row.locator(".mini-card").count(), 1);
        await row.getByText(/panel 11 \/ quorum 7/).waitFor();
        await row.getByText(/Attempts in the last 24 hours/).waitFor();
        await row.getByRole("button", { name: /Mint this fact/ }).waitFor();
      }
      await page
        .locator("#pick-1201")
        .getByRole("button", { name: /Mint this fact/ })
        .click();
      await page
        .locator(".payment-dialog")
        .getByText("Request shared fact 1201 / Top Weights", { exact: true })
        .first()
        .waitFor();
      await close();
      for (const id of [901, 1201])
        await page.locator(`#pick-${id} input`).check();
      await page
        .getByRole("button", { name: "Mint selected facts", exact: true })
        .click();
      const dialog = page.locator(".payment-dialog");
      for (const text of [
        "Request 901 / Final Token",
        "Request shared fact 1201 / Top Weights",
      ])
        await dialog.getByText(text, { exact: true }).first().waitFor();
      assert.equal(await page.locator(".payment-dialog[open]").count(), 1);
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
      await widths("mixed-dialog", dialog);
      await setup({
        options: {
          pending: [
            {
              id: 1201,
              requestId: rid,
              questionHash: qh,
              claimant: zeroAddress,
              requestedAt: 1792600000n,
            },
          ],
        },
      });
      await page
        .locator("#step-02 .settlement")
        .filter({ hasText: rid })
        .waitFor();
      assert.equal(await page.locator("#pick-1201 input").isDisabled(), true);
    },
  );
  await run(
    "8 hour 64 tooltip on hover, keyboard focus and tap; chart replaces table at both widths",
    async () => {
      await setup({ route: "#/whitelistcurator", connect: false, touch: true });
      const bar = page.getByRole("button", { name: "Hour 64", exact: true });
      await bar.hover();
      const tooltip = page.getByRole("tooltip");
      for (const text of [
        "Hour 64",
        "Deposits: 8",
        "ETH: 11",
        "First deposits: 6",
      ])
        await tooltip.getByText(text, { exact: true }).waitFor();
      await page.mouse.move(0, 0);
      await bar.focus();
      await tooltip.waitFor();
      await page.keyboard.press("ArrowRight");
      await tooltip.getByText("Hour 65", { exact: true }).waitFor();
      await page.keyboard.press("ArrowLeft");
      await tooltip.getByText("Hour 64", { exact: true }).waitFor();
      await page.keyboard.press("Home");
      await tooltip.getByText("Hour 0", { exact: true }).waitFor();
      await page.keyboard.press("End");
      await tooltip.getByText("Hour 65", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await tooltip.count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await bar.tap();
      await tooltip.getByText("First deposits: 6").waitFor();
      assert.equal(await page.locator("#hours table").count(), 0);
      assert.equal(
        await page.getByText(/table can scroll sideways/).count(),
        0,
      );
      await page
        .getByRole("link", { name: "Download census and provenance ↗" })
        .waitFor();
      await widths("hour-64", tooltip);
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
