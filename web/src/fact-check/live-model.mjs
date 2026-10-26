import {
  matchesRequest,
  progressCounts,
  progressStatus,
  answerText,
  agreedList,
  oracleUuid,
} from "../oracle-progress.mjs";
import { agentResult, isSharedFact } from "../progress-experience.mjs";

const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const present = (value) => typeof value === "string" && value.length > 0;
const terminalNames = new Set([
  "Verified",
  "SharedFactStored",
  "Missed",
  "NoVerdict",
  "Abandoned",
]);

/** All history comes from Registry logs. Browser journals are not evidence. */
export function discoverRequests(events, wallet, registry) {
  const byId = new Map();
  for (const event of events) {
    if (
      event.removed ||
      event.eventName !== "TraitRequested" ||
      !same(event.address, registry) ||
      !same(event.args?.claimant, wallet)
    )
      continue;
    if (!/^0x[0-9a-f]{64}$/i.test(event.args?.requestId || "")) continue;
    byId.set(event.args.requestId.toLowerCase(), {
      requestId: event.args.requestId,
      traitId: Number(event.args.traitId),
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      origin: event,
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? Number(b.origin.logIndex) - Number(a.origin.logIndex)
      : a.blockNumber > b.blockNumber
        ? -1
        : 1,
  );
}

export function matchedOutcome(event, identity) {
  if (
    !event ||
    event.removed ||
    !terminalNames.has(event.eventName) ||
    !same(event.address, identity.registry) ||
    !same(event.args?.requestId, identity.requestId)
  )
    return null;
  if (event.blockNumber < identity.blockNumber) return null;
  const id = event.args.traitId ?? event.args.factId;
  if (event.eventName !== "Abandoned" && Number(id) !== identity.factId)
    return null;
  if (
    event.eventName === "Verified" &&
    (!same(event.args.claimant, identity.wallet) ||
      !same(identity.claimant, identity.wallet))
  )
    return null;
  return event;
}

/** Exact API/intake IDs still need the full consumer/question binding. */
export function bindProgress(progress, identity) {
  if (!progress) return null;
  if (
    Number(progress.consumer?.chainId) !== identity.chainId ||
    (progress.chainId !== undefined &&
      Number(progress.chainId) !== identity.chainId) ||
    !matchesRequest(progress, identity)
  )
    throw Error(
      "Oracle progress binding does not match this Registry request.",
    );
  progressCounts(progress, identity.spec);
  return progress;
}

export function selectionGuard() {
  let generation = 0;
  return {
    next(key) {
      const id = ++generation;
      return { key, current: () => id === generation };
    },
    stop() {
      generation++;
    },
  };
}

// A uint256 oracle attests one exact integer. Crossing a rule threshold is
// evaluated by the Registry afterward; it is not panel agreement.
function canonicalCount(value) {
  if (
    !["number", "bigint", "string"].includes(typeof value) ||
    !/^\d+$/.test(String(value))
  )
    return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const number = BigInt(value);
  return number < 1n << 256n ? number.toString() : null;
}
function countAgreement(progress, identity) {
  const values = progress.members.map((member) =>
    member.ok === true ? canonicalCount(member.answer?.answer) : null,
  );
  const groups = new Map();
  for (const value of values)
    if (value !== null) groups.set(value, (groups.get(value) || 0) + 1);
  let reference = null;
  if (progressStatus(progress) === "attested") {
    const attestation = progress.attestation;
    if (
      attestation &&
      same(oracleUuid(attestation.requestId), progress.id) &&
      Number(attestation.chainId) === identity.chainId &&
      same(attestation.questionHash, identity.questionHash) &&
      /^0x[0-9a-f]{64}$/i.test(attestation.answer || "")
    )
      reference = BigInt(attestation.answer).toString();
    if (reference === null)
      reference =
        [
          progress.answer?.answer,
          progress.answer,
          progress.agreement?.answer?.answer,
          progress.agreement?.answer,
        ]
          .map(canonicalCount)
          .find((value) => value !== null) ?? null;
  }
  if (reference === null)
    for (const [value, size] of groups)
      if (reference === null || size > groups.get(reference)) reference = value;
  return {
    reference,
    values,
    matching: reference === null ? 0 : groups.get(reference) || 0,
  };
}

/** @param {any} input */
export function liveSnapshot({
  identity,
  progress: raw = null,
  terminal: outcome = null,
  hasFact = null,
  token = null,
  cardImage = undefined,
  cardError = undefined,
  apiError = "",
  chainError = "",
  events = [],
}) {
  const progress = bindProgress(raw, identity);
  const terminal = matchedOutcome(outcome, identity);
  const counts = progress ? progressCounts(progress, identity.spec) : null;
  const countConsensus = counts?.count
    ? countAgreement(progress, identity)
    : null;
  const window = progress?.window || identity.oracleWindow;
  const definitions = progress?.definitions || identity.oracleDefinitions;
  const agreed = progress ? agreedList(progress) : null;
  const listMatching = agreed
    ? progress.members.filter(
        (member) =>
          member.ok === true &&
          agentResult(member, identity.spec, agreed).kind === "positive",
      ).length
    : null;
  const ended = progress && progressStatus(progress) !== "assessing";
  const yes = counts
    ? counts.count
      ? countConsensus.matching
      : counts.boolean
        ? counts.trueAnswers
        : (listMatching ?? counts.agreed)
    : null;
  const no = counts
    ? counts.count
      ? 0
      : counts.boolean
        ? counts.falseAnswers
        : 0
    : null;
  const quorumReached =
    !!progress && (yes >= progress.quorum || no >= progress.quorum);
  const agents = (progress?.members || []).map((member, index) => {
    let result = agentResult(member, identity.spec, agreed, ended);
    if (countConsensus && member.ok === true) {
      const value = countConsensus.values[index];
      result =
        value === null
          ? { kind: "received", icon: "·", label: "Count unavailable" }
          : value === countConsensus.reference
            ? { kind: "positive", icon: "✓", label: "Matching count" }
            : { kind: "negative", icon: "✕", label: "Different count" };
    }
    const tokenId =
      /^\d+$/.test(String(member.tokenId)) &&
      (typeof member.tokenId !== "number" ||
        Number.isSafeInteger(member.tokenId))
        ? String(member.tokenId)
        : undefined;
    return {
      key: tokenId ? `identity-${tokenId}-${index}` : `member-${index}`,
      tokenId,
      state: {
        positive: "agree",
        negative: "disagree",
        error: "failed",
        waiting: "pending",
        missing: "unknown",
        received: "unknown",
      }[result.kind],
      answer:
        member.ok === true ? answerText(member.answer?.answer) : undefined,
      detail: result.label,
    };
  });
  let phase = "admission",
    result = null,
    registryStored = false,
    latestEvent =
      "Ethereum confirmed the request. Waiting for the matching oracle job...",
    notice = "";
  if (progress) {
    phase =
      progressStatus(progress) === "attested"
        ? "delivery"
        : quorumReached
          ? "quorum"
          : "panel";
    latestEvent =
      phase === "delivery"
        ? "Panel result available. Waiting for Registry delivery..."
        : phase === "quorum"
          ? "Required agreement reached. Waiting for the signed panel result..."
          : "Agents are checking the request...";
    if (progressStatus(progress) === "failed") {
      phase = "failed";
      latestEvent =
        "The oracle job ended without a usable result. Checking the Registry outcome...";
    }
  }
  if ((apiError || chainError) && !progress) {
    phase = "offline";
    latestEvent = "Live progress unavailable. Retry the read...";
  }
  const cardless = token === 0n;
  const artworkReady = cardless || present(cardImage);
  if (terminal) {
    if (terminal.eventName === "Verified") {
      registryStored = hasFact === true;
      phase = registryStored && artworkReady ? "saved" : "registry";
      result = phase === "saved" ? true : null;
      latestEvent =
        phase === "saved"
          ? "✓ Registry confirmed this wallet fact."
          : hasFact === true
            ? "Registry confirmed. Loading your current card..."
            : "Registry event found. Checking the wallet fact...";
    } else if (terminal.eventName === "SharedFactStored") {
      registryStored = true;
      phase = "saved";
      latestEvent = "✓ Shared result stored in the Registry.";
      notice =
        "This is a shared list result. Storage does not automatically add a fact to this wallet; eligible wallets must apply the stored list.";
    } else if (
      terminal.eventName === "Missed" &&
      Number(terminal.args.reason) === 8
    ) {
      phase = "negative";
      result = artworkReady ? false : null;
      latestEvent =
        "✓ Registry confirmed a negative answer. No fact was added.";
    } else {
      phase = "failed";
      latestEvent =
        terminal.eventName === "NoVerdict"
          ? "No verdict reached. No fact was added."
          : terminal.eventName === "Abandoned"
            ? "Request abandoned. No fact was added."
            : "Registry did not accept this result. No fact was added.";
    }
  }
  if (apiError)
    notice = [notice, `Agent progress unavailable: ${apiError}`]
      .filter(Boolean)
      .join(" ");
  if (chainError)
    notice = [notice, `Registry read unavailable: ${chainError}`]
      .filter(Boolean)
      .join(" ");
  if (isSharedFact(identity.factId, identity.spec) && !notice)
    notice =
      "Shared list answers compare complete wallet lists; individual answers are not Boolean wallet eligibility.";
  return {
    key: `${identity.chainId}:${identity.registry}:${identity.wallet}:${identity.requestId}`.toLowerCase(),
    mode: "live",
    phase,
    wallet: identity.wallet,
    ensName: identity.ensName,
    factId: identity.factId,
    factName: identity.factName,
    answerKind: counts?.count
      ? "count"
      : isSharedFact(identity.factId, identity.spec)
        ? "list"
        : counts?.boolean
          ? "boolean"
          : "unknown",
    question:
      progress?.question ||
      identity.oracleQuestion ||
      "The exact oracle question is not available yet. It will appear when a matching request is read.",
    shortQuestion: identity.shortQuestion || identity.factName,
    panelSize: progress?.panelSize ?? null,
    quorum: progress?.quorum ?? null,
    agents,
    quorumReached,
    matchingAnswers: countConsensus?.matching ?? listMatching ?? undefined,
    result,
    registryStored,
    cardImage,
    cardless,
    cardLoading: !!terminal && !artworkReady && !cardError,
    cardError,
    requestId: identity.requestId,
    transactionHash:
      identity.transactionHash || identity.origin?.transactionHash,
    jobUrl:
      progress?.jobId && /^[a-zA-Z0-9_-]+$/.test(progress.jobId)
        ? `https://explorer.imd.fun/jobs/${progress.jobId}`
        : undefined,
    evidenceWindow: window
      ? `Ethereum blocks ${window.fromBlock ?? "?"}–${window.toBlock ?? "?"}`
      : identity.evidenceWindow ||
        `Request block ${identity.blockNumber.toLocaleString("en-US")} · Ethereum`,
    definitions: definitions
      ? JSON.stringify(
          {
            registry: identity.registry,
            questionHash: identity.questionHash,
            window,
            definitions,
            evidence: progress?.evidence || identity.oracleEvidence,
          },
          null,
          2,
        )
      : identity.definitions ||
        `Registry ${identity.registry}\nQuestion hash ${identity.questionHash}`,
    latestEvent,
    events,
    notice: notice || undefined,
  };
}
