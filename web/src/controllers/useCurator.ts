import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {parseAbiItem} from 'viem';
import {useSite} from '../context';
import {contract,read,scopedClient,explain} from '../chain';
import {TRAITS} from '../data';
import pin from '../eligibility-snapshot-pin.mjs';
import census from '../../public/data/hours.json';
import {loadHistoricalCandidates,readCurrentWallet,consumeCurrentFacts,mergeCandidateRows,rowsFromCensus,halt} from '../models/curator-live.mjs';

export type CuratorFact={id:number;name:string;kind:number;builtin:boolean};
export type CuratorRow={address:string;tokenId:string|null;owner:string|null;censusMember:boolean|null;directFacts:number[];verifiedFacts:number[];historicalFacts:number[];pendingFacts:number[];unknownFacts:number[];checkedFacts:number[];readStatus:string;blockNumber:number|null;checkedAt:string|null;metrics:Record<string,number|string|null>;weight?:number;matchedFacts?:number[]};
export function useCurator() {
 const site=useSite(),{r,client,health,specs}=site;
 const expected=useMemo(()=>({chainId:r.deployment.chainId,registry:contract(r,'Registry').address,sourceCommit:r.deployment.sourceCommit}),[r]);
 const facts=useMemo<CuratorFact[]>(()=>[...TRAITS.map(t=>({id:t.id,name:t.name,kind:t.class==='direct'?0:t.class==='shared'?3:t.class==='panel'?6:1,builtin:true})),...specs.map(s=>({id:Number(s.id),name:String(s.name),kind:Number(s.kind),builtin:false}))],[specs]);
 const [rows,setRows]=useState<CuratorRow[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[fullCensus,setFullCensus]=useState(false);
 const [checking,setChecking]=useState(false),[progress,setProgress]=useState(''),[consumption,setConsumption]=useState<any>(null),[consuming,setConsuming]=useState(false);
 const discovery=useRef<AbortController|null>(null),checks=useRef<AbortController|null>(null),consumer=useRef<AbortController|null>(null);
 const merge=useCallback((next:CuratorRow[])=>setRows(old=>mergeCandidateRows(old,next)),[]);
 const load=useCallback(async()=>{
  discovery.current?.abort();const c=new AbortController();discovery.current=c;setLoading(true);setError('');
  try{const value=await loadHistoricalCandidates({pin,signal:c.signal});halt(c.signal);merge(value);}
  catch(e){if(!c.signal.aborted)setError(explain(e));}
  finally{if(discovery.current===c){discovery.current=null;setLoading(false);}}
 },[merge]);
 useEffect(()=>{void load();return()=>{discovery.current?.abort();checks.current?.abort();consumer.current?.abort();};},[load]);
 // A provider/deployment change invalidates all accepted-read cache entries.
 useEffect(()=>{checks.current?.abort();consumer.current?.abort();setChecking(false);setConsuming(false);setConsumption(null);setRows(old=>old.map(row=>({...row,readStatus:'historical',directFacts:[],verifiedFacts:[],checkedFacts:[],unknownFacts:[],blockNumber:null,checkedAt:null,tokenId:null,owner:null})));},[client,r]);
 const loadCensus=useCallback(async()=>{
  if(!health){setError('Wait for the Ethereum deployment check before reading the census.');return;}
  discovery.current?.abort();const c=new AbortController();discovery.current=c;setLoading(true);setError('');setProgress('Reading the complete FirstDeposit census from Ethereum…');
  const timeout=setTimeout(()=>c.abort(),120000);
  try {
   const scoped=scopedClient(client,c.signal);
   if(r.deployment.chainId!==census.chainId||health.deps.curator.toLowerCase()!==census.curator)throw Error('Census belongs to a different deployment.');
   const closing=await scoped.getBlock({blockNumber:BigInt(census.toBlock)});halt(c.signal);
   if(closing.hash?.toLowerCase()!==census.closingBlockHash)throw Error('Historical closing block differs from the pinned census.');
   const logs=await scoped.getLogs({address:health.deps.curator,event:parseAbiItem('event FirstDeposit(address indexed contributor, uint256 indexed index, uint256 timestamp)'),fromBlock:BigInt(census.fromBlock),toBlock:BigInt(census.toBlock)});halt(c.signal);
   const value=rowsFromCensus(logs,census);merge(value);setFullCensus(true);setProgress(`Loaded ${value.length.toLocaleString()} historical participants. Credentials still require Registry reads.`);
  }catch(e){if(!c.signal.aborted)setError(explain(e));else setProgress('Census read cancelled or timed out. Existing rows were kept.');}
  finally{clearTimeout(timeout);if(discovery.current===c){discovery.current=null;setLoading(false);}}
 },[r,client,health,merge]);
 const checkWallets=useCallback(async(addresses:string[])=>{
  if(!health){setError('Wait for the Ethereum deployment check before reading wallet facts.');return;}
  checks.current?.abort();const c=new AbortController();checks.current=c;setChecking(true);setError('');
  const timeout=setTimeout(()=>c.abort(),120000);
  try{
   const scoped=scopedClient(client,c.signal),blockNumber=Number(await scoped.getBlockNumber());halt(c.signal);
   const list=[...new Set(addresses.map(a=>a.toLowerCase()))].slice(0,50);
   const readRegistry=(fn:string,args:any[],extra:any)=>read(scoped,r,'Registry',fn,args,extra);
   const readCurator=(functionName:string,args:any[],extra:any)=>scoped.readContract({address:health.deps.curator,abi:r.abis.WhitelistCurator,functionName,args,...extra});
   for(let i=0;i<list.length;i++){halt(c.signal);setProgress(`Checking wallet ${i+1} of ${list.length} at block ${blockNumber.toLocaleString()}…`);const row=await readCurrentWallet({address:list[i],facts,readRegistry,readCurator,blockNumber,signal:c.signal});halt(c.signal);merge([row]);}
   setProgress(`Read ${list.length} wallet${list.length===1?'':'s'} at Ethereum block ${blockNumber.toLocaleString()}. Unavailable responses remain unknown.`);
  }catch(e){if(!c.signal.aborted)setError(explain(e));else setProgress('Wallet checks cancelled or timed out. Completed reads remain listed with their block.');}
  finally{clearTimeout(timeout);if(checks.current===c){checks.current=null;setChecking(false);}}
 },[health,client,r,facts,merge]);
 const consume=useCallback(async(address:string,ids:number[],match:'any'|'all')=>{
  consumer.current?.abort();setConsumption(null);
  if(!address)return;
  if(!health){setConsumption({status:'unknown',facts:[],error:'Ethereum deployment check is not ready. Retry once connected.'});return;}
  const c=new AbortController();consumer.current=c;setConsuming(true);
  const timeout=setTimeout(()=>c.abort(),30000);
  try{const scoped=scopedClient(client,c.signal),blockNumber=Number(await scoped.getBlockNumber());halt(c.signal);const result=await consumeCurrentFacts({address,ids,match,readRegistry:(fn:string,args:any[],extra:any)=>read(scoped,r,'Registry',fn,args,extra),blockNumber,signal:c.signal});halt(c.signal);setConsumption(result);}
  catch(e){if(!c.signal.aborted)setConsumption({status:'unknown',facts:[],error:explain(e)});else if(consumer.current===c)setConsumption({status:'unknown',facts:[],error:'Read cancelled or timed out. Retry the eligibility check.'});}
  finally{clearTimeout(timeout);if(consumer.current===c){consumer.current=null;setConsuming(false);}}
 },[health,client,r]);
 const cancelChecks=useCallback(()=>{checks.current?.abort();consumer.current?.abort();},[]);
 const snapshot=useMemo(()=>({...expected,mock:false as const,blockNumber:health?Number(health.block):null,generatedAt:new Date().toISOString(),facts,wallets:rows}),[expected,health,facts,rows]);
 return {snapshot,expected,loading,error,load,loadCensus,fullCensus,checking,checkWallets,progress,consumption,consuming,consume,cancelChecks,cancelLoading:()=>discovery.current?.abort(),specError:site.specError};
}
