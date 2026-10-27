import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useWalletSheet } from "../wallet";
import { AddressForm } from "../components";
import { getAddress, isAddress } from "viem";
import { normalize } from "viem/ens";
import { useSite } from "../context";
import { scopedClient } from "../chain";
import { routeInfo } from "../task-navigation.mjs";
import { TRAITS } from "../data";
import { useFactHistory } from "./history-controller";
import { shortFactQuestion } from "./history-model.mjs";
import { oracleHistoryLink } from "./request-model.mjs";
import { FactCheckRequest } from "./FactCheckRequest";
import "./fact-check.css";

export function FactCheckLive() {
  const { client, specs } = useSite();
  const { address } = useAccount();
  const { open: openWallet } = useWalletSheet();
  // Public wallet links still work; the normal page follows the header wallet.
  const linkedWallet = useRef(routeInfo().query.get("wallet") || "");
  const target = linkedWallet.current || address || "";
  const [resolved, setResolved] = useState({
    target: "",
    wallet: "",
    error: "",
  });
  const wallet = isAddress(target)
    ? getAddress(target)
    : resolved.target === target
      ? resolved.wallet
      : "";
  const walletError = resolved.target === target ? resolved.error : "";
  const history = useFactHistory(wallet);
  const latest = history.rows[0];
  const latestOracle = history.rows.find(row => row.kind === "verified" && row.requestId);

  useEffect(() => {
    if (!target || isAddress(target)) return;
    const control = new AbortController();
    const signal = AbortSignal.any([
      control.signal,
      AbortSignal.timeout(15000),
    ]);
    const c = scopedClient(client, signal);
    void (async () => {
      try {
        const found = await c.getEnsAddress({ name: normalize(target) });
        if (!found) throw Error("This ENS name has no Ethereum address.");
        if (!control.signal.aborted)
          setResolved({
            target,
            wallet: getAddress(found),
            error: "",
          });
      } catch (error) {
        if (!control.signal.aborted)
          setResolved({
            target,
            wallet: "",
            error:
              error instanceof Error && error.message === "This ENS name has no Ethereum address."
                ? error.message
                : "This wallet name could not be resolved. Enter its Ethereum address below.",
          });
      }
    })();
    return () => control.abort();
  }, [target, client]);

  const empty =
    !latest && !history.loading && !history.error && history.coverage.complete;
  return (
    <div className="fact-check-history">
      <h1>Fact Check</h1>
      <p className="prose">Follow verification requests and review facts saved in the Registry.</p>
      {wallet && <p className="fc-history-wallet">Wallet <code>{wallet}</code></p>}
      <div className="inline-links"><a href={`#${routeInfo().route}${routeInfo().query.size ? `?${routeInfo().query}` : ''}#fact-history`}>Fact History ↓</a><a href="#/request">Wallet Facts</a></div>
      <FactCheckRequest
        wallet={wallet}
        latestFact={latestOracle?.requestId ? {
          id: latestOracle.factId,
          name: specs.find(spec => Number(spec.id) === latestOracle.factId)?.name || latestOracle.factName,
          requestId: latestOracle.requestId,
        } : undefined}
        onAttested={history.refresh}
      />
      <section className="fc-history-section" id="fact-history" aria-label="Fact History">
      {walletError && <>
        <p role="alert">{walletError}</p>
        <AddressForm label="Wallet address" submitLabel="View Fact Check"
          onSubmit={value => { location.hash = `/fact-check?wallet=${value}`; }}/>
      </>}
      {!target && (
        <section className="fc-history-empty">
          <h2>Fact History</h2>
          <p>
            Connect your wallet to see its verification requests and minted facts.
            A card is optional.
          </p>
          <button type="button" className="primary" onClick={openWallet}>Connect wallet</button>
          <MintLinks />
        </section>
      )}
      {target && !wallet && !walletError && (
        <p role="status">Looking up your wallet…</p>
      )}
      {wallet && (
        <>
          {!latest && !history.error && !history.coverage.complete && (
            <p role="status">Loading your fact history…</p>
          )}
          {empty && (
            <section className="fc-history-empty">
              <h2>Fact History</h2>
              <p>
                Mint a card or fact first. Your successful mints will appear
                here.
              </p>
              <MintLinks />
            </section>
          )}
          {latest && (
            <section
              className="fc-history-list"
              aria-labelledby="fc-history-list-title"
            >
              <div className="fc-history-list-heading">
                <h2 id="fc-history-list-title">Fact History</h2>
                <button
                  type="button"
                  onClick={history.refresh}
                  disabled={history.loading}
                >
                  {history.loading ? "Refreshing…" : "Refresh history"}
                </button>
              </div>
              <ol>
                {history.rows.map((row) => (
                  <li key={row.key} className="fc-history-item">
                    <span className="fc-history-check" aria-label="Minted">
                      ✓
                    </span>
                    <div>
                      <strong>
                        {specs.find((spec) => Number(spec.id) === row.factId)
                          ?.name || row.factName}
                      </strong>
                      {row.kind === "verified" && (
                        <span className="fc-history-fact-id">
                          {" "}
                          · Fact {row.factId}
                        </span>
                      )}
                      {row.kind === "verified" && (
                        <p className="fc-history-question">
                          {shortFactQuestion(row.factId, TRAITS, specs) ||
                            "Question unavailable. The saved fact is still listed."}
                        </p>
                      )}
                      {row.directFacts?.map((fact) => (
                        <p key={fact.id} className="fc-history-question">
                          {shortFactQuestion(fact.id, TRAITS)}
                          <span className="fc-history-fact-id">
                            {" "}
                            · {fact.name} ({fact.id})
                          </span>
                        </p>
                      ))}
                      <p>
                        {row.kind === "direct"
                          ? "Direct facts frozen when the card was minted"
                          : "Fact recorded in the Registry"}{" "}
                        · Block {row.blockNumber.toLocaleString("en-US")}
                      </p>
                      {row.kind === "verified" && row.requestId && <a className="fc-history-request" href={oracleHistoryLink(wallet, row)}>View agents and results</a>}
                    </div>
                    <a
                      href={`https://etherscan.io/tx/${row.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View transaction for ${row.factName}`}
                    >
                      Transaction ↗
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {latest && (
            <p className="fc-history-status">
              {history.error
                ? "Older history is paused."
                : history.coverage.complete
                  ? "All fact history loaded."
                  : "Loading older facts in the background…"}
            </p>
          )}
          {history.error && (
            <p role="alert">
              Fact history could not be fully loaded: {history.error}{" "}
              <button type="button" onClick={history.refresh}>
                Retry history
              </button>
            </p>
          )}
        </>
      )}
      </section>
    </div>
  );
}

function MintLinks() {
  return (
    <div className="fc-history-mint-links">
      <a href="#/request">Wallet Facts ↗</a>
      <a href="#/mint">Sworn Card ↗</a>
    </div>
  );
}
