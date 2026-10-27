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
import { factMintState } from "./fact-mint-action.mjs";
import "./fact-mint-actions.css";
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
import { YourSwornCard, ClaimedFacts, RecentVerificationRequests } from "./wallet-facts";
import { requestHistory as buildRequestHistory, feeKey, savedRequestFees, savedRequests } from "./request-history.mjs";
import { TASKS } from "./task-navigation.mjs";
import { eligibilityText } from "./eligibility.mjs";
import { communityFact } from "./community-rule.mjs";
import { FACT_GROUPS, factGroup } from "./claimed-facts.mjs";
import { indexedWallet } from "./indexer.mjs";
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
} from "./fact-ui";
import {
  RequestTime,
  SwarmFeed,
  SWARM_POLL_MS,
  type WatchedFact,
} from "./swarm";
// The connected wallet's open verification requests.
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
  request: (shared: any) => Promise<string>;
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
  const action = factMintState({ wallet: account.address, facts, id: t.id, kind: 3, shared: value, readError: !!error });
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
  async function apply() {
    setBusy(true);
    setStatus("Checking…");
    try {
      if (action !== "apply" || reason) throw Error(reason || "This shared fact cannot be applied to this wallet.");
      await journal.prepare(
        `Mint Fact: apply shared fact ${t.id} / ${t.name}`,
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
      className={`picker-row${proven ? " is-minted" : ""} ${wanted === t.id ? "highlight" : ""}`}
      id={`pick-${t.id}`}
      hidden={hidden}
    >
      <div className="picker-text">
        <div className="fact-description">
          <span>
            <strong>
              {t.id} / {t.name}
            </strong>
            <span className="rule">
              {t.rule}{t.window && ` · ${t.window}`} · <Mark kind="shared" />
              {proven && (
                <>
                  {" · "}
                  <span className="accent">Already proven</span>
                </>
              )}
            </span>
            {t.id >= 10001 && <span className="rule">Registrant: {t.registrant || "unavailable"}</span>}
          </span>
        </div>
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
      ) : (action === "request" || action === "apply") && (
        <div className="row-actions">
          {action === "request" && site.health && <span className="muted fact-request-price">{imd(site.health.price)} IMD + gas</span>}
          <TaskAction connectLabel="Connect to Mint Fact">
            <button
              type="button"
              className="secondary"
              disabled={!!reason || busy}
              aria-label={`${stored ? "Apply shared fact" : "Mint Fact"}: ${t.id} / ${t.name}`}
              onClick={stored ? apply : async () => {
                if (action !== "request" || reason) return;
                setBusy(true);
                setStatus("Checking…");
                try { setStatus(await request(value)); } finally { setBusy(false); }
              }}
            >
              {busy
                ? "Checking…"
                : stored
                  ? "Apply shared fact"
                  : "Mint Fact"}
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
          ? `Mint Rule costs 6.4 IMD. A later verification request on Wallet Facts costs ${exactUnits(site.health.price)} IMD at the current oracle quote, plus gas. The rule fee is forwarded to the BurnExecutor for bridging and burning on Base.`
          : "Mint Rule costs 6.4 IMD. A later verification request on Wallet Facts pays the oracle price, plus gas. The rule fee is forwarded to the BurnExecutor for bridging and burning on Base."}{" "}
        The request price is read again when you prepare; it can change.
        Mint Rule and Mint Fact are separate transactions; minting a rule alone adds no wallet fact.
      </p>
      <p className="muted">
        Mint Rule registers the definition in the contract. The receipt supplies
        its ID; then use <a href="#/request">Wallet Facts</a> separately to verify
        it for your wallet.
      </p>
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
  const { open: openWallet } = useWalletSheet();
  const journal = useTransactions();
  const [facts, setFacts] = useState<WalletFacts | null>(null);
  const currentFacts = facts?.address.toLowerCase() === account.address?.toLowerCase() ? facts : null;
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
  const payment = "IMD";
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
    attempts?: any[];
    fromBlock?: string;
    error?: string;
  }>({ lines: {} });
  const backfills = useMemo(() => pageReads(), [site.client]);
  useEffect(() => () => backfills.stop(), [backfills]);
  useEffect(() => {
    backfills.retryFailed();
  }, [site.readRetry, backfills]);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  useEffect(() => setStatus({}), [account.address]);
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const refresh = () => setRefreshTick(tick => tick + 1);
    window.addEventListener('sworn-request-confirmed', refresh);
    return () => window.removeEventListener('sworn-request-confirmed', refresh);
  }, []);
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
    let active = true;
    const wallet = account.address;
    // Leaving the page or switching wallets stops this read's requests.
    const controller = new AbortController();
    const client = scopedClient(site.client, controller.signal);
    if (wallet && site.health) {
      void (async () => {
        const indexed = await indexedWallet(wallet, contract(site.r, "Registry").address, controller.signal);
        let events: any[] = indexed ? indexed.events : await registryEvents(
          client,
          site.r,
          ["TraitRequested", "Verified", "SharedFactStored", "Missed", "NoVerdict", "Abandoned"],
          undefined,
          { window: HISTORY_WINDOW },
        );
        const fromBlock = String((events as any).fromBlock ?? '');
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
                  "SharedFactStored",
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
        const registry = contract(site.r, 'Registry').address;
        const sharedIds = savedRequests(sessionStorage, site.r.deployment.chainId, registry, wallet)
          .filter((fact: any) => fact.id === 1201 || site.specs.some(spec => spec.id === fact.id && spec.kind === 3))
          .map((fact: any) => fact.requestId);
        const fees = savedRequestFees(sessionStorage);
        const attempts = buildRequestHistory(events, wallet, sharedIds).map(row => ({
          ...row, fee: fees[feeKey(site.r.deployment.chainId, registry, wallet, row.requestId)],
        }));
        if (active)
          setRequestHistory({ wallet, lines: Object.fromEntries(lines), attempts, fromBlock });
      })().catch(() => {
        // An incomplete read implies no outcome. Read recovery runs it again.
        if (active) setRequestHistory({ wallet, lines: {}, error: 'Recent requests could not be read. Your claimed facts are shown separately.' });
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
  const customTraits = site.specs.map(communityFact);
  const paid = [
    ...TRAITS.filter((t) => t.class !== "direct").map((t) => ({
      ...t,
      kind: t.class === "shared" ? 3 : t.class === "panel" ? 5 : 1,
    })),
    ...customTraits,
  ].sort((a, b) => a.id - b.id);
  const personalChecks = paid.filter(t => t.kind !== 3 && currentFacts &&
    !currentFacts.traits.includes(t.id) && !currentFacts.verifiedSpecs.includes(t.id) &&
    !impossible(currentFacts.joined, t.id) &&
    (!currentFacts.pending[t.id] || /^0x0+$/.test(currentFacts.pending[t.id]))).map(t => t.id);
  useEffect(() => {
    if (task === "/request" && currentFacts && site.health && personalChecks.length)
      void journal.checkPersonal(personalChecks);
  }, [task, currentFacts?.address, site.client, !!site.health, site.readRetry, personalChecks.join(",")]);
  const checks = Object.fromEntries(paid.map(t => [t.id, journal.eligibility[journal.eligibilityKey(t.id)]]));
  function paidIneligible(id: number) {
    return (
      ineligibleFact(currentFacts, id, checks[id]) ||
      (!currentFacts?.traits.includes(id) &&
        !currentFacts?.verifiedSpecs.includes(id) &&
        sharedEligibility.wallet === account.address &&
        !!sharedEligibility.ids[id])
    );
  }
  const firstShown = FACT_GROUPS.map(([group]) => group).find((group) =>
    paid.some((t) => factGroup(t.id, TRAITS) === group && (showIneligible || !paidIneligible(t.id))),
  );
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
  async function prepareFact(id: number, shared?: any) {
    const statusKey = `fact-${id}`;
    setBusy(statusKey);
    setStatus(v => ({ ...v, [statusKey]: "Checking…" }));
    try {
      const trait = paid.find(t => t.id === id);
      if (reason || !site.health || !currentFacts || !trait)
        throw Error(reason || "Wallet reads unavailable; retrying.");
      const action = factMintState({ wallet: account.address, facts: currentFacts,
        id, kind: trait.kind, check: checks[id], shared });
      if (action !== "request")
        throw Error(action === "ineligible" ? "This wallet does not meet this rule."
          : action === "claimed" ? "This fact is already claimed."
            : action === "pending" ? "A request is already pending."
              : "Eligibility is not ready. Retry the check before requesting this fact.");
      const price = site.health.price;
      await journal.prepare(
        `Mint Fact: ${trait.kind === 3 ? "request shared list" : "verify"} ${id} / ${trait.name}`,
        "step-02",
        [{ label: `${trait.kind === 3 ? "Request shared fact" : "Request"} ${id} / ${trait.name}`,
          functionName: traitMethod(trait.kind),
          args: trait.kind === 3 ? [id, price] : [[id], price], amount: price, ids: [id] }],
        [{ id, name: trait.name, amount: price }],
        payment,
      );
      const message = "Ready: confirm the steps in the dialog.";
      setStatus(v => ({ ...v, [statusKey]: message }));
      return message;
    } catch (e) {
      const message = explain(e, [...site.r.abis.Registry, ...site.r.abis.Composer]);
      setStatus(v => ({ ...v, [statusKey]: message }));
      return message;
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <h1>{TASKS.find(([path]) => path === task)?.[1]}</h1>
      {task === "/mint" && (
        <>
          {(!minted || minted === 0n) && <p className="prose">
            The card is an optional collectible. You can use wallet facts and{" "}
            <a href="#/request">Wallet Facts</a> without minting a card. Facts
            belong to your wallet in the Registry contract; the card reads
            them from that contract to render its artwork.
          </p>}
          {minted !== null && minted !== 0n ? (
            currentFacts ? <YourSwornCard facts={currentFacts}/> : <section id="your-card">
              <h2>Your Sworn Card</h2>
              <Status error={!!factError}>{factError || 'Reading your card…'}</Status>
              {factError && <button onClick={() => setRefreshTick(tick => tick + 1)}>Retry wallet reads</button>}
            </section>
          ) : (
            <section className="mint-panel" id="mint">
              <div className="claim-copy">
                <h2>
                  {account.address && !cardReady
                    ? factError
                      ? "Retry Wallet Reads"
                      : "Reading Your Card…"
                    : "Mint Your Sworn Card"}
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
                        The Direct Facts You Will Save
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
            Review your claimed facts or choose a new fact to verify. A card is optional.
          </p>
          <nav className="inline-links" aria-label="Wallet Facts sections">
            <a href="#/request#step-02">Choose Facts to Mint</a>
            <a href="#/request#claimed-facts">Claimed Facts</a>
            <a href="#/fact-check">Fact Check</a>
          </nav>
          {/* Facts that can be minted come first, right below the page header. */}
          <section id="step-02" className="step">
            <h2>Choose Facts to Mint</h2>
            <p>A request starts verification. A fact is only stored for your wallet after an accepted result; shared results must also be applied. Pending or failed requests add no fact.</p>
            <p className="request-cost-note">
              Request fees are paid in IMD and are not refunded if no fact is
              proven. Ethereum gas is separate.
            </p>
            <details className="fact-evidence-guide">
              <summary>How verification works</summary>
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
            </details>
            {/* The ineligible-facts link sits in the first shown group's header; above the groups when none is shown. */}
            {firstShown === undefined && (
              <IneligibleControl
                count={paid.filter((t) => paidIneligible(t.id)).length}
                shown={showIneligible}
                onChange={() => setShowIneligible((v) => !v)}
              />
            )}
            {FACT_GROUPS.map(([group, title]) => {
              // Facts the wallet does not hold yet come first; known from its facts at once, so rows never jump.
              const held = (id: number) =>
                !!(currentFacts?.traits.includes(id) || currentFacts?.verifiedSpecs.includes(id));
              const list = paid
                .filter((t) => factGroup(t.id, TRAITS) === group)
                .sort((a, b) => Number(held(a.id)) - Number(held(b.id)));
              if (!list.length) return null;
              // Hidden, not removed: shared rows keep reporting their eligibility while hidden.
              const visible = list.some((t) => showIneligible || !paidIneligible(t.id));
              return (
                <div className="fact-group" key={group} hidden={!visible}>
                  <div className="fact-group-head">
                    <h3 className="fact-group-title">{title}</h3>
                    {group === firstShown && (
                      <IneligibleControl
                        link
                        count={paid.filter((t) => paidIneligible(t.id)).length}
                        shown={showIneligible}
                        onChange={() => setShowIneligible((v) => !v)}
                      />
                    )}
                  </div>
                  <div
                    className="trait-picker single-fact-picker"
                    role="group"
                    aria-label={title}
                  >
                    {list.map((t) => {
                      const hidden = !showIneligible && paidIneligible(t.id);
                      const cant = currentFacts && impossible(currentFacts.joined, t.id);
                      const proven = currentFacts?.traits.includes(t.id) || currentFacts?.verifiedSpecs.includes(t.id);
                      const pending = currentFacts?.pending[t.id] && !/^0x0+$/.test(currentFacts.pending[t.id]);
                      const action = factMintState({ wallet: account.address, facts: currentFacts,
                        id: t.id, kind: t.kind, check: checks[t.id] });
                      const rowStatus = status[`fact-${t.id}`];
                      if (t.kind === 3)
                        return (
                          <SharedFactRow
                            key={`${account.address || "disconnected"}:${t.id}`}
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
                            facts={currentFacts}
                            request={shared => prepareFact(t.id, shared)}
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
                          className={`picker-row${proven ? " is-minted" : ""} ${wanted === t.id ? "highlight" : ""}`}
                        >
                          <div className="picker-text">
                            <div className="fact-description">
                              <strong>
                                {t.id} / {t.name}
                              </strong>
                              <span className="rule">
                                {t.rule}{t.window && ` · ${t.window}`} · <Mark kind={t.class} />
                                {proven && !cant && (
                                  <>
                                    {" · "}
                                    <span className="accent">Already proven</span>
                                  </>
                                )}
                              </span>
                              {t.id >= 10001 && <span className="rule">Registrant: {("registrant" in t && t.registrant) || "unavailable"}</span>}
                              {!proven &&
                                requestHistory.wallet === account.address &&
                                requestHistory.lines[t.id] && (
                                  <span className="muted">
                                    {requestHistory.lines[t.id]}
                                  </span>
                                )}
                              {!proven && !pending && !cant && currentFacts && (
                                <span
                                  className={
                                    checks[t.id]?.state === "not-met"
                                      ? "danger eligibility-advice"
                                      : "muted eligibility-advice"
                                  }
                                  role="status"
                                >
                                  {eligibilityText(
                                    checks[t.id],
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
                              {rowStatus && <p className="row-request-status" role="status">{rowStatus}</p>}
                            </div>
                          </div>
                          {t.id < 10001 ? <Card miniId={t.id} /> : <CommunityCard fact={t} />}
                          {proven && currentFacts ? (
                            <div className="row-actions">
                              <MintedFact
                                facts={currentFacts}
                                id={t.id}
                                reader={mintedReader}
                              />
                            </div>
                          ) : (
                            (action === "request" || action === "unavailable") && (
                              <div className="row-actions">
                                {action === "request" && site.health && <span className="muted fact-request-price">{imd(site.health.price)} IMD + gas</span>}
                                {action === "unavailable" ? <button type="button" className="secondary"
                                  disabled={!!reason || !!busy} onClick={() => journal.checkPersonal([t.id])}>
                                  Retry eligibility
                                </button> : <TaskAction connectLabel="Connect to Mint Fact">
                                  <button type="button" className="secondary" disabled={!!reason || !!busy}
                                    aria-label={`Mint Fact: ${t.id} / ${t.name}`} onClick={() => prepareFact(t.id)}>
                                    {busy === `fact-${t.id}` ? "Checking…" : "Mint Fact"}
                                  </button>
                                </TaskAction>}
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {site.loading ? (
              <Status>Reading community specs…</Status>
            ) : site.error || site.specError ? (
              <Status error>{site.error || site.specError}</Status>
            ) : null}
            {facts &&
              Object.entries({ ...facts.pending, ...sharedPendings })
                .filter(([, rid]) => !/^0x0+$/.test(rid))
                .map(([id, rid]) => (
                  <div key={id}>
                    <h4>{id} / Pending Request</h4>
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
                <h4 className="subpart-title">Swarm Progress</h4>
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
          <ClaimedFacts facts={currentFacts} specs={site.specs} connected={!!account.address}
            error={factError} onRetry={() => setRefreshTick(tick => tick + 1)} onConnect={openWallet}/>
          {pendingFacts.length > 0 && (
            <section className="pending-notice" aria-label="Pending facts">
              <h2>Waiting for the Swarm</h2>
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
          {account.address && <RecentVerificationRequests wallet={account.address}
            rows={requestHistory.wallet === account.address ? requestHistory.attempts : undefined}
            error={requestHistory.wallet === account.address ? requestHistory.error : undefined}
            fromBlock={requestHistory.wallet === account.address ? requestHistory.fromBlock : undefined}
            specs={site.specs} explorer={site.r.deployment.network.explorer}
            onRefresh={() => setRefreshTick(tick => tick + 1)}/>}
        </section>
      )}
      {task === "/register" && (
        <section id="step-03" className="task-section">
          <p className="prose">
            Mint Rule registers a reusable, immutable community rule in the
            Registry contract and gives it a rule ID. It does not verify a
            wallet or add a fact to a card. Use <a href="#/request">Wallet Facts</a>{" "}
            separately to verify the rule for your wallet and store an accepted
            fact in the contract.
          </p>
          <CommunityIntro />
          <ol className="community-journey">
            <li><strong>1. Mint Rule.</strong> Choose a template, define its evidence window and register the rule in the contract.</li>
            <li><strong>2. Wallet Facts.</strong> Submit a separate verification request. Only an accepted result adds a wallet fact to the contract; shared results must also be applied.</li>
            <li><strong>3. Read the fact.</strong> See it on the wallet’s card preview, select it in Curator or check its ID with <code>hasTrait</code>. A card is optional.</li>
          </ol>
          {!!journal.registered&&<div className="community-created" role="status"><strong>Rule {journal.registered} minted in the Registry.</strong><p>The rule is registered; no wallet fact has been verified or minted yet.</p><div className="inline-links"><a href={`#/request?trait=${journal.registered}`}>Mint Facts for your wallet</a><a href={`#/curator?trait=${journal.registered}`}>Use this rule in Curator</a></div></div>}
          <CommunityForm
            payment={payment}
            journal={journal}
          />
        </section>
      )}
    </>
  );
}
