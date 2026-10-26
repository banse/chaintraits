import { useCallback, useEffect, useRef, useState } from "react";
import { useSite } from "../context";
import { contract, read, scopedClient } from "../chain";
import { TRAITS } from "../data";
import { launchBlock, latestBlock } from "../settlement";
import { decodeMetadata } from "../pure.mjs";
import { oracleProgressReader, oracleUuid } from "../oracle-progress.mjs";
import { bindProgress, liveSnapshot } from "./live-model.mjs";
import { boundedRange, HISTORY_BLOCKS } from "./live-polling.mjs";
import {
  decodeDirectFacts,
  factHistoryRows,
  mergeFactHistory,
  mergeHistoryCoverage,
  updateHistory,
} from "./history-model.mjs";
import type { FactCheckSnapshot } from "./types";

export type FactHistoryRow = {
  key: string;
  kind: "verified" | "direct";
  factId: number;
  factName: string;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  requestId?: string;
  oracleRequestId?: string;
  terminal: any;
  tokenId?: bigint;
  directFacts?: { id: number; name: string }[];
};
export type FactHistoryCoverage = {
  first?: bigint;
  from?: bigint;
  to?: bigint;
  complete: boolean;
};
type HistoryState = {
  scope: string;
  rows: FactHistoryRow[];
  loading: boolean;
  backgroundLoading: boolean;
  error: string;
  coverage: FactHistoryCoverage;
};
const empty = (scope: string): HistoryState => ({
  scope,
  rows: [],
  loading: false,
  backgroundLoading: false,
  error: "",
  coverage: { complete: false },
});
const reason = (error: unknown) =>
  error instanceof Error ? error.message : "The read is unavailable.";

