import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { decodeFunctionData, zeroAddress } from "viem";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  registryLog,
  rpcCalls,
  wallet,
} from "./fake-chain.mjs";
import { server } from "./harness.mjs";
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/followup-${engine}/`,
  import.meta.url,
);
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
const requestedAt = 1792600000n;
const tx = "0x" + "66".repeat(32);
const requestId = "0x" + "a1".repeat(32);
const questionHash = "0x" + "b1".repeat(32);
const confirmedId = "23474d49-bf7c-40e0-8dad-41636c73ea84";
const confirmedBytes = "0x23474d49bf7c40e08dad41636c73ea84" + "00".repeat(16);
const request = (id, seconds = 1, hash = questionHash) => ({
  id,
  createdAt: new Date((Number(requestedAt) + seconds) * 1000).toISOString(),
  consumer: { verifyingContract: registry, chainId: 1 },
  questionHash: hash,
  question: `Did wallet ${wallet} meet the condition?`,
  answerType: "bool",
  status: "assessing",
  panelSize: 5,
  quorum: 3,
  members: [
    { tokenId: "110", ok: true, answer: { answer: true, figure: "42" } },
  ],
  agreement: { agreed: 1 },
});
const evidence = {
  at: new Date().toISOString(),
  engine,
  checks: [],
  errors: [],
  api: [],
};
let browser, page, context;
async function run(name, fn) {
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup(fixture, options = {}) {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await fakeWallet(context);
  // Round 8: the two-hour notice follows the clock. Pin it 10 minutes after
  // the fixtures' request time so their requests are not yet two hours old.
  await context.clock.setFixedTime(1792600000 * 1000 + 600000);
  await context.addInitScript(() => {
    const interval = window.setInterval.bind(window),
      clear = window.clearInterval.bind(window);
    const callbacks = new Map();
    window.setInterval = (fn, delay, ...args) => {
      const id = interval(fn, delay, ...args);
      if (delay === 5000) callbacks.set(id, () => fn(...args));
      return id;
    };
    window.clearInterval = (id) => {
      callbacks.delete(id);
      clear(id);
    };
    window.__pollSwarm = () =>
      Promise.all([...callbacks.values()].map((fn) => fn()));
    // A browser fetch refusal, without browser-generated network console noise.
    const fetcher = window.fetch.bind(window);
    window.__cachedDetailFailures = [];
    window.fetch = (...args) => {
      if (
        window.__intakeRefused &&
        String(args[0]).includes("api.imd.fun/intake/")
      )
        return Promise.reject(TypeError("Failed to fetch"));
      if (
        window.__cachedDetailUnavailable &&
        String(args[0]) === "https://api.imd.fun/oracle/requests/exact-request"
      ) {
        window.__cachedDetailFailures.push(String(args[0]));
        return Promise.resolve(new Response("", { status: 503 }));
      }
      return fetcher(...args);
    };
  });
  if (options.refuse)
    await context.addInitScript(() => {
      window.__intakeRefused = true;
    });
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
  await mockPage(page, fixture);
  const data = options.records || [request("exact-request")];
  await page.route("https://api.imd.fun/**", async (route) => {
    const u = new URL(route.request().url());
    assert.equal(route.request().method(), "GET");
    evidence.api.push(u.pathname + u.search);
    let body;
    if (u.pathname.startsWith("/intake/")) {
      assert.equal(u.pathname, `/intake/1/${tx}`);
      body = {
        entries: [
          {
            requestId: "0x" + "f1".repeat(32),
            admission: { result: { requestId: "wrong-entry" } },
          },
          { requestId, admission: { result: { requestId: "exact-request" } } },
        ],
      };
    } else if (u.pathname === "/oracle/requests") {
      assert.equal(u.searchParams.get("q"), options.shared ? null : wallet);
      body = {
        requests: data.map(({ id, createdAt, question, jobId }) => ({
          id,
          createdAt,
          question,
          jobId,
        })),
      };
    } else {
      body = data.find((r) => u.pathname === `/oracle/requests/${r.id}`);
      assert.ok(body, "only known oracle detail URLs");
    }
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
  await page.getByRole("button", { name: /Disconnect/ }).waitFor();
}
async function enabled(button) {
  await button.waitFor();
  await page.waitForFunction(
    (el) => !el.disabled,
    await button.elementHandle(),
  );
}
async function checkLayout(name) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      name + " page overflow",
    );
    assert.equal(
      await page
        .locator(".payment-dialog")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      name + " dialog overflow",
    );
    await page.screenshot({
      path: new URL(`${name}-${width}.png`, output).pathname,
    });
  }
}
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  evidence.browserVersion = browser.version();
  await run(
    "1 pending and failed tokenOf never offer mint; retry recovers to card #1",
    async () => {
      const f = fakeChain();
      const answer = f.answer;
      let release, entered;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      f.answer = async (p) => {
        if (
          rpcCalls(p).some(
            (call) =>
              call.method === "eth_call" &&
              call.params[0].to.toLowerCase() === registry.toLowerCase() &&
              decodeFunctionData({ abi, data: call.params[0].data })
                .functionName === "tokenOf",
          )
        ) {
          entered();
          await held;
        }
        return answer(p);
      };
      await setup(f);
      await Promise.race([
        started,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("tokenOf did not reach the fake RPC barrier")),
            15000,
          ),
        ),
      ]);
      assert.match(
        await page.locator(".claim-copy").innerText(),
        /Reading your card…/,
      );
      assert.equal(
        await page
          .locator(".claim-copy")
          .getByRole("button", { name: "Mint card", exact: true })
          .count(),
        0,
      );
      assert.doesNotMatch(
        await page.locator(".claim-copy").innerText(),
        /Mint your card now|A card costs/,
      );
      await page.screenshot({
        path: new URL("pending-390.png", output).pathname,
      });
      f.state.failFunction = "tokenOf";
      f.state.revertName = "Error";
      f.state.revertArgs = ["Card read unavailable"];
      release();
      const retry = page.getByRole("button", {
        name: "Retry wallet reads",
        exact: true,
      });
      await retry.waitFor();
      assert.equal(
        await page
          .locator(".claim-copy")
          .getByRole("button", { name: "Mint card", exact: true })
          .count(),
        0,
      );
      assert.doesNotMatch(
        await page.locator(".claim-copy").innerText(),
        /Mint your card now|A card costs/,
      );
      await page.screenshot({
        path: new URL("failed-390.png", output).pathname,
      });
      f.state.failFunction = "";
      f.state.token = 1n;
      await retry.click();
      await page
        .getByText(
          "Your Sworn card #1 is minted. It is on the Wallet page with every fact it holds.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page
          .locator("#mint")
          .getByRole("button", { name: "Mint card", exact: true })
          .count(),
        0,
      );
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );
  for (const action of [
    {
      kind: "mint",
      fn: "mintCard",
      button: "Mint card",
      label: "Mint one Sworn card",
      fee: "0.10",
      destination: "BurnExecutor",
    },
    {
      kind: "fact",
      fn: "upgrade",
      button: "Mint selected facts",
      label: "Request 601 / Swarmed",
      id: 601,
      fee: "0.50",
      destination: "Intake",
    },
    {
      kind: "shared",
      fn: "requestSharedFact",
      button: "Mint this fact: 1201 / Top Weights",
      label: "Request shared fact 1201 / Top Weights",
      id: 1201,
      fee: "0.50",
      destination: "Intake",
    },
    {
      kind: "registration",
      fn: "registerSpec",
      button: "Mint registration",
      label: "Register the immutable community spec",
      fee: "6.4",
      destination: "BurnExecutor",
    },
  ]) {
    await run(
      `2/3 confirmed ${action.kind} shows its own receipt result, price and destination`,
      async () => {
        const f = fakeChain({ allowance: 10n ** 22n });
        await setup(f, { shared: action.kind === "shared" });
        await page
          .getByText("preview, no card minted", { exact: true })
          .waitFor();
        if (action.id === 601) await page.locator("#pick-601 input").check();
        if (action.kind === "registration") {
          await page.locator("#spec-kind").selectOption("1");
          for (const [field, value] of Object.entries({
            name: "Test fact",
            target: registry,
            item: "event Deposited(address indexed contributor, uint256 amount)",
            arg: "contributor",
            threshold: "1",
            fromBlock: "25769870",
            toBlock: "25789604",
          }))
            await page.locator("#spec-" + field).fill(value);
        }
        const prepare = page.getByRole("button", {
          name: action.button,
          exact: true,
        });
        await enabled(prepare);
        let releaseChecking;
        const originalAnswer = f.answer;
        if (action.kind === "mint") {
          const held = new Promise((resolve) => {
            releaseChecking = resolve;
          });
          f.answer = async (p) => {
            if (
              rpcCalls(p).some(
                (call) =>
                  call.method === "eth_call" &&
                  call.params[0].to.toLowerCase() === registry.toLowerCase() &&
                  decodeFunctionData({ abi, data: call.params[0].data })
                    .functionName === "MINT_FEE",
              )
            )
              await held;
            return originalAnswer(p);
          };
        }
        await prepare.click();
        if (releaseChecking) {
          await page
            .locator(".claim-copy")
            .getByRole("button", { name: "Checking…", exact: true })
            .waitFor();
          releaseChecking();
        }
        const d = page.locator(".payment-dialog");
        await d.waitFor();
        f.answer = originalAnswer;
        if (action.kind === "mint")
          assert.match(
            await page.locator(".claim-copy").innerText(),
            /Ready: confirm the steps in the dialog\./,
          );
        assert.match(
          await d.innerText(),
          new RegExp(action.fee.replace(".", "\\.") + " IMD"),
        );
        assert.match(await d.innerText(), new RegExp(action.destination));
        assert.doesNotMatch(
          await d.innerText(),
          action.destination === "Intake"
            ? /BurnExecutor|Card fees|Registration fees/
            : /IMD Intake|Live oracle price at preparation|0\.50 IMD/,
        );
        if (action.id)
          assert.doesNotMatch(await d.innerText(), /0\.10 IMD|6\.4 IMD/);
        assert.equal(await d.locator("#payment-ack").isChecked(), false);
        await d.locator("#payment-ack").check();
        const sign = d.getByRole("button", { name: action.label, exact: true });
        await enabled(sign);
        assert.deepEqual(await page.evaluate(() => window.__signing), []);
        f.state.onReceipt = () => {
          if (action.kind === "mint") {
            f.state.token = 1n;
            f.state.receiptLogs = [
              registryLog(
                "CardMinted",
                { claimant: wallet, tokenId: 1n },
                { transactionHash: tx },
              ),
            ];
          } else if (action.kind === "registration") {
            f.state.receiptLogs = [
              registryLog(
                "SpecRegistered",
                { registrant: wallet, traitId: 10001 },
                { transactionHash: tx },
              ),
            ];
          } else {
            const claimant = action.kind === "shared" ? zeroAddress : wallet;
            f.state.pending = [
              {
                id: action.id,
                requestId,
                questionHash,
                requestedAt,
                claimant,
                transactionHash: tx,
              },
            ];
            f.state.receiptLogs = [
              registryLog(
                "TraitRequested",
                { claimant, traitId: action.id, requestId, questionHash },
                { transactionHash: tx },
              ),
            ];
          }
        };
        await page.evaluate(() => {
          window.__accept = true;
        });
        await sign.click();
        await d.getByText("confirmed", { exact: true }).waitFor();
        assert.equal((await page.evaluate(() => window.__signing)).length, 1);
        if (action.kind === "mint") {
          await d
            .getByText("Your Sworn card #1 · minted", { exact: true })
            .waitFor();
          assert.equal(await d.locator(".card-figure").count(), 0);
          await d
            .getByRole("button", { name: "Follow progress on the Wallet page" })
            .click();
          await page
            .getByRole("heading", { name: "Your Sworn card #1", exact: true })
            .waitFor();
          await page
            .locator(".wallet-record .claim-copy")
            .getByText("already minted", { exact: true })
            .waitFor();
          assert.equal(
            await page.locator(".wallet-card figcaption").count(),
            0,
          );
          assert.equal(
            await page
              .locator(".wallet-card img")
              .evaluate((el) => el.complete && el.naturalWidth > 0),
            true,
          );
        } else if (action.kind === "registration") {
          await d.getByText(/Registered fact 10001\./).waitFor();
        } else {
          await d
            .getByText("request sent, the panel answers in a few minutes", {
              exact: true,
            })
            .waitFor();
          assert.equal(await d.locator(".swarm-request").count(), 0);
          await d
            .getByRole("button", { name: "Follow progress on the Wallet page" })
            .click();
          await page
            .locator(".swarm-feed")
            .getByText("Oracle request: exact-request · exact", { exact: true })
            .waitFor();
          assert.equal(
            await page.locator(".swarm-feed .swarm-request li").count(),
            5,
          );
        }
        if (action.kind !== "registration") {
          await page.goto(preview.url + "#/mint");
          await page
            .getByRole("button", {
              name: "Review transaction steps",
              exact: true,
            })
            .click();
        }
        await checkLayout(action.kind);
        await d.getByRole("button", { name: "Close payment dialog" }).click();
        await page
          .getByRole("button", {
            name: "Review transaction steps",
            exact: true,
          })
          .click();
        if (action.kind === "mint")
          await d
            .getByText("Your Sworn card #1 · minted", { exact: true })
            .waitFor();
        await page.keyboard.press("Escape");
        await page.reload();
        await page
          .getByRole("button", {
            name: "Review transaction steps",
            exact: true,
          })
          .click();
        assert.equal(await d.locator("#payment-ack").isChecked(), false);
        assert.deepEqual(await page.evaluate(() => window.__signing), []);
        if (action.kind === "mint")
          await d
            .getByText("Your Sworn card #1 · minted", { exact: true })
            .waitFor();
        else if (action.id)
          await d
            .getByText("Progress continues on the Wallet page.", {
              exact: true,
            })
            .waitFor();
      },
    );
  }
  await run(
    "6 a legacy saved ack:true is ignored and omitted from new journal storage",
    async () => {
      const f = fakeChain({ allowance: 10n ** 22n });
      await setup(f);
      await page
        .getByText("preview, no card minted", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Mint card", exact: true })
        .click();
      const d = page.locator(".payment-dialog");
      await d.locator("#payment-ack").check();
      await d.getByText("simulated", { exact: true }).waitFor();
      await page.evaluate(() => {
        const key = "sworn.transaction-journal",
          value = JSON.parse(localStorage.getItem(key));
        value.ack = true;
        // Keep a sent setup receipt so this is a restorable journal. A wholly
        // unsent preparation is deliberately discarded on reload now.
        value.steps.unshift({
          label: "Previously sent setup",
          state: "confirmed",
          hash: "0x" + "77".repeat(32),
        });
        localStorage.setItem(key, JSON.stringify(value));
      });
      await page.reload();
      await page
        .getByRole("button", { name: "Review transaction steps", exact: true })
        .click();
      assert.equal(await d.locator("#payment-ack").isChecked(), false);
      assert.equal(
        await d
          .getByRole("button", { name: "Mint one Sworn card", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(
          () =>
            "ack" in
            JSON.parse(localStorage.getItem("sworn.transaction-journal")),
        ),
        false,
      );
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );
  await run(
    "8 cached exact detail failure silently falls back to the claimant's oldest match",
    async () => {
      const records = [
        request("exact-request"),
        request("later-duplicate", 5),
        request("oldest-match", 0),
      ];
      const f = fakeChain({
        token: 1n,
        pending: [
          {
            id: 601,
            requestId,
            questionHash,
            requestedAt,
            transactionHash: tx,
          },
        ],
      });
      await setup(f, { records });
      const feed = page.locator("#swarm-" + requestId);
      const exact = feed.getByText("Oracle request: exact-request · exact", {
        exact: true,
      });
      await exact.waitFor();
      // A refused Intake alone still retains a healthy cached exact request.
      await page.evaluate(() => {
        window.__intakeRefused = true;
        return window.__pollSwarm();
      });
      await exact.waitFor();
      const phase = evidence.api.length;
      await page.evaluate(() => {
        window.__cachedDetailUnavailable = true;
        return window.__pollSwarm();
      });
      await feed
        .getByText("Oracle request: oldest-match · matched", { exact: true })
        .waitFor();
      assert.ok(
        evidence.api.slice(phase).includes(`/oracle/requests?q=${wallet}`),
      );
      assert.ok(
        evidence.api.slice(phase).includes("/oracle/requests/oldest-match"),
      );
      assert.deepEqual(
        await page.evaluate(() => window.__cachedDetailFailures),
        ["https://api.imd.fun/oracle/requests/exact-request"],
      );
      records.unshift(request("even-later-duplicate", 10));
      await page.evaluate(() => window.__pollSwarm());
      await feed
        .getByText("Oracle request: oldest-match · matched", { exact: true })
        .waitFor();
      assert.doesNotMatch(await feed.innerText(), /progress unavailable/);
      assert.equal(await feed.getByRole("listitem").count(), 5);
      for (const width of [1280, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await feed.screenshot({
          path: new URL(`cached-exact-fallback-${width}.png`, output).pathname,
        });
      }
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );
  await run(
    "8 refused Intake uses claimant q, oldest match survives a later duplicate; Verified overrides it",
    async () => {
      const records = [
        request("later-duplicate", 5),
        request("oldest-match", 0),
        request("predates", -1),
        request(confirmedId, 8),
        {
          ...request("wrong-consumer", 0),
          consumer: {
            verifyingContract: deployment.contracts.find(
              (c) => c.name === "Renderer",
            ).address,
          },
        },
        request("wrong-hash", 0, "0x" + "cc".repeat(32)),
      ];
      const pending = {
        id: 601,
        requestId,
        questionHash,
        requestedAt,
        transactionHash: tx,
      };
      const f = fakeChain({
        token: 1n,
        allowance: 10n ** 22n,
        pending: [pending],
      });
      await setup(f, { refuse: true, records });
      const feed = page.locator("#swarm-" + requestId);
      await feed
        .getByText("Oracle request: oldest-match · matched", { exact: true })
        .waitFor();
      records.unshift(request("even-later-duplicate", 10));
      await page.evaluate(() => window.__pollSwarm());
      await feed
        .getByText("Oracle request: oldest-match · matched", { exact: true })
        .waitFor();
      f.state.verifiedEvents = [
        registryLog("Verified", {
          claimant: wallet,
          traitId: 601,
          requestId,
          oracleRequestId: confirmedBytes,
        }),
      ];
      f.state.proven = [601];
      f.state.verifiedRecords = {
        601: [requestId, confirmedBytes, 25769870n, 25789604n],
      };
      await page.evaluate(() => window.__pollSwarm());
      await feed
        .getByText(
          `Oracle request: ${confirmedId} · confirmed by the Registry`,
          { exact: true },
        )
        .waitFor();
      await feed
        .getByText(
          /The Registry confirmed a different oracle request.*oldest-match/,
        )
        .waitFor();
      f.state.pending[0].cleared = true;
      await page.evaluate(() => window.__pollSwarm());
      await page
        .locator("#pick-601")
        .getByText("Already proven", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".pending-notice").count(), 0);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        // Mint keeps one feed per open request; after proof it is removed.
        assert.equal(await feed.count(), 0);
        await page.screenshot({
          path: new URL(`confirmed-mint-${width}.png`, output).pathname,
        });
      }
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );
  await run(
    "8 delivered request journal survives reload and Wallet shows its Registry oracle id",
    async () => {
      const call = {
        label: "Request 601 / Swarmed",
        functionName: "upgrade",
        args: [601, 500000000000000000n],
        amount: 500000000000000000n,
      };
      await page.evaluate(
        ({ call, wallet, tx, requestId }) => {
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
                    result: {
                      facts: [{ id: 601, name: "Swarmed", requestId }],
                    },
                  },
                ],
              },
              (_, v) => (typeof v === "bigint" ? { bigint: String(v) } : v),
            ),
          );
        },
        { call, wallet, tx, requestId },
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Review transaction steps", exact: true })
        .click();
      assert.equal(
        await page.locator(".payment-dialog .swarm-request").count(),
        0,
      );
      await page
        .getByRole("button", { name: "Follow progress on the Wallet page" })
        .click();
      await page
        .locator("#held-601 .meaning")
        .getByText("Accepted swarm jobs >= 3", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#held-601 .class-mark").innerText(),
        "Panel-sworn",
      );
      assert.ok(
        !(await page.locator("#held-601").innerText()).includes(
          "Oracle request:",
        ),
      );
      assert.equal(await page.locator(".swarm-feed").count(), 0);
    },
  );
  await run(
    "4 contract README link names the pinned launch commit",
    async () => {
      await page.keyboard.press("Escape");
      await page.goto(preview.url + "#/fact-vs-artifact");
      const link = page.getByRole("link", {
        name: "Read the contract README ↗",
        exact: true,
      });
      assert.equal(
        await link.getAttribute("href"),
        "https://github.com/identity-md-launches/launch-2404-renderer-composer-registry/blob/c4ff3238390fc51962fb67e86affc20cf418126e/README.md",
      );
    },
  );
  assert.deepEqual(evidence.errors, []);
} catch (e) {
  evidence.failure = e.stack;
  process.exitCode = 1;
  console.error(e);
  if (page) {
    evidence.body = await page
      .locator("body")
      .innerText()
      .catch(() => null);
    await page
      .screenshot({ path: new URL("failure.png", output).pathname })
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
