import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { useSite } from "./context";
import {
  lookup,
  read,
  explain,
  scopedClient,
  contract,
  type WalletFacts as Facts,
} from "./chain";
import { TRAITS } from "./data";
import { Card, Mark, Status, num } from "./components";
import { useWalletSheet } from "./wallet";
import { openRequests } from "./claim";
import { useTransactions } from "./transactions";
import type { WatchedFact } from "./swarm";
import { SwarmFeed, SWARM_POLL_MS } from "./swarm";
import { HIVE_CELLS } from "./hive-layout";
import { registryEvents, HISTORY_WINDOW } from "./settlement";
import { requestHistory, feeKey, savedRequestFees, savedRequests } from "./request-history.mjs";
import "./request-history.css";
import { CardFactGuide } from "./card-fact-guide";

// The short line each claimed fact shows; a catalog rule unless named here.
const SHORT: Record<number, string> = { 601: "Accepted swarm jobs >= 3" };
type Group = "direct" | "curator" | "community";
type Row = {
  id: number;
  name: string;
  meaning: string;
  community: boolean;
  group: Group;
  kind: string;
};
const GROUPS: [Group, string][] = [
  ["direct", "Direct facts"],
  ["curator", "Sworn WhitelistCurator facts"],
  ["community", "Sworn Community facts"],
];

