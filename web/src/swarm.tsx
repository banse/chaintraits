import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount } from "wagmi";
import { useSite } from "./context";
import { contract, read } from "./chain";
import { registryEvents, FEED_WINDOW } from "./settlement";
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

import { registryOutcome, NO_FACT } from "./request-outcomes.mjs";

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
  const id = useId();
  const text = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const node = text.current!;
    const measure = () =>
      setLong(
        node.scrollHeight >
          parseFloat(getComputedStyle(node).lineHeight) * 2 + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [question]);
  return (
    <div className="swarm-question">
      <p
        id={id}
        ref={text}
        className={expanded ? "" : "swarm-question-preview"}
      >
        {question}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show full question"}
        </button>
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
export function SwarmFeed({
  fact,
  focus,
  onAttested,
  idPrefix = "swarm",
}: {
  fact: WatchedFact;
  focus: { requestId: string; tick: number } | null;
  onAttested: () => void;
  idPrefix?: string;
}) {
  const { client, r } = useSite();
  const { address } = useAccount();
  const element = useRef<HTMLDetailsElement>(null);
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
  // Reading back to the launch block happens only on "Check older blocks".
  const older = useRef<string | null>(null);
  // Kept across wallet connects and switches so a known explorer link stays.
  const load = useMemo(() => oracleProgressReader(), [fact.requestId]);
  useEffect(() => {
    if (focus?.requestId === fact.requestId && element.current) {
      element.current.open = true;
      element.current.querySelector("summary")?.focus();
      element.current.scrollIntoView({ block: "nearest" });
    }
  }, [focus]);
  useEffect(() => {
    let active = true,
      running = false;
    let pending: any =
      identity.current?.requestId === fact.requestId
        ? identity.current.pending
        : null;
    let attested = false;
    let terminal: any = null;
    let controller: AbortController;
    const consensusFor = (result: any) => {
      const a = agreement.current;
      if (!a || a.requestId !== fact.requestId) return null;
      if (result && result.id !== a.oracleId) return null;
      return a.text;
    };
    async function poll() {
      if (running) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const readOlder = older.current === fact.requestId;
        const events = terminal
          ? []
          : await registryEvents(
              client,
              r,
              pending
                ? ["Verified", "Missed", "NoVerdict", "Abandoned"]
                : [
                    "TraitRequested",
                    "Verified",
                    "Missed",
                    "NoVerdict",
                    "Abandoned",
                  ],
              fact.id,
              readOlder
                ? { fromBlock: pending?.blockNumber }
                : { window: FEED_WINDOW, fromBlock: pending?.blockNumber },
            );
        if (readOlder) older.current = null;
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
            // A request confirmed moments ago may be newer than an endpoint's
            // head: keep waiting. One older than the window offers a read back.
            const stale =
              !readOlder &&
              p[2] !== 0n &&
              Date.now() / 1000 - Number(p[2]) > TWO_HOURS;
            if (active)
              setView({
                outcome: null,
                consensus: consensusFor(null),
                address,
                requestId: fact.requestId,
                progress: null,
                message: stale ? STALE : WAITING,
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
          agreement.current = null;
          if (outcome.eventName === "Verified")
            pending.oracleRequestId = outcome.args.oracleRequestId;
          callback.current();
        }
        if (!active) return;
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
          outcome: registryOutcome(terminal),
          consensus: terminal ? null : consensusFor(result),
          spec: pending.spec,
          address,
          requestId: fact.requestId,
          progress: result,
          message: result ? "" : WAITING,
        });
        if (result && progressStatus(result) === "attested" && !attested) {
          attested = true;
          callback.current();
        }
      } catch (error) {
        if (active) {
          setView({
            outcome: registryOutcome(terminal),
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
          });
        }
      } finally {
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
  }, [fact.requestId, client, r, retry, load, address]);
  const counts = progress ? progressCounts(progress, view.spec) : null;
  const list = progress ? agreedList(progress) : null;
  const outcome = current ? view.outcome : null;
  const status = progress ? progressStatus(progress) : null;
  return (
    <details
      ref={element}
      className="swarm-request"
      id={`${idPrefix}-${fact.requestId}`}
      open
    >
      <summary>
        {fact.id} / {fact.name}
      </summary>
      <div
        className="swarm-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {progress ? (
          <>
            <p className={status === "failed" ? "danger" : "accent"}>
              {status}
            </p>
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
            <p>
              {counts!.answered} / {progress.panelSize} answers ·{" "}
              {counts!.count
                ? `${counts!.met} meet the rule / ${progress.quorum} needed`
                : counts!.boolean
                  ? `${counts!.trueAnswers} true / ${progress.quorum} needed`
                  : counts!.agreed
                    ? `${counts!.agreed} agree / ${progress.quorum} quorum`
                    : `no agreement yet / ${progress.quorum} quorum`}
            </p>
          </>
        ) : (
          <>
            <p>
              {message === WAITING && <LoadingIndicator />}
              {message}
            </p>
            {wrongWallet && <p>Expected wallet: {shortWallet(wrongWallet)}</p>}
          </>
        )}
        {current && view.consensus && <p>{view.consensus}</p>}
        {(outcome || status === "failed") && <p>{outcome || NO_FACT}</p>}
      </div>
      {progress && (
        <>
          {typeof progress.question === "string" && (
            <Question key={progress.question} question={progress.question} />
          )}
          <ol className="swarm-seats" aria-label="Panel seats">
            {Array.from({ length: progress.panelSize }, (_, i) => {
              const seat = progress.members[i];
              return (
                <li key={i}>
                  <strong>
                    Seat {i + 1}
                    {seat?.tokenId != null ? ` · #${seat.tokenId}` : ""}
                  </strong>
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
          {progress.failure && <p>{answerText(progress.failure)}</p>}
          {progress.attestedAt && (
            <p>
              Attested:{" "}
              <time dateTime={progress.attestedAt}>{progress.attestedAt}</time>
            </p>
          )}
        </>
      )}
      {message === "progress unavailable" && (
        <button onClick={() => setRetry((n) => n + 1)}>Retry progress</button>
      )}
      {message === STALE && (
        <button
          type="button"
          onClick={() => {
            older.current = fact.requestId;
            setRetry((n) => n + 1);
          }}
        >
          Check older blocks
        </button>
      )}
    </details>
  );
}
