import { useEffect, useMemo, useState } from "react";
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
import { Status, num } from "./components";
import { useWalletSheet } from "./wallet";
import { openRequests } from "./claim";
import { SWARM_POLL_MS } from "./swarm";
import { oracleUuid } from "./oracle-progress.mjs";

import { attestedRecords } from "./attested-records.mjs";
const utc = (seconds: bigint | number) =>
  new Date(Number(seconds) * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ") + " UTC";
type Proof =
  | { how: "direct"; block: bigint | null; time: bigint | null }
  | {
      how: "panel";
      oracleId: string | null;
      fromBlock: bigint;
      toBlock: bigint;
    };
type Row = {
  id: number;
  name: string;
  meaning: string;
  community: boolean;
  proof: Proof;
};

// Each Wallet view owns a serial queue and bounded retry state.
function Attested({
  oracleId,
  reader,
}: {
  oracleId: string;
  reader: ReturnType<typeof attestedRecords>;
}) {
  const [record, setRecord] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setRecord(null);
    setFailed(false);
    reader
      .read(oracleId, { retry: retry > 0 })
      .then((body: any) => {
        if (active) setRecord(body);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [oracleId, reader, retry]);
  const job =
    typeof record?.jobId === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.jobId)
      ? record.jobId
      : null;
  return (
    <>
      <span className="break">
        Oracle request:{" "}
        {job ? (
          <a
            href={`https://explorer.imd.fun/jobs/${encodeURIComponent(job)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {oracleId}
          </a>
        ) : (
          oracleId
        )}
      </span>
      <span>
        Attested:{" "}
        {record?.attestedAt ? (
          <time dateTime={record.attestedAt}>
            {utc(Date.parse(record.attestedAt) / 1000)}
          </time>
        ) : failed ? (
          "time unavailable"
        ) : record ? (
          "not recorded"
        ) : (
          "reading…"
        )}
        {failed && (
          <>
            {" "}
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </>
        )}
      </span>
    </>
  );
}

export function WalletFacts() {
  const site = useSite();
  const account = useAccount();
  const { open } = useWalletSheet();
  const reader = useMemo(() => attestedRecords(), [account.address]);
  useEffect(() => () => reader.stop(), [reader]);
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
  const current =
    facts?.address.toLowerCase() === account.address?.toLowerCase()
      ? facts
      : null;
  const requests = openRequests(current, account.address, site.specs);
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
      let block: bigint | null = null,
        time: bigint | null = null;
      if (v.token !== 0n) {
        block = BigInt(
          await read(client, site.r, "Registry", "mintedAtBlock", [v.token]),
        );
        time = (await client.getBlock({ blockNumber: block })).timestamp;
      }
      const held = [
        ...v.traits.map((id) => ({ id: Number(id), community: false })),
        ...v.verifiedSpecs
          .filter((id) => !v.traits.map(Number).includes(Number(id)))
          .map((id) => ({ id: Number(id), community: true })),
      ];
      const list = await Promise.all(
        held.map(async ({ id, community }) => {
          const proof =
            v.verified[id] ??
            (id >= 601
              ? await read(client, site.r, "Registry", "verified", [wallet, id])
              : null);
          const trait = TRAITS.find((t) => t.id === id);
          const spec = site.specs.find((s) => s.id === id);
          const name = trait?.name || spec?.name || `Fact ${id}`;
          // The catalog rule, or the line the Catalog shows for a spec.
          const meaning = trait
            ? trait.rule
            : spec
              ? `T${spec.kind} · threshold ${spec.threshold.toString()} · ${num(spec.fromBlock)} → ${num(spec.toBlock)}`
              : "Community spec; its rule could not be read.";
          const sworn = proof && !/^0x0+$/.test(proof[1]);
          return {
            id,
            name,
            meaning,
            community: community || id >= 10001,
            proof: sworn
              ? {
                  how: "panel" as const,
                  oracleId: oracleUuid(proof[1]),
                  fromBlock: BigInt(proof[2]),
                  toBlock: BigInt(proof[3]),
                }
              : { how: "direct" as const, block, time },
          };
        }),
      );
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
            read(client, site.r, "Registry", "pendingOf", [
              account.address,
              f.id,
            ]),
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
  const direct = rows?.filter((row) => row.proof.how === "direct") || [];
  const sworn = rows?.filter((row) => row.proof.how === "panel") || [];
  const frozen = direct[0]?.proof.how === "direct" ? direct[0].proof : null;
  return (
    <>
      <h1>Wallet</h1>
      <p className="prose">
        Your wallet's Sworn record: every fact it holds, what each fact says,
        and how it was proven, with the oracle request behind every panel-sworn
        fact.
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
          <section className="section wallet-facts" aria-label="Claimed facts">
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
              <>
                {frozen && (
                  // Direct facts share one snapshot: it is stated once.
                  <p className="info direct-note">
                    Direct ·{" "}
                    {frozen.block !== null && frozen.time !== null ? (
                      <>
                        frozen at the card's mint, block {num(frozen.block)} ·{" "}
                        <time
                          dateTime={new Date(
                            Number(frozen.time) * 1000,
                          ).toISOString()}
                        >
                          {utc(frozen.time)}
                        </time>
                      </>
                    ) : (
                      "read live; no card minted"
                    )}
                  </p>
                )}
                {direct.length > 0 && (
                  <ul className="fact-history direct-facts" aria-label="Direct facts">
                    {direct.map((row) => (
                      <li key={row.id} id={`held-${row.id}`}>
                        <strong>
                          {row.id} / {row.name}
                        </strong>
                        <span className="meaning">{row.meaning}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {sworn.length > 0 && (
                  <ul
                    className="fact-history sworn-facts"
                    aria-label="Panel-sworn facts"
                  >
                    {sworn.map(
                      (row) =>
                        row.proof.how === "panel" && (
                          <li key={row.id} id={`held-${row.id}`}>
                            <strong>
                              {row.id} / {row.name}
                            </strong>
                            <div className="proof-lines">
                              <span className="meaning">{row.meaning}</span>
                              <span>Panel-sworn</span>
                              <span>
                                Evidence window: blocks{" "}
                                {num(row.proof.fromBlock)} →{" "}
                                {num(row.proof.toBlock)}
                              </span>
                              {row.proof.oracleId ? (
                                <Attested
                                  key={row.proof.oracleId}
                                  oracleId={row.proof.oracleId}
                                  reader={reader}
                                />
                              ) : (
                                <span>Oracle request unavailable</span>
                              )}
                            </div>
                          </li>
                        ),
                    )}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
