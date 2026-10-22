import { useState, useRef, useEffect } from "react";
import { useAccount, useConfig } from "wagmi";
import {
  decodeEventLog,
  createWalletClient,
  custom,
  type Address,
  type Hex,
} from "viem";
import { useSite } from "./context";
import { connectedProvider } from "./wallet";
import {
  read,
  scopedClient,
  health,
  contract,
  tokenAbi,
  explain,
  ACTION,
  type WalletFacts,
} from "./chain";
import { imd, ethCeiling, decodeMetadata } from "./pure.mjs";
import { checkEligibility, eligibilityText } from "./eligibility.mjs";
import { checkSharedSpec } from "./shared-safety.mjs";
import { quoteEth, swapCall, type SwapQuote } from "./swap";
import { Card, Status } from "./components";
import { TRAITS } from "./data";
import { SwarmFeed, type WatchedFact } from "./swarm";
export type Call = {
  label: string;
  functionName: string;
  args: any[];
  amount: bigint;
  ids?: number[];
  address?: Address;
  abi?: any;
  value?: bigint;
};
export type Plan = {
  title: string;
  from: string;
  calls: Call[];
  price: bigint;
  amount: bigint;
  balance: bigint;
  account: Address;
  payment: string;
  quote?: SwapQuote;
  preview?: WalletFacts;
  lines: { id?: number; name: string; amount: bigint }[];
};
type Step = {
  label: string;
  state: string;
  error?: string;
  hash?: Hex;
  replacement?: Hex;
  call?: Call;
  result?: { token?: bigint; facts?: WatchedFact[] };
};
const JOURNAL_KEY = "sworn.transaction-journal";
const encode = (value: any) =>
  JSON.stringify(value, (_, v) =>
    typeof v === "bigint" ? { bigint: v.toString() } : v,
  );
