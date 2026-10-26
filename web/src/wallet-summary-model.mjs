import { claimedFactRows } from "./claimed-facts.mjs";
import { communityDisplay } from "./card-facts.mjs";

export function walletSummaryRows(facts, traits, specs, families) {
  const positions = communityDisplay(
    facts?.verifiedSpecs || [],
    families,
  ).positions;
  return claimedFactRows(facts, traits, specs).map((row) => ({
    ...row,
    family:
      traits.find((trait) => trait.id === row.id)?.family ??
      positions.find((position) => position.id === row.id)?.family ??
      null,
  }));
}

const EXPLORER_WALLET_KEY = "sworn.explorer-wallet";
let rememberedWallet = "";
const validWallet = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);

export function loadExplorerWallet(hash, storage) {
  const query = new URLSearchParams(hash.split("?")[1]?.split("#")[0]);
  if (query.has("address")) return query.get("address") || "";
  try {
    const saved = (storage ?? globalThis.sessionStorage).getItem(
      EXPLORER_WALLET_KEY,
    );
    if (validWallet(saved)) return saved;
  } catch {
    /* Navigation still remembers the wallet when storage is blocked. */
  }
  return rememberedWallet;
}

export function rememberExplorerWallet(address, storage) {
  if (address && !validWallet(address)) return;
  rememberedWallet = address;
  try {
    const session = storage ?? globalThis.sessionStorage;
    if (address) session.setItem(EXPLORER_WALLET_KEY, address);
    else session.removeItem(EXPLORER_WALLET_KEY);
  } catch {
    /* The in-memory value covers this app session. */
  }
}
