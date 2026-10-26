// Isolated UI regression. Synthetic wallet/RPC replies, no signatures or external calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { fakeChain, fakeWallet, mockPage, sharedSpec, wallet, registryLog } from './fake-chain.mjs';
import { server } from './harness.mjs';

const out = new URL('../../../output/playwright/sworn-wallet-adjustments-2026-10-26/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const image = 'data:image/svg+xml;base64,' + fs.readFileSync(new URL('../../dist/art/full-house.svg', import.meta.url)).toString('base64');
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Synthetic UI test card', image })).toString('base64');
const registry = JSON.parse(fs.readFileSync(new URL('../../dist/imd-deployment.json', import.meta.url))).contracts.find(c => c.name === 'Registry').address;
const preview = await server();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { checks: [], screenshots: [], errors: [] };
let context, page;
async function setup(options, route, connected = true) {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fakeWallet(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  const fixture = fakeChain({ allowance: 10n ** 22n, uri, ...options });
  const answer = fixture.answer;
  fixture.answer = payload => payload.method === 'eth_getTransactionCount' ? options.nonce || '0x19' : answer(payload);
  await mockPage(page, fixture);
  await page.route('https://api.imd.fun/**', route => {
    const record = options.oracleRecord;
    const path = new URL(route.request().url()).pathname;
    const body = record && path === `/oracle/requests/${record.id}` ? record
      : { requests: record ? [record] : [], entries: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(preview.url + route);
  await page.getByText(/Ethereum mainnet · block .*current oracle quote/).waitFor();
  if (connected) {
    await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
    await page.getByRole('button', { name: 'Browser wallet', exact: true }).click();
    await page.getByRole('button', { name: /Disconnect/ }).waitFor();
  }
  await page.evaluate(() => {
    const badge = document.createElement('div');
    badge.textContent = 'UI TEST DATA — NOT PROOF';
    badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;background:#17130b;color:#ffe7a0;border:1px solid #ffe7a0;padding:4px 8px;font:11px monospace';
    document.body.append(badge);
  });
  return fixture;
}
async function capture(name, width = 1440) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
  const file = `${name}.png`;
  await page.screenshot({ path: new URL(file, out).pathname });
  report.screenshots.push(file);
  assert.deepEqual(await page.evaluate(() => window.__signing), []);
}
async function verifyHiveTable(container) {
  const table = container.getByRole('table', { name: 'Minted wallet facts' });
  await table.waitFor();
  assert.deepEqual(await table.locator('tbody tr').evaluateAll(rows => rows.map(row => row.dataset.factId)), ['101', '601', '10001']);
  const hive = container.getByRole('button', { name: 'Inspect Swarmed cell', exact: true });
  await hive.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await hive.click();
  assert.equal(await hive.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await table.locator('[data-highlighted="true"]').evaluateAll(rows => rows.map(row => row.dataset.factId)), ['601', '10001']);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) < 2, 'Hive selection never scrolls the page');
  await hive.click();
  assert.equal(await table.locator('[data-highlighted="true"]').count(), 0, 'Same cell clears highlighting');
}
try {
  await setup({ token: 7n, traits: [101, 601], verifiedSpecs: [10001], nextSpecId: 10002,
    specs: { 10001: { ...sharedSpec, kind: 4, item: 'function balanceOf(address) view returns (uint256)', op: 1, name: 'Community balance' } } }, '#/mint');
  await page.locator('#your-card').getByRole('table', { name: 'Minted wallet facts' }).waitFor();
  await page.waitForFunction(() => { const img = document.querySelector('#your-card img'); return img?.complete && img.naturalWidth > 0; });
  assert.equal(await page.locator('nav[aria-label="Main navigation"] a[href="#/wallet"]').count(), 0);
  assert.equal(await page.locator('nav[aria-label="Main navigation"] a[aria-current="page"]').textContent(), 'Mint Card');
  assert.equal(await page.getByRole('button', { name: 'Mint Card', exact: true }).count(), 0);
  await verifyHiveTable(page.locator('#your-card'));
  assert.equal(await page.getByRole('link', { name: 'View Claimed Facts', exact: true }).count(), 0);
  await capture('mint-card-desktop');
  await capture('mint-card-mobile', 390);
  await page.locator('#your-card').screenshot({ path: new URL('mint-card-mobile-section.png', out).pathname });
  report.screenshots.push('mint-card-mobile-section.png');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Mint Facts', exact: true }).click();
  await page.locator('#held-10001').waitFor();
  assert.equal(await page.locator('#your-card').count(), 0);
  assert.equal(await page.locator('nav[aria-label="Main navigation"] a[aria-current="page"]').textContent(), 'Mint Facts');
  assert.ok(await page.locator('#claimed-facts').evaluate(node => node.getBoundingClientRect().top < document.querySelector('#step-02').getBoundingClientRect().top));
  assert.equal(await page.locator('#recent-requests').getAttribute('open'), null);
  await page.getByRole('heading', { name: 'Mint Wallet Facts', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Claimed Wallet Facts', exact: true }).waitFor();
  assert.equal(await page.locator('.trait-picker input[type="checkbox"]').count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Review your selected requests' }).count(), 0);
  assert.equal(await page.locator('#pick-601').getByRole('button', { name: /Mint Fact/ }).count(), 0);
  assert.ok(await page.locator('#pick-601').evaluate(node => node.classList.contains('is-minted')), 'Claimed fact row is visibly unavailable');
  const claimedStyle = await page.locator('#pick-601').evaluate(row => ({
    base: getComputedStyle(row).color,
    label: getComputedStyle(row.querySelector('strong')).color,
    status: getComputedStyle(row.querySelector('.minted-fact strong')).color,
    image: getComputedStyle(row.querySelector('.mini-card')).filter,
  }));
  assert.equal(claimedStyle.label, claimedStyle.base);
  assert.equal(claimedStyle.status, claimedStyle.base);
  assert.match(claimedStyle.image, /grayscale\(1\)/);
  await page.locator('#pick-601').screenshot({ path: new URL('claimed-row-muted.png', out).pathname });
  report.screenshots.push('claimed-row-muted.png');
  await capture('mint-facts-desktop');
  await capture('mint-facts-mobile', 390);
  await page.goto(preview.url + '#/wallet?view=history#held-601');
  await page.locator('#held-601').waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Mint Wallet Facts', exact: true }).count(), 1);
  await page.getByRole('button', { name: /Disconnect/ }).click();
  await page.getByText('Connect your wallet to see its claimed facts.', { exact: true }).waitFor();
  assert.equal(await page.locator('#held-601').count(), 0);
  report.checks.push('Existing card, grouped claimed facts, direct navigation, mobile layout, legacy held-fact bookmark');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(preview.url + `#/explorer?address=${wallet}`);
  const explorer = page.locator('#explorer');
  await verifyHiveTable(explorer);
  assert.equal(await explorer.locator('.wallet-metrics').count(), 0);
  assert.equal(await explorer.getByRole('button', { name: 'Read signed verdict' }).count(), 0);
  assert.equal(await page.locator('#wallet-facts .highlight').count(), 0);
  await explorer.locator('.wallet-summary').screenshot({ path: new URL('explorer-summary-desktop.png', out).pathname });
  report.screenshots.push('explorer-summary-desktop.png');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('heading', { name: 'About Sworn', exact: true }).waitFor();
  await nav.getByRole('link', { name: 'Catalog', exact: true }).click();
  await explorer.locator('.wallet-summary-address').waitFor();
  assert.equal((await explorer.locator('.wallet-summary-address').innerText()).toLowerCase(), wallet.toLowerCase());
  assert.equal((await explorer.getByLabel('Explore a wallet', { exact: true }).inputValue()).toLowerCase(), wallet.toLowerCase());
  for (const width of [390, 320]) {
    await capture(`explorer-${width}`, width);
    await explorer.locator('.wallet-summary').screenshot({ path: new URL(`explorer-summary-${width}.png`, out).pathname });
    report.screenshots.push(`explorer-summary-${width}.png`);
  }
  const other = '0x2000000000000000000000000000000000000002';
  await page.goto(preview.url + `#/explorer?address=${other}`);
  await page.waitForFunction(address => document.querySelector('.wallet-summary-address')?.textContent.toLowerCase() === address, other);
  report.checks.push('Explorer persists its wallet across navigation; explicit wallet links override it; shared table highlights builtin and community rows without scrolling');

  await setup({ token: 0n, traits: [101, 601] }, '#/request');
  await page.locator('#held-601').waitFor();
  assert.equal(await page.locator('#held-101').count(), 0);
  await capture('cardless-claimed-facts');
  report.checks.push('Cardless verified facts remain accessible; unsaved direct preview is excluded');

  await setup({ token: 0n, traits: [] }, '#/request');
  await page.getByText('No claimed facts yet. Choose a fact below to verify; a card is optional.', { exact: true }).waitFor();
  await capture('empty-facts-mobile', 390);
  report.checks.push('Connected empty wallet shows a useful next action');

  await setup({ token: 0n, traits: [], joined: false, specs: { 601: { ...sharedSpec, target: '0x1111111111111111111111111111111111111111', kind: 6, threshold: 3n } } }, '#/request');
  await page.getByRole('button', { name: /Show ineligible facts/ }).click();
  await page.locator('#pick-701').waitFor();
  assert.equal(await page.locator('#pick-701').getByRole('button', { name: /Mint Fact/ }).count(), 0);
  const swarmed = page.locator('#pick-601');
  await swarmed.getByText(/does not meet this rule/).waitFor();
  assert.equal(await swarmed.getByRole('button', { name: /Mint Fact/ }).count(), 0);
  await capture('ineligible-facts', 1440);
  report.checks.push('Known ineligible facts retain their explanation but offer no Mint Fact action');

  await setup({ token: 0n, traits: [], specs: { 1301: { ...sharedSpec, kind: 5, threshold: 20n } } }, '#/request');
  await page.getByRole('button', { name: 'Mint Fact: 1301 / Pretrained', exact: true }).click();
  const payment = page.getByRole('dialog');
  await payment.locator('#payment-ack').waitFor();
  assert.match(await payment.innerText(), /1301 \/ Pretrained/);
  assert.equal(await payment.locator('#payment-ack').isChecked(), false, 'Single-fact request still requires explicit payment acknowledgement');
  assert.equal(await payment.locator('.fact-check-view').count(), 0, 'No tracking flow returns inside the payment dialog');
  assert.deepEqual(await page.evaluate(() => window.__signing), []);
  await page.keyboard.press('Escape');
  report.checks.push('An eligible single-fact action opens its payment review without signatures and retains acknowledgement');

  const requestId = '0x' + 'a1'.repeat(32);
  const questionHash = '0x' + 'b1'.repeat(32);
  const oracleId = '23474d49-bf7c-40e0-8dad-41636c73ea84';
  const oracleBytes = '0x23474d49bf7c40e08dad41636c73ea84' + '00'.repeat(16);
  const historical = {
    token: 7n, traits: [601],
    pending: [{ id: 601, requestId, questionHash, requestedAt: 1792600000n, cleared: true }],
    verifiedEvents: [registryLog('Verified', { claimant: wallet, traitId: 601, requestId, oracleRequestId: oracleBytes })],
    verifiedRecords: { 601: [requestId, oracleBytes, 25769870n, 26249800n] },
    oracleRecord: { id: oracleId, question: `Did wallet ${wallet} complete at least three accepted jobs?`, questionHash,
      createdAt: new Date(1792600000 * 1000).toISOString(), consumer: { verifyingContract: registry, chainId: 1 },
      answerType: 'bool', status: 'completed', panelSize: 11, quorum: 7,
      members: Array.from({ length: 8 }, (_, i) => ({ tokenId: String(110 + i), ok: true, answer: { answer: i !== 7 } })),
      agreement: { answer: true } },
  };
  await setup(historical, `#/fact-check?wallet=${wallet}`, false);
  await page.getByRole('link', { name: 'View agents and results', exact: true }).click();
  const historyView = page.locator('.fact-check-view[data-presentation="history"]');
  await historyView.locator('.fc-result-agents [data-identity-token-id="110"]').waitFor();
  assert.equal(await historyView.locator('.fc-returned-art').count(), 0);
  assert.equal(await historyView.locator('.fc-result-agents [data-identity-token-id]').count(), 8);
  assert.match(await historyView.innerText(), /7 TRUE · 1 FALSE/);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await historyView.screenshot({ path: new URL(`history-agents-${width}.png`, out).pathname });
    report.screenshots.push(`history-agents-${width}.png`);
  }
  historical.oracleRecord.members = [];
  await page.reload();
  await historyView.getByText('Agent data unavailable', { exact: true }).waitFor();
  assert.equal(await historyView.locator('[data-identity-token-id]').count(), 0);
  assert.equal(await historyView.locator('.fc-returned-art').count(), 0);
  report.checks.push('Fact History opens recorded agent IDs and TRUE/FALSE answers; missing historical agents stay explicitly unavailable instead of showing wallet artwork');

  await setup({}, '#/mint', false);
  await capture('disconnected-mint-mobile', 390);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Mint Facts', exact: true }).click();
  await page.getByText('Connect your wallet to see its claimed facts.', { exact: true }).waitFor();
  await capture('disconnected-facts-mobile', 390);
  assert.equal(await page.locator('#held-601').count(), 0);
  report.checks.push('Disconnected card/facts pages keep clear connection actions and no prior wallet record');
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.message;
  report.failedPage = await page.locator('main').innerText().catch(() => 'Page unavailable');
  await page.screenshot({ path: new URL('failure.png', out).pathname }).catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(new URL('review-evidence.json', out), JSON.stringify(report, null, 2));
  await browser.close();
  await preview.close();
}
