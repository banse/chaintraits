import { formatEther } from 'viem';
import type { WalletFacts as Facts } from './chain';
import { TRAITS } from './data';
import { Mark, Status } from './components';
import { useSite } from './context';
import { WalletFactsSummary } from './wallet-summary';
import { claimedFactRows } from './claimed-facts.mjs';
import { oracleRequestLink } from './fact-check/request-model.mjs';
import './request-history.css';

/** Presentations reuse Claim's wallet-scoped reads; they never start another reader. */
export function YourSwornCard({ facts }: { facts: Facts }) {
  const { specs } = useSite();
  return <section className="wallet-summary-section" id="your-card" aria-labelledby="your-card-title">
    <WalletFactsSummary facts={facts} specs={specs} headingId="your-card-title"/>
  </section>;
}

export function ClaimedFacts({ facts, specs, connected, error, onRetry, onConnect }: {
  facts: Facts | null; specs: any[]; connected: boolean; error: string;
  onRetry: () => void; onConnect: () => void;
}) {
  const rows = claimedFactRows(facts, TRAITS, specs);
  const groups = [['direct', 'Direct facts'], ['oracle', 'Oracle-verified facts'], ['community', 'Community facts']];
  return <section className="section wallet-facts" id="claimed-facts" aria-labelledby="claimed-facts-title">
    <div className="claimed-facts-heading">
      <h2 id="claimed-facts-title">Claimed Wallet Facts</h2>
      <a href="#/fact-check">Fact Check &amp; History</a>
    </div>
    {!connected ? <><p>Connect your wallet to see its claimed facts.</p><button onClick={onConnect}>Connect wallet</button></>
      : error ? <><Status error>{error}</Status><button onClick={onRetry}>Retry wallet reads</button></>
      : !facts ? <Status>Reading your facts…</Status>
      : !rows.length ? <p>No claimed facts yet. Choose a fact below to verify; a card is optional.</p>
      : groups.map(([group, title]) => {
        const list = rows.filter(row => row.group === group);
        return list.length > 0 && <div className="fact-group" key={group}>
          <h3 className="fact-group-title">{title}</h3>
          <ul className={`fact-history ${group === 'direct' ? 'direct-facts' : 'sworn-facts'}`} aria-label={title}>
            {list.map(row => <li key={row.id} id={`held-${row.id}`}>
              <strong>{row.id} / {row.name}</strong><span className="meaning">{row.meaning}</span>
              {group !== 'direct' && <Mark kind={row.kind}/>}
            </li>)}
          </ul>
        </div>;
      })}
  </section>;
}

export function RecentVerificationRequests({ wallet, rows, error, fromBlock, specs, explorer, onRefresh }: {
  wallet: string; rows?: any[]; error?: string; fromBlock?: string; specs: any[];
  explorer: string; onRefresh: () => void;
}) {
  return <details className="section request-history" id="recent-requests">
    <summary>Recent verification requests</summary>
    <p className="muted">Request receipts confirm payment. The Registry outcome shows whether a fact was stored.</p>
    {error ? <Status error>{error}</Status> : !rows ? <Status>Reading recent requests…</Status>
      : !rows.length ? <p>No requests found in the recent history window.</p>
      : <ul className="request-history-list">{rows.map(row => {
        const name = TRAITS.find(trait => trait.id === row.traitId)?.name || specs.find(spec => spec.id === row.traitId)?.name || `Fact ${row.traitId}`;
        return <li key={row.requestId}>
          <h3>{row.traitId} / {name}</h3><p><strong>{row.status}</strong></p><p>{row.message}</p>
          <p>{row.fee ? `Request fee: ${formatEther(BigInt(row.fee))} IMD, paid.` : 'The exact historic request fee is unavailable in this browser.'}</p>
          <p className="request-id">Request ID: <code>{row.requestId}</code></p>
          <a href={`${explorer}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer">View Ethereum request receipt</a>
          <a className="request-next" href={oracleRequestLink(wallet, { id: row.traitId, requestId: row.requestId, blockNumber: row.blockNumber })}>View in Fact Check</a>
          {row.terminal && row.status !== 'Stored' && <a className="request-next" href={`#/request?trait=${row.traitId}`}>Review and retry verification</a>}
        </li>;
      })}</ul>}
    <button onClick={onRefresh}>Refresh request status</button>
    {fromBlock && <p className="muted">Recent Registry events since block {fromBlock}. Older requests may be outside this window.</p>}
  </details>;
}
