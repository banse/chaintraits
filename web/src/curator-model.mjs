// Pure selection and export rules. Discovery evidence never grants a current credential.
import {combineFactStates} from "./models/curator-live.mjs";
const addressPattern = /^0x[0-9a-f]{40}$/i;
const uint = n => Number.isSafeInteger(n) && n >= 0;
const lower = value => value.toLowerCase();
export const DATA_KIND = 'Ethereum mainnet — read evidence';
export function parseCuratorQuery(hash) {
  const query=new URLSearchParams(hash.split('?')[1]||'');
  const token=query.get('trait')??query.get('fact')??'';
  if(!token)return {selected:null,error:'',token};
  if(!/^\d+$/.test(token)||!uint(Number(token))||Number(token)<1||Number(token)>65535)return {selected:null,error:'Invalid fact ID in this link. Choose an ID from 1 to 65535.',token};
  return {selected:{[Number(token)]:1},error:'',token};
}
export function curatorDraftKey(session,deployment) {return `sworn.mainnet.curator.v1:${session}:${deployment.chainId}:${deployment.registry.toLowerCase()}:${deployment.sourceCommit}`;}
export function readCuratorDraft(storage,key) {
  try{
    const value=JSON.parse(storage.getItem(key)||'null');
    if(!value||value.version!==1||!['build','consume'].includes(value.tab)||!['current','historical'].includes(value.mode)||!['any','all'].includes(value.match)||!['csv','json'].includes(value.format))return null;
    if(!value.selected||Array.isArray(value.selected)||Object.entries(value.selected).some(([id,weight])=>!/^\d+$/.test(id)||Number(id)<1||Number(id)>65535||!uint(weight)))return null;
    if(!value.ranges||Array.isArray(value.ranges)||Object.values(value.ranges).some(range=>!range||typeof range!=='object'||Object.values(range).some(n=>typeof n!=='string')))return null;
    for(const field of ['address','checkedAddress','search','queryToken'])if(typeof value[field]!=='string')return null;
    if(value.saved){const saved=value.saved;if(!Array.isArray(saved.addresses)||saved.addresses.some(a=>!addressPattern.test(a))||!saved.weights||saved.addresses.some(a=>!uint(saved.weights[a]))||!['current','historical'].includes(saved.mode)||!addressPattern.test(saved.registry)||!Number.isFinite(Date.parse(saved.generatedAt))||typeof saved.rule!=='string')return null;}
    return value;
  }catch{return null;}
}
export function validateCuratorSnapshot(data, expected) {
  if (!data || data.mock !== false) throw Error('Expected mainnet read data, not a synthetic snapshot.');
  if (data.chainId !== expected.chainId || !addressPattern.test(data.registry || '') || lower(data.registry) !== lower(expected.registry)
      || data.sourceCommit !== expected.sourceCommit) throw Error('Curator data belongs to a different deployment.');
  if ((data.blockNumber !== null && !uint(data.blockNumber)) || !Number.isFinite(Date.parse(data.generatedAt)) || !Array.isArray(data.facts) || !Array.isArray(data.wallets)) throw Error('Invalid curator snapshot.');
  const ids = new Set(), addresses = new Set();
  for (const fact of data.facts) {
    if (!uint(fact.id) || !fact.id || fact.id > 65535 || ids.has(fact.id) || typeof fact.name !== 'string' || !uint(fact.kind) || fact.kind > 6 || typeof fact.builtin !== 'boolean') throw Error('Invalid or duplicate fact definition.');
    ids.add(fact.id);
  }
  for (const row of data.wallets) {
    if (!addressPattern.test(row.address || '') || addresses.has(lower(row.address))) throw Error('Invalid or duplicate wallet address.');
    addresses.add(lower(row.address));
    if ((row.tokenId !== null && !/^\d+$/.test(row.tokenId || '')) || (row.owner !== null && !addressPattern.test(row.owner || '')) || (row.censusMember !== null && typeof row.censusMember !== 'boolean')) throw Error('Invalid wallet identity.');
    for (const key of ['directFacts', 'verifiedFacts', 'historicalFacts', 'pendingFacts']) {
      if (!Array.isArray(row[key]) || row[key].some(id => !ids.has(id)) || new Set(row[key]).size !== row[key].length) throw Error('Invalid wallet fact data.');
    }
    if (!row.metrics) throw Error('Missing wallet metrics.');
    for (const key of ['hour', 'deposits', 'points', 'index']) if (row.metrics[key] !== null && !uint(row.metrics[key])) throw Error('Invalid wallet metric.');
    if (row.metrics.largestWei !== null && !/^\d{1,78}$/.test(row.metrics.largestWei || '')) throw Error('Invalid exact wallet amount.');
  }
  return data;
}
export function currentFacts(row) { return row.readStatus === 'historical' ? [] : [...new Set([...row.directFacts, ...row.verifiedFacts])]; }
export function rowFactStates(row, ids) {
 const held=currentFacts(row);
 return ids.map(id=>({id,state:held.includes(id)?'present':row.readStatus==='historical'||!row.checkedFacts?.includes(id)?'unknown':row.pendingFacts.includes(id)?'pending':'absent'}));
}
export function unresolvedCandidates(snapshot, ids, match='any', ranges={}) {
 const bounded=Object.entries(ranges).filter(([,range])=>Object.values(range).some(value=>value!==''&&value!==undefined)).map(([key])=>key);
 return snapshot.wallets.filter(row=>row.readStatus!=='historical'&&(combineFactStates(rowFactStates(row,ids),match)==='unknown'||bounded.some(key=>row.metrics[key]===null))).length;
}
function decimalWei(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw Error('ETH ranges need a nonnegative decimal with at most 18 places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}
function rangeNumber(value, key) {
  if (key === 'largestWei') return decimalWei(value);
  if (!/^\d+$/.test(value) || !uint(Number(value))) throw Error('Numeric ranges need nonnegative whole numbers.');
  return BigInt(value);
}
/** @param {any} snapshot @param {any} options */
export function filterCandidates(snapshot, options = {}) {
  const {selected = {}, mode = 'current', match = 'any', ranges = {}} = options;
  if (!['current', 'historical'].includes(mode) || !['any', 'all'].includes(match)) throw Error('Invalid fact selection mode.');
  const known = new Set(snapshot.facts.map(f => f.id));
  const picks = Object.entries(selected).map(([id, weight]) => {
    if (!known.has(Number(id)) || !uint(weight)) throw Error('Select a known fact with a nonnegative whole-number weight.');
    return [Number(id), Number(weight)];
  });
  if (!uint(picks.reduce((sum, [, weight]) => sum + weight, 0))) throw Error('Combined weights exceed the safe whole-number limit.');
  const bounds = Object.entries(ranges).map(([key, value]) => {
    if (!['hour', 'deposits', 'largestWei', 'points', 'index'].includes(key)) throw Error('Unknown numeric range.');
    const min = value.min === undefined || value.min === '' ? null : rangeNumber(String(value.min), key);
    const max = value.max === undefined || value.max === '' ? null : rangeNumber(String(value.max), key);
    if (min !== null && max !== null && min > max) throw Error('A range minimum cannot exceed its maximum.');
    return {key, min, max};
  });
  return snapshot.wallets.flatMap(row => {
    if(mode==='current'&&row.readStatus==='historical')return [];
    const held = mode === 'historical' ? row.historicalFacts : currentFacts(row);
    if(mode==='current'&&picks.length&&combineFactStates(rowFactStates(row,picks.map(([id])=>id)),match)!=='eligible')return [];
    const matched = picks.filter(([id]) => held.includes(id));
    if (picks.length && (match === 'all' ? matched.length !== picks.length : matched.length === 0)) return [];
    if (!bounds.every(({key, min, max}) => {
      if (min === null && max === null) return true;
      if (row.metrics[key] === null) return false;
      const n = BigInt(row.metrics[key]);return (min === null || n >= min) && (max === null || n <= max);
    })) return [];
    return [{...row, matchedFacts:matched.map(([id]) => id), weight:matched.reduce((sum, [, weight]) => sum + weight, 0)}];
  });
}
export function consumeFacts(snapshot, address, ids, match = 'any') {
  if (!addressPattern.test(address)) throw Error('Enter an address with 0x and 40 hexadecimal characters.');
  if (!['any', 'all'].includes(match)) throw Error('Invalid fact match rule.');
  const known = new Set(snapshot.facts.map(f => f.id));
  if (ids.some(id => !known.has(id))) throw Error('The selected fact is not in this deployment. Refresh the facts.');
  if (!ids.length) return {status:'no-rule', facts:[]};
  const wallet = snapshot.wallets.find(row => lower(row.address) === lower(address));
  if (!wallet) return {status:'unknown', facts:ids.map(id => ({id, state:'unknown'}))};
  const facts=rowFactStates(wallet,[...new Set(ids)]);
  return {status:combineFactStates(facts,match),facts};
}
export function formatWei(value) {
  if (value === null || value === undefined) return 'Unknown';
  const n = BigInt(value), fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${n / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
}
export function gateSource(deployment, ids, match = 'any') {
  if (!addressPattern.test(deployment.registry)) throw Error('Invalid Registry address.');
  if (!['any', 'all'].includes(match) || ids.some(id => !uint(id) || id === 0 || id > 65535)) throw Error('Invalid fact rule.');
  const expression = [...new Set(ids)].sort((a,b) => a-b).map(id => `registry.hasTrait(wallet, ${id})`).join(match === 'all' ? ' && ' : ' || ') || 'false';
  return `// Ethereum reference: chain ${deployment.chainId}; source ${deployment.sourceCommit}\n// Current credentials only. Weights, ranges and exported membership are not enforced.\ninterface ISworn { function hasTrait(address wallet, uint16 id) external view returns (bool); }\ncontract FactGate {\n    ISworn constant registry = ISworn(address(bytes20(hex"${deployment.registry.slice(2).toLowerCase()}")));\n    function eligible(address wallet) external view returns (bool) {\n        return ${expression};\n    }\n}`;
}
function cell(value) {
  const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function abort(signal) { if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError'); }
/** @param {any} snapshot @param {any[]} rows @param {string} format @param {any} rule @param {any} control */
export async function buildCuratorExport(snapshot, rows, format, rule, control = {}) {
  if (!rows.length) throw Error('There are no matching wallets to export.');
  if (!['csv', 'json'].includes(format)) throw Error('Choose CSV or JSON.');
  const source = rule.mode === 'historical' ? 'historical-candidates' : 'registry-read-at-listed-blocks';
  const provenance = {dataKind:rule.mode==='historical'?'historical candidates — not accepted facts':DATA_KIND,selectionSource:source,chainId:snapshot.chainId,registry:snapshot.registry,sourceCommit:snapshot.sourceCommit,blockNumber:snapshot.blockNumber,generatedAt:snapshot.generatedAt};
  const records = [], parts = [];
  const columns = ['dataKind','selectionSource','chainId','registry','sourceCommit','blockNumber','generatedAt','checkedBlock','checkedAt','unknownFacts','address','weight','tokenId','owner','censusMember','currentFacts','historicalFacts','pendingFacts','matchedFacts','hour','deposits','largestETH','points','index'];
  if (format === 'csv') parts.push(columns.map(cell).join(','));
  for (let offset = 0; offset < rows.length; offset += 250) {
    abort(control.signal);
    for (const row of rows.slice(offset, offset + 250)) {
      const record = {...provenance,checkedBlock:row.blockNumber,checkedAt:row.checkedAt,unknownFacts:row.unknownFacts||[],address:row.address,weight:row.weight,tokenId:row.tokenId,owner:row.owner,censusMember:row.censusMember,currentFacts:currentFacts(row),historicalFacts:row.historicalFacts,pendingFacts:row.pendingFacts,matchedFacts:row.matchedFacts,hour:row.metrics.hour,deposits:row.metrics.deposits,largestETH:formatWei(row.metrics.largestWei),points:row.metrics.points,index:row.metrics.index};
      if (format === 'csv') parts.push(columns.map(key => cell(record[key])).join(','));else records.push(record);
    }
    await (control.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))();
  }
  abort(control.signal);
  return format === 'csv' ? parts.join('\r\n') + '\r\n' : JSON.stringify({...provenance,rule,wallets:records},null,2);
}
