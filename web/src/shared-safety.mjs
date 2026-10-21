import { parseAbiItem, decodeEventLog, toEventSelector, toHex } from "viem";

export function unsafeTransferRanking(spec) {
  return (
    Number(spec.kind) === 3 &&
    /^event (Transfer|TransferSingle|TransferBatch)\(/.test(spec.item) &&
    /^_?(from|to)$/i.test(spec.arg)
  );
}
export const TRANSFER_WARNING =
  "Transfer rankings grouped by from or to can include mint or burn addresses below 2**80. The deployed Registry refuses them with Missed reason 9 and the request price is lost. Choose another rule.";

/** Inclusive, bounded chunks, strict decoding, endpoint agreement supplied by resilientRpc. */
export async function checkSharedSpec(client, spec) {
  if (Number(spec.kind) !== 3) return null;
  if (unsafeTransferRanking(spec)) throw Error(TRANSFER_WARNING);
  const event = parseAbiItem(spec.item);
  if (event.type !== "event") throw Error("Shared facts need an event.");
  const head = Number(spec.threshold);
  if (!Number.isInteger(head) || head < 1 || head > 32)
    throw Error("Invalid shared head.");
  const start = BigInt(spec.fromBlock),
    end = BigInt(spec.toBlock);
  if (start > end) throw Error("Incomplete historical log window.");
  const closing = await client.getBlock({ blockNumber: end });
  if (!closing?.hash)
    throw Error("Cannot pin the historical closing block; payment blocked.");
  const totals = new Map(),
    seen = new Set();
  let from = start,
    span = 2000n,
    count = 0;
  while (from <= end) {
    const to = from + span - 1n > end ? end : from + span - 1n;
    let logs;
    try {
      logs = await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: spec.target,
            topics: [toEventSelector(event)],
            fromBlock: toHex(from),
            toBlock: toHex(to),
          },
        ],
      });
      // A provider cap can be a successful but truncated response. Split conservatively.
      if (!Array.isArray(logs) || logs.length >= 1000)
        throw Error("Possible truncated logs");
    } catch (error) {
      if (span > 1n && !/Cannot read the chain|disagree/i.test(error.message)) {
        span = (span + 1n) / 2n;
        continue;
      }
      throw Error(
        `Logs were not read in full; payment blocked. ${error.message}`,
      );
    }
    for (const log of logs) {
      if (
        log.removed ||
        !log.blockHash ||
        !log.transactionHash ||
        log.logIndex == null ||
        log.address?.toLowerCase() !== spec.target.toLowerCase() ||
        BigInt(log.blockNumber) < from ||
        BigInt(log.blockNumber) > to
      )
        throw Error("Logs were not read in full or changed; payment blocked.");
      const key = `${log.blockHash}:${log.logIndex}`;
      if (seen.has(key))
        throw Error("Duplicate historical logs; payment blocked.");
      seen.add(key);
      const { args } = decodeEventLog({
        abi: [event],
        topics: log.topics,
        data: log.data,
        strict: true,
      });
      const address = args[spec.arg],
        amount = args[spec.sumArg];
      if (
        typeof address !== "string" ||
        typeof amount !== "bigint" ||
        amount < 0n
      )
        throw Error(
          "Historical logs could not be decoded in full; payment blocked.",
        );
      const lower = address.toLowerCase();
      totals.set(lower, (totals.get(lower) || 0n) + amount);
      count++;
    }
    from = to + 1n;
  }
  const after = await client.getBlock({ blockNumber: end });
  if (after.hash !== closing.hash)
    throw Error("Historical block changed; payment blocked.");
  // Composer recipe: weight descending; numeric address ascending breaks ties.
  const list = [...totals]
    .sort(([a, x], [b, y]) =>
      x === y ? (BigInt(a) < BigInt(b) ? -1 : 1) : x > y ? -1 : 1,
    )
    .slice(0, head)
    .map(([a]) => a);
  if (list.length < head)
    throw Error(
      `Only ${list.length} keys for a head of ${head}. Registry would refuse the short list (Missed reason 9); payment blocked.`,
    );
  if (list.some((a) => BigInt(a) < 2n ** 80n))
    throw Error(
      "A top-head address is below 2**80. Registry would refuse the answer (Missed reason 9); payment blocked.",
    );
  return {
    list,
    count,
    fromBlock: start,
    toBlock: end,
    blockHash: closing.hash,
  };
}
