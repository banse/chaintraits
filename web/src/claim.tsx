import { useState, useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";
import { zeroAddress, type Address } from "viem";
import { useSite } from "./context";
import {
  lookup,
  read,
  explain,
  contract,
  scopedClient,
  type WalletFacts,
} from "./chain";
import { TRAITS, SWARMED, FEE } from "./data";
import { specExamples, templateStart, applyExample } from "./spec-examples.mjs";
import {
  imd,
  exactUnits,
  impossible,
  validateSpec,
  traitMethod,
  MISS_REASONS,
} from "./pure.mjs";
import { Card, CommunityCard, Mark, Status, Section, num } from "./components";
import {
  useTransactions,
  TransactionJournal,
  type Journal,
} from "./transactions";
import { useWalletSheet } from "./wallet";
import { eligibilityText } from "./eligibility.mjs";
import { lastPersonalRequests, lastRequestText } from "./request-outcomes.mjs";
import {
  sharedState,
  completion,
  registryEvents,
  HISTORY_WINDOW,
} from "./settlement";
import { pageReads } from "./page-reads.mjs";
import { claimAnchor } from "./navigation";
import {
  RequestTime,
  SwarmFeed,
  SWARM_POLL_MS,
  type WatchedFact,
} from "./swarm";
// The connected wallet's open requests, shared by Mint and Wallet.
export function openRequests(
  facts: WalletFacts | null,
  address: string | undefined,
  specs: { id: number; name: string }[],
): WatchedFact[] {
  return facts && facts.address.toLowerCase() === address?.toLowerCase()
    ? Object.entries(facts.pending)
        .filter(([, rid]) => !/^0x0+$/.test(rid))
        .map(([id, requestId]) => ({
          id: Number(id),
          requestId,
          name:
            TRAITS.find((t) => t.id === Number(id))?.name ||
            specs.find((s) => s.id === Number(id))?.name ||
            `Fact ${id}`,
        }))
    : [];
}
function disableReason(site: any, account: any, busy: boolean) {
  return busy
    ? "A transaction is in progress."
    : !site.health
      ? site.error || "Checking live dependencies…"
      : !account.address
        ? "Connect a wallet."
        : account.chainId !== site.r.deployment.chainId
          ? "Switch to Ethereum."
          : "";
}
export function Settlement({
  requestId,
  journal,
  onCheckSwarm,
}: {
  requestId: string;
  journal: Journal;
  onCheckSwarm?: () => void;
}) {
  const site = useSite();
  const account = useAccount();
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [canSettle, setCanSettle] = useState(false);
  const [canAbandon, setCanAbandon] = useState(false);
  const [localFact, setLocalFact] = useState<WatchedFact>();
  const [localFocus, setLocalFocus] = useState<{
    requestId: string;
    tick: number;
  } | null>(null);
  async function check() {
    setBusy(true);
    setStatus("Checking the Intake completion over the selected RPC…");
    setCanSettle(false);
    setCanAbandon(false);
    try {
      if (!site.health) throw Error("Live reads unavailable. Retry reads.");
      const pending = await read(
        site.client,
        site.r,
        "Registry",
        "pendingRequest",
        [requestId],
      );
      if (!onCheckSwarm && Number(pending[1]))
        setLocalFact({
          requestId,
          id: Number(pending[1]),
          name:
            TRAITS.find((t) => t.id === Number(pending[1]))?.name ||
            site.specs.find((s) => s.id === Number(pending[1]))?.name ||
            `Fact ${pending[1]}`,
        });
      const found = await completion(
        site.client,
        site.r,
        site.health,
        requestId as any,
      );
      setResult(found);
      const block = await site.client.getBlock();
      const claimant = pending[0].toLowerCase();
      const mine = account.address?.toLowerCase() === claimant;
      const shared = claimant === zeroAddress;
      const expired = BigInt(pending[2]) + 31n * 86400n < block.timestamp;
      setCanAbandon(!!account.address && (shared || mine) && expired);
      if (!found) {
        setStatus(
          expired
            ? "Request is older than 31 days. The eligible claimant can abandon it."
            : "No completion found. The request may still be pending.",
        );
        return;
      }
      if (found.status !== 0) {
        setCanAbandon(!!account.address && mine);
        setStatus(
          "The panel returned no verdict. The request fee is spent. A completed personal request can be cleared by its claimant.",
        );
        return;
      }
      if (found.delivered) {
        setStatus(
          "Intake reports the verdict was delivered. Refresh wallet facts.",
        );
        return;
      }
      if (!account.address) {
        setStatus(
          "A true verdict may be stored by any connected wallet. Connect, then check again to simulate settlement.",
        );
        return;
      }
      try {
        await site.client.simulateContract({
          address: contract(site.r, "Registry").address,
          abi: site.r.abis.Registry,
          functionName: "settle",
          args: [requestId, found.attestation, found.signature],
          account: account.address,
        });
        setCanSettle(true);
        setStatus(
          "Intake delivery failed. The verdict passed settlement simulation.",
        );
      } catch (e: any) {
        const reason = e.walk?.(
          (e: any) => e.data?.errorName === "NotSettleable",
        )?.data?.args?.[1];
        setStatus(
          reason
            ? `Cannot store the verdict: ${MISS_REASONS[Number(reason)] || `reason ${reason}`}.`
            : explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]),
        );
      }
    } catch (e) {
      setStatus(explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settlement">
      <p className="break">Pending request: {requestId}</p>
      <button
        disabled={busy}
        onClick={() => {
          onCheckSwarm?.();
          if (!onCheckSwarm)
            setLocalFocus((old) => ({ requestId, tick: (old?.tick || 0) + 1 }));
          void check();
        }}
      >
        Check swarm
      </button>
      {localFact && (
        <SwarmFeed
          fact={localFact}
          focus={localFocus}
          onAttested={site.refresh}
        />
      )}
      {canSettle && (
        <button
          disabled={journal.busy}
          onClick={async () => {
            try {
              await journal.prepare(
                "Store the verdict",
                "step-02",
                [
                  {
                    label: "Store the undelivered verdict",
                    functionName: "settle",
                    args: [requestId, result.attestation, result.signature],
                    amount: 0n,
                  },
                ],
                [],
                "IMD",
              );
              setStatus("Ready: confirm the steps in the dialog.");
            } catch (e) {
              setStatus(
                explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]),
              );
            }
          }}
        >
          Store the verdict
        </button>
      )}
      {canAbandon && (
        <button
          disabled={journal.busy}
          onClick={async () => {
            try {
              await journal.prepare(
                "Abandon the request",
                "step-02",
                [
                  {
                    label: "Abandon pending request; no fee refund",
                    functionName: "abandon",
                    args: [requestId],
                    amount: 0n,
                  },
                ],
                [],
                "IMD",
              );
              setStatus("Ready: confirm the steps in the dialog.");
            } catch (e) {
              setStatus(
                explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]),
              );
            }
          }}
        >
          Abandon request
        </button>
      )}
      <Status>{status}</Status>
      {status.startsWith("Ready:") && (
        <a href={claimAnchor("transaction-steps")}>Transaction steps ↓</a>
      )}
    </div>
  );
}
function SharedFactRow({
  trait: t,
  payment,
  journal,
  facts,
  selected,
  onSelect,
  request,
  cache,
  wanted,
  onPending,
}: {
  trait: any;
  payment: string;
  journal: Journal;
  facts: WalletFacts | null;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  request: () => void;
  cache: ReturnType<typeof pageReads>;
  wanted: number;
  onPending: (id: number, requestId: string | null) => void;
}) {
  const site = useSite();
  const account = useAccount();
  const [value, setValue] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    if (site.health)
      sharedState(
        scopedClient(site.client, cache.signal),
        site.r,
        site.health,
        t.id,
        cache,
      )
        .then((v) => {
          if (active) setValue(v);
        })
        .catch((e) => {
          if (active)
            setError(
              explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]),
            );
        });
    return () => {
      active = false;
    };
  }, [site.health, site.client, t.id, site.readRetry, cache]);
  const stored = value && !/^0x0+$/.test(value.fact[0]);
  const pending = value && !/^0x0+$/.test(value.pending);
  useEffect(() => {
    if (value) onPending(t.id, pending ? value.pending : null);
  }, [value?.pending]);
  const included = value?.list.some(
    (a: string) => a.toLowerCase() === account.address?.toLowerCase(),
  );
  const cannot = t.id === 1201 && facts && !facts.joined;
  const proven =
    facts?.traits.includes(t.id) || facts?.verifiedSpecs.includes(t.id);
  const reason =
    disableReason(site, account, journal.busy) ||
    (error || !value
      ? "Shared-fact reads unavailable."
      : cannot
        ? "cannot be true: not in WhitelistCurator.sol"
        : proven
          ? "Already proven"
          : pending
            ? "A request is already pending."
            : stored && !included
              ? "not in the list"
              : "");
  // A stored list is applied directly; selection is only for paid requests.
  useEffect(() => {
    if (stored || pending || proven) onSelect(false);
  }, [stored, pending, proven]);
  async function apply() {
    setBusy(true);
    setStatus("Checking…");
    try {
      await journal.prepare(
        `Apply shared fact ${t.id} / ${t.name}`,
        "step-02",
        [
          {
            label: `Apply shared fact ${t.id} / ${t.name}`,
            functionName: "applySharedFact",
            args: [t.id, value.list],
            amount: 0n,
          },
        ],
        [],
        "IMD",
      );
      setStatus("Ready: confirm the steps in the dialog.");
    } catch (e) {
      setStatus(explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`picker-row ${wanted === t.id ? "highlight" : ""}`}
      id={`pick-${t.id}`}
    >
      <div className="picker-text">
        <label>
          <input
            type="checkbox"
            checked={selected}
            disabled={!!cannot || !!proven || !!pending || !!stored || !!error}
            onChange={(e) => onSelect(e.target.checked)}
          />
          <span>
            <strong>
              {t.id} / {t.name}
            </strong>
            <span className="rule">
              {t.rule} · {t.window} · <Mark kind="shared" />
              {proven && (
                <>
                  {" · "}
                  <span className="accent">Already proven</span>
                </>
              )}
            </span>
          </span>
        </label>
        {t.id === 1201 ? (
          // 1201 keeps one short line, only while its list is stored or a
          // request is pending.
          (stored || pending) && (
            <div className="shared-details">
              <span className="muted">
                {stored
                  ? "Stored: listed wallets can apply it for gas only."
                  : "Request pending."}
              </span>
            </div>
          )
        ) : (
          <div className="shared-details">
            <span className="rule">
              One attempt at panel 11 / quorum 7 costs{" "}
              {site.health
                ? `${imd(site.health.price)} IMD (priceOf · live)`
                : "the live oracle price per fact"}
              . An attempt whose panel misses the quorum refunds nothing.
            </span>
            <span className="muted">
              {!value
                ? "Reading the shared fact…"
                : stored
                  ? "Stored · no further request needed. Listed wallets can apply it for gas only."
                  : pending
                    ? "Request pending."
                    : "not requested yet"}
              {value
                ? ` Attempts in the last 24 hours: ${num(value.attempts)}. Last panel result: ${value.last ? (value.last.eventName === "Missed" ? `Missed: ${MISS_REASONS[Number(value.last.args.reason)] || value.last.args.reason}` : value.last.eventName === "NoVerdict" ? `No verdict (${value.last.args.agreed}/${value.last.args.answered} agreed)` : value.last.eventName) : "none in the last 24 hours"}.`
                : ""}
            </span>
            <span className="muted">
              Pay with: {stored ? "gas only" : payment}
            </span>
          </div>
        )}
        {t.id !== 1201 && value?.result?.txHash && (
          <a
            className="source row-detail"
            href={`${site.r.deployment.network.explorer}/tx/${value.result.txHash}`}
          >
            Oracle completion and signed result ↗
          </a>
        )}
        {(error || status || (reason && reason !== "Already proven")) && (
          <div className="row-detail">
            <Status
              error={
                !!error ||
                (!!status &&
                  !status.startsWith("Ready:") &&
                  status !== "Checking…")
              }
            >
              {error || status || reason}
            </Status>
          </div>
        )}
        {status.startsWith("Ready:") && (
          <a className="row-detail" href={claimAnchor("transaction-steps")}>
            Transaction steps ↓
          </a>
        )}
      </div>
      {t.id === 1201 ? <Card miniId={t.id} /> : <CommunityCard fact={t} />}
      {!proven && (
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            disabled={!!reason || busy}
            aria-label={`${stored ? "Apply shared fact" : "Mint this fact"}: ${t.id} / ${t.name}`}
            onClick={stored ? apply : request}
          >
            {busy
              ? "Checking…"
              : stored
                ? "Apply shared fact"
                : "Mint this fact"}
          </button>
        </div>
      )}
    </div>
  );
}
const defaultForm = {
  kind: "",
  target: "",
  item: "",
  arg: "",
  fixedArg: "",
  fixedVal: "",
  sumArg: "",
  op: "",
  threshold: "",
  fromBlock: "",
  toBlock: "",
  name: "",
};
function CommunityForm({
  payment,
  journal,
}: {
  payment: string;
  journal: Journal;
}) {
  const site = useSite();
  const account = useAccount();
  const [form, setForm] = useState(defaultForm);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const [exampleIndex, setExampleIndex] = useState("");
  const examples = form.kind
    ? (specExamples({
        curator: site.health?.deps.curator || "",
        imd: site.r.deployment.network.pairToken.address,
      }) as Record<string, any[]>)[form.kind] || []
    : [];
  const example = exampleIndex === "" ? null : examples[Number(exampleIndex)];
  const normalized = {
    ...form,
    target: form.kind === "5" ? zeroAddress : form.target,
    fixedVal: form.fixedVal || (form.fixedArg ? "" : "0"),
    op: form.kind === "4" ? form.op : "0",
  };
  let errors: Record<string, string> = {};
  try {
    errors = validateSpec(normalized, site.health?.block || 0n);
  } catch {
    errors = { fixedVal: "Use unsigned integer values." };
  }
  const labels: Record<string, [string, string]> = {
    name: ["Trait name", "Community contributor"],
    target: ["Contract address", "The contract that emits the event"],
    item: [
      "Event or function signature",
      form.kind === "4"
        ? "function balanceOf(address) view returns (uint256)"
        : "event Deposited(address indexed contributor, uint256 amount)",
    ],
    arg: ["Claimant / group field", "contributor"],
    fixedArg: ["Second indexed filter (optional)", "hour"],
    fixedVal: ["Filter value (integer)", "64"],
    sumArg: ["Unsigned integer field to sum", "amount"],
    threshold: [
      form.kind === "3" ? "Ranking head (1–32)" : "Threshold (integer)",
      "1",
    ],
    fromBlock: ["First block (inclusive)", "25769870"],
    toBlock: ["Last block (inclusive)", "25789604"],
  };
  function change(key: string, value: string) {
    setStatus("");
    setEdited((old) => ({ ...old, [key]: true }));
    setForm((old) =>
      key === "kind"
        ? { ...templateStart(value, defaultForm), name: old.name }
        : { ...old, [key]: value },
    );
    if (key === "kind") {
      setEdited({ kind: true });
      setSent(false);
      setExampleIndex("");
    }
  }
  function choose(index: string) {
    setStatus("");
    setExampleIndex(index);
    setForm(
      applyExample(
        form.kind,
        index === "" ? null : examples[Number(index)],
        defaultForm,
      ),
    );
    setEdited({ kind: true });
    setSent(false);
  }
  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    setSent(true);
    if (Object.keys(errors).length) {
      document.getElementById(`spec-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setStatus("Validating the spec with the deployed Composer…");
    try {
      if (!site.health) throw Error("Live reads unavailable.");
      const s = {
        ...normalized,
        kind: Number(form.kind),
        op: Number(normalized.op),
        fixedVal: BigInt(normalized.fixedVal),
        threshold: BigInt(form.threshold),
        fromBlock: BigInt(form.fromBlock),
        toBlock: BigInt(form.toBlock),
      };
      await read(site.client, site.r, "Composer", "validateSpec", [
        s,
        site.health.block,
      ]);
      const prepared = await journal.prepare(
        "Register a community trait",
        "step-03",
        [
          {
            label: "Register the immutable community spec",
            functionName: "registerSpec",
            args: [s, 0n],
            amount: site.health.specFee,
          },
        ],
        [{ name: "Register community spec", amount: site.health.specFee }],
        payment,
      );
      setStatus(
        `Ready: confirm the steps in the dialog. The new id will be read from the receipt. A first oracle claim currently costs ${imd(prepared.price)} IMD; this price can change.`,
      );
    } catch (e) {
      setStatus(explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="community-form" onSubmit={prepare}>
      <p>
        The event must be written as its signature,{" "}
        <code>event Name(type indexed name, …)</code>, and must not be{" "}
        <code>anonymous</code> or declare more than three indexed parameters;
        every parameter must be named; the claimant field must be an indexed
        address of that event; a sum only over an unsigned integer parameter; a
        second filter only on an indexed parameter of a fixed-size type. The
        registry refuses anything else before the fee is taken.
      </p>
      <div className="form-grid">
        <label htmlFor="spec-kind">
          Template
          <select
            id="spec-kind"
            value={form.kind}
            onChange={(e) => change("kind", e.target.value)}
          >
            <option value="">Choose a template</option>
            <option value="1">T1 · Count events</option>
            <option value="2">T2 · Sum events</option>
            <option value="3">T3 · Rank a shared list</option>
            <option value="4">T4 · Compare a contract view</option>
            <option value="5">T5 · Account nonce at a block</option>
          </select>
        </label>
        {form.kind && (
          <label htmlFor="spec-example">
            Example
            <select
              id="spec-example"
              value={exampleIndex}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="">Your own rule</option>
              {examples.map((x, i) => (
                <option key={x.name} value={String(i)}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {example && (
          <p className="full muted example-proves" aria-live="polite">
            {example.proves}
          </p>
        )}
        {Object.entries(labels)
          .filter(
            ([key]) =>
              !(
                form.kind === "5" &&
                [
                  "target",
                  "item",
                  "arg",
                  "fixedArg",
                  "fixedVal",
                  "sumArg",
                ].includes(key)
              ) &&
              !(
                form.kind === "4" &&
                ["arg", "fixedArg", "sumArg", "fixedVal"].includes(key)
              ) &&
              !(Number(form.kind) === 1 && key === "sumArg") &&
              !(form.kind === "3" && ["fixedArg", "fixedVal"].includes(key)),
          )
          .map(([key, [label, placeholder]]) => (
            <div className={key === "item" ? "full" : ""} key={key}>
              <label htmlFor={`spec-${key}`}>{label}</label>
              <input
                id={`spec-${key}`}
                value={(form as any)[key]}
                placeholder={placeholder}
                onChange={(e) => change(key, e.target.value)}
                aria-invalid={!!errors[key] && (!!edited[key] || sent)}
                aria-describedby={`spec-${key}-error`}
                inputMode={
                  ["fixedVal", "threshold", "fromBlock", "toBlock"].includes(
                    key,
                  )
                    ? "numeric"
                    : "text"
                }
                spellCheck={false}
              />
              <p className="field-error" id={`spec-${key}-error`}>
                {edited[key] || sent ? errors[key] || "" : ""}
              </p>
            </div>
          ))}
        {form.kind === "4" && (
          <label>
            Comparison
            <select
              value={form.op}
              onChange={(e) => change("op", e.target.value)}
            >
              <option value="">Choose comparison</option>
              <option value="1">≥</option>
              <option value="2">&gt;</option>
              <option value="3">≤</option>
              <option value="4">&lt;</option>
              <option value="5">=</option>
            </select>
          </label>
        )}
      </div>
      <p>
        {site.health
          ? `A community trait costs ${imd(6400000000000000000n + site.health.price)} IMD: ${exactUnits(site.health.price)} for your first claim and 6.4 IMD that registerSpec() forwards to the BurnExecutor for bridging and burning on Base.`
          : "A community trait costs 6.4 IMD plus the live oracle price for your first claim; the fee is forwarded to the BurnExecutor for bridging and burning on Base."}{" "}
        The request price is read again when you prepare; it can change.
        Registration and your first claim are separate transactions.
      </p>
      <p className="muted">
        Pay with: {payment}. This form prepares the 6.4 IMD registration first.
        The receipt supplies its id; then request that id in step 02.
      </p>
      <button
        disabled={
          !!disableReason(site, account, journal.busy) ||
          busy ||
          Object.keys(errors).length > 0
        }
        type="submit"
      >
        {busy ? "Checking…" : "Mint registration"}
      </button>
      <Status
        error={
          !!status &&
          !status.startsWith("Ready:") &&
          !status.startsWith("Validating")
        }
      >
        {status ||
          disableReason(site, account, journal.busy) ||
          (Object.keys(errors).length && (sent || Object.keys(edited).length)
            ? "Enter valid values for the selected template."
            : "")}
      </Status>
      {status.startsWith("Ready:") && (
        <a href={claimAnchor("transaction-steps")}>Transaction steps ↓</a>
      )}
    </form>
  );
}
export function Claim() {
  const site = useSite();
  const account = useAccount();
  const { open } = useWalletSheet();
  const journal = useTransactions();
  const [facts, setFacts] = useState<WalletFacts | null>(null);
  const [owned, setOwned] = useState<{ address: string; token: bigint } | null>(
    null,
  );
  const minted =
    owned && owned.address === account.address ? owned.token : null;
  const [cardRead, setCardRead] = useState<{
    address?: string;
    state: "pending" | "ready" | "failed";
  }>({ state: "pending" });
  const cardReady =
    cardRead.address === account.address && cardRead.state === "ready";
  const [factError, setFactError] = useState("");
  const [payment, setPayment] = useState("IMD");
  const [selected, setSelected] = useState<number[]>([]);
  const [sharedPendings, setSharedPendings] = useState<Record<number, string>>(
    {},
  );
  const [requestHistory, setRequestHistory] = useState<{
    wallet?: string;
    lines: Record<number, string>;
    older?: boolean;
  }>({ lines: {} });
  const backfills = useMemo(() => pageReads(), [site.client]);
  useEffect(() => () => backfills.stop(), [backfills]);
  useEffect(() => {
    backfills.retryFailed();
  }, [site.readRetry, backfills]);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const pendingFacts = openRequests(facts, account.address, site.specs);
  const pendingKey = pendingFacts
    .map((f) => `${f.id}:${f.requestId}`)
    .join(",");
  // Completion polling is independent of the progress API, including during an
  // API outage or while an attestation is waiting for onchain delivery.
  useEffect(() => {
    if (!account.address || !site.health || !pendingFacts.length) return;
    let active = true,
      running = false;
    const interval = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const current = await Promise.all(
          pendingFacts.map((f) =>
            read(site.client, site.r, "Registry", "pendingOf", [
              account.address,
              f.id,
            ]),
          ),
        );
        if (
          active &&
          current.some((rid, i) => rid !== pendingFacts[i].requestId)
        )
          setRefreshTick((v) => v + 1);
      } catch {
        /* The existing chain status/retry remains independent. */
      } finally {
        running = false;
      }
    }, SWARM_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [account.address, site.client, site.health, pendingKey]);
  useEffect(() => {
    if (account.address)
      void journal.checkPersonal(
        selected.filter(
          (id) =>
            id !== 1201 && !site.specs.some((s) => s.id === id && s.kind === 3),
        ),
      );
  }, [selected.join(","), account.address, site.client, !!site.health]);
  useEffect(() => {
    let active = true;
    const wallet = account.address;
    // Leaving the page or switching wallets stops this read's requests.
    const controller = new AbortController();
    const client = scopedClient(site.client, controller.signal);
    if (wallet && site.health) {
      void (async () => {
        let events: any[] = await registryEvents(
          client,
          site.r,
          ["TraitRequested", "Verified", "Missed", "NoVerdict", "Abandoned"],
          undefined,
          { window: HISTORY_WINDOW },
        );
        const requested = new Set(
          events
            .filter(
              (e: any) =>
                e.eventName === "TraitRequested" &&
                e.args.claimant.toLowerCase() === wallet.toLowerCase(),
            )
            .map((e: any) => e.args.requestId.toLowerCase()),
        );
        if (
          pendingFacts.some((f) => !requested.has(f.requestId.toLowerCase()))
        ) {
          const older = await backfills.once(
            `wallet-history:${wallet.toLowerCase()}`,
            () =>
              registryEvents(
                scopedClient(site.client, backfills.signal),
                site.r,
                [
                  "TraitRequested",
                  "Verified",
                  "Missed",
                  "NoVerdict",
                  "Abandoned",
                ],
              ),
          );
          const merged = new Map(
            [...older, ...events].map((e: any) => [
              `${e.blockNumber}:${e.transactionHash}:${e.logIndex}`,
              e,
            ]),
          );
          events = [...merged.values()].sort((a: any, b: any) =>
            a.blockNumber === b.blockNumber
              ? Number(a.logIndex) - Number(b.logIndex)
              : a.blockNumber < b.blockNumber
                ? -1
                : 1,
          );
        }
        const blocks = new Map<bigint, Promise<any>>();
        const lines = await Promise.all(
          lastPersonalRequests(events, wallet).map(async ([id, value]: any) => {
            const blockNumber = value.request.blockNumber;
            if (!blocks.has(blockNumber))
              blocks.set(blockNumber, client.getBlock({ blockNumber }));
            const block = await blocks.get(blockNumber);
            return [id, lastRequestText(value.outcome, block.timestamp)];
          }),
        );
        if (active)
          setRequestHistory({ wallet, lines: Object.fromEntries(lines) });
      })().catch(() => {
        // An incomplete read implies no outcome. Retry reads runs it again.
        if (active) setRequestHistory({ wallet, lines: {} });
      });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    account.address,
    site.client,
    site.health,
    refreshTick,
    pendingKey,
    site.readRetry,
    backfills,
  ]);
  const wanted = Number(
    new URLSearchParams(location.hash.split("?")[1]?.split("#")[0]).get(
      "trait",
    ),
  );
  useEffect(() => {
    let active = true;
    setFacts((old) =>
      site.health &&
      old?.address.toLowerCase() === account.address?.toLowerCase()
        ? old
        : null,
    );
    setFactError("");
    setCardRead({ address: account.address, state: "pending" });
    if (account.address && site.health)
      read(site.client, site.r, "Registry", "tokenOf", [account.address])
        .then((token) => {
          if (active) {
            setOwned({ address: account.address!, token });
          }
          return lookup(site.client, site.r, site.health!, account.address!, [
            ...TRAITS.map((t) => t.id),
            ...site.specs.map((s) => s.id),
          ]);
        })
        .then((v) => {
          if (active) {
            setFacts(v);
            setOwned({ address: account.address!, token: v.token });
            setCardRead({ address: account.address, state: "ready" });
          }
        })
        .catch((e) => {
          if (active) {
            setFacts(null);
            setCardRead({ address: account.address, state: "failed" });
            setFactError(
              explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]),
            );
          }
        });
    return () => {
      active = false;
    };
  }, [account.address, site.health, site.specs, refreshTick]);
  useEffect(() => {
    if (facts)
      setSelected((old) =>
        old.filter(
          (id) =>
            !facts.traits.includes(id) &&
            !facts.verifiedSpecs.includes(id) &&
            !impossible(facts.joined, id) &&
            (!facts.pending[id] || /^0x0+$/.test(facts.pending[id])),
        ),
      );
  }, [facts]);
  useEffect(() => {
    const custom = site.specs.find((s) => s.id === wanted);
    if (
      wanted &&
      (TRAITS.some((t) => t.id === wanted && t.class !== "direct") || custom)
    )
      setSelected([wanted]);
    if (wanted) {
      const timeout = setTimeout(
        () =>
          document
            .getElementById(`pick-${wanted}`)
            ?.scrollIntoView({ block: "start" }),
        120,
      );
      return () => clearTimeout(timeout);
    }
  }, [wanted, site.specs]);
  const reason = disableReason(site, account, journal.busy);
  const customTraits = site.specs.map((s) => ({
    id: s.id,
    name: s.name,
    class: s.kind === 3 ? "shared" : s.kind === 5 ? "panel" : "chain",
    rule:
      s.kind === 3
        ? `T3 · shared list · top ${s.threshold} by ${s.sumArg}`
        : `T${s.kind} · threshold ${s.threshold}`,
    window: `${num(s.fromBlock)} → ${num(s.toBlock)}`,
    kind: s.kind,
  }));
  const paid = [
    ...TRAITS.filter((t) => t.class !== "direct").map((t) => ({
      ...t,
      kind: t.class === "shared" ? 3 : t.class === "panel" ? 5 : 1,
    })),
    ...customTraits,
  ].sort((a, b) => a.id - b.id);
  async function prepareMint() {
    setBusy("mint");
    setStatus((v) => ({ ...v, mint: "Checking…" }));
    try {
      await journal.prepare(
        "Mint your Sworn card",
        "mint",
        [
          {
            label: "Mint one Sworn card",
            functionName: "mintCard",
            args: [],
            amount: site.health!.mintFee,
          },
        ],
        [{ name: "Mint card", amount: site.health!.mintFee }],
        payment,
        facts || undefined,
      );
      setStatus((v) => ({
        ...v,
        mint: "Ready: confirm the steps in the dialog.",
      }));
    } catch (e) {
      setStatus((v) => ({
        ...v,
        mint: explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]),
      }));
    } finally {
      setBusy("");
    }
  }
  // "Mint selected facts" and a row's "Mint this fact" open the same dialog;
  // a row's button requests that fact alone and leaves the selection as is.
  async function prepareFacts(ids: number[] = selected) {
    setBusy("facts");
    setStatus((v) => ({ ...v, facts: "Checking…" }));
    try {
      if (!site.health || !facts)
        throw Error("Wallet reads unavailable. Retry reads.");
      if (!ids.length) throw Error("Select at least one fact.");
      const price = site.health.price;
      const rows = ids.map((id) => paid.find((t) => t.id === id)!);
      await journal.prepare(
        rows.length === 1 && rows[0].kind === 3
          ? `Request shared fact ${rows[0].id} / ${rows[0].name}`
          : `Request ${rows.length} oracle ${rows.length === 1 ? "fact" : "facts"}: ${rows.map((t) => `${t.id} / ${t.name}`).join(", ")}`,
        "step-02",
        rows.map((t) => ({
          label: `${t.kind === 3 ? "Request shared fact" : "Request"} ${t.id} / ${t.name}`,
          functionName: traitMethod(t.kind),
          args: t.kind === 3 ? [t.id, price] : [[t.id], price],
          amount: price,
          ids: [t.id],
        })),
        rows.map((t) => ({ id: t.id, name: t.name, amount: price })),
        payment,
      );
      setStatus((v) => ({
        ...v,
        facts: "Ready: confirm the steps in the dialog.",
      }));
    } catch (e) {
      setStatus((v) => ({
        ...v,
        facts: explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]),
      }));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <h1>Mint</h1>
      <p className="prose">
        Mint your Sworn card, then add facts to it. Direct facts are captured at
        mint; chain-proven and panel-sworn facts are requested from the swarm's
        oracle and land on your card when its panel agrees.
      </p>
      {pendingFacts.length > 0 && (
        <section className="pending-notice" aria-label="Pending facts">
          <h2>Waiting for the swarm</h2>
          {pendingFacts.map((fact) => (
            <p key={fact.requestId}>
              <strong>
                {fact.id} / {fact.name}
              </strong>{" "}
              · Pending since <RequestTime requestId={fact.requestId} />. This
              fact cannot be requested again until its answer arrives. Other
              facts and actions remain available.
            </p>
          ))}
        </section>
      )}
      <section className="mint-panel" id="mint">
        <div className="claim-copy">
          <h2>
            {minted !== null && minted !== 0n
              ? `Your Sworn card #${minted}`
              : account.address && !cardReady
                ? factError
                  ? "Retry wallet reads"
                  : "Reading your card…"
                : "Mint your Sworn card"}
          </h2>
          {(!account.address || (cardReady && minted === 0n)) && (
            <>
              <p>
                A card costs 0.10 IMD; no trait claim is needed before minting.
              </p>
              <p className="accent">Mint your card now. It updates itself.</p>
              <p>{FEE}.</p>
              <p className="muted">Pay with: {payment}</p>
            </>
          )}
          {!account.address ? (
            <button className="primary" onClick={open}>
              Connect to mint
            </button>
          ) : minted !== null && minted !== 0n ? (
            <p className="accent">
              Card #{minted.toString()} · Original claimant: {account.address}
            </p>
          ) : !cardReady ? null : (
            <button
              className="primary"
              disabled={!!reason || !facts || facts.token !== 0n || !!busy}
              onClick={prepareMint}
            >
              {busy === "mint"
                ? "Checking…"
                : facts && facts.token !== 0n
                  ? "Already minted"
                  : "Mint card"}
            </button>
          )}
          <Status
            error={
              !!factError ||
              (!!status.mint &&
                !status.mint.startsWith("Ready:") &&
                status.mint !== "Checking…")
            }
          >
            {factError ||
              (facts && facts.token !== 0n
                ? "already minted"
                : status.mint ||
                  reason ||
                  (!facts ? "Reading your wallet…" : ""))}
          </Status>
          {status.mint?.startsWith("Ready:") && (
            <a href={claimAnchor("transaction-steps")}>
              {facts && facts.token !== 0n
                ? "View mint receipts ↓"
                : "Transaction steps ↓"}
            </a>
          )}
          {factError && (
            <button onClick={() => setRefreshTick((v) => v + 1)}>
              Retry wallet reads
            </button>
          )}
        </div>
        {facts ? (
          <Card facts={facts} />
        ) : minted !== null && minted !== 0n ? (
          <Status>
            Card #{minted.toString()} · Reading its facts and image…
          </Status>
        ) : (
          <Card sample />
        )}
      </section>
      <Section title="Why add traits after minting?">
        <p>
          Your card captures direct facts at mint. Paid requests can add
          verified facts later, and the card updates itself. A false answer or a
          panel without a verdict adds no fact; its request price is still
          spent.
        </p>
        <ol className="flow">
          <li>Mint a card</li>
          <li>Request a fact</li>
          <li>Agents check the rule</li>
          <li>Your card updates</li>
        </ol>
      </Section>
      {pendingFacts.length > 0 && (
        <section className="section swarm-feed" aria-label="Swarm progress">
          <h2>Swarm progress</h2>
          <p className="muted">
            Live panel progress, not proof. Facts and card updates come from the
            Registry.
          </p>
          {pendingFacts.map((fact) => (
            <SwarmFeed
              key={fact.requestId}
              fact={fact}
              focus={null}
              onAttested={() => setRefreshTick((n) => n + 1)}
            />
          ))}
        </section>
      )}
      <section className="section" id="add-traits">
        <h2>Add traits</h2>
        <fieldset className="payment">
          <legend>Pay for minting and paid traits with</legend>
          {["IMD", "ETH"].map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="payment"
                value={v}
                checked={payment === v}
                onChange={() => {
                  setPayment(v);
                  journal.clear();
                }}
              />
              {v}
            </label>
          ))}
        </fieldset>
        <p className="muted">
          IMD is the default. ETH buys exactly the missing IMD with a live
          exact-output quote, a 1% maximum input margin and a 120-second
          deadline.
        </p>
        <section id="step-01" className="step">
          <h3 aria-label="Step 01 · Direct reads">
            <span aria-hidden="true">Step 01 · </span>Direct reads
          </h3>
          <div className="info-grid">
            <p>
              <strong>Who can</strong> · Any wallet. The Curator determines
              which facts are true.
            </p>
            <p>
              <strong>Cost and risk</strong> · No claim fee. A card freezes
              these direct reads at mint.
            </p>
            <p>
              <strong>Who benefits</strong> · Your wallet can use these
              credentials without minting.
            </p>
          </div>
          <p>
            {facts
              ? `${facts.traits.filter((id) => id < 601).length} direct traits present.`
              : "Connect to see your live direct facts."}{" "}
            <a href="#/catalog#direct">Read the direct rules</a>.
          </p>
          <div className="direct-summary">
            {TRAITS.filter((t) => t.class === "direct").map((t) => (
              <span
                className={facts?.traits.includes(t.id) ? "accent" : "muted"}
                key={t.id}
              >
                {t.id} / {t.name}
                {facts
                  ? facts.traits.includes(t.id)
                    ? " · present"
                    : " · absent"
                  : ""}
              </span>
            ))}
          </div>
        </section>
        <section id="step-02" className="step">
          <h3 aria-label="Step 02 · Request facts">
            <span aria-hidden="true">Step 02 · </span>Request facts
          </h3>
          <div className="info-grid">
            <p>
              <strong>Who can</strong> · Any eligible wallet, with or without a
              card.
            </p>
            <p>
              <strong>Cost and risk</strong> · Each fact is a separate request
              at{" "}
              {site.health
                ? `${imd(site.health.price)} IMD (priceOf · live)`
                : "the live oracle price per fact"}
              . The price is spent whatever the answer.
            </p>
            <p>
              <strong>Who benefits</strong> · Your wallet, and anyone checking
              its credentials.
            </p>
          </div>
          <p>
            Chain-proven facts use 5 agents / quorum 3. Panel-sworn facts use 11
            / 7. For a requestable fact, unclaimed means unproven. It does not
            mean the fact is false. {SWARMED}
          </p>
          <div
            className="trait-picker"
            role="group"
            aria-label="Select paid facts"
          >
            {paid.map((t) => {
              const cant = facts && impossible(facts.joined, t.id);
              const proven =
                facts?.traits.includes(t.id) ||
                facts?.verifiedSpecs.includes(t.id);
              const pending =
                facts?.pending[t.id] && !/^0x0+$/.test(facts.pending[t.id]);
              const requestable =
                !!facts && !!account.address && !cant && !proven && !pending;
              if (t.kind === 3)
                return (
                  <SharedFactRow
                    key={t.id}
                    trait={t}
                    payment={payment}
                    journal={journal}
                    facts={facts}
                    selected={selected.includes(t.id)}
                    onSelect={(checked) =>
                      setSelected((old) =>
                        checked
                          ? old.includes(t.id)
                            ? old
                            : [...old, t.id]
                          : old.filter((id) => id !== t.id),
                      )
                    }
                    request={() => prepareFacts([t.id])}
                    cache={backfills}
                    wanted={wanted}
                    onPending={(id, rid) =>
                      setSharedPendings((old) => {
                        if ((old[id] || null) === rid) return old;
                        const next = { ...old };
                        if (rid) next[id] = rid;
                        else delete next[id];
                        return next;
                      })
                    }
                  />
                );
              return (
                <div
                  key={t.id}
                  id={`pick-${t.id}`}
                  className={`picker-row ${wanted === t.id ? "highlight" : ""}`}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      disabled={!!cant || proven || !!pending}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, t.id]
                            : old.filter((id) => id !== t.id),
                        )
                      }
                    />
                    <span>
                      <strong>
                        {t.id} / {t.name}
                      </strong>
                      <span className="rule">
                        {t.rule} · {t.window} · <Mark kind={t.class} />
                        {proven && !cant && (
                          <>
                            {" · "}
                            <span className="accent">Already proven</span>
                          </>
                        )}
                      </span>
                      {!proven &&
                        requestHistory.wallet === account.address &&
                        requestHistory.lines[t.id] && (
                          <span className="muted">
                            {requestHistory.lines[t.id]}
                          </span>
                        )}
                      {selected.includes(t.id) && account.address && (
                        <span
                          className={
                            journal.eligibility[journal.eligibilityKey(t.id)]
                              ?.state === "not-met"
                              ? "danger eligibility-advice"
                              : "muted eligibility-advice"
                          }
                          role="status"
                        >
                          {eligibilityText(
                            journal.eligibility[journal.eligibilityKey(t.id)],
                            site.health?.price,
                          )}
                        </span>
                      )}
                      {cant ? (
                        <span className="muted">
                          cannot be true: not in WhitelistCurator.sol
                        </span>
                      ) : proven ? null : pending ? (
                        <span className="muted">Request pending</span>
                      ) : null}
                    </span>
                  </label>
                  {t.id < 10001 && <Card miniId={t.id} />}
                  {requestable && (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!reason || !!busy}
                        aria-label={`Mint this fact: ${t.id} / ${t.name}`}
                        onClick={() => prepareFacts([t.id])}
                      >
                        Mint this fact
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p id="oracle-ack" className="muted">
            The payment dialog explains the cost and requires your confirmation
            before any wallet signature.
          </p>
          <button
            disabled={
              !!reason ||
              !facts ||
              selected.length === 0 ||
              !!busy ||
              selected.some(
                (id) =>
                  impossible(facts?.joined, id) ||
                  facts?.traits.includes(id) ||
                  facts?.verifiedSpecs.includes(id) ||
                  (facts?.pending[id] && !/^0x0+$/.test(facts.pending[id])),
              )
            }
            onClick={() => prepareFacts()}
          >
            {busy === "facts" ? "Checking…" : "Mint selected facts"}
          </button>
          <Status
            error={
              !!status.facts &&
              !status.facts.startsWith("Ready:") &&
              status.facts !== "Checking…"
            }
          >
            {status.facts ||
              reason ||
              (!facts
                ? "Wait for wallet reads."
                : !selected.length
                  ? "Select at least one fact."
                  : "")}
          </Status>
          {status.facts?.startsWith("Ready:") && (
            <a href={claimAnchor("transaction-steps")}>Transaction steps ↓</a>
          )}
          {facts &&
            Object.entries({ ...facts.pending, ...sharedPendings })
              .filter(([, rid]) => !/^0x0+$/.test(rid))
              .map(([id, rid]) => (
                <div key={id}>
                  <h4>{id} / pending request</h4>
                  <Settlement
                    requestId={rid}
                    journal={journal}
                    onCheckSwarm={
                      sharedPendings[Number(id)]
                        ? undefined
                        : () => {
                            const feed = document.getElementById(
                              `swarm-${rid}`,
                            );
                            if (feed instanceof HTMLDetailsElement) {
                              feed.open = true;
                              feed.querySelector("summary")?.focus();
                              feed.scrollIntoView({ block: "nearest" });
                            }
                          }
                    }
                  />
                </div>
              ))}
          <h3>Community facts</h3>
          {site.loading ? (
            <Status>Reading community specs…</Status>
          ) : site.error ? (
            <Status error>{site.error}</Status>
          ) : site.specError ? (
            <Status error>{site.specError}</Status>
          ) : !site.specs.length ? (
            <p className="muted">
              No community specs registered yet. Register an immutable spec in
              step 03.
            </p>
          ) : (
            <p className="muted">Community facts appear in the picker above.</p>
          )}
        </section>
        <section id="step-03" className="step">
          <h3 aria-label="Step 03 · Register a community trait">
            <span aria-hidden="true">Step 03 · </span>Register a community trait
          </h3>
          <div className="info-grid">
            <p>
              <strong>Who can</strong> · Anyone with a supported, immutable
              rule.
            </p>
            <p>
              <strong>Cost and risk</strong> · 6.4 IMD; {FEE}. A refused oracle
              question keeps its request price.
            </p>
            <p>
              <strong>Who benefits</strong> · A curator can define a fact for
              their community. Eligible wallets request and prove it.
            </p>
          </div>
          <CommunityForm payment={payment} journal={journal} />
        </section>
      </section>
      <TransactionJournal journal={journal} />
    </>
  );
}
