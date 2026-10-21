import fs from "node:fs";
import { parseAbi, encodeFunctionData, decodeFunctionResult } from "viem";
import { rpc } from "./rpc.mjs";
const url = process.argv[2],
  n = JSON.parse(
    fs.readFileSync(new URL("../network.json", import.meta.url)),
  ).network;
const rows = JSON.parse(
  fs.readFileSync(new URL("../../test/scratch/markets.json", import.meta.url)),
).filter((m) => /^0x0{40}$/i.test(m.currency0) && /^0x0{40}$/i.test(m.hooks));
const abi = parseAbi(["function getLiquidity(bytes32) view returns(uint128)"]);
const active = [];
for (const m of rows) {
  try {
    const liquidity = decodeFunctionResult({
      abi,
      functionName: "getLiquidity",
      data: rpc(url, "eth_call", [
        {
          to: n.uniswapV4.stateView,
          data: encodeFunctionData({
            abi,
            functionName: "getLiquidity",
            args: [m.id],
          }),
        },
        "latest",
      ]),
    });
    if (liquidity > 0n) active.push({ ...m, liquidity });
  } catch {}
}
active.sort((a, b) => (a.liquidity > b.liquidity ? -1 : 1));
const m = active[0];
if (!m) throw Error("No active ETH/IMD market found");
const market = {
  currency0: m.currency0,
  currency1: m.currency1,
  fee: m.fee,
  tickSpacing: m.tickSpacing,
  hooks: m.hooks,
};
fs.writeFileSync(
  new URL("../public/data/eth-market.json", import.meta.url),
  JSON.stringify(
    {
      market,
      id: m.id,
      initializeTransaction: m.txHash,
      initializeBlock: m.blockNumber,
      observedLiquidity: m.liquidity.toString(),
      source: n.rpcUrls[0],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Selected live ETH/IMD market",
  m.id,
  "fee",
  m.fee,
  "liquidity",
  m.liquidity.toString(),
  "from",
  rows.length,
  "candidates",
);
