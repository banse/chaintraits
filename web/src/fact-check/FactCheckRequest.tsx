import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useSite } from '../context';
import { contract } from '../chain';
import { TRAITS } from '../data';
import { routeInfo } from '../task-navigation.mjs';
import { SwarmFeed, useSharedSwarmProgress, type WatchedFact } from '../swarm';
import { useTransactions } from '../controllers/transactions';
import { FactCheckView } from './FactCheckView';
import { oracleRequestLink, oracleRequestSelection, pendingRequestSnapshots } from './request-model.mjs';
import type { FactCheckSnapshot } from './types';

/** Query parameters select public evidence; the observer validates it against Registry logs. */
export function FactCheckRequest({ wallet, latestFact, onAttested }: { wallet: string; latestFact?: WatchedFact; onAttested: () => void }) {
  const site = useSite();
  const { address } = useAccount();
  const journal = useTransactions();
  const shared = useSharedSwarmProgress();
  const selection = useMemo(() => {
    try { return { request: oracleRequestSelection(routeInfo().query), history: routeInfo().query.get('view') === 'history', error: '' }; }
    catch (error) { return { request: null, error: error instanceof Error ? error.message : 'Invalid oracle request link.' }; }
  }, []);
  const complete = () => { site.refresh(); onAttested(); };
  if (selection.error) return <section><p role="alert">{selection.error}</p><a href="#/request">Mint Facts ↗</a></section>;
  if (selection.request) {
    const { wallet, requestId, factId, blockNumber } = selection.request;
    const name = site.specs.find(spec => Number(spec.id) === factId)?.name || TRAITS.find(trait => trait.id === factId)?.name || `Fact ${factId}`;
    return <SwarmFeed key={requestId} fact={{ id: factId, name, requestId, blockNumber }} wallet={wallet} focus={null} onAttested={complete} idPrefix="oracle" variant={selection.history ? 'history' : 'progress'}/>;
  }
  if (!wallet) return null;
  const ownWallet = wallet.toLowerCase() === address?.toLowerCase();
  const bridges = ownWallet ? pendingRequestSnapshots(journal, address, TRAITS, site.specs, contract(site.r, 'Registry').address) as FactCheckSnapshot[] : [];
  const pending = bridges.filter(snapshot => snapshot.phase === 'tx');
  const confirmed = bridges.filter(snapshot => snapshot.requestId).at(-1);
  const facts = ownWallet ? shared?.facts || [] : [];
  const current = confirmed
    ? facts.find(fact => fact.requestId === confirmed.requestId) || { id: confirmed.factId, name: confirmed.factName, requestId: confirmed.requestId! }
    : facts[0] || latestFact;
  const historical = !confirmed && !facts.length && !!latestFact;
  if (!pending.length && !current) return null;
  return <section>
    {pending.map(snapshot => <FactCheckView key={snapshot.key} snapshot={snapshot}/>)}
    {!pending.length && current && <SwarmFeed key={current.requestId} fact={current} wallet={wallet} focus={null} onAttested={complete} idPrefix="oracle" variant={historical ? 'history' : 'progress'} fallback={confirmed && <FactCheckView snapshot={confirmed}/>}/>}
    {facts.some(fact => fact.requestId !== current?.requestId) && <details><summary>Other verification requests</summary><ul>{facts.filter(fact => fact.requestId !== current?.requestId).map(fact => <li key={fact.requestId}><a href={oracleRequestLink(wallet, fact)}>{fact.name} · {fact.id}</a></li>)}</ul></details>}
  </section>;
}
