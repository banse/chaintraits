import { DEMO_DATA } from './demo-data.mjs';

export const DEMO_FRAMES = [
  { phase: 'tx', count: 1 },
  { phase: 'admission', count: 3 },
  ...Array.from({ length: 9 }, (_, i) => ({ phase: i === 8 ? 'quorum' : 'panel', count: i === 8 ? 14 : 5 + i })),
  { phase: 'delivery', count: 19 },
  { phase: 'registry', count: 20 },
  { phase: 'saved', count: 23 },
];
const stateMap = { true: 'agree', false: 'disagree', working: 'pending', queued: 'queued', failed: 'failed' };
const shortQuestion = 'Did this wallet complete at least 3 accepted IMD swarm jobs while holding an IDMD seat?';

/** Exact fixture snapshots from the approved design; never used as live fallback.
 * @param {string} phase @param {string} run @param {string} base
 * @param {{count?:number,responses?:string[]}} [override]
 * @returns {import('../../../src/fact-check/types').FactCheckSnapshot}
 */
export function demoSnapshot(phase, run, base, override = {}) {
  const stage = DEMO_DATA.stages[phase] || DEMO_DATA.stages.tx;
  const responses = override.responses || stage.responses;
  const count = override.count ?? stage.eventCount;
  const saved = phase === 'saved';
  const events = DEMO_DATA.events.slice(0, count).map(({ id, time, source, title, detail }) => ({ id, time, source, title, detail }));
  if (phase === 'failed') events.push({ id: 'no-quorum', time: '14:35:21', source: 'Swarm', title: 'Attempt ended without quorum', detail: 'Neither answer reached seven matching responses. No fact was added.' });
  return {
    key: `demo:${run}`, mode: 'demo', phase,
    wallet: DEMO_DATA.wallet, ensName: DEMO_DATA.walletEnsName,
    factId: 601, factName: 'Swarmed',
    question: phase === 'tx' ? DEMO_DATA.preview : DEMO_DATA.question,
    shortQuestion, panelSize: 11, quorum: 7,
    answerKind: 'boolean',
    agents: responses.map((answer, index) => ({ key: `fixture-${DEMO_DATA.identityTokenIds[index]}`, tokenId: DEMO_DATA.identityTokenIds[index], state: stateMap[answer] || 'unknown', answer: answer === 'true' ? 'TRUE' : answer === 'false' ? 'FALSE' : undefined, detail: answer === 'false' ? 'A valid differing answer. It is not an agent error.' : answer === 'failed' ? 'No valid answer was supplied by this member.' : 'Illustrative participation from the approved static sequence.' })),
    quorumReached: responses.filter(answer => answer === 'true').length >= 7,
    registryStored: saved, result: saved ? true : null,
    cardImage: saved ? `${base}fact-check/after.svg` : undefined,
    evidenceWindow: phase === 'tx' ? 'Final window set at confirmation' : 'Through block 26,267,872',
    definitions: 'Example rule: Swarmed / 601. The wallet must have operated an IdentityMD seat through at least 3 accepted Identity.md swarm jobs while it held the seat. The closing block is fixed by the request transaction. All events, wallet ownership, agent participation, outcomes and artwork in this demonstration are scripted fixtures, not evidence of eligibility.',
    latestEvent: phase === 'offline' || phase === 'failed' ? stage.description : events.at(-1)?.title || stage.description,
    events,
    notice: phase === 'offline' ? 'Connection interrupted · showing the last observed fixture state. A failed read does not mean a failed request.' : 'Local demo · scripted wallet, agent activity, transactions and results. No wallet signing, Ethereum transactions or oracle execution occurs on this page.',
  };
}

/** @param {number} index @param {string} run @param {string} base */
export function demoFrame(index, run, base) {
  const frame = DEMO_FRAMES[Math.max(0, Math.min(index, DEMO_FRAMES.length - 1))];
  const responses = frame.count < 4 ? [] : Array.from({ length: 11 }, (_, i) => i < 9 ? 'working' : 'queued');
  DEMO_DATA.events.slice(0, frame.count).forEach(event => {
    if (/^a\d+$/.test(event.id)) responses[Number(event.id.slice(1)) - 1] = event.id === 'a3' ? 'false' : event.id === 'a11' ? 'failed' : 'true';
  });
  return demoSnapshot(frame.phase, run, base, { count: frame.count, responses });
}
