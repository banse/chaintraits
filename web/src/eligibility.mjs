import {
  parseAbiItem,
  encodeEventTopics,
  decodeEventLog,
  encodeFunctionData,
  decodeFunctionResult,
  toHex,
} from "viem";
import { imd } from "./pure.mjs";
import { snapshotFact, snapshotEligibility } from "./eligibility-snapshot.mjs";
import { indexedEligibility } from "./indexer.mjs";

export const NOT_CHECKABLE =
  "Could not check eligibility; the request price is spent whatever the answer.";
export function eligibilityText(result, price) {
  const source = result?.source === "indexer"
    ? ` Source: indexer, block ${Number(result.lastIndexedBlock).toLocaleString("en-US")}.`
    : result?.source === "chain scan" ? " Source: chain scan." : "";
  if (!result || result.state === "checking") return "Checking eligibility…";
  if (result.state === "unknown" && result.reason === "accepted-work-unchecked")
    return "Seat history found; eligibility is not confirmed. Swarmed requires at least 3 accepted feedback entries during qualifying seat ownership and agent bindings. The panel must check that history; the request price is spent whatever the answer.";
  if (
    result.state === "unknown" ||
    (result.state === "not-met" && price == null)
  )
    return NOT_CHECKABLE + source;
  return result.state === "met"
    ? `Our check of the public chain data finds this rule met (${result.found}). The panel decides.${source}`
    : `This wallet does not meet this rule (${result.found}). The panel will most likely answer false and the ${imd(price)} IMD request price is spent.${source}`;
}
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const uint = (v) => {
  if (typeof v !== "string" || !/^0x[0-9a-f]+$/i.test(v))
    throw Error("Missing historical value");
  return BigInt(v);
};
const compare = (value, threshold, op) => {
  switch (Number(op)) {
    case 1:
      return value >= threshold;
    case 2:
      return value > threshold;
    case 3:
      return value <= threshold;
    case 4:
      return value < threshold;
    case 5:
      return value === threshold;
    default:
      throw Error("Unsupported comparison");
  }
};

// The settled catalog uses the pinned snapshot, including its immutable specs.
// Other facts retain public-client reads. The deadline covers the whole check.
// A late transport response cannot resume scanning or replace the timeout result.
/**
 * @param {any} client
 * @param {any} readSpec
 * @param {any} wallet
 * @param {any} id
 * @param {{ timeoutMs?: number, snapshot?: any, signal?: AbortSignal }} [options]
 */
