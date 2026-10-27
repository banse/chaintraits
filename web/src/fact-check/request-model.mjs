import { isAddress } from 'viem';
import { shortFactQuestion } from './history-model.mjs';

const requestHash = value => /^0x[0-9a-f]{64}$/i.test(value || '') && !/^0x0+$/i.test(value);
const factNumber = value => /^\d+$/.test(String(value ?? '')) && Number(value) > 0 && Number(value) <= 65535;

export function oracleRequestSelection(query) {
  if (!['request', 'fact', 'block'].some(key => query.has(key))) return null;
  const wallet = query.get('wallet') || '', requestId = query.get('request') || '', id = query.get('fact');
  if (!isAddress(wallet) || !requestHash(requestId) || !factNumber(id))
    throw Error('This oracle request link is incomplete or invalid. Open it from Wallet Facts or your wallet history.');
  const block = query.get('block');
  if (block !== null && !/^\d+$/.test(block)) throw Error('The request block is invalid.');
  return { wallet, requestId, factId: Number(id), blockNumber: block === null ? undefined : BigInt(block) };
}

export function oracleRequestLink(wallet, fact) {
  const query = new URLSearchParams({ wallet, request: fact.requestId, fact: String(fact.id) });
  if (fact.blockNumber !== undefined) query.set('block', String(fact.blockNumber));
  oracleRequestSelection(query);
  return `#/fact-check?${query}`;
}

/** History rows contain the outcome block, not necessarily the request block. */
export function oracleHistoryLink(wallet, row) {
  return `${oracleRequestLink(wallet, { id: row.factId, requestId: row.requestId })}&view=history`;
}

/** Journal state is only a bridge until the Registry observer validates its receipt. */
export function pendingRequestSnapshots(journal, account, traits = [], specs = [], registry = '') {
  const plan = journal?.plan;
  if (!account || !plan?.account || plan.account.toLowerCase() !== account.toLowerCase()) return [];
  return (journal.steps || []).flatMap(step => {
    if (!requestHash(step.hash) || !['upgrade', 'requestSharedFact'].includes(step.call?.functionName)) return [];
    const confirmed = step.state === 'confirmed';
    if (!confirmed && !['pending', 'refreshing'].includes(step.state)) return [];
    const raw = step.call.ids || [step.call.args?.[0]];
    const ids = raw.flat().map(Number).filter(factNumber);
    const facts = confirmed
      ? (step.result?.facts || []).filter(fact => ids.includes(fact.id) && requestHash(fact.requestId))
      : ids.map(id => ({ id, requestId: undefined }));
    return facts.map(fact => {
      const trait = traits.find(trait => trait.id === fact.id), spec = specs.find(spec => Number(spec.id) === fact.id);
      const name = plan.lines?.find(line => line.id === fact.id)?.name || spec?.name || trait?.name || `Fact ${fact.id}`;
      return {
        key: (confirmed && registry ? `1:${registry}:${plan.account}:${fact.requestId}` : `${fact.requestId || step.hash}:${fact.id}`).toLowerCase(), mode: 'live',
        phase: confirmed ? 'admission' : 'tx', wallet: plan.account,
        factId: fact.id, factName: name, evidenceKind: 'oracle',
        question: '', shortQuestion: shortFactQuestion(fact.id, traits, specs) || name,
        panelSize: null, quorum: null, agents: [], quorumReached: false,
        result: null, registryStored: false,
        requestId: fact.requestId, transactionHash: step.replacement || step.hash,
        latestEvent: confirmed ? 'Transaction confirmed · waiting for the oracle job...' : 'Waiting for Ethereum confirmation...',
        events: [{ id: `transaction:${step.hash}`, source: 'Ethereum', title: confirmed ? 'Request transaction confirmed' : 'Request transaction submitted', href: `https://etherscan.io/tx/${step.replacement || step.hash}` }],
      };
    });
  });
}
