// This API is an optional progress display. Its answers never enable a write or
// establish a credential; only Registry reads do that.
const REQUESTS = "https://api.imd.fun/oracle/requests";
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const created = (r) => Date.parse(r?.createdAt);
export function matchesRequest(r, pending) {
  return (
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
export function progressCounts(r) {
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
  const agreed =
    typeof r.agreement === "number" ? r.agreement : r.agreement?.agreed;
  if (
    agreed !== undefined &&
    agreed !== null &&
    (!Number.isInteger(agreed) || agreed < 0 || agreed > answered)
  )
    throw Error("Incomplete agreement response.");
  return { answered, agreed: agreed ?? null };
}
export function answerText(value) {
  if (value === undefined || value === null) return "unavailable";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export function oracleProgressReader(fetcher = fetch) {
  // Listing responses may contain only summaries. Cache identities, never live
  // members, to avoid repeatedly downloading unrelated panels.
  const identities = new Map();
  let previous;
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
    identities.set(id, {
      id: r.id,
      createdAt: r.createdAt,
      consumer: r.consumer,
      questionHash: r.questionHash,
    });
    return r;
  }
  return async (pending, signal) => {
    const body = await json(REQUESTS, signal);
    const rows = Array.isArray(body) ? body : body?.requests;
    if (!Array.isArray(rows)) throw Error("Incomplete request listing.");
    const candidates = [...rows];
    // A previously matched request remains readable after leaving the recent list.
    if (previous && !candidates.some((r) => r.id === previous.id))
      candidates.push(previous);
    candidates.sort((a, b) => created(b) - created(a));
    for (const row of candidates) {
      if (
        !Number.isFinite(created(row)) ||
        created(row) < Number(pending.requestedAt) * 1000
      )
        continue;
      const identity =
        row.consumer && row.questionHash
          ? row
          : identities.get(row.id) || (await detail(row.id, signal));
      if (!matchesRequest(identity, pending)) continue;
      const result = await detail(row.id, signal);
      if (!matchesRequest(result, pending))
        throw Error("Progress identity changed.");
      progressCounts(result);
      previous = result;
      return result;
    }
    return null;
  };
}
