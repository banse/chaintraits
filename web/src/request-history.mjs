// Registry events are the outcome authority. Pending disappearing proves nothing.
import { registryOutcome } from './request-outcomes.mjs';

export function requestHistory(events, wallet, sharedRequestIds = []) {
  const shared = new Set(sharedRequestIds.map(id => id.toLowerCase()));
  const attempts = new Map();
  for (const event of events) {
    if (event.eventName !== 'TraitRequested') continue;
    const id = event.args.requestId.toLowerCase();
    if (event.args.claimant.toLowerCase() !== wallet.toLowerCase() && !shared.has(id)) continue;
    attempts.set(id, { requestId:event.args.requestId, traitId:Number(event.args.traitId), transactionHash:event.transactionHash,
      blockNumber:String(event.blockNumber), status:'Outcome not yet confirmed', message:'No terminal Registry event has been read yet. Refresh status before submitting another request.', terminal:false });
  }
  for (const event of events) {
    const row = attempts.get(event.args.requestId?.toLowerCase());
    if (!row || row.terminal) continue;
    const message = registryOutcome(event);
    if (!message && event.eventName !== 'SharedFactStored') continue;
    row.terminal = true;
    row.status = event.eventName === 'Verified' || event.eventName === 'SharedFactStored' ? 'Stored'
      : event.eventName === 'NoVerdict' ? 'No verdict'
      : event.eventName === 'Abandoned' ? 'Abandoned'
      : Number(event.args.reason) === 8 ? 'Answer false' : 'Not stored';
    row.message = event.eventName === 'Verified' ? 'The Registry stored this fact for the original wallet. A card is optional.'
      : message || 'The Registry stored the shared result. Apply it to your wallet if eligible.';
  }
  return [...attempts.values()].reverse();
}

const KEY = 'sworn.mainnet.request-fees';
const REQUESTS = 'sworn.mainnet.request-records';
export function feeKey(chainId, registry, account, requestId) {
  return [chainId, registry, account, requestId].join(':').toLowerCase();
}
export function savedRequestFees(storage) {
  return readMap(storage, KEY);
}
function readMap(storage, key) {
  try { const data=JSON.parse(storage.getItem(key) || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
}
export function savedRequests(storage, chainId, registry, account) {
  const prefix=feeKey(chainId, registry, account, '');
  return Object.entries(readMap(storage, REQUESTS)).filter(([key]) => key.startsWith(prefix)).map(([,value]) => value);
}
export function saveRequestFees(storage, detail) {
  if (!detail || !/^\d+$/.test(detail.feePerRequest) || !detail.registry || !detail.account || !Array.isArray(detail.facts)) return;
  const fees = savedRequestFees(storage);
  const records = readMap(storage, REQUESTS);
  for (const fact of detail.facts) {
    const key=feeKey(detail.chainId, detail.registry, detail.account, fact.requestId);
    fees[key] = detail.feePerRequest;
    records[key] = fact;
  }
  storage.setItem(KEY, JSON.stringify(fees));
  storage.setItem(REQUESTS, JSON.stringify(records));
}
export function installRequestHistoryRecorder() {
  // Keep pending browser history in this tab; chain, Registry and wallet bind every record.
  window.addEventListener('sworn-request-confirmed', event => saveRequestFees(sessionStorage, event.detail));
}
