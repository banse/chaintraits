import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, type Address, type Hex } from 'viem';
import { A, address } from './config';
import { read, type Reader } from './chain';

export const quoterAbi=parseAbi([
 'function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)',
 'function poolManager() view returns (address)',
]);
export const routerAbi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable','function poolManager() view returns (address)']);
export const POOL_TYPE='(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
export const POOL_KEY={...A.poolKey,currency0:A.poolKey.currency0 as Address,currency1:A.poolKey.currency1 as Address,hooks:A.poolKey.hooks as Address};
export const poolId=keccak256(encodeAbiParameters(parseAbiParameters(POOL_TYPE),[POOL_KEY]));
export type SwapQuote={amountOut:bigint;amountIn:bigint;maxInput:bigint;quotedAt:number;block:bigint;poolId:Hex};
export const slippageMaximum=(amount:bigint)=>(amount*101n+99n)/100n;
export async function quoteExactImd(client:Reader, amount:bigint):Promise<SwapQuote> {
 if(amount<=0n || amount>=2n**128n) throw new Error('Invalid exact IMD output');
 const [routerManager,quoterManager]=await Promise.all([
  read<Address>(client,address('UniversalRouter'),routerAbi,'poolManager'),
  read<Address>(client,address('Quoter'),quoterAbi,'poolManager'),
 ]);
 if([routerManager,quoterManager].some(a=>a.toLowerCase()!==A.PoolManager)) throw new Error('Uniswap PoolManager mismatch');
 const result=await client.simulateContract({address:address('Quoter'),abi:quoterAbi,functionName:'quoteExactOutputSingle',args:[{poolKey:POOL_KEY,zeroForOne:true,exactAmount:amount,hookData:'0x'}]});
 const [amountIn]=result.result;
 if(amountIn<=0n) throw new Error('No exact-output quote available');
 return {amountOut:amount,amountIn,maxInput:slippageMaximum(amountIn),quotedAt:Date.now(),block:await client.getBlockNumber({cacheTime:0}),poolId};
}
export function swapCalldata(quote:SwapQuote, recipient:Address, now=Date.now()) {
 if(now-quote.quotedAt>30000 || now<quote.quotedAt) throw new Error('Quote expired. Refresh the quote.');
 if(quote.poolId!==poolId || quote.maxInput!==slippageMaximum(quote.amountIn)) throw new Error('Quote parameters changed');
 const swap=encodeAbiParameters(parseAbiParameters(`(${POOL_TYPE} poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,bytes hookData)`),[{
  poolKey:POOL_KEY,zeroForOne:true,amountOut:quote.amountOut,amountInMaximum:quote.maxInput,hookData:'0x',
 }]);
 const settle=encodeAbiParameters(parseAbiParameters('address currency,uint256 maxAmount'),[POOL_KEY.currency0,quote.maxInput]);
 const take=encodeAbiParameters(parseAbiParameters('address currency,address recipient,uint256 amount'),[address('IMD'),recipient,quote.amountOut]);
 // Deployed Universal Router v2 ABI: exact out, capped native settlement, exact take.
 const actions=encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'),['0x080c0e',[swap,settle,take]]);
 const refund=encodeAbiParameters(parseAbiParameters('address token,address recipient,uint256 amountMinimum'),[POOL_KEY.currency0,recipient,0n]);
 const deadline=BigInt(Math.floor(now/1000)+120);
 const data=encodeFunctionData({abi:routerAbi,functionName:'execute',args:['0x1004',[actions,refund],deadline]});
 return {to:address('UniversalRouter'),data,value:quote.maxInput,deadline,recipient,refundRecipient:recipient,outputToken:address('IMD'),chainId:1 as const};
}
export const UNISWAP_LINK=`https://app.uniswap.org/swap?chain=mainnet&inputCurrency=ETH&outputCurrency=${A.IMD}`;