export async function checkEligibility(
  client,
  readSpec,
  wallet,
  id,
  { timeoutMs = 20000, snapshot = snapshotEligibility, signal } = {},
) {
  let stopped = false,
    timer;
  // Aborted at the deadline, when the check returns, or when the caller's
  // signal aborts (page or wallet changed): the RPC pool then sends nothing
  // more for this check, including the halves of a split range.
  const controller = new AbortController();
  const stop = () => {
    stopped = true;
    controller.abort();
  };
  if (signal?.aborted) stop();
  signal?.addEventListener("abort", stop, { once: true });
  const rpc = client?.pool?.scoped
    ? client.pool.scoped(controller.signal)
    : client;
  const guard = () => {
    if (stopped) throw Error("Eligibility deadline");
  };
  const request = async (method, params) => {
    guard();
    const result = await rpc.request({ method, params });
    guard();
    return result;
  };
  const scan = async () => {
    if (snapshotFact(id)) return snapshot(wallet, id);
    if (Number(id) >= 10001) {
      guard();
      const indexed = await indexedEligibility(wallet, id, controller.signal);
      guard();
      if (indexed) return indexed;
    }
    // The spec read shares the check's signal: it stops with the check.
    const spec = await readSpec(id, controller.signal);
    guard();
    const kind = Number(spec.kind),
      threshold = BigInt(spec.threshold);
    let from = BigInt(spec.fromBlock),
      end = BigInt(spec.toBlock);
    const result = (met, found) => ({ state: met ? "met" : "not-met", found });
    if (kind === 5) {
      const value = uint(
        await request("eth_getTransactionCount", [wallet, toHex(end)]),
      );
      return result(value >= threshold, `nonce ${value} at block ${end}`);
    }
    if (kind === 4) {
      const fn = parseAbiItem(spec.item);
      if (fn.type !== "function") throw Error("Unsupported view");
      const data = await request("eth_call", [
        {
          to: spec.target,
          data: encodeFunctionData({
            abi: [fn],
            functionName: fn.name,
            args: [wallet],
          }),
        },
        toHex(end),
      ]);
      const value = decodeFunctionResult({
        abi: [fn],
        functionName: fn.name,
        data,
      });
      if (typeof value !== "bigint") throw Error("Incomplete view");
      return result(
        compare(value, threshold, spec.op),
        `${fn.name} returned ${value} at block ${end}`,
      );
    }
    const seat = Number(id) === 601 && kind === 6;
    if (![1, 2].includes(kind) && !seat) throw Error("Unsupported rule");
    if (seat) {
      end = uint(await request("eth_blockNumber", [])) - 64n;
      // The collection and starting block come from the deployed catalog spec.
    }
    if (from > end) throw Error("Incomplete window");
    const event = parseAbiItem(
      seat
        ? "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
        : spec.item,
    );
    if (event.type !== "event") throw Error("Unsupported event");
    const claimant = seat ? "to" : spec.arg;
    const args = { [claimant]: wallet };
    if (spec.fixedArg && !seat) {
      const field = event.inputs.find((p) => p.name === spec.fixedArg);
      if (!field?.indexed) throw Error("Unsupported fixed filter");
      if (field.type === "bool" && BigInt(spec.fixedVal) > 1n)
        throw Error("Invalid boolean filter");
      args[spec.fixedArg] =
        field.type === "address"
          ? toHex(BigInt(spec.fixedVal), { size: 20 })
          : field.type === "bool"
            ? BigInt(spec.fixedVal) !== 0n
            : /^bytes\d+$/.test(field.type)
              ? toHex(BigInt(spec.fixedVal), {
                  size: Number(field.type.slice(5)),
                })
              : BigInt(spec.fixedVal);
    }
    const topics = encodeEventTopics({
      abi: [event],
      eventName: event.name,
      args,
    });
    // 601 reads its whole spec window in one eth_getLogs that two endpoints
    // answer alike; the RPC pool splits a range an endpoint refuses for size.
    let span = seat ? end - from + 1n : 2000n,
      total = 0n;
    const seen = new Set();
    while (from <= end) {
      guard();
      const to = from + span - 1n > end ? end : from + span - 1n;
      let logs;
      try {
        logs = await request("eth_getLogs", [
          {
            address: spec.target,
            topics,
            fromBlock: toHex(from),
            toBlock: toHex(to),
          },
        ]);
        if (!Array.isArray(logs) || logs.length >= 1000)
          throw Error("Possibly truncated logs");
      } catch (error) {
        guard();
        if (
          span > 1n &&
          !/Cannot read the chain|disagree|two agreeing/i.test(error.message)
        ) {
          span = (span + 1n) / 2n;
          continue;
        }
        throw error;
      }
      for (const log of logs) {
        if (
          log.removed ||
          !log.blockHash ||
          !log.transactionHash ||
          log.logIndex == null ||
          !equal(log.address, spec.target) ||
          uint(log.blockNumber) < from ||
          uint(log.blockNumber) > to
        )
          throw Error("Incomplete historical logs");
        const key = `${log.blockHash}:${log.logIndex}`;
        if (seen.has(key)) throw Error("Duplicate log");
        seen.add(key);
        const decoded = decodeEventLog({
          abi: [event],
          topics: log.topics,
          data: log.data,
          strict: true,
        }).args;
        if (!equal(decoded[claimant], wallet)) continue;
        if (
          !seat &&
          spec.fixedArg &&
          String(decoded[spec.fixedArg]).toLowerCase() !==
            String(args[spec.fixedArg]).toLowerCase()
        )
          continue;
        // A transfer proves only that this wallet held a seat. It proves
        // neither the agent binding nor three accepted-work entries. Current
        // balance is also insufficient: qualifying former holders can apply.
        if (seat)
          return { state: "unknown", reason: "accepted-work-unchecked" };
        if (
          kind === 2 &&
          (typeof decoded[spec.sumArg] !== "bigint" ||
            decoded[spec.sumArg] < 0n)
        )
          throw Error("Invalid sum");
        total += kind === 2 ? decoded[spec.sumArg] : 1n;
      }
      from = to + 1n;
    }
    return seat
      ? result(false, "no IdentityMD seat received in the window")
      : result(
          total >= threshold,
          kind === 2
            ? `sum ${total} in raw units; at least ${threshold} required`
            : `${total} matching ${total === 1n ? "event" : "events"}; at least ${threshold} required`,
        );
  };
  try {
    const checked = await Promise.race([
      scan(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          stop();
          resolve({ state: "unknown" });
        }, timeoutMs);
      }),
    ]);
    return Number(id) >= 10001 && checked.source !== "indexer"
      ? { ...checked, source: "chain scan" } : checked;
  } catch {
    return Number(id) >= 10001
      ? { state: "unknown", source: "chain scan" } : { state: "unknown" };
  } finally {
    stop();
    signal?.removeEventListener("abort", stop);
    clearTimeout(timer);
  }
}