export function WalletFacts() {
  const site = useSite();
  const account = useAccount();
  const { open } = useWalletSheet();
  const journal = useTransactions();
  const [facts, setFacts] = useState<Facts | null>(null);
  // Rows belong to the wallet they were read for; another wallet's rows
  // never show while the connected wallet's history is read.
  const [history, setHistory] = useState<{
    owner: string;
    rows: Row[];
  } | null>(null);
  const rows =
    history && history.owner === account.address?.toLowerCase()
      ? history.rows
      : null;
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [family, setFamily] = useState<number>();
  useEffect(() => setFamily(undefined), [account.address]);
  const current =
    facts?.address.toLowerCase() === account.address?.toLowerCase()
      ? facts
      : null;
  const [shared, setShared] = useState<{
    wallet?: string;
    facts: WatchedFact[];
  }>({ facts: [] });
  const journalShared =
    journal.plan?.account.toLowerCase() === account.address?.toLowerCase()
      ? journal.steps
          .flatMap((step) => step.result?.facts || [])
          .filter(
            (fact) =>
              fact.id === 1201 ||
              site.specs.some((s) => s.id === fact.id && s.kind === 3),
          )
      : [];
  const savedShared: WatchedFact[] = [...new Map([
    ...savedRequests(sessionStorage, site.r.deployment.chainId, contract(site.r, "Registry").address, account.address || ""),
    ...journalShared,
  ].filter(fact => fact.id === 1201 || site.specs.some(s => s.id === fact.id && s.kind === 3))
    .map(fact => [fact.requestId, fact] as const)).values()];
  useEffect(() => {
    const refresh = () => setTick(n => n + 1);
    window.addEventListener("sworn-request-confirmed", refresh);
    return () => window.removeEventListener("sworn-request-confirmed", refresh);
  }, []);
  const savedSharedKey = savedShared
    .map((f) => `${f.id}:${f.requestId}`)
    .join(",");
  useEffect(() => {
    const controller = new AbortController();
    if (!account.address || !site.health || !savedShared.length) {
      setShared({ facts: [] });
      return;
    }
    const client = scopedClient(site.client, controller.signal);
    void Promise.all(
      savedShared.map(async (fact) =>
        (await read(client, site.r, "Registry", "sharedPending", [fact.id])) ===
        fact.requestId
          ? fact
          : null,
      ),
    )
      .then((values) => {
        if (!controller.signal.aborted)
          setShared({
            wallet: account.address,
            facts: values.filter((f): f is WatchedFact => !!f),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setShared({ facts: [] });
      });
    return () => controller.abort();
  }, [
    account.address,
    site.client,
    site.health,
    savedSharedKey,
    tick,
    site.readRetry,
  ]);
  const requests = [
    ...openRequests(current, account.address, site.specs),
    ...(shared.wallet === account.address ? shared.facts : []),
  ];
  const pendingKey = requests.map((f) => `${f.id}:${f.requestId}`).join(",");
  const scope = `${site.r.deployment.chainId}:${contract(site.r, "Registry").address}:${account.address || ""}`.toLowerCase();
  const [attempts, setAttempts] = useState<{scope: string; rows: any[]; fromBlock: string; error: string} | null>(null);
  useEffect(() => {
    const wallet = account.address;
    if (!wallet || !site.health) return;
    const controller = new AbortController();
    registryEvents(scopedClient(site.client, controller.signal), site.r,
      ["TraitRequested", "Verified", "SharedFactStored", "Missed", "NoVerdict", "Abandoned"], undefined, {window: HISTORY_WINDOW})
      .then(events => {
        if (controller.signal.aborted) return;
        const fees = savedRequestFees(sessionStorage);
        const rows = requestHistory(events, wallet, savedShared.map(f => f.requestId)).map(row => ({...row,
          fee: fees[feeKey(site.r.deployment.chainId, contract(site.r, "Registry").address, wallet, row.requestId)]}));
        setAttempts({scope, rows, fromBlock: String(events.fromBlock), error: ""});
      }).catch(() => {
        if (!controller.signal.aborted) setAttempts({scope, rows: [], fromBlock: "", error: "Recent request history could not be read. Existing facts are shown separately; this is not a failed verification."});
      });
    return () => controller.abort();
  }, [scope, site.client, site.health, site.readRetry, tick, pendingKey, savedSharedKey]);
  // Registry state only: the card's facts, its mint block and each verified
  // record. No event history is read, so no older blocks are ever needed.
  useEffect(() => {
    const wallet = account.address;
    setError("");
    if (!wallet || !site.health) return;
    const controller = new AbortController();
    const client = scopedClient(site.client, controller.signal);
    (async () => {
      const ids = [...TRAITS.map((t) => t.id), ...site.specs.map((s) => s.id)];
      const v = await lookup(client, site.r, site.health!, wallet, ids);
      if (controller.signal.aborted) return;
      setFacts(v);
      const held = [
        ...v.traits.map((id) => ({ id: Number(id), community: false })),
        ...v.verifiedSpecs
          .filter((id) => !v.traits.map(Number).includes(Number(id)))
          .map((id) => ({ id: Number(id), community: true })),
      ];
      const list: Row[] = held.map(({ id, community }) => {
        const trait = TRAITS.find((t) => t.id === id);
        const spec = site.specs.find((s) => s.id === id);
        const name = trait?.name || spec?.name || `Fact ${id}`;
        // The fact's short rule, or the line the Catalog shows for a spec.
        const meaning =
          SHORT[id] ??
          (trait
            ? trait.rule
            : spec
              ? `T${spec.kind} · threshold ${spec.threshold.toString()} · ${num(spec.fromBlock)} → ${num(spec.toBlock)}`
              : "Community spec; its rule could not be read.");
        return {
          id,
          name,
          meaning,
          community: community || id >= 10001,
          kind:
            trait?.class ||
            (spec?.kind === 3
              ? "shared"
              : spec?.kind === 5
                ? "panel"
                : "chain"),
          group: !trait
            ? ("community" as const)
            : trait.class === "direct"
              ? ("direct" as const)
              : ("curator" as const),
        };
      });
      if (!controller.signal.aborted)
        setHistory({
          owner: wallet.toLowerCase(),
          rows: list.sort((a, b) => a.id - b.id),
        });
    })().catch((e) => {
      if (controller.signal.aborted) return;
      setHistory(null);
      setError(explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]));
    });
    return () => controller.abort();
  }, [
    account.address,
    site.client,
    site.health,
    site.specs,
    tick,
    site.readRetry,
  ]);
  // A delivered request leaves pendingOf: re-read so the feed and the
  // history follow the Registry.
  useEffect(() => {
    if (!account.address || !site.health || !requests.length) return;
    const controller = new AbortController();
    const client = scopedClient(site.client, controller.signal);
    let running = false;
    const interval = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const now = await Promise.all(
          requests.map((f) =>
            read(
              client,
              site.r,
              "Registry",
              f.id === 1201 ||
                site.specs.some((s) => s.id === f.id && s.kind === 3)
                ? "sharedPending"
                : "pendingOf",
              f.id === 1201 ||
                site.specs.some((s) => s.id === f.id && s.kind === 3)
                ? [f.id]
                : [account.address, f.id],
            ),
          ),
        );
        if (now.some((rid, i) => rid !== requests[i].requestId))
          setTick((v) => v + 1);
      } catch {
        /* The chain status and its retry stay independent. */
      } finally {
        running = false;
      }
    }, SWARM_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [account.address, site.client, site.health, pendingKey]);
  // A community fact highlights with the hive cell it occupies on the card.
  const familyOf = (row: Row) =>
    row.community
      ? current && current.verifiedSpecs.indexOf(row.id) < 39
        ? HIVE_CELLS[current.verifiedSpecs.indexOf(row.id) % 13]?.family
        : undefined
      : Math.floor(row.id / 100);
  const availableFamilies = current
    ? [
        ...new Set([
          ...current.traits.map((id) => Math.floor(id / 100)),
          ...current.verifiedSpecs
            .slice(0, 39)
            .map((_, i) => HIVE_CELLS[i % 13].family),
        ]),
      ]
    : [];
  return (
    <>
      <h1>Wallet</h1>
      <p className="prose">
        Your wallet's Sworn record: every fact it holds and what each fact says.
      </p>
      {!account.address ? (
        <section className="section wallet-facts">
          <p>Connect a wallet to see its facts.</p>
          <button className="primary" onClick={open}>
            Connect
          </button>
        </section>
      ) : (
        <>
          <div className="wallet-record">
            {current && (
              <section
                className="mint-panel"
                aria-labelledby="wallet-card-title"
              >
                <div className="claim-copy">
                  <h2 id="wallet-card-title">
                    {current.token===0n?'Your wallet’s card preview':`Your Sworn card #${current.token.toString()}`}
                  </h2>
                  <p className="accent">
                    {current.token===0n?'No card minted · Wallet:':`Card #${current.token.toString()} · Original claimant:`}{" "}
                    {current.address}
                  </p>
                  <Status>{current.token===0n?'Your facts can be used without minting a card.':'already minted'}</Status>
                  <div className="inline-links"><a href="#/curator">Use your facts</a><a href="#/register">Mint Rule</a></div>
                </div>
                <aside className="wallet-card" aria-label="Your rendered card">
                  <Card
                    facts={current}
                    interactive
                    showCaption={false}
                    availableFamilies={availableFamilies}
                    activeFamily={family ?? 0}
                    onFamily={(n) =>
                      setFamily((old) => (old === n ? undefined : n))
                    }
                  />
                  {availableFamilies.length > 0 && (
                    <p className="muted">
                      Select a non-empty hive cell to highlight its claimed
                      facts. Select it again to clear.
                    </p>
                  )}
                  <CardFactGuide ids={current.verifiedSpecs} onFamily={setFamily}/>
                </aside>
              </section>
            )}
            <section
              className="section wallet-facts"
              aria-label="Claimed facts"
            >
              <h2>Claimed facts</h2>
              {error ? (
                <>
                  <Status error>{error}</Status>
                  <button onClick={() => setTick((v) => v + 1)}>
                    Retry wallet reads
                  </button>
                </>
              ) : !rows || !current ? (
                <Status>Reading your facts…</Status>
              ) : !rows.length ? (
                <p>No claimed fact for this wallet.</p>
              ) : (
                GROUPS.map(([group, title]) => {
                  const list = rows.filter((row) => row.group === group);
                  return (
                    list.length > 0 && (
                      <div className="fact-group" key={group}>
                        <h3 className="fact-group-title">{title}</h3>
                        <ul
                          className={`fact-history ${group === "direct" ? "direct-facts" : "sworn-facts"}`}
                          aria-label={title}
                        >
                          {list.map((row) => (
                            <li
                              key={row.id}
                              id={`held-${row.id}`}
                              className={
                                family && familyOf(row) === family
                                  ? "highlight"
                                  : ""
                              }
                            >
                              <strong>
                                {row.id} / {row.name}
                              </strong>
                              <span className="meaning">{row.meaning}</span>
                              {group !== "direct" && <Mark kind={row.kind} />}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  );
                })
              )}
            </section>
          </div>
          {requests.length > 0 && (
            <section className="section swarm-feed" aria-label="Swarm progress">
              <h2>Swarm progress</h2>
              <p className="muted">
                Live panel progress, not proof. Facts and card updates come from
                the Registry.
              </p>
              {requests.map((fact) => (
                <SwarmFeed
                  key={fact.requestId}
                  fact={fact}
                  focus={null}
                  idPrefix="wallet"
                  onAttested={() => setTick((n) => n + 1)}
                />
              ))}
            </section>
          )}
          <section className="section request-history" aria-label="Recent verification requests">
            <h2>Recent verification requests</h2>
            <p className="muted">A successful request receipt means the fee was paid. Only a Registry outcome confirms whether a fact was stored.</p>
            {attempts?.scope !== scope ? <Status>Reading recent requests…</Status> : attempts.error ? <Status error>{attempts.error}</Status> : attempts.rows.length === 0 ? <p>No requests found in the recent history window.</p> : (
              <ul className="request-history-list">
                {attempts.rows.map(row => {
                  const pending = requests.some(f => f.requestId.toLowerCase() === row.requestId.toLowerCase());
                  const name = TRAITS.find(t => t.id === row.traitId)?.name || site.specs.find(s => s.id === row.traitId)?.name || `Fact ${row.traitId}`;
                  return <li key={row.requestId}>
                    <h3>{row.traitId} / {name}</h3>
                    <p><strong>{pending && !row.terminal ? "Verification pending" : row.status}</strong></p>
                    <p>{pending && !row.terminal ? "The request is paid and awaiting a result. Do not submit it again; follow the progress above." : row.message}</p>
                    <p>{row.fee ? `Request fee: ${formatEther(BigInt(row.fee))} IMD, paid.` : "Request fee paid; the exact historic amount is unavailable in this browser."} Network gas is separate.</p>
                    <p className="request-id">Request ID: <code>{row.requestId}</code></p>
                    <a href={`${site.r.deployment.network.explorer}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer">View Ethereum request receipt</a>
                    {row.terminal && row.status !== "Stored" && <a className="request-next" href={`#/request?trait=${row.traitId}`}>Review and retry verification</a>}
                  </li>;
                })}
              </ul>
            )}
            <button onClick={() => setTick(n => n + 1)}>Refresh request status</button>
            {attempts?.scope === scope && attempts.fromBlock && <p className="muted">Recent Registry events since block {attempts.fromBlock}. Older requests may be outside this window.</p>}
          </section>
        </>
      )}
    </>
  );
}
