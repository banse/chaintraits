import { impossible } from './pure.mjs';
import { sharedMembership } from './shared-safety.mjs';

// A request is permission to ask the oracle, never a claim that a fact is proven.
/** @param {{ wallet?: string, facts: any, id: number, kind?: number, check?: any, shared?: any, readError?: boolean }} input */
export function factMintState({ wallet, facts, id, kind = 1, check, shared, readError = false }) {
  if (!wallet || !facts || facts.address.toLowerCase() !== wallet.toLowerCase())
    return 'wallet-unavailable';
  if (facts.traits.includes(id) || facts.verifiedSpecs.includes(id)) return 'claimed';
  if (facts.pending[id] && !/^0x0+$/.test(facts.pending[id])) return 'pending';
  if (impossible(facts.joined, id)) return 'ineligible';
  if (kind === 3) {
    if (readError) return 'unavailable';
    if (!shared) return 'checking';
    if (shared.pending && !/^0x0+$/.test(shared.pending)) return 'pending';
    const membership = sharedMembership(shared, wallet);
    return membership === 'not-stored' ? 'request'
      : membership === 'included' ? 'apply'
        : membership === 'excluded' ? 'excluded' : 'unavailable';
  }
  if (!check || check.state === 'checking') return 'checking';
  if (check.state === 'not-met') return 'ineligible';
  if (check.state === 'met' || (id === 601 && check.state === 'unknown' && check.reason === 'accepted-work-unchecked'))
    return 'request';
  return 'unavailable';
}
