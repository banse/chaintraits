import test from "node:test";
import assert from "node:assert/strict";
import {
  walletSummaryRows,
  loadExplorerWallet,
  rememberExplorerWallet,
} from "../src/wallet-summary-model.mjs";

const traits = [
  { id: 101, name: "Direct", family: 1, class: "direct", rule: "Snapshot" },
  {
    id: 102,
    name: "Direct tier two",
    family: 1,
    class: "direct",
    rule: "Snapshot tier two",
  },
  {
    id: 601,
    name: "Swarmed",
    family: 6,
    class: "panel",
    rule: "Accepted jobs",
  },
];
const cells = [6, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13];
const walletA = "0x1111111111111111111111111111111111111111";
const walletB = "0x2222222222222222222222222222222222222222";
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("compact summary includes all held tiers and maps community rings in acceptance order", () => {
  const rows = walletSummaryRows(
    { token: 7n, traits: [101, 102, 601], verifiedSpecs: [10002, 10001] },
    traits,
    [],
    cells,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    [101, 102, 601, 10001, 10002],
  );
  assert.deepEqual(
    rows.filter((row) => row.family === 1).map((row) => row.id),
    [101, 102, 10001],
  );
  assert.equal(rows.find((row) => row.id === 10002).family, 6);
});

test("cardless previews are excluded while saved oracle facts and frame-only community facts remain", () => {
  const community = Array.from({ length: 40 }, (_, i) => 10001 + i);
  const rows = walletSummaryRows(
    { token: 0n, traits: [101, 601], verifiedSpecs: community },
    traits,
    [],
    cells,
  );
  assert.equal(
    rows.some((row) => row.id === 101),
    false,
  );
  assert.equal(rows.find((row) => row.id === 601).family, 6);
  assert.equal(rows.find((row) => row.id === 10040).family, null);
  assert.match(
    rows.find((row) => row.id === 10040).meaning,
    /could not be read/,
  );
});

test("Explorer restores its last wallet but an explicit address always wins", () => {
  const session = storage();
  rememberExplorerWallet(walletA, session);
  assert.equal(loadExplorerWallet("#/catalog", session), walletA);
  assert.equal(
    loadExplorerWallet(`#/catalog?address=${walletB}#explorer`, session),
    walletB,
  );
  assert.equal(
    loadExplorerWallet("#/explorer?address=invalid", session),
    "invalid",
  );
  assert.equal(loadExplorerWallet("#/catalog", session), walletA);
  rememberExplorerWallet("", session);
  assert.equal(loadExplorerWallet("#/catalog", session), "");
});

test("blocked browser storage preserves in-session navigation without throwing", () => {
  const blocked = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  rememberExplorerWallet(walletB, blocked);
  assert.equal(loadExplorerWallet("#/catalog", blocked), walletB);
  assert.equal(
    loadExplorerWallet(`#/explorer?address=${walletA}`, blocked),
    walletA,
  );
  rememberExplorerWallet("", blocked);
});
