import { useCallback, useEffect, useRef, useState } from "react";
import { useSite } from "../context";
import { contract, read, scopedClient } from "../chain";
import { launchBlock, latestBlock } from "../settlement";
import { oracleProgressReader, answerText } from "../oracle-progress.mjs";
import { decodeMetadata } from "../pure.mjs";
import { TRAITS } from "../data";
import {
  bindProgress,
  discoverRequests,
  liveSnapshot,
  matchedOutcome,
} from "./live-model.mjs";
import {
  boundedRange,
  HISTORY_BLOCKS,
  visiblePolling,
} from "./live-polling.mjs";
import type { FactCheckEvent, FactCheckSnapshot } from "./types";

export type LiveRequest = {
  requestId: string;
  traitId: number;
  transactionHash: string;
  blockNumber: bigint;
  origin: any;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Read unavailable";
const eventNames = [
  "Verified",
  "SharedFactStored",
  "Missed",
  "NoVerdict",
  "Abandoned",
];

export function useRequestHistory(wallet: string) {
  const { r, client } = useSite();
  const [state, setState] = useState<{
    wallet: string;
    rows: LiveRequest[];
    loading: boolean;
    error: string;
    from?: bigint;
    to?: bigint;
    first?: bigint;
  }>({ wallet: "", rows: [], loading: false, error: "" });
  const current = useRef(state);
  current.current = state;
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const scan = useCallback(
    async (older = false) => {
      if (!wallet || document.hidden) return;
      abort.current?.abort();
      const control = new AbortController();
      abort.current = control;
      const id = ++generation.current;
      const previous =
        current.current.wallet === wallet ? current.current : null;
      setState((previous) => ({
        ...previous,
        wallet,
        loading: true,
        error: "",
      }));
      const signal = AbortSignal.any([
        control.signal,
        AbortSignal.timeout(20000),
      ]);
      try {
        const c = scopedClient(client, signal);
        if ((await c.getChainId()) !== 1 || r.deployment.chainId !== 1)
          throw Error("This page requires Ethereum mainnet reads.");
        const [first, head] = await Promise.all([
          launchBlock(),
          latestBlock(c),
        ]);
        const range = boundedRange(
          head,
          first,
          older ? previous?.from : undefined,
        );
        if (!range) {
          if (id === generation.current && !signal.aborted)
            setState((s) => ({ ...s, loading: false, first }));
          return;
        }
        const logs = await c.getLogs({
          address: contract(r, "Registry").address,
          event: r.abis.Registry.find(
            (e: any) => e.type === "event" && e.name === "TraitRequested",
          ),
          args: { claimant: wallet },
          ...range,
        });
        const rows = discoverRequests(
          [...(previous?.rows.map((row) => row.origin) || []), ...logs],
          wallet,
          contract(r, "Registry").address,
        ) as LiveRequest[];
        if (id === generation.current && !signal.aborted)
          setState({
            wallet,
            rows,
            loading: false,
            error: "",
            from:
              previous?.from !== undefined && previous.from < range.fromBlock
                ? previous.from
                : range.fromBlock,
            to: head,
            first,
          });
      } catch (error) {
        if (id === generation.current && !control.signal.aborted)
          setState((s) => ({ ...s, loading: false, error: message(error) }));
      }
    },
    [wallet, client, r],
  );
  useEffect(() => {
    setState({ wallet, rows: [], loading: false, error: "" });
    current.current = { wallet, rows: [], loading: false, error: "" };
    void scan();
    const visibility = () => {
      if (document.hidden) {
        generation.current++;
        abort.current?.abort();
        setState((s) => ({ ...s, loading: false }));
      } else if (!current.current.rows.length) void scan();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      generation.current++;
      abort.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [wallet, scan]);
  return {
    ...(state.wallet === wallet
      ? state
      : { wallet, rows: [], loading: false, error: "" }),
    refresh: () => scan(),
    older: () => scan(true),
  };
}

type RequestCache = {
  key: string;
  identity?: any;
  terminal?: any;
  progress?: any;
  hasFact?: boolean | null;
  token?: bigint | null;
  cardImage?: string;
  cardError?: string;
  through?: bigint;
  events: Map<string, FactCheckEvent>;
  complete?: boolean;
};

export function useLiveRequest(
  wallet: string,
  ensName: string | undefined,
  row: LiveRequest | undefined,
) {
  const { r, client, readRetry } = useSite();
  const [snapshot, setSnapshot] = useState<FactCheckSnapshot | null>(null);
  const [error, setError] = useState("");
  const [historyGap, setHistoryGap] = useState(false);
  const [retry, setRetry] = useState(0);
  const cache = useRef<RequestCache>({ key: "", events: new Map() });
  const cacheSource = useRef({ client, r });
  const key = `${wallet}:${row?.requestId || ""}`.toLowerCase();
  useEffect(() => {
    if (!wallet || !row) {
      setSnapshot(null);
      setError("");
      return;
    }
    if (
      cache.current.key !== key ||
      cacheSource.current.client !== client ||
      cacheSource.current.r !== r
    ) {
      cache.current = { key, events: new Map() };
      setSnapshot(null);
    }
    cacheSource.current = { client, r };
    const state = cache.current;
    state.complete = false;
    setError("");
    setHistoryGap(false);
    const loadProgress = oracleProgressReader();
    let allowOlderWindow = true;
    const addEvent = (event: FactCheckEvent) => {
      if (!state.events.has(event.id)) state.events.set(event.id, event);
    };
    const request = row;
    const stop = visiblePolling({
      document,
      load: async (abort: AbortSignal, current: () => boolean) => {
        if (state.complete) return;
        const signal = AbortSignal.any([abort, AbortSignal.timeout(20000)]);
        const c = scopedClient(client, signal);
        let apiError = "",
          chainError = "";
        try {
          if (!state.identity) {
            if (r.deployment.chainId !== 1 || (await c.getChainId()) !== 1)
              throw Error("The RPC is not Ethereum mainnet.");
            const registry = contract(r, "Registry").address;
            if (
              !request.origin ||
              request.origin.address.toLowerCase() !== registry.toLowerCase() ||
              request.origin.args.claimant.toLowerCase() !==
                wallet.toLowerCase()
            )
              throw Error(
                "Request does not belong to this wallet and Registry.",
              );
            const [block, pending, spec, code] = await Promise.all([
              c.getBlock({ blockNumber: request.blockNumber }),
              read(c, r, "Registry", "pendingRequest", [request.requestId]),
              read(c, r, "Registry", "specOf", [request.traitId]),
              c.getCode({ address: registry }),
            ]);
            if (!code || code === "0x")
              throw Error("No Registry contract was found on this network.");
            if (
              pending[2] !== 0n &&
              (String(pending[0]).toLowerCase() !== wallet.toLowerCase() ||
                Number(pending[1]) !== request.traitId ||
                pending[3].toLowerCase() !==
                  request.origin.args.questionHash.toLowerCase())
            )
              throw Error(
                "Pending request does not match its originating Registry event.",
              );
            const trait = TRAITS.find((t) => t.id === request.traitId);
            state.identity = {
              registry,
              chainId: 1,
              requestId: request.requestId,
              wallet,
              ensName,
              claimant: wallet,
              questionHash: request.origin.args.questionHash,
              requestedAt: block.timestamp,
              blockNumber: request.blockNumber,
              transactionHash: request.transactionHash,
              origin: request.origin,
              factId: request.traitId,
              factName: trait?.name || spec.name || `Fact ${request.traitId}`,
              shortQuestion:
                request.traitId === 601
                  ? "Did this wallet complete at least 3 accepted IMD swarm jobs while holding an IDMD seat?"
                  : trait?.rule ||
                    spec.name ||
                    `Check fact ${request.traitId} for this wallet.`,
              spec,
              definitions: JSON.stringify(
                {
                  registry,
                  questionHash: request.origin.args.questionHash,
                  rule: trait?.rule,
                  spec,
                },
                (_, value) =>
                  typeof value === "bigint" ? value.toString() : value,
                2,
              ),
              evidenceWindow:
                trait?.window || `Blocks ${spec.fromBlock}–${spec.toBlock}`,
            };
            addEvent({
              id: `request:${request.requestId}`,
              time: new Date(Number(block.timestamp) * 1000).toISOString(),
              source: "Ethereum · TraitRequested",
              title: "Request confirmed",
              detail: `Fact ${request.traitId} · block ${request.blockNumber}`,
              href: `https://etherscan.io/tx/${request.transactionHash}`,
            });
          }
          const identity = state.identity;
          identity.ensName = ensName;
          if (!state.terminal) {
            const head = await latestBlock(c);
            const start =
              state.through === undefined
                ? request.blockNumber
                : state.through + 1n;
            const behind = start + HISTORY_BLOCKS - 1n < head;
            if (!behind || allowOlderWindow) {
              // At most one 7,200-block status window per explicit historical step.
              const fromBlock =
                state.through === undefined
                  ? start
                  : start - 12n > request.blockNumber
                    ? start - 12n
                    : request.blockNumber;
              const toBlock =
                fromBlock + HISTORY_BLOCKS - 1n < head
                  ? fromBlock + HISTORY_BLOCKS - 1n
                  : head;
              const logs = await c.getLogs({
                address: identity.registry,
                events: r.abis.Registry.filter(
                  (e: any) => e.type === "event" && eventNames.includes(e.name),
                ),
                fromBlock,
                toBlock,
              });
              const ordered = logs.sort((a: any, b: any) =>
                a.blockNumber === b.blockNumber
                  ? Number(a.logIndex) - Number(b.logIndex)
                  : a.blockNumber < b.blockNumber
                    ? -1
                    : 1,
              );
              state.terminal = ordered
                .map((event: any) => matchedOutcome(event, identity))
                .find(Boolean);
              state.through = toBlock;
              allowOlderWindow = false;
            }
            if (current())
              setHistoryGap(
                !state.terminal &&
                  state.through !== undefined &&
                  state.through + 1n < head,
              );
            if (state.terminal) {
              const event = state.terminal;
              if (event.eventName === "Verified")
                identity.oracleRequestId = event.args.oracleRequestId;
              addEvent({
                id: `registry:${event.transactionHash}:${event.logIndex}`,
                source: `Ethereum · ${event.eventName}`,
                title:
                  event.eventName === "Verified"
                    ? "Registry stored this wallet fact"
                    : event.eventName === "Missed" &&
                        Number(event.args.reason) === 8
                      ? "Registry confirmed a negative answer"
                      : `Registry outcome: ${event.eventName}`,
                detail: `Block ${event.blockNumber}`,
                href: `https://etherscan.io/tx/${event.transactionHash}`,
              });
            }
          }
          if (state.terminal) {
            if (
              state.hasFact !== true &&
              state.terminal.eventName === "Verified"
            )
              state.hasFact = await read(c, r, "Registry", "hasTrait", [
                wallet,
                request.traitId,
              ]);
            if (state.token == null)
              state.token = await read(c, r, "Registry", "tokenOf", [wallet]);
            if (state.token !== 0n && !state.cardImage) {
              try {
                const uri = await read(c, r, "Registry", "tokenURI", [
                  state.token,
                ]);
                state.cardImage = decodeMetadata(uri).data.image;
                state.cardError = undefined;
              } catch (error) {
                state.cardError = message(error);
              }
            }
          }
        } catch (error) {
          chainError = message(error);
        }
        if (!current() || abort.aborted) return;
        if (!state.identity) {
          setError(chainError || "Unable to read the request.");
          return;
        }
        try {
          const progress = bindProgress(
            await loadProgress(state.identity, signal),
            state.identity,
          );
          if (!current() || abort.aborted) return;
          state.progress = progress;
          if (progress) {
            // Keep validated immutable request text through a progress outage.
            // Live agent answers remain unavailable until a fresh read succeeds.
            state.identity.oracleQuestion = progress.question;
            state.identity.oracleDefinitions = progress.definitions;
            state.identity.oracleWindow = progress.window;
            state.identity.oracleEvidence = progress.evidence;
            const observed = new Date().toISOString();
            addEvent({
              id: `oracle:${progress.id}`,
              time: observed,
              source: "Swarm API · observed",
              title: "Matching oracle request found",
              detail: `${progress.id} · ${progress.panelSize} agents · quorum ${progress.quorum}`,
            });
            for (const [index, member] of progress.members.entries())
              if (member.ok === true || member.ok === false)
                addEvent({
                  id: `answer:${progress.id}:${index}:${member.ok}:${answerText(member.answer?.answer)}`,
                  time: observed,
                  source: "Swarm API · observed",
                  title:
                    member.tokenId != null
                      ? `Identity #${member.tokenId} ${member.ok ? "answered" : "could not answer"}`
                      : "Agent answer observed · identity unavailable",
                  detail: member.ok
                    ? answerText(member.answer?.answer)
                    : "The agent did not return a usable answer.",
                });
            if (progress.status === "attested" || progress.attestedAt)
              addEvent({
                id: `attested:${progress.id}`,
                time: progress.attestedAt || observed,
                source: "Swarm API",
                title: "Panel result available",
                detail: "Registry acceptance is checked separately.",
              });
          }
        } catch (error) {
          apiError = message(error);
        }
        if (!current() || abort.aborted) return;
        const next = liveSnapshot({
          identity: state.identity,
          progress: apiError ? null : state.progress,
          terminal: state.terminal,
          hasFact: state.hasFact,
          token: state.token,
          cardImage: state.cardImage,
          cardError: state.cardError,
          apiError,
          chainError,
          events: [...state.events.values()],
        }) as FactCheckSnapshot;
        // A source gap is visible; absent logs never become a negative answer.
        if (state.through !== undefined && !state.terminal)
          next.notice = [
            next.notice,
            `Registry outcomes checked through block ${state.through.toLocaleString("en-US")}.`,
          ]
            .filter(Boolean)
            .join(" ");
        setSnapshot(next);
        setError("");
        state.complete =
          !!state.terminal &&
          !chainError &&
          !apiError &&
          (next.phase === "saved" ||
            next.phase === "failed" ||
            next.phase === "negative") &&
          (state.token === 0n || !!state.cardImage);
      },
    });
    return stop;
  }, [key, client, r, retry, readRetry, ensName]);
  const currentSnapshot =
    snapshot?.wallet.toLowerCase() === wallet.toLowerCase() &&
    snapshot?.requestId === row?.requestId
      ? snapshot
      : null;
  return {
    snapshot: currentSnapshot,
    error,
    historyGap,
    retry: () => setRetry((v) => v + 1),
  };
}
