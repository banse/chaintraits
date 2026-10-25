// Integrated local-only UX regression; every chain/oracle reply is a fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
const origin='http://127.0.0.1:8799';
const report=new URL('../../../../reports/sworn-mint-refinement-2026-10-25/browser.json',import.meta.url);
const shots=new URL('../../../../output/playwright/sworn-mint-refinement-2026-10-25/',import.meta.url);
fs.mkdirSync(shots,{recursive:true});
const result={checks:[],errors:[],external:[],screenshots:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
async function setup() {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('data:'))result.external.push(r.url());});
  await page.goto(origin+'/#/mint');
  await page.getByRole('button',{name:'Connect to Mint Card',exact:true}).click();
  await page.getByRole('button',{name:'Mock wallet',exact:true}).click();
  await page.evaluate(()=>fetch('/__mock/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'configure',walletDelayMs:100,txDelayMs:500,swarmDelayMs:10000,deliveryDelayMs:1000})}));
  return {context,page};
}
const state=p=>p.evaluate(async()=>{const s=await fetch('/__mock/state').then(r=>r.json());return{token:s.token,requests:s.requests,transactions:s.transactions,proven:s.proven};});
async function mint(p) {
  await p.getByRole('button',{name:'Mint Card',exact:true}).click();
  const d=p.getByRole('dialog');await p.locator('#payment-ack').check();
  for(const name of ['Approve IMD','Mint Card']) {
    const b=d.locator('.step-actions').getByRole('button',{name,exact:true});await expect(b).toBeEnabled({timeout:20000});await b.click();
  }
  await expect(d.locator('.card-created')).toBeVisible({timeout:20000});return d;
}
async function shot(locator,name) {const path=new URL(name+'.png',shots).pathname;await locator.screenshot({path});result.screenshots.push(path);}
try {
  const {page:p,context}=await setup();
  const d=await mint(p);
  await shot(d.locator('.card-created'),'success-dismissable');
  await d.getByRole('button',{name:'Dismiss mint success message'}).click();
  await expect(p.locator('.card-created')).toHaveCount(0);
  await d.getByRole('button',{name:'Close',exact:true}).click();
  await p.reload();await expect(p.getByRole('heading',{name:'Mint Card',exact:true})).toBeVisible();
  await expect(p.locator('.card-created')).toHaveCount(0);
  assert.equal((await state(p)).requests.length,0);
  result.checks.push('Close dismisses popup and top mint success; it stays dismissed after reload.');
  await p.getByRole('link',{name:'Mint Facts',exact:true}).click();
  await p.getByRole('button',{name:'Mint Facts: 601 / Swarmed',exact:true}).click();
  await p.locator('#payment-ack').check();
  for(const name of ['Approve IMD','Request 601 / Swarmed']) {
    const b=d.locator('.step-actions').getByRole('button',{name,exact:true});await expect(b).toBeEnabled({timeout:20000});await b.click();
  }
  await expect(d.locator('.swarm-request')).toBeVisible({timeout:20000});
  await expect(p.getByRole('button',{name:'Watch at top of page'})).toHaveCount(0);
  await d.getByText('Request details',{exact:true}).click();
  await expect(d.locator('.swarm-question-full')).toContainText('at least 3 accepted Identity.md swarm jobs');
  await expect(d).toContainText('Step 3, accepted jobs');
  await expect(d).toContainText('Pinned window');
  await expect(d.getByRole('button',{name:'Show full question'})).toHaveCount(0);
  assert.equal(await d.locator('.swarm-question-full').evaluate(el=>getComputedStyle(el).webkitLineClamp),'none');
  result.checks.push('Request details displays full source-derived question, definitions and fixed window without nested clamp.');
  await d.getByRole('button',{name:'Close',exact:true}).click();
  const top=p.locator('.verification-overview');
  await expect(top).toContainText('Fact proven for your wallet',{timeout:25000});
  await expect(p.locator('main')).not.toContainText('Creating a card does not start verification. These are requests you submitted separately.');
  for (const width of [1440,390,320]) {
    await p.setViewportSize({width,height:1000});
    const boxes=await top.locator('.agent-strip > li').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{y:r.y,h:r.height,margin:getComputedStyle(n).marginTop};}));
    assert.equal(boxes.length,11);
    assert.ok(boxes.every(b=>b.margin==='0px'));
    assert.ok(Math.max(...boxes.map(b=>b.h))-Math.min(...boxes.map(b=>b.h))<1);
    const phases=await top.locator('.verification-phases > li').evaluateAll(ns=>ns.map(n=>getComputedStyle(n).marginTop));
    assert.ok(phases.every(m=>m==='0px'));
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await shot(top,'verification-'+width);
  }
  result.checks.push('All 11 agent cells have equal heights and zero inherited margins at 1440,390,320px; no page overflow.');
  await context.close();
  const second=await setup();const q=second.page;const qd=await mint(q);
  await qd.getByRole('link',{name:'View your card on Wallet',exact:true}).click();
  await expect(q).toHaveURL(/#\/wallet/);
  await q.getByRole('link',{name:'Mint Card',exact:true}).first().click();
  await expect(q.locator('.card-created')).toHaveCount(0);
  await q.reload();await expect(q.getByRole('heading',{name:'Mint Card',exact:true})).toBeVisible();
  await expect(q.locator('.card-created')).toHaveCount(0);
  result.checks.push('Wallet CTA dismisses mint success permanently for that mint across navigation and reload.');
  await q.goto(origin+'/#/explorer');
  const before=await state(q);
  const names=['Direct facts, no card','Verified wallet, no card','Card with a new holder','Verification pending','No verdict','Shared result, not applied'];
  for(const name of names) {
    await q.getByRole('button',{name,exact:true}).click();
    const sample=q.getByRole('region',{name:'Sample wallet result'});
    await expect(sample).toContainText('Sample — not proof');
    await expect(sample.locator('h3').first()).toHaveText(name);
    await expect(sample.getByRole('button',{name:/settle|request verification|pay/i})).toHaveCount(0);
    assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await q.getByRole('button',{name:'Card with a new holder',exact:true}).click();
  const sample=q.getByRole('region',{name:'Sample wallet result'});
  await expect(sample).toContainText('Current card holder');
  await shot(sample,'explorer-transferred-card');
  await sample.getByRole('button',{name:'Inspect Bullfrog cell',exact:true}).click();
  await expect(sample.getByRole('button',{name:'Show all families'})).toBeVisible();
  await sample.getByLabel('Only facts present').check();
  await expect(sample).toContainText('No facts in this family are present in the sample');
  await sample.getByRole('button',{name:'Show all families'}).click();
  await expect(sample.locator('.sample-empty')).toHaveCount(0);
  await q.setViewportSize({width:390,height:1000});
  await q.getByRole('button',{name:'Shared result, not applied',exact:true}).click();
  await expect(sample).toContainText('Shared result ready · not applied');
  await shot(sample,'explorer-shared-mobile');
  assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await state(q),before);
  await q.getByLabel('Explore a wallet',{exact:true}).fill('0x9000000000000000000000000000000000000009');
  await q.getByRole('button',{name:'Explore wallet',exact:false}).click();
  await expect(q.locator('#explorer')).toContainText('No local fixture exists for this address');
  await expect(q.locator('.explorer-sample')).toHaveCount(0);
  assert.deepEqual(await state(q),before);
  result.checks.push('Six sample scenarios work without changing active mock state; unknown addresses expose no other wallet data.');
  await second.context.close();
  assert.deepEqual(result.external,[]);assert.deepEqual(result.errors,[]);result.passed=true;
} catch(e) {result.failure=String(e.stack||e);process.exitCode=1;}
finally {fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));await browser.close();}
