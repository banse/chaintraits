// Local after-version UI acceptance. All wallet and chain replies are fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";

const evidence = new URL(
  "../../../../reports/sworn-mint-after-2026-10-25/evidence/",
  import.meta.url,
);
const images = new URL(
  "../../../../output/playwright/sworn-mint-after-2026-10-25/",
  import.meta.url,
);
fs.mkdirSync(images, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:8799/#/mint");
  await expect(
    page.getByRole("heading", { name: "Mint Card", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#step-02")).toHaveCount(0);
  await expect(page.locator("#spec-kind")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Connect to Mint Card", exact: true })
    .click();
  await page.getByRole("button", { name: "Mock wallet", exact: true }).click();
  const create = page.getByRole("button", {
    name: "Mint Card",
    exact: true,
  });
  await expect(create).toBeEnabled();
  await expect(page.locator("#snapshot")).toContainText("Spawned");
  await expect(page.locator("#snapshot")).toContainText(
    "Joined WhitelistCurator.sol",
  );
  await expect(page.locator("#snapshot")).toContainText("Original wallet:");
  await expect(page.locator("#snapshot")).toContainText(
    "Future direct-fact checks use that saved result",
  );
  await page
    .locator("#card-payment")
    .getByRole("radio", { name: "ETH", exact: true })
    .check();
  await expect(page.locator("#card-payment")).toContainText(
    "Uses existing IMD first",
  );
  checks.push({
    name: "card task only, named snapshot, original wallet, permanent result and honest ETH behavior",
    passed: true,
  });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await create.scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const payment = document
        .querySelector("#card-payment")
        .getBoundingClientRect();
      const action = [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Mint Card")
        .getBoundingClientRect();
      return {
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
        paymentBottom: payment.bottom,
        actionTop: action.top,
        gap: action.top - payment.bottom,
      };
    });
    assert.ok(geometry.width <= width, JSON.stringify(geometry));
    assert.ok(
      geometry.gap >= 0 && geometry.gap < 160,
      JSON.stringify(geometry),
    );
    await page.locator("#card-payment input[value=ETH]").focus();
    await page.keyboard.press("Tab");
    await expect(create).toBeFocused();
    const focus = await create.evaluate((el) => ({
      outline: getComputedStyle(el).outlineStyle,
      width: getComputedStyle(el).outlineWidth,
      height: el.getBoundingClientRect().height,
    }));
    assert.notEqual(focus.outline, "none");
    assert.ok(parseFloat(focus.width) >= 2);
    assert.ok(focus.height >= 44);
    await page.screenshot({
      path: new URL(`ui-card-${width}.png`, images).pathname,
      fullPage: true,
    });
    checks.push({
      name: `card payment adjacency, no page overflow, keyboard focus at ${width}px`,
      geometry,
      focus,
      passed: true,
    });
  }

  await page
    .getByRole("navigation", { name: "Choose a task" })
    .getByRole("link", { name: "Mint Facts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mint Facts", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#mint")).toHaveCount(0);
  await expect(page.locator("#spec-kind")).toHaveCount(0);
  await expect(
    page
      .locator("#request-payment")
      .getByRole("radio", { name: "IMD", exact: true }),
  ).toBeChecked();
  await page
    .locator("#request-payment")
    .getByRole("radio", { name: "ETH", exact: true })
    .check();
  await expect(
    page
      .locator("#selected-request-payment")
      .getByRole("radio", { name: "ETH", exact: true }),
  ).toBeChecked();
  checks.push({
    name: "request task only, independent payment choice, synced request controls",
    passed: true,
  });

  await page
    .getByRole("navigation", { name: "Choose a task" })
    .getByRole("link", { name: "Mint Rule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mint Rule", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#spec-kind")).toBeVisible();
  await expect(page.locator("#mint")).toHaveCount(0);
  await expect(page.locator("#step-02")).toHaveCount(0);
  await expect(
    page
      .locator("#registration-payment")
      .getByRole("radio", { name: "IMD", exact: true }),
  ).toBeChecked();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: new URL("ui-register-320.png", images).pathname,
    fullPage: true,
  });
  checks.push({
    name: "registration task only, local payment control, 320px layout",
    passed: true,
  });

  await page.goto("http://127.0.0.1:8799/#/mint?trait=601");
  await expect(
    page.getByRole("heading", { name: "Mint Facts", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#pick-601 input[type=checkbox]")).toBeChecked();
  assert.match(
    await page.title(),
    /^Sworn mint after \| Mint Facts$/,
  );
  checks.push({
    name: "legacy mint fact link opens and selects verification",
    passed: true,
  });
  for (const [route, actionContainer] of [
    ["/mint", ".mint-panel"],
    ["/request", ".request-action-summary"],
    ["/register", ".community-form"],
  ]) {
    await page.goto("http://127.0.0.1:8799/#/mint");
    await page.locator(".mint-lab-drawer > summary").click();
    await page
      .getByLabel("Wallet scenario", { exact: true })
      .selectOption("wrong-chain");
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Connect to Mint Card", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Connect to Mint Card", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mock wallet", exact: true })
      .click();
    if (route !== "/mint")
      await page
        .locator(`nav[aria-label="Choose a task"] a[href="#${route}"]`)
        .click();
    const recovery = page
      .locator(actionContainer)
      .getByRole("button", { name: "Switch to Ethereum", exact: true });
    await expect(recovery).toBeVisible();
    await recovery.click();
    await expect(recovery).toHaveCount(0);
    await expect(
      page.locator(".site-header").getByRole("button", { name: /Disconnect/ }),
    ).toBeVisible();
    checks.push({
      name: `network switch works in ${route} task action slot`,
      passed: true,
    });
  }
  assert.deepEqual(pageErrors, []);
  fs.writeFileSync(
    new URL("ui-browser.log", evidence),
    JSON.stringify({ checks, pageErrors }, null, 2),
  );
  console.log(JSON.stringify({ checks, pageErrors }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
