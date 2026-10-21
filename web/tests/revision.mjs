import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { encodeFunctionData, parseAbi, stringToHex } from "viem";
import { imd } from "../src/pure.mjs";
import { server, forwardRpc } from "./harness.mjs";

const engineName = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/revision-${engineName}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const rpc = process.env.SWORN_TEST_RPC;
const preview = await server({ rpcUrl: rpc });
const deployment = JSON.parse(
  fs.readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
);
const registryAbi = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
);
const intakeAbi = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/IntakeV2.json", import.meta.url)),
);
const account = "0x000000000000000000000000000000000000c1a1";
const hasTrait = encodeFunctionData({
  abi: registryAbi,
  functionName: "hasTrait",
  args: [account, 601],
}).slice(0, 10);
const balanceOf = encodeFunctionData({
  abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
  functionName: "balanceOf",
  args: [account],
});
const priceOf = encodeFunctionData({
  abi: intakeAbi,
  functionName: "priceOf",
  args: [
    stringToHex("oracle.request@oracle-1", { size: 32 }),
    deployment.network.pairToken.address,
  ],
});
const evidence = {
  at: new Date().toISOString(),
  engine: engineName,
  checks: [],
  errors: [],
  limitations: [],
};
let browser, page, heldRead, livePrice;
let failFacts = false;

function record(check) {
  evidence.checks.push(check);
  console.log(check.name);
}

