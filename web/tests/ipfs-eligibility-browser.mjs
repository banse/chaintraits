import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { parseAbiItem, encodeEventTopics, toHex } from 'viem';
import { fakeChain, fakeWallet, mockPage, wallet } from './fake-chain.mjs';
import { server } from './harness.mjs';

const root = process.env.SWORN_BROWSER_REPORT_DIR ? new URL(process.env.SWORN_BROWSER_REPORT_DIR) : new URL('../../test/scratch/ipfs-eligibility/', import.meta.url);
fs.mkdirSync(root, { recursive: true });
const shots = process.env.SWORN_BROWSER_SCREENSHOT_DIR ? new URL(process.env.SWORN_BROWSER_SCREENSHOT_DIR) : new URL('screenshots/', root);
fs.mkdirSync(shots, { recursive: true });
const evidence = { at: new Date().toISOString(), checks: [], scenarios: [], errors: [] };
const preview = await server(); // Static /preview/ path, no backend and no RPC proxy used.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const manifest = JSON.parse(fs.readFileSync(new URL('../public/data/eligibility/manifest.json', import.meta.url)));
const seat = '0x0000ec93127baa929e58e97dd0095a2bfb38ec1d';
const spec = { ...manifest.facts[701].spec, kind: 6, target: seat, item: '', arg: '', threshold: 3n, fromBlock: 25090085n, toBlock: 0n };
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
let lastPage;
try {
  for (const mode of (process.argv[2] ? [process.argv[2]] : ['never-held', 'seat-only', 'unavailable', 'accepted-fact'])) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await fakeWallet(context);
    const page = await context.newPage(); page.setDefaultTimeout(35000);
    lastPage = page;
    page.on('pageerror', e => evidence.errors.push(e.message));
    const fixture = fakeChain({ token: 1n, specs: { 601: spec }, proven: mode === 'accepted-fact' ? [601] : [] });
    const original = fixture.answer; const seatCalls = [];
    fixture.answer = p => {
      if (p.method === 'eth_getLogs' && p.params[0].address?.toLowerCase() === seat) {
        seatCalls.push(p);
        if (mode === 'unavailable') throw Error('Cannot read the chain');
        if (mode !== 'seat-only') return [];
        return [{ address: seat, blockNumber: toHex(25090085), blockHash: '0x'+'11'.repeat(32),
          transactionHash: '0x'+'22'.repeat(32), logIndex: '0x0', data: '0x', removed: false,
          topics: encodeEventTopics({ abi: [transfer], eventName: 'Transfer', args: {
            from: manifest.curator, to: wallet, tokenId: 1n } }) }];
      }
      if (p.method === 'eth_getTransactionCount') return '0x14';
      return original(p);
    };
    await mockPage(page, fixture);
    await page.goto(preview.url+'#/explorer?address='+wallet);
    await page.getByText('Wallet facts loaded.', { exact: true }).waitFor();
    let row = page.locator('#trait-601');
    if (mode === 'never-held') {
      await page.waitForFunction(() => !document.querySelector('#trait-601'));
      await page.locator('.fact-rows .eligibility-toggle').click();
      await row.getByText(/no IdentityMD seat received/).waitFor();
    } else if (mode === 'seat-only') {
      await row.getByText(/Seat history found; eligibility is not confirmed/).waitFor();
    } else if (mode === 'unavailable') {
      await row.getByText(/Could not check eligibility/).waitFor();
    } else {
      await row.getByText('Verified fact', { exact: true }).waitFor();
      assert.equal(seatCalls.length, 0, 'accepted Registry facts are not revoked by a current seat check');
    }
    if (mode !== 'accepted-fact') {
      assert.doesNotMatch(await row.innerText(), /finds this rule met|Verified fact/);
    }
    await row.screenshot({ path: new URL(`${mode}.png`, shots).pathname });
    if (mode === 'seat-only') {
      await page.goto(preview.url+'#/request?trait=601');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await page.getByRole('button', { name: 'Browser wallet', exact: true }).click();
      await page.locator('#pick-601').getByText(/Seat history found; eligibility is not confirmed/).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
      await page.locator('#pick-601').screenshot({ path: new URL('mint-seat-only-mobile.png', shots).pathname });
    }
    assert.deepEqual(await page.evaluate(() => window.__signing), []);
    evidence.scenarios.push({ mode, seatRpcCalls: seatCalls.length, signatures: 0 });
    console.log('PASS', mode);
    await context.close();
  }
  evidence.checks.push('All four eligibility cases render under a nested static path without a backend; Mint completes the partial-evidence check after connecting with fact 601 preselected; no wallet signatures.');
  assert.deepEqual(evidence.errors, []);
} catch (e) {
  evidence.failure = e.stack;
  if (lastPage && !lastPage.isClosed()) {
    evidence.body = await lastPage.locator('body').innerText();
    await lastPage.screenshot({ path: new URL('failure.png', shots).pathname });
  }
  throw e;
}
finally {
  fs.writeFileSync(new URL('browser.json', root), JSON.stringify(evidence, null, 2)+'\n');
  await browser.close(); await preview.close();
}
