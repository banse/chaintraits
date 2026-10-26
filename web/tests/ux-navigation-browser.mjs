// Isolated UI regression: synthetic reads and wallet, no signatures or public requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { fakeChain, fakeWallet, mockPage } from './fake-chain.mjs';
import { server } from './harness.mjs';

const out = new URL('../../../output/playwright/sworn-wallet-adjustments-2026-10-26/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const preview = await server();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await fakeWallet(context);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const report = { checks: [], screenshots: [], errors: [], measurements: {} };
page.on('pageerror', error => report.errors.push(error.message));
await mockPage(page, fakeChain({ token: 0n, traits: [] }));
await page.route('https://api.imd.fun/**', route => route.fulfill({
  contentType: 'application/json', body: JSON.stringify({ requests: [], entries: [] }),
}));
async function capture(name, width) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: overflow`);
  const file = `verified-${name}-${width}.png`;
  await page.screenshot({ path: new URL(file, out).pathname, fullPage: false });
  report.screenshots.push(file);
}
try {
  await page.goto(preview.url + '#/request');
  await page.getByRole('heading', { name: 'Mint Wallet Facts', exact: true }).waitFor();
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  assert.equal(await nav.locator('a:visible').count(), 7, 'Requested destinations are visible outside More');
  assert.equal(await page.getByRole('navigation', { name: 'Choose a task' }).count(), 0, 'No duplicate task navigation');
  const more = nav.locator('summary');
  await more.focus();
  await page.keyboard.press('Enter');
  await nav.getByRole('link', { name: 'Curator', exact: true }).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await nav.getByRole('link', { name: 'Curator', exact: true }).isVisible(), false);
  assert.equal(await more.evaluate(node => node === document.activeElement), true, 'Escape restores disclosure focus');
  await more.click();
  await page.getByRole('heading', { name: 'Mint Wallet Facts', exact: true }).click({ position: { x: 2, y: 2 } });
  assert.equal(await nav.getByRole('link', { name: 'Curator', exact: true }).isVisible(), false, 'Outside click closes More');
  await more.click();
  await nav.getByRole('link', { name: 'Curator', exact: true }).click();
  await page.getByRole('heading', { name: 'Curate and consume facts', exact: true }).waitFor();
  assert.equal(await nav.locator('a[aria-current="page"]').textContent(), 'Curator');
  await nav.getByRole('link', { name: 'Mint Facts', exact: true }).click();
  await page.getByRole('heading', { name: 'Mint Wallet Facts', exact: true }).waitFor();
  report.checks.push('Primary navigation, secondary destinations, keyboard Escape, outside dismissal, active route');

  const guide = page.locator('.fact-evidence-guide');
  assert.equal(await guide.getAttribute('open'), null);
  report.measurements.mobile = await page.evaluate(() => ({
    viewport: innerWidth,
    headerHeight: document.querySelector('.site-header').getBoundingClientRect().height,
    firstFactDocumentY: document.querySelector('.trait-picker .picker-row').getBoundingClientRect().top + scrollY,
  }));
  await page.getByRole('navigation', { name: 'Mint Facts sections' }).getByRole('link', { name: 'Choose facts to mint' }).click();
  await page.waitForFunction(() => document.getElementById('step-02')?.contains(document.activeElement));
  const firstChoice = page.locator('.trait-picker .picker-row').first();
  const box = await firstChoice.boundingBox();
  report.measurements.mobile.firstFactAfterJumpY = box?.y;
  assert.ok(box && box.y >= 0 && box.y + box.height < 844, `First fact reachable after section jump: ${JSON.stringify(box)}`);
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.querySelector('#step-02').contains(document.activeElement)), 'Tab continues inside the selected section');
  await guide.locator('summary').click();
  assert.equal(await guide.locator('.step-intros > p').count(), 3);
  assert.ok(await guide.getByText(/request fee is not refunded/).isVisible(), 'Expanded guide retains risk disclosures');
  await guide.locator('summary').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const width of [1440, 900, 390, 320]) await capture('mint-facts', width);
  report.checks.push('Collapsed evidence guide retains all three explanations; mobile section jump reaches the first fact');

  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole('link', { name: 'Fact Check', exact: true }).click();
  await page.getByRole('heading', { name: 'Fact Check', exact: true }).waitFor();
  const connect = page.locator('main').getByRole('button', { name: 'Connect wallet', exact: true });
  await connect.waitFor();
  await capture('fact-check-disconnected', 390);
  await connect.click();
  await page.getByRole('button', { name: 'Browser wallet', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await connect.evaluate(node => node === document.activeElement), true);
  report.checks.push('Fact Check empty state directly opens wallet connection and restores focus');

  await page.goto(preview.url + '#/fact-check?wallet=unresolved-ui-check.invalid');
  await page.getByRole('alert').waitFor();
  assert.doesNotMatch(await page.getByRole('alert').textContent(), /viem|Version:|ensUniversalResolver/);
  await page.getByLabel('Wallet address', { exact: true }).fill('0x2000000000000000000000000000000000000001');
  await page.getByRole('button', { name: 'View Fact Check' }).click();
  await page.locator('.fc-history-wallet').waitFor();
  assert.match(await page.locator('.fc-history-wallet').textContent(), /0x2000000000000000000000000000000000000001/);
  report.checks.push('Unresolved wallet names offer plain-language address recovery without technical internals');

  await page.goto(preview.url);
  const address = page.getByLabel('Explore a wallet', { exact: true });
  const description = await address.getAttribute('aria-describedby');
  assert.ok(description && await page.locator(`#${description}`).count(), 'Wallet input help exists');
  await address.fill('not-an-address');
  await page.getByRole('button', { name: 'Explore wallet' }).click();
  assert.equal(await address.getAttribute('aria-invalid'), 'true');
  assert.match(await page.locator(`#${description}`).textContent(), /40 hexadecimal characters/);
  assert.equal(await address.evaluate(node => node === document.activeElement), true);
  report.checks.push('Wallet input help and validation error are associated with the field');
  assert.deepEqual(await page.evaluate(() => window.__signing), []);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.writeFileSync(new URL('ux-regression.json', out), JSON.stringify(report, null, 2));
  await browser.close();
  await preview.close();
}
