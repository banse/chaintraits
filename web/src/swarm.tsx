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
  progressStatus,
  answerText,
  WalletQuestionMismatch,
  panelAgreement,
  walletList,
  agreedList,
  sameList,
} from "./oracle-progress.mjs";

import { pageReads } from "./page-reads.mjs";
import { registryOutcome } from "./request-outcomes.mjs";
import { savedRequests } from "./request-history.mjs";
import {
  verificationPhase,
} from "./progress-experience.mjs";
import "./progress-experience.css";
import { verificationDismissalKey, verificationDismissed, dismissVerification } from "./verification-dismissal.mjs";
import { FactCheckView } from "./fact-check/FactCheckView";
import { swarmSnapshot, readCardArtwork } from "./fact-check/swarm-snapshot.mjs";
import { matchedOutcome } from "./fact-check/live-model.mjs";
import { pendingOutcomeRead } from "./swarm-polling.mjs";
import type { FactCheckSnapshot, FactCheckEvent } from "./fact-check/types";
import { TRAITS } from "./data";
import { oracleRequestLink } from "./fact-check/request-model.mjs";

export const SWARM_POLL_MS = 5000;
export type WatchedFact = { requestId: string; id: number; name: string; blockNumber?: bigint };
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
function useSwarmSnapshot(fact: WatchedFact, onAttested: () => void, wallet?: string) {
  const site = useSite();
  const { client, r } = site;
  const account = useAccount();
  const address = wallet || account.address;
  const scope = `${r.deployment.chainId}:${contract(r, "Registry").address}:${address}:${fact.id}:${fact.requestId}`;
  const callback = useRef(onAttested);
  callback.current = onAttested;
  const [view, setView] = useState<any>(null);
  // A wallet change must hide the previous wallet's panel immediately.
  const current = view?.scope === scope;
  const progress = current ? view.progress : null;
  const message = current ? view.message : WAITING;
  const wrongWallet = current ? view.wrongWallet : null;
  const [retry, setRetry] = useState(0);
  const identity = useRef<{ scope: string; pending: any } | null>(null);
  // "Panel agreed" belongs to one oracle request id and survives Retry progress
  // until the Registry's event for this request arrives.
  const agreement = useRef<{
    requestId: string;
    oracleId: string;
    text: string;
  } | null>(null);
  const backfills = useMemo(() => pageReads(), [scope, client]);
  const checked = useRef<string | null>(null);
  useEffect(() => () => backfills.stop(), [backfills]);
  useEffect(() => {
    backfills.retryFailed();
  }, [site.readRetry, backfills]);
  // A found outcome is kept across restarts (Retry progress, wallet changes),
  // including one only a read back to launch found.
  const ended = useRef<{ scope: string; event: any } | null>(null);
  const recorded = useRef<{key:string; events:Map<string,FactCheckEvent>}>({key:'',events:new Map()});
  // Kept across wallet connects and switches so a known explorer link stays.
  const load = useMemo(() => oracleProgressReader(), [fact.requestId]);
  useEffect(() => {
    let active = true,
      running = false,
      settled = false,
      networkChecked = false;
    let pending: any =
      identity.current?.scope === scope
        ? identity.current.pending
        : null;
    let attested = false;
    let terminal: any =
      ended.current?.scope === scope ? ended.current.event : null;
    const requestKey = scope;
    if (recorded.current.key !== requestKey) recorded.current = {key:requestKey,events:new Map()};
    const eventsSeen = recorded.current.events;
    const addEvent = (event:FactCheckEvent) => { if (!eventsSeen.has(event.id)) eventsSeen.set(event.id,event); };
    let artwork: {token?:bigint;cardImage?:string;cardError?:string} = {};
    let controller: AbortController;
    const consensusFor = (result: any) => {
      const a = agreement.current;
      if (!a || a.requestId !== fact.requestId) return null;
      if (result && result.id !== a.oracleId) return null;
      return a.text;
    };
    async function poll() {
      if (running || settled || document.hidden || !address) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      // This poll's chain reads stop with it (unmount, wallet change, timeout).
      const client = scopedClient(site.client, controller.signal);
      let hasFact: boolean | null = null;
      let token: bigint | null = null;
      let apiError = "";
      try {
        if (!networkChecked) {
          if (r.deployment.chainId !== 1 || await client.getChainId() !== 1)
            throw Error("This request requires Ethereum mainnet.");
          networkChecked = true;
        }
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
              pending
                ? pendingOutcomeRead(pending, FEED_WINDOW)
                : fact.blockNumber !== undefined
                  ? { fromBlock: fact.blockNumber }
                  : { window: FEED_WINDOW },
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
            if (active)
              setView({
            scope,
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
            origin: event,
            wallet: address,
            factId: fact.id,
            factName: fact.name,
            shortQuestion: fact.id === 601 ? "Did this wallet complete at least 3 accepted IMD swarm jobs while holding an IDMD seat?" : TRAITS.find(trait => trait.id === fact.id)?.rule || fact.name,
          };
          // Bind the originating event before presenting it as confirmed.
          swarmSnapshot({fact,wallet:address,view:{address,requestId:fact.requestId,requestConfirmed:true,identity:pending}});
          identity.current = { scope, pending };
          addEvent({id:`request:${fact.requestId}`,time:new Date(Number(requestedAt)*1000).toISOString(),source:"Ethereum",title:"Request confirmed",href:`https://etherscan.io/tx/${event.transactionHash}`});
        }
        // Save coverage only after a successful read. It survives effect
        // restarts on the cached identity, so a resumed tab catches up once.
        if (!terminal && "toBlock" in events && typeof events.toBlock === "bigint")
          pending.outcomesThrough = events.toBlock;
        const outcome = events.find((event) => matchedOutcome(event, pending));
        if (outcome) {
          terminal = outcome;
          ended.current = { scope, event: outcome };
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
        if (terminal && ["Verified","SharedFactStored","Missed"].includes(terminal.eventName)) {
          if (!artwork.cardImage && artwork.token !== 0n)
            artwork = await readCardArtwork((name:string,args:any[]) => read(client,r,"Registry",name,args),address,token);
          token = artwork.token ?? token;
        }
        let result:any = null;
        try {
          result = await load({ ...pending, wallet: address },controller.signal);
        } catch (error) {
          apiError = error instanceof Error ? error.message : "Agent progress unavailable";
        }
        if (!active) return;
        if (result) {
          pending.oracleQuestion = result.question;
          pending.oracleDefinitions = result.definitions;
          pending.oracleWindow = result.window;
          pending.oracleEvidence = result.evidence;
          addEvent({id:`oracle:${result.id}`,source:"IMD Oracle",title:"Swarm request linked",time:new Date().toISOString()});
          for (const [index,member] of result.members.entries()) {
            if (member.ok === true || member.ok === false)
              addEvent({id:`answer:${result.id}:${index}:${member.ok}:${answerText(member.answer?.answer)}`,source:"IMD Oracle",title:member.tokenId == null ? "Agent answer received" : `IDMD ${member.tokenId} ${member.ok ? "answer received" : "could not answer"}`,detail:member.ok ? answerText(member.answer?.answer) : answerText(member.reason),time:new Date().toISOString()});
          }
          if (progressStatus(result) === "attested") addEvent({id:`signed:${result.id}`,source:"IMD Oracle",title:"Signed result received",time:result.attestedAt || new Date().toISOString()});
        }
        if (terminal) addEvent({id:`registry:${terminal.transactionHash}:${terminal.logIndex}`,source:"Ethereum",title:terminal.eventName === "Verified" ? "Registry fact confirmed" : terminal.eventName === "SharedFactStored" ? "Shared result stored" : "Registry outcome received",detail:registryOutcome(terminal) || undefined,href:`https://etherscan.io/tx/${terminal.transactionHash}`});
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
          scope,
          requestConfirmed: true,
          outcome: registryOutcome(terminal),
          event: terminal,
          hasFact,
          token,
          identity: pending,
          cardImage: artwork.cardImage,
          cardError: artwork.cardError,
          apiError,
          events: [...eventsSeen.values()],
          consensus: terminal ? null : consensusFor(result),
          spec: pending.spec,
          address,
          requestId: fact.requestId,
          progress: result,
          message: apiError ? "progress unavailable" : result ? "" : stale ? STALE : WAITING,
          stale,
        });
        if (result && progressStatus(result) === "attested" && !attested) {
          attested = true;
          callback.current();
        }
      } catch (error) {
        if (active) {
          setView({
            scope,
            requestConfirmed: !!pending,
            outcome: registryOutcome(terminal),
            event: terminal,
            hasFact,
            token,
            identity: pending,
            cardImage: artwork.cardImage,
            cardError: artwork.cardError,
            chainError: error instanceof Error ? error.message : "Registry read unavailable",
            events: [...eventsSeen.values()],
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
        const needsArtwork = terminal && (terminal.eventName === "Verified" || terminal.eventName === "SharedFactStored" || terminal.eventName === "Missed" && Number(terminal.args.reason) === 8);
        settled = !!terminal && (terminal.eventName !== "Verified" || hasFact === true) && (!needsArtwork || artwork.token === 0n || !!artwork.cardImage || !!artwork.cardError);
        clearTimeout(timeout);
        running = false;
      }
    }
    void poll();
    const interval = setInterval(poll, SWARM_POLL_MS);
    const visibility = () => { if (document.hidden) controller?.abort(); else void poll(); };
    document.addEventListener("visibilitychange",visibility);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange",visibility);
    };
  }, [
    fact.requestId,
    scope,
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
export const useSharedSwarmProgress = () => useContext(SharedProgress);
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
export function VerificationOverview({ separateFromMint = false, fallbacks = {} }: { separateFromMint?: boolean; fallbacks?: Record<string,ReactNode> }) {
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
          fallback={fallbacks[fact.requestId]}
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
  wallet?: string;
  embedded?: boolean;
  variant?: 'progress' | 'history';
  fallback?: ReactNode;
};
export function SwarmFeed(props: FeedProps) {
  const shared = useContext(SharedProgress);
  const {address} = useAccount();
  const snapshot = shared?.snapshots[props.fact.requestId];
  if ((!props.wallet || props.wallet.toLowerCase() === address?.toLowerCase()) && shared?.facts.some((f) => f.requestId === props.fact.requestId))
    return snapshot ? (
      <SwarmFeedView {...props} snapshot={snapshot} />
    ) : props.fallback || (
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
  const snapshot = useSwarmSnapshot(props.fact, props.onAttested, props.wallet);
  return <SwarmFeedView {...props} snapshot={snapshot} />;
}
function SwarmFeedView({
  fact, focus, onAttested, idPrefix = "swarm", compact = false,
  onNavigate, embedded = idPrefix === "popup", variant = 'progress', fallback, snapshot,
}: FeedProps & { snapshot: Snapshot }) {
  const {view,current,progress,message,wrongWallet,address,checked,retryProgress} = snapshot;
  const element = useRef<HTMLDetailsElement>(null);
  const [expanded,setExpanded] = useState(!compact);
  const notified = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (current && view?.event && notified.current !== fact.requestId) {
      notified.current = fact.requestId;
      onAttested();
    }
  }, [current,view?.event,fact.requestId,onAttested]);
  useEffect(() => {
    if (focus?.requestId === fact.requestId && element.current) {
      setExpanded(true);
      element.current.querySelector("summary")?.focus();
      element.current.scrollIntoView({block:"nearest"});
    }
  }, [focus]);
  let live:FactCheckSnapshot | null = null;
  let bindingError = "";
  try {
    live = swarmSnapshot({fact,wallet:address,view:current ? view : null}) as FactCheckSnapshot | null;
  } catch (error) {
    bindingError = error instanceof Error ? error.message : "Request details unavailable.";
  }
  const phase = verificationPhase({fact,wallet:address,progress,spec:view?.spec,event:current ? view?.event : null,hasFact:current ? view?.hasFact : null,requestConfirmed:current && view?.requestConfirmed === true});
  const list = progress ? agreedList(progress) : null;
  if (!live && fallback && !bindingError) return <>{fallback}{current && view?.chainError && <p role="status">Request details unavailable. <button onClick={retryProgress}>Retry progress</button></p>}</>;
  return <details ref={element} className="swarm-request" id={`${idPrefix}-${fact.requestId}`} open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>{fact.id} / {fact.name} <span className={`progress-summary-${phase.tone}`}>· {phase.title}</span></summary>
    <div onClick={event=>{const link=(event.target as Element).closest("a");if(link?.getAttribute("href")?.startsWith("#"))onNavigate?.();}}>
      {live ? <FactCheckView snapshot={live} embedded={embedded} variant={variant}/> : <p role="status">{bindingError || (message === WAITING ? "Checking this request against the Ethereum Registry..." : message)}</p>}
    </div>
    {wrongWallet && <p>Expected wallet: {shortWallet(wrongWallet)}</p>}
    {current && view?.stale && <p className="muted">{STALE}</p>}
    {phase.kind === "shared" && <p><a href={`#/request?trait=${fact.id}`} onClick={onNavigate}>Check eligibility and apply this shared result</a></p>}
    {phase.kind === "failed" && <p><a href={`#/request?trait=${fact.id}`} onClick={onNavigate}>Review and retry verification</a></p>}
    {progress?.members.some((member:any)=>member.ok === true && walletList(member.answer?.answer)) && <details className="progress-evidence">
      <summary>Shared-list answers</summary>
      {progress.members.map((member:any,index:number)=>member.ok === true && walletList(member.answer?.answer) ? <div key={index}>
        <strong>{member.tokenId == null ? "Identity not reported" : `IDMD ${member.tokenId}`}</strong>
        <ListAnswer list={member.answer.answer} agreed={list} wallet={address}/>
      </div> : null)}
    </details>}
    {address && idPrefix !== "oracle" && <p><a href={oracleRequestLink(address,{...fact,blockNumber:view?.identity?.blockNumber ?? fact.blockNumber})} onClick={onNavigate}>Open request ↗</a></p>}
    {live?.jobUrl && <p><a href={live.jobUrl} target="_blank" rel="noreferrer">View on the IMD explorer</a></p>}
    {(bindingError || message === "progress unavailable" || live?.cardError || current && !view?.requestConfirmed) && <button onClick={retryProgress}>Retry progress</button>}
    {current && view?.event && message !== "progress unavailable" && <button onClick={retryProgress}>Refresh result</button>}
    {current && !view?.event && checked === fact.requestId && <p className="muted">No Registry outcome found since launch.</p>}
  </details>;
}
