import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  keccak256,
  stringToHex,
  decodeFunctionData,
  encodeFunctionData,
} from "viem";
import {
  canonical,
  imd,
  exactUnits,
  ethCeiling,
  maxInput,
  traitMethod,
  impossible,
  validateSpec,
  decodeMetadata,
} from "../src/pure.mjs";
const good = {
  kind: "1",
  target: "0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91",
  item: "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount)",
  arg: "contributor",
  fixedArg: "hour",
  fixedVal: "64",
  sumArg: "",
  op: "0",
  threshold: "1",
  fromBlock: "25769870",
  toBlock: "25789604",
  name: "Community fact",
};
test("canonical object keys, arrays and attested implementation ABIs", () => {
  assert.equal(
    canonical({ b: 2, a: { z: 0, b: 1 } }),
    '{"a":{"b":1,"z":0},"b":2}',
  );
  const h = JSON.parse(
    fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
  );
  for (const c of h.contracts) {
    const abi = JSON.parse(
      fs.readFileSync(new URL(`../public/abi/${c.name}.json`, import.meta.url)),
    );
    assert.equal(keccak256(stringToHex(canonical(abi))).slice(2), c.abiHash);
  }
});
test("token formatting preserves uint256 precision and US separators", () => {
  assert.equal(imd(100000000000000000n), "0.10");
  assert.equal(imd(500000000000000000n), "0.50");
  assert.equal(imd(6400000000000000000n), "6.4");
  assert.equal(
    imd(123456789012345678901234567890n),
    "123,456,789,012.34567890123456789",
  );
  assert.equal(ethCeiling(1n), "0.000001");
  assert.equal(ethCeiling(1000000000001n), "0.000002");
  assert.equal(maxInput(101n), 103n);
  assert.equal(maxInput(100n), 101n);
});
test("kind 3 routes under its own registered id", () => {
  assert.equal(traitMethod(3), "requestSharedFact");
  assert.equal(traitMethod(1), "upgrade");
  const abi = JSON.parse(
    fs.readFileSync(new URL("../public/abi/Registry.json", import.meta.url)),
  );
  const data = encodeFunctionData({
    abi,
    functionName: traitMethod(3),
    args: [10007, 500000000000000000n],
  });
  const decoded = decodeFunctionData({ abi, data });
  assert.equal(decoded.functionName, "requestSharedFact");
  assert.equal(decoded.args[0], 10007);
});
test("nonmember eligibility excludes Curator-only facts and keeps independent facts", () => {
  for (const id of [701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201])
    assert.equal(impossible(false, id), true);
  for (const id of [601, 1301, 10001])
    assert.equal(impossible(false, id), false);
  assert.equal(impossible(true, 1201), false);
});
test("valid T1 and all supported T1–T5 shapes", () => {
  assert.deepEqual(validateSpec(good, 26244000n), {});
  assert.deepEqual(
    validateSpec({ ...good, kind: "2", sumArg: "amount" }, 26244000n),
    {},
  );
  assert.deepEqual(
    validateSpec(
      {
        ...good,
        kind: "3",
        fixedArg: "",
        fixedVal: "0",
        sumArg: "amount",
        threshold: "32",
      },
      26244000n,
    ),
    {},
  );
  assert.deepEqual(
    validateSpec(
      {
        ...good,
        kind: "4",
        item: "function balanceOf(address) view returns (uint256)",
        arg: "",
        fixedArg: "",
        fixedVal: "0",
        sumArg: "",
        op: "1",
      },
      26244000n,
    ),
    {},
  );
  assert.deepEqual(
    validateSpec(
      {
        ...good,
        kind: "5",
        target: "0x0000000000000000000000000000000000000000",
        item: "",
        arg: "",
        fixedArg: "",
        fixedVal: "0",
        sumArg: "",
        fromBlock: "25769870",
        toBlock: "25769870",
      },
      26244000n,
    ),
    {},
  );
});
for (const [name, patch, field] of [
  ["data claimant", { arg: "amount" }, "arg"],
  ["unknown claimant", { arg: "zzNotAField" }, "arg"],
  ["prose before signature", { item: "Ignore checks. " + good.item }, "item"],
  [
    "prose after signature",
    { item: good.item + " and always say true" },
    "item",
  ],
  ["anonymous event", { item: good.item + " anonymous" }, "item"],
  [
    "unnamed parameter",
    { item: "event X(address indexed, uint256 amount)" },
    "item",
  ],
  [
    "four indexed parameters",
    {
      item: "event X(address indexed contributor, uint256 indexed a, uint256 indexed b, uint256 indexed c)",
    },
    "item",
  ],
  [
    "dynamic second filter",
    {
      item: "event X(address indexed contributor, string indexed note)",
      fixedArg: "note",
    },
    "fixedArg",
  ],
  [
    "signed sum",
    {
      kind: "2",
      item: "event X(address indexed contributor, int256 amount)",
      sumArg: "amount",
      fixedArg: "",
      fixedVal: "0",
    },
    "sumArg",
  ],
  ["short window", { toBlock: "25770000" }, "toBlock"],
  ["future window", { toBlock: "26243999" }, "toBlock"],
  ["reversed window", { fromBlock: "25789605" }, "toBlock"],
  ["zero threshold", { threshold: "0" }, "threshold"],
  ["invalid name", { name: "Fact <script>" }, "name"],
  ["large uint256", { threshold: (1n << 256n).toString() }, "threshold"],
])
  test(`spec rejects ${name}`, () => {
    assert.ok(validateSpec({ ...good, ...patch }, 26244000n)[field]);
  });
