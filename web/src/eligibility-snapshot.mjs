import pin from "./eligibility-snapshot-pin.mjs";

export const snapshotFact = (id) => pin.factIds.includes(Number(id));

// One shared, verified shard promise for all nine facts and the row/dialog recheck.
// A failed load is not cached: reopening the dialog can retry without affecting site health.
export function snapshotReader({
  fetcher = (...args) => fetch(...args),
  digest = (bytes) => crypto.subtle.digest("SHA-256", bytes),
  base = () => document.baseURI,
} = {}) {
  const shards = new Map();
  async function load(prefix) {
    const name = `wallets-${prefix}.json`,
      file = pin.files[name];
    if (!shards.has(name)) {
      const pending = (async () => {
        const response = await fetcher(
          new URL(`data/eligibility/${name}`, base()).href,
        );
        if (!response.ok) throw Error("Snapshot unavailable");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== file.bytes)
          throw Error("Snapshot length mismatch");
        const hash = Array.from(new Uint8Array(await digest(bytes)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== file.sha256) throw Error("Snapshot hash mismatch");
        const rows = JSON.parse(new TextDecoder().decode(bytes));
        if (!rows || Array.isArray(rows) || typeof rows !== "object")
          throw Error("Invalid snapshot");
        for (const [wallet, counts] of Object.entries(rows)) {
          if (
            !new RegExp(`^0x${prefix}[0-9a-f]{39}$`).test(wallet) ||
            !Array.isArray(counts) ||
            counts.length !== pin.factIds.length ||
            counts.some((n) => !Number.isSafeInteger(n) || n < 0)
          )
            throw Error("Invalid snapshot counts");
        }
        return rows;
      })();
      shards.set(name, pending);
      pending.catch(() => {
        if (shards.get(name) === pending) shards.delete(name);
      });
    }
    return shards.get(name);
  }
  return async (wallet, id) => {
    id = Number(id);
    if (!snapshotFact(id) || !/^0x[0-9a-f]{40}$/i.test(wallet))
      throw Error("Unsupported snapshot lookup");
    const address = wallet.toLowerCase(),
      rows = await load(address[2]);
    const count = rows[address]?.[pin.factIds.indexOf(id)] || 0;
    const threshold = BigInt(pin.facts[id].spec.threshold);
    return {
      state: BigInt(count) >= threshold ? "met" : "not-met",
      found: `${count} matching ${count === 1 ? "event" : "events"}; at least ${threshold} required`,
    };
  };
}

let reader;
export const snapshotEligibility = (wallet, id) =>
  (reader ||= snapshotReader())(wallet, id);