/** Append one bounded page at a time, yielding between background reads. */
export function useFactHistory(wallet: string) {
  const { r, client, readRetry } = useSite();
  const scope =
    `${r.deployment.chainId}:${contract(r, "Registry").address}:${wallet}`.toLowerCase();
  const [state, setState] = useState<HistoryState>(() => empty(scope));
  const stateRef = useRef(state);
  stateRef.current = state;
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    resume = useRef<boolean | null>(null),
    nextPage = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = useCallback(
    (patch: Partial<HistoryState>) => {
      stateRef.current = updateHistory(stateRef.current, scope, patch);
      setState((previous) => updateHistory(previous, scope, patch));
    },
    [scope],
  );
  const scan = useCallback(
    async (older = false) => {
      clearTimeout(nextPage.current);
      if (!wallet) return;
      if (document.hidden) {
        resume.current = older;
        return;
      }
      controller.current?.abort();
      const control = new AbortController();
      controller.current = control;
      const version = ++generation.current;
      resume.current = older;
      const current = () =>
        version === generation.current && !control.signal.aborted;
      const signal = AbortSignal.any([
        control.signal,
        AbortSignal.timeout(45000),
      ]);
      const c = scopedClient(client, signal);
      const previous =
        stateRef.current.scope === scope ? stateRef.current : empty(scope);
      publish({ loading: !older, backgroundLoading: older, error: "" });
      let rows = previous.rows;
      let coverage = previous.coverage;
      try {
        if (r.deployment.chainId !== 1 || (await c.getChainId()) !== 1)
          throw Error("Fact history requires Ethereum mainnet.");
        const registry = contract(r, "Registry").address;
        const [first, head, code] = await Promise.all([
          launchBlock(),
          older && previous.coverage.to !== undefined
            ? Promise.resolve(previous.coverage.to)
            : latestBlock(c),
          c.getCode({ address: registry }),
        ]);
        if (!code || code === "0x")
          throw Error("The Registry contract is unavailable on this network.");
        if (head < first)
          throw Error(
            "The RPC head predates the Registry deployment. Retry the chain read.",
          );
        const before = older ? previous.coverage.from : undefined;
        const frozen: Record<string, bigint> = {};
        const range = boundedRange(head, first, before);
        if (!range) {
          coverage = { first, from: first, to: head, complete: true };
        } else {
          const pages = await Promise.all(
            ["Verified", "CardMinted"].map((name) =>
              c.getLogs({
                address: registry,
                event: r.abis.Registry.find(
                  (event: any) => event.type === "event" && event.name === name,
                ),
                args: { claimant: wallet },
                ...range,
              }),
            ),
          );
          const events = pages.flat();
          await Promise.all(
            events
              .filter((event: any) => event.eventName === "CardMinted")
              .map(async (event: any) => {
                const key = String(event.args.tokenId);
                frozen[key] = await read(c, r, "Registry", "frozenDirect", [
                  event.args.tokenId,
                ]);
              }),
          );
          const found = factHistoryRows(events, {
            wallet,
            registry,
            traits: TRAITS,
            frozen,
          }) as FactHistoryRow[];
          rows = mergeFactHistory(rows, found);
          coverage = mergeHistoryCoverage(coverage, {
            first,
            from: range.fromBlock,
            to: range.toBlock,
          });
        }
        if (current()) {
          publish({ rows, coverage, loading: false, backgroundLoading: false });
          resume.current = coverage.complete ? null : true;
          if (!coverage.complete)
            nextPage.current = setTimeout(() => void scan(true), 1800);
        }
      } catch (error) {
        if (current()) {
          publish({
            loading: false,
            backgroundLoading: false,
            error: reason(error),
          });
          resume.current = null;
        }
      }
    },
    [wallet, scope, client, r, publish],
  );
  useEffect(() => {
    clearTimeout(nextPage.current);
    controller.current?.abort();
    generation.current++;
    const next = empty(scope);
    stateRef.current = next;
    setState(next);
    void scan();
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(nextPage.current);
        generation.current++;
        controller.current?.abort();
        publish({ loading: false, backgroundLoading: false });
      } else if (resume.current !== null) void scan(resume.current);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(nextPage.current);
      generation.current++;
      controller.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [scope, scan, publish, readRetry]);
  const visible = state.scope === scope ? state : empty(scope);
  return {
    rows: visible.rows,
    loading: visible.loading,
    backgroundLoading: visible.backgroundLoading,
    error: visible.error,
    coverage: visible.coverage,
    refresh: () => scan(false),
  };
}

