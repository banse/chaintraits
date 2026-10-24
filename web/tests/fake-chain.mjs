// Deterministic EIP-1193 and RPC fixtures. No key, real signature or broadcast.
import fs from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeErrorResult,
  parseAbiItem,
  toHex,
  zeroHash,
} from "viem";
export const wallet = "0x2000000000000000000000000000000000000001";
export const multicall3 = "0xca11bde05977b3631167028862be2a173976ca11";
const aggregate3Abi = [
  parseAbiItem(
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  ),
];
// Let failure/delay fixtures target the same read before and after batching.
export function rpcCalls(payload) {
  if (
    payload?.method !== "eth_call" ||
    payload.params?.[0]?.to?.toLowerCase() !== multicall3
  )
    return [payload];
  const { args } = decodeFunctionData({
    abi: aggregate3Abi,
    data: payload.params[0].data,
  });
  return args[0].map((call) => ({
    method: "eth_call",
    params: [
      { to: call.target, data: call.callData },
      ...payload.params.slice(1),
    ],
  }));
}
const root = new URL("../../dist/", import.meta.url);
const deployment = JSON.parse(
  fs.readFileSync(new URL("imd-deployment.json", root)),
);
const codes = JSON.parse(
  fs.readFileSync(new URL("fixtures/mainnet-code.json", import.meta.url)),
);
const abis = Object.fromEntries(
  ["Registry", "Composer", "Renderer", "WhitelistCurator", "IntakeV2"].map(
    (n) => [n, JSON.parse(fs.readFileSync(new URL(`abi/${n}.json`, root)))],
  ),
);
const handoff = JSON.parse(
  fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
);
const args = handoff.manifest.contracts.find(
  (c) => c.contract === "Registry",
).constructorArgs;
const deployed = Object.fromEntries(
  deployment.contracts.map((c) => [c.name, c.address]),
);
const deps = {
  curator: args[0],
  imd: args[1],
  intake: args[2],
  attester: args[3],
  renderer: deployed.Renderer,
  composer: deployed.Composer,
  burnExecutor: args[6],
};
const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
];
export const sharedSpec = {
  kind: 3,
  target: deps.curator,
  item: "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)",
  arg: "contributor",
  fixedArg: "",
  fixedVal: 0n,
  sumArg: "weightAdded",
  op: 0,
  threshold: 32n,
  fromBlock: 25769870n,
  toBlock: 25789604n,
  name: "Top Weights",
};
export function registryLog(name, args, extra = {}) {
  const event = abis.Registry.find(
    (e) => e.type === "event" && e.name === name,
  );
  return {
    address: deployed.Registry,
    blockNumber: toHex(26249800),
    blockHash: "0x" + "44".repeat(32),
    transactionHash: "0x" + "77".repeat(32),
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
    topics: encodeEventTopics({ abi: [event], eventName: name, args }),
    data: encodeAbiParameters(
      event.inputs.filter((e) => !e.indexed),
      event.inputs.filter((e) => !e.indexed).map((e) => args[e.name]),
    ),
    ...extra,
  };
}
export function fakeChain(options = {}) {
  const state = {
    token: 0n,
    allowance: 0n,
    price: 500000000000000000n,
    balance: 10n ** 21n,
    failAll: false,
    failFirst: false,
    unsafe: false,
    short: false,
    incomplete: false,
    failWallet: false,
    failSimulation: false,
    pending: [],
    proven: [],
    verifiedEvents: [],
    receiptLogs: [],
    failFunction: "",
    ...options,
    calls: [],
    signatures: [],
  };
  const block = {
    number: toHex(26250000),
    hash: "0x" + "44".repeat(32),
    parentHash: "0x" + "33".repeat(32),
    timestamp: toHex(1792600000),
    gasLimit: toHex(30000000),
    gasUsed: "0x0",
    baseFeePerGas: "0x1",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    miner: wallet,
    nonce: "0x0000000000000000",
    transactions: [],
    uncles: [],
    logsBloom: "0x" + "00".repeat(256),
    mixHash: zeroHash,
    receiptsRoot: zeroHash,
    sha3Uncles: zeroHash,
    size: "0x1",
    stateRoot: zeroHash,
    transactionsRoot: zeroHash,
  };
  const uri =
    "data:application/json;base64," +
    Buffer.from(
      JSON.stringify({
        name: "Fake test card",
        description: "Deterministic test fixture",
        image:
          "data:image/svg+xml;base64," +
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#0a0a0a"/><path d="M25 50h50" stroke="#00ff41"/></svg>',
          ).toString("base64"),
      }),
    ).toString("base64");
  function answer(p) {
    state.calls.push(p);
    const a = p.params?.[0];
    if (p.method === "eth_chainId") return "0x1";
    if (p.method === "eth_blockNumber") return block.number;
    if (p.method === "eth_getCode")
      return (
        codes[a.toLowerCase()] ||
        (Object.values(deployment.network.uniswapV4).some(
          (v) => v.toLowerCase() === a.toLowerCase(),
        )
          ? "0x6000"
          : "0x")
      );
    if (p.method === "eth_getBlockByNumber")
      return {
        ...block,
        number: p.params[0] === "latest" ? block.number : p.params[0],
      };
    if (p.method === "eth_getLogs") {
      if (state.incomplete) throw Error("Incomplete archive");
      if (a.address.toLowerCase() === deployed.Registry.toLowerCase()) {
        return [
          ...state.pending.map((p, i) =>
            registryLog(
              "TraitRequested",
              {
                claimant: p.claimant || wallet,
                traitId: p.id,
                requestId: p.requestId,
                questionHash: p.questionHash,
              },
              {
                logIndex: toHex(i),
                ...(p.transactionHash
                  ? { transactionHash: p.transactionHash }
                  : {}),
              },
            ),
          ),
          ...state.verifiedEvents,
        ].filter(
          (log) =>
            BigInt(a.fromBlock) <= BigInt(log.blockNumber) &&
            BigInt(a.toBlock) >= BigInt(log.blockNumber) &&
            a.topics.every(
              (t, i) =>
                t == null ||
                (Array.isArray(t)
                  ? t.includes(log.topics[i])
                  : t.toLowerCase() === log.topics[i]?.toLowerCase()),
            ),
        );
      }
      if (a.address.toLowerCase() !== deps.curator.toLowerCase()) return [];
      const event =
        a.topics[0] ===
        encodeEventTopics({
          abi: [parseAbiItem(sharedSpec.item)],
          eventName: "Deposited",
        })[0]
          ? parseAbiItem(sharedSpec.item)
          : parseAbiItem(
              "event Weighted(address indexed contributor, uint256 amount)",
            );
      if (BigInt(a.fromBlock) > 25769871n || BigInt(a.toBlock) < 25769871n)
        return [];
      const n = state.short ? 1 : 32;
      return Array.from({ length: n }, (_, i) => {
        const contributor =
          state.unsafe && i === 0
            ? "0x000000000000000000000000000000000000dEaD"
            : `0x2${BigInt(i + 1)
                .toString(16)
                .padStart(39, "0")}`;
        const values =
          event.name === "Deposited"
            ? [10n, 1n, 100n - BigInt(i), 1n, 1n, 1n, 1n]
            : [100n - BigInt(i)];
        const inputs = event.inputs.filter((x) => !x.indexed);
        return {
          address: deps.curator,
          blockNumber: toHex(25769871n),
          blockHash: block.hash,
          transactionHash: "0x" + "55".repeat(32),
          transactionIndex: "0x0",
          logIndex: toHex(i),
          removed: false,
          topics: encodeEventTopics({
            abi: [event],
            eventName: event.name,
            args: { contributor, hour: 0n },
          }),
          data: encodeAbiParameters(inputs, values),
        };
      });
    }
    if (p.method === "eth_call" && a.to?.toLowerCase() === multicall3) {
      // Multicall3 aggregate3: answer each inner call as its own eth_call.
      const { args: inner } = decodeFunctionData({
        abi: aggregate3Abi,
        data: a.data,
      });
      state.multicalls = (state.multicalls || 0) + 1;
      const results = inner[0].map((c) => {
        try {
          return {
            success: true,
            returnData: answer({
              method: "eth_call",
              params: [
                { to: c.target, data: c.callData },
                ...p.params.slice(1),
              ],
              inner: true,
            }),
          };
        } catch (e) {
          if (!c.allowFailure) throw e;
          return { success: false, returnData: e.data || "0x" };
        }
      });
      return encodeFunctionResult({
        abi: aggregate3Abi,
        functionName: "aggregate3",
        result: results,
      });
    }
    if (p.method === "eth_call") {
      const address = a.to?.toLowerCase();
      if (address === deployment.network.uniswapV4.quoter.toLowerCase())
        return encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          [100000000000000n, 100000n],
        );
      const name = Object.keys(deployed).find(
        (n) => deployed[n].toLowerCase() === address,
      );
      const abi = name
        ? abis[name]
        : address === deps.curator.toLowerCase()
          ? abis.WhitelistCurator
          : address === deps.intake.toLowerCase()
            ? abis.IntakeV2
            : address ===
                deployment.network.uniswapV4.universalRouter.toLowerCase()
              ? [
                  parseAbiItem(
                    "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
                  ),
                ]
              : tokenAbi;
      const { functionName: fn, args: values } = decodeFunctionData({
        abi,
        data: a.data,
      });
      if (state.failFunction === fn) {
        const e = Error("Execution reverted");
        e.data = encodeErrorResult({
          abi: [
            ...abis.Registry,
            ...abis.Composer,
            parseAbiItem("error Error(string)"),
          ],
          errorName: state.revertName || "AlreadyPending",
          args: state.revertArgs || [wallet, 601],
        });
        throw e;
      }
      if (state.failWallet && ["tokenOf", "traitsOf", "hasTrait"].includes(fn))
        throw Error("Wallet read unavailable");
      if (
        state.failSimulation &&
        [
          "mintCard",
          "registerSpec",
          "requestSharedFact",
          "upgrade",
          "approve",
        ].includes(fn)
      )
        throw Error("Simulation refused");
      let result;
      if (fn in deps) result = deps[fn];
      else if (fn === "priceOf") result = state.price;
      else if (fn === "totalSupply") result = state.token;
      else if (fn === "MINT_FEE") result = 100000000000000000n;
      else if (fn === "SPEC_FEE") result = 6400000000000000000n;
      else if (fn === "nextSpecId") result = state.nextSpecId || 10001;
      else if (fn === "tokenOf") result = state.token;
      else if (fn === "claimantOf") result = wallet;
      else if (fn === "traitsOf")
        result = state.traits || [101, ...state.proven];
      else if (fn === "verifiedSpecsOf") result = state.verifiedSpecs || [];
      else if (fn === "mintedAtBlock") result = state.mintedAtBlock ?? 0n;
      else if (fn === "hasTrait")
        result = (state.traits || [101, ...state.proven]).includes(
          Number(values[1]),
        );
      else if (fn === "firstHourOf") result = [0n, state.joined ?? true];
      else if (
        [
          "txCountOf",
          "contributedBy",
          "pointsOf",
          "directSnapshot",
          "frozenDirect",
        ].includes(fn)
      )
        result = 1n;
      else if (["tokenURI", "tokenURIOf"].includes(fn))
        result = state.uri || uri;
      else if (fn === "pendingOf")
        result =
          state.pending.find(
            (p) =>
              !p.cleared &&
              p.id === Number(values[1]) &&
              (p.claimant || wallet).toLowerCase() === values[0].toLowerCase(),
          )?.requestId || zeroHash;
      else if (fn === "sharedPending")
        result =
          state.pending.find(
            (p) =>
              !p.cleared &&
              p.id === Number(values[0]) &&
              p.claimant === "0x0000000000000000000000000000000000000000",
          )?.requestId || zeroHash;
      else if (fn === "pendingRequest") {
        const pending = state.pending.find(
          (p) => !p.cleared && p.requestId === values[0],
        );
        result = pending
          ? [
              pending.claimant || wallet,
              pending.id,
              pending.requestedAt,
              pending.questionHash,
            ]
          : ["0x0000000000000000000000000000000000000000", 0, 0n, zeroHash];
      } else if (fn === "verified")
        result = state.verifiedRecords?.[Number(values[1])] || [
          zeroHash,
          zeroHash,
          0n,
          0n,
        ];
      else if (fn === "sharedFact")
        result = state.sharedFact || [zeroHash, zeroHash, 0];
      else if (fn === "balanceOf") result = state.balance;
      else if (fn === "allowance") result = state.allowance;
      else if (fn === "specOf")
        result = state.specs?.[Number(values[0])] || sharedSpec;
      else if (fn === "approve") result = true;
      else if (fn === "mintCard") result = 1n;
      else if (fn === "registerSpec") result = 10001;
      else if (
        [
          "validateSpec",
          "upgrade",
          "requestSharedFact",
          "applySharedFact",
          "settle",
          "abandon",
          "execute",
        ].includes(fn)
      )
        result = undefined;
      else throw Error("Unhandled fake call " + fn);
      return encodeFunctionResult({ abi, functionName: fn, result });
    }
    if (p.method === "eth_getTransactionReceipt") {
      state.allowance = 10n ** 22n;
      state.onReceipt?.();
      return {
        transactionHash: p.params[0],
        transactionIndex: "0x0",
        blockHash: block.hash,
        blockNumber: block.number,
        from: wallet,
        to: deployed.Registry,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        contractAddress: null,
        logs: state.receiptLogs,
        logsBloom: block.logsBloom,
        status: "0x1",
        effectiveGasPrice: "0x1",
        type: "0x2",
      };
    }
    if (p.method === "eth_getTransactionByHash")
      return {
        hash: p.params[0],
        from: wallet,
        to: deployed.Registry,
        blockNumber: block.number,
        blockHash: block.hash,
        transactionIndex: "0x0",
        nonce: "0x0",
        gas: "0x5208",
        gasPrice: "0x1",
        value: "0x0",
        input: "0x",
        type: "0x2",
        v: "0x1",
        r: zeroHash,
        s: zeroHash,
      };
    throw Error("Unhandled fake RPC " + p.method);
  }
  return { state, answer };
}
export async function mockPage(page, fixture) {
  await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (
      !/ethereum-rpc.publicnode.com|gateway.tenderly.co|rpc.mevblocker.io|1.rpc.thirdweb.com/.test(
        url,
      )
    )
      throw Error("Unexpected external request " + url);
    const payload = route.request().postDataJSON();
    if (
      fixture.state.failAll ||
      (fixture.state.failFirst && url.includes("publicnode"))
    )
      return route.fulfill({ status: 429, body: "rate limited" });
    try {
      const result = await fixture.answer(payload);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
      });
    } catch (e) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          error: {
            code: -32000,
            message: e.message,
            ...(e.data ? { data: e.data } : {}),
          },
        }),
      });
    }
  });
}
export async function fakeWallet(context, address = wallet) {
  await context.addInitScript((wallet) => {
    let authorized = !!sessionStorage.getItem("fake-authorized");
    window.__signing = [];
    window.__accept = false;
    window.ethereum = {
      on() {},
      removeListener() {},
      async request({ method, params }) {
        if (method === "eth_chainId") return "0x1";
        if (
          method === "eth_requestAccounts" ||
          method === "wallet_requestPermissions"
        ) {
          authorized = true;
          sessionStorage.setItem("fake-authorized", "yes");
        }
        if (method === "wallet_requestPermissions")
          return [{ parentCapability: "eth_accounts" }];
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return authorized ? [wallet] : [];
        if (
          /^(eth_send|eth_sign|personal_sign|wallet_send|wallet_sign)/.test(
            method,
          )
        ) {
          window.__signing.push({ method, params });
          if (window.__accept) return "0x" + "66".repeat(32);
          const e = Error("Fake wallet rejected; nothing signed or sent");
          e.code = 4001;
          throw e;
        }
        if (method === "wallet_getCapabilities") return {};
        throw Error("Unsupported fake wallet method " + method);
      },
    };
  }, address);
}

// Eligibility-focused suites inspect negative advice. The disclosure is absent
// until a negative async result exists, so opt in when it first becomes available.
// Layout/filter suites deliberately do not use this helper.
export async function inspectAllFacts(page) {
  await page.evaluate(() => {
    const reveal = () => {
      const button = document.querySelector(
        '#step-02 .eligibility-toggle[aria-pressed="false"]',
      );
      if (button) {
        // Many on-load checks can settle in one frame. Reveal once, so their
        // mutations cannot click the same pending React toggle twice.
        observer.disconnect();
        button.click();
      }
    };
    const step = document.querySelector("#step-02");
    if (!step) return;
    const observer = new MutationObserver(reveal);
    observer.observe(step, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed"],
    });
    reveal();
  });
}
