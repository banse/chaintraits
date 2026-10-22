// This API is an optional progress display. Its answers never enable a write or
// establish a credential; only Registry reads do that.
const REQUESTS = "https://api.imd.fun/oracle/requests";
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const created = (r) => Date.parse(r?.createdAt);
const knownJob = (value) =>
  typeof value === "string" && value.trim() ? value : undefined;
const personal = (pending) =>
  typeof pending.claimant === "string" && !/^0x0+$/i.test(pending.claimant);
const addresses = (question) =>
  typeof question === "string"
    ? question.match(/(?<![\w])0x[0-9a-f]{40}(?![\w])/gi) || []
    : [];
export function questionWallet(r, pending) {
  if (!personal(pending)) return null;
  const named = addresses(r?.question);
  return named.find((address) => same(address, pending.claimant)) || null;
}
export function isAboutWallet(r, pending) {
  return (
    !personal(pending) ||
    addresses(r?.question).some((address) => same(address, pending.claimant))
  );
}
export class WalletQuestionMismatch extends Error {
  constructor(r, pending) {
    super("This request is not about this wallet.");
    this.wallet = pending.claimant;
  }
}
export function matchesRequest(r, pending) {
  return (
    isAboutWallet(r, pending) &&
    same(r?.consumer?.verifyingContract, pending.registry) &&
    same(r?.questionHash, pending.questionHash) &&
    (r.consumer.chainId === undefined ||
      Number(r.consumer.chainId) === pending.chainId) &&
    Number.isFinite(created(r)) &&
    created(r) >= Number(pending.requestedAt) * 1000
  );
}
export function progressStatus(r) {
  if (r.status === "attested" || r.attestedAt) return "attested";
  if (
    [
      "failed",
      "disagreed",
      "rejected",
      "expired",
      "error",
      "cancelled",
      "no_verdict",
      "no-verdict",
    ].includes(r.status)
  )
    return "failed";
  return "assessing";
}
export function progressCounts(r, spec) {
  if (
    !Array.isArray(r.members) ||
    !Number.isInteger(r.panelSize) ||
    r.panelSize < 1 ||
    !Number.isInteger(r.quorum) ||
    r.quorum < 1 ||
    r.quorum > r.panelSize ||
    r.members.length > r.panelSize ||
    typeof r.status !== "string"
  )
    throw Error("Incomplete progress response.");
  const answered = r.members.filter(
    (m) => m.ok === true || m.ok === false,
  ).length;
  const answers = r.members
    .filter((m) => m.ok === true)
    .map((m) => m.answer?.answer);
  const boolean =
    ["bool", "boolean", 0].includes(r.answerType) ||
    (r.answerType == null &&
      answers.length > 0 &&
      answers.every((answer) => typeof answer === "boolean"));
  const count = [1, 2].includes(Number(spec?.kind));
  const agreed =
    typeof r.agreement === "number" ? r.agreement : r.agreement?.agreed;
  if (
    !boolean &&
    !count &&
    agreed !== undefined &&
    agreed !== null &&
    (!Number.isInteger(agreed) || agreed < 0 || agreed > answered)
  )
    throw Error("Incomplete agreement response.");
  const numbers = answers.map(uintAnswer).filter((v) => v !== null);
  return {
    ...(count
      ? {
          count,
          met: numbers.filter((v) => v >= BigInt(spec.threshold)).length,
          below: numbers.filter((v) => v < BigInt(spec.threshold)).length,
        }
      : {}),
    answered,
    agreed: agreed ?? null,
    boolean,
    trueAnswers: answers.filter((answer) => answer === true).length,
    falseAnswers: answers.filter((answer) => answer === false).length,
  };
}
export function answerText(value) {
  if (value === undefined || value === null) return "unavailable";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
// Registry stores the UUID in the first 16 bytes, with right-hand zero padding.
export function oracleUuid(bytes32) {
  if (
    typeof bytes32 !== "string" ||
    !/^0x[0-9a-f]{32}0{32}$/i.test(bytes32) ||
    /^0x0+$/.test(bytes32)
  )
    return null;
  const hex = bytes32.slice(2, 34).toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function oracleProgressReader(fetcher = fetch) {
  // Cache identities, never panel answers. Each Registry request has its own
  // match, retained when it falls out of the API's newest-100 listing.
  const identities = new Map();
  const selections = new Map();
  async function json(url, signal) {
    const response = await fetcher(url, {
      signal,
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) throw Error("Progress service unavailable.");
    return response.json();
  }
  async function detail(id, signal) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))
      throw Error("Invalid progress request id.");
    const r = await json(`${REQUESTS}/${encodeURIComponent(id)}`, signal);
    if (r?.id !== id) throw Error("Progress request mismatch.");
    const value = {
      ...r,
      jobId: knownJob(r.jobId) ?? identities.get(id)?.jobId,
    };
    identities.set(id, {
      id: r.id,
      createdAt: r.createdAt,
      consumer: r.consumer,
      questionHash: r.questionHash,
      question: r.question,
      jobId: value.jobId,
    });
    return value;
  }
  return async (pending, signal) => {
    const key =
      pending.requestId ||
      `${pending.registry}:${pending.questionHash}:${pending.requestedAt}`;
    const previous = selections.get(key);
    function selected(result, foundBy) {
      if (!isAboutWallet(result, pending))
        throw new WalletQuestionMismatch(result, pending);
      if (
        progressStatus(result) === "assessing" &&
        (result.panelSize == null ||
          result.panelSize === 0 ||
          result.members == null)
      )
        return null;
      progressCounts(result, pending.spec);
      const previousRequestId =
        foundBy === "confirmed by the Registry"
          ? previous?.id !== result.id
            ? previous?.id
            : previous?.previousRequestId
          : undefined;
      const value = {
        ...result,
        jobId:
          knownJob(result.jobId) ??
          identities.get(result.id)?.jobId ??
          (previous?.id === result.id ? previous.jobId : undefined),
        foundBy,
        previousRequestId,
        wallet: questionWallet(result, pending),
      };
      identities.set(result.id, {
        ...identities.get(result.id),
        jobId: value.jobId,
      });
      selections.set(key, value);
      return value;
    }
    // A delivered Registry event is authoritative, even if a prior API match
    // pointed at a duplicate or a different admission.
    const confirmed = oracleUuid(pending.oracleRequestId);
    if (confirmed)
      return selected(
        await detail(confirmed, signal),
        "confirmed by the Registry",
      );

    // Intake admission is the exact link. CORS refusals, timeouts, malformed
    // answers and detail failures all fall through without a visible error.
    if (
      /^0x[0-9a-f]{64}$/i.test(pending.transactionHash || "") &&
      pending.requestId
    ) {
      const intakeSignal = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(4000),
      ]);
      try {
        const intake = await json(
          `https://api.imd.fun/intake/${pending.chainId}/${pending.transactionHash}`,
          intakeSignal,
        );
        const entry = intake?.entries?.find((e) =>
          same(e.requestId, pending.requestId),
        );
        const id = entry?.admission?.result?.requestId;
        if (id) return selected(await detail(id, intakeSignal), "exact");
      } catch (error) {
        if (error instanceof WalletQuestionMismatch) throw error;
        if (signal?.aborted) throw signal.reason;
      }
    }
    // Retain a healthy exact match during an admission outage. If its detail
    // also fails, continue to the claimant-filtered matching path below.
    if (previous?.foundBy === "exact") {
      try {
        return selected(await detail(previous.id, signal), "exact");
      } catch (error) {
        if (error instanceof WalletQuestionMismatch) throw error;
        if (signal?.aborted) throw signal.reason;
      }
    }
    const query =
      pending.claimant && !/^0x0+$/i.test(pending.claimant)
        ? `?q=${encodeURIComponent(pending.claimant)}`
        : "";
    const body = await json(REQUESTS + query, signal);
    const rows = Array.isArray(body) ? body : body?.requests;
    if (!Array.isArray(rows)) throw Error("Incomplete request listing.");
    const candidates = [...rows];
    if (previous && !candidates.some((r) => r.id === previous.id))
      candidates.push(previous);
    // Oldest eligible request wins. A later duplicate cannot take over.
    candidates.sort(
      (a, b) =>
        created(a) - created(b) ||
        (a.id === previous?.id
          ? -1
          : b.id === previous?.id
            ? 1
            : String(a.id).localeCompare(String(b.id))),
    );
    for (const row of candidates) {
      if (
        !Number.isFinite(created(row)) ||
        created(row) < Number(pending.requestedAt) * 1000 ||
        (typeof row.question === "string" && !isAboutWallet(row, pending))
      )
        continue;
      const identity =
        row.consumer && row.questionHash
          ? row
          : identities.get(row.id) || (await detail(row.id, signal));
      if (!matchesRequest(identity, pending)) continue;
      const result = await detail(row.id, signal);
      if (!isAboutWallet(result, pending))
        throw new WalletQuestionMismatch(result, pending);
      if (!matchesRequest(result, pending))
        throw Error("Progress identity changed.");
      return selected(
        { ...result, jobId: knownJob(result.jobId) ?? knownJob(row.jobId) },
        "matched",
      );
    }
    return null;
  };
}

