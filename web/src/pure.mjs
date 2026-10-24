import { unsafeTransferRanking, TRANSFER_WARNING } from "./shared-safety.mjs";
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",")}}`;
  return JSON.stringify(value);
}
export const imd = (value) => {
  const n = BigInt(value),
    sign = n < 0n ? "-" : "",
    a = n < 0n ? -n : n,
    whole = a / 10n ** 18n,
    frac = (a % 10n ** 18n).toString().padStart(18, "0");
  return (
    sign +
    whole.toLocaleString("en-US") +
    "." +
    (a < 10n ** 18n ? frac.slice(0, 2) : frac.replace(/0+$/, "") || "0")
  );
};
export const exactUnits = (value, decimals = 18) => {
  const n = BigInt(value),
    unit = 10n ** BigInt(decimals);
  const fraction = (n % unit)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return (n / unit).toString() + (fraction ? "." + fraction : "");
};
export const ethCeiling = (value) => {
  const n = (BigInt(value) + 10n ** 12n - 1n) / 10n ** 12n;
  return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, "0")}`;
};
export const maxInput = (quote) => (BigInt(quote) * 101n + 99n) / 100n;
export const traitMethod = (kind) =>
  Number(kind) === 3 ? "requestSharedFact" : "upgrade";
export const impossible = (joined, id) =>
  !joined && ((id >= 701 && id <= 1105) || id === 1201);
/** @type {Record<number,string>} */
export const MISS_REASONS = {
  1: "Request is not pending",
  2: "Not the attester",
  3: "Wrong answer chain",
  4: "Wrong answer type",
  5: "Not the panel the registry asked for",
  6: "Block window mismatch",
  7: "Expired or outside the issuance window",
  8: "The answer was false",
  9: "Malformed answer",
  10: "Question hash mismatch",
  11: "Intake request is not completed",
};
export function decodeMetadata(uri) {
  if (!uri.startsWith("data:application/json;base64,"))
    throw Error("Renderer returned an unsupported metadata envelope.");
  const raw = atob(uri.slice(uri.indexOf(",") + 1));
  const data = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))),
  );
  if (
    typeof data.image !== "string" ||
    !data.image.startsWith("data:image/svg+xml")
  )
    throw Error("Renderer metadata has no SVG image.");
  // Keep the raw string: exact uint256 fields must never round through Number.
  return { data, raw };
}
const ident = "[A-Za-z_][A-Za-z0-9_]{0,31}";
const typeRE =
  /^(address|bool|string|bytes|bytes(?:[1-9]|[12][0-9]|3[0-2])|u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256))(\[\])?$/;
export function validateSpec(s, height) {
  const errors = {};
  const kind = Number(s.kind);
  let params = [];
  const integer = (v) => (/^\d+$/.test(String(v)) ? BigInt(v) : 0n);
  const fail = (k, v) => {
    errors[k] ??= v;
  };
  if (unsafeTransferRanking(s)) fail("arg", TRANSFER_WARNING);
  if (![1, 2, 3, 4, 5].includes(kind))
    fail("kind", "Choose a template from T1 to T5.");
  if (!/^[A-Za-z0-9 .-]{1,32}$/.test(s.name))
    fail("name", "Use 1–32 ASCII letters, digits, spaces, dots or hyphens.");
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(s.target) ||
    (kind === 5 ? !/^0x0{40}$/i.test(s.target) : /^0x0{40}$/i.test(s.target))
  )
    fail(
      "target",
      kind === 5
        ? "A nonce fact has no target contract."
        : "Enter the event or view contract address.",
    );
  if (kind <= 3) {
    const match = new RegExp(`^event (${ident})\\((.*)\\)$`).exec(s.item);
    if (!match || s.item.length > 256)
      fail(
        "item",
        "Use exactly event Name(type indexed name, type name), up to 256 bytes.",
      );
    else {
      params =
        match[2] === ""
          ? []
          : match[2]
              .split(", ")
              .map((p) => {
                const m = new RegExp(`^([^ ]+) (indexed )?(${ident})$`).exec(p);
                if (!m || !typeRE.test(m[1]) || m[3] === "indexed") {
                  fail(
                    "item",
                    "Every parameter must have a supported type and a name, with single spaces.",
                  );
                  return null;
                }
                return { type: m[1], indexed: !!m[2], name: m[3] };
              })
              .filter(Boolean);
      if (params.filter((p) => p.indexed).length > 3)
        fail("item", "An event supports at most three indexed parameters.");
      if (new Set(params.map((p) => p.name)).size !== params.length)
        fail("item", "Each parameter needs a distinct name.");
    }
    if (
      !params.some((p) => p.name === s.arg && p.type === "address" && p.indexed)
    )
      fail("arg", "Choose an indexed address parameter from the event.");
    if (
      s.fixedArg &&
      !params.some(
        (p) =>
          p.name === s.fixedArg &&
          p.indexed &&
          !/\[|^string$|^bytes$/.test(p.type),
      )
    )
      fail("fixedArg", "Choose an indexed parameter of a fixed-size type.");
    if (
      [2, 3].includes(kind) &&
      !params.some((p) => p.name === s.sumArg && /^uint\d+$/.test(p.type))
    )
      fail("sumArg", "Choose an unsigned integer parameter to sum.");
  }
  if (
    kind === 4 &&
    !new RegExp(
      `^function ${ident}\\(address\\) view returns \\(uint256\\)$`,
    ).test(s.item)
  )
    fail("item", "Use exactly function name(address) view returns (uint256).");
  if (kind === 5 && s.item !== "")
    fail("item", "Nonce facts use an empty signature.");
  if (kind >= 4 && (s.arg || s.fixedArg || s.sumArg))
    fail("arg", "This template has no event field names.");
  if ((kind === 3 || kind >= 4) && (s.fixedArg || integer(s.fixedVal) !== 0n))
    fail("fixedArg", "This template does not take a second filter.");
  if (kind !== 2 && kind !== 3 && s.sumArg)
    fail("sumArg", "Only T2 and T3 sum a field.");
  if (!s.fixedArg && integer(s.fixedVal) !== 0n)
    fail(
      "fixedVal",
      "Set the filter value to zero when no second filter is set.",
    );
  if (kind === 4 ? ![1, 2, 3, 4, 5].includes(Number(s.op)) : Number(s.op) !== 0)
    fail("op", "Use a comparison only for T4.");
  for (const k of ["threshold", "fixedVal", "fromBlock", "toBlock"])
    try {
      if (
        !/^\d+$/.test(String(s[k])) ||
        BigInt(s[k]) < 0n ||
        BigInt(s[k]) >= 1n << BigInt(k.includes("Block") ? 64 : 256)
      )
        fail(k, "Use an unsigned integer within the onchain field range.");
    } catch {
      fail(k, "Use an unsigned integer.");
    }
  try {
    const a = BigInt(s.fromBlock),
      b = BigInt(s.toBlock),
      t = BigInt(s.threshold),
      h = BigInt(height);
    if (t < 1n || (kind === 3 && t > 32n))
      fail(
        "threshold",
        kind === 3
          ? "Use a head count from 1 to 32."
          : "Use a threshold of at least 1.",
      );
    if (
      a > b ||
      (kind === 5
        ? a !== b || b + 7200n > h
        : b - a + 1n < 7200n || b > h - 64n)
    )
      fail(
        "toBlock",
        kind === 5
          ? "Use a single block at least 7,200 blocks old."
          : "Use at least 7,200 blocks, ending at least 64 blocks before the current height.",
      );
  } catch {
    fail("toBlock", "Enter a valid inclusive block window.");
  }
  return errors;
}
