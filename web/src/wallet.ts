import {useSyncExternalStore} from 'react';
import {getAddress,type Address,type Hex,defineChain} from 'viem';
import {createConfig,connect as connectWallet,disconnect as disconnectWallet,reconnect,watchAccount,watchConnectors,injected,http,type Connector,type Config,type GetAccountReturnType} from '@wagmi/core';
import {coinbaseWallet} from '@wagmi/connectors';
import {A,deployment} from './config';

export type Provider={request:(args:{method:string;params?:unknown[]|object})=>Promise<unknown>;on?:(event:string,fn:(...args:unknown[])=>void)=>void;removeListener?:(event:string,fn:(...args:unknown[])=>void)=>void};
export type Wallet={provider:Provider;account:Address;chainId:number;epoch:number;signal?:AbortSignal;invalidate?:()=>void};
type State={wallet?:Wallet;connectors:readonly Connector[];message:string;connecting:boolean;pending?:string;open:boolean};
let state:State={connectors:[],message:'',connecting:false,open:false};
const listeners=new Set<()=>void>();let config:Config|undefined;let generation=0;
function update(patch:Partial<State>){state={...state,...patch};listeners.forEach(fn=>fn());}
async function accountChanged(account:GetAccountReturnType){
 const run=++generation;state.wallet?.invalidate?.();update({wallet:undefined});
 if(!account.address||!account.connector)return;
 const provider=await account.connector.getProvider() as Provider;if(run!==generation)return;
 const controller=new AbortController();
 update({wallet:{provider,account:getAddress(account.address),chainId:account.chainId??0,epoch:run,signal:controller.signal,invalidate:()=>controller.abort()},open:false,message:''});
}
export function walletConfig(){
 if(config)return config;
 const n=deployment.network;
 const chain=defineChain({id:n.chainId,name:n.name,nativeCurrency:n.nativeCurrency,rpcUrls:{default:{http:n.rpcUrls}},blockExplorers:{default:{name:n.name,url:n.explorer}}});
 config=createConfig({chains:[chain],multiInjectedProviderDiscovery:true,connectors:[injected(),coinbaseWallet({version:'4',appName:'Sworn',appLogoUrl:new URL('./assets/logo.svg',document.baseURI).href,preference:'all'})],transports:{[chain.id]:http(A.publicRpcs[0])}});
 update({connectors:config.connectors});watchConnectors(config,{onChange:connectors=>update({connectors})});
 watchAccount(config,{onChange:account=>{void accountChanged(account).catch(()=>update({message:'Wallet unavailable. Connect again.'}));}});
 void Promise.resolve(config.storage?.getItem('recentConnectorId')).then(id=>{if(id&&config)void reconnect(config,{connectors:config.connectors.filter(c=>c.id===id)}).catch(()=>update({message:'Reconnect your wallet to continue.'}));});
 return config;
}
async function connect(connector?:Connector){
 if(!connector){update({open:true});return;}
 update({connecting:true,pending:connector.uid,message:''});
 try{await connectWallet(walletConfig(),{connector});}
 catch{update({message:'Connection declined or unavailable. Select a wallet to try again.'});}
 finally{update({connecting:false,pending:undefined});}
}
async function switchChain(){
 const wallet=state.wallet;if(!wallet)return;
 try{
  try{await wallet.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${A.chainId.toString(16)}`}]});}
  catch(error){if(Number((error as {code?:number}).code)!==4902||!deployment.walletAddChain)throw error;await wallet.provider.request({method:'wallet_addEthereumChain',params:[deployment.walletAddChain]});await wallet.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:deployment.walletAddChain.chainId}]});}
  const chainId=Number(await wallet.provider.request({method:'eth_chainId'}));
  if(chainId!==A.chainId)throw Error('Network was not changed');
  if(state.wallet===wallet){const controller=new AbortController();wallet.invalidate?.();update({wallet:{...wallet,chainId,epoch:++generation,signal:controller.signal,invalidate:()=>controller.abort()},message:''});}
 }catch{update({message:'Switch to Ethereum in your wallet, then try again.'});}
}
async function disconnect(){++generation;state.wallet?.invalidate?.();update({wallet:undefined,message:''});await disconnectWallet(walletConfig()).catch(()=>{});update({wallet:undefined});}
export function useWallet(){
 if(typeof document!=='undefined')walletConfig();
 const s=useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb);},()=>state);
 return {...s,connect,switchChain,disconnect,showConnect:()=>update({open:true,message:''}),closeConnect:()=>update({open:false})};
}
export async function assertWallet(wallet:Wallet){
 if(wallet.signal?.aborted)throw Error('Wallet session changed. Connect again and review receipts.');
 const [chain,accounts]=await Promise.all([wallet.provider.request({method:'eth_chainId'}),wallet.provider.request({method:'eth_accounts'})]);
 if(wallet.signal?.aborted)throw Error('Wallet session changed. Connect again and review receipts.');
 if(Number(chain)!==A.chainId)throw Error('Wrong chain. Use Ethereum mainnet.');
 if((accounts as string[])[0]?.toLowerCase()!==wallet.account.toLowerCase())throw Error('Account changed. Connect again and review the flow.');
}
export async function send(wallet:Wallet,tx:{to:Address;data:Hex;value?:bigint;gas?:bigint}){
 await assertWallet(wallet);
 return await wallet.provider.request({method:'eth_sendTransaction',params:[{from:wallet.account,to:tx.to,data:tx.data,value:'0x'+(tx.value??0n).toString(16),...(tx.gas?{gas:'0x'+tx.gas.toString(16)}:{})}]}) as Hex;
}
