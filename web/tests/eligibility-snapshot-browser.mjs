import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  toHex,
} from "viem";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  wallet as absent,
} from "./fake-chain.mjs";
import { server } from "./harness.mjs";
import { eligibilityText, NOT_CHECKABLE } from "../src/eligibility.mjs";

const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/snapshot-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const data = new URL("../../dist/data/eligibility/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", data)));
const ids = manifest.factIds;
const abi = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
);
const preview = await server();
const evidence = {
  engine,
  checks: [],
  viewports: [],
  errors: [],
  expectedResourceFailures: [],
  snapshotRequests: [],
};
let browser, context, page, fixture, calls, files;
const specs = {
  601: {
    ...manifest.facts[701].spec,
    kind: 6,
    target: "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d",
    item: "",
    arg: "",
    fromBlock: 25090085n,
    toBlock: 0n,
    threshold: 3n,
  },
  1301: {
    ...manifest.facts[701].spec,
    kind: 5,
    fromBlock: 25769870n,
    toBlock: 25769870n,
    threshold: 20n,
  },
};
function countsFor(wallet) {
  return (
    JSON.parse(fs.readFileSync(new URL(`wallets-${wallet[2]}.json`, data)))[
      wallet
    ] || ids.map(() => 0)
  );
}
const resultFor = (n) => ({
  state: n > 0 ? "met" : "not-met",
  found: `${n} matching ${n === 1 ? "event" : "events"}; at least 1 required`,
});
async function setup(wallet, mode = "ok") {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context, wallet);
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  calls = [];
  files = [];
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      mode === "missing" &&
      /404|Failed to load resource/.test(message.text())
    )
      evidence.expectedResourceFailures.push(message.text());
    else evidence.errors.push(message.text());
  });
  fixture = fakeChain({
    token: 1n,
    allowance: 10n ** 22n,
    price: 1250000000000000000n,
    specs,
  });
  const answer = fixture.answer;
  fixture.answer = async (p) => {
    calls.push(p);
    if (
      p.method === "eth_getLogs" &&
      p.params[0].address?.toLowerCase() === manifest.curator
    )
      throw Error("Historical RPC refused");
    if (p.method === "eth_getTransactionCount") return "0x14";
    if (
      p.method === "eth_getLogs" &&
      p.params[0].address?.toLowerCase() === specs[601].target
    ) {
      const event = parseAbiItem(
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
      );
      return [
        {
          address: specs[601].target,
          blockNumber: toHex(25090085),
          blockHash: "0x" + "11".repeat(32),
          transactionHash: "0x" + "22".repeat(32),
          logIndex: "0x0",
          data: "0x",
          topics: encodeEventTopics({
            abi: [event],
            eventName: "Transfer",
            args: { from: manifest.curator, to: wallet, tokenId: 1n },
          }),
        },
      ];
    }
    return answer(p);
  };
  await mockPage(page, fixture);
  await page.route("**/data/eligibility/wallets-*.json", async (route) => {
    const url = route.request().url();
    files.push(url);
    if (mode === "missing")
      return route.fulfill({ status: 404, body: "Missing" });
    const bytes = fs.readFileSync(new URL(url.split("/").pop(), data));
    if (mode === "hash") bytes[1] = 32; // Same length, different SHA-256.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: bytes,
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
  await page.locator("#pick-701 input:enabled").waitFor();
}
async function capture(name, row) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (row) await row.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: new URL(`${name}-${width}.png`, output).pathname,
    });
    evidence.viewports.push({ name, width, overflow: false });
  }
}
async function prepare(id) {
  await page
    .getByRole("button", { name: "Mint selected facts", exact: true })
    .click();
  const dialog = page.locator(".payment-dialog");
  await dialog.locator("#payment-ack").check();
  await dialog.getByText("simulated", { exact: true }).waitFor();
  return {
    dialog,
    action: dialog.getByRole("button", {
      name: new RegExp(`^Request ${id} /`),
    }),
  };
}
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  evidence.browserVersion = browser.version();
  for (const wallet of [...Object.values(manifest.samples), absent]) {
    await setup(wallet);
    const counts = countsFor(wallet);
    for (const [i, id] of ids.entries()) {
      await page.locator(`#pick-${id} input`).check();
      await page
        .locator(`#pick-${id}`)
        .getByText(
          eligibilityText(resultFor(counts[i]), 1250000000000000000n),
          { exact: true },
        )
        .waitFor();
    }
    assert.equal(files.length, 1, "all nine checks share one file");
    assert.equal(
      calls.filter(
        (p) =>
          p.method === "eth_getLogs" &&
          p.params[0].address?.toLowerCase() === manifest.curator,
      ).length,
      0,
    );
    const specReads = calls.filter((p) => {
      if (p.method !== "eth_call") return false;
      try {
        const d = decodeFunctionData({ abi, data: p.params[0].data });
        return d.functionName === "specOf" && ids.includes(Number(d.args[0]));
      } catch {
        return false;
      }
    });
    assert.deepEqual(specReads, [], "nine snapshot facts do not read specOf");
    assert.deepEqual(await page.evaluate(() => window.__signing), []);
    await capture(
      wallet === absent
        ? "absent-nine-negative"
        : `wallet-${wallet.slice(2, 8)}`,
      page.locator("#pick-1101"),
    );
    evidence.snapshotRequests.push({
      wallet,
      files: files.length,
      bytes: manifest.files[`wallets-${wallet[2]}.json`].bytes,
    });
  }
  evidence.checks.push(
    "Four ordinal wallets meet exactly their own ordinal, hour-65 depositor meets 901, nondepositor is negative for all nine; exact counts/text; one shard; zero curator logs/spec RPC or wallet signatures.",
  );

  for (const mode of ["ok", "hash", "missing"]) {
    await setup(manifest.samples.index1, mode);
    await page.locator("#pick-1101 input").check();
    const line =
      mode === "ok"
        ? eligibilityText(resultFor(1), 1250000000000000000n)
        : NOT_CHECKABLE;
    await page.locator("#pick-1101").getByText(line, { exact: true }).waitFor();
    // A failed snapshot check is local advice, not a global dependency failure.
    await page.locator("#pick-1301 input").check();
    await page
      .locator("#pick-1301")
      .getByText(/nonce 20 at block 25769870/)
      .waitFor();
    await page.locator("#pick-1301 input").uncheck();
    const { dialog, action } = await prepare(1101);
    await dialog.getByText(line, { exact: true }).waitFor();
    assert.equal(await action.isEnabled(), true);
    assert.equal(
      await dialog
        .getByRole("button", { name: "Request anyway", exact: true })
        .count(),
      0,
    );
    if (mode === "ok")
      assert.equal(
        files.length,
        1,
        "row and dialog use the same verified shard",
      );
    await capture(`request-${mode}`, dialog);
    await action.click();
    await page.waitForFunction(() => window.__signing.length === 1);
    await dialog.getByText("rejected", { exact: true }).waitFor();
    evidence.checks.push(
      `${mode}: row/dialog advice matches; nonce still works; ordinary acknowledgement, simulation and explicit fake-wallet request proceed; nothing signed or sent.`,
    );
  }
  await setup(absent);
  await page.locator("#pick-1101 input").check();
  await page
    .locator("#pick-1101")
    .getByText(/^This wallet does not meet this rule/)
    .waitFor();
  const { dialog, action } = await prepare(1101);
  assert.equal(await action.isDisabled(), true);
  await dialog
    .getByRole("button", { name: "Request anyway", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  assert.equal(await action.isEnabled(), true);
  await capture("negative-request-keyboard", dialog);
  await action.click();
  await page.waitForFunction(() => window.__signing.length === 1);
  evidence.checks.push(
    "Negative snapshot result retains the extra Request anyway gate and keyboard path before the fake-wallet prompt.",
  );

  await setup(absent);
  await page.locator("#pick-1301 input").check();
  await page
    .locator("#pick-1301")
    .getByText(/nonce 20 at block 25769870/)
    .waitFor();
  await page.locator("#pick-601 input").check();
  await page
    .locator("#pick-601")
    .getByText(/received an IdentityMD seat/)
    .waitFor();
  assert.equal(files.length, 0);
  const nonces = calls.filter((p) => p.method === "eth_getTransactionCount");
  assert.ok(nonces.length >= 1);
  for (const call of nonces)
    assert.deepEqual(call.params, [absent, toHex(25769870)]);
  const seatCalls = calls.filter(
    (p) =>
      p.method === "eth_getLogs" &&
      p.params[0].address?.toLowerCase() === specs[601].target,
  );
  assert.equal(seatCalls.length, 2);
  assert.equal(seatCalls[0].params[0].fromBlock, toHex(25090085));
  await capture("live-seat-nonce", page.locator("#pick-601"));
  evidence.checks.push(
    "601 retains two-endpoint seat Transfer check from block 25090085; 1301 retains historical nonce at block 25769870; neither loads a snapshot.",
  );
  assert.deepEqual(evidence.errors, []);
} catch (error) {
  evidence.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
  if (page) {
    await page
      .screenshot({ path: new URL("failure.png", output).pathname })
      .catch(() => {});
    evidence.body = await page
      .locator("body")
      .innerText()
      .catch(() => "unavailable");
  }
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await context?.close();
  await browser?.close();
  await preview.close();
}
