// Mainnet data adapters. Views never synthesize credentials from discovery evidence.
const ADDRESS = /^0x[0-9a-f]{40}$/i;
export const halt = signal => { if (signal?.aborted) throw new DOMException('Read cancelled.', 'AbortError'); };
const emptyMetrics = () => ({hour:null,deposits:null,largestWei:null,points:null,index:null});
const unique = values => [...new Set(values)].sort((a,b)=>a-b);
const safeNumber = value => value !== null && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value)>=0 ? Number(value) : null;
export function candidate(address, historicalFacts=[], metrics={}) {
  if (!ADDRESS.test(address)) throw Error('Invalid candidate address.');
  return {address:address.toLowerCase(),tokenId:null,owner:null,censusMember:true,directFacts:[],verifiedFacts:[],historicalFacts:unique(historicalFacts),pendingFacts:[],unknownFacts:[],checkedFacts:[],readStatus:'historical',blockNumber:null,checkedAt:null,metrics:{...emptyMetrics(),...metrics}};
}
export async function loadHistoricalCandidates({pin,fetcher=(...args)=>fetch(...args),digest=bytes=>crypto.subtle.digest('SHA-256',bytes),base=document.baseURI,signal}) {
  const result=[];
  for (const [name, expected] of Object.entries(pin.files)) {
    halt(signal);
    if(!/^wallets-[0-9a-f]\.json$/.test(name))throw Error('Invalid historical shard path.');
    const response=await fetcher(new URL(`data/eligibility/${name}`,base).href,{signal});
    if(!response.ok)throw Error('Historical candidate snapshot unavailable. Retry loading.');
    const bytes=await response.arrayBuffer();halt(signal);
    if(bytes.byteLength!==expected.bytes)throw Error('Historical snapshot length mismatch.');
    const hash=Array.from(new Uint8Array(await digest(bytes)),n=>n.toString(16).padStart(2,'0')).join('');halt(signal);
    if(hash!==expected.sha256)throw Error('Historical snapshot hash mismatch.');
    const rows=JSON.parse(new TextDecoder().decode(bytes));
    if(!rows||Array.isArray(rows)||typeof rows!=='object')throw Error('Invalid historical snapshot.');
    for(const [wallet,counts] of Object.entries(rows)) {
      if(!new RegExp(`^0x${name[8]}[0-9a-f]{39}$`).test(wallet)||!Array.isArray(counts)||counts.length!==pin.factIds.length||counts.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid historical snapshot row.');
      const ids=pin.factIds.filter((id,i)=>BigInt(counts[i])>=BigInt(pin.facts[id].spec.threshold));
      result.push(candidate(wallet,[101,...ids]));
    }
  }
  return result.sort((a,b)=>a.address.localeCompare(b.address));
}
export function mergeCandidateRows(previous, incoming) {
  const rows=new Map(previous.map(row=>[row.address.toLowerCase(),row]));
  for (const row of incoming) {
    const key=row.address.toLowerCase(),old=rows.get(key);
    if(!old){rows.set(key,row);continue;}
    const preserve=row.readStatus==='historical'&&old.readStatus!=='historical';
    const chosen=preserve?old:row;
    // Current reads own their whole metric set, including unknown/null. A failed
    // fresh read must not inherit old values under a newer block label.
    rows.set(key,{...chosen,address:key,historicalFacts:unique([...old.historicalFacts,...row.historicalFacts]),metrics:{...chosen.metrics}});
  }
  return [...rows.values()].sort((a,b)=>a.address.localeCompare(b.address));
}
export function rowsFromCensus(logs,meta) {
  const addresses=new Set(),indices=new Set(),rows=[];
  for(const log of logs) {
    const args=log.args||{},address=String(args.contributor||'').toLowerCase(),index=safeNumber(args.index),timestamp=safeNumber(args.timestamp);
    if(log.removed||!ADDRESS.test(address)||!index||timestamp===null)throw Error('Invalid FirstDeposit census record.');
    if(addresses.has(address)||indices.has(index))throw Error('Duplicate FirstDeposit census record.');
    addresses.add(address);indices.add(index);
    const hour=Math.floor((timestamp-meta.launchTime)/meta.hourDuration);
    if(hour<0||hour>65)throw Error('FirstDeposit is outside the game window.');
    const historic=[101,...(hour<=1?[201]:[]),...(hour===0?[202]:[])];
    for(const [id,ordinal] of [[1101,1],[1102,1000],[1103,10000],[1104,19522]])if(index===ordinal)historic.push(id);
    if(index<=1000)historic.push(1105);
    rows.push(candidate(address,historic,{hour,index}));
  }
  if(rows.length!==meta.contributors||[...indices].some(n=>n<1||n>meta.contributors))throw Error('Incomplete FirstDeposit census. No partial list was accepted.');
  return rows;
}
export function combineFactStates(facts,match='any') {
  if(!['any','all'].includes(match))throw Error('Invalid fact match rule.');
  if(!facts.length)return 'no-rule';
  if(match==='any')return facts.some(f=>f.state==='present')?'eligible':facts.some(f=>f.state==='unknown')?'unknown':'not-eligible';
  return facts.some(f=>['absent','pending'].includes(f.state))?'not-eligible':facts.some(f=>f.state==='unknown')?'unknown':'eligible';
}
export async function consumeCurrentFacts({address,ids,match='any',readRegistry,blockNumber,signal}) {
  halt(signal);
  if(!ADDRESS.test(address))throw Error('Enter an address with 0x and 40 hexadecimal characters.');
  if(ids.some(id=>!Number.isInteger(id)||id<1||id>65535))throw Error('Invalid fact ID.');
  const facts=await Promise.all(unique(ids).map(async id=>{
    halt(signal);
    try {const result=await readRegistry('hasTrait',[address,id],{blockNumber:BigInt(blockNumber)});halt(signal);if(typeof result!=='boolean')throw Error('Invalid fact response.');return {id,state:result?'present':'absent'};}
    catch(error){halt(signal);return {id,state:'unknown',error:error instanceof Error?error.message:'Read failed.'};}
  }));
  halt(signal);return {status:combineFactStates(facts,match),facts,blockNumber,checkedAt:new Date().toISOString()};
}
export async function readCurrentWallet({address,facts,readRegistry,readCurator,blockNumber,signal}) {
  halt(signal);
  const extra={blockNumber:BigInt(blockNumber)};
  const attempt=async(fn,args,loader)=>{halt(signal);try{const value=await loader(fn,args,extra);halt(signal);return value;}catch(error){halt(signal);return null;}};
  const [record,token,first,deposits,capital,points]=await Promise.all([
    consumeCurrentFacts({address,ids:facts.map(f=>f.id),readRegistry,blockNumber,signal}),
    attempt('tokenOf',[address],readRegistry),
    ...['firstHourOf','txCountOf','contributedBy','pointsOf'].map(fn=>attempt(fn,[address],readCurator)),
  ]);
  halt(signal);
  const owner=typeof token==='bigint'&&token>0n?await attempt('ownerOf',[token],readRegistry):null;
  const present=record.facts.filter(f=>f.state==='present').map(f=>f.id),unknown=record.facts.filter(f=>f.state==='unknown').map(f=>f.id);
  const direct=new Set(facts.filter(f=>f.kind===0).map(f=>f.id));
  return {...candidate(address),tokenId:typeof token==='bigint'?String(token):null,owner:ADDRESS.test(owner||'')?owner:null,censusMember:Array.isArray(first)&&typeof first[1]==='boolean'?first[1]:null,directFacts:present.filter(id=>direct.has(id)),verifiedFacts:present.filter(id=>!direct.has(id)),unknownFacts:unknown,checkedFacts:record.facts.filter(f=>f.state!=='unknown').map(f=>f.id),readStatus:unknown.length?'partial':'current',blockNumber,checkedAt:record.checkedAt,metrics:{...emptyMetrics(),hour:first?.[1]?safeNumber(first[0]):null,deposits:safeNumber(deposits),largestWei:typeof capital==='bigint'?String(capital):null,points:safeNumber(points)}};
}
