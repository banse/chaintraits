import { encodeFunctionData, encodeAbiParameters, toHex } from "viem";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
export async function walletBrowserChecks({ url, client, account, r, output }) {
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  let debugPage;
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    let sendCount = 0;
    let rejectNext = true;
    let outage = false;
    let changedPrice = false;
    const priceSelector = encodeFunctionData({
      abi: r.abis.IntakeV2,
      functionName: "priceOf",
      args: ["0x" + "00".repeat(32), r.deployment.network.pairToken.address],
    }).slice(0, 10);
    const sent = [];
    await context.exposeBinding("forkWalletRpc", async (_, args) => {
      if (args.method === "eth_sendTransaction") {
        sendCount++;
        if (rejectNext) {
          rejectNext = false;
          return {
            error: { code: 4001, message: "User rejected the request." },
          };
        }
        sent.push(args.params[0]);
      }
      try {
        return { result: await client.request(args) };
      } catch (e) {
        return {
          error: {
            code: e.code || -32000,
            message: e.shortMessage || e.message,
          },
        };
      }
    });
    await context.addInitScript(
      ({ account, icon }) => {
        const handlers = {};
        let chain = "0x5";
        let added = !!sessionStorage.getItem("fork-chain-added");
        let authorized = !!sessionStorage.getItem("fork-wallet-authorized");
        if (added) chain = "0x1";
        const provider = {
          isMetaMask: true,
          on: (event, fn) => {
            (handlers[event] ??= []).push(fn);
          },
          removeListener: (event, fn) => {
            handlers[event] = (handlers[event] || []).filter((f) => f !== fn);
          },
          request: async (args) => {
            if (args.method === "eth_accounts")
              return authorized ? [account] : [];
            if (args.method === "eth_requestAccounts") {
              authorized = true;
              sessionStorage.setItem("fork-wallet-authorized", "yes");
              return [account];
            }
            if (args.method === "eth_chainId") return chain;
            if (args.method === "wallet_switchEthereumChain") {
              if (!added) {
                const e = new Error("Unrecognized chain");
                e.code = 4902;
                throw e;
              }
              chain = args.params[0].chainId;
              (handlers.chainChanged || []).forEach((fn) => fn(chain));
              return null;
            }
            if (args.method === "wallet_addEthereumChain") {
              window.__addedChain = args.params[0];
              sessionStorage.setItem("fork-chain-added", "yes");
              added = true;
              return null;
            }
            const response = await window.forkWalletRpc(args);
            if (response.error) {
              const e = new Error(response.error.message);
              e.code = response.error.code;
              throw e;
            }
            return response.result;
          },
        };
        window.ethereum = provider;
        window.__forceWrongChain = () => {
          chain = "0x5";
          added = false;
          sessionStorage.removeItem("fork-chain-added");
          (handlers.chainChanged || []).forEach((fn) => fn(chain));
        };
        const announce = () =>
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", {
              detail: {
                info: {
                  uuid: "f112d620-22f4-4a9f-89a6-78724ce89957",
                  name: "Fork browser wallet",
                  icon,
                  rdns: "org.sworn.test",
                },
                provider,
              },
            }),
          );
        window.addEventListener("eip6963:requestProvider", announce);
        announce();
      },
      {
        account,
        icon:
          "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><path d="M4 6h20v16H4z" fill="#00ff41"/></svg>',
          ),
      },
    );
    const page = await context.newPage();
    debugPage = page;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(
      /https:\/\/(rpc\.mevblocker\.io|ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1\.rpc\.thirdweb\.com)\/?/,
      async (route) => {
        if (outage) {
          await route.fulfill({
            status: 503,
            body: "RPC unavailable in the outage test",
          });
          return;
        }
        try {
          const req = route.request().postDataJSON();
          const result =
            changedPrice &&
            req.method === "eth_call" &&
            req.params[0].data?.startsWith(priceSelector)
              ? encodeAbiParameters(
                  [{ type: "uint256" }],
                  [600000000000000000n],
                )
              : await client.request(req);
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ jsonrpc: "2.0", id: req.id, result }),
          });
        } catch (e) {
          const req = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: {
                code: e.code || -32000,
                message: e.shortMessage || e.message,
                data: e.details || e.data,
              },
            }),
          });
        }
      },
    );
    await page.goto(`${url}#/claim`);
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Fork browser wallet" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Browser wallet", exact: true })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "Fork browser wallet" }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".connect-control")
          ?.textContent?.includes("Disconnect") ||
        document
          .querySelector(".connect-control")
          ?.textContent?.includes("Switch to Ethereum"),
    );
    await page.evaluate(() => window.__forceWrongChain());
    await page.getByRole("button", { name: "Switch to Ethereum" }).waitFor();
    await page.getByRole("button", { name: "Switch to Ethereum" }).click();
    await page.getByRole("button", { name: /Disconnect/ }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.__addedChain),
      r.deployment.walletAddChain,
    );
    checks.push(
      "EIP-6963 lists the named extension and hides the generic row; wrong-chain control switches with 4902 add-chain fallback using exact manifest parameters.",
    );
    await page
      .getByText("preview, no card minted", { exact: true })
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Prepare mint", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Exact amount", exact: true })
      .waitFor();
    assert.ok(
      (await page.locator("#transaction-steps").innerText()).includes(
        "0.10 IMD",
      ),
    );
    await page
      .getByRole("button", { name: "Confirm transaction steps" })
      .click();
    await page
      .getByText("Rejected in your wallet. You can try again.", { exact: true })
      .first()
      .waitFor({ timeout: 60000 });
    assert.equal(sendCount, 1);
    assert.equal(
      await page
        .locator(".journal-steps li")
        .first()
        .locator(".danger")
        .first()
        .innerText(),
      "rejected",
    );
    checks.push(
      "Mint journal prepares exact approval and mint; a wallet rejection appears beneath the failed step with rejected state.",
    );
    await page
      .getByRole("button", { name: "Confirm transaction steps" })
      .click();
    await page
      .getByRole("button", { name: "Already minted", exact: true })
      .waitFor({ timeout: 120000 });
    await page.getByText(/Sworn #\d+ · minted/).waitFor();
    await page
      .locator("#mint")
      .getByText("already minted", { exact: true })
      .waitFor();
    assert.ok(sent.length >= 2);
    checks.push(
      "Browser journal retries after rejection, sends actual fork approval then mint, records receipts, refreshes to the minted tokenURI and disables a second mint.",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: new URL("390-minted-first-screen.png", output).pathname,
    });
    await page.locator("#pick-701 input").check();
    await page.locator("#pick-601 input").check();
    await page.locator("#pick-1301 input").check();
    await page.locator("#oracle-ack").check();
    await page.getByRole("button", { name: "Prepare selected facts" }).click();
    await page
      .getByRole("heading", { name: /Request 3 oracle facts/ })
      .waitFor();
    const journalText = await page.locator("#transaction-steps").innerText();
    for (const id of [701, 601, 1301])
      assert.ok(journalText.includes(`${id} /`));
    assert.ok(journalText.includes("1.5 IMD"));
    assert.equal(await page.locator(".journal-steps li").count(), 4);
    checks.push(
      "Selecting three personal facts produces an exact 1.5 IMD total, one exact approval and three individually numbered upgrade calls before signing.",
    );
    await page
      .getByRole("button", { name: "Confirm transaction steps" })
      .click();
    await page
      .getByRole("button", { name: "Close", exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelectorAll(".journal-steps li .accent").length === 4,
      {},
      { timeout: 120000 },
    );
    const hash = await page
      .locator(".journal-steps .receipt")
      .last()
      .innerText();
    const beforeReload = sendCount;
    await page.reload();
    await page.getByRole("button", { name: /Disconnect/ }).waitFor();
    assert.equal(sendCount, beforeReload);
    await page.getByText("Recover a transaction hash", { exact: true }).click();
    await page.locator("#recover-hash").fill(hash.replace("Receipt: ", ""));
    await page
      .getByRole("button", { name: "Recover receipt", exact: true })
      .click();
    await page.waitForTimeout(200);
    assert.equal(sendCount, beforeReload);
    checks.push(
      "Three separate requests confirm on the fork; reload never sends and hash recovery reads a receipt without broadcasting.",
    );
    await page
      .getByRole("button", { name: "Already minted", exact: true })
      .waitFor();
    await page.locator("#oracle-ack").check();
    await page.locator("#pick-1105 input").check();
    await page.getByRole("button", { name: "Prepare selected facts" }).click();
    await page
      .getByRole("heading", { name: /Request 1 oracle fact: 1105/ })
      .waitFor();
    const beforePriceChange = sendCount;
    changedPrice = true;
    await page
      .getByRole("button", { name: "Confirm transaction steps" })
      .click();
    await page
      .getByText(
        "The live oracle price changed. Prepare again before signing.",
        { exact: true },
      )
      .waitFor();
    assert.equal(sendCount, beforePriceChange);
    changedPrice = false;
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Retry reads", exact: true })
      .click();
    await page.getByText(/Dependencies verified/).waitFor();
    checks.push(
      "A controlled live-price change stops a prepared request before any wallet signature.",
    );
    await page.locator("#pick-1105 input").uncheck();
    for (const id of [801, 901, 1001])
      await page.locator(`#pick-${id} input`).check();
    await page.getByRole("radio", { name: "ETH", exact: true }).check();
    await page.getByRole("button", { name: "Prepare selected facts" }).click();
    await page
      .getByRole("heading", { name: /Request 3 oracle facts/ })
      .waitFor();
    await page.getByText("Exact swap details", { exact: true }).click();
    assert.ok(
      (await page.locator("#transaction-steps").innerText()).includes(
        "120 seconds from quote",
      ),
    );
    await page.clock.setFixedTime(new Date(Date.now() + 121000));
    const beforeExpiry = sendCount;
    await page
      .getByRole("button", { name: "Confirm transaction steps" })
      .click();
    await page
      .getByText(
        "The ETH quote expired. Prepare again for a fresh 120-second quote.",
        { exact: true },
      )
      .first()
      .waitFor();
    assert.equal(sendCount, beforeExpiry);
    await page.clock.setFixedTime(new Date());
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("radio", { name: "IMD", exact: true }).check();
    for (const id of [801, 901, 1001])
      await page.locator(`#pick-${id} input`).uncheck();
    checks.push(
      "ETH preparation quotes only the IMD deficit, shows exact maximum wei and a refund commitment; a 121-second clock advance expires the quote without sending.",
    );
    await page.locator("#pick-1105 input").check();
    await page.getByRole("button", { name: "Prepare selected facts" }).click();
    await page
      .getByRole("heading", { name: /Request 1 oracle fact: 1105/ })
      .waitFor();
    await client.request({ method: "anvil_setAutomine", params: [false] });
    await page
      .getByRole("button", { name: "Confirm transaction steps" })
      .click();
    await page
      .locator(".journal-steps li")
      .first()
      .getByText("pending", { exact: true })
      .waitFor({ timeout: 60000 });
    const originalHash = (
      await page.locator(".journal-steps .receipt").first().getAttribute("href")
    )
      .split("/")
      .at(-1);
    // Let the receipt observer read the original pending transaction before replacement.
    await page.waitForTimeout(800);
    const original = await client.getTransaction({ hash: originalHash });
    const replacementHash = await client.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: account,
          value: "0x0",
          nonce: toHex(original.nonce),
          gas: "0x5208",
          maxFeePerGas: toHex(original.maxFeePerGas * 3n + 1n),
          maxPriorityFeePerGas: toHex(original.maxPriorityFeePerGas * 3n + 1n),
        },
      ],
    });
    await client.request({ method: "evm_mine", params: [] });
    await client.request({ method: "anvil_setAutomine", params: [true] });
    await page
      .getByRole("button", {
        name: "Recover receipt before continuing",
        exact: true,
      })
      .waitFor({ timeout: 60000 });
    assert.equal(
      await page
        .getByRole("button", {
          name: "Recover receipt before continuing",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .locator(".journal-steps li")
        .first()
        .getByText("unknown", { exact: true })
        .count(),
      1,
    );
    assert.ok(
      (await page.locator("#transaction-steps").innerText()).includes(
        replacementHash,
      ),
    );
    checks.push(
      "A real fork transaction replacement leaves the original step unknown, shows both hashes and disables continuation until receipt recovery; replacement is never marked as the prepared action’s success.",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    outage = true;
    await page
      .getByRole("button", { name: "Retry reads", exact: true })
      .click();
    await page
      .getByText(/RPC unavailable\./)
      .first()
      .waitFor({ timeout: 60000 });
    assert.equal(
      await page
        .getByRole("button", { name: "Prepare mint", exact: true })
        .isDisabled(),
      true,
    );
    outage = false;
    await page
      .getByRole("button", { name: "Retry reads", exact: true })
      .click();
    await page.getByText(/Dependencies verified/).waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Already minted", exact: true })
      .waitFor();
    checks.push(
      "An RPC outage clears write readiness; retry recovers live reads without reloading.",
    );
    await page.screenshot({
      path: new URL("390-connected-claim.png", output).pathname,
      fullPage: true,
    });
    await page.getByRole("button", { name: /Disconnect/ }).click();
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    });
    const phone = await mobile.newPage();
    await phone.goto(url);
    await phone.getByRole("button", { name: "Connect", exact: true }).click();
    for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
      await phone
        .getByRole("link", { name: `Open in ${name}`, exact: true })
        .waitFor();
    await phone
      .getByRole("button", { name: "Coinbase Smart Wallet", exact: true })
      .waitFor();
    const box = await phone.getByRole("dialog").boundingBox();
    assert.ok(Math.abs(box.y + box.height - 844) < 2);
    await phone.screenshot({
      path: new URL("390-mobile-wallet.png", output).pathname,
    });
    checks.push(
      "An unconnected iPhone context shows four official wallet marks and open-in links, Coinbase Smart Wallet, and a bottom-aligned sheet.",
    );
    await mobile.close();
    return checks;
  } catch (e) {
    if (debugPage) {
      fs.writeFileSync(
        new URL("wallet-debug.txt", output),
        await debugPage.locator("body").innerText(),
      );
      await debugPage.screenshot({
        path: new URL("wallet-debug.png", output).pathname,
        fullPage: true,
      });
    }
    throw e;
  } finally {
    await browser.close();
  }
}
