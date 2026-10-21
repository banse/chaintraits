import fs from "node:fs";
import {
  encodeFunctionData,
  decodeFunctionResult,
  keccak256,
  parseAbi,
  parseAbiItem,
  pad,
  decodeEventLog,
  toHex,
  stringToHex,
} from "viem";
import { rpc } from "./rpc.mjs";
const url = process.argv[2];
if (!url) throw Error("Pass an RPC URL");
const h = JSON.parse(
  fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
);
const n = JSON.parse(
  fs.readFileSync(new URL("../network.json", import.meta.url)),
).network;
console.log("chain", rpc(url, "eth_chainId"));
const preview = JSON.parse(
  fs.readFileSync(
    new URL("../public/data/renderer-preview.json", import.meta.url),
  ),
);
const evidence = {
  chainId: 1,
  sourceCommit: h.sourceCommit,
  rpcSource: n.rpcUrls[0],
  checkedAt: new Date().toISOString(),
  contracts: [],
  getters: {},
};
for (const c of h.contracts) {
  const code = rpc(url, "eth_getCode", [c.address, "latest"]);
  const hash = keccak256(code);
  if (code === "0x" || hash !== preview.contracts[c.name].runtimeHash)
    throw Error(`${c.name} code mismatch`);
  evidence.contracts.push({
    name: c.name,
    address: c.address,
    codeBytes: (code.length - 2) / 2,
    runtimeHash: hash,
  });
  console.log(c.name, "code match", (code.length - 2) / 2);
}
const registry = h.contracts.find((c) => c.name === "Registry");
const abi = JSON.parse(
  fs.readFileSync(new URL("../public/abi/Registry.json", import.meta.url)),
);
function call(address, abi, functionName, args = []) {
  return decodeFunctionResult({
    abi,
    functionName,
    data: rpc(url, "eth_call", [
      { to: address, data: encodeFunctionData({ abi, functionName, args }) },
      "latest",
    ]),
  });
}
for (const name of [
  "curator",
  "imd",
  "intake",
  "attester",
  "renderer",
  "composer",
  "burnExecutor",
  "totalSupply",
  "nextSpecId",
]) {
  const value = call(registry.address, abi, name);
  evidence.getters[name] = value.toString();
  console.log(name, value.toString());
}
const intake = JSON.parse(
  fs.readFileSync(new URL("../public/abi/IntakeV2.json", import.meta.url)),
);
evidence.priceOf = call(evidence.getters.intake, intake, "priceOf", [
  stringToHex("oracle.request@oracle-1", { size: 32 }),
  evidence.getters.imd,
]).toString();
const event = parseAbiItem(
  "event FirstDeposit(address indexed contributor,uint256 indexed index,uint256 timestamp)",
);
const logs = rpc(url, "eth_getLogs", [
  {
    address: evidence.getters.curator,
    fromBlock: toHex(25769870),
    toBlock: toHex(25769970),
    topics: [keccak256(stringToHex("FirstDeposit(address,uint256,uint256)"))],
  },
]);
evidence.publicContributors = logs
  .slice(0, 3)
  .map(
    (l) =>
      decodeEventLog({ abi: [event], data: l.data, topics: l.topics }).args
        .contributor,
  );
fs.writeFileSync(
  new URL("../../docs/frontend/live-deployment.json", import.meta.url),
  JSON.stringify(evidence, null, 2) + "\n",
);
const initialize = parseAbiItem(
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
);
try {
  const logs = rpc(url, "eth_getLogs", [
    {
      address: n.uniswapV4.poolManager,
      fromBlock: "0x0",
      toBlock: "latest",
      topics: [
        keccak256(
          stringToHex(
            "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)",
          ),
        ),
        null,
        null,
        pad(n.pairToken.address, { size: 32 }),
      ],
    },
  ]);
  const markets = logs.map((l) => ({
    ...decodeEventLog({ abi: [initialize], data: l.data, topics: l.topics })
      .args,
    blockNumber: l.blockNumber,
    txHash: l.transactionHash,
  }));
  console.log(`Discovered ${markets.length} initialized IMD markets.`);
  fs.writeFileSync(
    new URL("../../test/scratch/markets.json", import.meta.url),
    JSON.stringify(
      markets,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      null,
      2,
    ),
  );
} catch (e) {
  console.log("Market discovery:", e.message);
}
