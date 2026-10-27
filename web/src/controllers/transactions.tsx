import { useState, useRef, useEffect, useLayoutEffect, createContext, useContext, type ReactNode } from "react";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";
import { decodeEventLog, createWalletClient, custom, encodeFunctionData, type Address, type Hex } from "viem";
import { useSite } from "../context";
import { connectedProvider, assertWalletContext } from "./wallet-connection.mjs";
import { checkSubmission } from "./submission-check.mjs";
import { journalKey, restoreJournal, encodeJournal } from "../models/transaction-journal.mjs";
import { read, scopedClient, health, contract, tokenAbi, explain, ACTION, type WalletFacts } from "../chain";
import { imd } from "../pure.mjs";
import { checkEligibility } from "../eligibility.mjs";
import { checkSharedSpec } from "../shared-safety.mjs";
import type { SwapQuote } from "../swap";
import { TRAITS } from "../data";
import { type WatchedFact } from "../swarm";
import { resolveReceipt } from "../transaction-intent.mjs";
import { followHive } from "../fact-check/hive-anchor.mjs";
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
  intent?: {
    from: Address;
    to: Address;
    input: Hex;
    value: bigint;
    nonce: number;
  };
  gas?: bigint;
  call?: Call;
  result?: { token?: bigint; facts?: WatchedFact[] };
};
function useTransactionController() {
  const site = useSite(),
    account = useAccount(),
    config = useConfig();
  const binding = { chainId: site.r.deployment.chainId, registry: contract(site.r, "Registry").address };
  const [saved] = useState(() => restoreJournal(() => sessionStorage, binding) as any);
  const [plan, setPlan] = useState<Plan | null>(saved.plan || null);
  const [steps, setSteps] = useState<Step[]>(saved.steps || []);
  const stepsRef = useRef<Step[]>(steps);
  stepsRef.current = steps;
  const [ack, setAck] = useState<boolean>(false);
  const [isOpen, setOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [registered, setRegistered] = useState<number | undefined>(
    saved.registered,
  );
  const [history, setHistory] = useState<any[]>(saved.history || []);
  const opener = useRef<HTMLElement | null>(null);
  const lock = useRef(false);
  // Bumped by discard(): work started for a cleared preparation is ignored.
  const generation = useRef(0);
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
  // Claim starts checks in a child passive effect. Prepare the new wallet's
  // scope first, rather than handing that effect the aborted previous scope.
  useLayoutEffect(() => {
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
      sessionStorage.setItem(
        journalKey(binding),
        encodeJournal(binding, { plan, steps, registered, history }),
      );
    } catch {
      setError(
        "Could not save the journal. Keep receipt hashes before reloading.",
      );
    }
  }, [plan, steps, registered, history]);
  const update = (i: number, patch: Partial<Step>) => {
    const updated = stepsRef.current.map((s, j) =>
      j === i ? { ...s, ...patch } : s,
    );
    stepsRef.current = updated;
    setSteps(updated);
    // Persist the wallet intent/hash synchronously, even when the dialog is hidden.
    try {
      sessionStorage.setItem(
        journalKey(binding),
        encodeJournal(binding, { plan, steps: updated, registered, history }),
      );
    } catch {
      setError(
        "Could not save the journal. Keep receipt hashes before reloading.",
      );
    }
  };
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
    if (payment !== "IMD")
      throw Error("Only IMD fee payments are supported. Prepare again with IMD.");
    if (lock.current) throw Error("A transaction flow is already in progress.");
    if (
      steps.some((s) =>
        ["awaiting signature", "pending", "unknown", "refreshing"].includes(
          s.state,
        ),
      )
    )
      throw Error(
        "Recover the outstanding receipt before preparing another action.",
      );
    setError("");
    opener.current = document.activeElement as HTMLElement | null;
    const account = getAccount(config);
    if (!site.health) throw Error("Cannot read the chain, retrying.");
    if (!account.address)
      throw Error("Connect a wallet to prepare this action.");
    if (account.chainId !== site.r.deployment.chainId)
      throw Error("Switch to Ethereum before preparing.");
    const run = generation.current;
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
    if (balance < amount)
      throw Error(
        `Insufficient IMD. You need ${imd(amount - balance)} more IMD before approving.`,
      );
    const allowance = await site.client.readContract({
      address: fresh.deps.imd,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, contract(site.r, "Registry").address],
    });
    const stage: Step[] = [];
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
    if (run !== generation.current)
      throw Error("The preparation was cleared. Prepare again.");
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
      preview,
    };
    if (steps.some((s) => s.hash))
      setHistory((old) => [...old, { plan, steps }]);
    setPlan(p);
    setSteps(stage);
    setAck(false);
    setRegistered(undefined);
    setOpen(true);
    return p;
  }
  async function checkedCall(index: number) {
    const current = getAccount(config);
    if (
      !plan ||
      !ack ||
      !available ||
      index !== next ||
      current.address?.toLowerCase() !== plan.account.toLowerCase() ||
      current.chainId !== site.r.deployment.chainId
    )
      throw Error(
        "Confirm the disclaimer and previous steps; wallet and live reads are required.",
      );
    const call = steps[index].call;
    if (!call)
      throw Error(
        "Recovered records cannot be resent. Check the receipt first.",
      );
    if (
      plan.payment !== "IMD" || plan.quote ||
      call.functionName === "execute" || (call.value ?? 0n) > 0n
    )
      throw Error("Only IMD fee payments are supported. Recover any outstanding receipt, then prepare again with IMD.");
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
    const run = generation.current;
    setBusy(true);
    setError("");
    try {
      update(index, { state: "simulating", error: undefined });
      const request = await checkedCall(index);
      const checked = await checkSubmission(site.client, request);
      const gas = checked.cost;
      if (run !== generation.current) return;
      update(index, { state: "simulated", gas });
    } catch (e) {
      if (run !== generation.current) return;
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
      if (run === generation.current) {
        lock.current = false;
        setBusy(false);
      }
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
  async function refreshAction(index: number, completed = true) {
    await site.refresh();
    // App refresh reports read failures in UI rather than rejecting. Require a
    // successful read here before releasing the transaction into the next step.
    const fresh = await health(site.client, site.r);
    const call = stepsRef.current[index]?.call;
    if (!completed || !call || !plan) return;
    if (call.functionName === "approve") {
      const allowance = await site.client.readContract({
        address: fresh.deps.imd,
        abi: tokenAbi,
        functionName: "allowance",
        args: [plan.account, contract(site.r, "Registry").address],
      });
      if (call.args[1] === 0n ? allowance !== 0n : allowance < call.args[1])
        throw Error(
          "Receipt settled, but the updated allowance is not available yet. Recover the receipt before continuing.",
        );
    }
    if (
      call.functionName === "mintCard" &&
      (await read(site.client, site.r, "Registry", "tokenOf", [
        plan.account,
      ])) === 0n
    )
      throw Error(
        "Receipt settled, but the minted card is not available yet. Recover the receipt before continuing.",
      );
  }
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
    const run = generation.current;
    setBusy(true);
    setError("");
    const consent =
      "This wallet does not meet this rule. Press Request anyway to continue.";
    let needsConsent = false;
    let submittedHash: Hex | undefined;
    try {
      const request = await checkedCall(index);
      if (run !== generation.current) return;
      // Simulation is refreshed immediately before a single wallet confirmation.
      const simulated = await checkSubmission(site.client, request);
      if (run !== generation.current) return;
      const selectedConnector = getAccount(config).connector;
      const provider: any = await connectedProvider(
        config.connectors,
        selectedConnector,
      );
      if (run !== generation.current) return;
      // The latest eligibility is checked again at the signing request itself:
      // a not-met result that arrived during the wallet's own chain checks
      // still needs "Request anyway" before the wallet is asked to sign.
      const guarded = {
        request: (args: any) => {
          if (run !== generation.current)
            return Promise.reject(Error("The preparation was cleared."));
          if (args?.method === "eth_sendTransaction")
            assertWalletContext(getAccount(config), {
              address: plan.account,
              chainId: site.r.deployment.chainId,
              connector: selectedConnector,
            });
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
      if (run !== generation.current) return;
      const latest = latestEligibility.current;
      if (latest.eligibilityNegative && !latest.requestAnyway) {
        // The step stays checked; it unlocks again after "Request anyway".
        setError(consent);
        return;
      }
      const intent = {
        from: plan.account,
        to: request.address,
        input: encodeFunctionData(request as any),
        value: request.value || 0n,
        nonce: await site.client.getTransactionCount({
          address: plan.account,
          blockTag: "pending",
        }),
      };
      update(index, { state: "awaiting signature", error: undefined, intent });
      const hash = await wallet.writeContract(simulated.request);
      submittedHash = hash;
      update(index, { state: "pending", hash });
      if (["upgrade", "requestSharedFact"].includes(steps[index]?.call?.functionName || "")) {
        setOpen(false);
        followHive(window);
        location.hash = `#/fact-check?wallet=${encodeURIComponent(plan.account)}`;
      }
      // Wallets choose the submitted nonce. Keep our target/data/value intent,
      // but bind it to the actual transaction nonce before checking replacements.
      try {
        const sent = await site.client.getTransaction({ hash });
        update(index, { intent: { ...intent, nonce: sent.nonce } });
      } catch {
        /* Receipt recovery can retry a temporarily unavailable lookup. */
      }
      const receipt = await site.client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 180000,
        onReplaced: ({ transaction }: any) => {
          if (run !== generation.current) return;
          update(index, {
            state: "pending",
            replacement: transaction.hash,
            error:
              "Replacement detected. Checking whether it completes the same action.",
          });
        },
      });
      if (run !== generation.current) return;
      const outcome = await resolveReceipt(
        site.client,
        stepsRef.current[index],
        receipt,
      );
      update(index, { state: "refreshing", error: undefined });
      await refreshAction(index, outcome.state === "confirmed");
      update(index, outcome);
      if (outcome.state === "confirmed") recordResult(index, receipt);
    } catch (e) {
      if (run !== generation.current) return;
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
          : submittedHash || /replaced|timed out|not found/i.test(message)
            ? "unknown"
            : "failed",
        error: message,
      });
    } finally {
      if (run === generation.current) {
        lock.current = false;
        setBusy(false);
      }
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
    if (result.facts?.length)
      window.dispatchEvent(
        new CustomEvent("sworn-request-confirmed", {
          detail: {
            account: plan?.account,
            chainId: site.r.deployment.chainId,
            registry: contract(site.r, "Registry").address,
            transactionHash: receipt.transactionHash,
            facts: result.facts,
            feePerRequest: call.amount.toString(),
          },
        }),
      );
  }
  // Only resolved or unsent plans can be cleared; wallet prompts are unresolved.
  // Completed receipt hashes are retained in history before a fresh preparation.
  function discard() {
    if (
      lock.current ||
      steps.some((s) =>
        ["awaiting signature", "pending", "unknown", "refreshing"].includes(
          s.state,
        ),
      )
    )
      return false;
    if (steps.some((s) => s.hash))
      setHistory((old) => [...old, { plan, steps }]);
    generation.current++;
    lock.current = false;
    setBusy(false);
    setPlan(null);
    setSteps([]);
    setError("");
    setRegistered(undefined);
    setOpen(false);
    setAck(false);
    return true;
  }
  async function recover(hash: string) {
    if (lock.current) return;
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      setError("Enter a full transaction hash (66 characters).");
      return;
    }
    lock.current = true;
    setBusy(true);
    let index = steps.findIndex(
      (s) => s.hash === hash || s.replacement === hash,
    );
    try {
      if (index < 0) {
        const candidate = await site.client.getTransaction({ hash });
        index = steps.findIndex(
          (s) =>
            s.state === "unknown" &&
            s.intent &&
            s.intent.from.toLowerCase() === candidate.from.toLowerCase() &&
            BigInt(s.intent.nonce) === BigInt(candidate.nonce),
        );
      }
      if (index < 0)
        throw Error(
          "Receipt is not matched to this prepared action. Inspect its sender, nonce, calldata and logs.",
        );
      const step = steps[index];
      const finalHash = (
        hash === step.hash && step.replacement ? step.replacement : hash
      ) as Hex;
      const receipt = await site.client.getTransactionReceipt({
        hash: finalHash,
      });
      const outcome = await resolveReceipt(
        site.client,
        step,
        receipt,
        finalHash,
      );
      update(index, {
        state: "refreshing",
        error: undefined,
        ...(step.hash
          ? finalHash !== step.hash
            ? { replacement: finalHash }
            : {}
          : { hash: finalHash }),
      });
      await refreshAction(index, outcome.state === "confirmed");
      update(index, outcome);
      if (outcome.state === "confirmed") recordResult(index, receipt);
      setError("");
    } catch (e) {
      if (index >= 0) update(index, { state: "unknown" });
      setError(`Receipt unavailable. ${explain(e)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      const target = opener.current;
      if (target?.isConnected && !(target as HTMLButtonElement).disabled)
        target.focus();
      else document.getElementById("review-transaction-steps")?.focus();
    });
  }
  function show(open: boolean) {
    if (open && !isOpen)
      opener.current = document.activeElement as HTMLElement | null;
    setOpen(open);
    if (!open) restoreFocus();
  }

  return {
    plan,
    steps,
    ack,
    setAck,
    isOpen,
    setOpen: show,
    restoreFocus,
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
    discard,
    // Hiding a dialog never abandons an outstanding wallet or chain action.
    close: () => show(false),
  };
}
export type Journal = ReturnType<typeof useTransactionController>;
const TransactionContext = createContext<Journal | null>(null);
export function useTransactions() {
  const journal = useContext(TransactionContext);
  if (!journal) throw Error("TransactionProvider is required.");
  return journal;
}
export function TransactionProvider({ children }: { children: ReactNode }) {
  const journal = useTransactionController();
  return (
    <TransactionContext.Provider value={journal}>
      {children}
    </TransactionContext.Provider>
  );
}
