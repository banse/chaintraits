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
  health,
  contract,
  tokenAbi,
  explain,
  ACTION,
  type WalletFacts,
} from "./chain";
import { imd, ethCeiling } from "./pure.mjs";
import { checkSharedSpec } from "./shared-safety.mjs";
import { quoteEth, swapCall, type SwapQuote } from "./swap";
import { Card, Status } from "./components";
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
  const [ack, setAck] = useState<boolean>(!!saved.ack);
  const [isOpen, setOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [registered, setRegistered] = useState<number | undefined>(
    saved.registered,
  );
  const lock = useRef(false);
  useEffect(() => {
    try {
      localStorage.setItem(
        JOURNAL_KEY,
        encode({ plan, steps, ack, registered }),
      );
    } catch {
      setError(
        "Could not save the journal. Keep receipt hashes before reloading.",
      );
    }
  }, [plan, steps, ack, registered]);
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
      const message = explain(e);
      update(index, { state: "failed", error: message });
      setError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function execute(index = next) {
    if (
      lock.current ||
      !plan ||
      steps[index]?.state !== "simulated" ||
      !ack ||
      !available ||
      index !== next
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const request = await checkedCall(index);
      // Simulation is refreshed immediately before a single wallet confirmation.
      const simulated = await site.client.simulateContract(request as any);
      const provider: any = await connectedProvider(
        config.connectors,
        account.connector,
      );
      const wallet = createWalletClient({
        account: plan.account,
        chain: site.r.chain,
        transport: custom(provider),
      });
      if (
        (await wallet.getChainId()) !== site.r.deployment.chainId ||
        (await wallet.getAddresses())[0]?.toLowerCase() !==
          plan.account.toLowerCase()
      )
        throw Error("Wallet or network changed. Prepare again.");
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
      for (const log of receipt.logs) {
        try {
          const decoded: any = decodeEventLog({
            abi: site.r.abis.Registry,
            data: log.data,
            topics: log.topics,
          });
          if (
            decoded.eventName === "SpecRegistered" &&
            log.address.toLowerCase() ===
              contract(site.r, "Registry").address.toLowerCase()
          )
            setRegistered(Number(decoded.args.traitId));
        } catch {}
      }
      await site.refresh();
    } catch (e) {
      const message = explain(e);
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
    prepare,
    simulate,
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
                <div>
                  <dt>Live oracle price at preparation</dt>
                  <dd>{imd(j.plan.price)} IMD / request</dd>
                </div>
              </dl>
              <ul>
                {j.plan.lines.map((line, i) => (
                  <li key={i}>
                    {line.id ? `${line.id} / ` : ""}
                    {line.name} · {imd(line.amount)} IMD
                  </li>
                ))}
              </ul>
              <p>
                Card and registration fees are forwarded to the IMD BurnExecutor
                for bridging and burning on Base. Oracle requests are paid to
                the IMD Intake.
              </p>
              <p className="muted">
                Pay with: {j.plan.payment}. The live price and simulation are
                checked again before each signature.
              </p>
              {j.plan.preview && (
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
                    <button
                      disabled={
                        j.busy ||
                        !j.ack ||
                        !j.available ||
                        i !== j.next ||
                        s.state === "unknown"
                      }
                      onClick={() => j.simulate(i)}
                    >
                      Simulate {s.call?.label || "step"}
                    </button>
                    <button
                      className="primary"
                      disabled={
                        j.busy ||
                        !j.ack ||
                        !j.available ||
                        i !== j.next ||
                        s.state !== "simulated"
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
          {complete && (
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
