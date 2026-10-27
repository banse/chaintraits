import { parseAbiItem, toHex } from "viem";

const number = (value) => BigInt(value).toLocaleString("en-US");
const comparison = (op) =>
  ({
    0: "at least",
    1: "at least",
    2: "more than",
    3: "at most",
    4: "less than",
    5: "exactly",
  })[Number(op)] || "at least";

// The ABI's field type, rather than the magnitude of a uint, determines whether
// a fixed filter is an address. Registry fallback has no fixedValAsAddress.
export function fixedRuleValue(spec) {
  try {
    const item = parseAbiItem(spec.item);
    const field = item.inputs?.find((input) => input.name === spec.fixedArg);
    if (field?.type === "address")
      return toHex(BigInt(spec.fixedVal), { size: 20 });
    if (field?.type === "bool")
      return BigInt(spec.fixedVal) === 0n ? "false" : "true";
    if (/^bytes\d+$/.test(field?.type))
      return toHex(BigInt(spec.fixedVal), {
        size: Number(field.type.slice(5)),
      });
  } catch {
    /* Unsupported signatures still show their original fields below. */
  }
  return String(spec.fixedVal);
}

export function describeCommunityRule(spec) {
  const kind = Number(spec.kind),
    threshold = number(spec.threshold);
  const item = spec.item.match(/^(?:event|function)\s+(\w+)/)?.[1] || spec.item;
  const window = `between blocks ${number(spec.fromBlock)} and ${number(spec.toBlock)}`;
  const fixed = spec.fixedArg ? fixedRuleValue(spec) : "";
  let filter = `with ${spec.arg} equal to the wallet${spec.fixedArg ? ` and ${spec.fixedArg} equal to ${fixed}` : ""}`;
  if (item === "Transfer" && spec.arg === "from")
    filter = `sent by the wallet${spec.fixedArg === "to" ? ` to ${fixed}` : spec.fixedArg ? ` with ${spec.fixedArg} equal to ${fixed}` : ""}`;
  if (item === "Transfer" && spec.arg === "to")
    filter = `received by the wallet${spec.fixedArg === "from" ? ` from ${fixed}` : spec.fixedArg ? ` with ${spec.fixedArg} equal to ${fixed}` : ""}`;
  if (kind === 1)
    return `${comparison(spec.op)} ${threshold} ${item} events of ${spec.target} ${filter} ${window}`;
  if (kind === 2)
    return `${comparison(spec.op)} ${threshold} in summed ${spec.sumArg} (raw units) from ${item} events of ${spec.target} ${filter} ${window}`;
  if (kind === 3)
    return `top ${threshold} wallets by summed ${spec.sumArg} (raw units), grouped by ${spec.arg} in ${item} events of ${spec.target}${spec.fixedArg ? ` with ${spec.fixedArg} equal to ${fixed}` : ""} ${window}`;
  if (kind === 4)
    return `${item}(wallet) on ${spec.target} returns ${comparison(spec.op)} ${threshold} at block ${number(spec.toBlock)}`;
  if (kind === 5)
    return `wallet account nonce is at least ${threshold} at block ${number(spec.toBlock)}`;
  if (kind === 6)
    return `at least ${threshold} accepted feedback entries during qualifying seat ownership of ${spec.target} ${window}; the panel checks seat history and agent bindings`;
  return `${spec.item} on ${spec.target}, ${filter}, threshold ${threshold}, ${window}`;
}

// Contracts the site already names (network.json pairToken). Other addresses and long hex values
// are shortened; the Catalog keeps the full rule.
const SYMBOLS = { "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7": "IMD" };
const brief = (value) => {
  const text = String(value);
  return (
    SYMBOLS[text.toLowerCase()] ||
    (/^0x[0-9a-f]{15,}$/i.test(text)
      ? `${text.slice(0, 6)}…${text.slice(-4)}`
      : text)
  );
};
const capital = (text) => text[0].toUpperCase() + text.slice(1);
// Every paid swarm action reaches the Intake payee as an IMD transfer from the payer (docs, Contract
// addresses: "Every Intake payment is forwarded here in the same call"; x402 quotes pay it too). The
// first one is in block 26,038,414 (2026-09-23).
const SWARM_PAYEE = "0x4e0fa57bde726079356537e2f34d671e9f41adbc";
const FIRST_SWARM_PAYMENT = 26038414n;

