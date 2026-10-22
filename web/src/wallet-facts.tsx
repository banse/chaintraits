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
import { Status, num } from "./components";
import { useWalletSheet } from "./wallet";
import { openRequests } from "./claim";
import { SwarmFeed, SWARM_POLL_MS } from "./swarm";
import { oracleUuid } from "./oracle-progress.mjs";

const REQUESTS = "https://api.imd.fun/oracle/requests";
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
type Row = { id: number; name: string; community: boolean; proof: Proof };

// Attested time and explorer job of one oracle request; the API allows CORS.
function Attested({ oracleId }: { oracleId: string }) {
  const [record, setRecord] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${REQUESTS}/${encodeURIComponent(oracleId)}`, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(Error("unavailable"))))
      .then((body) => {
        if (body?.id !== oracleId) throw Error("mismatch");
        setRecord(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [oracleId]);
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
      </span>
    </>
  );
}

export function WalletFacts() {
  const site = useSite();
  const account = useAccount();
  const { open } = useWalletSheet();
  const [facts, setFacts] = useState<Facts | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
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
      const ids = [
        ...TRAITS.map((t) => t.id),
        ...site.specs.map((s) => s.id),
      ];
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
          const name =
            TRAITS.find((t) => t.id === id)?.name ||
            site.specs.find((s) => s.id === id)?.name ||
            `Fact ${id}`;
          const sworn = proof && !/^0x0+$/.test(proof[1]);
          return {
            id,
            name,
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
        setRows(list.sort((a, b) => a.id - b.id));
    })().catch((e) => {
      if (controller.signal.aborted) return;
      setRows(null);
      setError(explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]));
    });
    return () => controller.abort();
  }, [account.address, site.client, site.health, site.specs, tick]);
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
  return (
    <>
      <h1>Wallet Facts</h1>
      {!account.address ? (
        <section className="section wallet-facts">
          <p>Connect a wallet to see its requests.</p>
          <button className="primary" onClick={open}>
            Connect
          </button>
        </section>
      ) : (
        <>
          <section className="swarm-feed" aria-label="Swarm progress">
            <h2>Swarm progress</h2>
            <p className="muted">
              Live panel progress, not proof. Facts and card updates come from
              the Registry.
            </p>
            {!current ? (
              <Status error={!!error}>{error || "Reading your wallet…"}</Status>
            ) : requests.length ? (
              requests.map((fact) => (
                <SwarmFeed
                  key={fact.requestId}
                  fact={fact}
                  focus={null}
                  onAttested={() => setTick((v) => v + 1)}
                />
              ))
            ) : (
              <p>No open request for this wallet.</p>
            )}
          </section>
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
              <ul className="fact-history">
                {rows.map((row) => (
                  <li key={row.id} id={`held-${row.id}`}>
                    <strong>
                      {row.id} / {row.name}
                    </strong>
                    {row.proof.how === "direct" ? (
                      <span>
                        Direct ·{" "}
                        {row.proof.block !== null && row.proof.time !== null ? (
                          <>
                            frozen at the card's mint, block{" "}
                            {num(row.proof.block)} ·{" "}
                            <time
                              dateTime={new Date(
                                Number(row.proof.time) * 1000,
                              ).toISOString()}
                            >
                              {utc(row.proof.time)}
                            </time>
                          </>
                        ) : (
                          "read live; no card minted"
                        )}
                      </span>
                    ) : (
                      <>
                        <span>Panel-sworn</span>
                        <span>
                          Evidence window: blocks {num(row.proof.fromBlock)} →{" "}
                          {num(row.proof.toBlock)}
                        </span>
                        {row.proof.oracleId ? (
                          <Attested oracleId={row.proof.oracleId} />
                        ) : (
                          <span>Oracle request unavailable</span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
