import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPublicClient,http,fallback,encodeFunctionData,encodeFunctionResult,decodeFunctionResult,keccak256,encodeAbiParameters,parseAbiParameters} from 'viem';
import {mainnet} from 'viem/chains';
import {parse} from 'lossless-json';
const config=JSON.parse(readFileSync('public/imd-deployment.json','utf8'));
const addr=name=>config.contracts.find(c=>c.name===name).address;
const abi=name=>JSON.parse(readFileSync(`public/${config.contracts.find(c=>c.name===name).abiPath}`,'utf8'));
const rendererAbi=abi('Renderer'),registryAbi=abi('Registry');
const client=createPublicClient({chain:mainnet,transport:fallback((process.env.SWORN_RPC?[process.env.SWORN_RPC]:config.network.rpcUrls).map(url=>http(url,{timeout:30000,retryCount:0})))});
const wallet='0x000000000000000000000000000000000000c1a1'; // explicitly synthetic preview input, never a recipient
const ids=[101,201,202,301,302,303,401,402,403,404,501,502,503,601,701,801,901,1001,1101,1102,1103,1104,1105,1201,1301];
const sample=[101,202,302,402,502,701,1105,1301];
// An eth_call-only ICardSource adapter returns ABI-encoded synthetic inputs.
// Every selector and catalog spec comes from the implementation-derived Registry ABI.
// The deployed Renderer runs unchanged. No helper is deployed and no state is persisted.
function sourceCode(routes){
 const hex=n=>n.toString(16).padStart(4,'0');
 let code='365f5f37365f20'; // copy calldata, hash it
 const start=code.length/2+routes.length*39+4;
 let handlerOffset=start;const headers=[];const handlers=[];const data=[];
 let dataOffset=start+routes.length*15;
 for(const [input,output] of routes){const bytes=(output.length-2)/2;headers.push(`807f${keccak256(input).slice(2)}1461${hex(handlerOffset)}57`);handlerOffset+=15;handlers.push(`5b5061${hex(bytes)}61${hex(dataOffset)}5f3961${hex(bytes)}5ff3`);data.push(output.slice(2));dataOffset+=bytes;}
 return `0x${code}${headers.join('')}505f5ffd${handlers.join('')}${data.join('')}`;
}
const block=await client.getBlockNumber({cacheTime:0});
const specs=new Map();for(const id of ids.filter(id=>id>=701))specs.set(id,await client.readContract({address:addr('Registry'),abi:registryAbi,functionName:'specOf',args:[id],blockNumber:block}));
mkdirSync('public/assets/traits',{recursive:true});const record={sourceCommit:config.sourceCommit,renderer:addr('Renderer'),block:String(block),source:config.network.rpcUrls[0],method:'Renderer.tokenURIOf via eth_call; ephemeral ICardSource code override for explicitly synthetic preview inputs',assets:[]};
const jobs=[['sample-card',sample,'public/assets/sample-card.svg'],['empty',[],'public/assets/traits/empty.svg'],...ids.map(id=>[String(id),[id],`public/assets/traits/${id}.svg`])];
for(const [name,traits,file] of jobs){
 const route=(fn,args,result)=>[encodeFunctionData({abi:registryAbi,functionName:fn,args}),encodeFunctionResult({abi:registryAbi,functionName:fn,result})];
 const routes=[route('claimantOf',[0n],wallet),route('traitsOf',[wallet],traits),route('verifiedSpecsOf',[wallet],[])];
 for(const id of traits.filter(id=>id>=701)){routes.push(route('verified',[wallet,id],['0x'+'0'.repeat(64),'0x'+'0'.repeat(64),0n,0n]));routes.push(route('specOf',[id],specs.get(id)));}
 const code=sourceCode(routes);
 const data=encodeFunctionData({abi:rendererAbi,functionName:'tokenURIOf',args:[addr('Registry'),0n]});
 const response=await client.call({to:addr('Renderer'),data,blockNumber:block,gas:16000000n,stateOverride:[{address:addr('Registry'),code}]});
 const uri=decodeFunctionResult({abi:rendererAbi,functionName:'tokenURIOf',data:response.data});const raw=Buffer.from(uri.split(',')[1],'base64').toString('utf8');const meta=parse(raw,undefined,v=>v);const svg=decodeURIComponent(meta.image.slice(meta.image.indexOf(',')+1));
 if(/<text\b[^>]*>[^<]*#\d+/.test(svg))throw Error(`${name}: token-id text found`);
 writeFileSync(file,svg);record.assets.push({name,file:file.replace('public/','web/public/'),traits,bytes:Buffer.byteLength(svg),sha256:createHash('sha256').update(svg).digest('hex'),adapterCodeHash:keccak256(code)});console.log(name,Buffer.byteLength(svg),'bytes; deployed Renderer eth_call');
}
writeFileSync('../docs/renderer-assets.json',JSON.stringify(record,null,2)+'\n');
