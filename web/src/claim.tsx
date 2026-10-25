import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { getAddress, zeroAddress, type Address } from "viem";
import { useSite } from "./context";
import {
  lookup,
  read,
  explain,
  contract,
  scopedClient,
  type WalletFacts,
} from "./chain";
import { TRAITS, SWARMED, FEE, classes } from "./data";
import { specExamples, templateStart, applyExample } from "./spec-examples.mjs";
import { sharedMembership } from "./shared-safety.mjs";
import {
  imd,
  exactUnits,
  impossible,
  validateSpec,
  traitMethod,
  MISS_REASONS,
} from "./pure.mjs";
import {
  Card,
  CommunityCard,
  CommunityIntro,
  Mark,
  Status,
  num,
} from "./components";
import { useTransactions, type Journal } from "./transactions";
import { useWalletSheet, SwitchNetworkButton } from "./wallet";
import { TASKS } from "./task-navigation.mjs";
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
  IneligibleControl,
  MintedFact,
  ineligibleFact,
  useAttestedReader,
  useFactChecks,
} from "./fact-ui";
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
function TaskAction({
  children,
  connectLabel = "Connect wallet",
}: {
  children: ReactNode;
  connectLabel?: string;
}) {
  const site = useSite();
  const account = useAccount();
  const { open } = useWalletSheet();
  if (!account.address)
    return (
      <button type="button" className="primary" onClick={open}>
        {connectLabel}
      </button>
    );
  if (account.chainId !== site.r.deployment.chainId)
    return <SwitchNetworkButton r={site.r} />;
  return <>{children}</>;
}
function PaymentChoice({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="task-payment" id={id}>
      <fieldset
        className="payment"
        disabled={disabled}
        aria-describedby={`${id}-help`}
      >
        <legend>Payment method</legend>
        {["IMD", "ETH"].map((method) => (
          <label key={method}>
            <input
              type="radio"
              name={id}
              value={method}
              checked={value === method}
              onChange={() => onChange(method)}
            />
            {method}
          </label>
        ))}
      </fieldset>
      <p className="muted" id={`${id}-help`}>
        {value === "ETH"
          ? "Uses existing IMD first; ETH buys only the missing IMD. The swap quote has a 1% maximum input margin and a 120-second deadline."
          : "Pay the fee from your IMD balance. A separate approval may be required."}{" "}
        Ethereum gas is separate and estimated before each transaction. Fiat
        equivalents are unavailable because no exchange-rate feed is configured.
      </p>
    </div>
  );
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
  idPrefix,
}: {
  requestId: string;
  journal: Journal;
  onCheckSwarm?: () => void;
  idPrefix?: string;
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
      if (!site.health) throw Error("Live reads unavailable; retrying.");
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
          "An acceptable signed result may be stored by any connected wallet. Connect, then check again to simulate settlement.",
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
          idPrefix={idPrefix}
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
  hidden,
  onEligibility,
  reader,
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
  hidden: boolean;
  onEligibility: (id: number, ineligible: boolean) => void;
  reader: ReturnType<typeof useAttestedReader>;
}) {
  const site = useSite();
  const account = useAccount();
  const [value, setValue] = useState<any>(null);
  const [listRetry,setListRetry] = useState(0);
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
  }, [site.health, site.client, t.id, site.readRetry, cache, listRetry]);
  const stored = value && !/^0x0+$/.test(value.fact[0]);
  const pending = value && !/^0x0+$/.test(value.pending);
  useEffect(() => {
    if (value) onPending(t.id, pending ? value.pending : null);
  }, [value?.pending]);
  const membership = sharedMembership(value,account.address);
  const included = membership==='included';
  useEffect(() => {
    onEligibility(t.id, !!facts && membership==='excluded');
  }, [membership, facts?.address]);
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
            : stored && membership==='unavailable'
              ? "The stored list is unavailable. Retry its evidence; wallet membership is still unknown."
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
        `Mint Facts: apply shared fact ${t.id} / ${t.name}`,
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
      hidden={hidden}
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
                ? `${imd(site.health.price)} IMD (current oracle quote)`
                : "the current oracle price"}
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
        {(error ||
          status ||
          (reason &&
            reason !== "Already proven" &&
            !(pending && reason === "A request is already pending."))) && (
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
        {stored&&membership==='unavailable'&&<button className="secondary" onClick={()=>{cache.invalidate(`shared-completion:${value.fact[0]}`);setListRetry(n=>n+1);}}>Retry stored list</button>}
      </div>
      {t.id === 1201 ? <Card miniId={t.id} /> : <CommunityCard fact={t} />}
      {proven && facts ? (
        <div className="row-actions">
          <MintedFact facts={facts} id={t.id} reader={reader} />
        </div>
      ) : (
        <div className="row-actions">
          <TaskAction connectLabel="Connect to Mint Facts">
            <button
              type="button"
              className="secondary"
              disabled={!!reason || busy}
              aria-label={`${stored ? "Apply shared fact" : "Mint Facts"}: ${t.id} / ${t.name}`}
              onClick={stored ? apply : request}
            >
              {busy
                ? "Checking…"
                : stored
                  ? "Apply shared fact"
                  : "Mint Facts"}
            </button>
          </TaskAction>
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
  setPayment,
  journal,
}: {
  payment: string;
  setPayment: (value: string) => void;
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
    ? (
        specExamples({
          curator: site.health?.deps.curator || "",
          imd: site.r.deployment.network.pairToken.address,
        }) as Record<string, any[]>
      )[form.kind] || []
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
    name: ["Fact name", "Community contributor"],
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
    setStatus("Validating the rule against the deployed Composer…");
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
        "Mint Rule",
        "step-03",
        [
          {
            label: "Mint Rule",
            functionName: "registerSpec",
            args: [s, 0n],
            amount: site.health.specFee,
          },
        ],
        [{ name: "Mint Rule", amount: site.health.specFee }],
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
      {(!form.kind||Number(form.kind)<=3)&&<p>
        For event-based rules, write the complete signature,{" "}
        <code>event Name(type indexed name, …)</code>, and must not be{" "}
        <code>anonymous</code> or declare more than three indexed parameters;
        every parameter must be named; the claimant field must be an indexed
        address of that event; a sum only over an unsigned integer parameter; a
        second filter only on an indexed parameter of a fixed-size type. The
        registry refuses anything else before the fee is taken.
      </p>}
      {form.kind==='4'&&<p>Compare a contract’s unsigned integer view for the wallet at a fixed block. The function must take one address and return one uint256.</p>}
      {form.kind==='5'&&<p>Check how many transactions the wallet had sent by one historical block. This template takes no contract or event signature.</p>}
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
          ? `Mint Rule costs 6.4 IMD. Using Mint Facts later costs ${exactUnits(site.health.price)} IMD per verification request at the current oracle quote, plus gas. The rule fee is forwarded to the BurnExecutor for bridging and burning on Base.`
          : "Mint Rule costs 6.4 IMD. Using Mint Facts later pays the oracle price per verification request, plus gas. The rule fee is forwarded to the BurnExecutor for bridging and burning on Base."}{" "}
        The request price is read again when you prepare; it can change.
        Mint Rule and Mint Facts are separate transactions; minting a rule alone adds no wallet fact.
      </p>
      <p className="muted">
        Mint Rule registers the definition in the contract. The receipt supplies
        its ID; then use <a href="#/request">Mint Facts</a> separately to verify
        it for your wallet.
      </p>
      <PaymentChoice
        id="registration-payment"
        value={payment}
        onChange={setPayment}
        disabled={journal.busy || busy}
      />
      <TaskAction connectLabel="Connect to Mint Rule">
        <button
          disabled={
            !!disableReason(site, account, journal.busy) ||
            busy ||
            Object.keys(errors).length > 0
          }
          type="submit"
        >
          {busy ? "Checking…" : "Mint Rule"}
        </button>
      </TaskAction>
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
export function Claim({ task = "/mint" }: { task?: string }) {
  const site = useSite();
  const account = useAccount();
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
  const [payments, setPayments] = useState<Record<string, string>>({});
  const payment = payments[task] || "IMD";
  function setPayment(value: string) {
    setPayments((old) => ({ ...old, [task]: value }));
    journal.discard();
  }
  const [selected, setSelected] = useState<number[]>([]);
  const [showIneligible, setShowIneligible] = useState(false);
  const [sharedEligibility, setSharedEligibility] = useState<{
    wallet?: string;
    ids: Record<number, boolean>;
  }>({ ids: {} });
  const mintedReader = useAttestedReader(account.address);
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
        // An incomplete read implies no outcome. Read recovery runs it again.
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
  // #/explorer?address=…&trait=… names a fact to inspect in the Explorer
  // part, not one to request.
  const wanted = /^#\/explorer\b/.test(location.hash)
    ? 0
    : Number(
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
  const checks = useFactChecks(
    facts?.address.toLowerCase() === account.address?.toLowerCase()
      ? facts
      : null,
    paid.map((t) => t.id),
  );
  // Hidden by default only on what is known before any selection; a
  // selected fact keeps its row and shows its eligibility result there.
  function paidIneligible(id: number) {
    if (selected.includes(id)) return false;
    return (
      ineligibleFact(facts, id, checks[id]) ||
      (!facts?.traits.includes(id) &&
        !facts?.verifiedSpecs.includes(id) &&
        sharedEligibility.wallet === account.address &&
        !!sharedEligibility.ids[id])
    );
  }
  async function prepareMint() {
    setBusy("mint");
    setStatus((v) => ({ ...v, mint: "Checking…" }));
    try {
      await journal.prepare(
        "Mint Card",
        "mint",
        [
          {
            label: "Mint Card",
            functionName: "mintCard",
            args: [],
            amount: site.health!.mintFee,
          },
        ],
        [{ name: "Mint Card", amount: site.health!.mintFee }],
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
  // "Mint Facts" and a row's "Mint Facts" open the same dialog;
  // a row's button requests that fact alone and leaves the selection as is.
  async function prepareFacts(ids: number[] = selected) {
    setBusy("facts");
    setStatus((v) => ({ ...v, facts: "Checking…" }));
    try {
      if (!site.health || !facts)
        throw Error("Wallet reads unavailable; retrying.");
      if (!ids.length) throw Error("Select at least one fact.");
      const price = site.health.price;
      const rows = ids.map((id) => paid.find((t) => t.id === id)!);
      await journal.prepare(
        rows.length === 1 && rows[0].kind === 3
          ? `Mint Facts: request shared list ${rows[0].id} / ${rows[0].name}`
          : `Mint Facts: verify ${rows.map((t) => `${t.id} / ${t.name}`).join(", ")}`,
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
      <nav className="task-tabs" aria-label="Choose a task">
        {TASKS.map(([path, title]) => (
          <a
            key={path}
            href={`#${path}`}
            aria-current={task === path ? "page" : undefined}
          >
            {title}
          </a>
        ))}
      </nav>
      <h1>{TASKS.find(([path]) => path === task)?.[1]}</h1>
      {task === "/mint" && (
        <>
          <p className="prose">
            The card is an optional collectible. You can use wallet facts and{" "}
            <a href="#/request">Mint Facts</a> without minting a card. Facts
            belong to your wallet in the Registry contract; the card reads
            them from that contract to render its artwork.
          </p>
          {minted !== null && minted !== 0n ? (
            <p className="minted-card" id="mint">
              This original wallet already minted card #{minted.toString()} and
              cannot mint again, even if that card is transferred.{" "}
              <a href="#/wallet">View the card and wallet facts</a>. Ownership
              of a card does not transfer the original wallet's credentials.
            </p>
          ) : (
            <section className="mint-panel" id="mint">
              <div className="claim-copy">
                <h2>
                  {account.address && !cardReady
                    ? factError
                      ? "Retry wallet reads"
                      : "Reading your card…"
                    : "Mint your Sworn card"}
                </h2>
                {(!account.address || (cardReady && minted === 0n)) && (
                  <>
                    <p>
                      Card fee:{" "}
                      {site.health
                        ? `${imd(site.health.mintFee)} IMD`
                        : "reading fee…"}
                      . No oracle request is needed.
                    </p>
                    <p>
                      <strong>One card per original wallet, once.</strong>{" "}
                      Transferring the NFT changes its owner, not whose facts it
                      represents. The original wallet cannot mint again.
                    </p>
                    <section
                      className="snapshot-summary"
                      id="snapshot"
                      aria-labelledby="snapshot-title"
                    >
                      <h3 id="snapshot-title">
                        The direct facts you will save
                      </h3>
                      <p>
                        Minting permanently saves this wallet's direct-fact
                        result. Future direct-fact checks use that saved result,
                        not later wallet changes. Oracle-verified facts can
                        still be added.
                      </p>
                      {facts ? (
                        <>
                          <p className="wallet-address">
                            Original wallet: <code>{facts.address}</code>
                          </p>
                          <ul>
                            {TRAITS.filter(
                              (t) =>
                                t.class === "direct" &&
                                facts.traits.includes(t.id),
                            ).map((t) => (
                              <li key={t.id}>
                                <strong>{t.name}</strong> — {t.rule}{" "}
                                <span className="muted">(fact {t.id})</span>
                              </li>
                            ))}
                          </ul>
                          {!TRAITS.some(
                            (t) =>
                              t.class === "direct" &&
                              facts.traits.includes(t.id),
                          ) && (
                            <p>
                              No direct facts present. Minting saves this empty
                              result too.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="muted">
                          Connect to preview the direct facts for your wallet.
                          The illustration is sample data.
                        </p>
                      )}
                    </section>
                    <p className="muted">
                      {FEE.charAt(0).toUpperCase() + FEE.slice(1)}.
                    </p>
                    <PaymentChoice
                      id="card-payment"
                      value={payment}
                      onChange={setPayment}
                      disabled={journal.busy || !!busy}
                    />
                  </>
                )}
                <TaskAction connectLabel="Connect to Mint Card">
                  {!cardReady ? null : (
                    <button
                      className="primary"
                      disabled={
                        !!reason || !facts || facts.token !== 0n || !!busy
                      }
                      onClick={prepareMint}
                    >
                      {busy === "mint"
                        ? "Checking…"
                        : facts && facts.token !== 0n
                          ? "Already minted"
                          : "Mint Card"}
                    </button>
                  )}
                </TaskAction>
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
              {facts ? <Card facts={facts} /> : <Card sample />}
            </section>
          )}
        </>
      )}
      {task === "/request" && (
        <section id="mint-facts" className="task-section">
          <p className="prose">
            <strong>Mint Facts stores facts in the Registry contract for your
            wallet, not inside the card.</strong> The card reads those facts
            from the contract to render its artwork. Here, “minted” means
            recorded in the contract; it does not create another NFT. A card
            is optional. Minting a rule or requesting verification uses real IMD and ETH gas.
          </p>
          <p className="prose">
            Choose a rule and ask the swarm to check it. A confirmed request
            starts verification; the fact is only minted after an accepted
            result is stored for your wallet. A shared result must also be
            applied to your wallet. Pending or failed requests add no fact.
          </p>
          {pendingFacts.length > 0 && (
            <section className="pending-notice" aria-label="Pending facts">
              <h2>Waiting for the swarm</h2>
              {pendingFacts.map((fact) => (
                <p key={fact.requestId}>
                  <strong>
                    {fact.id} / {fact.name}
                  </strong>{" "}
                  · Pending since <RequestTime requestId={fact.requestId} />.
                  This fact cannot be requested again until its answer arrives.
                  Other facts and actions remain available.
                </p>
              ))}
            </section>
          )}
          <section id="step-02" className="step">
            <h2>Choose facts to mint</h2>
            <div className="step-intros">
              {classes
                .filter((c) => c.key !== "direct")
                .map((c) => (
                  <p key={c.key}>
                    <strong>{c.name}</strong> · {c.description}
                  </p>
                ))}
            </div>
            <p className="step-note">
              Chain-proven facts use 5 agents / quorum 3. Panel-sworn facts use
              11 / 7. For a requestable fact, unclaimed means unproven. It does
              not mean the fact is false. {SWARMED}
            </p>
            <PaymentChoice
              id="request-payment"
              value={payment}
              onChange={setPayment}
              disabled={journal.busy || !!busy}
            />
            <IneligibleControl
              count={paid.filter((t) => paidIneligible(t.id)).length}
              shown={showIneligible}
              onChange={() => setShowIneligible((v) => !v)}
            />
            <div
              className="trait-picker"
              role="group"
              aria-label="Select paid facts"
            >
              {paid.map((t) => {
                const hidden = !showIneligible && paidIneligible(t.id);
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
                      hidden={hidden}
                      reader={mintedReader}
                      onEligibility={(id, ineligible) =>
                        setSharedEligibility((old) => ({
                          wallet: account.address,
                          ids: {
                            ...(old.wallet === account.address ? old.ids : {}),
                            [id]: ineligible,
                          },
                        }))
                      }
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
                if (hidden) return null;
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
                    {proven && facts ? (
                      <div className="row-actions">
                        <MintedFact
                          facts={facts}
                          id={t.id}
                          reader={mintedReader}
                        />
                      </div>
                    ) : (
                      requestable && (
                        <div className="row-actions">
                          <TaskAction connectLabel="Connect to Mint Facts">
                            <button
                              type="button"
                              className="secondary"
                              disabled={!!reason || !!busy}
                              aria-label={`Mint Facts: ${t.id} / ${t.name}`}
                              onClick={() => prepareFacts([t.id])}
                            >
                              Mint Facts
                            </button>
                          </TaskAction>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            {site.loading ? (
              <Status>Reading community specs…</Status>
            ) : site.error || site.specError ? (
              <Status error>{site.error || site.specError}</Status>
            ) : null}
            <div className="request-action-summary">
              <h3>Review your selected requests</h3>
              <p>
                {selected.length} {selected.length === 1 ? "fact" : "facts"}{" "}
                selected. Request fees:{" "}
                {site.health
                  ? `${imd(site.health.price * BigInt(selected.length))} IMD`
                  : "reading price…"}
                . A false answer or no verdict adds no fact; the request fee is
                still spent.
              </p>
              <PaymentChoice
                id="selected-request-payment"
                value={payment}
                onChange={setPayment}
                disabled={journal.busy || !!busy}
              />
              <p id="oracle-ack" className="muted">
                The payment dialog explains the cost and requires your
                confirmation before any wallet signature.
              </p>
              <TaskAction connectLabel="Connect to Mint Facts">
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
                        (facts?.pending[id] &&
                          !/^0x0+$/.test(facts.pending[id])),
                    )
                  }
                  onClick={() => prepareFacts()}
                >
                  {busy === "facts" ? "Checking…" : "Mint Facts"}
                </button>
              </TaskAction>
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
                <a href={claimAnchor("transaction-steps")}>
                  Transaction steps ↓
                </a>
              )}
            </div>
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
            {/* Pending requests remain inside the fact-request step. */}
            {pendingFacts.length > 0 && (
              <section className="swarm-feed" aria-label="Swarm progress">
                <h4 className="subpart-title">Swarm progress</h4>
                <p className="muted">
                  Live panel progress, not proof. Facts and card updates come
                  from the Registry.
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
          </section>
        </section>
      )}
      {task === "/register" && (
        <section id="step-03" className="task-section">
          <p className="prose">
            Mint Rule registers a reusable, immutable community rule in the
            Registry contract and gives it a rule ID. It does not verify a
            wallet or add a fact to a card. Use <a href="#/request">Mint Facts</a>{" "}
            separately to verify the rule for your wallet and store an accepted
            fact in the contract.
          </p>
          <CommunityIntro />
          <ol className="community-journey">
            <li><strong>Mint Rule.</strong> Choose a template, define its evidence window and register the rule in the contract.</li>
            <li><strong>Mint Facts.</strong> Submit a separate verification request. Only an accepted result adds a wallet fact to the contract; shared results must also be applied.</li>
            <li><strong>Use the fact.</strong> See it on the wallet’s card preview, select it in Curator or check its ID with <code>hasTrait</code>. A card is optional.</li>
          </ol>
          {!!journal.registered&&<div className="community-created" role="status"><strong>Rule {journal.registered} minted in the Registry.</strong><p>The rule is registered; no wallet fact has been verified or minted yet.</p><div className="inline-links"><a href={`#/request?trait=${journal.registered}`}>Mint Facts for your wallet</a><a href={`#/curator?trait=${journal.registered}`}>Use this rule in Curator</a></div></div>}
          <CommunityForm
            payment={payment}
            setPayment={setPayment}
            journal={journal}
          />
        </section>
      )}
    </>
  );
}
