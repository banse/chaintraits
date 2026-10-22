// Round 8 revision: the reviewer's three reproductions, on the built export
// with fake EIP-1193 wallets, fake RPC answers and a fake API. Nothing is
// signed or sent.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { encodeFunctionData } from "viem";
import { fakeChain, mockPage, wallet } from "./fake-chain.mjs";
import { server } from "./harness.mjs";

const output = new URL("../../test/scratch/round8-revision/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const Registry = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
);
const call = (functionName, args) =>
  encodeFunctionData({ abi: Registry, functionName, args });
const SPEC_601 = call("specOf", [601]);
const MINTED = call("mintedAtBlock", [1n]).slice(0, 10);
const B = "0x2000000000000000000000000000000000000002";
const STALE = "Requested more than 2 hours ago.";
const requestId = "0x" + "a1".repeat(32);
const uuidA = "23474d49-bf7c-40e0-8dad-41636c73ea84",
  uuidB = "33474d49-bf7c-40e0-8dad-41636c73ea84";
const bytes = (uuid) => "0x" + uuid.replaceAll("-", "") + "00".repeat(16);
const proof = (uuid) => [
  "0x" + "a2".repeat(32),
  bytes(uuid),
  25769870n,
  25789604n,
];
const evidence = { checks: [], errors: [], widths: [] };
const nowMs = Date.now();
const age = (s) => BigInt(Math.floor(nowMs / 1000) - s);
let browser, context, page, fixture, control;
async function run(name, fn) {
  // ONLY=<prefix> runs the matching cases alone.
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
// A browser wallet whose account can change: window.__switch emits
// accountsChanged as a real injected provider does.
async function switchableWallet(context) {
  await context.addInitScript((first) => {
    let account = first,
      authorized = false;
    const listeners = {};
    window.__signing = [];
    window.__switch = (next) => {
      account = next;
      for (const f of listeners.accountsChanged || []) f([next]);
    };
    window.ethereum = {
      on(event, f) {
        (listeners[event] ||= []).push(f);
      },
      removeListener(event, f) {
        listeners[event] = (listeners[event] || []).filter((g) => g !== f);
      },
      async request({ method, params }) {
        if (method === "eth_chainId") return "0x1";
        if (
          ["eth_requestAccounts", "wallet_requestPermissions"].includes(method)
        )
          authorized = true;
        if (method === "wallet_requestPermissions")
          return [{ parentCapability: "eth_accounts" }];
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return authorized ? [account] : [];
        if (
          /^(eth_send|eth_sign|personal_sign|wallet_send|wallet_sign)/.test(
            method,
          )
        ) {
          window.__signing.push({ method, params });
          throw Object.assign(
            Error("Fake wallet rejected; nothing signed or sent"),
            {
              code: 4001,
            },
          );
        }
        if (method === "wallet_getCapabilities") return {};
        throw Error("Unsupported fake wallet method " + method);
      },
    };
  }, wallet);
}
async function setup({ route, options = {}, api, prepare }) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.clock.setFixedTime(nowMs);
  await switchableWallet(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 503/.test(m.text()))
      evidence.errors.push(m.text());
  });
  control = { specCalls: [], refuseSpec: false, delayMint: false };
  fixture = fakeChain({ token: 1n, allowance: 10n ** 22n, ...options });
  const base = fixture.answer;
  fixture.answer = async (p) => {
    if (
      control.delayMint &&
      p.method === "eth_call" &&
      p.params[0].data?.startsWith(MINTED)
    )
      await new Promise((r) => setTimeout(r, 3000));
    return base(p);
  };
  prepare?.(fixture);
  await mockPage(page, fixture);
  // Only Registry.specOf(601) answers HTTP 503 after 200 ms, once enabled.
  await page.route(
    /ethereum-rpc.publicnode.com|gateway.tenderly.co|rpc.mevblocker.io|1.rpc.thirdweb.com/,
    async (r) => {
      const body = r.request().postDataJSON();
      if (
        body?.method === "eth_call" &&
        body.params?.[0]?.data?.toLowerCase() === SPEC_601.toLowerCase()
      ) {
        control.specCalls.push({ url: r.request().url(), at: Date.now() });
        if (control.refuseSpec) {
          await new Promise((res) => setTimeout(res, 200));
          return r
            .fulfill({ status: 503, body: "unavailable" })
            .catch(() => {});
        }
      }
      return r.fallback();
    },
  );
  await page.route("https://api.imd.fun/**", async (r) => {
    const u = new URL(r.request().url());
    const answer = api?.(u) || {
      body:
        u.pathname === "/oracle/requests"
          ? { requests: [] }
          : u.pathname.startsWith("/intake/")
            ? { entries: [] }
            : {},
    };
    await r.fulfill({
      status: answer.status || 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(answer.body ?? {}),
    });
  });
  await page.goto(preview.url + route);
  await page.getByText(/Dependencies verified/).waitFor();
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Browser wallet", exact: true })
    .click();
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
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
try {
  browser = await chromium.launch();

  await run(
    "1 a refused specOf(601) in the dialog's check sends nothing after a page change",
    async () => {
      await setup({ route: "#/claim" });
      const mint = page
        .locator("#pick-601")
        .getByRole("button", { name: /Mint this fact/ });
      await mint.waitFor();
      control.refuseSpec = true;
      const before = control.specCalls.length;
      await mint.click();
      await page.locator(".payment-dialog").waitFor();
      const deadline = Date.now() + 5000;
      while (control.specCalls.length === before && Date.now() < deadline)
        await page.waitForTimeout(20);
      assert.ok(
        control.specCalls.length > before,
        "the check's spec read started",
      );
      await page.evaluate(() => (location.hash = "#/wallet-facts"));
      const left = Date.now();
      await page.getByRole("heading", { name: "Wallet", level: 1 }).waitFor();
      await page.waitForTimeout(2000);
      const late = control.specCalls.filter((c) => c.at > left);
      evidence.specAfterNavigation = late.length;
      assert.deepEqual(late, [], "no specOf(601) after leaving the page");
      assert.deepEqual(await page.evaluate(() => window.__signing), []);
    },
  );

  await run(
    "2 a 7,201 s old request keeps the two-hour line when the progress API answers 503",
    async () => {
      await setup({
        route: "#/mint",
        options: {
          pending: [
            {
              id: 801,
              requestId,
              questionHash: "0x" + "b1".repeat(32),
              requestedAt: age(7201),
              transactionHash: "0x" + "66".repeat(32),
            },
          ],
        },
        api: () => ({ status: 503, body: { error: "unavailable" } }),
      });
      const feed = page.locator(".swarm-request").first();
      await feed.getByText(/progress unavailable/).waitFor();
      await feed.getByText(STALE, { exact: true }).waitFor();
      await noOverflow("stale-api-503");
    },
  );

  await run(
    "7 a wallet switch never shows the previous wallet's facts while the new history is read",
    async () => {
      await setup({
        route: "#/wallet-facts",
        prepare: (f) => {
          f.state.proven = [801];
          f.state.mintedAtBlock = 26245000n;
          f.state.verifiedRecords = { 801: proof(uuidA) };
        },
      });
      await page.locator("#held-801").getByText("Panel-sworn").waitFor();
      Object.assign(fixture.state, {
        token: 2n,
        proven: [901],
        verifiedRecords: { 901: proof(uuidB) },
      });
      control.delayMint = true;
      await page.evaluate((b) => window.__switch(b), B);
      await page.getByText(/Card #2\./).waitFor();
      await page.getByText("Reading your facts…").waitFor();
      assert.equal(
        await page.locator("#held-801").count(),
        0,
        "A's fact hidden",
      );
      await page
        .locator("#held-901")
        .getByText("Panel-sworn")
        .waitFor({ timeout: 8000 });
      assert.equal(await page.locator("#held-801").count(), 0);
    },
  );

  await run(
    "7 a shared fact id across wallets shows the new request's own job and attested time, or unavailability",
    async () => {
      await setup({
        route: "#/wallet-facts",
        api: (u) =>
          u.pathname.endsWith("/" + uuidA)
            ? {
                body: {
                  id: uuidA,
                  jobId: "wallet-A-job",
                  attestedAt: "2026-10-20T08:15:00.000Z",
                },
              }
            : u.pathname.endsWith("/" + uuidB)
              ? { status: 503, body: {} }
              : null,
        prepare: (f) => {
          f.state.proven = [801];
          f.state.mintedAtBlock = 26245000n;
          f.state.verifiedRecords = { 801: proof(uuidA) };
        },
      });
      const row = page.locator("#held-801");
      await row.getByText("Attested: 2026-10-20 08:15 UTC").waitFor();
      Object.assign(fixture.state, {
        token: 2n,
        verifiedRecords: { 801: proof(uuidB) },
      });
      control.delayMint = true;
      await page.evaluate((b) => window.__switch(b), B);
      await page.getByText(/Card #2\./).waitFor();
      assert.equal(
        await row.count(),
        0,
        "A's row hidden while B's history is read",
      );
      await row.getByText(uuidB).waitFor({ timeout: 8000 });
      await row.getByText("Attested: time unavailable").waitFor();
      assert.equal(await row.locator('a[href*="wallet-A-job"]').count(), 0);
      assert.equal(await row.getByText(/2026-10-20 08:15/).count(), 0);
      await noOverflow("wallet-switch");
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
