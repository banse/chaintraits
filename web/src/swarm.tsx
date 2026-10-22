import { useEffect, useMemo, useRef, useState } from "react";
import { useSite } from "./context";
import { contract, read } from "./chain";
import { registryEvents } from "./settlement";
import {
  oracleProgressReader,
  progressCounts,
  progressStatus,
  answerText,
} from "./oracle-progress.mjs";

export const SWARM_POLL_MS = 5000;
export type WatchedFact = { requestId: string; id: number; name: string };
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
}: {
  fact: WatchedFact;
  focus: { requestId: string; tick: number } | null;
  onAttested: () => void;
}) {
  const { client, r } = useSite();
  const element = useRef<HTMLDetailsElement>(null);
  const callback = useRef(onAttested);
  callback.current = onAttested;
  const [progress, setProgress] = useState<any>(null);
  const [message, setMessage] = useState("Reading swarm progress…");
  const [retry, setRetry] = useState(0);
  const identity = useRef<{ requestId: string; pending: any } | null>(null);
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
    let controller: AbortController;
    async function poll() {
      if (running) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        if (!pending) {
          const p = await read(client, r, "Registry", "pendingRequest", [
            fact.requestId,
          ]);
          if (Number(p[1]) !== fact.id || p[2] === 0n)
            throw Error("Pending request unavailable.");
          const events = await registryEvents(
            client,
            r,
            ["TraitRequested"],
            fact.id,
          );
          const event = events.find(
            (e) =>
              e.args.requestId.toLowerCase() === fact.requestId.toLowerCase() &&
              e.args.claimant.toLowerCase() === p[0].toLowerCase(),
          );
          if (
            !event ||
            event.args.questionHash.toLowerCase() !== p[3].toLowerCase()
          )
            throw Error("Request event unavailable.");
          pending = {
            registry: contract(r, "Registry").address,
            chainId: r.deployment.chainId,
            requestedAt: p[2],
            questionHash: event.args.questionHash,
          };
          identity.current = { requestId: fact.requestId, pending };
        }
        if (!active) return;
        const result = await load(pending, controller.signal);
        if (!active) return;
        setProgress(result);
        setMessage(result ? "" : "Waiting for the matching swarm request.");
        if (result && progressStatus(result) === "attested" && !attested) {
          attested = true;
          callback.current();
        }
      } catch {
        if (active) {
          setProgress(null);
          setMessage("progress unavailable");
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
  }, [fact.requestId, client, r, retry, load]);
  const counts = progress ? progressCounts(progress) : null;
  return (
    <details
      ref={element}
      className="swarm-request"
      id={`swarm-${fact.requestId}`}
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
            <p
              className={
                progressStatus(progress) === "failed" ? "danger" : "accent"
              }
            >
              {progressStatus(progress)}
            </p>
            <p>
              {counts!.answered} / {progress.panelSize} answers ·{" "}
              {counts!.agreed ?? "unavailable"} agree / {progress.quorum} quorum
            </p>
          </>
        ) : (
          <p>{message}</p>
        )}
      </div>
      {progress && (
        <>
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
                    {seat?.ok === false
                      ? `Failed: ${answerText(seat.reason)}`
                      : seat?.ok === true
                        ? `Answer: ${answerText(seat.answer?.answer)} · Figure: ${answerText(seat.answer?.figure)}`
                        : "Awaiting answer"}
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
