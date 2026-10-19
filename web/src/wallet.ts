import { useEffect, useState, useSyncExternalStore } from 'react';
import { getAddress, isAddress, type Address, type Hex } from 'viem';

export type Provider={request:(args:{method:string;params?:unknown[]|object})=>Promise<unknown>;on?:(event:string,fn:(...args:unknown[])=>void)=>void;removeListener?:(event:string,fn:(...args:unknown[])=>void)=>void};
type Announce={info:{uuid:string;name:string;rdns:string};provider:Provider};
declare global { interface Window { ethereum?:Provider; } }
let discovered:Announce[]=[];
const discoveryListeners=new Set<()=>void>();
if(typeof window!=='undefined') {
 window.addEventListener('eip6963:announceProvider',((event:CustomEvent<Announce>)=>{
  const d=event.detail;
  if(d?.info?.uuid && typeof d.provider?.request==='function' && !discovered.some(x=>x.info.uuid===d.info.uuid)) { discovered=[...discovered,d];discoveryListeners.forEach(fn=>fn()); }
 }) as EventListener);
 window.dispatchEvent(new Event('eip6963:requestProvider'));
}
export function useProviders(){return useSyncExternalStore(cb=>{discoveryListeners.add(cb);return()=>discoveryListeners.delete(cb);},()=>discovered);}
export type Wallet={provider:Provider;account:Address;chainId:number;epoch:number;signal?:AbortSignal;invalidate?:()=>void};
export function useWallet() {
 const providers=useProviders();
 const [wallet,setWallet]=useState<Wallet>();
 const [message,setMessage]=useState('');
 const [connecting,setConnecting]=useState(false);
 let defaultProvider=providers[0]?.provider ?? window.ethereum;
 async function connect(provider=defaultProvider) {
  if(!provider){setMessage('Open this page in your wallet browser, or install an Ethereum browser wallet.');return;}
  setConnecting(true);setMessage('');
  try {
   const accounts=await provider.request({method:'eth_requestAccounts'}) as string[];
   const chainId=Number(await provider.request({method:'eth_chainId'}));
   if(!accounts[0] || !isAddress(accounts[0])) throw new Error('The wallet returned no address.');
   const controller=new AbortController();
   setWallet(prev=>{prev?.invalidate?.();return {provider,account:getAddress(accounts[0]),chainId,epoch:(prev?.epoch??0)+1,signal:controller.signal,invalidate:()=>controller.abort()};});
  } catch {setMessage('Connection declined or unavailable. You can try again.');}
  finally {setConnecting(false);}
 }
 useEffect(()=>{
  if(!wallet)return;
  const p=wallet.provider;
  const changed=()=>{wallet.invalidate?.();setWallet(undefined);setMessage('Account or chain changed. Old transaction controls were cleared. Connect again to review receipts.');};
  p.on?.('accountsChanged',changed);p.on?.('chainChanged',changed);p.on?.('disconnect',changed);
  return()=>{p.removeListener?.('accountsChanged',changed);p.removeListener?.('chainChanged',changed);p.removeListener?.('disconnect',changed);};
 },[wallet]);
 async function switchChain(){
  if(!wallet)return;
  try {await wallet.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1'}]});setWallet(undefined);setMessage('Ethereum selected. Connect again.');}
  catch {setMessage('Choose Ethereum mainnet in your wallet, then connect again.');}
 }
 return {wallet,providers,connect,connecting,message,switchChain,disconnect:()=>{wallet?.invalidate?.();setWallet(undefined);}};
}
export async function assertWallet(wallet:Wallet) {
 if(wallet.signal?.aborted)throw new Error('Wallet session changed. Connect again and review receipts.');
 const [chain,accounts]=await Promise.all([wallet.provider.request({method:'eth_chainId'}),wallet.provider.request({method:'eth_accounts'})]);
 if(wallet.signal?.aborted)throw new Error('Wallet session changed. Connect again and review receipts.');
 if(Number(chain)!==1) throw new Error('Wrong chain. Use Ethereum mainnet.');
 if((accounts as string[])[0]?.toLowerCase()!==wallet.account.toLowerCase()) throw new Error('Account changed. Connect again and review the flow.');
}
export async function send(wallet:Wallet,tx:{to:Address;data:Hex;value?:bigint;gas?:bigint}) {
 await assertWallet(wallet);
 return await wallet.provider.request({method:'eth_sendTransaction',params:[{from:wallet.account,to:tx.to,data:tx.data,value:'0x'+(tx.value??0n).toString(16),...(tx.gas ? {gas:'0x'+tx.gas.toString(16)} : {})}]}) as Hex;
}
