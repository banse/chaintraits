import { useEffect, useRef, useState, type ReactNode } from 'react';
import { encodeAbiParameters, encodeFunctionData, isAddress, keccak256, parseAbiParameters, parseUnits, type Address, type Hex } from 'viem';
import { A, address, registryAbi, composerAbi, curatorAbi } from './config';
import { CATALOG, CHAIN_IDS } from './catalog';
import { BURN_CAP, MIN_BURN, integrity, livePrice, read, readBurn, reg, withRpc, type BurnQuote, type Reader } from './chain';
import { DISCLAIMER_TEXT, plainGuard, poolGuard, sharedGuard, upgradeGuard, type Context, type Guard, type Reads } from './eligibility';
import { clearJournal, confirmStep, friendlyError, loadJournal, newJournal, runStep, saveJournal, type Journal, type Phase, type Plan } from './flow';
import { UNISWAP_LINK, poolId, quoteExactImd, type SwapQuote } from './swap';
import { useWallet } from './wallet';
import { ClassMark, FlowChart, InfoBox, MiniCard, PaymentChoice, Section, Source, Table, getterSource } from './components';
/* COPY: draft, owner approval pending (round 2, F-18.18): the opening question. */
export const WHY_QUESTION='Why do I need to buy traits for a card I already minted?';
export const WHY_ANSWER='You do not. The card is not the point; the wallet’s facts are. A card is minted once and shows whatever facts its wallet has, now and later. Direct facts are already there for free. The other facts are sworn on request by IMD agents: from the pool at no cost to you, or paid at the oracle price. A request never transfers the card or its facts. An accepted answer adds a credential to the wallet that any contract can check.';
/* COPY: draft, owner approval pending (round 2, F-18.22): what each oracle fact adds to the card. */
const ADDS:Record<string,string>={'chain-proven':'A sworn fact about what the wallet did in the window; the card lights the family’s highest tier.','panel':'A sworn fact a panel of 11 checked; the card lights Pretrained.','shared':'Membership in the shared top-32 list; the card lights Top Weights.'};
import { number, units } from './format';

