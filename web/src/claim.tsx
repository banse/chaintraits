import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { zeroAddress, type Address } from "viem";
import { useSite } from "./context";
import { lookup, read, explain, contract, type WalletFacts } from "./chain";
import { TRAITS, SWARMED, FEE } from "./data";
import {
  imd,
  exactUnits,
  impossible,
  validateSpec,
  traitMethod,
  MISS_REASONS,
} from "./pure.mjs";
import { Card, Mark, Status, Section, num } from "./components";
import {
  useTransactions,
  TransactionJournal,
  type Journal,
} from "./transactions";
import { useWalletSheet } from "./wallet";
import { sharedState, completion } from "./settlement";
function AckLink() {
  return (
    <a
      href="#/claim#oracle-ack"
      onClick={() =>
        setTimeout(() => document.getElementById("oracle-ack")?.focus(), 0)
      }
    >
      Acknowledge that the price is spent whatever the answer
    </a>
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
}: {
  requestId: string;
  journal: Journal;
}) {
  const site = useSite();
  const account = useAccount();
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [canSettle, setCanSettle] = useState(false);
  const [canAbandon, setCanAbandon] = useState(false);
  async function check() {
    setBusy(true);
    setStatus("Checking the Intake completion over the selected RPC…");
    setCanSettle(false);
    setCanAbandon(false);
    try {
      if (!site.health) throw Error("Live reads unavailable. Retry reads.");
      const found = await completion(
        site.client,
        site.r,
        site.health,
        requestId as any,
      );
      setResult(found);
      const pending = await read(
        site.client,
        site.r,
        "Registry",
        "pendingRequest",
        [requestId],
      );
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
            : explain(e),
        );
      }
    } catch (e) {
      setStatus(explain(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settlement">
      <p className="break">Pending request: {requestId}</p>
      <button disabled={busy || !site.health} onClick={check}>
        {busy ? "Checking…" : "Check verdict delivery"}
      </button>
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
              setStatus("Prepared, see Transaction steps.");
            } catch (e) {
              setStatus(explain(e));
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
              setStatus("Prepared, see Transaction steps.");
            } catch (e) {
              setStatus(explain(e));
            }
          }}
        >
          Prepare abandon
        </button>
      )}
      <Status>{status}</Status>
      {status.startsWith("Prepared") && (
        <a href="#/claim#transaction-steps">Transaction steps ↓</a>
      )}
    </div>
  );
}
function SharedFact({
  id = 1201,
  name = "Top Weights",
  ack,
  payment,
  journal,
  facts,
}: {
  id?: number;
  name?: string;
  ack: boolean;
  payment: string;
  journal: Journal;
  facts?: WalletFacts | null;
}) {
  const site = useSite();
  const account = useAccount();
  const [value, setValue] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setValue(null);
    setError("");
    if (site.health)
      sharedState(site.client, site.r, site.health, id)
        .then((v) => {
          if (active) setValue(v);
        })
        .catch((e) => {
          if (active) setError(explain(e));
        });
    return () => {
      active = false;
    };
  }, [site.health, site.client, id]);
  const stored = value && !/^0x0+$/.test(value.fact[0]);
  const pending = value && !/^0x0+$/.test(value.pending);
  const included = value?.list.some(
    (a: string) => a.toLowerCase() === account.address?.toLowerCase(),
  );
  const cannot = id === 1201 && facts && !facts.joined;
  const reason =
    disableReason(site, account, journal.busy) ||
    (!value
      ? "Shared-fact reads unavailable."
      : cannot
        ? "cannot be true: not in WhitelistCurator.sol"
        : pending
          ? "A request is already pending."
          : stored
            ? included
              ? ""
              : "not in the list"
            : !ack
              ? "Acknowledge the oracle cost."
              : "");
  async function prepare() {
    setBusy(true);
    setStatus("Preparing…");
    try {
      if (!site.health) throw Error("Live reads unavailable.");
      if (stored) {
        await journal.prepare(
          `Apply shared fact ${id} / ${name}`,
          "step-02",
          [
            {
              label: `Apply shared fact ${id} / ${name}`,
              functionName: "applySharedFact",
              args: [id, value.list],
              amount: 0n,
            },
          ],
          [],
          "IMD",
        );
      } else {
        await journal.prepare(
          `Request shared fact ${id} / ${name}`,
          "step-02",
          [
            {
              label: `Request shared fact ${id} / ${name}`,
              functionName: "requestSharedFact",
              args: [id, site.health.price],
              amount: site.health.price,
            },
          ],
          [{ id, name, amount: site.health.price }],
          payment,
        );
      }
      setStatus("Prepared, see Transaction steps.");
    } catch (e) {
      setStatus(explain(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="shared-fact"
      id={id === 1201 ? "shared-fact" : `shared-${id}`}
    >
      <h3>
        {id} / {name}
      </h3>
      <p>
        One attempt at panel 11 / quorum 7 costs{" "}
        {site.health
          ? `${imd(site.health.price)} IMD (priceOf · live)`
          : "the live oracle price per fact"}
        . An attempt whose panel misses the quorum refunds nothing.
      </p>
      <p className="muted">
        {!value
          ? "Reading the shared fact…"
          : stored
            ? "Stored · no further request needed. Listed wallets can apply it for gas only."
            : pending
              ? "Request pending."
              : "not requested yet"}
        {value
          ? ` Attempts: ${num(value.attempts)}. Last panel result: ${value.last ? (value.last.eventName === "Missed" ? `Missed: ${MISS_REASONS[Number(value.last.args.reason)] || value.last.args.reason}` : value.last.eventName === "NoVerdict" ? `No verdict (${value.last.args.agreed}/${value.last.args.answered} agreed)` : value.last.eventName) : "none"}.`
          : ""}
      </p>
      {value?.result?.txHash && (
        <a
          className="source"
          href={`${site.r.deployment.network.explorer}/tx/${value.result.txHash}`}
        >
          Oracle completion and signed result ↗
        </a>
      )}
      <p className="muted">Pay with: {stored ? "gas only" : payment}</p>
      <button disabled={!!reason || busy} onClick={prepare}>
        {busy ? "Preparing…" : stored ? "Prepare apply" : "Prepare shared fact"}
      </button>
      <Status
        error={
          !!error ||
          (status !== "" &&
            !status.startsWith("Prepared") &&
            status !== "Preparing…")
        }
      >
        {error || status || reason}
      </Status>
      {!ack && !stored && <AckLink />}
      {status.startsWith("Prepared") && (
        <a href="#/claim#transaction-steps">Transaction steps ↓</a>
      )}
      {pending && <Settlement requestId={value.pending} journal={journal} />}
    </div>
  );
}
const defaultForm = {
  kind: "1",
  target: "",
  item: "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)",
  arg: "contributor",
  fixedArg: "",
  fixedVal: "0",
  sumArg: "",
  op: "0",
  threshold: "1",
  fromBlock: "25769870",
  toBlock: "25789604",
  name: "",
};
function CommunityForm({
  ack,
  payment,
  journal,
}: {
  ack: boolean;
  payment: string;
  journal: Journal;
}) {
  const site = useSite();
  const account = useAccount();
  const [form, setForm] = useState(defaultForm);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (site.health)
      setForm((old) => ({
        ...old,
        target: old.target || site.health!.deps.curator,
      }));
  }, [site.health]);
  const normalized = {
    ...form,
    target: form.kind === "5" ? zeroAddress : form.target,
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
      "event Deposited(address indexed contributor, uint256 amount)",
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
    setForm((old) => {
      const next = { ...old, [key]: value };
      if (key === "kind") {
        next.arg = Number(value) <= 3 ? "contributor" : "";
        next.fixedArg = "";
        next.fixedVal = "0";
        next.sumArg = ["2", "3"].includes(value) ? "amount" : "";
        next.op = value === "4" ? "1" : "0";
        next.item =
          value === "4"
            ? "function balanceOf(address) view returns (uint256)"
            : value === "5"
              ? ""
              : defaultForm.item;
        if (value === "5") {
          next.fromBlock = "25769870";
          next.toBlock = "25769870";
        }
      }
      return next;
    });
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
        op: Number(form.op),
        fixedVal: BigInt(form.fixedVal),
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
            amount: 6400000000000000000n,
          },
        ],
        [{ name: "Register community spec", amount: 6400000000000000000n }],
        payment,
      );
      setStatus(
        `Prepared, see Transaction steps. The new id will be read from the receipt. A first oracle claim currently costs ${imd(prepared.price)} IMD; this price can change.`,
      );
    } catch (e) {
      setStatus(explain(e));
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
            <option value="1">T1 · Count events</option>
            <option value="2">T2 · Sum events</option>
            <option value="3">T3 · Rank a shared list</option>
            <option value="4">T4 · Compare a contract view</option>
            <option value="5">T5 · Account nonce at a block</option>
          </select>
        </label>
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
                aria-invalid={!!errors[key]}
                aria-describedby={`spec-${key}-error`}
                spellCheck={false}
              />
              <p className="field-error" id={`spec-${key}-error`}>
                {errors[key] || ""}
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
        {busy ? "Preparing…" : "Prepare registration"}
      </button>
      <Status
        error={
          !!status &&
          !status.startsWith("Prepared") &&
          !status.startsWith("Validating")
        }
      >
        {status ||
          disableReason(site, account, journal.busy) ||
          (Object.keys(errors).length ? "Correct the named fields above." : "")}
      </Status>
      {status.startsWith("Prepared") && (
        <a href="#/claim#transaction-steps">Transaction steps ↓</a>
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
  const [factError, setFactError] = useState("");
  const [ack, setAck] = useState(false);
  const [payment, setPayment] = useState("IMD");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const wanted = Number(
    new URLSearchParams(location.hash.split("?")[1]?.split("#")[0]).get(
      "trait",
    ),
  );
  useEffect(() => {
    let active = true;
    setFacts(null);
    setFactError("");
    if (account.address && site.health)
      lookup(site.client, site.r, site.health, account.address, [
        ...TRAITS.map((t) => t.id),
        ...site.specs.map((s) => s.id),
      ])
        .then((v) => {
          if (active) setFacts(v);
        })
        .catch((e) => {
          if (active) setFactError(explain(e));
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
      (TRAITS.some(
        (t) => t.id === wanted && t.class !== "direct" && t.id !== 1201,
      ) ||
        (custom && custom.kind !== 3))
    )
      setSelected([wanted]);
    if (wanted) {
      const timeout = setTimeout(
        () =>
          document
            .getElementById(
              custom?.kind === 3
                ? `shared-${wanted}`
                : wanted === 1201
                  ? "shared-fact"
                  : `pick-${wanted}`,
            )
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
    rule: `T${s.kind} · threshold ${s.threshold}`,
    window: `${num(s.fromBlock)} → ${num(s.toBlock)}`,
    kind: s.kind,
  }));
  const paid = [
    ...TRAITS.filter((t) => t.class !== "direct" && t.id !== 1201).map((t) => ({
      ...t,
      kind: t.class === "panel" ? 5 : 1,
    })),
    ...customTraits.filter((t) => t.kind !== 3),
  ];
  async function prepareMint() {
    setBusy("mint");
    setStatus((v) => ({ ...v, mint: "Preparing…" }));
    try {
      await journal.prepare(
        "Mint your Sworn card",
        "mint",
        [
          {
            label: "Mint one Sworn card",
            functionName: "mintCard",
            args: [],
            amount: 100000000000000000n,
          },
        ],
        [{ name: "Mint card", amount: 100000000000000000n }],
        payment,
      );
      setStatus((v) => ({ ...v, mint: "Prepared, see Transaction steps." }));
    } catch (e) {
      setStatus((v) => ({ ...v, mint: explain(e) }));
    } finally {
      setBusy("");
    }
  }
  async function prepareFacts() {
    setBusy("facts");
    setStatus((v) => ({ ...v, facts: "Preparing…" }));
    try {
      if (!ack) throw Error("Acknowledge the oracle cost.");
      if (!site.health || !facts)
        throw Error("Wallet reads unavailable. Retry reads.");
      if (!selected.length) throw Error("Select at least one fact.");
      const price = site.health.price;
      const rows = selected.map((id) => paid.find((t) => t.id === id)!);
      await journal.prepare(
        `Request ${rows.length} oracle ${rows.length === 1 ? "fact" : "facts"}: ${rows.map((t) => `${t.id} / ${t.name}`).join(", ")}`,
        "step-02",
        rows.map((t) => ({
          label: `Request ${t.id} / ${t.name}`,
          functionName: traitMethod(t.kind),
          args: t.kind === 3 ? [t.id, price] : [[t.id], price],
          amount: price,
          ids: [t.id],
        })),
        rows.map((t) => ({ id: t.id, name: t.name, amount: price })),
        payment,
      );
      setStatus((v) => ({ ...v, facts: "Prepared, see Transaction steps." }));
    } catch (e) {
      setStatus((v) => ({ ...v, facts: explain(e) }));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <h1>Claim</h1>
      <section className="mint-panel" id="mint">
        <div>
          <h2>Mint your Sworn card</h2>
          <p>A card costs 0.10 IMD; no trait claim is needed before minting.</p>
          <p className="accent">Mint your card now. It updates itself.</p>
          <p>{FEE}.</p>
          <p className="muted">Pay with: {payment}</p>
          {!account.address ? (
            <button className="primary" onClick={open}>
              Connect to mint
            </button>
          ) : (
            <button
              className="primary"
              disabled={!!reason || !facts || facts.token !== 0n || !!busy}
              onClick={prepareMint}
            >
              {busy === "mint"
                ? "Preparing…"
                : facts && facts.token !== 0n
                  ? "Already minted"
                  : "Prepare mint"}
            </button>
          )}
          <Status
            error={
              !!factError ||
              (!!status.mint &&
                !status.mint.startsWith("Prepared") &&
                status.mint !== "Preparing…")
            }
          >
            {factError ||
              (facts && facts.token !== 0n
                ? "already minted"
                : status.mint ||
                  reason ||
                  (!facts ? "Reading your wallet…" : ""))}
          </Status>
          {status.mint?.startsWith("Prepared") && (
            <a href="#/claim#transaction-steps">
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
                        {t.rule} · {t.window}
                      </span>
                      <Mark kind={t.class} />
                      {cant ? (
                        <span className="muted">
                          cannot be true: not in WhitelistCurator.sol
                        </span>
                      ) : proven ? (
                        <span className="accent">Already proven</span>
                      ) : pending ? (
                        <span className="muted">Request pending</span>
                      ) : null}
                    </span>
                  </label>
                  {t.id < 10001 && <Card miniId={t.id} />}
                </div>
              );
            })}
          </div>
          <label className="ack">
            <input
              type="checkbox"
              id="oracle-ack"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I understand that the oracle price is spent whatever the answer,
            including a false answer or no verdict.
          </label>
          <p className="muted">
            Pay with: {payment}. One fact per transaction; each request pays the
            full oracle price.
          </p>
          {!ack && (
            <p>
              <AckLink />
            </p>
          )}
          <button
            disabled={
              !!reason ||
              !facts ||
              !ack ||
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
            onClick={prepareFacts}
          >
            {busy === "facts" ? "Preparing…" : "Prepare selected facts"}
          </button>
          <Status
            error={
              !!status.facts &&
              !status.facts.startsWith("Prepared") &&
              status.facts !== "Preparing…"
            }
          >
            {status.facts ||
              reason ||
              (!facts
                ? "Wait for wallet reads."
                : !selected.length
                  ? "Select at least one fact."
                  : !ack
                    ? "Acknowledge the oracle cost."
                    : "")}
          </Status>
          {status.facts?.startsWith("Prepared") && (
            <a href="#/claim#transaction-steps">Transaction steps ↓</a>
          )}
          {facts &&
            Object.entries(facts.pending)
              .filter(([, rid]) => !/^0x0+$/.test(rid))
              .map(([id, rid]) => (
                <div key={id}>
                  <h4>{id} / pending request</h4>
                  <Settlement requestId={rid} journal={journal} />
                </div>
              ))}
          <SharedFact
            ack={ack}
            payment={payment}
            journal={journal}
            facts={facts}
          />
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
            <p className="muted">
              Personal community facts appear in the picker above. Shared
              community facts use their own registered id below.
            </p>
          )}
          {customTraits
            .filter((t) => t.kind === 3)
            .map((t) => (
              <SharedFact
                key={t.id}
                id={t.id}
                name={t.name}
                ack={ack}
                payment={payment}
                journal={journal}
                facts={facts}
              />
            ))}
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
          <CommunityForm ack={ack} payment={payment} journal={journal} />
        </section>
      </section>
      <TransactionJournal journal={journal} />
    </>
  );
}
