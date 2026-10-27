import {useEffect,useMemo,useRef,useState} from 'react';
import {CodeBlock} from './components';
import {buildCuratorExport,currentFacts,DATA_KIND,filterCandidates,formatWei,gateSource,parseCuratorQuery,curatorDraftKey,readCuratorDraft,unresolvedCandidates} from './curator-model.mjs';
import {useCurator,type CuratorFact as Fact,type CuratorRow as Row} from './controllers/useCurator';
import './curator.css';

type Ranges = Record<string,{min?:string;max?:string}>;
type SavedList = {addresses:string[];weights:Record<string,number>;generatedAt:string;mode:string;registry:string;rule:string};
const RANGES=[['hour','First hour'],['deposits','Deposits'],['largestWei','Largest send (ETH)'],['points','Points'],['index','Curator index']];
const names=(ids:number[],facts:Fact[])=>ids.map(id=>`${id} / ${facts.find(f=>f.id===id)?.name||'Unknown fact'}`).join(', ');

export function Curator() {
  const {snapshot,expected,loading,error:loadError,load,loadCensus,fullCensus,checking,checkWallets,progress,consumption,consuming,consume,cancelChecks,cancelLoading,specError}=useCurator();
  const storageKey=useMemo(()=>curatorDraftKey('mainnet',expected),[expected]);
  const [initial]=useState(()=>{try{return readCuratorDraft(sessionStorage,storageKey);}catch{return null;}});
  const [query]=useState(()=>parseCuratorQuery(location.hash));
  const queryToken=useRef(query.token);
  const [queryError,setQueryError]=useState(query.error);
  const [tab,setTab]=useState<'build'|'consume'>(initial?.tab||'build');
  const [selected,setSelected]=useState<Record<number,number>>(()=>query.selected&&query.token!==initial?.queryToken?query.selected:initial?.selected||{});
  const [match,setMatch]=useState<'any'|'all'>(initial?.match||'any');
  const [mode,setMode]=useState<'current'|'historical'>(initial?.mode||'historical');
  const [ranges,setRanges]=useState<Ranges>(initial?.ranges||{}),[search,setSearch]=useState(initial?.search||'');
  const [format,setFormat]=useState<'csv'|'json'>(initial?.format||'csv'),[exporting,setExporting]=useState(false),[feedback,setFeedback]=useState('');
  const [saved,setSaved]=useState<SavedList|null>(initial?.saved||null);
  const [address,setAddress]=useState(initial?.address||''),[checkedAddress,setCheckedAddress]=useState(initial?.checkedAddress||'');
  const [candidateAddress,setCandidateAddress]=useState(''),[consumeRetry,setConsumeRetry]=useState(0);
  const activeExport=useRef<AbortController|null>(null),tabs=useRef<(HTMLButtonElement|null)[]>([]);
  const ids=useMemo(()=>Object.keys(selected).map(Number),[selected]);
  const filters=useMemo(()=>({selected,match,mode,ranges}),[selected,match,mode,ranges]);
  const filtered=useMemo(()=>{try{if(queryError)throw Error(queryError);return {rows:filterCandidates(snapshot,filters) as Row[],error:''};}catch(e){return {rows:[],error:e instanceof Error?e.message:'Invalid filters.'};}},[snapshot,filters,queryError]);
  const candidates=useMemo(()=>{try{return filterCandidates(snapshot,{...filters,mode:'historical'}).filter((row:Row)=>row.readStatus==='historical'||row.unknownFacts.length).slice(0,50) as Row[];}catch{return [];}},[snapshot,filters]);
  const unknown=unresolvedCandidates(snapshot,ids,match,ranges);
  const factKey=snapshot.facts.map(f=>f.id).join(',');
  const visibleFacts=snapshot.facts.filter(f=>`${f.id} ${f.name}`.toLowerCase().includes(search.toLowerCase()));
  const gate=useMemo(()=>{try{if(ids.some(id=>!snapshot.facts.some(f=>f.id===id)))return 'Select a fact from this deployment before copying a consumer rule.';return gateSource(expected,ids,match);}catch{return 'Invalid fact rule. Reset the filters or select a known fact.';}},[expected,ids,match,snapshot.facts]);
  useEffect(()=>{const update=()=>{if(!location.hash.startsWith('#/curator'))return;const next=parseCuratorQuery(location.hash);setQueryError(next.error);if(next.token!==queryToken.current&&next.selected)setSelected(next.selected);queryToken.current=next.token;};addEventListener('hashchange',update);return()=>removeEventListener('hashchange',update);},[]);
  useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({version:1,tab,selected,match,mode,ranges,search,format,saved,address,checkedAddress,queryToken:queryToken.current}));}catch{}},[storageKey,tab,selected,match,mode,ranges,search,format,saved,address,checkedAddress]);
  useEffect(()=>{cancelChecks();if(!queryError&&ids.every(id=>snapshot.facts.some(f=>f.id===id)))void consume(checkedAddress,ids,match);else void consume('',[],match);return cancelChecks;},[checkedAddress,ids,match,queryError,factKey,consume,cancelChecks,consumeRetry]);
  useEffect(()=>()=>activeExport.current?.abort(),[]);
  function resetFilters(){setSelected({});setRanges({});setMode('historical');setMatch('any');setSearch('');setFeedback('');setQueryError('');}
  function choose(id:number,checked:boolean){setSelected(old=>{const next={...old};if(checked)next[id]=1;else delete next[id];return next;});}
  async function save(){
    if(exporting||filtered.error||!filtered.rows.length)return;
    const controller=new AbortController();activeExport.current=controller;setExporting(true);setFeedback('');
    try{
      const content=await buildCuratorExport(snapshot,filtered.rows,format,filters,{signal:controller.signal});
      if(controller.signal.aborted)return;
      const url=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`sworn-${mode==='current'?'registry-reads':'historical-candidates'}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setSaved({addresses:filtered.rows.map(row=>row.address.toLowerCase()),weights:Object.fromEntries(filtered.rows.map(row=>[row.address.toLowerCase(),row.weight||0])),generatedAt:snapshot.generatedAt,mode,registry:snapshot.registry,rule:JSON.stringify(filters)});
      setFeedback(`Exported ${filtered.rows.length} wallets. The saved list is ready to test in Consume facts.`);
    }catch(e){setFeedback(e instanceof Error?e.message:'Export failed.');}
    finally{if(activeExport.current===controller){activeExport.current=null;setExporting(false);}}
  }
  function openConsumer(wallet:string){setAddress(wallet);setCheckedAddress(wallet);setConsumeRetry(v=>v+1);setTab('consume');tabs.current[1]?.focus();}
  const statusLabel=consumption?.status==='eligible'?'Meets this fact rule':consumption?.status==='not-eligible'?'Does not currently meet this fact rule':consumption?.status==='no-rule'?'Select facts to define a rule':'Unknown — a required read was unavailable';
  const currentRow=snapshot.wallets.find(row=>row.address.toLowerCase()===checkedAddress.toLowerCase());
  return <div className="curator-page">
    <h1>Curate and Consume Facts</h1>
    <p className="prose">Build a wallet list from facts, then try the rule a consuming app would use. Cards are optional. A wallet keeps its facts when its card changes hands.</p>
    <div className="curator-notice"><strong>Historical discovery · current Registry checks</strong><p>The shipped, hash-checked game evidence helps find candidates. It does not grant accepted facts. Check wallets against Ethereum before using current eligibility. Any address can be checked, including wallets without a card or outside the original game.</p></div>
    <div className="curator-top-actions">
      <button onClick={()=>void load()} disabled={loading}>{loading?'Loading historical evidence…':'Reload historical evidence'}</button>
      <button onClick={()=>void loadCensus()} disabled={loading}>{fullCensus?'Reload complete game census':'Load all 19,522 game wallets'}</button>{loading&&<button onClick={cancelLoading}>Cancel loading</button>}
      <a href="#/register">Community Facts</a><a href="#/request">Wallet Facts</a>
    </div>
    {loadError&&<p role="alert" className="danger">{loadError}</p>}{specError&&<p role="alert" className="danger">{specError} Community discovery may be incomplete; retry chain reads in the header.</p>}<p role="status">{progress}</p>
    {queryError&&<p role="alert" className="danger">{queryError} <button onClick={resetFilters}>Reset filters</button></p>}
    {loading&&!snapshot.wallets.length&&!loadError&&<p role="status">Loading the historical candidate directory…</p>}
    {snapshot&&<>
      <details className="curator-provenance"><summary>Dataset and contract reference</summary><dl><dt>Registry</dt><dd className="break">{snapshot.registry}</dd><dt>Chain</dt><dd>{snapshot.chainId} · Ethereum mainnet</dd><dt>Source commit</dt><dd className="break">{snapshot.sourceCommit}</dd><dt>Health read block</dt><dd>{snapshot.blockNumber?.toLocaleString()||"Unavailable"}</dd><dt>Last read</dt><dd>{new Date(snapshot.generatedAt).toLocaleTimeString()}</dd></dl><p>{snapshot.wallets.length.toLocaleString()} discovered or manually added addresses. {fullCensus?"The complete historical game census has been read.":"Initial coverage contains only wallets with matches in the nine shipped event snapshots, not the whole game."} This is not a global wallet index. Current reads are requested explicitly and carry their own block number; an undiscovered address can still qualify.</p></details>
      <div role="tablist" aria-label="Curator tasks" className="curator-tabs" onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?1:tab==='build'?1:0;setTab(next===0?'build':'consume');tabs.current[next]?.focus();}}>
        {(['build','consume'] as const).map((key,i)=><button key={key} ref={node=>{tabs.current[i]=node;}} role="tab" id={`curator-tab-${key}`} aria-selected={tab===key} aria-controls={`curator-panel-${key}`} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)}>{key==='build'?'Build a list':'Consume facts'}</button>)}
      </div>
      <section className="curator-rule" aria-labelledby="curator-rule-title">
        <h2 id="curator-rule-title">Choose Facts</h2>
        <p>Direct facts and accepted wallet facts are available together, including community facts. Pending requests never count as accepted.</p>
        <div className="curator-rule-tools"><label>Match rule<select value={match} onChange={e=>setMatch(e.target.value as 'any'|'all')}><option value="any">Any selected fact (OR)</option><option value="all">Every selected fact (AND)</option></select></label><label>Find a fact<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or fact ID"/></label><button onClick={resetFilters}>Reset filters</button></div>
        <p className="muted">{ids.length?`${ids.length} selected. Weights add up for matched facts; zero weight still matches.`:'No facts selected: the chosen evidence mode lists its known wallets; a consumer rule is not defined yet.'}</p>
        <div className="curator-facts">{visibleFacts.map(f=><div className="curator-fact" key={f.id}><label className="curator-checkbox"><input type="checkbox" checked={f.id in selected} onChange={e=>choose(f.id,e.target.checked)}/><span>{f.id} / {f.name}<small>{f.builtin?'Built-in fact':'Community fact'}{f.kind===3?' · shared':''}</small></span></label><label className="curator-weight">Weight <span className="sr-only">for fact {f.id}</span><input type="number" min="0" step="1" value={Number.isNaN(selected[f.id])?'':selected[f.id]??1} disabled={!(f.id in selected)} onChange={e=>setSelected(old=>({...old,[f.id]:e.target.value===''?Number.NaN:Number(e.target.value)}))}/></label></div>)}</div>
        {!visibleFacts.length&&<p role="status">No facts match this search. <button onClick={()=>setSearch('')}>Clear search</button></p>}
        {!specError&&snapshot.blockNumber!==null&&!snapshot.facts.some(f=>!f.builtin)&&<p className="muted">No community rules were found by the latest successful Registry read. <a href="#/register">Mint Rule</a>, then return here to select its fact ID.</p>}
      </section>
      <section role="tabpanel" id="curator-panel-build" aria-labelledby="curator-tab-build" hidden={tab!=='build'}>
        <h2>Matching Wallets</h2>
        <label className="curator-mode">List evidence<select value={mode} onChange={e=>setMode(e.target.value as 'current'|'historical')}><option value="current">Current Registry reads</option><option value="historical">Historical candidates only</option></select></label>
        {mode==='historical'?<p className="curator-warning">Historical candidates are inferred from the old game. They may have no accepted fact. This mode is for research, not eligibility proof; Consume facts always reads current Registry facts.</p>:<p className="muted">Only explicitly checked wallets are shown here, using direct facts plus accepted verifications at the displayed read block. A stored shared list counts only after application to that wallet. Refresh checks before relying on an export.</p>}
        <form className="curator-consumer-form" onSubmit={e=>{e.preventDefault();void checkWallets([candidateAddress.trim()]);}}><label htmlFor="curator-add-address">Add or refresh any wallet</label><div><input id="curator-add-address" value={candidateAddress} onChange={e=>setCandidateAddress(e.target.value)} placeholder="0x… (including wallets outside the census)" spellCheck={false}/><button type="submit" disabled={checking||!candidateAddress.trim()}>Read wallet facts</button></div></form>
        <div className="curator-top-actions"><button onClick={()=>void checkWallets(candidates.map(row=>row.address))} disabled={checking||!candidates.length}>Check next {candidates.length||'up to 50'} historical candidates</button>{checking&&<button onClick={cancelChecks}>Cancel wallet checks</button>}</div>
        <p className="muted">{snapshot.wallets.filter(row=>row.readStatus!=='historical').length} wallets checked; {snapshot.wallets.filter(row=>row.readStatus==='historical').length} remain unchecked. Bulk checks use up to 50 matching historical candidates at a time. Community facts and other undiscovered wallets can be checked by address.</p>
        {unknown>0&&<p role="alert" className="curator-warning">{unknown} checked wallets have an unresolved result or bounded metric for this selection. They are excluded from the current matching export, not classified as ineligible. Read those wallets again to retry.</p>}
        <details className="curator-ranges"><summary>Optional numeric ranges</summary><p>Ranges are inclusive. Unread metrics are unknown, not zero; a row with an unknown bounded metric is excluded. The shipped event snapshots have limited metrics. A complete game scan adds first hour and index; individual current reads add deposits, largest send and points.</p><div>{RANGES.map(([key,label])=><fieldset key={key}><legend>{label}</legend>{(['min','max'] as const).map(side=><label key={side}>{side==='min'?'Minimum':'Maximum'}<span className="sr-only"> {label}</span><input inputMode={key==='largestWei'?'decimal':'numeric'} value={ranges[key]?.[side]||''} onChange={e=>setRanges(old=>({...old,[key]:{...old[key],[side]:e.target.value}}))}/></label>)}</fieldset>)}</div></details>
        {filtered.error&&<p role="alert" className="danger">{filtered.error}</p>}
        <p role="status"><strong>{filtered.rows.length}</strong> matching wallets. Preview shows the first {Math.min(50,filtered.rows.length)}; exports include every match.</p>
        <div className="table-scroll curator-table" tabIndex={0} role="region" aria-label="Matching wallet table, scroll sideways"><table><thead><tr><th>Wallet / inspect</th><th>Card</th><th>Registry facts / read block</th><th>Matched IDs</th><th>Weight</th><th>History</th><th>Consume</th></tr></thead><tbody>{filtered.rows.slice(0,50).map(row=><tr key={row.address}><td><a href={`#/explorer?address=${row.address}`}>{row.address}</a>{row.pendingFacts.length>0&&<small>Pending: {row.pendingFacts.join(', ')}</small>}</td><td>{row.tokenId===null?'Not read':row.tokenId==='0'?'No card':`Card #${row.tokenId}`}{row.owner&&row.owner.toLowerCase()!==row.address.toLowerCase()&&<small>Held by another wallet; facts remain here</small>}</td><td title={names(currentFacts(row),snapshot.facts)}>{row.readStatus==='historical'?'Not checked':currentFacts(row).join(', ')||'None read as present'}{row.blockNumber!==null&&<small>Block {row.blockNumber.toLocaleString()}</small>}{row.unknownFacts.length>0&&<small>Unknown: {row.unknownFacts.join(', ')}</small>}</td><td>{row.matchedFacts?.join(', ')||'No fact filter'}</td><td>{row.weight}</td><td>{row.censusMember===null?'Participation unknown':row.censusMember?'Curator participant':'Outside census'}<small>Largest send: {formatWei(row.metrics.largestWei)}{row.metrics.largestWei!==null?' ETH':''}</small></td><td><button onClick={()=>openConsumer(row.address)}>Check rule<span className="sr-only"> for {row.address}</span></button></td></tr>)}</tbody></table></div>
        {!filtered.rows.length&&!filtered.error&&<p>No wallets match. Remove a bound, choose different facts or <button onClick={resetFilters}>Reset filters</button>.</p>}
        <div className="curator-export"><label>Export format<select value={format} onChange={e=>setFormat(e.target.value as 'csv'|'json')}><option value="csv">CSV</option><option value="json">JSON</option></select></label><button className="primary" onClick={()=>void save()} disabled={exporting||!!filtered.error||!filtered.rows.length}>{exporting?'Preparing export…':'Export wallet list'}</button>{exporting&&<button onClick={()=>activeExport.current?.abort()}>Cancel export</button>}</div>
        <p className="muted">Every row includes its evidence mode, the Registry, source commit and checked block where available. Historical exports are candidates, not accepted facts. No card or wallet connection is required.</p><p role="status">{feedback}</p>
      </section>
      <section role="tabpanel" id="curator-panel-consume" aria-labelledby="curator-tab-consume" hidden={tab!=='consume'}>
        <h2>Try the Consuming App</h2><p>Test the selected fact rule against a wallet. This calls hasTrait on the Ethereum Registry at one block. It works for any address and does not require a card, spend funds or start an oracle.</p>
        <form className="curator-consumer-form" onSubmit={e=>{e.preventDefault();setCheckedAddress(address.trim());setConsumeRetry(v=>v+1);}}><label htmlFor="curator-consume-address">Wallet to check</label><div><input id="curator-consume-address" value={address} onChange={e=>setAddress(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x… (42 characters)"/><button className="primary" type="submit" disabled={consuming}>{consuming?"Reading Registry…":"Check eligibility"}</button></div></form>
        {consuming&&<p role="status">Checking the selected rule against Ethereum…</p>}

        {consumption&&<div className={`curator-consumption ${consumption.status==='eligible'?'curator-eligible':''}`} role="status"><h3>{consumption.error||statusLabel}</h3><p className="break">{checkedAddress}</p>{currentRow&&<p>{currentRow.tokenId===null?'Card ownership was not needed for this check.':currentRow.tokenId==='0'?'No card minted. A card is not required.':`Card #${currentRow.tokenId}. Eligibility belongs to the original wallet.`}</p>}<ul>{consumption.facts.map((fact:{id:number;state:string})=><li key={fact.id}>{names([fact.id],snapshot.facts)}: <strong>{fact.state==='present'?'Present in Registry':fact.state==='pending'?'Pending — not accepted':fact.state==='unknown'?'Unknown':'Not currently accepted / present'}</strong></li>)}</ul><p className="muted">{consumption.blockNumber?`Read at Ethereum block ${consumption.blockNumber.toLocaleString()}. `:""}An absent accepted oracle fact is not proof that its underlying statement is false.</p></div>}
        <section className="curator-membership"><h3>Exact Exported List</h3>{saved?<><p>The last exported list contains {saved.addresses.length} wallets. This is a fixed selection from {new Date(saved.generatedAt).toLocaleTimeString()}; changing filters or later facts does not change that saved list.</p>{saved.mode==='historical'&&<p className="curator-warning">This export contains historical candidates, not verified eligibility.</p>}{checkedAddress&&<p role="status">{/^0x[0-9a-f]{40}$/i.test(checkedAddress)?saved.addresses.includes(checkedAddress.toLowerCase())?`Included in the last exported list. Exported weight: ${saved.weights[checkedAddress.toLowerCase()]}.`:'Not included in the last exported list.':'Enter a valid wallet address to check list membership.'}</p>}<p className="muted">Membership says only whether this address was exported. A production app must enforce that list separately from a fact rule.</p></>:<p>Export a list first to test membership in that exact selection. The fact rule above works independently of exports.</p>}</section>
        <details className="curator-code"><summary>Consumer contract example</summary><p>This example checks the selected current facts using {match==='any'?'OR':'AND'}. It does not enforce weights, numeric ranges or the exported allowlist. Community facts use the same <code>hasTrait</code> call. The metadata display limit is not a credential limit.</p><CodeBlock>{gate}</CodeBlock></details>
      </section>
    </>}
  </div>;
}