const FEE=10n**17n, SPEC_FEE=64n*10n**17n;
const calldata=(fn:string,args:readonly unknown[]=[])=>encodeFunctionData({abi:registryAbi,functionName:fn,args});
type Spec={kind:number;target:Address;item:string;arg:string;fixedArg:string;fixedVal:bigint;sumArg:string;op:number;threshold:bigint;fromBlock:bigint;toBlock:bigint;name:string};
export function Claim({rpc,verified}:{rpc:string;verified:boolean}) {
 const w=useWallet();const walletRef=useRef(w.wallet);walletRef.current=w.wallet;
 const [price,setPrice]=useState<bigint>();const [pool,setPool]=useState<bigint>();const [burn,setBurn]=useState<BurnQuote>();const [readError,setReadError]=useState('');
 const [journal,setJournal]=useState<Journal|undefined>(loadJournal);const [payment,setPayment]=useState<'IMD'|'ETH'>('IMD');
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [quote,setQuote]=useState<SwapQuote>();const [quoteError,setQuoteError]=useState('');
 const [direct,setDirect]=useState('601');const [sponsored,setSponsored]=useState('701');const [donation,setDonation]=useState('');
 const initialTrait=Number(new URLSearchParams(location.hash.split('?')[1]).get('trait'));
 const [paid,setPaid]=useState<number[]>(CATALOG.some(t=>t.id===initialTrait&&t.id>=701&&t.id!==1201)?[initialTrait]:[701]);const [communityIds,setCommunityIds]=useState('');
 const [sharedId,setSharedId]=useState('1201');const [sharedList,setSharedList]=useState('');const [recoveryHash,setRecoveryHash]=useState('');
 const [spec,setSpec]=useState({kind:'1',target:A.WhitelistCurator,item:'event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)',arg:'contributor',fixedArg:'',fixedVal:'0',sumArg:'',op:'0',threshold:'1',fromBlock:'25769870',toBlock:'25789604',name:''});
 const [ack,setAck]=useState(false);const [eligTick,setEligTick]=useState(0);const [elig,setElig]=useState<{reads?:Reads;failed:boolean;loading:boolean}>({failed:false,loading:false});
 const loadedJournal=useRef(journal);
 useEffect(()=>{loadedJournal.current=journal;},[journal]);
 const paidIds=[...new Set([...paid,...communityIds.split(/[\s,]+/).filter(s=>/^\d+$/.test(s)).map(Number)])];const paidKey=paidIds.join(',');
 // Eligibility reads for the guards: once a wallet is connected on mainnet, read what the Registry would check and disable the refused buttons.
 useEffect(()=>{
  const wallet=w.wallet;
  if(!wallet||wallet.chainId!==1){setElig({failed:false,loading:false});return;}
  let active=true;const account=wallet.account;const poolTrait=Number(sponsored);const ids=paidKey?paidKey.split(',').map(Number):[];const shared=/^\d+$/.test(sharedId)?Number(sharedId):undefined;
  async function load(){
   setElig(prev=>({...prev,loading:true}));
   try{
    const reads=await withRpc(rpc,async c=>{
     const [first,used,lastDay,poolBalance,current,poolVerified,paidVerified,sharedVerified,sponsoredCount]=await Promise.all([
      read<readonly[bigint,boolean]>(c,address('WhitelistCurator'),curatorAbi,'firstHourOf',[account]),
      reg<boolean>(c,'poolUsed',[account,poolTrait]),reg<bigint>(c,'lastPoolDay',[account]),reg<bigint>(c,'pool'),livePrice(c),
      reg<boolean>(c,'hasTrait',[account,poolTrait]),
      Promise.all(ids.map(id=>reg<boolean>(c,'hasTrait',[account,id]))),
      shared===undefined?Promise.resolve(false):reg<boolean>(c,'hasTrait',[account,shared]),reg<number>(c,'sponsoredVerified',[account]),
     ]);
     return {pool:{joined:first[1],used,lastDay:BigInt(lastDay),pool:poolBalance,price:current,verified:poolVerified,sponsoredVerified:Number(sponsoredCount)},verifiedIds:ids.filter((_,i)=>paidVerified[i]),sharedVerified} as Reads;
    });
    if(active)setElig({reads,failed:false,loading:false});
   }catch{if(active)setElig({failed:true,loading:false});}
  }
  void load();
  return()=>{active=false;};
 },[w.wallet,rpc,sponsored,paidKey,sharedId,eligTick]);
 async function reader(){return withRpc(rpc,async c=>{await integrity(c);return c;});}
 async function refresh(){
  setReadError('');
  try {
   const result=await withRpc(rpc,async c=>{await integrity(c);const [p,b,q]=await Promise.all([livePrice(c),reg<bigint>(c,'pool'),readBurn(c).catch(()=>undefined)]);return {p,b,q};});
   setPrice(result.p);setPool(result.b);setBurn(result.q);
  } catch(e){setPrice(undefined);setPool(undefined);setBurn(undefined);setReadError(friendlyError(e));}
 }
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[rpc]);
 useEffect(()=>{
  if(!journal||journal.payment!=='ETH'||BigInt(journal.amount)===0n||journal.steps.swap?.state==='confirmed'){setQuote(undefined);setQuoteError('');return;}
  let active=true;
  async function update(){try{const q=await withRpc(rpc,c=>quoteExactImd(c,BigInt(journal!.amount)));if(active){setQuote(q);setQuoteError('');}}catch{if(active){setQuote(undefined);setQuoteError('Exact-output quote unavailable. Buy IMD on Uniswap, then use the IMD path.');}}}
  void update();const timer=setInterval(()=>void update(),15000);return()=>{active=false;clearInterval(timer);};
 },[rpc,journal?.key,journal?.payment,journal?.steps.swap?.state]);
 useEffect(()=>{setBusy(false);},[w.wallet]);
 function begin(plan:Plan){
  if(busy)return;
  const old=loadedJournal.current;
  if(old && Object.values(old.steps).some(s=>s && ['pending','awaiting wallet','unknown','replaced'].includes(s.state))){setMessage('A transaction may still be pending. Recover or confirm its receipt before preparing another flow.');return;}
  const j=newJournal(plan,plan.amount===0n?'IMD':payment);saveJournal(j);loadedJournal.current=j;setJournal(j);setQuote(undefined);setMessage('Review the exact amount and numbered steps. Each step opens a separate wallet confirmation.');
  setTimeout(()=>document.getElementById('transaction-flow')?.scrollIntoView({block:'start'}),0);
 }
 async function prepare(task:()=>Promise<Plan>){setBusy(true);setMessage('Checking the selected operation on Ethereum mainnet.');try{const plan=await task();setBusy(false);begin(plan);}catch(e){setMessage(friendlyError(e));setBusy(false);}}
 async function paidPlan(){
  const c=await reader();const current=await livePrice(c);
  const custom=communityIds.trim()?communityIds.split(/[\s,]+/).filter(Boolean).map(id=>{if(!/^\d+$/.test(id))throw Error('Community ids must be whole numbers.');return Number(id);}):[];
  const ids=[...new Set([...paid,...custom])];
  if(!ids.length)throw Error('Select at least one oracle trait.');
  for(const id of custom){if(id<10001||id>65534)throw Error('Community ids range from 10,001 to 65,534.');const s=await reg<Spec>(c,'specOf',[id]);if(![1,2,4,5].includes(s.kind))throw Error('Shared specs (kind 3) use requestSharedFact and applySharedFact. Paid upgrade accepts kinds 1, 2, 4 and 5.');}
  setPrice(current);return {key:`upgrade:${ids.join(',')}:${current}`,label:`Request ${number(ids.length)} oracle fact${ids.length===1?'':'s'}`,data:calldata('upgrade',[ids,current]),amount:current*BigInt(ids.length),maxPrice:current};
 }
 async function sponsoredPlan(){
  const c=await reader();const q=await readBurn(c);setBurn(q);
  const id=Number(sponsored);
  if(!CHAIN_IDS.includes(id))throw Error('Choose one catalog chain trait.');
  const current=await livePrice(c);setPrice(current);
  return {key:`pool:${id}:${current}`,label:'Claim one fact from the pool',data:calldata('claimSponsored',[id,current]),amount:0n,maxPrice:current,sponsored:true};
 }
 function parseSharedId(){if(!/^\d+$/.test(sharedId))throw Error('Enter a shared fact id.');const id=Number(sharedId);if(id!==1201&&(id<10001||id>65534))throw Error('Choose 1201 or a registered kind-3 community spec.');return id;}
 async function sharedRequest(){const c=await reader();const id=parseSharedId();const fact=await reg<readonly[Hex,Hex,number]>(c,'sharedFact',[id]);if(!/^0x0+$/.test(fact[0]))throw Error('This shared fact is already stored. Apply the attested list for gas instead.');const current=await livePrice(c);return {key:`shared:${id}:${current}`,label:'Request the shared ranked fact once',data:calldata('requestSharedFact',[id,current]),amount:current,maxPrice:current,shared:true};}
 async function applyShared(){
  const c=await reader();const id=parseSharedId();let list:unknown;
  try{list=JSON.parse(sharedList);}catch{throw Error('Paste the attested answer as a JSON array of Ethereum addresses.');}
  if(!Array.isArray(list)||!list.length||list.length>64||!list.every(a=>typeof a==='string'&&isAddress(a,{strict:false})))throw Error('Use the complete attested address list, with at most 64 addresses.');
  const addresses=(list as string[]).map(a=>a.toLowerCase() as Address);
  const fact=await reg<readonly[Hex,Hex,number]>(c,'sharedFact',[id]);
  if(fact[2]!==addresses.length||keccak256(encodeAbiParameters(parseAbiParameters('address[]'),[addresses]))!==fact[1])throw Error('This list does not match the stored shared answer. Use the exact attested list in its original order.');
  return {key:`apply:${id}:${fact[1]}`,label:'Apply the stored shared fact',data:calldata('applySharedFact',[id,addresses]),amount:0n};
 }
 async function specPlan(){
  const c=await reader();const kind=Number(spec.kind);
  const integers=['fixedVal','threshold','fromBlock','toBlock'] as const;
  for(const key of integers)if(!/^\d+$/.test(spec[key]))throw Error(`${key} must be an exact nonnegative integer.`);
  if(kind!==5&&!isAddress(spec.target,{strict:false}))throw Error('Enter the chain target contract address.');
  const s:Spec={kind,target:(kind===5?'0x0000000000000000000000000000000000000000':spec.target.toLowerCase()) as Address,item:kind===5?'':spec.item,arg:kind>=4?'':spec.arg,fixedArg:kind>=3?'':spec.fixedArg,fixedVal:kind>=3?0n:BigInt(spec.fixedVal),sumArg:[2,3].includes(kind)?spec.sumArg:'',op:kind===4?Number(spec.op):0,threshold:BigInt(spec.threshold),fromBlock:BigInt(spec.fromBlock),toBlock:BigInt(spec.toBlock),name:spec.name};
  const block=await c.getBlockNumber({cacheTime:0});
  await read(c,address('Composer'),composerAbi,'validateSpec',[s,block]);
  const expectedId=await reg<number>(c,'nextSpecId');
  return {key:`spec:${keccak256(calldata('registerSpec',[s,BigInt(expectedId)]))}`,label:`Register community trait: ${s.name} (id ${number(expectedId)})`,data:calldata('registerSpec',[s,BigInt(expectedId)]),amount:SPEC_FEE,spec:true};
 }
 function update(j:Journal,note?:string){loadedJournal.current=j;setJournal({...j,steps:{...j.steps}});if(note)setMessage(note);}
 async function donationPlan(){
  if(!/^\d+(?:\.\d{1,18})?$/.test(donation))throw Error('Enter a positive IMD amount with at most 18 decimal places.');
  const amount=parseUnits(donation,18);if(amount<=0n)throw Error('Enter an amount greater than zero.');
  await reader();return {key:`sponsor:${amount}`,label:'Donate IMD to the sponsor pool',data:calldata('sponsor',[amount]),amount};
 }
 async function execute(phase:Phase,recover=false){
  const wallet=w.wallet;const j=loadedJournal.current;if(!wallet||!j)return;
  setBusy(true);setMessage('Checking the current account, mainnet contracts and transaction state.');
  try {const c=await reader();const notify=(next:Journal,note?:string)=>{if(walletRef.current===wallet)update(next,note);};
   if(recover)await confirmStep(c,wallet,j,phase,notify);else await runStep(c,wallet,j,phase,notify,quote,burn?.attach);
  }catch(e){if(walletRef.current===wallet)setMessage(friendlyError(e));}
  finally{if(walletRef.current===wallet)setBusy(false);}
 }
 function reset(){
  if(journal&&Object.values(journal.steps).some(s=>s&&['pending','awaiting wallet','unknown','replaced'].includes(s.state))){setMessage('Confirm or recover the pending transaction before clearing this flow.');return;}
  clearJournal();loadedJournal.current=undefined;setJournal(undefined);setMessage('Flow cleared. Confirmed transactions remain onchain.');
 }
 function recover(){
  if(!journal||!/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)){setMessage('Enter a complete transaction hash from your wallet activity.');return;}
  const phase=(['swap','approve','registry'] as Phase[]).find(p=>journal.steps[p]?.state==='unknown'||journal.steps[p]?.state==='awaiting wallet');
  if(!phase){setMessage('There is no unresolved broadcast in this flow.');return;}
  journal.steps[phase]!.hash=recoveryHash as Hex;journal.steps[phase]!.state='pending';saveJournal(journal);update(journal,'Hash recovered. Check its receipt to continue.');
 }
 const cost=(amount?:bigint)=>amount===undefined?'RPC unavailable':`${units(amount)} IMD`;
 const selectedPaidCount=paidIds.length;
 const active=!!w.wallet&&w.wallet.chainId===1&&verified;
 const ctx:Context={connected:!!w.wallet,chainId:w.wallet?.chainId,reads:elig.reads?{...elig.reads,pool:elig.reads.pool?{...elig.reads.pool,...(price!==undefined?{price}:{}),...(pool!==undefined?{pool}:{})}:undefined}:undefined,failed:elig.failed||!!readError,loading:elig.loading,acknowledged:ack};
 const gMint=plainGuard(ctx),gPool=poolGuard(ctx),gUpgrade=upgradeGuard(ctx,paidIds),gShared=sharedGuard(ctx),gPlain=plainGuard(ctx);
 const Reason=({guard}:{guard:Guard})=>guard.ok?null:<span className="guard-reason" role="status">{guard.reason}</span>;
 return <div className="narrow claim-page"><div className="page-intro"><h1>Mint your Sworn card</h1><p>A card costs <strong>0.10 IMD</strong> <Source>Registry.MINT_FEE</Source>. No claims needed. Direct traits freeze at mint.</p></div>
  <p className="source" role="status">{w.message||(w.wallet?'Connected wallet shown in the header. Every transaction needs your confirmation.':'Use Connect in the header to choose a wallet. You can review a mint before connecting.')}</p>
  <div className="mint-block"><figure><img src="./assets/sample-card.svg" width={300} height={300} alt="Synthetic Renderer card preview"/><figcaption>Renderer preview <Source href="./assets/sample-card.svg">synthetic example</Source></figcaption></figure><div><h2>Your wallet’s card</h2><p>Mint once; add oracle traits before or after minting. A card can be sold; its direct traits are frozen at mint and its facts stay about the wallet that minted it, which alone can add traits.</p><p className="cost">0.10 IMD {getterSource('MINT_FEE')} + Ethereum gas</p><PaymentChoice payment={payment} setPayment={setPayment} name="mint"/><div className="guarded"><button onClick={()=>begin({key:'mint',label:'Mint your Sworn card',data:calldata('mintCard'),amount:FEE})} disabled={busy||!gMint.ok}>Mint card</button><Reason guard={gMint}/></div></div></div>
  <Section title={WHY_QUESTION} className="claim-why"><p className="measure">{WHY_ANSWER}</p><FlowChart/></Section>
  <label className="check-label disclaimer"><input type="checkbox" id="oracle-disclaimer" checked={ack} onChange={e=>setAck(e.target.checked)}/> {DISCLAIMER_TEXT}</label>
  <p className="flow-message" role="status">{message}</p>
  {journal&&<section className="section transaction-flow" id="transaction-flow"><h2 className="section-label">Transaction steps / {journal.label}</h2><p>Exact amount: <strong>{units(BigInt(journal.amount))} IMD</strong> <Source href={`https://etherscan.io/address/${A.Registry}#readContract`}>Registry fee / live priceOf</Source> · Payment: {journal.payment}</p>
   {!active&&<p>{!w.wallet?'Connect your wallet to continue.':w.wallet.chainId!==1?'Switch to Ethereum mainnet to continue.':'RPC verification is unavailable. Retry reads before signing.'}</p>}
   {journal.payment==='ETH'&&BigInt(journal.amount)>0n&&<><p className="source">One canonical Universal Router transaction. Exact-output quote from the v4 Quoter, 1% maximum input slippage, refreshed every 15 seconds. The output and unused ETH return to the connected account.</p>{quote?<p>Maximum input: {units(quote.maxInput)} ETH {getterSource('Quoter.quoteExactOutputSingle')} · Transaction deadline: 120 seconds <Source href="./data/addresses.json">calldata, from preparation</Source></p>:<p>{quoteError||'Reading exact-output quote…'}</p>}{quoteError&&<a href={UNISWAP_LINK}>Buy IMD on Uniswap</a>}<details><summary>Inspect the pinned swap route</summary><div className="route-details">{(['UniversalRouter','Quoter','PoolManager','Permit2','IMD','CappedBurnHook'] as const).map(key=><p key={key}>{key}: <span className="address">{A[key]}</span></p>)}<p>Pool id: <span className="address">{poolId}</span></p><p>PoolKey: native ETH / IMD, fee 10,000, tick spacing 60 <Source href="https://pool4.imd.fun">POOL4</Source></p><p>Recipient and refund recipient: <span className="address">{w.wallet?.account??'connect wallet'}</span></p></div></details></>}
   <ol className="transaction-steps">{(['swap','approve','registry'] as Phase[]).filter(p=>p==='registry'||(BigInt(journal.amount)>0n&&(p==='approve'||journal.payment==='ETH'))).map((phase,i)=>{
    const step=journal.steps[phase];const preceding=phase==='registry'?BigInt(journal.amount)===0n||journal.steps.approve?.state==='confirmed':phase==='approve'?journal.payment!=='ETH'||journal.steps.swap?.state==='confirmed':true;
    const pending=!!step?.hash&&step.state!=='confirmed';const title=phase==='swap'?'Buy exact IMD':phase==='approve'?'Approve exact IMD':'Call the Registry';
    return <li key={phase}><span className="step-number" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{step?.state??'ready'} {step?.hash&&<a className="address" href={`https://etherscan.io/tx/${step.hash}`}>{step.hash}</a>}</p><button className={phase==='registry'?'':'secondary'} disabled={!active||busy||!preceding||step?.state==='confirmed'||(phase==='swap'&&!quote&&!pending)} onClick={()=>void execute(phase,pending)}>{step?.state==='confirmed'?'Confirmed':busy?'Checking…':pending?'Check receipt':title}</button></div></li>;
   })}</ol>
   {journal.registeredId&&<p>Registered trait id: <strong>{number(journal.registeredId)}</strong> <Source href={`https://etherscan.io/tx/${journal.steps.registry?.hash}`}>This receipt’s SpecRegistered log</Source></p>}
   {journal.outcomes?.map((outcome,i)=><p key={i}>{outcome}<Source href={`https://etherscan.io/tx/${journal.steps.registry?.hash}`}>Confirmed receipt</Source></p>)}
   {Object.values(journal.steps).some(s=>s?.state==='unknown'||s?.state==='awaiting wallet')&&<div className="recover-form"><label htmlFor="recover-hash">Recover a broadcast transaction hash</label><input id="recover-hash" value={recoveryHash} onChange={e=>setRecoveryHash(e.target.value.trim())}/><button className="secondary" onClick={recover}>Recover hash</button><p className="source">A reload never resends an unresolved swap. Copy its hash from the wallet’s activity.</p></div>}
   <button className="secondary" disabled={busy} onClick={reset}>Clear finished flow</button><p className="source">Only transaction intent and hashes stay in this tab’s session storage for reload recovery. Reconnect after a reload, then check receipts. No transaction runs automatically.</p>
  </section>}
  <Section title="Add traits"><p>Choose the path for the fact. A card mint is separate from every trait request.</p><p className="live-prices">Oracle request: {cost(price)} {getterSource('priceOf')} · Pool: {cost(pool)} {getterSource('pool')}</p>{readError&&<p className="error-text">{readError}</p>}<button className="secondary" onClick={()=>{void refresh();setEligTick(n=>n+1);}} disabled={busy}>Refresh live prices and burn preview</button></Section>
  <ClaimStep number="01" title="Already true · direct reads">
   <p>Direct traits are frozen when a card is minted; wallets without a card use live Curator reads. Armed 601 means held an IDMD seat when the card was minted; it is false before minting. <Source>CATALOG §3</Source> No oracle request or claim transaction is needed.</p>
   <InfoBox who="Anyone, for any wallet; no transaction." cost="0 IMD, 0 gas: a read." risk="Direct traits are historical snapshots once minted; they do not show a later balance." benefit="The wallet, and every contract that calls hasTrait on it."/><label htmlFor="direct-id">Direct fact</label><div className="select-with-card"><select id="direct-id" value={direct} onChange={e=>setDirect(e.target.value)}>{CATALOG.filter(t=>t.id<701).map(t=><option key={t.id} value={t.id}>{t.id} / {t.name}</option>)}</select><MiniCard id={Number(direct)}/></div><p className="cost">0 IMD {getterSource('hasTrait')} · gas-free read</p><button className="secondary" onClick={()=>{if(w.wallet)location.hash=`/explorer?address=${w.wallet.account}&trait=${direct}`;else{setMessage('Connect a wallet to inspect its direct facts.');void w.connect();}}}>Check wallet facts</button>
  </ClaimStep>
  <ClaimStep number="02" title="One free pool claim a day">
   <p>Wallets in WhitelistCurator.sol can call <code>claimSponsored</code> once per trait, one catalog chain request per UTC calendar day, up to nine verified sponsored traits per wallet. The pool pays at most an eighth of its balance and at most 2 IMD per request. <Source>CATALOG §6</Source></p>
   <InfoBox who="Wallets in WhitelistCurator.sol, once per fact and once per UTC calendar day; nine verified sponsored traits per wallet." cost="0 IMD from you; the pool pays the oracle price. Gas, plus the LayerZero fee when a burn is due." risk="Each attempt uses the UTC day. A failed or missed answer releases the trait reservation; only verified sponsored traits count toward nine. No oracle price is refunded." benefit="Your wallet gets a sworn fact; the pool shrinks by one price."/>
   <label htmlFor="pool-trait">Catalog chain fact</label><div className="select-with-card"><select id="pool-trait" value={sponsored} onChange={e=>setSponsored(e.target.value)}>{CATALOG.filter(t=>CHAIN_IDS.includes(t.id)).map(t=><option key={t.id} value={t.id}>{t.id} / {t.name}</option>)}</select><MiniCard id={Number(sponsored)}/></div>
   <p className="cost">0 IMD from you; {cost(price)} from the pool {getterSource('priceOf')}</p><BurnStatus quote={burn}/><PoolPrices price={price} pool={pool}/><div className="guarded"><button onClick={()=>void prepare(sponsoredPlan)} disabled={busy||!gPool.ok}>Prepare pool claim</button><Reason guard={gPool}/></div>
   <p className="source">The pool pays only for catalog chain facts. A failed, missed or abandoned request releases the trait reservation; the UTC day stays used. An unanswered request may be abandoned after 31 days. A reverted transaction consumes no allowance.</p>
  </ClaimStep>
  <ClaimStep number="03" title="Paid upgrade">
   <p>Select catalog chain facts, Pretrained 1301, or registered community specs of kind 1, 2, 4 or 5. The cost is <code>k × priceOf</code>, <strong>spent whatever the answer</strong>. The call pins <code>maxPrice</code> to the reviewed live price.</p>
   <InfoBox who="Any wallet, for itself." cost="k × the live oracle price plus gas, spent whatever the answer." risk="A false answer stores nothing and refunds nothing; a missed panel refunds nothing." benefit="Your wallet, and everyone who holds the same fact: a curator can gate on it."/>
   <div className="trait-picker"><Table label="Oracle facts" minWidth={760}><thead><tr><th>Select</th><th>Fact</th><th className="preview-cell">Preview on an empty card</th><th>What it adds to the card</th><th>Who benefits</th></tr></thead><tbody>{CATALOG.filter(t=>t.id>=701&&t.id!==1201).map(t=><tr key={t.id} className={paid.includes(t.id)?'selected-trait':undefined}><td><input type="checkbox" aria-label={`${t.id} / ${t.name}`} checked={paid.includes(t.id)} onChange={e=>setPaid(prev=>e.target.checked?[...prev,t.id]:prev.filter(id=>id!==t.id))}/></td><td><span>{t.id} / {t.name}</span><br/><span className="source">{t.rule} · {t.window}</span> <ClassMark value={t.evidence}/></td><td className="preview-cell"><MiniCard id={t.id}/></td><td>{ADDS[t.evidence]}</td><td>Every wallet with this fact shows it; contracts that gate on id {t.id}.</td></tr>)}</tbody></Table></div>
   <p className="source">If you want to curate, only facts minted onchain count: a request without an accepted answer adds nothing to anyone.</p>
   <label htmlFor="community-ids">Additional community spec ids (comma separated)</label><input id="community-ids" value={communityIds} onChange={e=>setCommunityIds(e.target.value)} placeholder="Registered spec ids, if any"/>
   <p className="cost">{cost(price===undefined?undefined:price*BigInt(selectedPaidCount))} {getterSource('k × priceOf')} + gas</p><PaymentChoice payment={payment} setPayment={setPayment} name="upgrade"/><div className="guarded"><button onClick={()=>void prepare(paidPlan)} disabled={busy||!gUpgrade.ok}>Prepare paid upgrade</button><Reason guard={gUpgrade}/></div>
   <div className="shared-fact"><h3>Top Weights / the shared fact</h3><p>The top-32 shared fact uses panel 11 / quorum 7, every attempt costs the full price. Anyone may request it for one <code>priceOf</code>. Each of the 32 then applies the same attested list for gas. <Source>CATALOG §3, §6</Source> Nothing is fetched from the attestation API by this site; open its link in Explorer and paste the exact answer list.</p><label htmlFor="shared-id">Shared fact id</label><input id="shared-id" inputMode="numeric" value={sharedId} onChange={e=>setSharedId(e.target.value)}/><p className="cost">Request: {cost(price)} {getterSource('priceOf')} · Apply: 0 IMD {getterSource('applySharedFact')}</p><PaymentChoice payment={payment} setPayment={setPayment} name="shared"/><div className="guarded"><button className="secondary" disabled={busy||!gShared.ok} onClick={()=>void prepare(sharedRequest)}>Prepare shared request</button><Reason guard={gShared}/></div><label htmlFor="shared-list">Complete attested address list (JSON)</label><textarea id="shared-list" rows={4} value={sharedList} onChange={e=>setSharedList(e.target.value)} placeholder="Paste the complete attested answer here"/><div className="guarded"><button className="secondary" disabled={busy||!gPlain.ok} onClick={()=>void prepare(applyShared)}>Prepare to apply the fact</button><Reason guard={gPlain}/></div></div>
  </ClaimStep>
  <ClaimStep number="04" title="Add a community trait">
   <p>A community trait costs 6.9 IMD: 0.5 for your first claim and 6.4 IMD paid forward into the pool by registerSpec().</p><p>Registration pays <strong>6.4 IMD</strong> <Source>Registry.SPEC_FEE</Source>. The first claim is a separate request at the live price: {cost(price)} {getterSource('priceOf')}. The immutable spec’s id comes from your own receipt’s <code>SpecRegistered(traitId, registrant)</code> log.</p>
   <div className="spec-fields"><label>Template<select value={spec.kind} onChange={e=>setSpec({...spec,kind:e.target.value})}><option value="1">T1 / count matching logs</option><option value="2">T2 / sum matching logs</option><option value="3">T3 / shared ranked list</option><option value="4">T4 / compare a historical call</option><option value="5">T5 / historical account nonce</option></select></label>
    {Number(spec.kind)!==5&&<><Field title="Target contract" value={spec.target} set={target=>setSpec({...spec,target})}/><Field title="Event or function ABI item" value={spec.item} set={item=>setSpec({...spec,item})}/></>}
    {[1,2,3].includes(Number(spec.kind))&&<Field title={spec.kind==='3'?'Group-by indexed argument':'Claimant indexed argument'} value={spec.arg} set={arg=>setSpec({...spec,arg})}/>}
    {[1,2].includes(Number(spec.kind))&&<><Field title="Optional second indexed argument" value={spec.fixedArg} set={fixedArg=>setSpec({...spec,fixedArg})}/><Field title="Second filter value (exact uint256)" value={spec.fixedVal} set={fixedVal=>setSpec({...spec,fixedVal})}/></>}
    {[2,3].includes(Number(spec.kind))&&<Field title="Field to sum" value={spec.sumArg} set={sumArg=>setSpec({...spec,sumArg})}/>}
    {spec.kind==='4'&&<label>Comparison<select value={spec.op} onChange={e=>setSpec({...spec,op:e.target.value})}><option value="0">Choose comparison</option><option value="1">&gt;=</option><option value="2">&gt;</option><option value="3">&lt;=</option><option value="4">&lt;</option><option value="5">==</option></select></label>}
    <Field title={spec.kind==='3'?'Head count (1 to 32)':'Threshold (exact uint256)'} value={spec.threshold} set={threshold=>setSpec({...spec,threshold})}/><Field title="First block (decimal)" value={spec.fromBlock} set={fromBlock=>setSpec({...spec,fromBlock})}/><Field title="Last block (decimal)" value={spec.toBlock} set={toBlock=>setSpec({...spec,toBlock})}/><Field title="Trait name (1 to 32 ASCII characters)" value={spec.name} set={name=>setSpec({...spec,name})}/>
   </div><p className="source">Kinds 1–4 require a window of at least 7,200 blocks, ending at least 64 blocks behind the current block. Kind 5 uses one block at least 7,200 blocks old and the contract-mandated zero target. Numbers stay exact integers. Composer.validateSpec checks the complete spec before any approval.</p><p className="cost">6.4 IMD {getterSource('SPEC_FEE')} + gas, then a separate first claim</p><PaymentChoice payment={payment} setPayment={setPayment} name="spec"/><div className="guarded"><button disabled={busy||!gPlain.ok} onClick={()=>void prepare(specPlan)}>Prepare spec registration</button><Reason guard={gPlain}/></div>
  </ClaimStep>
  <Section title="Donate to the pool"><p>Anyone can donate IMD to fund catalog chain requests. Donations are spent by the registry’s public pool rules and cannot be withdrawn.</p><label htmlFor="donation">IMD amount</label><input id="donation" inputMode="decimal" value={donation} onChange={e=>setDonation(e.target.value.trim())}/><PaymentChoice payment={payment} setPayment={setPayment} name="donation"/><button className="secondary" disabled={busy||!gPlain.ok} onClick={()=>void prepare(donationPlan)}>Prepare pool donation</button></Section>
 </div>;
}
export function PoolPrices({price,pool}:{price?:bigint;pool?:bigint}){return <div className="pool-prices"><dl><div><dt>Live Intake price</dt><dd>{price===undefined?'Reading…':`${units(price)} IMD`} {getterSource('priceOf')}</dd></div><div><dt>Sponsor pool</dt><dd>{pool===undefined?'Reading…':`${units(pool)} IMD`} {getterSource('pool')}</dd></div></dl>{price!==undefined&&pool!==undefined&&(price>pool/8n||price>2n*10n**18n||price===0n)&&<p className="error-text" role="status">{price===0n?'The Intake price is zero; requests revert.':price>pool/8n?'The live price exceeds an eighth of the pool; a pool claim will revert. Donate to the pool or use a paid upgrade.':'The live price exceeds the 2 IMD draw cap; a pool claim will revert. Use a paid upgrade.'}</p>}</div>;}
function ClaimStep({number:n,title,children}:{number:string;title:string;children:ReactNode}){return <section className="claim-step" id={`step-${n}`}><div className="step-number" aria-hidden="true">{n}</div><div className="step-body"><h2>{title}</h2>{children}</div></section>;}
function Field({title,value,set}:{title:string;value:string;set:(s:string)=>void}){return <label>{title}<input value={value} onChange={e=>set(e.target.value)} spellCheck={false}/></label>;}
function BurnStatus({quote:q}:{quote?:BurnQuote}){return <div className="burn-status"><h3>The sponsored-claim burn</h3>{q?<><p>Waiting IMD: {units(q.amount)} <Source>BurnExecutor V2.previewBridge</Source></p><p>{q.amount<MIN_BURN?'Below 69 IMD: no ETH is attached.':q.fee>BURN_CAP?'The fee exceeds the 0.005 ETH cap: the burn is skipped and no ETH is attached.':`At least 69 IMD is waiting. Attach exactly ${units(q.attach)} ETH for the LayerZero fee.`} <Source>Registry burn rule</Source></p><p className="source">Preview block {number(q.block)}. At exactly 69 IMD the burn qualifies; at exactly the fee cap the quoted fee is attached. The preview is read again before signing. A changed quote stops the flow for review. A failed preview cannot authorize a guessed fee.</p></>:<p>RPC unavailable / burn preview pending. Refresh before preparing a sponsored claim.</p>}<p className="source">A caught bridge failure leaves the oracle request pending and refunds the attachment. On success the executor returns surplus ETH; the interface attaches only the quoted fee. BurnTriggered records source-chain submission, not completed Base delivery. Read the receipt for BurnTriggered or BurnSkipped.</p></div>;}
