const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const builtinQuestions = {
  601: "Did this wallet complete at least 3 accepted IMD swarm jobs while holding an IDMD seat?",
  701: "Did this wallet deposit again during hours 24–65 of WhitelistCurator?",
  801: "Did this wallet deposit in hour 64 of WhitelistCurator?",
  901: "Did this wallet make a qualifying deposit in hour 65 of WhitelistCurator?",
  1001: "Did this wallet save an hour with a WhitelistCurator HourSaved event?",
  1101: "Was this wallet the first depositor in WhitelistCurator?",
  1102: "Was this wallet the 1,000th first-time depositor in WhitelistCurator?",
  1103: "Was this wallet the 10,000th first-time depositor in WhitelistCurator?",
  1104: "Was this wallet the 19,522nd first-time depositor in WhitelistCurator?",
  1105: "Was this wallet among the first 1,000 depositors in WhitelistCurator?",
  1201: "Was this wallet among the top 32 by total weightAdded in WhitelistCurator?",
  1301: "Was this wallet’s account nonce at least 20 when WhitelistCurator launched?",
};
/** Readable rule summaries, not reconstructed verbatim oracle requests. */
export function shortFactQuestion(id, traits, specs = []) {
  const trait = traits.find((item) => item.id === id);
  if (trait) return builtinQuestions[id] || trait.rule || "";
  const spec = specs.find((item) => Number(item.id) === id);
  if (!spec) return "";
  const kind = Number(spec.kind);
  const item = spec.item?.match(/^(?:event|function)\s+(\w+)/)?.[1];
  const source = `on ${spec.target}, blocks ${spec.fromBlock}–${spec.toBlock}`;
  const filter = `${spec.arg} = this wallet${spec.fixedArg ? ` and ${spec.fixedArg} = ${spec.fixedVal}` : ""}`;
  if (kind === 1 && item)
    return `Were there at least ${spec.threshold} ${item} events with ${filter} (${source})?`;
  if (kind === 2 && item)
    return `Was the sum of ${spec.sumArg} at least ${spec.threshold} in ${item} events with ${filter} (${source})?`;
  if (kind === 3 && item)
    return `Was this wallet among the top ${spec.threshold} wallets by summed ${spec.sumArg}, grouped by ${spec.arg} in ${item} events (${source})?`;
  if (kind === 4 && item) {
    const op = { 1: "≥", 2: ">", 3: "≤", 4: "<", 5: "=" }[Number(spec.op)];
    return op
      ? `Was ${item}(this wallet) ${op} ${spec.threshold} at block ${spec.toBlock} on ${spec.target}?`
      : "";
  }
  if (kind === 5)
    return `Was this wallet’s account nonce at least ${spec.threshold} at block ${spec.toBlock}?`;
  return "";
}
export function decodeDirectFacts(mask, traits) {
  const bits = BigInt(mask);
  return traits
    .filter(
      (trait) =>
        trait.class === "direct" &&
        (bits &
          (1n <<
            BigInt(
              (Math.floor(trait.id / 100) - 1) * 4 + (trait.id % 100) - 1,
            ))) !==
          0n,
    )
    .map(({ id, name }) => ({ id, name }));
}
/** Only successful writes are history. A card snapshot is one simultaneous group. */
export function factHistoryRows(
  events,
  { wallet, registry, traits, frozen = {} },
) {
  const rows = [];
  for (const event of events) {
    if (
      event.removed ||
      !same(event.address, registry) ||
      !same(event.args?.claimant, wallet) ||
      !["Verified", "CardMinted"].includes(event.eventName)
    )
      continue;
    const base = {
      key: `${event.transactionHash}:${event.logIndex}`.toLowerCase(),
      blockNumber: event.blockNumber,
      logIndex: Number(event.logIndex),
      transactionHash: event.transactionHash,
      terminal: event,
    };
    if (event.eventName === "Verified") {
      const factId = Number(event.args.traitId);
      rows.push({
        ...base,
        kind: "verified",
        factId,
        factName: traits.find((t) => t.id === factId)?.name || `Fact ${factId}`,
        requestId: event.args.requestId,
        oracleRequestId: event.args.oracleRequestId,
      });
    } else {
      const tokenId = BigInt(event.args.tokenId);
      const mask = frozen[String(tokenId)];
      if (mask === undefined || mask === null)
        throw Error("Frozen direct snapshot unavailable.");
      const directFacts = decodeDirectFacts(mask, traits);
      if (directFacts.length)
        rows.push({
          ...base,
          kind: "direct",
          factId: 0,
          factName: "Direct facts",
          tokenId,
          directFacts,
        });
    }
  }
  return mergeFactHistory([], rows);
}
export function mergeFactHistory(previous, next) {
  const rows = new Map(previous.map((row) => [row.key, row]));
  for (const row of next) rows.set(row.key, row);
  return [...rows.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? b.logIndex - a.logIndex
      : a.blockNumber > b.blockNumber
        ? -1
        : 1,
  );
}
export function historyEmpty(state) {
  return (
    !state.loading &&
    !state.error &&
    state.coverage.complete &&
    state.rows.length === 0
  );
}
export function updateHistory(state, scope, patch) {
  return state.scope === scope ? { ...state, ...patch } : state;
}
/** Only contiguous, actually scanned intervals may share a coverage claim. */
export function mergeHistoryCoverage(previous, scanned) {
  const continuous =
    previous.first === scanned.first &&
    previous.from !== undefined &&
    previous.to !== undefined &&
    previous.from <= scanned.to + 1n &&
    scanned.from <= previous.to + 1n;
  const from =
    continuous && previous.from < scanned.from ? previous.from : scanned.from;
  const to = continuous && previous.to > scanned.to ? previous.to : scanned.to;
  return { first: scanned.first, from, to, complete: from === scanned.first };
}
