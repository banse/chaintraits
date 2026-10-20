import {useEffect,useRef} from 'react';
import {getAddress} from 'viem';
import {useWallet} from './wallet';
import {OPEN_IN} from './open-in';

export function ConnectControl(){
 const w=useWallet(),a=w.wallet?.account;
 return <div className="connect-control">{a?<><button className="secondary" onClick={()=>w.wallet?.chainId!==1?void w.switchChain():void w.disconnect()}>{w.wallet?.chainId!==1?'Switch to Ethereum':`${getAddress(a).slice(0,6)}…${a.slice(-4)} · Disconnect`}</button></>:<button className="secondary" onClick={w.showConnect}>Connect</button>}</div>;
}
export function ConnectSheet(){
 const w=useWallet();const dialog=useRef<HTMLDialogElement>(null);const opener=useRef<HTMLElement|null>(null);
 const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)&&!window.ethereum&&!w.connectors.some(c=>c.type==='injected'&&c.id!=='injected');
 useEffect(()=>{const d=dialog.current;if(w.open){opener.current=document.activeElement as HTMLElement;d?.showModal();}else if(d?.open){d.close();opener.current?.focus();}},[w.open]);
 const named=w.connectors.some(c=>c.type==='injected'&&c.id!=='injected');
 const listed=[...w.connectors.filter(c=>c.type==='injected'),...w.connectors.filter(c=>c.type!=='injected')].filter(c=>!(c.id==='injected'&&named)&&(!mobile||c.type!=='injected'));
 return <dialog ref={dialog} className="connect-sheet" aria-labelledby="wallet-title" onCancel={w.closeConnect} onClick={e=>{if(e.target===dialog.current)w.closeConnect();}}><div className="sheet-content"><div className="sheet-head"><h2 id="wallet-title">Connect a wallet</h2><button className="secondary" aria-label="Close wallet picker" onClick={w.closeConnect}>×</button></div>
  {mobile&&OPEN_IN.map(row=><a className="wallet-row" key={row.id} href={row.href(location.href)}><img src={`./assets/wallets/${row.id}.svg`} width={28} height={28} alt=""/><span>Open in {row.name}</span></a>)}
  {listed.map(c=>{const label=c.id==='injected'?'Browser wallet':c.id==='coinbaseWalletSDK'?(mobile?'Coinbase Smart Wallet':'Coinbase Wallet'):c.name;return <button className="wallet-row secondary" key={c.uid} onClick={()=>void w.connect(c)} disabled={w.connecting}><img src={c.icon??`./assets/wallets/${c.id==='coinbaseWalletSDK'?'coinbase':'browser'}.svg`} width={28} height={28} alt=""/><span>{label}{w.pending===c.uid?' · opening…':''}</span></button>;})}
  <p className="source" role="status">{w.message||'Choose a wallet. No transaction is sent when you connect.'}</p>
 </div></dialog>;
}
