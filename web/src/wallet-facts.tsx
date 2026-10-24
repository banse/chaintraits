import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useSite } from "./context";
import {
  lookup,
  read,
  explain,
  scopedClient,
  type WalletFacts as Facts,
} from "./chain";
import { TRAITS } from "./data";
import { Card, Status, num } from "./components";
import { useWalletSheet } from "./wallet";
import { openRequests } from "./claim";
import { useTransactions } from "./transactions";
import type { WatchedFact } from "./swarm";
import { SwarmFeed, SWARM_POLL_MS } from "./swarm";
import { FAMILIES } from "./data";
import { HIVE_CELLS } from "./hive-layout";

// The short line each claimed fact shows; a catalog rule unless named here.
const SHORT: Record<number, string> = { 601: "Accepted swarm jobs >= 3" };
type Group = "direct" | "curator" | "community";
type Row = {
  id: number;
  name: string;
  meaning: string;
  community: boolean;
  group: Group;
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
  const savedShared =
    journal.plan?.account.toLowerCase() === account.address?.toLowerCase()
      ? journal.steps
          .flatMap((step) => step.result?.facts || [])
          .filter(
            (fact) =>
              fact.id === 1201 ||
              site.specs.some((s) => s.id === fact.id && s.kind === 3),
          )
      : [];
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
          <div
            className={
              current && current.token !== 0n
                ? "wallet-record with-card"
                : "wallet-record"
            }
          >
            {current && current.token !== 0n && (
              <aside className="wallet-card" aria-label="Your rendered card">
                <Card
                  facts={current}
                  interactive
                  availableFamilies={[
                    ...new Set([
                      ...current.traits.map((id) => Math.floor(id / 100)),
                      ...current.verifiedSpecs
                        .slice(0, 39)
                        .map((_, i) => HIVE_CELLS[i % 13].family),
                    ]),
                  ]}
                  activeFamily={family ?? 0}
                  onFamily={(n) =>
                    setFamily((old) => (old === n ? undefined : n))
                  }
                />
                <p className="muted">
                  Select a non-empty hive cell to highlight its claimed facts.
                  Select it again to clear.
                </p>
                <Status>
                  {family
                    ? `${FAMILIES[family - 1]} family selected.`
                    : "All claimed facts shown."}
                </Status>
              </aside>
            )}
            <section
              className="section wallet-facts"
              aria-label="Claimed facts"
            >
              <h2>Claimed facts</h2>
              <p className="muted">
                Every fact this wallet holds, read from Registry state.
                {current && current.token !== 0n
                  ? ` Card #${current.token}.`
                  : ""}
              </p>
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
                // Every group uses the direct facts' two-column form.
                GROUPS.map(([group, title]) => {
                  const list = rows.filter((row) => row.group === group);
                  return (
                    list.length > 0 && (
                      <div className="fact-group" key={group}>
                        <h3 className="fact-group-title">{title}</h3>
                        <ul
                          className="fact-history direct-facts"
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
        </>
      )}
    </>
  );
}
