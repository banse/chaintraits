// Production export, real API captures, deterministic read-only RPC/wallet fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "@playwright/test";
import { encodeEventTopics, parseAbiItem, toHex } from "viem";
import { server } from "./harness.mjs";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  registryLog,
  inspectAllFacts,
} from "./fake-chain.mjs";

const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`./fixtures/indexer/${name}.json`, import.meta.url),
    ),
  );
const rules = fixture("rules"),
  history = fixture("wallet"),
  eligible = fixture("eligible"),
  negative = fixture("ineligible");
const spec = {
  ...rules.rules[0],
  threshold: 5n,
  fixedVal: BigInt(rules.rules[0].fixedVal),
  fromBlock: 26038414n,
  toBlock: 26279931n,
};
const output = new URL(
  `../../test/scratch/indexer-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const report = {
  engine,
  checks: [],
  errors: [],
  expectedOutageErrors: [],
  viewports: [],
  requests: [],
  timings: [],
};
const preview = await server();
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
});
let context, page, chain, mode, external, api, calls;
const record = async (name, fn) => {
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try {
    await fn();
    report.checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    if (page) {
      await page.screenshot({ path: new URL("failure.png", output).pathname });
      fs.writeFileSync(
        new URL("failure.txt", output),
        await page.locator("body").innerText(),
      );
    }
    throw error;
  }
};
async function setup(wallet = history.wallet, nextMode = "indexer") {
  await context?.close();
  mode = nextMode;
  calls = [];
  api = [];
  external = [];
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context, wallet);
  const verified = history.requests.map((request, index) =>
    registryLog(
      "Verified",
      {
        claimant: wallet,
        traitId: request.traitId,
        requestId: request.requestId,
        oracleRequestId: request.oracleRequestId,
      },
      {
        blockNumber: toHex(request.resolvedBlock),
        transactionHash: request.resolvedTx,
        logIndex: toHex(index),
      },
    ),
  );
  const requests = history.requests.map((request, index) =>
    registryLog(
      "TraitRequested",
      {
        claimant: wallet,
        traitId: request.traitId,
        requestId: request.requestId,
        questionHash: request.questionHash,
      },
      {
        blockNumber: toHex(request.requestedBlock),
        transactionHash: request.requestedTx,
        logIndex: toHex(index),
      },
    ),
  );
  chain = fakeChain({
    token: 2n,
    balance: 10n ** 22n,
    allowance: 10n ** 22n,
    nextSpecId: 10002,
    specs: { 10001: spec },
    proven: [601, 701, 1105, 1301],
    mintedAtBlock: BigInt(history.card.mintBlock),
    verifiedEvents: [
      ...verified,
      ...requests,
      registryLog(
        "CardMinted",
        { claimant: wallet, tokenId: 2n },
        {
          blockNumber: toHex(history.card.mintBlock),
          transactionHash: history.card.mintTx,
        },
      ),
    ],
  });
  const answer = chain.answer;
  const registeredTopic = encodeEventTopics({
    abi: [
      parseAbiItem(
        "event SpecRegistered(uint16 indexed traitId, address indexed registrant)",
      ),
    ],
    eventName: "SpecRegistered",
  })[0];
  chain.answer = async (payload) => {
    calls.push(payload);
    if (payload.method === "eth_blockNumber")
      return toHex(history.lastIndexedBlock);
    if (
      payload.method === "eth_getLogs" &&
      payload.params[0].topics?.[0] === registeredTopic
    )
      return [
        registryLog(
          "SpecRegistered",
          { traitId: 10001, registrant: rules.rules[0].registrant },
          {
            blockNumber: toHex(rules.rules[0].blockNumber),
            transactionHash: rules.rules[0].transactionHash,
          },
        ),
      ];
    return answer(payload);
  };
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      (mode === "outage" &&
      /ERR_FAILED|Failed to load resource/.test(message.text())
        ? report.expectedOutageErrors
        : report.errors
      ).push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().startsWith("https://"))
      external.push({ url: request.url(), type: request.resourceType() });
  });
  await mockPage(page, chain);
  await page.route("https://api.imd.fun/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("https://sworn.vibingco.de/api/**", (route) => {
    const url = new URL(route.request().url());
    api.push(url.pathname + url.search);
    if (mode === "outage") return route.abort("failed");
    const data =
      url.pathname === "/api/rules"
        ? rules
        : url.pathname.includes("/eligibility")
          ? wallet.toLowerCase() === negative.wallet
            ? negative
            : eligible
          : { ...history, wallet };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  return wallet;
}
async function connect() {
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Browser wallet", exact: true })
    .click();
}
async function capture(name, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const target = name.startsWith("catalog-community")
    ? "#community-10001"
    : name.startsWith("request-")
      ? "#pick-10001"
      : name === "fact-history"
        ? ".fc-history-list"
        : null;
  if (target) await page.locator(target).scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `${name} overflow at ${width}`,
  );
  await page.screenshot({
    path: new URL(`${name}-${width}.png`, output).pathname,
  });
  report.viewports.push({ name, width, overflow: false });
}
function meaning(text) {
  for (const content of [
    "at least 5 Transfer events",
    spec.target,
    rules.rules[0].fixedValAsAddress,
    "26,038,414",
    "26,279,931",
    "Registrant",
    rules.rules[0].registrant,
  ])
    assert.ok(text.toLowerCase().includes(content.toLowerCase()), content);
}
try {
  await record(
    "community catalog meaning, registrant and one-ring card at both widths",
    async () => {
      await setup();
      await page.goto(preview.url + "#/catalog");
      const row = page.locator("#community-10001");
      await row.waitFor();
      meaning(await row.innerText());
      assert.ok(
        (await row.locator("img").getAttribute("src")).startsWith(
          "data:image/svg+xml,",
        ),
      );
      for (const width of [1280, 390]) {
        await row.scrollIntoViewIfNeeded();
        await capture("catalog-community", width);
      }
    },
  );
  for (const [wallet, state, count] of [
    [history.wallet, "met", 5],
    [negative.wallet, "not-met", 0],
  ]) {
    await record(
      `Mint Facts ${state}: count ${count}, source indexer within five seconds`,
      async () => {
        await setup(wallet);
        await page.goto(preview.url + "#/request?trait=10001");
        await page
          .locator("footer [role=status]")
          .filter({ hasText: /Ethereum mainnet · block/ })
          .waitFor();
        const started = performance.now();
        await connect();
        await inspectAllFacts(page);
        const row = page.locator("#pick-10001");
        await row
          .getByText(/Source: indexer, block/)
          .waitFor({ timeout: 5000 });
        const elapsed = performance.now() - started;
        assert.ok(elapsed < 5000, `${elapsed}ms`);
        const text = await row.innerText();
        meaning(text);
        assert.ok(text.includes(`${count} matching`));
        assert.ok(
          text.includes(
            state === "met" ? "finds this rule met" : "does not meet this rule",
          ),
        );
        assert.equal(await row.locator(".mini-card img").count(), 1);
        assert.ok(
          api.some((path) => path.startsWith("/api/rules/10001/eligibility")),
        );
        assert.ok(
          !api.some((path) =>
            /\/rules\/(601|701|801|901|1001|110[1-5]|1201|1301)\//.test(path),
          ),
        );
        assert.ok(
          !calls.some(
            (call) =>
              call.method === "eth_getLogs" &&
              call.params[0].address?.toLowerCase() === spec.target,
          ),
        );
        report.timings.push({ state, count, elapsedMs: Math.round(elapsed) });
        for (const width of [1280, 390]) {
          await row.scrollIntoViewIfNeeded();
          await capture(`request-${state}`, width);
        }
        if (state === "met")
          await row
            .getByRole("button", {
              name: "Mint Fact: 10001 / Early Flock",
              exact: true,
            })
            .click();
        assert.equal(await page.evaluate(() => window.__signing.length), 0);
      },
    );
  }
  await record(
    "fact-check and history use wallet index before registry logs",
    async () => {
      await setup();
      await page.goto(preview.url + `#/fact-check?wallet=${history.wallet}`);
      await page
        .getByText("All fact history loaded.", { exact: true })
        .waitFor();
      const list = page.locator(".fc-history-list");
      for (const id of [601, 701, 1105, 1301])
        assert.ok((await list.innerText()).includes(`Fact ${id}`));
      assert.equal(await list.locator(".fc-history-item").count(), 5); // Four requests and frozen direct card facts.
      assert.ok(api.some((path) => path.startsWith("/api/wallets/")));
      assert.ok(!calls.some((call) => call.method === "eth_getLogs"));
      for (const width of [1280, 390]) {
        await list.scrollIntoViewIfNeeded();
        await capture("fact-history", width);
      }
      await list
        .getByRole("link", { name: "View agents and results" })
        .first()
        .click();
      await page.getByText("✓ FACT SAVED", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__signing.length), 0);
      mode = "outage";
      await page
        .getByRole("button", { name: "Refresh history", exact: true })
        .click();
      await page
        .getByText("All fact history loaded.", { exact: true })
        .waitFor({ timeout: 30000 });
      assert.equal(
        await page.locator(".fc-history-list .fc-history-item").count(),
        5,
        "Switching from indexed history to the scan must not duplicate requests",
      );
    },
  );
  await record(
    "indexer outage keeps community rows, attribution and labelled chain fallback",
    async () => {
      await setup(history.wallet, "outage");
      await page.goto(preview.url + "#/request?trait=10001");
      await page
        .locator("footer [role=status]")
        .filter({ hasText: /Ethereum mainnet · block/ })
        .waitFor();
      await connect();
      await inspectAllFacts(page);
      const row = page.locator("#pick-10001");
      await row.getByText(/Source: chain scan/).waitFor({ timeout: 25000 });
      meaning(await row.innerText());
      assert.ok(
        calls.some(
          (call) =>
            call.method === "eth_getLogs" &&
            call.params[0].address?.toLowerCase() === spec.target,
        ),
      );
      await row.scrollIntoViewIfNeeded();
      await capture("request-outage", 390);
      await page.goto(preview.url + `#/fact-check?wallet=${history.wallet}`);
      await page
        .getByText("All fact history loaded.", { exact: true })
        .waitFor({ timeout: 30000 });
      for (const id of [601, 701, 1105, 1301])
        assert.ok(
          (await page.locator(".fc-history-list").innerText()).includes(
            `Fact ${id}`,
          ),
        );
    },
  );
  await record(
    "all routes at 1280 and 390, local scripts, allowed requests and homepage primary action",
    async () => {
      await setup();
      const routes = [
        "/",
        "/catalog",
        "/mint",
        "/request",
        "/fact-check",
        "/register",
        "/curator",
        "/integrate",
        "/about",
        "/explorer",
        "/wallet",
        "/wallet-facts",
        "/claim",
        "/oracle",
        "/fact-check-demo",
        "/fact-vs-artifact",
        "/whitelistcurator",
      ];
      for (const width of [1280, 390])
        for (const route of routes) {
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 900,
          });
          await page.goto(preview.url + "#" + route);
          await page.getByRole("heading", { level: 1 }).waitFor();
          await capture(`route-${route.slice(1) || "home"}`, width);
          if (route === "/" && width === 390) {
            const action = await page
              .getByRole("button", { name: "Explore wallet", exact: true })
              .boundingBox();
            assert.ok(action.y + action.height <= 844);
            report.firstScreenAction = action;
            await page
              .getByRole("button", { name: "Connect", exact: true })
              .click();
            assert.equal(
              await page
                .getByRole("dialog")
                .evaluate((el) => el.matches(":modal")),
              true,
            );
            await page.keyboard.press("Escape");
          }
        }
      const allowed =
        /^https:\/\/(ethereum-rpc\.publicnode\.com|gateway\.tenderly\.co|rpc\.mevblocker\.io|1\.rpc\.thirdweb\.com|api\.imd\.fun|sworn\.vibingco\.de)(\/|$)/;
      assert.ok(
        external.every((request) => allowed.test(request.url)),
        JSON.stringify(
          external.filter((request) => !allowed.test(request.url)),
        ),
      );
      assert.ok(external.every((request) => request.type !== "script"));
      report.requests = [...new Set(external.map((request) => request.url))];
      await page.goto(preview.url);
      await page
        .getByRole("button", { name: "Explore wallet", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Explore a wallet").getAttribute("aria-invalid"),
        "true",
      );
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(
    new URL("report.json", output),
    JSON.stringify(report, null, 2) + "\n",
  );
  await context?.close();
  await browser.close();
  await preview.close();
}