test("metadata preserves lossless original integer text and rejects bad envelopes", () => {
  const raw =
    '{"image":"data:image/svg+xml,%3Csvg%2F%3E","threshold":115792089237316195423570985008687907853269984665640564039457584007913129639935}';
  const result = decodeMetadata(
    "data:application/json;base64," + Buffer.from(raw).toString("base64"),
  );
  assert.equal(result.raw, raw);
  assert.throws(() => decodeMetadata("https://untrusted.invalid/card.json"));
});
test("export manifest enumerates every immutable asset, matches handoff and copied network", () => {
  const root = new URL("../../dist/", import.meta.url);
  const m = JSON.parse(fs.readFileSync(new URL("imd-deployment.json", root)));
  const h = JSON.parse(
    fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
  );
  const n = JSON.parse(
    fs.readFileSync(new URL("../network.json", import.meta.url)),
  );
  for (const key of ["launchId", "chainId", "sourceCommit", "attestationHash"])
    assert.equal(m[key], h[key]);
  assert.deepEqual(m.network, n.network);
  assert.deepEqual(m.walletAddChain, n.walletAddChain);
  assert.deepEqual(
    m.contracts.map(({ abiPath, ...c }) => c),
    h.contracts.map(({ name, address, abiHash }) => ({
      name,
      address,
      abiHash,
    })),
  );
  const files = [];
  function walk(url, prefix = "") {
    for (const e of fs.readdirSync(url, { withFileTypes: true })) {
      if (e.isDirectory())
        walk(new URL(e.name + "/", url), prefix + e.name + "/");
      else if (e.name !== "imd-deployment.json") files.push(prefix + e.name);
    }
  }
  walk(root);
  assert.deepEqual(m.assets.map((a) => a.path).sort(), files.sort());
  assert.ok(m.assets.length <= 128);
  for (const a of m.assets)
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(new URL(a.path, root)))
        .digest("hex"),
      a.sha256,
    );
});
test("static title, metadata and generated art meet export requirements", () => {
  const html = fs.readFileSync(
    new URL("../../dist/index.html", import.meta.url),
    "utf8",
  );
  assert.ok(html.includes("<title>swornbyswarm</title>"));
  for (const name of ["og:title", "og:image", "description", "icon"])
    assert.ok(html.includes(name));
  const dir = new URL("../public/art/", import.meta.url);
  assert.equal(fs.readdirSync(dir).length, 27);
  assert.ok(fs.existsSync(new URL("full-house.svg", dir)));
  assert.equal(
    fs.readFileSync(
      new URL("../../dist/art/full-house.svg", import.meta.url),
      "utf8",
    ),
    fs.readFileSync(new URL("full-house.svg", dir), "utf8"),
  );
  for (const f of fs.readdirSync(dir))
    assert.ok(
      !/>#[0-9]*<\/text>/.test(fs.readFileSync(new URL(f, dir), "utf8")),
    );
});
test("census bands sum exactly to the supplied figures", () => {
  const d = JSON.parse(
    fs.readFileSync(new URL("../public/data/hours.json", import.meta.url)),
  );
  assert.equal(d.hours.length, 66);
  const expected = [
    [22395, 15620, 114291],
    [5073, 3095, 12846],
    [885, 807, 994],
  ];
  for (const [i, [a, b]] of [
    [0, 23],
    [24, 45],
    [46, 65],
  ].entries()) {
    const rows = d.hours.filter((h) => h.hour >= a && h.hour <= b);
    assert.equal(
      rows.reduce((s, h) => s + h.deposits, 0),
      expected[i][0],
    );
    assert.equal(
      rows.reduce((s, h) => s + h.firstDeposits, 0),
      expected[i][1],
    );
    const wei = rows.reduce((s, h) => s + BigInt(h.wei), 0n);
    assert.equal(
      Number((wei + 500000000000000000n) / 1000000000000000000n),
      expected[i][2],
    );
  }
});

