// Source templates: launch-2404 commit c4ff3238390fc51962fb67e86affc20cf418126e.
// Questions/Catalog/Composer wording, with fixture addresses and blocks. No oracle executes.
import fs from "node:fs";
const templates = JSON.parse(
  fs.readFileSync(new URL("./question-templates.json", import.meta.url)),
);
const curator = "0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91";
const deposited =
  "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)";
export function catalogSpec(id) {
  if (
    ![
      601, 701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201, 1301,
    ].includes(Number(id))
  )
    return null;
  const s = {
    kind: 1,
    target: curator,
    item: deposited,
    arg: "contributor",
    fixedArg: "",
    fixedVal: 0n,
    sumArg: "",
    op: 0,
    threshold: 1n,
    fromBlock: 25769870n,
    toBlock: 25789604n,
    name: `Fact ${id}`,
  };
  if (id === 601)
    Object.assign(s, {
      kind: 6,
      target: "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d",
      item: "",
      arg: "",
      fromBlock: 25090085n,
      toBlock: 0n,
      threshold: 3n,
      name: "Swarmed",
    });
  else if (id === 701) s.fromBlock = 25777045n;
  else if (id === 801 || id === 901)
    Object.assign(s, { fixedArg: "hour", fixedVal: id === 801 ? 64n : 65n });
  else if (id === 1001)
    Object.assign(s, {
      item: "event HourSaved(address indexed savior, uint256 indexed hour, uint256 hourTotal)",
      arg: "savior",
    });
  else if (id >= 1101 && id <= 1105) {
    s.item =
      "event FirstDeposit(address indexed contributor, uint256 indexed index, uint256 timestamp)";
    if (id === 1105) s.toBlock = 25770897n;
    else
      Object.assign(s, {
        fixedArg: "index",
        fixedVal: [1n, 1000n, 10000n, 19522n][id - 1101],
      });
  } else if (id === 1201)
    Object.assign(s, {
      kind: 3,
      sumArg: "weightAdded",
      threshold: 32n,
      name: "Top Weights",
    });
  else if (id === 1301)
    Object.assign(s, {
      kind: 5,
      target: "0x" + "0".repeat(40),
      item: "",
      arg: "",
      toBlock: s.fromBlock,
      threshold: 20n,
      name: "Pretrained",
    });
  return s;
}
export function mockRecipe(id, wallet, requestBlock, registeredSpec = null) {
  const s = { ...(catalogSpec(id) || registeredSpec) };
  if (!s.kind) throw Error("No mock recipe for this fact");
  if (s.kind === 6) s.toBlock = BigInt(requestBlock) - 64n;
  const template = templates[s.kind === 5 && id !== 1301 ? 7 : s.kind];
  const hex = (v) => "0x" + BigInt(v).toString(16);
  const indexed =
    s.item
      ?.match(/\((.*)\)/)?.[1]
      .split(",")
      .filter((field) => field.includes("indexed")) || [];
  const topic =
    indexed.findIndex((field) => field.trim().endsWith(" " + s.arg)) + 1;
  const args = [
    wallet.toLowerCase(),
    curator,
    s.item,
    s.arg,
    s.sumArg,
    String(s.threshold),
    hex(s.fromBlock),
    hex(s.toBlock),
    s.fixedArg
      ? ` and whose indexed ${s.fixedArg} argument equals ${s.fixedVal}`
      : "",
    ["", ">=", ">", "<=", "<", "=="][s.op],
    String(s.toBlock),
    hex(s.threshold),
    String(topic),
  ];
  if (id >= 10001) args[1] = s.target.toLowerCase();
  const expand = (text) =>
    text.replace(/~([A-M])/g, (_, letter) => args[letter.charCodeAt(0) - 65]);
  const panel = s.kind === 3 || s.kind >= 5;
  return {
    question: expand(template.question),
    definitions: Object.fromEntries(
      Object.entries(template.definitions).map(([k, v]) => [k, expand(v)]),
    ),
    window: { fromBlock: Number(s.fromBlock), toBlock: Number(s.toBlock) },
    answerType: s.kind <= 2 ? "uint256" : s.kind === 3 ? "address[]" : "bool",
    panelSize: panel ? 11 : 5,
    quorum: panel ? 7 : 3,
    threshold: String(s.threshold),
  };
}
export function mockAnswer(recipe, positive, wallet) {
  if (recipe.answerType === "address[]")
    return positive
      ? [
          wallet,
          ...Array.from(
            { length: Number(recipe.threshold) - 1 },
            (_, i) =>
              "0x" +
              (BigInt(wallet) + BigInt(i) + 1n).toString(16).padStart(40, "0"),
          ),
        ]
      : [];
  if (recipe.answerType === "uint256") return positive ? recipe.threshold : "0";
  return positive;
}
