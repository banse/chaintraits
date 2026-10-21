import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { encodeFunctionData } from "viem";
import { server, forwardRpc } from "./harness.mjs";

const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = new URL(
  `../../test/scratch/explorer-health-${engine}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const evidence = {
  at: new Date().toISOString(),
  engine,
  viewport: { width: 390, height: 844 },
  walletFixture: false,
  checks: [],
  limitations: [],
};
const rpc = process.env.SWORN_TEST_RPC;
const account = "0x000000000000000000000000000000000000c1a1";
const abi = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
);
const hasTrait = encodeFunctionData({
  abi,
  functionName: "hasTrait",
  args: [account, 601],
}).slice(0, 10);
let browser, preview;

async function state(page) {
  return page.evaluate(() => ({
    main: document.querySelectorAll("main").length,
    sameMain: window.__healthMain === document.querySelector("main"),
    navigation: document.querySelectorAll('nav[aria-label="Main navigation"]')
      .length,
    footer: document.querySelectorAll("footer").length,
    rows: document.querySelectorAll(".fact-row").length,
    sameRows:
      window.__healthRows?.every(
        (row, i) => row === document.querySelectorAll(".fact-row")[i],
      ) ?? null,
    address:
      document.querySelector(".explorer-head .break")?.textContent ?? null,
    rpc: document.querySelector("#rpc-choice")?.value ?? null,
    status:
      document.querySelector('main > [role="status"]')?.textContent ?? null,
    healthStatus:
      document.querySelector('footer [role="status"]')?.textContent ?? null,
    bodyTextLength: document.body.innerText.length,
    scrollY,
    height: document.documentElement.scrollHeight,
  }));
}
async function loaded(page) {
  await page
    .getByText("Wallet facts loaded.", { exact: true })
    .waitFor({ timeout: 60000 });
  assert.equal(await page.locator(".fact-row").count(), 25);
  assert.equal(
    await page.locator(".explorer-head .break").innerText(),
    account,
  );
}
async function refresh(page) {
  await page.evaluate(() => window.__healthRefresh());
}
function assertShell(snapshot) {
  assert.equal(snapshot.main, 1, "Explorer must retain the application shell");
  assert.equal(snapshot.sameMain, true, "Recovery must not remount main");
  assert.equal(snapshot.navigation, 1);
  assert.equal(snapshot.footer, 1);
}

try {
  if (!rpc) {
    evidence.limitations.push(
      "Read-only RPC scenarios skipped: set SWORN_TEST_RPC to a read endpoint.",
    );
  } else {
    preview = await server();
    browser = await (engine === "webkit" ? webkit : chromium).launch({
      headless: true,
    });
    evidence.browserVersion = browser.version();
    for (const scenario of [
      "rpc-switch",
      "health-failure-retry",
      "health-failure-scheduled-recovery",
    ]) {
      const check = {
        name: scenario,
        pageErrors: [],
        consoleErrors: [],
        localResourceErrors: [],
        rpcFailures: 0,
        forwardedReads: 0,
        methods: [],
      };
      const context = await browser.newContext({ viewport: evidence.viewport });
      await context.addInitScript(() => {
        const interval = window.setInterval.bind(window);
        window.setInterval = (callback, delay, ...args) => {
          if (delay === 45000) {
            // Exercise the actual production callback without waiting 45 seconds.
            window.__healthRefresh = () => callback(...args);
            return interval(() => {}, delay);
          }
          return interval(callback, delay, ...args);
        };
      });
      const page = await context.newPage();
      let failRpc = false,
        holdRpc = false,
        holdFacts = false;
      const releaseRpc = Promise.withResolvers();
      const factsEntered = Promise.withResolvers();
      const releaseFacts = Promise.withResolvers();
      page.on("pageerror", (error) => check.pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error")
          check.consoleErrors.push(message.text());
      });
      page.on("response", (response) => {
        if (response.url().startsWith(preview.url) && response.status() >= 400)
          check.localResourceErrors.push(response.status());
      });
      await page.route(
        /https:\/\/(gateway\.tenderly\.co|rpc\.mevblocker\.io|ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1\.rpc\.thirdweb\.com)\/?/,
        async (route) => {
          const payload = route.request().postDataJSON();
          if (!check.methods.includes(payload.method))
            check.methods.push(payload.method);
          if (failRpc) {
            ++check.rpcFailures;
            return route.fulfill({
              status: 503,
              contentType: "text/plain",
              body: "RPC unavailable in regression test",
            });
          }
          if (holdRpc) await releaseRpc.promise;
          if (
            holdFacts &&
            payload.method === "eth_call" &&
            payload.params[0].data?.startsWith(hasTrait)
          ) {
            factsEntered.resolve();
            await releaseFacts.promise;
          }
          try {
            const body = await forwardRpc(rpc, payload);
            ++check.forwardedReads;
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body,
            });
          } catch (error) {
            await route.fulfill({ status: 502, body: error.message });
          }
        },
      );
      try {
        await page.goto(`${preview.url}#/explorer?address=${account}`);
        await loaded(page);
        assert.equal(await page.evaluate(() => !!window.ethereum), false);
        await page.evaluate(() => {
          window.__healthMain = document.querySelector("main");
        });
        check.before = await state(page);
        if (scenario === "rpc-switch") {
          assert.equal(check.before.rpc, "https://ethereum-rpc.publicnode.com");
          holdRpc = true;
          await page
            .getByLabel("Public RPC", { exact: true })
            .selectOption("https://gateway.tenderly.co/public/mainnet");
          await page.waitForFunction(
            () => !document.querySelector(".explorer-head"),
          );
          check.unavailable = await state(page);
          assertShell(check.unavailable);
          assert.equal(check.unavailable.rows, 0);
          assert.equal(
            check.unavailable.rpc,
            "https://gateway.tenderly.co/public/mainnet",
          );
          assert.match(check.unavailable.healthStatus, /Checking deployment/);
          holdRpc = false;
          releaseRpc.resolve();
        } else {
          failRpc = true;
          await refresh(page);
          await page.waitForFunction(
            () =>
              !document.querySelector("main") ||
              document.querySelector('footer [role="status"].danger'),
            undefined,
            { timeout: 60000 },
          );
          check.unavailable = await state(page);
          assert.ok(check.rpcFailures > 0);
          assertShell(check.unavailable);
          assert.equal(check.unavailable.rows, 0);
          assert.match(
            check.unavailable.status,
            /Cannot read the chain, retrying/,
          );
          const retry = page
            .getByRole("main")
            .getByRole("button", { name: "Retry reads", exact: true });
          assert.equal(await retry.isEnabled(), true);
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: new URL(`${scenario}-unavailable.png`, output).pathname,
          });
          failRpc = false;
          if (scenario === "health-failure-retry") {
            await retry.focus();
            assert.equal(
              await retry.evaluate(
                (element) => element === document.activeElement,
              ),
              true,
            );
            await page.screenshot({
              path: new URL("retry-focus.png", output).pathname,
            });
            await page.keyboard.press("Enter");
          } else await refresh(page);
        }
        await loaded(page);
        check.recovered = await state(page);
        assertShell(check.recovered);
        assert.equal(
          check.recovered.rpc,
          scenario === "rpc-switch"
            ? "https://gateway.tenderly.co/public/mainnet"
            : check.before.rpc,
        );
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: new URL(`${scenario}-recovered.png`, output).pathname,
        });
        if (scenario === "health-failure-scheduled-recovery") {
          await page.locator("#trait-1105").scrollIntoViewIfNeeded();
          await page.evaluate(() => {
            window.__healthRows = [...document.querySelectorAll(".fact-row")];
          });
          const before = await state(page);
          holdFacts = true;
          await refresh(page);
          await page
            .getByText("Refreshing wallet facts…", { exact: true })
            .waitFor({ timeout: 60000 });
          await factsEntered.promise;
          const during = await state(page);
          for (const key of [
            "sameMain",
            "sameRows",
            "rows",
            "scrollY",
            "height",
            "address",
          ])
            assert.equal(
              during[key],
              before[key],
              `Successful refresh changed ${key}`,
            );
          releaseFacts.resolve();
          holdFacts = false;
          await loaded(page);
          const after = await state(page);
          for (const key of [
            "sameMain",
            "sameRows",
            "rows",
            "scrollY",
            "height",
            "address",
          ])
            assert.equal(
              after[key],
              before[key],
              `Completed refresh changed ${key}`,
            );
          check.successfulRefresh = { before, during, after };
        }
        assert.deepEqual(check.pageErrors, []);
        assert.deepEqual(check.localResourceErrors, []);
        assert.deepEqual(
          check.consoleErrors.filter(
            (message) => !/status of 503/.test(message),
          ),
          [],
        );
        assert.equal(
          check.methods.some((method) => /send|sign/i.test(method)),
          false,
        );
        check.passed = true;
      } catch (error) {
        check.passed = false;
        check.failure = error.message;
        check.final = await state(page).catch(() => null);
        await page
          .screenshot({
            path: new URL(`${scenario}-failure.png`, output).pathname,
          })
          .catch(() => {});
        process.exitCode = 1;
      } finally {
        releaseRpc.resolve();
        releaseFacts.resolve();
        await context.close();
      }
      evidence.checks.push(check);
      console.log(`${check.passed ? "PASS" : "FAIL"} ${engine}: ${scenario}`);
    }
  }
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (preview) await preview.close();
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        engine,
        checks: evidence.checks.map(({ name, passed, failure }) => ({
          name,
          passed,
          failure,
        })),
        limitations: evidence.limitations,
        failure: evidence.failure,
      },
      null,
      2,
    ),
  );
}
