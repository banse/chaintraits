// Isolated local fixture checks for recovery, payment and dialog focus.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const output = new URL(
  "../../../../reports/sworn-mint-after-2026-10-25/evidence/ui-task-flows.json",
  import.meta.url,
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = { checks: [], errors: [] };
async function setup(scenario) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto("http://127.0.0.1:8799/#/mint");
  await page
    .getByRole("heading", { name: "Mint Card", exact: true })
    .waitFor();
  await page.locator(".mint-lab-drawer > summary").click();
  await page
    .getByLabel("Wallet scenario", { exact: true })
    .selectOption(scenario);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to Mint Card", exact: true })
    .click();
  await page.getByRole("button", { name: "Mock wallet", exact: true }).click();
  return { page, context };
}
async function state(page) {
  return page.evaluate(async () =>
    (
      await fetch("/__mock/state", {
        headers: {
          "X-Sworn-Mock-Session": sessionStorage.getItem(
            "sworn.mint-after.session",
          ),
        },
      })
    ).json(),
  );
}
try {
  {
    const { page, context } = await setup("wrong-chain");
    await page
      .locator(".mint-panel")
      .getByRole("button", { name: "Switch to Ethereum", exact: true })
      .click();
    const trigger = page.getByRole("button", {
      name: "Mint Card",
      exact: true,
    });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(
      page.getByRole("dialog", { name: "Mint your Sworn card", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".claim-copy")).not.toContainText(
      "Switch to Ethereum before preparing",
    );
    result.checks.push({
      name: "wrong network recovers at primary action and FIRST prepare opens card review",
      passed: true,
    });
    for (const close of ["escape", "icon", "button"]) {
      if (close !== "escape") await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: "Mint your Sworn card",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      if (close === "escape") await page.keyboard.press("Escape");
      else if (close === "icon")
        await dialog
          .getByRole("button", { name: "Close payment dialog", exact: true })
          .click();
      else
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      result.checks.push({
        name: `${close} returns focus to card trigger`,
        focus: await page.evaluate(() => ({
          tag: document.activeElement.tagName,
          text: document.activeElement.textContent,
        })),
        passed: true,
      });
    }
    assert.equal((await state(page)).transactions.length, 0);
    await context.close();
  }
  {
    const { page, context } = await setup("no-imd");
    const trigger = page.getByRole("button", {
      name: "Mint Card",
      exact: true,
    });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(page.locator(".claim-copy")).toContainText("Insufficient IMD");
    await expect(page.locator(".claim-copy")).toContainText("before approving");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const guarded = await state(page);
    assert.equal(guarded.transactions.length, 0);
    assert.equal(guarded.allowance, "0");
    result.checks.push({
      name: "no IMD blocks before approval and sends no transaction",
      balance: guarded.imdBalance,
      allowance: guarded.allowance,
      transactions: guarded.transactions,
      passed: true,
    });
    await page
      .locator("#card-payment")
      .getByRole("radio", { name: "ETH", exact: true })
      .check();
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Mint your Sworn card",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await page.locator("#payment-ack").check();
    for (const label of ["Buy IMD", "Approve IMD", "Mint Card"]) {
      const action = dialog
        .locator(".step-actions")
        .getByRole("button", { name: label, exact: true });
      await expect(action).toBeEnabled({ timeout: 20000 });
      await action.click();
      await expect(action).toBeDisabled();
      result.checks.push({
        name: `${label} enters asynchronous pending state`,
        passed: true,
      });
    }
    await expect(
      dialog.getByRole("region", { name: "Transaction result" }),
    ).toContainText("minted in the mock", { timeout: 20000 });
    const settled = await state(page);
    assert.equal(settled.token, "1");
    assert.equal(settled.transactions.length, 3);
    assert.deepEqual(
      settled.transactions.map((tx) => tx.status),
      ["confirmed", "confirmed", "confirmed"],
    );
    assert.equal(settled.transactions[1].functionName, "approve");
    assert.equal(settled.transactions[2].functionName, "mintCard");
    result.checks.push({
      name: "ETH top-up followed by exact approval and confirmed mint",
      token: settled.token,
      transactions: settled.transactions,
      passed: true,
    });
    await context.close();
  }
  assert.deepEqual(result.errors, []);
} catch (error) {
  result.failure = String(error);
  throw error;
} finally {
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