/** A historical success is loaded once; it never replays pending/oracle phases. */
export function useHistoryFact(
  wallet: string,
  ensName: string | undefined,
  row: FactHistoryRow | undefined,
) {
  const { r, client, readRetry } = useSite();
  const key = `${wallet}:${row?.key || ""}`.toLowerCase();
  const [state, setState] = useState<{
    key: string;
    snapshot: FactCheckSnapshot | null;
    loading: boolean;
    error: string;
  }>({ key: "", snapshot: null, loading: false, error: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!row || !wallet) {
      setState({ key, snapshot: null, loading: false, error: "" });
      return;
    }
    let active = true,
      control: AbortController | undefined,
      version = 0,
      running = false,
      done = false;
    const current = (v: number) =>
      active && v === version && !control?.signal.aborted;
    async function load() {
      if (document.hidden || running || done) return;
      running = true;
      const v = ++version;
      control = new AbortController();
      const abort = control.signal;
      const signal = AbortSignal.any([abort, AbortSignal.timeout(20000)]);
      const c = scopedClient(client, signal);
      const historyRow = row!;
      setState({ key, snapshot: null, loading: true, error: "" });
      let snapshot: FactCheckSnapshot | null = null;
      try {
        const registry = contract(r, "Registry").address;
        if (r.deployment.chainId !== 1 || (await c.getChainId()) !== 1)
          throw Error("Fact history requires Ethereum mainnet.");
        const event = historyRow.terminal;
        if (
          event.removed ||
          event.address.toLowerCase() !== registry.toLowerCase() ||
          event.args.claimant.toLowerCase() !== wallet.toLowerCase()
        )
          throw Error(
            "This saved event belongs to a different wallet or Registry.",
          );
        const [token, hasFact, block] = await Promise.all([
          read(c, r, "Registry", "tokenOf", [wallet]),
          historyRow.kind === "verified"
            ? read(c, r, "Registry", "hasTrait", [wallet, historyRow.factId])
            : Promise.resolve(true),
          c.getBlock({ blockNumber: historyRow.blockNumber }),
        ]);
        if (hasFact !== true)
          throw Error(
            "The Registry does not currently confirm this saved fact for the wallet. Refresh the history and chain reads.",
          );
        let directFacts = historyRow.directFacts;
        if (historyRow.kind === "direct") {
          if (
            event.eventName !== "CardMinted" ||
            token === 0n ||
            token !== historyRow.tokenId
          )
            throw Error(
              "The saved direct snapshot does not match this wallet’s card.",
            );
          directFacts = decodeDirectFacts(
            await read(c, r, "Registry", "frozenDirect", [token]),
            TRAITS,
          );
          if (!directFacts?.length)
            throw Error("This card has no frozen direct facts.");
        } else if (
          event.eventName !== "Verified" ||
          Number(event.args.traitId) !== historyRow.factId
        )
          throw Error(
            "The saved fact event does not match this history entry.",
          );
        let cardImage: string | undefined, cardError: string | undefined;
        if (token !== 0n)
          try {
            cardImage = decodeMetadata(
              await read(c, r, "Registry", "tokenURI", [token]),
            ).data.image;
          } catch (error) {
            cardError = reason(error);
          }
        const trait = TRAITS.find((item) => item.id === historyRow.factId);
        const direct = historyRow.kind === "direct";
        const question = direct
          ? "Direct facts recorded when this card was minted."
          : "This fact was confirmed by the Registry. Its original oracle question has not been loaded.";
        const shortQuestion =
          historyRow.factId === 601
            ? "Did this wallet complete at least 3 accepted IMD swarm jobs while holding an IDMD seat?"
            : direct
              ? question
              : trait?.rule || historyRow.factName;
        snapshot = {
          key: `history:${key}`,
          mode: "live",
          evidenceKind: direct ? "direct" : "oracle",
          phase: "saved",
          wallet,
          ensName,
          factId: historyRow.factId,
          factName: historyRow.factName,
          question,
          shortQuestion,
          panelSize: null,
          quorum: null,
          agents: [],
          quorumReached: false,
          result: true,
          registryStored: true,
          cardImage,
          cardless: token === 0n,
          cardLoading: false,
          cardError,
          requestId: historyRow.requestId,
          transactionHash: historyRow.transactionHash,
          evidenceWindow: `Recorded at Ethereum block ${historyRow.blockNumber.toLocaleString("en-US")}`,
          definitions: direct
            ? `Frozen together at card mint:\n${directFacts!.map((fact) => `${fact.id} · ${fact.name}`).join("\n")}`
            : `Registry ${registry}\nRequest ${historyRow.requestId}`,
          latestEvent: "✓ Registry confirmed this wallet fact.",
          events: [
            {
              id: historyRow.key,
              time: new Date(Number(block.timestamp) * 1000).toISOString(),
              source: direct ? "Ethereum · CardMinted" : "Ethereum · Verified",
              title: direct
                ? "Direct facts frozen together"
                : "Wallet fact saved",
              detail: `Block ${historyRow.blockNumber}`,
              href: `https://etherscan.io/tx/${historyRow.transactionHash}`,
            },
          ],
          notice: direct
            ? "These facts were frozen together at card mint. No oracle request was needed."
            : undefined,
        };
        if (!current(v)) return;
        // A confirmed fact and real card render never wait on the optional API.
        setState({ key, snapshot, loading: false, error: "" });
        if (direct || !oracleUuid(historyRow.oracleRequestId)) {
          done = true;
          return;
        }
        try {
          const enrichment = AbortSignal.any([
            abort,
            AbortSignal.timeout(8000),
          ]);
          const ec = scopedClient(client, enrichment);
          const first = await launchBlock();
          const fromBlock =
            historyRow.blockNumber - HISTORY_BLOCKS + 1n > first
              ? historyRow.blockNumber - HISTORY_BLOCKS + 1n
              : first;
          const requests = await ec.getLogs({
            address: registry,
            event: r.abis.Registry.find(
              (item: any) =>
                item.type === "event" && item.name === "TraitRequested",
            ),
            args: { traitId: historyRow.factId },
            fromBlock,
            toBlock: historyRow.blockNumber,
          });
          const origin = requests.find(
            (entry: any) =>
              entry.args.requestId.toLowerCase() ===
              historyRow.requestId?.toLowerCase(),
          );
          if (!origin)
            throw Error(
              "The original request is outside the bounded history window.",
            );
          const [spec, requestBlock] = await Promise.all([
            read(ec, r, "Registry", "specOf", [historyRow.factId]),
            ec.getBlock({ blockNumber: origin.blockNumber }),
          ]);
          const shared = Number(spec.kind) === 3;
          if (
            origin.args.claimant.toLowerCase() !== wallet.toLowerCase() &&
            !(shared && /^0x0+$/.test(origin.args.claimant))
          )
            throw Error(
              "The original oracle request belongs to another wallet.",
            );
          const identity = {
            registry,
            chainId: 1,
            requestId: historyRow.requestId,
            oracleRequestId: historyRow.oracleRequestId,
            wallet,
            claimant: origin.args.claimant,
            requestedAt: requestBlock.timestamp,
            questionHash: origin.args.questionHash,
            blockNumber: origin.blockNumber,
            spec,
            factId: historyRow.factId,
            factName: spec.name || historyRow.factName,
            ensName,
            shortQuestion,
          };
          const progress = bindProgress(
            await oracleProgressReader()(identity, enrichment),
            identity,
          );
          if (!progress)
            throw Error("Historical oracle details are unavailable.");
          const enriched = liveSnapshot({
            identity,
            progress,
            hasFact: true,
            token,
            cardImage,
            events: snapshot.events,
          }) as FactCheckSnapshot;
          // Verified is authority, including a wallet applying an already stored list.
          snapshot = {
            ...snapshot,
            question: enriched.question,
            shortQuestion: identity.shortQuestion,
            factName: identity.factName,
            answerKind: enriched.answerKind,
            panelSize: enriched.panelSize,
            quorum: enriched.quorum,
            agents: enriched.agents,
            matchingAnswers: enriched.matchingAnswers,
            jobUrl: enriched.jobUrl,
            definitions: enriched.definitions,
            evidenceWindow: enriched.evidenceWindow,
            notice: shared
              ? "This wallet applied a shared list that the Registry accepted. The list’s original oracle question is shown below."
              : undefined,
          };
        } catch (error) {
          snapshot = {
            ...snapshot,
            notice: `This wallet fact is confirmed. Historical oracle details are unavailable: ${reason(error)}`,
          };
        }
        if (current(v)) {
          setState({ key, snapshot, loading: false, error: "" });
          done = true;
        }
      } catch (error) {
        if (current(v))
          setState({ key, snapshot, loading: false, error: reason(error) });
      } finally {
        if (v === version) running = false;
      }
    }
    const visibility = () => {
      if (document.hidden) {
        version++;
        control?.abort();
        running = false;
      } else void load();
    };
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => {
      active = false;
      version++;
      control?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, wallet, ensName, client, r, retry, readRetry]);
  const visible =
    state.key === key
      ? state
      : { key, snapshot: null, loading: !!row, error: "" };
  return {
    snapshot: visible.snapshot,
    loading: visible.loading,
    error: visible.error,
    retry: () => setRetry((value) => value + 1),
  };
}
