import { useEffect, useMemo, useState } from "react";
import type { WalletFacts } from "./chain";
import { read, scopedClient } from "./chain";
import { useSite } from "./context";
import { checkEligibility } from "./eligibility.mjs";
import { attestedRecords } from "./attested-records.mjs";
import { oracleUuid } from "./oracle-progress.mjs";

export const utc = (seconds: bigint | number) =>
  new Date(Number(seconds) * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ") + " UTC";
export const holdsFact = (facts: WalletFacts | null, id: number) =>
  !!facts && (facts.traits.includes(id) || facts.verifiedSpecs.includes(id));
export function ineligibleFact(
  facts: WalletFacts | null,
  id: number,
  check?: any,
) {
  if (!facts || holdsFact(facts, id)) return false;
  return (
    check?.state === "not-met" ||
    (id < 601 && !facts.traits.includes(id)) ||
    (!facts.joined && ((id >= 701 && id <= 1105) || id === 1201))
  );
}
export function IneligibleControl({
  count,
  shown,
  onChange,
}: {
  count: number;
  shown: boolean;
  onChange: () => void;
}) {
  if (count < 1) return null;
  return (
    <button
      type="button"
      className="eligibility-toggle"
      aria-pressed={shown}
      onClick={onChange}
    >
      {shown
        ? `Hide ineligible facts (${count} shown; 0 hidden)`
        : `Show ineligible facts (${count} hidden)`}
    </button>
  );
}
export function useAttestedReader(address?: string) {
  const reader = useMemo(() => attestedRecords(), [address]);
  useEffect(() => () => reader.stop(), [reader]);
  return reader;
}
export function MintedFact({
  facts,
  id,
  reader,
}: {
  facts: WalletFacts;
  id: number;
  reader: ReturnType<typeof attestedRecords>;
}) {
  const proof = facts.verified[id];
  const oracleId =
    proof && !/^0x0+$/.test(proof[1]) ? oracleUuid(proof[1]) : null;
  const [record, setRecord] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setRecord(null);
    setFailed(false);
    if (oracleId)
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
  return (
    <div className="minted-fact">
      <strong>{id<601?(facts.token===0n?'Available live':'Captured at mint'):'Verified fact'}</strong>
      {id < 601 ? (
        facts.mintBlock !== null && facts.mintTime !== null ? (
          <>
            <span>Block {facts.mintBlock.toLocaleString("en-US")}</span>
            <time
              dateTime={new Date(Number(facts.mintTime) * 1000).toISOString()}
            >
              {utc(facts.mintTime)}
            </time>
          </>
        ) : (
          <span>Direct · read live; no card minted</span>
        )
      ) : record?.attestedAt ? (
        <time dateTime={record.attestedAt}>
          {utc(Date.parse(record.attestedAt) / 1000)}
        </time>
      ) : (
        <span>
          {failed || !oracleId
            ? "Attested time unavailable"
            : record
              ? "Attested time not recorded"
              : "Reading attested time…"}
        </span>
      )}
      {failed && (
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          Retry
        </button>
      )}
    </div>
  );
}
// Explorer uses the existing bounded eligibility check. Unknown answers remain visible.
export function useFactChecks(facts: WalletFacts | null, ids: number[]) {
  const site = useSite();
  const [checks, setChecks] = useState<Record<number, any>>({});
  useEffect(() => {
    setChecks({});
    if (!facts || !site.health) return;
    const controller = new AbortController();
    const client = scopedClient(site.client, controller.signal);
    for (const id of ids) {
      if (
        ineligibleFact(facts, id) ||
        holdsFact(facts, id) ||
        id === 1201 ||
        id < 601
      )
        continue;
      void checkEligibility(
        client,
        (id: number, signal: AbortSignal) =>
          read(scopedClient(client, signal), site.r, "Registry", "specOf", [
            id,
          ]),
        facts.address,
        id,
        { signal: controller.signal },
      ).then((value: any) => {
        if (!controller.signal.aborted)
          setChecks((old) => ({ ...old, [id]: value }));
      });
    }
    return () => controller.abort();
  }, [
    facts?.address,
    site.client,
    !!site.health,
    site.readRetry,
    ids.join(","),
  ]);
  return checks;
}
