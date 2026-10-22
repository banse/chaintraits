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
import { registryEvents } from "./settlement";
import {
  oracleProgressReader,
  progressCounts,
  progressStatus,
  answerText,
  WalletQuestionMismatch,
} from "./oracle-progress.mjs";

export const SWARM_POLL_MS = 5000;
export type WatchedFact = { requestId: string; id: number; name: string };
const WAITING = "Waiting for the swarm to pick up the request…";
const shortWallet = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
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
  const load = useMemo(() => oracleProgressReader(), [fact.requestId, address]);
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
    let controller: AbortController;
    async function poll() {
      if (running) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const events = pending?.oracleRequestId
          ? []
          : await registryEvents(
              client,
              r,
              pending ? ["Verified"] : ["TraitRequested", "Verified"],
              fact.id,
              pending?.blockNumber,
            );
        if (!pending) {
          const p = await read(client, r, "Registry", "pendingRequest", [
            fact.requestId,
          ]);
          const event = events.find(
            (e) =>
              e.eventName === "TraitRequested" &&
              e.args.requestId.toLowerCase() === fact.requestId.toLowerCase(),
          );
          if (!event) throw Error("Request event unavailable.");
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
          };
          identity.current = { requestId: fact.requestId, pending };
        }
        const verified = events.find(
          (e) =>
            e.eventName === "Verified" &&
            e.args.requestId.toLowerCase() === fact.requestId.toLowerCase(),
        );
        if (verified) pending.oracleRequestId = verified.args.oracleRequestId;
        if (!active) return;
        const result = await load(
          { ...pending, wallet: address },
          controller.signal,
        );
        if (!active) return;
        setView({
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
  const counts = progress ? progressCounts(progress) : null;
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
              {counts!.boolean
                ? `${counts!.trueAnswers} true / ${progress.quorum} needed`
                : counts!.agreed
                  ? `${counts!.agreed} agree / ${progress.quorum} quorum`
                  : `no agreement yet / ${progress.quorum} quorum`}
            </p>
            {status === "assessing" &&
              counts!.boolean &&
              (counts!.trueAnswers >= progress.quorum ? (
                <p>
                  Panel agreed: {counts!.trueAnswers} of {progress.quorum}{" "}
                  needed said true. Finishing: the oracle signs the answer and
                  delivers it to the Registry; the fact appears on your card
                  once the Registry stores it.
                </p>
              ) : counts!.falseAnswers >= progress.quorum ? (
                <p>Panel agreed: false. The fact is not proven.</p>
              ) : null)}
          </>
        ) : (
          <>
            <p>
              {message === WAITING && <LoadingIndicator />}
              {message}
            </p>
            {wrongWallet && <p>Wallet: {shortWallet(wrongWallet)}</p>}
          </>
        )}
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
    </details>
  );
}
