// Browser recovery hints only; actual receipts and Registry reads decide outcomes.
export const journalKey = ({chainId, registry}) =>
  `sworn.mainnet.transaction-journal:${chainId}:${registry.toLowerCase()}`;
export function encodeJournal(binding, journal) {
  return JSON.stringify({version:1,binding:journalKey(binding),journal}, (_,value) =>
    typeof value === 'bigint' ? {bigint:value.toString()} : value);
}
export function restoreJournal(storage, binding) {
  try {
    const store = typeof storage === 'function' ? storage() : storage;
    const envelope=JSON.parse(store.getItem(journalKey(binding)) || 'null',(_,v)=>
      v && typeof v==='object' && Object.keys(v).length===1 && 'bigint' in v ? BigInt(v.bigint) : v);
    if (envelope?.version!==1 || envelope.binding!==journalKey(binding)) return {};
    const saved=envelope.journal;
    if (!saved || !Array.isArray(saved.steps)) return {};
    const kept=saved.steps.some(s=>s.hash || s.intent || s.state==='confirmed');
    if (!kept) return {history:saved.history || []};
    return {...saved,steps:saved.steps.map(s=>({...s,state:
      ['confirmed','cancelled','replaced','failed','rejected'].includes(s.state) ? s.state :
      s.hash || s.intent ? 'unknown' : s.state==='simulated' ? 'simulation expired' :
      ['simulating','awaiting signature'].includes(s.state) ? 'interrupted' : s.state}))};
  } catch { return {}; }
}
