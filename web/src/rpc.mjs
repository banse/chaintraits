// Public reads only. Wallet submissions always use the connected EIP-1193 provider.
export const READ_RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://gateway.tenderly.co/public/mainnet",
  "https://rpc.mevblocker.io/fast",
  "https://1.rpc.thirdweb.com",
];
export function resilientRpc({
  urls = READ_RPCS,
  fetcher = fetch,
  timeout = 8000,
} = {}) {
  let sequence = 0;
  const rejected = new Set();
  const verifiedChains = new Set();
  async function at(url, method, params) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetcher(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++sequence,
            method,
            params,
          }),
          signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
        const body = await response.json();
        if (body.error) throw Error(body.error.message || "RPC read refused");
        if (!("result" in body)) throw Error("Incomplete RPC response");
        return body.result;
      } catch (error) {
        if (attempt) throw error;
      }
    }
  }
  async function next(method, params, excluded = new Set()) {
    // Revisit the row on a subsequent refresh after a complete outage.
    if (rejected.size === urls.length) rejected.clear();
    for (const url of urls) {
      if (excluded.has(url) || rejected.has(url)) continue;
      try {
        if (method !== "eth_chainId" && !verifiedChains.has(url)) {
          if ((await at(url, "eth_chainId", [])) !== "0x1")
            throw Error("RPC answers the wrong chain");
          verifiedChains.add(url);
        }
        const result = await at(url, method, params);
        if (method === "eth_chainId") {
          if (result !== "0x1") throw Error("RPC answers the wrong chain");
          verifiedChains.add(url);
        }
        return { url, result };
      } catch {
        rejected.add(url);
      }
    }
    throw Error(
      "Cannot read the chain, retrying. Use Retry reads to try again now.",
    );
  }
  const logKey = (logs) =>
    JSON.stringify(
      logs
        .map((l) => [
          l.blockHash,
          l.transactionHash,
          l.logIndex,
          l.address?.toLowerCase(),
          l.topics,
          l.data,
        ])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  return {
    async request({ method, params = [] }) {
      const first = await next(method, params);
      if (method === "eth_getLogs") {
        if (!Array.isArray(first.result))
          throw Error("Incomplete historical logs; payment blocked.");
        const second = await next(method, params, new Set([first.url]));
        if (
          !Array.isArray(second.result) ||
          logKey(first.result) !== logKey(second.result)
        )
          throw Error(
            "Historical RPCs disagree; logs were not read in full. Payment blocked.",
          );
      }
      return first.result;
    },
  };
}