/** A community rule's counterparts of a builtin fact's rule, window and question. */
export function summarizeCommunityRule(spec) {
  const kind = Number(spec.kind),
    threshold = number(spec.threshold),
    than = comparison(spec.op);
  const item = spec.item.match(/^(?:event|function)\s+(\w+)/)?.[1] || spec.item;
  const on = brief(spec.target);
  const fixed = spec.fixedArg ? brief(fixedRuleValue(spec)) : "";
  const blocks = `between blocks ${number(spec.fromBlock)} and ${number(spec.toBlock)}`;
  const range = `Blocks ${number(spec.fromBlock)}–${number(spec.toBlock)}`;
  const at = `block ${number(spec.toBlock)}`;
  const filter = `${spec.arg} = this wallet${spec.fixedArg ? `, ${spec.fixedArg} = ${fixed}` : ""}`;
  if (
    kind === 1 &&
    item === "Transfer" &&
    on === "IMD" &&
    spec.arg === "from" &&
    spec.fixedArg === "to" &&
    String(fixedRuleValue(spec)).toLowerCase() === SWARM_PAYEE
  ) {
    const start = BigInt(spec.fromBlock) <= FIRST_SWARM_PAYMENT;
    const until = `until block ${number(spec.toBlock)}`;
    return {
      rule: `${capital(than)} ${threshold} paid requests to the swarm${start ? " since the start" : ""}`,
      window: start ? capital(until) : range,
      question: `Did this wallet make ${than} ${threshold} paid requests to the swarm ${start ? `since the start, ${until}` : blocks}?`,
    };
  }
  if (kind === 1 && item === "Transfer" && ["from", "to"].includes(spec.arg)) {
    const sent = spec.arg === "from",
      other = sent ? "to" : "from";
    const party =
      spec.fixedArg === other
        ? ` ${other} ${fixed}`
        : spec.fixedArg
          ? ` with ${spec.fixedArg} ${fixed}`
          : "";
    return {
      rule: `${capital(than)} ${threshold} ${on} transfers ${sent ? "sent" : "received"}${party}`,
      window: range,
      question: `Did this wallet ${sent ? "send" : "receive"} ${than} ${threshold} ${on} transfers${party} ${blocks}?`,
    };
  }
  if (kind === 1)
    return {
      rule: `${capital(than)} ${threshold} ${item} events on ${on} with ${spec.arg} = wallet`,
      window: range,
      question: `Were there ${than} ${threshold} ${item} events on ${on} with ${filter} ${blocks}?`,
    };
  if (kind === 2)
    return {
      rule: `Summed ${spec.sumArg} (raw units) ${than} ${threshold} in ${item} events on ${on}`,
      window: range,
      question: `Was the summed ${spec.sumArg} (raw units) ${than} ${threshold} in ${item} events on ${on} with ${filter} ${blocks}?`,
    };
  if (kind === 3)
    return {
      rule: `Top ${threshold} by summed ${spec.sumArg} in ${item} events on ${on}`,
      window: range,
      question: `Was this wallet among the top ${threshold} by summed ${spec.sumArg} in ${item} events on ${on} ${blocks}?`,
    };
  if (kind === 4)
    return {
      rule: `${item}(wallet) on ${on} ${than} ${threshold}`,
      window: capital(`at ${at}`),
      question: `Did ${item}(this wallet) on ${on} return ${than} ${threshold} at ${at}?`,
    };
  if (kind === 5)
    return {
      rule: `Account nonce at least ${threshold}`,
      window: capital(`at ${at}`),
      question: `Was this wallet’s account nonce at least ${threshold} at ${at}?`,
    };
  if (kind === 6)
    return {
      rule: `At least ${threshold} accepted feedback entries while holding a seat of ${on}`,
      window: range,
      question: `Did this wallet have at least ${threshold} accepted feedback entries while holding a seat of ${on} ${blocks}?`,
    };
  return { rule: describeCommunityRule(spec), window: "", question: "" };
}

export function communityFact(spec) {
  const summary = summarizeCommunityRule(spec);
  return {
    id: spec.id,
    name: spec.name,
    kind: Number(spec.kind),
    class:
      Number(spec.kind) === 3
        ? "shared"
        : Number(spec.kind) >= 5
          ? "panel"
          : "chain",
    rule: summary.rule,
    window: summary.window,
    detail: describeCommunityRule(spec),
    registrant: spec.registrant,
  };
}