function holdWalletRead() {
  const gate = {
    entered: Promise.withResolvers(),
    release: Promise.withResolvers(),
  };
  heldRead = gate;
  return gate;
}
async function waitForRead(gate) {
  let timeout;
  try {
    await Promise.race([
      gate.entered.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Error("Wallet read did not reach the gate")),
          30000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
function releaseWalletRead(gate) {
  if (heldRead === gate) heldRead = undefined;
  gate.release.resolve();
}
async function refresh() {
  await page.evaluate(() => {
    window.__revisionRefresh();
  });
}
async function metrics() {
  return page.evaluate(() => ({
    scrollY,
    height: document.documentElement.scrollHeight,
    rows: document.querySelectorAll(".fact-row").length,
    sameRows:
      window.__revisionRows?.every(
        (row, index) => row === document.querySelectorAll(".fact-row")[index],
      ) ?? null,
  }));
}
async function journal() {
  return page.locator("#transaction-steps").evaluate((element) => ({
    title: element.querySelector("h2").textContent,
    confirmButtons: [...element.querySelectorAll("button")].filter(
      (button) => button.textContent === "Confirm transaction steps",
    ).length,
    steps: [...element.querySelectorAll(".journal-steps li")].map(
      (row) => row.innerText,
    ),
    hash: location.hash,
    sameMain: window.__revisionMain === document.querySelector("main"),
    selected: document.querySelector("#pick-601 input").checked,
    acknowledged: document.querySelector("#oracle-ack").checked,
  }));
}

try {
  browser = await (engineName === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  evidence.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript((account) => {
    let authorized = !!sessionStorage.getItem("revision-wallet-authorized");
    window.__revisionSigning = [];
    window.ethereum = {
      on() {},
      removeListener() {},
      async request({ method }) {
        if (
          ["eth_requestAccounts", "wallet_requestPermissions"].includes(method)
        ) {
          authorized = true;
          sessionStorage.setItem("revision-wallet-authorized", "yes");
        }
        if (method === "wallet_requestPermissions")
          return [{ parentCapability: "eth_accounts" }];
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return authorized ? [account] : [];
        if (method === "eth_chainId") return "0x1";
        const signing =
          /^(eth_send|eth_sign|personal_sign|wallet_send|wallet_sign)/.test(
            method,
          );
        if (signing) window.__revisionSigning.push(method);
        const error = new Error("Read-only test provider refuses " + method);
        error.code = signing ? 4001 : 4200;
        throw error;
      },
    };
    const interval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 45000) {
        // Invoke the production refresh callback explicitly; no wall-clock wait.
        window.__revisionRefresh = () => callback(...args);
        return interval(() => {}, delay);
      }
      return interval(callback, delay, ...args);
    };
  }, account);
  page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().startsWith(preview.url) && response.status() >= 400)
      evidence.errors.push(`Local resource HTTP ${response.status()}`);
  });
  await page.route(
    /https:\/\/(gateway\.tenderly\.co|rpc\.mevblocker\.io|ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1\.rpc\.thirdweb\.com)\/?/,
    async (route) => {
      if (!rpc) return route.abort();
      const payload = route.request().postDataJSON();
      const walletRead =
        payload.method === "eth_call" &&
        payload.params[0].data?.startsWith(hasTrait);
      const gate = heldRead;
      if (walletRead && gate) {
        gate.entered.resolve();
        await gate.release.promise;
      }
      let reply;
      if (walletRead && failFacts)
        reply = {
          jsonrpc: "2.0",
          id: payload.id,
          error: {
            code: -32000,
            message: "Wallet read unavailable in regression fixture",
          },
        };
      else if (
        payload.method === "eth_call" &&
        payload.params[0].to?.toLowerCase() ===
          deployment.network.pairToken.address.toLowerCase() &&
        payload.params[0].data === balanceOf
      ) {
        // Only the reviewer's explicit balance fixture is synthetic. No writes.
        reply = {
          jsonrpc: "2.0",
          id: payload.id,
          result: "0x" + (10n ** 18n).toString(16).padStart(64, "0"),
        };
      } else reply = JSON.parse(await forwardRpc(rpc, payload));
      if (
        payload.method === "eth_call" &&
        payload.params[0].data === priceOf &&
        reply.result
      )
        livePrice = BigInt(reply.result);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply),
      });
    },
  );

  await page.goto(`${preview.url}#/claim?trait=701&view=all`);
  await page.locator("#pick-701 input").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#pick-701 input")?.checked,
  );
  assert.equal(await page.locator("#pick-701 input").isChecked(), true);
  await page.evaluate(() => {
    window.__revisionMain = document.querySelector("main");
  });
  // The old anchor remains navigable; payment acknowledgement now lives in the dialog.
  await page.evaluate(() => {
    location.hash = "#/claim?trait=701&view=all#oracle-ack";
  });
  await page.waitForFunction(() => location.hash.endsWith("#oracle-ack"));
  assert.equal(await page.locator("#pick-701 input").isChecked(), true);
  assert.equal(
    await page.evaluate(
      () => window.__revisionMain === document.querySelector("main"),
    ),
    true,
  );
  record({
    name: "Legacy acknowledgement anchor retains query parameters, selected trait and main element; directs readers to the payment dialog.",
  });
  await page.screenshot({
    path: new URL("acknowledgement-390.png", output).pathname,
  });

  if (!rpc) {
    evidence.limitations.push(
      "Live price, connected preparation and refresh checks skipped: set SWORN_TEST_RPC to a read endpoint.",
    );
  } else {
    await page.goto(`${preview.url}#/claim?trait=601`);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
    await page.getByRole("button", { name: /Disconnect/ }).waitFor();
    await page
      .getByText("preview, no card minted", { exact: true })
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Prepare selected facts", exact: true })
      .click();
    const paymentDialog = page.getByRole("dialog", {
      name: "Request 1 oracle fact: 601 / Swarmed",
      exact: true,
    });
    await paymentDialog.waitFor({ timeout: 60000 });
    assert.equal(await paymentDialog.locator(".journal-steps li").count(), 2);
    assert.equal(
      await paymentDialog
        .getByRole("button", { name: "Request 601 / Swarmed", exact: true })
        .isDisabled(),
      true,
    );
    await paymentDialog.locator("#payment-ack").check();
    await page.getByRole("button", { name: "Close payment dialog" }).click();
    await page
      .locator("#step-02")
      .getByRole("link", { name: "Transaction steps ↓", exact: true })
      .click();
    await page.waitForFunction(
      () => location.hash === "#/claim?trait=601#transaction-steps",
    );
    await page
      .getByRole("button", { name: "Review transaction steps" })
      .click();
    assert.equal(await paymentDialog.locator("#payment-ack").isChecked(), true);
    await page.getByRole("button", { name: "Close payment dialog" }).click();
    await page.goBack();
    assert.deepEqual(await page.evaluate(() => window.__revisionSigning), []);
    record({
      name: "Prepared dialog retains separate locked approval/action steps, acknowledgement and originating query through close, journal navigation and browser Back; no signing or broadcast.",
    });
    await page.screenshot({
      path: new URL("prepared-journal-390.png", output).pathname,
    });

    await page.goto(`${preview.url}#/explorer?address=${account}`);
    await page
      .getByRole("heading", { name: "All 25 facts", exact: true })
      .waitFor({ timeout: 60000 });
    assert.ok(livePrice > 0n);
    const expectedPrice = `${imd(livePrice)} IMD · priceOf · live`;
    const requestRows = [];
    for (const [id, name] of [
      [601, "Swarmed"],
      [1301, "Pretrained"],
    ]) {
      const row = page.locator(`#trait-${id}`);
      assert.equal(
        await row.locator(".fact-request span").innerText(),
        expectedPrice,
      );
      assert.equal(
        await row
          .getByRole("link", { name: `Request ${name} ↗`, exact: true })
          .getAttribute("href"),
        `#/claim?trait=${id}`,
      );
      requestRows.push({
        id,
        text: await row.locator(".fact-request").innerText(),
      });
    }
    assert.equal(await page.locator("#trait-701 a").count(), 0);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#trait-601").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: new URL("request-prices-390.png", output).pathname,
    });
    record({
      name: "Both requestable stranger facts show the RPC-fetched amount through the common IMD formatter, with priceOf · live and the correct Claim link; impossible facts have no request link; no overflow at 320/390/1440.",
      priceWei: livePrice.toString(),
      requestRows,
    });

    for (const deepLink of [false, true]) {
      if (deepLink) {
        await page.goto(
          `${preview.url}#/explorer?address=${account}&trait=601`,
        );
        await page
          .getByRole("heading", { name: "All 25 facts", exact: true })
          .waitFor({ timeout: 60000 });
        await page.waitForTimeout(250);
      }
      await page.locator("#trait-1105").scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        window.__revisionRows = [...document.querySelectorAll(".fact-row")];
      });
      const before = await metrics();
      const gate = holdWalletRead();
      await refresh();
      await waitForRead(gate);
      await page
        .getByText("Refreshing wallet facts…", { exact: true })
        .waitFor();
      const during = await metrics();
      assert.deepEqual(during, before);
      releaseWalletRead(gate);
      await page
        .getByText("Wallet facts loaded.", { exact: true })
        .waitFor({ timeout: 60000 });
      await page.waitForTimeout(150);
      const after = await metrics();
      assert.deepEqual(after, before);
      record({
        name: `Scheduled 45000ms refresh callback retains result nodes, height and reading position during and after a held RPC read${deepLink ? "; an initial trait deep link does not scroll again" : ""}.`,
        before,
        during,
        after,
      });
      if (!deepLink)
        await page.screenshot({
          path: new URL("refresh-retained-390.png", output).pathname,
        });
    }

    failFacts = true;
    await refresh();
    await page
      .getByRole("main")
      .locator('[role="status"].danger')
      .waitFor({ timeout: 60000 });
    assert.ok(
      await page
        .getByRole("main")
        .locator('[role="status"].danger')
        .innerText(),
    );
    assert.equal(await page.locator(".fact-row").count(), 0);
    failFacts = false;
    await page
      .getByRole("main")
      .getByRole("button", { name: "Retry reads", exact: true })
      .click();
    await page
      .getByText("Wallet facts loaded.", { exact: true })
      .waitFor({ timeout: 60000 });
    assert.equal(await page.locator(".fact-row").count(), 25);
    record({
      name: "Failed wallet read clears old credentials and exposes Retry reads; retry restores all 25 facts.",
    });

    const live = JSON.parse(
      fs.readFileSync(
        new URL("../../docs/frontend/live-deployment.json", import.meta.url),
      ),
    );
    const nextAddress = live.publicContributors[0];
    const gate = holdWalletRead();
    await page.locator("#explore-address").fill(nextAddress);
    await page
      .getByRole("button", { name: "Explore wallet", exact: false })
      .click();
    await waitForRead(gate);
    assert.equal(await page.locator(".fact-row").count(), 0);
    assert.equal(await page.locator(".explorer-head").count(), 0);
    releaseWalletRead(gate);
    await page
      .getByText("Wallet facts loaded.", { exact: true })
      .waitFor({ timeout: 60000 });
    assert.equal(await page.locator(".fact-row").count(), 25);
    assert.equal(
      await page.locator(".explorer-head .break").innerText(),
      nextAddress,
    );
    record({
      name: "Address change clears the previous wallet while the next read is pending, then shows the requested public contributor.",
    });
  }
  assert.deepEqual(evidence.errors, []);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = error.message;
  console.error(error);
  if (page)
    await page
      .screenshot({ path: new URL("failure.png", output).pathname })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  if (heldRead) releaseWalletRead(heldRead);
  if (browser) await browser.close();
  await preview.close();
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
