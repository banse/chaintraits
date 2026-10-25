import {
  useEffect,
  createContext,
  useContext,
  useCallback,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount } from "wagmi";
import { useSite } from "./context";
import { contract, read, scopedClient } from "./chain";
import { registryEvents, FEED_WINDOW, HISTORY_WINDOW } from "./settlement";
import {
  oracleProgressReader,
  progressCounts,
  progressStatus,
  answerText,
  WalletQuestionMismatch,
  panelAgreement,
  walletList,
  agreedList,
  sameList,
} from "./oracle-progress.mjs";

import { pageReads } from "./page-reads.mjs";
import { registryOutcome, NO_FACT } from "./request-outcomes.mjs";
import { savedRequests } from "./request-history.mjs";
import {
  agentResult,
  verificationPhase,
  isSharedFact,
} from "./progress-experience.mjs";
import "./progress-experience.css";
import { verificationDismissalKey, verificationDismissed, dismissVerification } from "./verification-dismissal.mjs";

export const SWARM_POLL_MS = 5000;
export type WatchedFact = { requestId: string; id: number; name: string };
const WAITING = "Waiting for the swarm to pick up the request…";
const STALE = "Requested more than 2 hours ago.";
const TWO_HOURS = 7200;
const shortWallet = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
function ListAnswer({
  list,
  agreed,
  wallet,
}: {
  list: string[];
  agreed: string[] | null;
  wallet?: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const rank = wallet
    ? list.findIndex((a) => a.toLowerCase() === wallet.toLowerCase()) + 1
    : 0;
  return (
    <div className="swarm-list-answer">
      <span>
        Answer: list of {list.length} wallets ·{" "}
        {sameList(list, agreed)
          ? "same as the agreed list"
          : "differs from the agreed list"}
        {rank > 0 ? ` · your wallet at #${rank}` : ""}
      </span>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Hide list" : "Show list"}
      </button>
      <ol id={id} hidden={!expanded} className="swarm-wallet-list">
        {list.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ol>
    </div>
  );
}
function LoadingIndicator() {
  return <span className="swarm-loading" aria-hidden="true" />;
}
function Question({ question }: { question: string }) {
  return (
    <div className="swarm-question">
      <h4>Question</h4>
      <p className="swarm-question-full">{question}</p>
    </div>
  );
}
function QuestionFields({ label, value }: { label: string; value: any }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="swarm-question-fields">
      <h4>{label}</h4>
      {typeof value === "object" && !Array.isArray(value) ? (
        <dl>
          {Object.entries(value).map(([key, text]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{answerText(text)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>{answerText(value)}</p>
      )}
    </div>
  );
}
export function RequestTime({ requestId }: { requestId: string }) {
  const { client, r, health } = useSite();
  const [time, setTime] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (health)
      read(client, r, "Registry", "pendingRequest", [requestId])
        .then((p) => {
          if (active && p[2] > 0n)
            setTime(new Date(Number(p[2]) * 1000).toISOString());
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [requestId, client, health]);
  return time ? (
    <time dateTime={time}>
      {time.replace(".000Z", " UTC").replace("T", " ")}
    </time>
  ) : (
    <span>
      {failed
        ? "request time unavailable; retry chain reads"
        : "reading request time…"}
    </span>
  );
}
function useSwarmSnapshot(fact: WatchedFact, onAttested: () => void) {
  const site = useSite();
  const { client, r } = site;
  const { address } = useAccount();
  const callback = useRef(onAttested);
  callback.current = onAttested;
  const [view, setView] = useState<any>(null);
  // A wallet change must hide the previous wallet's panel immediately.
  const current =
    view?.address === address && view?.requestId === fact.requestId;
  const progress = current ? view.progress : null;
  const message = current ? view.message : WAITING;
  const wrongWallet = current ? view.wrongWallet : null;
  const [retry, setRetry] = useState(0);
  const identity = useRef<{ requestId: string; pending: any } | null>(null);
  // "Panel agreed" belongs to one oracle request id and survives Retry progress
  // until the Registry's event for this request arrives.
  const agreement = useRef<{
    requestId: string;
    oracleId: string;
    text: string;
  } | null>(null);
  const backfills = useMemo(() => pageReads(), [fact.requestId, client]);
  const checked = useRef<string | null>(null);
  useEffect(() => () => backfills.stop(), [backfills]);
  useEffect(() => {
    backfills.retryFailed();
  }, [site.readRetry, backfills]);
  // A found outcome is kept across restarts (Retry progress, wallet changes),
  // including one only a read back to launch found.
  const ended = useRef<{ requestId: string; event: any } | null>(null);
  // Kept across wallet connects and switches so a known explorer link stays.
  const load = useMemo(() => oracleProgressReader(), [fact.requestId]);
  useEffect(() => {
    let active = true,
      running = false,
      settled = false;
    let pending: any =
      identity.current?.requestId === fact.requestId
        ? identity.current.pending
        : null;
    let attested = false;
    let terminal: any =
      ended.current?.requestId === fact.requestId ? ended.current.event : null;
    let controller: AbortController;
    const consensusFor = (result: any) => {
      const a = agreement.current;
      if (!a || a.requestId !== fact.requestId) return null;
      if (result && result.id !== a.oracleId) return null;
      return a.text;
    };
    async function poll() {
      if (running || settled) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      // This poll's chain reads stop with it (unmount, wallet change, timeout).
      const client = scopedClient(site.client, controller.signal);
      let hasFact: boolean | null = null;
      let token: bigint | null = null;
      try {
        let events = terminal
          ? []
          : await registryEvents(
              client,
              r,
              pending
                ? [
                    "Verified",
                    "SharedFactStored",
                    "Missed",
                    "NoVerdict",
                    "Abandoned",
                  ]
                : [
                    "TraitRequested",
                    "Verified",
                    "SharedFactStored",
                    "Missed",
                    "NoVerdict",
                    "Abandoned",
                  ],
              fact.id,
              { window: FEED_WINDOW, fromBlock: pending?.blockNumber },
            );
        if (
          !terminal &&
          !pending &&
          !events.some(
            (e) =>
              e.eventName === "TraitRequested" &&
              e.args.requestId?.toLowerCase() === fact.requestId.toLowerCase(),
          )
        ) {
          events = await registryEvents(
            client,
            r,
            [
              "TraitRequested",
              "Verified",
              "SharedFactStored",
              "Missed",
              "NoVerdict",
              "Abandoned",
            ],
            fact.id,
            { window: HISTORY_WINDOW },
          );
          if (
            !events.some(
              (e) =>
                e.eventName === "TraitRequested" &&
                e.args.requestId?.toLowerCase() ===
                  fact.requestId.toLowerCase(),
            )
          ) {
            events = await backfills.once("outcome", () =>
              registryEvents(
                scopedClient(
                  site.client,
                  AbortSignal.any([backfills.signal, controller.signal]),
                ),
                r,
                [
                  "TraitRequested",
                  "Verified",
                  "SharedFactStored",
                  "Missed",
                  "NoVerdict",
                  "Abandoned",
                ],
                fact.id,
              ),
            );
            checked.current = fact.requestId;
          }
        }
        if (!pending) {
          const p = await read(client, r, "Registry", "pendingRequest", [
            fact.requestId,
          ]);
          const event = events.find(
            (e) =>
              e.eventName === "TraitRequested" &&
              e.args.requestId.toLowerCase() === fact.requestId.toLowerCase(),
          );
          if (!event) {
            // A just-confirmed request can be newer than an endpoint's head.
            const stale =
              p[2] !== 0n && Date.now() / 1000 - Number(p[2]) > TWO_HOURS;
            if (active)
              setView({
                outcome: null,
                consensus: consensusFor(null),
                address,
                requestId: fact.requestId,
                progress: null,
                message: "No matching Registry request has been found in the loaded history yet. Retry the chain read.",
              });
            return;
          }
          // After delivery pendingRequest may be cleared. The originating event
          // and its block still identify the request across reloads/recovery.
          if (
            p[2] !== 0n &&
            (Number(p[1]) !== fact.id ||
              event.args.claimant.toLowerCase() !== p[0].toLowerCase() ||
              event.args.questionHash.toLowerCase() !== p[3].toLowerCase())
          )
            throw Error("Request event mismatch.");
          const requestedAt =
            p[2] !== 0n
              ? p[2]
              : (await client.getBlock({ blockNumber: event.blockNumber }))
                  .timestamp;
          if (
            !/^0x0+$/i.test(event.args.claimant) &&
            event.args.claimant.toLowerCase() !== address?.toLowerCase()
          )
            throw Error("Request belongs to another wallet.");
          pending = {
            registry: contract(r, "Registry").address,
            chainId: r.deployment.chainId,
            requestId: fact.requestId,
            transactionHash: event.transactionHash,
            claimant: event.args.claimant,
            requestedAt,
            blockNumber: event.blockNumber,
            questionHash: event.args.questionHash,
            spec: await read(client, r, "Registry", "specOf", [fact.id]),
          };
          identity.current = { requestId: fact.requestId, pending };
        }
        const outcome = events.find(
          (e) =>
            e.eventName !== "TraitRequested" &&
            e.args.requestId?.toLowerCase() === fact.requestId.toLowerCase(),
        );
        if (outcome) {
          terminal = outcome;
          ended.current = { requestId: fact.requestId, event: outcome };
          agreement.current = null;
          if (outcome.eventName === "Verified")
            pending.oracleRequestId = outcome.args.oracleRequestId;
          callback.current();
        }
        if (!active) return;
        // Age follows the clock on every poll, also for a request already
        // watched: more than 7,200 seconds after the request's own time,
        // whatever the block count.
        const stale =
          !terminal &&
          Date.now() / 1000 - Number(pending.requestedAt) > TWO_HOURS;
        if (
          terminal?.eventName === "Verified" &&
          address &&
          terminal.args.claimant?.toLowerCase() === address.toLowerCase() &&
          Number(terminal.args.traitId) === fact.id
        ) {
          [hasFact, token] = await Promise.all([
            read(client, r, "Registry", "hasTrait", [address, fact.id]),
            read(client, r, "Registry", "tokenOf", [address]),
          ]);
        }
        const result = await load(
          { ...pending, wallet: address },
          controller.signal,
        );
        if (!active) return;
        const agreed = result ? panelAgreement(result, pending.spec) : null;
        if (agreed)
          agreement.current = {
            requestId: fact.requestId,
            oracleId: result.id,
            text: agreed,
          };
        else if (result && agreement.current?.oracleId !== result.id)
          agreement.current = null;
        setView({
          requestConfirmed: true,
          outcome: registryOutcome(terminal),
          event: terminal,
          hasFact,
          token,
          consensus: terminal ? null : consensusFor(result),
          spec: pending.spec,
          address,
          requestId: fact.requestId,
          progress: result,
          message: result ? "" : stale ? STALE : WAITING,
          stale,
        });
        if (result && progressStatus(result) === "attested" && !attested) {
          attested = true;
          callback.current();
        }
      } catch (error) {
        if (active) {
          setView({
            requestConfirmed: !!pending,
            outcome: registryOutcome(terminal),
            event: terminal,
            hasFact,
            token,
            consensus:
              terminal || error instanceof WalletQuestionMismatch
                ? null
                : consensusFor(null),
            address,
            requestId: fact.requestId,
            progress: null,
            message:
              error instanceof WalletQuestionMismatch
                ? error.message
                : "progress unavailable",
            wrongWallet:
              error instanceof WalletQuestionMismatch ? error.wallet : null,
            // The Registry's request time is already known: its age still
            // shows when the progress lookup fails.
            stale:
              !terminal &&
              !!pending &&
              Date.now() / 1000 - Number(pending.requestedAt) > TWO_HOURS,
          });
        }
      } finally {
        // Terminal evidence is retained without a permanent per-request read loop.
        // A retry or route reload can explicitly recheck it. A Verified event
        // alone is insufficient until the wallet's hasTrait read agrees.
        settled =
          !!terminal && (terminal.eventName !== "Verified" || hasFact === true);
        clearTimeout(timeout);
        running = false;
      }
    }
    void poll();
    const interval = setInterval(poll, SWARM_POLL_MS);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
    };
  }, [
    fact.requestId,
    client,
    r,
    retry,
    load,
    address,
    site.readRetry,
    backfills,
  ]);
  const retryProgress = useCallback(() => setRetry((n) => n + 1), []);
  return useMemo(
    () => ({
      view,
      current,
      progress,
      message,
      wrongWallet,
      address,
      checked: checked.current,
      retryProgress,
    }),
    [view, current, progress, message, wrongWallet, address, retryProgress],
  );
}

type Snapshot = ReturnType<typeof useSwarmSnapshot>;
const SharedProgress = createContext<{
  facts: WatchedFact[];
  snapshots: Record<string, Snapshot>;
} | null>(null);
function RequestObserver({
  fact,
  onSnapshot,
}: {
  fact: WatchedFact;
  onSnapshot: (id: string, snapshot: Snapshot) => void;
}) {
  const site = useSite();
  const snapshot = useSwarmSnapshot(fact, site.refresh);
  useEffect(
    () => onSnapshot(fact.requestId, snapshot),
    [fact.requestId, snapshot, onSnapshot],
  );
  return null;
}
export function SwarmProgressProvider({ children }: { children: ReactNode }) {
  const { r } = useSite();
  const { address } = useAccount();
  const scope =
    `${r.deployment.chainId}:${contract(r, "Registry").address}:${address || ""}`.toLowerCase();
  const [revision, setRevision] = useState(0);
  const [cache, setCache] = useState<{
    scope: string;
    snapshots: Record<string, Snapshot>;
  }>({ scope: "", snapshots: {} });
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener("sworn-request-confirmed", refresh);
    return () => window.removeEventListener("sworn-request-confirmed", refresh);
  }, []);
  const facts = useMemo(
    () =>
      address
        ? (savedRequests(
            sessionStorage,
            r.deployment.chainId,
            contract(r, "Registry").address,
            address,
          )
            .filter(
              (f: any) =>
                f && typeof f.requestId === "string" && Number.isInteger(f.id),
            )
            .reverse() as WatchedFact[])
        : [],
    [scope, revision],
  );
  const publish = useCallback(
    (id: string, snapshot: Snapshot) =>
      setCache((old) => ({
        scope,
        snapshots: {
          ...(old.scope === scope ? old.snapshots : {}),
          [id]: snapshot,
        },
      })),
    [scope],
  );
  const snapshots = cache.scope === scope ? cache.snapshots : {};
  return (
    <SharedProgress.Provider value={{ facts, snapshots }}>
      {facts.map((fact) => (
        <RequestObserver
          key={`${scope}:${fact.requestId}`}
          fact={fact}
          onSnapshot={publish}
        />
      ))}
      {children}
    </SharedProgress.Provider>
  );
}
export function VerificationOverview({ separateFromMint = false }: { separateFromMint?: boolean }) {
  const shared = useContext(SharedProgress);
  const { r } = useSite();
  const { address } = useAccount();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const keyFor = (fact: WatchedFact) => verificationDismissalKey({
    chainId: r.deployment.chainId,
    registry: contract(r, "Registry").address,
    account: address || "",
    requestId: fact.requestId,
  });
  const visible = (shared?.facts || []).filter(fact => {
    const key = keyFor(fact);
    return !dismissed.has(key) && !verificationDismissed(sessionStorage, key);
  });
  const dismiss = () => {
    const keys = visible.map(keyFor);
    keys.forEach(key => dismissVerification(sessionStorage, key));
    setDismissed(old => new Set([...old, ...keys]));
  };
  if (!visible.length) return null;
  return (
    <section
      className="verification-overview"
      aria-label="Verification progress"
    >
      <h2 id="verification-progress-title" tabIndex={-1}>
        {separateFromMint ? "Separately requested verification" : "Your verification progress"}
      </h2>
      <button
        type="button"
        className="verification-overview-dismiss"
        aria-label="Dismiss verification progress"
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
      <p className="muted">
        Follow each agent here or in the popup. Closing either view does not
        stop verification. Review transaction steps keeps the details available.
      </p>
      {visible.map((fact, i) => (
        <SwarmFeed
          key={fact.requestId}
          fact={fact}
          focus={null}
          onAttested={() => {}}
          idPrefix="top"
          compact={i > 0 && !!shared?.snapshots[fact.requestId]?.view?.event}
        />
      ))}
    </section>
  );
}
type FeedProps = {
  fact: WatchedFact;
  focus: { requestId: string; tick: number } | null;
  onAttested: () => void;
  idPrefix?: string;
  compact?: boolean;
  onNavigate?: () => void;
};
export function SwarmFeed(props: FeedProps) {
  const shared = useContext(SharedProgress);
  const snapshot = shared?.snapshots[props.fact.requestId];
  if (shared?.facts.some((f) => f.requestId === props.fact.requestId))
    return snapshot ? (
      <SwarmFeedView {...props} snapshot={snapshot} />
    ) : (
      <p
        role="status"
        aria-live={
          ["top", "popup", "wallet"].includes(props.idPrefix || "swarm")
            ? "polite"
            : "off"
        }
      >
        Reading verification progress…
      </p>
    );
  return <StandaloneSwarmFeed {...props} />;
}
function StandaloneSwarmFeed(props: FeedProps) {
  const snapshot = useSwarmSnapshot(props.fact, props.onAttested);
  return <SwarmFeedView {...props} snapshot={snapshot} />;
}
function AgentDetails({
  compact,
  children,
}: {
  compact: boolean;
  children: ReactNode;
}) {
  return compact ? (
    <details className="agent-details">
      <summary>Agent details</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
function SwarmFeedView({
  fact,
  focus,
  onAttested,
  idPrefix = "swarm",
  compact = false,
  onNavigate,
  snapshot,
}: FeedProps & { snapshot: Snapshot }) {
  const {
    view,
    current,
    progress,
    message,
    wrongWallet,
    address,
    checked,
    retryProgress,
  } = snapshot;
  const element = useRef<HTMLDetailsElement>(null);
  const live = ["top", "popup", "wallet"].includes(idPrefix) ? "polite" : "off";
  const [expanded, setExpanded] = useState(!compact);
  const notified = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (current && view?.event && notified.current !== fact.requestId) {
      notified.current = fact.requestId;
      onAttested();
    }
  }, [current, view?.event, fact.requestId, onAttested]);
  useEffect(() => {
    if (focus?.requestId === fact.requestId && element.current) {
      setExpanded(true);
      element.current.querySelector("summary")?.focus();
      element.current.scrollIntoView({ block: "nearest" });
    }
  }, [focus]);
  const phase = verificationPhase({
    fact,
    wallet: address,
    progress,
    spec: view?.spec,
    event: current ? view?.event : null,
    hasFact: current ? view?.hasFact : null,
    requestConfirmed: current && view?.requestConfirmed === true,
  });
  const counts = progress ? progressCounts(progress, view.spec) : null;
  const list = progress ? agreedList(progress) : null;
  const outcome = current ? view.outcome : null;
  const status = progress ? progressStatus(progress) : null;
  return (
    <details
      ref={element}
      className="swarm-request"
      id={`${idPrefix}-${fact.requestId}`}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {fact.id} / {fact.name}{" "}
        <span className={`progress-summary-${phase.tone}`}>
          · {phase.title}
        </span>
      </summary>
      <div
        className={`verification-moment phase-${phase.kind}`}
        role="status"
        aria-live={live}
        aria-atomic="true"
      >
        <span className="verification-mark" aria-hidden="true">
          {phase.tone === "positive"
            ? "✓"
            : phase.tone === "negative"
              ? "✕"
              : "…"}
        </span>
        <div>
          <h3>
            {phase.kind === "proven"
              ? "Congratulations — fact proven!"
              : phase.title}
          </h3>
          {phase.kind === "proven" ? (
            <>
              <p>
                The swarm has proven <strong>{fact.name}</strong> for your
                wallet. The Registry now stores the fact.
              </p>
              <p>
                {view.token > 0n
                  ? "Your card has new facts. Check the updated card on the Wallet page."
                  : "Your wallet fact is ready. You can view it on Wallet without creating a card."}
              </p>
              <a
                className="verification-wallet-link"
                href="#/wallet"
                onClick={onNavigate}
              >
                {view.token > 0n
                  ? "View updated card on Wallet"
                  : "View facts on Wallet"}
              </a>
            </>
          ) : phase.kind === "shared" ? (
            <p>
              The shared list is stored. Apply it to your wallet if you are
              eligible; storing the list alone does not prove your wallet fact.
            </p>
          ) : phase.kind === "approved" ? (
            <p>
              {isSharedFact(fact.id, view?.spec)
                ? "The panel signed a shared result. Waiting for the Registry to store the list."
                : "The panel signed a positive answer. Waiting for the Registry to store it for your wallet."}
            </p>
          ) : phase.kind === "quorum" ? (
            <p>
              Enough agents agree. The panel still needs to finish signing and
              delivering its answer.
            </p>
          ) : phase.kind === "failed" ? (
            <>
              <p>{outcome || NO_FACT}</p>
              <a href={`#/request?trait=${fact.id}`} onClick={onNavigate}>
                Review and retry verification
              </a>
            </>
          ) : phase.kind === "unconfirmed" ? (
            <p>
              Checking the saved request against the Ethereum Registry. Verification
              has not been confirmed.
            </p>
          ) : phase.kind === "checking" ? (
            <p>
              Your request is confirmed. Watch the panel answers arrive
              below.
            </p>
          ) : (
            <p>
              We are checking the Registry result. A panel answer by itself is
              not a wallet fact.
            </p>
          )}
          <p className="muted">Live IMD panel responses. A wallet fact is confirmed only after its Registry result is read.</p>
        </div>
      </div>
      <ol className="verification-phases" aria-label="Verification stages">
        <li className={phase.kind === "unconfirmed" ? "" : "done"}>
          <span aria-hidden="true">{phase.kind === "unconfirmed" ? "·" : "✓"}</span>{" "}
          {phase.kind === "unconfirmed" ? "Request not yet confirmed" : "Request confirmed"}
        </li>
        <li
          className={
            ["approved", "proven", "shared"].includes(phase.kind) ? "done" : ""
          }
        >
          <span aria-hidden="true">
            {["approved", "proven", "shared"].includes(phase.kind) ? "✓" : "·"}
          </span>{" "}
          Agents check the rule
        </li>
        <li className={["proven", "shared"].includes(phase.kind) ? "done" : ""}>
          <span aria-hidden="true">
            {["proven", "shared"].includes(phase.kind) ? "✓" : "·"}
          </span>{" "}
          Registry stores result
        </li>
      </ol>
      <div className="swarm-announcement">
        {progress ? (
          <p role="status" aria-live={live} aria-atomic="true">
            {counts!.answered} / {progress.panelSize} responses ·{" "}
            {counts!.count
              ? `${counts!.met} meet the rule / ${progress.quorum} needed`
              : counts!.boolean
                ? `${counts!.trueAnswers} true / ${progress.quorum} needed`
                : counts!.agreed
                  ? `${counts!.agreed} agree / ${progress.quorum} quorum`
                  : `no agreement yet / ${progress.quorum} quorum`}
          </p>
        ) : (
          <>
            <p role="status" aria-live={live}>
              {phase.kind !== "unconfirmed" && message === WAITING && <LoadingIndicator />}
              {phase.kind === "unconfirmed" && message === WAITING ? "Checking request history…" : message}
            </p>
            {wrongWallet && <p>Expected wallet: {shortWallet(wrongWallet)}</p>}
          </>
        )}
        {current && view.stale && message !== STALE && <p>{STALE}</p>}
        {status === "failed" && !outcome && (
          <p>
            The panel did not produce a usable answer. Waiting for the final
            Registry outcome.
          </p>
        )}
      </div>
      {progress && (
        <>
          {idPrefix === "top" && (
            <ol className="agent-strip" aria-label="Agent confirmations">
              {Array.from({ length: progress.panelSize }, (_, i) => {
                const result = agentResult(
                  progress.members[i],
                  view.spec,
                  list,
                  status !== "assessing",
                );
                return (
                  <li
                    key={i}
                    className={`strip-${result.kind}`}
                    title={`Agent ${i + 1}: ${result.label}`}
                    aria-label={`Agent ${i + 1}: ${result.label}`}
                  >
                    <span aria-hidden="true">{result.icon}</span>
                    <small aria-hidden="true">{i + 1}</small>
                  </li>
                );
              })}
            </ol>
          )}
          <AgentDetails compact={idPrefix === "top"}>
            <ol className="swarm-seats" aria-label="Panel seats">
              {Array.from({ length: progress.panelSize }, (_, i) => {
                const seat = progress.members[i];
                const result = agentResult(
                  seat,
                  view.spec,
                  list,
                  status !== "assessing",
                );
                return (
                  <li key={i} className={`agent-result agent-${result.kind}`}>
                    <span
                      key={result.kind}
                      className="agent-result-icon"
                      aria-hidden="true"
                    >
                      {result.icon}
                    </span>
                    <strong>
                      Seat {i + 1}
                      {seat?.tokenId != null ? ` · #${seat.tokenId}` : ""}
                    </strong>
                    <span className="agent-result-label">{result.label}</span>
                    {seat?.ok === true && walletList(seat.answer?.answer) ? (
                      <ListAnswer
                        list={seat.answer.answer}
                        agreed={list}
                        wallet={address}
                      />
                    ) : (
                      <span>
                        {seat?.ok === false ? (
                          `Failed: ${answerText(seat.reason)}`
                        ) : seat?.ok === true ? (
                          `Answer: ${answerText(seat.answer?.answer)}`
                        ) : status === "assessing" ? (
                          <>
                            <LoadingIndicator />
                            Awaiting answer
                          </>
                        ) : (
                          "No answer"
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </AgentDetails>
          <details className="progress-evidence">
            <summary>Request details</summary>
            <p className="break">
              Oracle request: {progress.id} · {progress.foundBy}
            </p>
            {typeof progress.jobId === "string" && progress.jobId.trim() && (
              <p>
                <a
                  href={`https://explorer.imd.fun/jobs/${encodeURIComponent(progress.jobId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on the IMD explorer
                </a>
              </p>
            )}
            {progress.wallet && <p>Wallet: {shortWallet(progress.wallet)}</p>}
            {progress.previousRequestId && (
              <p className="break">
                The Registry confirmed a different oracle request from the one
                shown before ({progress.previousRequestId}).
              </p>
            )}
            {typeof progress.question === "string" && (
              <Question key={progress.question} question={progress.question} />
            )}
            <QuestionFields label="Definitions" value={progress.definitions} />
            <QuestionFields label="Pinned window" value={progress.window} />
            {progress.failure && <p>{answerText(progress.failure)}</p>}
            {progress.attestedAt && (
              <p>
                Attested:{" "}
                <time dateTime={progress.attestedAt}>
                  {progress.attestedAt}
                </time>
              </p>
            )}
          </details>
        </>
      )}
      {message === "progress unavailable" && (
        <button onClick={retryProgress}>Retry progress</button>
      )}
      {current && view.event && message !== "progress unavailable" && (
        <button onClick={retryProgress}>Refresh result</button>
      )}
      {current && !view.event && checked === fact.requestId && (
        <p className="muted">No Registry outcome found since launch.</p>
      )}
    </details>
  );
}