function restored() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(JOURNAL_KEY) || "null",
      (_, v) =>
        v &&
        typeof v === "object" &&
        Object.keys(v).length === 1 &&
        "bigint" in v
          ? BigInt(v.bigint)
          : v,
    );
    if (!saved) return {};
    // Migrate older receipt-only journals without inventing a resumable action.
    if (Array.isArray(saved))
      return {
        steps: saved.map((s) => ({
          ...s,
          state: s.state === "confirmed" ? "confirmed" : "unknown",
        })),
      };
    return {
      ...saved,
      steps: saved.steps.map((s: Step) => ({
        ...s,
        state:
          s.state === "confirmed"
            ? "confirmed"
            : s.hash
              ? "unknown"
              : s.state === "simulated"
                ? "simulation expired"
                : ["simulating", "awaiting signature"].includes(s.state)
                  ? "interrupted"
                  : s.state,
      })),
    };
  } catch {
    return {};
  }
}
export function useTransactions() {
  const site = useSite(),
    account = useAccount(),
    config = useConfig();
  const saved = useRef(restored()).current;
  const [plan, setPlan] = useState<Plan | null>(saved.plan || null);
  const [steps, setSteps] = useState<Step[]>(saved.steps || []);
  const [ack, setAck] = useState<boolean>(false);
  const [isOpen, setOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [registered, setRegistered] = useState<number | undefined>(
    saved.registered,
  );
  const lock = useRef(false);
  const [eligibility, setEligibility] = useState<Record<string, any>>({});
  const eligibilityRuns = useRef(new Map<string, number>());
  const [requestAnyway, setRequestAnyway] = useState(false);
  const personalIds =
    plan?.calls
      .filter((c) => c.functionName === "upgrade")
      .flatMap((c) => c.ids || c.args[0]) || [];
  const eligibilityKey = (id: number) =>
    `${account.address?.toLowerCase()}:${id}`;
  // Checks belong to this page and this wallet: leaving the page or switching
  // wallets aborts them, and the RPC pool sends nothing more for them.
  const checks = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    checks.current = controller;
    return () => controller.abort();
  }, [account.address]);
  async function checkPersonal(ids: number[]) {
    if (!account.address) return;
    const wallet = account.address;
    const signal = checks.current.signal;
    await Promise.all(
      ids.map(async (id) => {
        const key = `${wallet.toLowerCase()}:${id}`;
        const run = (eligibilityRuns.current.get(key) || 0) + 1;
        eligibilityRuns.current.set(key, run);
        setEligibility((old) => ({ ...old, [key]: { state: "checking" } }));
        const value = await checkEligibility(
          site.client,
          (id: number, scope: AbortSignal) =>
            read(
              scopedClient(site.client, scope),
              site.r,
              "Registry",
              "specOf",
              [id],
            ),
          wallet,
          id,
          { signal },
        );
        if (signal.aborted) return;
        if (eligibilityRuns.current.get(key) === run)
          setEligibility((old) => ({ ...old, [key]: value }));
      }),
    );
  }
  useEffect(() => {
    setRequestAnyway(false);
    if (
      isOpen &&
      plan?.account.toLowerCase() === account.address?.toLowerCase()
    )
      void checkPersonal(personalIds);
  }, [isOpen, plan, account.address, site.client]);
  const eligibilityChecking = personalIds.some(
    (id) =>
      !eligibility[eligibilityKey(id)] ||
      eligibility[eligibilityKey(id)].state === "checking",
  );
  const eligibilityNegative = personalIds.some(
    (id) => eligibility[eligibilityKey(id)]?.state === "not-met",
  );
  // A running check never disables the steps; a not-met answer that arrives
  // before the request is signed still needs "Request anyway".
  const eligibilityConfirmed = !eligibilityNegative || requestAnyway;
  const latestEligibility = useRef({ eligibilityNegative, requestAnyway });
  latestEligibility.current = { eligibilityNegative, requestAnyway };
  useEffect(() => {
    try {
      localStorage.setItem(JOURNAL_KEY, encode({ plan, steps, registered }));
    } catch {
      setError(
        "Could not save the journal. Keep receipt hashes before reloading.",
      );
    }
  }, [plan, steps, registered]);
  const update = (i: number, patch: Partial<Step>) =>
    setSteps((old) => old.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const next = steps.findIndex((s) => s.state !== "confirmed");
  const available =
    !!site.health &&
    !!account.address &&
    account.address.toLowerCase() === plan?.account.toLowerCase() &&
    account.chainId === site.r.deployment.chainId;
  async function sharedSafety(calls: Call[]) {
    for (const call of calls) {
      const spec =
        call.functionName === "registerSpec"
          ? call.args[0]
          : call.functionName === "requestSharedFact"
            ? await read(site.client, site.r, "Registry", "specOf", [
                call.args[0],
              ])
            : null;
      if (spec && Number(spec.kind) === 3)
        await checkSharedSpec(site.client, spec);
    }
  }
  async function prepare(
    title: string,
    from: string,
    calls: Call[],
    lines: Plan["lines"],
    payment: string,
    preview?: WalletFacts,
  ) {
    if (lock.current) throw Error("A transaction flow is already in progress.");
    if (steps.some((s) => ["pending", "unknown"].includes(s.state)))
      throw Error(
        "Recover the outstanding receipt before preparing another action.",
      );
    setError("");
    if (!site.health) throw Error("Cannot read the chain, retrying.");
    if (!account.address)
      throw Error("Connect a wallet to prepare this action.");
    if (account.chainId !== site.r.deployment.chainId)
      throw Error("Switch to Ethereum before preparing.");
    const fresh = await health(site.client, site.r);
    await sharedSafety(calls);
    if (
      calls.some(
        (c) =>
          ["upgrade", "requestSharedFact"].includes(c.functionName) &&
          c.args[1] !== fresh.price,
      )
    ) {
      await site.refresh();
      throw Error("The live oracle price changed. Prepare again.");
    }
    if (calls.some((c) => c.functionName === "mintCard")) {
      if (
        (await read(site.client, site.r, "Registry", "tokenOf", [
          account.address,
        ])) !== 0n
      )
        throw Error("This wallet already has a card. Refresh wallet reads.");
      if (!preview) throw Error("Read the card's facts before preparing.");
    }
    if (
      calls.some(
        (c) =>
          (c.functionName === "mintCard" && c.amount !== fresh.mintFee) ||
          (c.functionName === "registerSpec" && c.amount !== fresh.specFee),
      )
    )
      throw Error("The live fee changed. Prepare again.");
    const amount = calls.reduce((sum, c) => sum + c.amount, 0n);
    const balance = await site.client.readContract({
      address: fresh.deps.imd,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    let quote: SwapQuote | undefined;
    if (payment === "ETH" && balance < amount)
      quote = await quoteEth(site.client, site.r, amount - balance);
    const allowance = await site.client.readContract({
      address: fresh.deps.imd,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, contract(site.r, "Registry").address],
    });
    const stage: Step[] = [];
    if (quote)
      stage.push({
        label: `Buy exactly ${imd(quote.output)} IMD with ETH`,
        state: "ready",
        call: {
          label: "Buy IMD",
          ...swapCall(site.r, quote, account.address),
          amount: 0n,
        },
      });
    if (allowance < amount) {
      if (allowance > 0n)
        stage.push({
          label: "Reset the previous IMD allowance to zero",
          state: "ready",
          call: {
            label: "Reset allowance",
            address: fresh.deps.imd,
            abi: tokenAbi,
            functionName: "approve",
            args: [contract(site.r, "Registry").address, 0n],
            amount: 0n,
          },
        });
      stage.push({
        label: `Approve exactly ${imd(amount)} IMD to Registry`,
        state: "ready",
        call: {
          label: "Approve IMD",
          address: fresh.deps.imd,
          abi: tokenAbi,
          functionName: "approve",
          args: [contract(site.r, "Registry").address, amount],
          amount: 0n,
        },
      });
    }
    for (const call of calls)
      stage.push({ label: call.label, state: "ready", call });
    const p: Plan = {
      title,
      from,
      calls,
      lines,
      price: fresh.price,
      amount,
      balance,
      account: account.address,
      payment,
      quote,
      preview,
    };
    setPlan(p);
    setSteps(stage);
    setAck(false);
    setRegistered(undefined);
    setOpen(true);
    return p;
  }
  async function checkedCall(index: number) {
    if (!plan || !ack || !available || index !== next)
      throw Error(
        "Confirm the disclaimer and previous steps; wallet and live reads are required.",
      );
    const call = steps[index].call;
    if (!call)
      throw Error(
        "Recovered records cannot be resent. Check the receipt first.",
      );
    const fresh = await health(site.client, site.r);
    if (
      plan.calls.some((c) =>
        ["upgrade", "requestSharedFact"].includes(c.functionName),
      )
    ) {
      if (fresh.price !== plan.price)
        throw Error(
          "The live oracle price changed. Prepare again before signing.",
        );
    }
    // Recheck the complete list before any approval and again before the paid action.
    await sharedSafety(plan.calls);
    if (
      call.functionName === "mintCard" &&
      (await read(site.client, site.r, "Registry", "tokenOf", [
        plan.account,
      ])) !== 0n
    )
      throw Error("This wallet already has a card. Refresh wallet reads.");
    if (call.functionName === "approve") {
      const allowance = await site.client.readContract({
        address: fresh.deps.imd,
        abi: tokenAbi,
        functionName: "allowance",
        args: [plan.account, contract(site.r, "Registry").address],
      });
      if (allowance >= plan.amount || (call.args[1] === 0n && allowance === 0n))
        throw Error(
          "The allowance changed; prepare again to skip an unnecessary approval.",
        );
    }
    if (call.amount > 0n) {
      const balance = await site.client.readContract({
        address: fresh.deps.imd,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [plan.account],
      });
      if (balance < call.amount)
        throw Error(`Insufficient IMD. Balance ${imd(balance)} IMD.`);
    }
    if (
      plan.quote &&
      index === 0 &&
      BigInt(Math.floor(Date.now() / 1000)) >= plan.quote.deadline
    )
      throw Error("The ETH quote expired. Prepare again.");
    return {
      address: call.address || contract(site.r, "Registry").address,
      abi: call.abi || site.r.abis.Registry,
      functionName: call.functionName,
      args: call.args,
      account: plan.account,
      ...(call.value !== undefined ? { value: call.value } : {}),
    };
  }
  async function simulate(index: number) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      update(index, { state: "simulating", error: undefined });
      await site.client.simulateContract(await checkedCall(index));
      update(index, { state: "simulated" });
    } catch (e) {
      const message = explain(
        e,
        steps[index]?.call?.abi || [
          ...site.r.abis.Registry,
          ...site.r.abis.Composer,
        ],
      );
      update(index, { state: "failed", error: message });
      setError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Check only the next step, after consent and its preceding receipt. No wallet
  // request is made here; signing always needs its own button press.
  useEffect(() => {
    if (
      isOpen &&
      ack &&
      available &&
      !busy &&
      next >= 0 &&
      ["ready", "simulation expired", "interrupted"].includes(
        steps[next]?.state,
      )
    )
      void simulate(next);
  }, [isOpen, ack, available, busy, next, steps[next]?.state]);
  async function execute(index = next) {
    if (
      lock.current ||
      !plan ||
      steps[index]?.state !== "simulated" ||
      !eligibilityConfirmed ||
      !ack ||
      !available ||
      index !== next
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    const consent =
      "This wallet does not meet this rule. Press Request anyway to continue.";
    let needsConsent = false;
    try {
      const request = await checkedCall(index);
      // Simulation is refreshed immediately before a single wallet confirmation.
      const simulated = await site.client.simulateContract(request as any);
      const provider: any = await connectedProvider(
        config.connectors,
        account.connector,
      );
      // The latest eligibility is checked again at the signing request itself:
      // a not-met result that arrived during the wallet's own chain checks
      // still needs "Request anyway" before the wallet is asked to sign.
      const guarded = {
        request: (args: any) => {
          const latest = latestEligibility.current;
          if (
            args?.method === "eth_sendTransaction" &&
            latest.eligibilityNegative &&
            !latest.requestAnyway
          ) {
            needsConsent = true;
            return Promise.reject(Error(consent));
          }
          return provider.request(args);
        },
      };
      const wallet = createWalletClient({
        account: plan.account,
        chain: site.r.chain,
        transport: custom(guarded),
      });
      if (
        (await wallet.getChainId()) !== site.r.deployment.chainId ||
        (await wallet.getAddresses())[0]?.toLowerCase() !==
          plan.account.toLowerCase()
      )
        throw Error("Wallet or network changed. Prepare again.");
      const latest = latestEligibility.current;
      if (latest.eligibilityNegative && !latest.requestAnyway) {
        // The step stays checked; it unlocks again after "Request anyway".
        setError(consent);
        return;
      }
      update(index, { state: "awaiting signature", error: undefined });
      const hash = await wallet.writeContract(simulated.request);
      update(index, { state: "pending", hash });
      let replaced = false;
      const receipt = await site.client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 180000,
        onReplaced: ({ transaction }: any) => {
          replaced = true;
          update(index, {
            state: "unknown",
            replacement: transaction.hash,
            error: "Transaction replaced. Check both receipt hashes.",
          });
        },
      });
      if (replaced)
        throw Error(
          "Transaction replaced. Recover its receipt before continuing.",
        );
      if (receipt.status !== "success")
        throw Error("Transaction reverted. No success was recorded.");
      update(index, { state: "confirmed" });
      recordResult(index, receipt);
      await site.refresh();
    } catch (e) {
      if (needsConsent) {
        // Nothing reached the wallet: the step returns to checked.
        update(index, { state: "simulated", error: undefined });
        setError(consent);
        return;
      }
      const message = explain(
        e,
        steps[index]?.call?.abi || [
          ...site.r.abis.Registry,
          ...site.r.abis.Composer,
        ],
      );
      setError(message);
      update(index, {
        state: /rejected/i.test(message)
          ? "rejected"
          : /replaced|timed out|not found/i.test(message)
            ? "unknown"
            : "failed",
        error: message,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function recordResult(index: number, receipt: any) {
    const call = steps[index]?.call;
    if (!call || receipt.status !== "success") return;
    const result: NonNullable<Step["result"]> = {};
    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() !==
        contract(site.r, "Registry").address.toLowerCase()
      )
        continue;
      try {
        const decoded: any = decodeEventLog({
          abi: site.r.abis.Registry,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.eventName === "SpecRegistered" &&
          call.functionName === "registerSpec"
        )
          setRegistered(Number(decoded.args.traitId));
        if (
          decoded.eventName === "CardMinted" &&
          call.functionName === "mintCard" &&
          decoded.args.claimant.toLowerCase() === plan?.account.toLowerCase()
        )
          result.token = decoded.args.tokenId;
        if (
          decoded.eventName === "TraitRequested" &&
          ["upgrade", "requestSharedFact"].includes(call.functionName)
        ) {
          const id = Number(decoded.args.traitId);
          if (id !== Number(call.args[0])) continue;
          result.facts = [
            ...(result.facts || []),
            {
              requestId: decoded.args.requestId,
              id,
              name:
                plan?.lines.find((line) => line.id === id)?.name ||
                TRAITS.find((trait) => trait.id === id)?.name ||
                `Fact ${id}`,
            },
          ];
        }
      } catch {
        /* Unrelated logs do not establish an action result. */
      }
    }
    if (result.token !== undefined || result.facts?.length)
      update(index, { result });
  }
  async function recover(hash: string) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      setError("Enter a full transaction hash (66 characters).");
      return;
    }
    try {
      const receipt = await site.client.getTransactionReceipt({ hash });
      if (!steps.some((s) => s.hash === hash || s.replacement === hash))
        throw Error(
          "Receipt is not matched to this prepared action. Inspect its calldata and logs.",
        );
      // Replacements are deliberately not treated as confirmation of the original call.
      setSteps((old) =>
        old.map((s) =>
          s.hash === hash && !s.replacement
            ? {
                ...s,
                state: receipt.status === "success" ? "confirmed" : "failed",
                error: undefined,
              }
            : s,
        ),
      );
      const index = steps.findIndex((s) => s.hash === hash && !s.replacement);
      if (index >= 0) recordResult(index, receipt);
      setError("");
    } catch (e) {
      setError(`Receipt unavailable. ${explain(e)}`);
    }
  }
  return {
    plan,
    steps,
    ack,
    setAck,
    isOpen,
    setOpen,
    next,
    available,
    busy,
    error,
    registered,
    eligibility,
    eligibilityKey,
    checkPersonal,
    personalIds,
    eligibilityChecking,
    eligibilityNegative,
    eligibilityConfirmed,
    requestAnyway,
    setRequestAnyway,
    prepare,
    retry: (index: number) => {
      if (
        !lock.current &&
        index === next &&
        ["failed", "rejected"].includes(steps[index]?.state)
      ) {
        setError("");
        update(index, { state: "ready", error: undefined });
      }
    },
    execute,
    recover,
    clear: () => {
      if (
        !lock.current &&
        !steps.some((s) => ["pending", "unknown"].includes(s.state))
      ) {
        setPlan(null);
        setSteps([]);
        setError("");
        setRegistered(undefined);
        setOpen(false);
        setAck(false);
      }
    },
  };
}
export type Journal = ReturnType<typeof useTransactions>;
function MintResult({ token }: { token: bigint }) {
  const { client, r } = useSite();
  const [metadata, setMetadata] = useState<any>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setMetadata(undefined);
    setError("");
    read(client, r, "Registry", "tokenURI", [token])
      .then((uri) => {
        if (active) setMetadata(decodeMetadata(uri).data);
      })
      .catch((e) => {
        if (active) setError(explain(e));
      });
    return () => {
      active = false;
    };
  }, [client, r, token, retry]);
  return (
    <div className="payment-preview">
      <h3>Your Sworn card #{token.toString()}</h3>
      {metadata ? (
        <Card facts={{ token, metadata }} />
      ) : (
        <Status error={!!error}>
          {error || "Reading its facts and image…"}
        </Status>
      )}
      {error && (
        <button onClick={() => setRetry((n) => n + 1)}>
          Retry wallet reads
        </button>
      )}
    </div>
  );
}
export function TransactionJournal({ journal: j }: { journal: Journal }) {
  const site = useSite(),
    dialog = useRef<HTMLDialogElement>(null);
  const [hash, setHash] = useState("");
  useEffect(() => {
    const d = dialog.current;
    if (j.isOpen && d && !d.open) d.showModal();
    if (!j.isOpen && d?.open) d.close();
  }, [j.isOpen]);
  const complete = j.steps.length > 0 && j.next === -1;
  const results = j.steps.filter((s) => s.state === "confirmed" && s.result);
  const oraclePayment = j.plan?.calls.some((c) =>
    ["upgrade", "requestSharedFact"].includes(c.functionName),
  );
  const mintPayment = j.plan?.calls.some((c) => c.functionName === "mintCard");
  const registrationPayment = j.plan?.calls.some(
    (c) => c.functionName === "registerSpec",
  );
  return (
    <section id="transaction-steps" className="section journal">
      <h2>Transaction steps</h2>
      {j.plan || j.steps.length ? (
        <>
          <p>
            {j.plan?.title || "Saved transaction receipts"} ·{" "}
            {complete ? "Confirmed" : "Saved on this browser"}
          </p>
          <button onClick={() => j.setOpen(true)}>
            Review transaction steps
          </button>
        </>
      ) : (
        <p className="muted">
          Prepare an action above to review its price and wallet confirmations.
        </p>
      )}
      <dialog
        ref={dialog}
        className="payment-dialog"
        aria-labelledby="payment-title"
        onCancel={() => j.setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) j.setOpen(false);
        }}
      >
        <div className="payment-dialog-body">
          <div className="sheet-head">
            <h2 id="payment-title">
              {j.plan?.title || "Saved transaction receipts"}
            </h2>
            <button
              aria-label="Close payment dialog"
              onClick={() => j.setOpen(false)}
            >
              ×
            </button>
          </div>
          {results.map((s, i) => (
            <section
              key={s.hash || i}
              className="transaction-result"
              aria-label="Transaction result"
            >
              {s.result!.token !== undefined && (
                <MintResult token={s.result!.token} />
              )}
              {s.result!.facts?.map((fact) => (
                <div key={fact.requestId}>
                  <p className="accent" role="status">
                    request sent, the panel answers in a few minutes
                  </p>
                  <SwarmFeed
                    fact={fact}
                    focus={null}
                    onAttested={site.refresh}
                    idPrefix="result"
                  />
                </div>
              ))}
            </section>
          ))}
          {j.plan && (
            <>
              <dl className="payment-summary">
                <div>
                  <dt>Total</dt>
                  <dd>{imd(j.plan.amount)} IMD + gas</dd>
                </div>
                <div>
                  <dt>IMD balance at preparation</dt>
                  <dd>{imd(j.plan.balance)} IMD</dd>
                </div>
                {oraclePayment && (
                  <div>
                    <dt>Live oracle price at preparation</dt>
                    <dd>{imd(j.plan.price)} IMD / request</dd>
                  </div>
                )}
              </dl>
              <ul>
                {j.plan.lines.map((line, i) => (
                  <li key={i}>
                    {line.id ? `${line.id} / ` : ""}
                    {line.name} · {imd(line.amount)} IMD
                  </li>
                ))}
              </ul>
              {j.personalIds.map((id) => (
                <p
                  key={id}
                  className={
                    j.eligibility[j.eligibilityKey(id)]?.state === "not-met"
                      ? "danger"
                      : "muted"
                  }
                  role="status"
                >
                  {j.personalIds.length > 1 ? `${id}: ` : ""}
                  {eligibilityText(
                    j.eligibility[j.eligibilityKey(id)],
                    j.plan!.price,
                  )}
                </p>
              ))}
              {mintPayment && (
                <p>
                  Card fees are forwarded to the IMD BurnExecutor for bridging
                  and burning on Base.
                </p>
              )}
              {registrationPayment && (
                <p>
                  Registration fees are forwarded to the IMD BurnExecutor for
                  bridging and burning on Base.
                </p>
              )}
              {oraclePayment && (
                <p>Oracle requests are paid to the IMD Intake.</p>
              )}
              <p className="muted">
                Pay with: {j.plan.payment}. The live price and simulation are
                checked again before each signature.
              </p>
              {j.plan.preview &&
                !results.some((s) => s.result?.token !== undefined) && (
                  <div className="payment-preview">
                    <h3>Your card's facts</h3>
                    <Card facts={j.plan.preview} />
                    <p>
                      Direct facts:{" "}
                      {j.plan.preview.traits
                        .filter((id) => id < 601)
                        .join(", ") || "none"}
                      . Preview only; a card is never a credential.
                    </p>
                  </div>
                )}
              {j.plan.quote && (
                <p>
                  Buy exactly {imd(j.plan.quote.output)} IMD with at most{" "}
                  {ethCeiling(j.plan.quote.maximum)} ETH, plus gas. 1% input
                  margin; unspent ETH returns in the swap. Quote expires{" "}
                  {new Date(Number(j.plan.quote.deadline) * 1000).toISOString()}
                  .
                </p>
              )}
              <label className="ack">
                <input
                  id="payment-ack"
                  type="checkbox"
                  checked={j.ack}
                  disabled={j.busy}
                  onChange={(e) => j.setAck(e.target.checked)}
                />
                I understand these transactions spend IMD and gas. Oracle
                requests spend their price whatever the answer, including false,
                no verdict or a refused answer; there is no refund.
              </label>
              {j.eligibilityNegative && (
                <button
                  type="button"
                  aria-pressed={j.requestAnyway}
                  disabled={
                    j.requestAnyway ||
                    j.eligibilityChecking ||
                    !j.ack ||
                    !j.available
                  }
                  onClick={() => j.setRequestAnyway(true)}
                >
                  Request anyway
                </button>
              )}
            </>
          )}
          <ol className="journal-steps">
            {j.steps.map((s, i) => (
              <li key={i}>
                <div>
                  <strong>{s.label}</strong>
                  <span
                    className={s.state === "confirmed" ? "accent" : "muted"}
                  >
                    {i > j.next && j.next !== -1 ? "locked" : s.state}
                  </span>
                </div>
                {s.hash && (
                  <a
                    className="receipt"
                    href={`${site.r.deployment.network.explorer}/tx/${s.hash}`}
                  >
                    Receipt: {s.hash}
                  </a>
                )}
                {s.replacement && (
                  <a
                    className="receipt"
                    href={`${site.r.deployment.network.explorer}/tx/${s.replacement}`}
                  >
                    Replacement: {s.replacement}
                  </a>
                )}
                <Status error>{s.error}</Status>
                {s.state !== "confirmed" && (
                  <div className="step-actions">
                    {["failed", "rejected"].includes(s.state) && (
                      <button
                        disabled={
                          j.busy || !j.ack || !j.available || i !== j.next
                        }
                        onClick={() => j.retry(i)}
                      >
                        Retry check
                      </button>
                    )}
                    <button
                      className="primary"
                      disabled={
                        j.busy ||
                        !j.ack ||
                        !j.available ||
                        i !== j.next ||
                        s.state !== "simulated" ||
                        !j.eligibilityConfirmed
                      }
                      onClick={() => j.execute(i)}
                    >
                      {s.call?.label || "Confirm step"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!j.available && j.plan && (
            <Status>
              {!site.health
                ? "Cannot read the chain, retrying."
                : "Connect the preparing wallet on Ethereum to continue."}
            </Status>
          )}
          <Status error>{j.error}</Status>
          {complete && !results.length && (
            <p className="accent" role="status">
              All transaction steps confirmed. Refresh wallet facts to see the
              result.
            </p>
          )}
          {j.registered && (
            <p className="accent" role="status">
              Registered trait {j.registered}. The id comes from SpecRegistered
              in your receipt.{" "}
              <a
                href={`#/claim?trait=${j.registered}`}
                onClick={() => j.setOpen(false)}
              >
                Request this fact
              </a>
            </p>
          )}
          <details>
            <summary>Recover a transaction hash</summary>
            <form
              className="recover-form"
              onSubmit={(e) => {
                e.preventDefault();
                j.recover(hash);
              }}
            >
              <label htmlFor="recover-hash">Transaction hash</label>
              <input
                id="recover-hash"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="0x… (66 characters)"
              />
              <button disabled={j.busy}>Recover receipt</button>
            </form>
          </details>
          <button
            className="secondary"
            disabled={
              j.busy ||
              j.steps.some((s) => ["pending", "unknown"].includes(s.state))
            }
            onClick={j.clear}
          >
            Clear journal
          </button>
        </div>
      </dialog>
    </section>
  );
}