// Never round a count above Number.MAX_SAFE_INTEGER or coerce booleans to votes.
function uintAnswer(value) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    return null;
  if (
    !["number", "bigint", "string"].includes(typeof value) ||
    !/^\d+$/.test(String(value))
  )
    return null;
  return BigInt(value);
}
export function panelAgreement(r, spec) {
  const c = progressCounts(r, spec);
  const finishing =
    "Finishing: the oracle signs the answer and delivers it to the Registry; the fact appears on your card once the Registry stores it.";
  if (c.count) {
    if (c.met >= r.quorum)
      return `Panel agreed: ${c.met} of ${r.quorum} needed found the rule met (at least ${spec.threshold}). ${finishing}`;
    if (c.below >= r.quorum)
      return `Panel agreed: below ${spec.threshold}. The fact is not proven.`;
  } else if (c.boolean) {
    if (c.trueAnswers >= r.quorum)
      return `Panel agreed: ${c.trueAnswers} of ${r.quorum} needed said true. ${finishing}`;
    if (c.falseAnswers >= r.quorum)
      return "Panel agreed: false. The fact is not proven.";
  }
  return null;
}
export function walletList(answer) {
  return Array.isArray(answer) &&
    answer.every((a) => typeof a === "string" && /^0x[0-9a-f]{40}$/i.test(a))
    ? answer
    : null;
}
export function sameList(a, b) {
  return (
    !!a && !!b && a.length === b.length && a.every((v, i) => same(v, b[i]))
  );
}
export function agreedList(r) {
  // The attested answer wins; before that compare with the most common ordered list.
  const attested = [
    r.answer?.answer,
    r.answer,
    r.agreement?.answer?.answer,
    r.agreement?.answer,
  ]
    .map(walletList)
    .find(Boolean);
  if (progressStatus(r) === "attested" && attested) return attested;
  const lists = r.members
    .filter((m) => m.ok === true)
    .map((m) => walletList(m.answer?.answer))
    .filter(Boolean);
  return lists.reduce(
    (best, list) =>
      !best ||
      lists.filter((v) => sameList(v, list)).length >
        lists.filter((v) => sameList(v, best)).length
        ? list
        : best,
    null,
  );
}
