// Change this single constant when hosting a copy with a different indexer.
export const INDEXER_BASE_URL = "https://sworn.vibingco.de/api";
const address = (v) => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v);
const hash = (v) => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v);
const uint = (v) =>
  /^(0|[1-9]\d*)$/.test(String(v)) &&
  (typeof v !== "number" || Number.isSafeInteger(v));
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();

// An optional read must not consume the browser scan's whole deadline. Abort
// includes reading the body, and follows the page/wallet's cancellation signal.
async function json(path, signal) {
  const deadline = AbortSignal.timeout(1500);
  try {
    const response = await fetch(`${INDEXER_BASE_URL}${path}`, {
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      credentials: "omit",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function indexedRules(signal) {
  const data = await json("/rules", signal);
  if (
    !Array.isArray(data?.rules) ||
    !data.rules.every(
      (rule) =>
        rule &&
        Number.isInteger(rule.id) &&
        rule.id >= 10001 &&
        rule.id <= 65535 &&
        Number.isInteger(rule.kind) &&
        rule.kind >= 1 &&
        rule.kind <= 6 &&
        address(rule.target) &&
        address(rule.registrant) &&
        [rule.name, rule.item, rule.arg, rule.fixedArg, rule.sumArg].every(
          (v) => typeof v === "string",
        ) &&
        [rule.threshold, rule.fixedVal, rule.fromBlock, rule.toBlock].every(
          uint,
        ) &&
        Number.isInteger(rule.op) &&
        rule.op >= 0 &&
        rule.op <= 5,
    )
  )
    return null;
  if (new Set(data.rules.map((rule) => rule.id)).size !== data.rules.length)
    return null;
  return data.rules.map((rule) => ({
    ...rule,
    threshold: BigInt(rule.threshold),
    fixedVal: BigInt(rule.fixedVal),
    fromBlock: BigInt(rule.fromBlock),
    toBlock: BigInt(rule.toBlock),
  }));
}

export async function indexedEligibility(wallet, id, signal) {
  // Catalog checks must never use the indexer, including live 601 and 1301.
  if (Number(id) < 10001 || !address(wallet)) return null;
  const data = await json(
    `/rules/${id}/eligibility?wallet=${encodeURIComponent(wallet)}`,
    signal,
  );
  if (
    data?.supported !== true ||
    data.windowFullyIndexed !== true ||
    data.ruleId !== Number(id) ||
    !same(data.wallet, wallet) ||
    !uint(data.count) ||
    !uint(data.threshold) ||
    !uint(data.lastIndexedBlock) ||
    !uint(data.window?.fromBlock) ||
    !uint(data.window?.toBlock) ||
    BigInt(data.window.fromBlock) > BigInt(data.window.toBlock) ||
    BigInt(data.lastIndexedBlock) < BigInt(data.window.toBlock) ||
    !Number.isInteger(data.op) ||
    data.op < 0 ||
    data.op > 5 ||
    typeof data.met !== "boolean" ||
    !Array.isArray(data.transfers)
  )
    return null;
  const count = BigInt(data.count),
    threshold = BigInt(data.threshold);
  const met = [
    count >= threshold,
    count >= threshold,
    count > threshold,
    count <= threshold,
    count < threshold,
    count === threshold,
  ][data.op];
  if (
    met !== data.met ||
    !data.transfers.every(
      (transfer) =>
        transfer &&
        uint(transfer.blockNumber) &&
        uint(transfer.logIndex) &&
        hash(transfer.transactionHash) &&
        uint(transfer.value) &&
        BigInt(transfer.blockNumber) >= BigInt(data.window.fromBlock) &&
        BigInt(transfer.blockNumber) <= BigInt(data.window.toBlock),
    )
  )
    return null;
  return {
    ...data,
    state: met ? "met" : "not-met",
    source: "indexer",
    found: `${data.count} matching ${count === 1n ? "event" : "events"}; threshold ${data.threshold}`,
  };
}

/** Keep real request IDs, blocks and transaction hashes; the API has no log index. */
export async function indexedWallet(wallet, registry, signal) {
  if (!address(wallet)) return null;
  const data = await json(`/wallets/${encodeURIComponent(wallet)}`, signal);
  const states = {
    pending: null,
    verified: "Verified",
    missed: "Missed",
    noverdict: "NoVerdict",
    abandoned: "Abandoned",
  };
  if (
    !same(data?.wallet, wallet) ||
    !uint(data.lastIndexedBlock) ||
    !Array.isArray(data.requests) ||
    !Array.isArray(data.verifiedTraits) ||
    !data.requests.every(
      (request) =>
        request &&
        Object.hasOwn(states, request.state) &&
        hash(request.requestId) &&
        hash(request.questionHash) &&
        Number.isInteger(request.traitId) &&
        request.traitId > 0 &&
        request.traitId <= 65535 &&
        uint(request.requestedBlock) &&
        hash(request.requestedTx) &&
        (request.state === "pending" ||
          (uint(request.resolvedBlock) &&
            hash(request.resolvedTx) &&
            BigInt(request.resolvedBlock) >= BigInt(request.requestedBlock))) &&
        (request.state !== "verified" || hash(request.oracleRequestId)) &&
        (request.state !== "missed" || uint(request.missedReason)) &&
        (request.state !== "noverdict" ||
          (uint(request.noVerdict?.status) &&
            hash(request.noVerdict.reason) &&
            uint(request.noVerdict.agreed) &&
            uint(request.noVerdict.answered))),
    )
  )
    return null;
  if (
    data.card &&
    (!uint(data.card.tokenId) ||
      !uint(data.card.mintBlock) ||
      !hash(data.card.mintTx))
  )
    return null;
  const events = [];
  const event = (name, block, tx, args, key) => ({
    eventName: name,
    address: registry,
    blockNumber: BigInt(block),
    transactionHash: tx,
    args,
    source: "indexer",
    sourceKey: `${key}:${name}`,
  });
  for (const request of data.requests) {
    const args = {
      claimant: wallet,
      traitId: request.traitId,
      requestId: request.requestId,
      questionHash: request.questionHash,
      oracleRequestId: request.oracleRequestId,
    };
    const origin = event(
      "TraitRequested",
      request.requestedBlock,
      request.requestedTx,
      args,
      request.requestId,
    );
    events.push(origin);
    if (request.state !== "pending")
      events.push({
        ...event(
          states[request.state],
          request.resolvedBlock,
          request.resolvedTx,
          {
            ...args,
            ...(request.noVerdict || {}),
            ...(request.state === "missed"
              ? { reason: request.missedReason }
              : {}),
          },
          request.requestId,
        ),
        requestOrigin: origin,
      });
  }
  if (data.card)
    events.push(
      event(
        "CardMinted",
        data.card.mintBlock,
        data.card.mintTx,
        { claimant: wallet, tokenId: BigInt(data.card.tokenId) },
        `card:${data.card.tokenId}`,
      ),
    );
  events.sort((a, b) =>
    a.blockNumber < b.blockNumber
      ? -1
      : a.blockNumber > b.blockNumber
        ? 1
        : a.eventName === "TraitRequested"
          ? -1
          : b.eventName === "TraitRequested"
            ? 1
            : a.sourceKey.localeCompare(b.sourceKey),
  );
  return { ...data, events };
}