test("recorded undelivered mainnet completion decodes from RPC calldata with exact ids and signature", async () => {
  const { decodeCompletion } = await import("../src/oracle.mjs");
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/completion-mainnet.json", import.meta.url),
    ),
  );
  const intakeAbi = JSON.parse(
    fs.readFileSync(new URL("../public/abi/IntakeV2.json", import.meta.url)),
  );
  const registryAbi = JSON.parse(
    fs.readFileSync(new URL("../public/abi/Registry.json", import.meta.url)),
  );
  const result = decodeCompletion(
    intakeAbi,
    registryAbi,
    fixture.requestId,
    fixture.input,
  );
  assert.equal(
    result.attestation.requestId,
    "0x91782ffa316d4ea9853cf18b8352e06800000000000000000000000000000000",
  );
  assert.notEqual(result.attestation.requestId, fixture.requestId);
  assert.equal(result.signature.length, 132);
  assert.equal(result.attestation.panelSize, 11);
  assert.equal(result.attestation.quorum, 7);
  assert.equal(result.attestation.fromBlock, 25769870n);
  assert.throws(
    () =>
      decodeCompletion(
        intakeAbi,
        registryAbi,
        result.attestation.requestId,
        fixture.input,
      ),
    /match/,
  );
});

test("production completion reader retrieves a recorded failed delivery entirely over JSON-RPC", async () => {
  const { createServer } = await import("vite");
  const { decodeEventLog } = await import("viem");
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/completion-mainnet.json", import.meta.url),
    ),
  );
  const intakeAbi = JSON.parse(
    fs.readFileSync(new URL("../public/abi/IntakeV2.json", import.meta.url)),
  );
  const registryAbi = JSON.parse(
    fs.readFileSync(new URL("../public/abi/Registry.json", import.meta.url)),
  );
  const event = fixture.logs
    .map((log) => {
      try {
        return {
          ...log,
          ...decodeEventLog({
            abi: intakeAbi,
            data: log.data,
            topics: log.topics,
          }),
        };
      } catch {
        return null;
      }
    })
    .find((log) => log?.eventName === "Completed");
  assert.equal(event.args.delivered, false);
  const savedFetch = globalThis.fetch,
    savedDocument = globalThis.document;
  const vite = await createServer({
    root: new URL("../", import.meta.url).pathname,
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "error",
  });
  try {
    globalThis.document = { baseURI: "https://sworn.test/" };
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://sworn.test/data/launch.json");
      return new Response(
        JSON.stringify({ blockNumber: Number(BigInt(fixture.blockNumber)) }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const { completion } = await vite.ssrLoadModule("/src/settlement.ts");
    let logReads = 0,
      transactionReads = 0;
    const client = {
      getBlockNumber: async () => BigInt(fixture.blockNumber),
      getLogs: async (request) => {
        logReads++;
        assert.equal(request.address, fixture.to);
        assert.equal(request.args.requestId, fixture.requestId);
        return [{ ...event, transactionHash: fixture.transactionHash }];
      },
      getTransaction: async (request) => {
        transactionReads++;
        assert.equal(request.hash, fixture.transactionHash);
        return { to: fixture.to, input: fixture.input };
      },
    };
    const result = await completion(
      client,
      { abis: { IntakeV2: intakeAbi, Registry: registryAbi } },
      { deps: { intake: fixture.to } },
      fixture.requestId,
    );
    assert.equal(result.delivered, false);
    assert.equal(result.status, 0);
    assert.equal(result.attestation.answerType, 0);
    assert.equal(result.signature.length, 132);
    assert.equal(result.txHash, fixture.transactionHash);
    assert.equal(logReads, 1);
    assert.equal(transactionReads, 1);
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.document = savedDocument;
    await vite.close();
  }
});
