import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const {chromium,webkit}=await import(process.env.IMD_PLAYWRIGHT?pathToFileURL(process.env.IMD_PLAYWRIGHT).href:'playwright');
const engine=process.env.SWORN_BROWSER==='webkit'?'webkit':'chromium';
const A=JSON.parse(await readFile('site/addresses.json','utf8'));
const root=resolve('dist');const out=resolve(`test/scratch/live-browser/${engine}`);await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{const path=decodeURIComponent((req.url??'').split('?')[0]);const file=resolve(root,path.replace(/^\/preview\//,''));if(!path.startsWith('/preview/')||!file.startsWith(root+sep)){res.writeHead(404);res.end();return;}try{const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'})[extname(file)]??'text/plain');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/preview/index.html`;
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});const results=[];
const rpcPattern=/^https:\/\/(rpc\.mevblocker\.io|ethereum-rpc\.publicnode\.com|1\.rpc\.thirdweb\.com)/;
async function failRpc(route){const body=route.request().postDataJSON();const calls=Array.isArray(body)?body:[body];const responses=calls.map(c=>({jsonrpc:'2.0',id:c.id,error:{code:-32000,message:'Deliberate unavailable-RPC test'}}));await route.fulfill({contentType:'application/json',body:JSON.stringify(Array.isArray(body)?responses:responses[0]),headers:{'Access-Control-Allow-Origin':'*'}});}
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},locale:'fr-FR'});const page=await context.newPage();
 // The first operator rate-limited the earlier fork scan; this read uses the
 // second configured operator through the real browser transport and CORS.
 await context.route('https://rpc.mevblocker.io/**',failRpc);
 await page.goto(`${url}#/explorer?address=0x200e710acaa6a93bbc77146026328c40f1d60fb1`);
 await page.locator('.rpc-select select').selectOption(A.publicRpcs[1]);
 await page.locator('.explorer-grid').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('.explorer-card img')?.naturalWidth>0);
 assert.equal(await page.getByRole('region',{name:'13-family wallet summary'}).locator('tbody tr').count(),13);
 assert.equal(await page.getByRole('region',{name:'Every hasTrait result'}).locator('tbody tr').count(),25);
 assert((await page.locator('.explorer-card figcaption').innerText()).includes('preview, no card minted'));
 assert((await page.locator('.read-status').innerText()).includes('ethereum-rpc.publicnode.com'));
 assert((await page.locator('main').innerText()).includes('0.5 IMD'));
 results.push({name:'live browser public contributor, 25 hasTrait calls, 13-family summary, pure Renderer preview, live price',passed:true,status:await page.locator('.read-status').innerText()});
 await page.screenshot({path:resolve(out,'explorer-live-1280.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'explorer-live-390.png')});
 const oracleRows=await page.getByRole('region',{name:'Every hasTrait result'}).locator('tbody tr').allTextContents();
 assert(oracleRows.slice(14).every(row=>row.includes('not claimed')&&!/\bfalse\b/.test(row)));results.push({name:'unproven oracle rows say not claimed, never false',passed:true});
 await context.route(rpcPattern,failRpc);await page.goto(`${url}#/explorer?address=0x000000000000000000000000000000000000c1a1`);
 await page.locator('.read-status').filter({hasText:'RPC unavailable'}).waitFor({timeout:20000});assert.equal(await page.locator('.explorer-grid').count(),0);results.push({name:'all RPCs unavailable discards data and shows no false or fabricated card',passed:true});
 await context.close();
 const mismatch=await browser.newContext({viewport:{width:390,height:844}});
 await mismatch.route(rpcPattern,async route=>{
  const body=route.request().postDataJSON();const calls=Array.isArray(body)?body:[body];
  const responses=calls.map(c=>({jsonrpc:'2.0',id:c.id,result:c.method==='eth_chainId'?'0x1':c.method==='eth_blockNumber'?'0x190107c':'0x'+'0'.repeat(24)+A.IMD.slice(2)}));
  await route.fulfill({contentType:'application/json',body:JSON.stringify(Array.isArray(body)?responses:responses[0]),headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await mismatch.addInitScript(({account})=>{let chain='0x89';window.__sent=0;window.ethereum={request:async({method})=>{if(method==='eth_requestAccounts'||method==='eth_accounts')return [account];if(method==='eth_chainId')return chain;if(method==='wallet_switchEthereumChain'){chain='0x1';return null;}if(method==='eth_sendTransaction'){window.__sent++;throw Object.assign(Error('Rejected'),{code:4001});}throw Error('Unsupported test method');}};},{account:'0x000000000000000000000000000000000000c1a1'});
 const p=await mismatch.newPage();await p.goto(`${url}#/claim`);await p.locator('.mismatch').waitFor();assert((await p.locator('.mismatch').innerText()).includes('curator() differs'));
 await p.getByRole('button',{name:'Connect wallet',exact:true}).click();await p.getByRole('button',{name:'Switch to Ethereum',exact:true}).waitFor();
 await p.getByRole('button',{name:'Mint card',exact:true}).click();assert.equal(await p.getByRole('button',{name:'Approve exact IMD',exact:true}).isEnabled(),false);assert.equal(await p.evaluate(()=>window.__sent),0);
 results.push({name:'getter mismatch red banner and wrong-chain wallet block signing',passed:true});await p.screenshot({path:resolve(out,'mismatch-390.png')});await mismatch.close();
}finally{await browser.close();await new Promise(r=>server.close(r));await writeFile(resolve(out,'results.json'),JSON.stringify({results},null,2)+'\n');}
console.log(JSON.stringify(results,null,2));
