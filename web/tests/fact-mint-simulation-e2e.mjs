// Current production UI + local Anvil contracts + delayed simulated oracle panel.
// Start web/simulation/server.mjs first. No public RPC or wallet is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createPublicClient, http } from 'viem';

const base = process.env.SWORN_SIM_URL || 'http://127.0.0.1:8812/';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'Only loopback simulators are allowed');
const output = new URL(`../../../reports/sworn-fact-check-simulation-2026-10-26/${process.env.SWORN_SIM_OUTPUT || 'e2e-ui-retest'}/`, import.meta.url);
fs.mkdirSync(output, { recursive: true });
const registry = '0x0da2679000ea5380d1361cc3cca7d4e8c881f766';
const abiResponse = await fetch(base + 'abi/Registry.json', { signal: AbortSignal.timeout(10000) });
assert.equal(abiResponse.status, 200, 'Read ABI from the selected isolated instance');
const abi = await abiResponse.json();
const client = createPublicClient({ transport: http(base + '__mock__/rpc') });
const read = (functionName, args) => client.readContract({ address: registry, abi, functionName, args });
const walletA = '0xa11ce000000000000000000000000000000ac1a1';
const walletB = '0xb0b00000000000000000000000000000000bc1a1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { startedAt: new Date().toISOString(), base, fidelity: 'Real local Sworn runtime; simulated dependencies, wallets and oracle answers. Not mainnet proof.', scenarios: [] };
let page, context, current;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function control(body) {
  const response = await fetch(base + '__mock__/state', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  assert.equal(response.status, 200);
  return response.json();
}
async function until(fn, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(300);
  }
  throw Error('Timed out: ' + label);
}
async function visibleText(selector = 'body') {
  return page.locator(selector).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => n.innerText).join('\n'));
}
async function stage(pattern, name, timeout) {
  await until(async () => pattern.test(await visibleText('.fc-progress-current')), name, timeout);
  current.stages.push({ name, at: new Date().toISOString() });
}
async function screenshot(name) {
  if (name === 'agents') await until(() => page.locator('.fact-check-history .fc-card-panel').first().evaluate(panel => {
    const agents = panel.querySelector('.fc-agent-layer.fc-layer-active');
    return agents && Number(getComputedStyle(agents).opacity) === 1
      && [...panel.querySelectorAll('.fc-waiting')].every(node => Number(getComputedStyle(node).opacity) === 0);
  }), 'agent crossfade settled');
  const file = `${current.name}-${name}.png`;
  await page.screenshot({ path: new URL(file, output).pathname, fullPage: true });
  current.screenshots.push(file);
}
async function noSuccess() {
  assert.doesNotMatch(await visibleText('.fc-card-panel'), /FACT SAVED/);
  assert.doesNotMatch(await visibleText('.fc-answer'), /^YES$/m);
  assert.equal(await read('hasTrait', [current.wallet, 1301]), false);
}
async function inspectAgents() {
  current.workingAgents = await page.locator('.fact-check-history .fc-agent-layer.fc-layer-active').first().evaluate(node => ({
    ids: [...node.querySelectorAll('.fc-agent')].map(agent => agent.getAttribute('data-identity-token-id')),
    pending: [...node.querySelectorAll('.fc-agent-pending,.fc-agent-queued')].map(agent => ({
      id: agent.getAttribute('data-identity-token-id'), number: agent.querySelector('.fc-agent-number')?.textContent,
      status: agent.querySelector('.fc-agent-answer')?.textContent,
    })),
  }));
}
async function inspectCompletedAgents() {
  const panel = page.locator('.fact-check-history .fc-card-panel').first();
  await until(() => panel.locator('.fc-agent-layer.fc-layer-active').evaluate(node => Number(getComputedStyle(node).opacity) === 1), 'completed agent hive visible');
  const agents = await panel.locator('.fc-agent').evaluateAll(nodes => nodes.map(node => ({
    id: node.getAttribute('data-identity-token-id'),
    answer: node.querySelector('.fc-agent-answer')?.textContent,
  })));
  assert.deepEqual(agents.map(agent => agent.id).sort(), [...current.workingAgents.ids].sort(), 'Completed hive retains the request agents');
  const record = (await control()).records.find(record => record.requestId === current.requestId);
  assert.equal(agents.filter(agent => /^(true|false)$/i.test(agent.answer)).length, record.members, 'Only reported answers appear as results');
  assert.ok(agents.every(agent => /^(true|false|UNKNOWN)$/i.test(agent.answer)), 'Unanswered agents remain visibly unknown');
  assert.equal(await panel.locator('.fc-returned-art,.fc-no-art,.fc-waiting').count(), 0, 'No wallet artwork or waiting overlay replaces the completed agents');
  current.completedAgents = agents;
}
async function inspectCardlessLayout() {
  current.layouts = [];
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const popup of [false, true]) {
      if (popup) await page.getByRole('button', { name: 'Open progress dialog', exact: true }).click();
      const panel = page.locator(popup ? 'dialog[open] .fc-card-panel' : '.fact-check-history .fc-card-panel').first();
      const layout = await panel.evaluate(node => {
        const art = node.querySelector('.fc-artwork'), frame = node.querySelector('.fc-outer-frame');
        const rect = value => { const r = value.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
        return { art: rect(art), frame: rect(frame), agents: node.querySelectorAll('.fc-agent-layer.fc-layer-active .fc-agent').length,
          waitingOverlay: !!node.querySelector('.fc-waiting,.fc-returned-art,.fc-no-art'),
          clippedText: [...node.querySelectorAll('.fc-short-question,.fc-wallet,.fc-fact-name')].some(text => text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1),
          overflow: document.documentElement.scrollWidth > innerWidth,
          overlayControls: ['fixed', 'absolute'].includes(getComputedStyle(document.querySelector('#sworn-mock-panel')).position),
          context: rect(node.querySelector('.fc-context')) };
      });
      current.layouts.push({ width, popup, ...layout });
      const file = `${current.name}-${popup ? 'dialog' : 'page'}-${width}.png`;
      await panel.screenshot({ path: new URL(file, output).pathname });
      current.screenshots.push(file);
      if (popup) await page.getByRole('button', { name: 'Close progress dialog', exact: true }).click();
    }
  }
  await page.setViewportSize({ width:1440, height:1000 });
}
async function setup(name, wallet, settings) {
  await context?.close();
  current = { name, wallet, stages: [], screenshots: [], external: [], pageErrors: [], checks: [] };
  report.scenarios.push(current);
  const initial = await control();
  assert.equal(initial.simulation, true, 'Refuse to reset a non-simulator endpoint');
  assert.equal(initial.ready, true, 'The selected simulator must be ready');
  const configured = await control({ reset: true, active: wallet, nextAnswer: 'true', exactIntake: true, ...settings });
  current.settings = configured.settings;
  current.walletHashes = [];
  current.rpcTimings = [];
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    current.external.push(url.href);
    return route.abort('blockedbyclient');
  });
  page = await context.newPage();
  const startedRequests = new WeakMap();
  page.on('request', request => {
    if (request.url() !== base + '__mock__/rpc') return;
    const payload = request.postDataJSON();
    const calls = Array.isArray(payload) ? payload : [payload];
    if (calls.some(call => call.method === 'eth_estimateGas'))
      startedRequests.set(request, Date.now());
  });
  page.on('response', response => {
    const started = startedRequests.get(response.request());
    if (started) current.rpcTimings.push({ method: 'eth_estimateGas', milliseconds: Date.now() - started });
  });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => current.pageErrors.push(error.message));
  await page.goto(base + '#/request');
  await page.locator('#sworn-mock-panel').waitFor();
  if (name === 'cardless') {
    const openControls = page.getByRole('button', { name: 'Open mock controls', exact: true });
    if (await openControls.isVisible()) await openControls.click();
    const delays = page.locator('#sworn-mock-panel details');
    await delays.locator('summary').click();
    await delay(1800);
    assert.equal(await delays.getAttribute('open'), '', 'Delay controls remain expanded across status refresh');
    for (const field of ['walletSeconds', 'approvalSeconds', 'preflightSeconds', 'artworkSeconds'])
      assert.equal(await delays.locator(`[data-delay="${field}"]`).isVisible(), true, field + ' is editable');
  }
  const hideControls = page.getByRole('button', { name: 'Hide mock controls' });
  if (await hideControls.isVisible()) await hideControls.click();
  await page.getByText(/Ethereum mainnet · block .*current oracle quote/).waitFor();
  await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
  await page.getByRole('button', { name: /Mock wallet/ }).first().click();
  await page.getByRole('button', { name: /Disconnect/ }).waitFor();
  await page.locator('#pick-1301').waitFor();
  current.before = { token: String(await read('tokenOf', [wallet])), traits: (await read('traitsOf', [wallet])).map(Number) };
  assert.equal(await read('hasTrait', [wallet, 1301]), false);
}
async function walletStep(button, name) {
  const requestPending = page.waitForRequest(base + '__mock__/wallet');
  const responsePending = page.waitForResponse(base + '__mock__/wallet');
  await button.click();
  await requestPending;
  const started = Date.now();
  if (current.settings.walletSeconds > 0) {
    await delay(Math.min(current.settings.walletSeconds * 500, 750));
    assert.match(page.url(), /#\/request$/, 'No navigation before the mock wallet returns a transaction hash');
    assert.equal(await page.locator('.payment-dialog[open]').count(), 1);
    assert.equal(await button.isDisabled(), true, 'An outstanding wallet request cannot be submitted twice');
    current.stages.push({ name: name + '-wallet-pending', at: new Date().toISOString() });
  }
  const response = await responsePending;
  const body = await response.json();
  assert.match(body.result || '', /^0x[0-9a-f]{64}$/i, name + ' returns a real local transaction hash');
  current.walletHashes.push(body.result);
  current.stages.push({ name: name + '-hash-returned', at: new Date().toISOString(), walletWaitMs: Date.now() - started });
  return body.result;
}
async function requestFact() {
  await page.getByRole('button', { name: 'Mint Fact: 1301 / Pretrained', exact: true }).click();
  assert.equal(await page.locator('.payment-dialog .fact-check-view').count(), 0, 'Payment popup has no embedded fact-check flow');
  await page.locator('dialog[open] #payment-ack').check();
  const anyway = page.getByRole('button', { name: 'Request anyway', exact: true });
  await until(async () => {
    if (await anyway.isVisible() && await anyway.isEnabled()) await anyway.click();
    const button = page.locator('dialog[open] .step-actions button.primary');
    return await button.count() && await button.isEnabled();
  }, 'payment preflight');
  const approve = page.locator('dialog[open] .step-actions button.primary');
  assert.match(await approve.innerText(), /Approve IMD/);
  const approvalHash = await walletStep(approve, 'approval');
  assert.equal(await client.request({ method: 'eth_getTransactionReceipt', params: [approvalHash] }), null, 'Approval receipt remains absent during its mining delay');
  await until(async () => {
    const button = page.locator('dialog[open] .step-actions button.primary');
    return await button.count() && /Request/.test(await button.innerText()) && await button.isEnabled();
  }, 'approval receipt and request preflight');
  current.stages.push({ name: 'approval-confirmed', at: new Date().toISOString() });
  assert.match(page.url(), /#\/request$/, 'Approval keeps the payment flow on Mint Facts');
  await walletStep(page.locator('dialog[open] .step-actions button.primary'), 'request');
  await page.waitForURL(/#\/fact-check\?wallet=/);
  assert.equal(await page.locator('.payment-dialog[open]').count(), 0, 'Fact submission closes the payment popup immediately');
  await stage(/Waiting for Ethereum confirmation/, 'transaction');
  assert.equal((await control()).records.filter(record => record.factId === 1301).length, 0, 'Navigation happened before the request receipt');
  await noSuccess();
  const record = await until(async () => (await control()).records.find(record => record.factId === 1301 && record.wallet.toLowerCase() === current.wallet), 'confirmed request origin');
  current.requestId = record.requestId;
  current.block = record.requestBlock;
  current.url = page.url();
  assert.match(current.requestId, /^0x[0-9a-f]{64}$/i);
  await stage(/Waiting for the oracle job/, 'admission');
  await noSuccess();
}
async function pendingDelivery() {
  const record = await until(async () => {
    const found = (await control()).records.find(r => r.requestId === current.requestId);
    return found?.deliveryTx && !found.deliveryReceipt && found;
  }, 'delivery transaction pending before Registry callback');
  assert.equal(await client.request({ method: 'eth_getTransactionReceipt', params: [record.deliveryTx] }), null);
  await noSuccess();
  current.stages.push({ name: 'registry-transaction-pending', at: new Date().toISOString(), hash: record.deliveryTx });
}
async function oracleStages() {
  await stage(/Agents are checking/, 'agents');
  await inspectAgents();
  await screenshot('agents');
  await stage(/Agreement reached/, 'quorum');
  await noSuccess();
  await stage(/Waiting for Registry delivery/, 'delivery');
  await noSuccess();
  await pendingDelivery();
}
async function validateTerminal(name) {
  const fromBlock = BigInt(current.block);
  const log = await until(async () => {
    const logs = await client.getContractEvents({ address: registry, abi, eventName: name, fromBlock, toBlock: 'latest' });
    return logs.find(log => log.args.requestId?.toLowerCase() === current.requestId.toLowerCase());
  }, 'actual Registry ' + name + ' event');
  assert.ok(log, 'actual Registry ' + name + ' event');
  const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
  assert.equal(receipt.status, 'success');
  current.receipt = { event: name, transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber), status: receipt.status };
  assert.match(String(await read('pendingOf', [current.wallet, 1301])), /^0x0+$/);
}
async function finish() {
  current.state = await control();
  current.measuredDelays = [];
  const measured = (name, actual, seconds, tolerance = 200) => {
    assert.ok(Number.isFinite(actual), name + ' has measured timestamps');
    assert.ok(actual >= seconds * 1000 - tolerance, `${name}: ${actual}ms is shorter than configured ${seconds}s`);
    current.measuredDelays.push({ name, configuredSeconds: seconds, actualMilliseconds: actual });
  };
  for (const hash of current.walletHashes) {
    const tx = current.state.transactions?.find(t => t.hash?.toLowerCase() === hash.toLowerCase());
    assert.ok(tx, 'Local wallet transaction timing is retained');
    measured(tx.kind + '-wallet', tx.submittedAt - tx.requestedAt, tx.config.walletSeconds);
    measured(tx.kind + '-mining', tx.confirmedAt - tx.submittedAt,
      tx.kind === 'approval' ? tx.config.approvalSeconds ?? tx.config.transactionSeconds : tx.config.transactionSeconds);
  }
  assert.ok(current.rpcTimings.length > 0, 'Preflight gas estimation was observed');
  for (const call of current.rpcTimings) measured('preflight', call.milliseconds, current.settings.preflightSeconds);
  const record = current.state.records.find(r => r.requestId === current.requestId);
  assert.ok(record, 'Completed request retains its timing evidence');
  const t = record.timeline, c = record.config;
  measured('admission', t.admission - t.requested, c.pickup);
  measured('first-answer', t.firstAnswer - t.admission, c.firstAnswerSeconds / c.speed);
  measured('answer-intervals', t.lastAnswer - t.firstAnswer,
    (record.members - 1) * c.answerEverySeconds / c.speed, 600);
  if (t.attested) {
    measured('attestation', t.attested - t.quorum, c.attestAfterSeconds);
    if (c.delivery !== 'hold') measured('delivery-submission', t.deliverySubmitted - t.attested, c.deliverAfterSeconds);
    measured('registry-mining', t.registryReceipt - t.deliverySubmitted, c.registrySeconds);
  } else if (t.noVerdict) {
    measured('no-verdict-delivery', t.deliverySubmitted - t.noVerdict, c.deliverAfterSeconds);
    measured('no-verdict-registry-mining', t.registryReceipt - t.deliverySubmitted, c.registrySeconds);
  }
  if (t.recovered) measured('recovery-mining', t.recovered - t.recoverySubmitted, c.registrySeconds);
  assert.deepEqual(current.external, [], 'No browser request left the simulator');
  assert.deepEqual(current.pageErrors, [], 'No uncaught browser error');
  current.passed = true;
  console.log('PASS ' + current.name);
  fs.writeFileSync(new URL('report.json', output), JSON.stringify(report, null, 2));
}

// Controls are seconds; answer pacing deliberately spans several production 5s polls.
const useProfileTiming = process.env.SWORN_SIM_PROFILE_TIMING === '1';
const timing = useProfileTiming ? { ...(await control()).settings, delivery: 'hold' }
  : { walletSeconds: 1.5, approvalSeconds: 2, preflightSeconds: .3, artworkSeconds: 1,
    transactionSeconds: 4, pickup: 12, firstAnswerSeconds: 8, answerEverySeconds: 1.5, speed: 1,
    attestAfterSeconds: 10, deliverAfterSeconds: 5, registrySeconds: 3, delivery: 'hold' };
const selected = new Set((process.env.SWORN_SIM_CASES || 'cardless,card,false,no-quorum,failed-delivery').split(','));
try {
  if (selected.has('cardless')) {
    await setup('cardless', walletB, timing);
    assert.equal(current.before.token, '0');
    await requestFact();
    const sends = (await control()).walletRequests;
    await page.reload();
    await stage(/Waiting for the oracle job|Agents are checking/, 'resumed-after-admission-reload');
    await stage(/Agents are checking/, 'agents');
    await inspectAgents();
    await screenshot('agents');
    await stage(/Agreement reached/, 'quorum');
    await noSuccess();
    await stage(/Waiting for Registry delivery/, 'delivery');
    await noSuccess();
    await screenshot('delivery-held');
    await page.reload();
    await stage(/Waiting for Registry delivery/, 'resumed-after-delivery-reload');
    assert.equal((await control()).walletRequests, sends, 'Reload does not pay again');
    const record = (await control()).records.find(r => r.requestId === current.requestId);
    assert.ok(record);
    // A suspended tab can miss a callback by more than the old 600-block window.
    const blockedLogs = async route => {
      const payload = route.request().postDataJSON();
      const requests = Array.isArray(payload) ? payload : [payload];
      if (!requests.some(request => request.method === 'eth_getLogs')) return route.fallback();
      const errors = requests.map(request => ({ jsonrpc: '2.0', id: request.id,
        error: { code: -32000, message: 'Simulated temporary log-read outage' } }));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(payload) ? errors : errors[0]) });
    };
    await page.route('**/__mock__/rpc', blockedLogs);
    const release = control({ releaseDelivery: record.oracleId });
    await pendingDelivery();
    await release;
    await validateTerminal('Verified');
    await control({ advanceBlocks: 650 });
    await page.unroute('**/__mock__/rpc', blockedLogs);
    await stage(/Registry fact confirmed/, 'saved');
    await validateTerminal('Verified');
    assert.equal(await read('hasTrait', [walletB, 1301]), true);
    assert.equal(await read('tokenOf', [walletB]), 0n, 'Fact verification does not mint a card');
    await inspectCompletedAgents();
    await until(async () => /Fact 1301/.test(await visibleText('#fact-history')), 'Fact History update');
    await screenshot('saved');
    await inspectCardlessLayout();
    await page.goto(base + '#/request');
    await page.locator('#held-1301').waitFor();
    assert.match(await page.locator('#held-1301').innerText(), /nonce|20|Pretrained/i);
    await page.getByRole('button', { name: 'Review transaction steps', exact: true }).click();
    await page.locator('.payment-dialog[open]').waitFor();
    assert.equal(await page.locator('.payment-dialog .fact-check-view').count(), 0, 'Receipt review never embeds the fact-check flow');
    assert.match(page.url(), /#\/request$/, 'Reviewing a receipt does not redirect again');
    await page.getByRole('button', { name: 'Close payment dialog', exact: true }).click();
    assert.equal(current.workingAgents.ids.length, 11, 'All assigned simulated agents are visible while working');
    assert.equal(new Set(current.workingAgents.ids).size, 11);
    assert.ok(current.workingAgents.pending.length > 0, 'Unanswered agents have visible working states');
    for (const agent of current.workingAgents.pending) {
      assert.match(agent.id || '', /^\d+$/);
      assert.equal(agent.number, agent.id);
      assert.match(agent.status, /PENDING|QUEUED/);
    }
    for (const layout of current.layouts) {
      assert.equal(layout.agents, 11, `All result agents remain visible (${layout.width}, popup=${layout.popup})`);
      assert.equal(layout.waitingOverlay, false, 'No waiting overlay or wallet artwork hides the jury');
      assert.equal(layout.clippedText, false, 'Cardless result text is not clipped');
      assert.equal(layout.overflow, false, 'No viewport overflow');
      assert.equal(layout.overlayControls, false, 'Simulation controls do not float over the content');
      assert.ok(layout.frame.y >= layout.art.y - 1 && layout.frame.bottom <= layout.art.bottom + 1, 'The jury frame stays within its allocated layout area');
    }
    current.checks.push('Approval, delayed confirmation/admission/agents/signature/delivery, two reloads, 650-block log-read outage catch-up without reload, actual Verified, cardless completion, Fact History, Claimed Facts');
    await finish();
  }
  for (const name of ['card', 'false', 'no-quorum', 'failed-delivery']) {
    if (!selected.has(name)) continue;
    const wallet = walletA;
    await setup(name, wallet, { ...timing, pickup: useProfileTiming ? timing.pickup : 8, nextAnswer: name === 'false' ? 'false' : name === 'no-quorum' ? 'split' : 'true', delivery: name === 'failed-delivery' ? 'starved' : 'normal' });
    assert.notEqual(current.before.token, '0');
    const beforeURI = await read('tokenURI', [BigInt(current.before.token)]);
    await requestFact();
    if (name !== 'no-quorum') await oracleStages();
    if (name === 'no-quorum') {
      await stage(/Attempt ended without/, 'no-verdict');
      await validateTerminal('NoVerdict');
      await noSuccess();
    } else if (name === 'false') {
      await stage(/Negative result confirmed/, 'negative');
      await validateTerminal('Missed');
      await noSuccess();
      await page.getByLabel('Confirmed false', { exact: true }).first().waitFor();
    } else if (name === 'failed-delivery') {
      await stage(/Waiting for Registry delivery/, 'delivery');
      await until(async () => {
        const state = await control();
        return state.records?.find(record => record.requestId === current.requestId)?.deliveryReceipt;
      }, 'failed callback attempt');
      await delay(7000);
      await noSuccess();
      assert.doesNotMatch(String(await read('pendingOf', [wallet, 1301])), /^0x0+$/);
      current.checks.push('A mined Intake completion with failed callback never claims Registry success');
      const record = (await control()).records.find(r => r.requestId === current.requestId);
      assert.equal(record.delivered, false);
      assert.equal(record.deliveryReceipt.status, '0x1');
      await screenshot('callback-failed');
      const sends = (await control()).walletRequests;
      await control({ recoverDelivery: record.oracleId });
      await stage(/Registry fact confirmed/, 'recovered');
      await validateTerminal('Verified');
      assert.equal(await read('hasTrait', [wallet, 1301]), true);
      assert.equal((await control()).walletRequests, sends, 'Recovery does not make a second user payment');
      current.checks.push('Permissionless local Registry.settle verifies the signed result and completes without another request');
    } else {
      await stage(/Registry fact confirmed/, 'saved');
      await validateTerminal('Verified');
      assert.equal(await read('hasTrait', [wallet, 1301]), true);
      assert.notEqual(await read('tokenURI', [BigInt(current.before.token)]), beforeURI);
      await page.getByLabel('Confirmed true', { exact: true }).first().waitFor();
      assert.match(await visibleText('.fc-card-panel'), /SWORN BY SWARM[\s\S]*FACT SAVED/);
    }
    if (name !== 'card') {
      const after = (await read('traitsOf', [wallet])).map(Number);
      for (const fact of current.before.traits) assert.ok(after.includes(fact), 'Existing fact survives unsuccessful request');
    }
    if (name !== 'no-quorum') await inspectCompletedAgents();
    await screenshot('result');
    await finish();
  }
} catch (error) {
  if (current) {
    current.error = error.stack;
    current.bodyAtFailure = await visibleText().catch(() => 'unavailable');
    current.state = await control().catch(() => null);
    await screenshot('failure').catch(() => {});
  }
  process.exitCode = 1;
  console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(new URL('report.json', output), JSON.stringify(report, null, 2));
  await browser.close();
}
