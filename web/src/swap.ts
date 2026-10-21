import { parseAbi, encodeAbiParameters, keccak256, type Address } from "viem";
import { asset, type Runtime } from "./chain";
import { maxInput } from "./pure.mjs";
export const routerAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const keyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;
export const quoterAbi = [
  {
    name: "quoteExactOutputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: keyComponents },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;
export type SwapQuote = {
  output: bigint;
  input: bigint;
  maximum: bigint;
  deadline: bigint;
  market: any;
  id: string;
};
export async function quoteEth(
  client: any,
  r: Runtime,
  output: bigint,
): Promise<SwapQuote> {
  if (output <= 0n || output >= 2n ** 128n)
    throw Error("IMD purchase amount is outside the router limit.");
  const response = await fetch(asset("data/eth-market.json"));
  if (!response.ok)
    throw Error("ETH quote route unavailable. Use IMD or retry.");
  const { market, id } = await response.json();
  if (
    !/^0x0{40}$/i.test(market.currency0) ||
    market.currency1.toLowerCase() !==
      r.deployment.network.pairToken.address.toLowerCase() ||
    keccak256(
      encodeAbiParameters(
        [{ type: "tuple", components: keyComponents }],
        [market],
      ),
    ) !== id
  )
    throw Error("ETH market descriptor failed verification.");
  for (const address of [
    r.deployment.network.uniswapV4.quoter,
    r.deployment.network.uniswapV4.universalRouter,
  ])
    if (!(await client.getBytecode({ address })))
      throw Error("Swap dependency has no code.");
  const { result } = await client.simulateContract({
    address: r.deployment.network.uniswapV4.quoter,
    abi: quoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [
      {
        poolKey: market,
        zeroForOne: true,
        exactAmount: output,
        hookData: "0x",
      },
    ],
  });
  const input = result[0];
  if (input <= 0n) throw Error("The ETH quote is unavailable.");
  return {
    output,
    input,
    maximum: maxInput(input),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 120),
    market,
    id,
  };
}
export function swapCall(r: Runtime, quote: SwapQuote, account: Address) {
  const exact = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: keyComponents },
          { name: "zeroForOne", type: "bool" },
          { name: "amountOut", type: "uint128" },
          { name: "amountInMaximum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [
      {
        poolKey: quote.market,
        zeroForOne: true,
        amountOut: quote.output,
        amountInMaximum: quote.maximum,
        hookData: "0x",
      },
    ],
  );
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [quote.market.currency0, quote.maximum],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [quote.market.currency1, quote.output],
  );
  const swap = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    ["0x080c0f", [exact, settle, take]],
  );
  const refund = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [quote.market.currency0, account, 0n],
  );
  return {
    address: r.deployment.network.uniswapV4.universalRouter as Address,
    abi: routerAbi,
    functionName: "execute",
    args: ["0x1004", [swap, refund], quote.deadline],
    value: quote.maximum,
  };
}
