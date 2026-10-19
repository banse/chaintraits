import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPublicClient, http, fallback, decodeFunctionResult, encodeFunctionData } from 'viem';
import { mainnet } from 'viem/chains';
import { parse } from 'lossless-json';
const a = JSON.parse(readFileSync('addresses.json', 'utf8'));
const abi = JSON.parse(readFileSync('src/abi/Renderer.json', 'utf8'));
const client = createPublicClient({ chain: mainnet, transport: fallback(a.publicRpcs.map(u => http(u, {timeout:30000,retryCount:0}))) });
const wallet = '0x000000000000000000000000000000000000c1a1';
mkdirSync('public/assets', { recursive: true });
const full = [101,202,303,404,503,601,701,801,901,1001,1101,1201,1301];
const sample = [101,202,302,402,502,0,701,0,0,0,1105,0,1301];
// One card per catalog id with only that id lit, plus one empty card: the trait previews (no runtime render).
const CATALOG_IDS = [101,201,202,301,302,303,401,402,403,404,501,502,503,601,701,801,901,1001,1101,1102,1103,1104,1105,1201,1301];
const topOf = ids => Array.from({length:13},(_, i) => { const f = ids.filter(id => Math.floor(id/100) === i+1); return f.length ? (i === 10 ? Math.min(...f) : Math.max(...f)) : 0; });
mkdirSync('public/assets/traits', { recursive: true });
const record = {};
const jobs = [['logo',full,8192n,'public/assets/logo.svg'],['sample-card',sample,0n,'public/assets/sample-card.svg'],['empty',Array(13).fill(0),0n,'public/assets/traits/empty.svg'],
  ...CATALOG_IDS.map(id => [String(id),topOf([id]),0n,`public/assets/traits/${id}.svg`])];
for (const [name, top, count, path] of jobs) {
  const traits = top.filter(Boolean);
  const card = {tokenId:0n,claimant:wallet,top,traits,community:[],communityCount:count,oracle:[]};
  const data = encodeFunctionData({abi,functionName:'tokenURI',args:[card]});
  const result = await client.call({to:a.Renderer,data,gas:30000000n});
  const uri = decodeFunctionResult({abi,functionName:'tokenURI',data:result.data});
  const raw = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
  const meta = parse(raw,undefined,value=>value);
  let svg = decodeURIComponent(meta.image.slice(meta.image.indexOf(',')+1));
  if (name === 'logo') svg = svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, '');
  writeFileSync(path, svg);
  record[name] = {method:'Renderer.tokenURI(Card) via eth_call on Ethereum mainnet', renderer:a.Renderer, tokenId:0, claimant:wallet, top, traits, communityCount:Number(count), call:{to:a.Renderer, data}, file:path.replace('public/','site/public/'), bytes:svg.length, sha256:createHash('sha256').update(svg).digest('hex'), ...(name==='logo'?{tokenNumberRemoved:true}:{})};
  console.log(name, svg.length, 'bytes; Renderer.tokenURI eth_call');
}
mkdirSync('../artifacts', { recursive: true });
writeFileSync('../artifacts/renderer-assets.json', JSON.stringify(record, null, 2) + '\n');
