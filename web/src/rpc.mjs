// Public reads only. Wallet submissions always use the connected EIP-1193 provider.
export const READ_RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://gateway.tenderly.co/public/mainnet",
  "https://rpc.mevblocker.io/fast",
  "https://1.rpc.thirdweb.com",
];
// An endpoint that errors or answers 429 sits out, then is tried again. The
// pause grows with repeated failures and never exceeds MAX_PAUSE_MS.
export const MAX_PAUSE_MS = 60000;
const pauseFor = (failures) =>
  Math.min(MAX_PAUSE_MS, 15000 * 2 ** (failures - 1));
// Range refusals name their size limit; they are not endpoint failures.
const SIZE_REFUSAL =
  /block range|range (is )?too (large|wide|big)|too (many|large)|exceed|limit|maximum|max(imum)? (allowed )?(number of )?(requested )?blocks|more than \d+ (results|logs|blocks)|response size|query timeout|10,?000 results/i;
const hex = (v) =>
  typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? BigInt(v) : null;
export function resilientRpc({
  urls = READ_RPCS,
  fetcher = fetch,
  timeout = 8000,
  now = () => Date.now(),
  onRead,
} = {}) {
  let sequence = 0;
  const health = new Map(urls.map((u) => [u, { until: 0, failures: 0 }]));
  const verifiedChains = new Set();
  const pause = (url) => {
    const h = health.get(url);
    h.failures++;
    h.until = now() + pauseFor(h.failures);
  };
  const recover = (url) => {
    const h = health.get(url);
    h.failures = 0;
    h.until = 0;
  };
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
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw Object.assign(Error(`RPC HTTP ${response.status}`), {
            status: response.status,
            sizeRefusal:
              method === "eth_getLogs" &&
              (response.status === 413 ||
                (!/archive/i.test(text) && SIZE_REFUSAL.test(text))),
            final: response.status === 403,
          });
        }
        const body = await response.json();
        if (body.error) {
          const error = Object.assign(
            new Error(body.error.message || "RPC read refused"),
            {
              code: body.error.code,
              data: body.error.data,
              // An answered call that reverts is a contract refusal, not an
              // unavailable endpoint. Preserve its ABI data for a plain explanation.
              contractRefusal:
                ["eth_call", "eth_estimateGas"].includes(method) &&
                (body.error.code === 3 ||
                  /^0x[0-9a-f]*$/i.test(body.error.data || "") ||
                  /revert|insufficient funds|out of gas/i.test(
                    body.error.message || "",
                  )),
              sizeRefusal:
                method === "eth_getLogs" &&
                !/archive/i.test(body.error.message || "") &&
                SIZE_REFUSAL.test(body.error.message || ""),
            },
          );
          throw error;
        }
        if (!("result" in body)) throw Error("Incomplete RPC response");
        return body.result;
      } catch (error) {
        if (error.contractRefusal || error.sizeRefusal || error.final)
          throw error;
        if (attempt) throw error;
      }
    }
  }
  // Ready endpoints in row order; paused ones only when every endpoint is paused,
  // soonest first, so a complete outage is retried on the next read.
  function candidates(excluded) {
    const open = urls.filter((u) => !excluded.has(u));
    const ready = open.filter((u) => health.get(u).until <= now());
    return ready.length
      ? ready
      : open.sort((a, b) => health.get(a).until - health.get(b).until);
  }
  async function one(url, method, params) {
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
    recover(url);
    onRead?.({ url, method, params });
    return result;
  }
  async function next(method, params, excluded = new Set()) {
    for (const url of candidates(excluded)) {
      try {
        return { url, result: await one(url, method, params) };
      } catch (error) {
        if (error.contractRefusal) throw error;
        pause(url);
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
  // Logs count only when two endpoints return the same list. A range an
  // endpoint refuses for its size is read in two halves instead.
  async function logs(params) {
    const answers = [];
    const tried = new Set();
    let sized = false;
    while (answers.length < 2) {
      const url = candidates(tried)[0];
      if (!url) break;
      tried.add(url);
      try {
        const result = await one(url, "eth_getLogs", params);
        if (!Array.isArray(result))
          throw Error("Incomplete historical logs; payment blocked.");
        answers.push(result);
      } catch (error) {
        if (error.sizeRefusal) sized = true;
        else pause(url);
      }
    }
    if (answers.length === 2) {
      if (logKey(answers[0]) !== logKey(answers[1]))
        throw Error(
          "Historical RPCs disagree; logs were not read in full. Payment blocked.",
        );
      return answers[0];
    }
    const filter = params?.[0] || {};
    const from = hex(filter.fromBlock),
      to = hex(filter.toBlock);
    if (sized && from !== null && to !== null && to > from) {
      const middle = from + (to - from) / 2n;
      const part = (a, b) => [
        {
          ...filter,
          fromBlock: `0x${a.toString(16)}`,
          toBlock: `0x${b.toString(16)}`,
        },
        ...params.slice(1),
      ];
      return [
        ...(await logs(part(from, middle))),
        ...(await logs(part(middle + 1n, to))),
      ];
    }
    throw Error(
      answers.length
        ? "Historical logs need two agreeing RPCs; logs were not read in full. Payment blocked."
        : "Cannot read the chain, retrying. Use Retry reads to try again now.",
    );
  }
  return {
    async request({ method, params = [] }) {
      if (method === "eth_getLogs") return logs(params);
      return (await next(method, params)).result;
    },
    // Test notes and diagnostics: the pause state of each endpoint.
    pausedUntil: (url) => health.get(url)?.until || 0,
  };
}
