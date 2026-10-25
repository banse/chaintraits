// Local-only regression: card creation cannot inherit another session's oracle UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext();
const result = {checks:[], errors:[], external:[]};
const origin = 'http://127.0.0.1:8799';
const output = new URL('../../../../reports/sworn-mint-progress-2026-10-25/card-progress-regression.json', import.meta.url);
context.on('page', page => {
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('request', request => {if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) result.external.push(request.url());});
});
const state = page => page.evaluate(async () => (await fetch('/__mock/state')).json());
async function connect(page) {
  await page.getByRole('button',{name:'Connect to Mint Card',exact:true}).click();
  await page.getByRole('button',{name:'Mock wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Mint Card',exact:true})).toBeEnabled();
}
try {
  const page = await context.newPage();
  await page.goto(origin + '/#/mint');
  await page.evaluate(() => {
    const id='0x'+'a'.repeat(64);
    localStorage.setItem('sworn.mint-after.request-records',JSON.stringify({
      ['1:0x0da2679000ea5380d1361cc3cca7d4e8c881f766:0x2000000000000000000000000000000000000001:'+id]: {id:601,name:'Swarmed',requestId:id},
    }));
  });
  await connect(page);
  await expect(page.locator('.verification-overview')).toHaveCount(0);
  assert.equal((await state(page)).requests.length,0);
  result.checks.push('Legacy origin-wide request cannot appear in a fresh session.');
  await page.evaluate(() => fetch('/__mock/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'configure',walletDelayMs:150,txDelayMs:600})}));
  await page.getByRole('button',{name:'Mint Card',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Mint your Sworn card',exact:true});
  await expect(dialog).toBeVisible();
  assert.equal((await state(page)).transactions.length,0);
  await expect(dialog.locator('.swarm-request')).toHaveCount(0);
  await page.locator('#payment-ack').check();
  for (const label of ['Approve IMD','Mint Card']) {
    const action=dialog.locator('.step-actions').getByRole('button',{name:label,exact:true});
    await expect(action).toBeEnabled({timeout:20000});
    await action.click();
    await expect(page.locator('.verification-overview')).toHaveCount(0);
    assert.equal((await state(page)).requests.length,0);
  }
  await expect(dialog).toContainText('Mint succeeded',{timeout:20000});
  const minted = await state(page);
  assert.equal(minted.token,'1');
  assert.deepEqual(minted.transactions.map(t=>t.functionName),['approve','mintCard']);
  assert.equal(minted.requests.length,0);
  result.checks.push('Review, approval, pending mint and completed mint create zero oracle requests.');
  await page.reload();
  await expect(page.locator('main')).toContainText('Mint succeeded');
  await expect(page.locator('.verification-overview')).toHaveCount(0);
  result.checks.push('Reload retains this session’s completed card and no verification.');
  const other=await context.newPage();
  await other.goto(origin+'/#/mint');
  await connect(other);
  await expect(other.locator('.verification-overview')).toHaveCount(0);
  await expect(other.locator('main')).not.toContainText('Mint succeeded');
  const fresh = await state(other);
  assert.equal(fresh.token,'0');
  assert.equal(fresh.requests.length,0);
  assert.equal(fresh.transactions.length,0);
  result.checks.push('A second tab shares origin storage but inherits neither journal nor requests.');
  await other.evaluate(() => fetch('/__mock/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'configure',walletDelayMs:100,txDelayMs:500,swarmDelayMs:4000,deliveryDelayMs:1000})}));
  await other.getByRole('link',{name:'Mint Facts',exact:true}).click();
  await other.getByRole('button',{name:'Mint Facts: 601 / Swarmed',exact:true}).click();
  const verification = other.getByRole('dialog');
  await other.locator('#payment-ack').check();
  for (const name of ['Approve IMD','Request 601 / Swarmed']) {
    const action=verification.locator('.step-actions').getByRole('button',{name,exact:true});
    await expect(action).toBeEnabled({timeout:20000});
    await action.click();
  }
  await expect(verification).toContainText('Fact proven for your wallet',{timeout:20000});
  await other.reload();
  await expect(other.locator('.verification-overview')).toContainText('Fact proven for your wallet',{timeout:15000});
  assert.equal((await state(other)).requests.length,1);
  await other.getByRole('link',{name:'Mint Card',exact:true}).first().click();
  await expect(other.locator('.verification-overview')).toContainText('Separately requested verification');
  await expect(other.locator('.verification-overview')).not.toContainText('Creating a card does not start verification');
  result.checks.push('An explicitly submitted verification completes, survives reload, and is labeled separately on Mint Card.');
  await page.locator('.mint-lab-drawer > summary').click();
  await page.getByRole('button',{name:'Reset scenario',exact:true}).click();
  await expect(page.locator('main')).not.toContainText('Mint succeeded');
  assert.equal((await state(page)).token,'0');
  assert.equal((await state(other)).requests.length,1);
  await other.reload();
  await expect(other.locator('.verification-overview')).toContainText('Fact proven for your wallet',{timeout:15000});
  result.checks.push('Reset clears only this session’s journal.');
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.external,[]);
  result.passed=true;
} catch(error) {
  result.failure=String(error.stack||error);
  process.exitCode=1;
} finally {
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  await browser.close();
}
