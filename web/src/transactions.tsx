import { useState, useRef, useEffect } from "react";
import { useAccount } from "wagmi";
import { useSite } from "./context";
import { contract } from "./chain";
import { imd, ethCeiling } from "./pure.mjs";
import { eligibilityText } from "./eligibility.mjs";
import { Card, Status } from "./components";
import { TRAITS } from "./data";
import { VerificationOverview, useSharedSwarmProgress } from "./swarm";
import { FactCheckView } from "./fact-check/FactCheckView";
import { oracleRequestLink, pendingRequestSnapshots } from "./fact-check/request-model.mjs";
import type { FactCheckSnapshot } from "./fact-check/types";
import { unsubmittedFactIds } from "./progress-experience.mjs";
import { cardSuccessKey, cardSuccessDismissed, dismissCardSuccess } from "./card-success.mjs";
import { useTransactions, type Journal } from "./controllers/transactions";
export { TransactionProvider, useTransactions } from "./controllers/transactions";
export type { Call, Plan, Journal } from "./controllers/transactions";
export function TransactionJournalSlot() {
  return <TransactionJournal journal={useTransactions()} />;
}
function CardCreated({
  token,
  account,
  hash,
  onNavigate,
}: {
  token: bigint;
  account: string;
  hash?: string;
  onNavigate?: () => void;
}) {
  const { r } = useSite();
  const key = cardSuccessKey({
    chainId: r.deployment.chainId,
    registry: contract(r, "Registry").address,
    account,
    token,
    hash,
  });
  const [dismissedKey, setDismissedKey] = useState<string>();
  useEffect(() => {
    const dismissed = (event: Event) => setDismissedKey((event as CustomEvent<string>).detail);
    window.addEventListener("sworn-card-success-dismissed", dismissed);
    return () => window.removeEventListener("sworn-card-success-dismissed", dismissed);
  }, []);
  const dismiss = () => {
    dismissCardSuccess(sessionStorage, key);
    setDismissedKey(key);
    window.dispatchEvent(new CustomEvent("sworn-card-success-dismissed", { detail: key }));
  };
  if (dismissedKey === key || cardSuccessDismissed(sessionStorage, key)) return null;
  return (
    <section
      className="verification-moment phase-proven card-created"
      aria-label="Card created"
      role="status"
    >
      <span className="verification-mark" aria-hidden="true">
        ✓
      </span>
      <div>
        <h3>Mint succeeded — your card is ready!</h3>
        <p>
          Your Sworn card #{token.toString()} was minted on Ethereum. View it on
          Mint Card and find its claimed facts on Mint Facts.
        </p>
        <a
          className="verification-wallet-link"
          href="#/mint#your-card"
          onClick={() => { dismiss(); onNavigate?.(); }}
        >
          View your card
        </a>
      </div>
      <button
        type="button"
        className="card-created-dismiss"
        aria-label="Dismiss mint success message"
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </section>
  );
}
export function TransactionTopProgress({ task }: { task: string }) {
  const j = useTransactions();
  const { address } = useAccount();
  const site = useSite();
  const shared = useSharedSwarmProgress();
  const bridges = pendingRequestSnapshots(j, address, TRAITS, site.specs, contract(site.r, "Registry").address) as FactCheckSnapshot[];
  const fallbacks = Object.fromEntries(bridges.filter(snapshot => snapshot.requestId).map(snapshot => [
    snapshot.requestId!, <FactCheckView key={snapshot.key} snapshot={snapshot}/>,
  ]));
  const minted =
    j.plan?.account.toLowerCase() === address?.toLowerCase()
      ? j.steps.find(
          (s) => s.state === "confirmed" && s.result?.token !== undefined,
        )
      : undefined;
  return (
    <>
      {minted?.result?.token !== undefined && (
        <CardCreated token={minted.result.token} account={j.plan!.account} hash={minted.hash} />
      )}
      {bridges.filter(snapshot => !snapshot.requestId || !shared?.facts.some(fact => fact.requestId === snapshot.requestId)).map(snapshot =>
        <FactCheckView key={snapshot.key} snapshot={snapshot}/>,
      )}
      <VerificationOverview separateFromMint={task === "/mint"} fallbacks={fallbacks} />
    </>
  );
}
export function TransactionJournal({ journal: j }: { journal: Journal }) {
  const site = useSite(),
    dialog = useRef<HTMLDialogElement>(null);
  const [hash, setHash] = useState("");
  useEffect(() => {
    const d = dialog.current;
    if (j.isOpen && d && !d.open) {
      d.showModal();
      d.scrollTop = 0;
    }
    if (!j.isOpen && d?.open) {
      d.close();
      j.restoreFocus();
    }
  }, [j.isOpen]);
  const complete = j.steps.length > 0 && j.next === -1;
  const results = j.steps.filter((s) => s.state === "confirmed" && s.result);
  const preflightIds = unsubmittedFactIds(j.personalIds, results, complete);
  const oraclePayment = j.plan?.calls.some((c) =>
    ["upgrade", "requestSharedFact"].includes(c.functionName),
  );
  const mintPayment = j.plan?.calls.some((c) => c.functionName === "mintCard");
  const registrationPayment = j.plan?.calls.some(
    (c) => c.functionName === "registerSpec",
  );
  const active = j.steps[j.next];
  const legacyFunding = !!j.plan && (
    j.plan.payment !== "IMD" || !!j.plan.quote ||
    j.steps.some((step) => step.call?.functionName === "execute" || (step.call?.value ?? 0n) > 0n)
  );
  const progressFact = results.flatMap((step) => step.result?.facts || [])[0];
  const terminal = j.steps.some((s) =>
    ["cancelled", "replaced", "failed", "rejected"].includes(s.state),
  );
  const directFacts =
    j.plan?.preview?.traits.filter((id) =>
      TRAITS.some((t) => t.id === id && t.class === "direct"),
    ) || [];
  if (!j.plan && !j.steps.length) return null;
  return (
    <section
      id="transaction-steps"
      className="section journal"
      aria-label="Saved transaction progress"
    >
      <h2>Transaction steps</h2>
      <p>
        {j.plan?.title || "Saved transaction receipts"} ·{" "}
        {complete ? "Confirmed" : active?.state || "Saved on this browser"}
      </p>
      <button id="review-transaction-steps" onClick={() => j.setOpen(true)}>
        Review transaction steps
      </button>
      <dialog
        ref={dialog}
        className="payment-dialog"
        aria-labelledby="payment-title"
        onCancel={(event) => {
          event.preventDefault();
          j.close();
        }}
        onClose={() => {
          if (j.isOpen) j.close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) j.close();
        }}
      >
        <div className="payment-dialog-body">
          <div className="sheet-head">
            <h2 id="payment-title">
              {j.plan?.title || "Saved transaction receipts"}
            </h2>
            <button
              type="button"
              aria-label="Close payment dialog"
              onClick={j.close}
            >
              ×
            </button>
          </div>
          <p className="payment-network-notice" role="note">
            ETHEREUM MAINNET · Fees are paid in IMD; Ethereum gas is paid in ETH. Review each
            transaction in your wallet before confirming.
          </p>
          {j.plan && (
            <p>
              <strong>{imd(j.plan.amount)} IMD fee</strong> · {j.steps.length}{" "}
              transaction{j.steps.length === 1 ? "" : "s"} · gas additional.
            </p>
          )}
          {active && (
            <p role="status">
              <strong>
                Step {j.next + 1} of {j.steps.length}:{" "}
                {active.call?.label || active.label}
              </strong>
              <br />
              {active.state === "awaiting signature"
                ? "Waiting for your wallet. Closing this dialog does not cancel a wallet request or submitted transaction."
                : active.state === "refreshing"
                  ? "Receipt received. Refreshing the resulting state before continuing."
                  : active.state}
            </p>
          )}
          {active && (
            <p className="muted">
              Current step gas:{" "}
              {active.gas !== undefined
                ? `${ethCeiling(active.gas)} ETH (gas estimate)`
                : "estimate unavailable until this step passes its check"}
            </p>
          )}
          {legacyFunding && !complete && (
            <Status>
              Only IMD fee payments are supported. Recover any outstanding
              receipt below, then prepare the action again with IMD.
            </Status>
          )}
          {j.plan && !complete && !terminal && !legacyFunding && (
            <label className="ack">
              <input
                id="payment-ack"
                type="checkbox"
                checked={j.ack}
                disabled={j.busy}
                onChange={(e) => j.setAck(e.target.checked)}
              />
              {mintPayment
                ? "I understand this mints one card for the original wallet, freezes its direct facts at mint, and spends the displayed IMD fee plus ETH gas. No oracle request is included."
                : oraclePayment
                  ? "I understand this spends the IMD request fee plus ETH gas. The request fee is not refunded for a false answer, no verdict or failed verification. A mined request is not yet a verified fact."
                  : registrationPayment
                    ? "I understand this spends the Mint Rule fee plus ETH gas. Mint Rule registers a definition; it does not prove it for a wallet or pay for a later Mint Facts verification request."
                    : "I understand these transactions spend the displayed amounts plus ETH gas."}
            </label>
          )}
          {preflightIds.map((id: number) => (
            <p
              key={id}
              className={
                j.eligibility[j.eligibilityKey(id)]?.state === "not-met"
                  ? "danger"
                  : "muted"
              }
              role="status"
            >
              {eligibilityText(
                j.eligibility[j.eligibilityKey(id)],
                j.plan!.price,
              )}
            </p>
          ))}
          {preflightIds.length > 0 && j.eligibilityNegative && (
            <button
              type="button"
              aria-pressed={j.requestAnyway}
              disabled={
                j.requestAnyway ||
                j.eligibilityChecking ||
                !j.ack ||
                !j.available
              }
              onClick={() => j.setRequestAnyway(true)}
            >
              Request anyway
            </button>
          )}
          {active && !legacyFunding && !["cancelled", "replaced"].includes(active.state) && (
            <div className="step-actions">
              {["failed", "rejected"].includes(active.state) && (
                <button
                  disabled={j.busy || !j.ack || !j.available}
                  onClick={() => j.retry(j.next)}
                >
                  Retry check
                </button>
              )}
              <button
                className="primary"
                disabled={
                  j.busy ||
                  !j.ack ||
                  !j.available ||
                  active.state !== "simulated" ||
                  !j.eligibilityConfirmed
                }
                onClick={() => j.execute(j.next)}
              >
                {active.call?.label || "Confirm step"}
              </button>
            </div>
          )}
          <Status error>{j.error || active?.error}</Status>
          {!j.available && j.plan && (
            <Status>
              {!site.health
                ? "Cannot read Ethereum mainnet, retrying."
                : "Connect the preparing wallet on Ethereum to continue."}
            </Status>
          )}
          {results.map((s, i) => (
            <section
              key={s.hash || i}
              className="transaction-result"
              aria-label="Transaction result"
            >
              {s.result!.token !== undefined && j.plan?.account && (
                <CardCreated token={s.result!.token} account={j.plan.account} hash={s.hash} onNavigate={j.close} />
              )}
              {s.result!.facts?.map((fact) => (
                <p key={fact.requestId} className="accent" role="status">
                  {fact.name}: request recorded. Follow its progress on Fact Check.
                </p>
              ))}
            </section>
          ))}
          {progressFact && (
            <a
              href={j.plan?.account ? oracleRequestLink(j.plan.account, progressFact) : "#/fact-check"}
              onClick={j.close}
            >
              View Fact Check
            </a>
          )}
          {j.plan && (
            <details>
              <summary>
                Full cost breakdown · {j.steps.length} transaction
                {j.steps.length === 1 ? "" : "s"}
              </summary>
              <dl className="payment-summary">
                <div>
                  <dt>Fee</dt>
                  <dd>{imd(j.plan.amount)} IMD</dd>
                </div>
                <div>
                  <dt>Wallet transactions</dt>
                  <dd>{j.steps.length}; each has its own confirmation</dd>
                </div>
                <div>
                  <dt>Total gas</dt>
                  <dd>
                    {j.steps.every((s) => s.gas !== undefined)
                      ? `${ethCeiling(j.steps.reduce((n, s) => n + s.gas!, 0n))} ETH (gas estimate)`
                      : "Total estimate unavailable. Each step is estimated after the previous receipt."}
                  </dd>
                </div>
              </dl>
              <ul>
                {j.plan.lines.map((line, i) => (
                  <li key={i}>
                    {line.id ? `${line.id} / ` : ""}
                    {line.name} · {imd(line.amount)} IMD
                  </li>
                ))}
              </ul>
              {oraclePayment && (
                <p>
                  Oracle request fees go to IMD Intake when the request transaction succeeds.
                </p>
              )}
              {(mintPayment || registrationPayment) && (
                <p>
                  The {mintPayment ? "card" : "registration"} fees
                  go to the IMD BurnExecutor for bridging and burning on Base.
                  The subsequent bridge and burn are separate operations.
                </p>
              )}
            </details>
          )}
          {mintPayment && j.plan?.preview && (
            <details className="payment-preview">
              <summary>Card preview and direct facts</summary>
              <Card facts={j.plan.preview} />
              <p>
                <strong>Direct facts captured:</strong>{" "}
                {directFacts
                  .map(
                    (id) => `${TRAITS.find((t) => t.id === id)?.name} (${id})`,
                  )
                  .join(", ") || "none"}
                .
              </p>
              <p>
                These are the original wallet’s direct facts. Minting freezes
                them for that wallet’s later Sworn checks and card display;
                transferring the NFT does not transfer the wallet’s facts. Later
                verified facts can still be added. The card itself is not proof
                of the current holder’s eligibility.
              </p>
            </details>
          )}
          <details open={j.steps.some((s) => s.state === "unknown")}>
            <summary>Transaction history and receipts</summary>
            <ol className="journal-steps">
              {j.steps.map((s, i) => (
                <li key={i}>
                  <div>
                    <strong>{s.label}</strong>
                    <span
                      className={s.state === "confirmed" ? "accent" : "muted"}
                    >
                      {s.state}
                    </span>
                  </div>
                  {s.hash && (
                    <a
                      className="receipt"
                      href={`${site.r.deployment.network.explorer}/tx/${s.hash}`}
                    >
                      Ethereum receipt: {s.hash}
                    </a>
                  )}
                  {s.replacement && (
                    <a
                      className="receipt"
                      href={`${site.r.deployment.network.explorer}/tx/${s.replacement}`}
                    >
                      Replacement receipt: {s.replacement}
                    </a>
                  )}
                  {s.error && <Status error>{s.error}</Status>}
                </li>
              ))}
            </ol>
          </details>
          {complete && !results.length && (
            <p className="accent" role="status">
              All transaction steps confirmed and state refreshed.
            </p>
          )}
          {j.registered && (
            <p className="accent" role="status">
              Rule {j.registered} minted in the contract. No wallet fact has been minted yet.{" "}
              <a href={`#/request?trait=${j.registered}`} onClick={j.close}>
                Mint Facts
              </a>
            </p>
          )}
          <details open={active?.state === "unknown"}>
            <summary>Recover a saved transaction</summary>
            <p>
              A reload never resends a saved action. Check its receipt here. A
              replacement must match the saved sender and nonce; only identical
              target, calldata and value complete the original action.
            </p>
            {active?.state === "unknown" && !active.hash && (
              <p>
                The wallet reply was interrupted. Check your wallet or the Ethereum explorer for the returned hash; no second request is sent while
                its outcome is unknown.
              </p>
            )}
            <form
              className="recover-form"
              onSubmit={(e) => {
                e.preventDefault();
                void j.recover(hash);
              }}
            >
              <label htmlFor="recover-hash">Transaction hash</label>
              <input
                id="recover-hash"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="0x… (66 characters)"
              />
              <button disabled={j.busy}>Recover receipt</button>
            </form>
          </details>
          {terminal && !j.busy && (
            <button type="button" onClick={j.discard}>
              Clear settled action and prepare again
            </button>
          )}
          <button className="secondary" onClick={j.close}>
            Close
          </button>
        </div>
      </dialog>
    </section>
  );
}
