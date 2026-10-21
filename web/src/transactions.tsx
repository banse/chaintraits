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
import { useWalletSheet, connectedProvider } from "./wallet";
import { read, health, contract, tokenAbi, explain, ACTION } from "./chain";
import { imd, ethCeiling, MISS_REASONS } from "./pure.mjs";
import { quoteEth, swapCall, type SwapQuote } from "./swap";
import { Status } from "./components";
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
  account: Address;
  payment: string;
  quote?: SwapQuote;
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
export function useTransactions() {
  const site = useSite();
  const account = useAccount();
  const config = useConfig();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<Step[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
      return saved.map((s: any) => ({
        ...s,
        state: s.state === "confirmed" ? "confirmed" : "unknown",
        call: undefined,
      }));
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState<number>();
  const lock = useRef(false);
  useEffect(() => {
    try {
      localStorage.setItem(
        JOURNAL_KEY,
        JSON.stringify(steps.map(({ call, ...s }) => s)),
      );
    } catch {
      setError(
        "This browser could not save the journal. Keep receipt hashes before reloading.",
      );
    }
  }, [steps]);
  useEffect(() => {
    setPlan(null);
  }, [account.address, account.chainId, site.rpcUrl]);
  const update = (i: number, s: Partial<Step>) =>
    setSteps((old) => old.map((v, j) => (j === i ? { ...v, ...s } : v)));
  async function prepare(
    title: string,
    from: string,
    calls: Call[],
    lines: Plan["lines"],
    payment: string,
  ) {
    if (lock.current) throw Error("A transaction flow is already in progress.");
    setError("");
    if (!account.address)
      throw Error("Connect a wallet to prepare this action.");
    if (account.chainId !== site.r.deployment.chainId)
      throw Error("Switch to Ethereum before preparing.");
    const fresh = await health(site.client, site.r);
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
    const amount = calls.reduce((sum, c) => sum + c.amount, 0n);
    const p: Plan = {
      title,
      from,
      calls,
      price: fresh.price,
      amount,
      account: account.address,
      payment,
      lines,
    };
    let quote: SwapQuote | undefined;
    const balance = await site.client.readContract({
      address: fresh.deps.imd,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (payment === "ETH" && balance < amount)
      quote = await quoteEth(site.client, site.r, amount - balance);
    if (payment === "IMD" && balance < amount)
      throw Error(
        `Insufficient IMD. This action needs ${imd(amount)} IMD; your balance is ${imd(balance)} IMD.`,
      );
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
    const allowance = await site.client.readContract({
      address: fresh.deps.imd,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, contract(site.r, "Registry").address],
    });
    if (amount > 0n && allowance !== amount) {
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
    p.quote = quote;
    setPlan(p);
    setSteps(stage);
    setRegistered(undefined);
    return p;
  }
  async function execute() {
    if (lock.current || !plan || steps.some((s) => s.state === "unknown"))
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    let current = -1;
    try {
      const provider: any = await connectedProvider(
        config.connectors,
        account.connector,
      );
      if (!provider || !account.address) throw Error("Reconnect your wallet.");
      const wallet = createWalletClient({
        account: account.address,
        chain: site.r.chain,
        transport: custom(provider),
      });
      if (account.address !== plan.account)
        throw Error("Wallet changed. Prepare again.");
      if ((await wallet.getChainId()) !== site.r.deployment.chainId)
        throw Error("Switch to Ethereum, then prepare again.");
      const fresh = await health(site.client, site.r);
      if (
        plan.calls.some((c) =>
          ["upgrade", "requestSharedFact"].includes(c.functionName),
        ) &&
        fresh.price !== plan.price
      )
        throw Error(
          "The live oracle price changed. Prepare again before signing.",
        );
      for (let i = 0; i < steps.length; i++) {
        current = i;
        const step = steps[i];
        if (step.state === "confirmed") continue;
        if (!step.call)
          throw Error(
            "Recovered records cannot be resent. Prepare a new action after checking the receipt.",
          );
        if (
          (await wallet.getChainId()) !== site.r.deployment.chainId ||
          (await wallet.getAddresses())[0]?.toLowerCase() !==
            plan.account.toLowerCase()
        )
          throw Error("Wallet or network changed. Prepare again.");
        if (
          plan.quote &&
          i === 0 &&
          BigInt(Math.floor(Date.now() / 1000)) >= plan.quote.deadline
        )
          throw Error(
            "The ETH quote expired. Prepare again for a fresh 120-second quote.",
          );
        if (["upgrade", "requestSharedFact"].includes(step.call.functionName)) {
          const price = await site.client.readContract({
            address: fresh.deps.intake,
            abi: site.r.abis.IntakeV2,
            functionName: "priceOf",
            args: [ACTION, fresh.deps.imd],
          });
          if (price !== plan.price)
            throw Error("The live oracle price changed. Prepare again.");
        }
        update(i, { state: "simulating", error: undefined });
        const c = step.call;
        const request: any = {
          address: c.address || contract(site.r, "Registry").address,
          abi: c.abi || site.r.abis.Registry,
          functionName: c.functionName,
          args: c.args,
          account: plan.account,
          ...(c.value !== undefined ? { value: c.value } : {}),
        };
        const simulated = await site.client.simulateContract(request);
        if (
          (await wallet.getChainId()) !== site.r.deployment.chainId ||
          (await wallet.getAddresses())[0]?.toLowerCase() !==
            plan.account.toLowerCase()
        )
          throw Error("Wallet or network changed. Prepare again.");
        update(i, { state: "awaiting signature" });
        const hash = await wallet.writeContract(simulated.request);
        update(i, { state: "pending", hash });
        let replaced = false;
        const receipt = await site.client.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 180000,
          onReplaced: ({ transaction }: any) => {
            replaced = true;
            update(i, {
              state: "unknown",
              replacement: transaction.hash,
              error:
                "Transaction replaced. Check both hashes; this action is not marked confirmed.",
            });
          },
        });
        if (replaced)
          throw Error(
            "A broadcast was replaced. Recover its hash before preparing another action.",
          );
        if (receipt.status !== "success")
          throw Error("Transaction reverted. No success was recorded.");
        update(i, { state: "confirmed" });
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
      }
      setPlan(null);
      await site.refresh();
    } catch (e) {
      const message = explain(e);
      setError(message);
      if (current >= 0)
        update(current, {
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
    setError("");
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      setError(
        "Enter the full transaction hash, 0x followed by 64 hexadecimal characters.",
      );
      return;
    }
    try {
      const [tx, receipt] = await Promise.all([
        site.client.getTransaction({ hash }),
        site.client.getTransactionReceipt({ hash }),
      ]);
      const relevant = steps.find((s) => s.hash === hash);
      if (relevant) {
        setSteps((old) =>
          old.map((s) =>
            s.hash === hash
              ? {
                  ...s,
                  state: receipt.status === "success" ? "confirmed" : "failed",
                  error:
                    receipt.status === "success"
                      ? undefined
                      : "Transaction reverted.",
                }
              : s,
          ),
        );
      } else {
        setSteps((old) => [
          ...old,
          {
            label: `Recovered receipt · ${tx.to || "contract creation"}`,
            hash: hash as Hex,
            state:
              receipt.status === "success" ? "receipt successful" : "failed",
            error:
              "This receipt is not matched to a prepared Sworn action. Inspect its calldata and logs before proceeding.",
          },
        ]);
      }
    } catch (e) {
      setError(
        `Receipt unavailable. The transaction may still be pending or replaced. ${explain(e)}`,
      );
    }
  }
  return {
    plan,
    steps,
    busy,
    error,
    registered,
    prepare,
    execute,
    recover,
    clear: () => {
      if (!lock.current) {
        setPlan(null);
        setSteps([]);
        setError("");
        setRegistered(undefined);
      }
    },
  };
}
export type Journal = ReturnType<typeof useTransactions>;
export function TransactionJournal({ journal }: { journal: Journal }) {
  const { r } = useSite();
  const account = useAccount();
  const { open } = useWalletSheet();
  const [hash, setHash] = useState("");
  return (
    <section id="transaction-steps" className="section journal">
      <h2>{journal.plan?.title || "Transaction steps"}</h2>
      {journal.plan && (
        <>
          <a href={`#/claim#${journal.plan.from}`}>
            from{" "}
            {journal.plan.from === "mint"
              ? "mint card"
              : journal.plan.from === "step-02"
                ? "step 02"
                : "step 03"}
          </a>
          <h3>Exact amount</h3>
          <ul>
            {journal.plan.lines.map((line, i) => (
              <li key={i}>
                {line.id ? `${line.id} / ` : ""}
                {line.name} · {imd(line.amount)} IMD
              </li>
            ))}
          </ul>
          <p>
            Total: <strong>{imd(journal.plan.amount)} IMD</strong> + gas. Pay
            with: {journal.plan.payment}.
          </p>
          {journal.plan.quote && (
            <div className="info">
              <p>
                Buy exactly {imd(journal.plan.quote.output)} IMD. You commit at
                most {ethCeiling(journal.plan.quote.maximum)} ETH, plus gas.
                Maximum input is 1% above the quote. Unspent ETH returns to your
                wallet in the same swap.
              </p>
              <details>
                <summary>Exact swap details</summary>
                <p>Quoted input: {journal.plan.quote.input.toString()} wei</p>
                <p>
                  Maximum input: {journal.plan.quote.maximum.toString()} wei
                </p>
                <p>
                  Deadline:{" "}
                  {new Date(
                    Number(journal.plan.quote.deadline) * 1000,
                  ).toISOString()}{" "}
                  (120 seconds from quote)
                </p>
                <p>Market id: {journal.plan.quote.id}</p>
              </details>
            </div>
          )}
        </>
      )}
      {journal.steps.length ? (
        <ol className="journal-steps">
          {journal.steps.map((step, i) => (
            <li key={i}>
              <div>
                <strong>{step.label}</strong>
                <span
                  className={
                    /confirmed|successful/.test(step.state)
                      ? "accent"
                      : /failed|rejected|unknown/.test(step.state)
                        ? "danger"
                        : "muted"
                  }
                >
                  {step.state}
                </span>
              </div>
              {step.hash && (
                <a
                  className="receipt"
                  href={`${r.deployment.network.explorer}/tx/${step.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Receipt: {step.hash}
                </a>
              )}
              {step.replacement && (
                <p>
                  Replacement:{" "}
                  <a
                    href={`${r.deployment.network.explorer}/tx/${step.replacement}`}
                  >
                    {step.replacement}
                  </a>
                </p>
              )}
              <Status error>{step.error}</Status>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">
          Prepare an action above to review its exact cost and numbered wallet
          confirmations. Reloading never resends a transaction.
        </p>
      )}
      {!account.isConnected ? (
        <button onClick={open}>Connect</button>
      ) : (
        journal.plan && (
          <button
            className="primary"
            disabled={
              journal.busy ||
              account.chainId !== r.deployment.chainId ||
              journal.steps.some((s) => s.state === "unknown")
            }
            onClick={journal.execute}
          >
            {journal.busy
              ? "Transaction in progress…"
              : journal.steps.some((s) => s.state === "unknown")
                ? "Recover receipt before continuing"
                : "Confirm transaction steps"}
          </button>
        )
      )}
      <Status error>{journal.error}</Status>
      {journal.registered && (
        <p className="accent" role="status">
          Registered trait {journal.registered}. The id comes from
          SpecRegistered in your receipt.{" "}
          <a href={`#/claim?trait=${journal.registered}`}>Request this fact</a>
        </p>
      )}
      <details>
        <summary>Recover a transaction hash</summary>
        <form
          className="recover-form"
          onSubmit={(e) => {
            e.preventDefault();
            journal.recover(hash);
          }}
        >
          <label htmlFor="recover-hash">Transaction hash</label>
          <input
            id="recover-hash"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            placeholder="0x… (66 characters)"
          />
          <button disabled={journal.busy}>Recover receipt</button>
        </form>
      </details>
      <button
        className="secondary"
        disabled={journal.busy}
        onClick={journal.clear}
      >
        Clear journal
      </button>
      {account.address && (
        <a className="source" href={`#/explorer?address=${account.address}`}>
          View this wallet in Explorer ↗
        </a>
      )}
    </section>
  );
}
