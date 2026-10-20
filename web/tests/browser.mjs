// Run from the repository root with IMD_PLAYWRIGHT pointing to an external
// Playwright install. The bounded process owns and closes its preview server.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : 'playwright');
const AxeBuilder=process.env.SWORN_AXE_MODULE?(await import(pathToFileURL(process.env.SWORN_AXE_MODULE).href)).default:undefined;
const root=resolve('dist');const out=resolve('test/scratch/browser-validation');await mkdir(out,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.sol':'text/plain'};
const server=createServer(async(req,res)=>{
 const path=decodeURIComponent((req.url??'').split('?')[0]);
 const file=resolve(root,path.replace(/^\/preview\//,''));
 if(!path.startsWith('/preview/') || (file!==root&&!file.startsWith(root+sep))){res.writeHead(404);res.end();return;}
 try{const data=await readFile(file===root?resolve(root,'index.html'):file);res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/preview/index.html`;
const results=[];const shots=[];const failures=[];
async function check(name,run){try{const details=await run();results.push({name,passed:true,details});console.log('PASS',name,details??'');}catch(e){results.push({name,passed:false,error:e.message});failures.push(name);console.log('FAIL',name,e.message);}}
const browsers=[];
try{
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  let browser;
  try{browser=await launcher.launch({headless:true});browsers.push(browser);}catch(e){results.push({name:`${engine} availability`,passed:false,limitation:e.message.slice(0,600)});continue;}
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'de-DE'});const page=await context.newPage();
  // Layout and pre-wallet checks intentionally exercise the honest offline state,
  // without repeatedly querying public operators for every viewport and route.
  await context.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)/,async route=>{
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'*'};
   if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   const body=route.request().postDataJSON();const list=Array.isArray(body)?body:[body];
   const result=list.map(call=>({jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'Offline browser validation'}}));
   await route.fulfill({contentType:'application/json',body:JSON.stringify(Array.isArray(body)?result:result[0]),headers});
  });
  const errors=[];const localFailures=[];const external=new Set();
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(url.split('/preview/')[0])&&r.status()>=400)localFailures.push([r.url(),r.status()]);});
  page.on('request',r=>{const u=new URL(r.url());if(u.protocol.startsWith('http')&&u.origin!==new URL(url).origin)external.add(u.hostname);});
  await page.goto(url);
  await check(`${engine}: landing exact copy and first-screen action`,async()=>{
   assert.equal(await page.locator('h1').innerText(),'Facts about wallets, onchain and sworn by the swarm.');
   const box=await page.getByRole('button',{name:'Explore wallet',exact:true}).boundingBox();assert(box&&box.y+box.height<=844);return {buttonBottom:box.y+box.height};
  });
  await check(`${engine}: claim mint action on the first phone screen`,async()=>{
   await page.goto(`${url}#/claim`);const box=await page.getByRole('button',{name:'Mint card',exact:true}).boundingBox();assert(box&&box.y+box.height<=844);return {buttonBottom:box.y+box.height};
  });
  await check(`${engine}: address validation`,async()=>{
   await page.goto(url);
   await page.getByLabel('Wallet address',{exact:true}).fill('not-an-address');await page.getByRole('button',{name:'Explore wallet',exact:true}).click();await page.getByText('Enter a complete Ethereum address:',{exact:false}).waitFor();assert.equal(await page.locator('input[aria-invalid=true]').count(),1);
  });
  await check(`${engine}: primary address action and honest RPC failure`,async()=>{
   await page.getByLabel('Wallet address',{exact:true}).fill('0x000000000000000000000000000000000000c1a1');await page.getByRole('button',{name:'Explore wallet',exact:true}).click();await page.getByRole('heading',{name:'Explorer',exact:true}).waitFor();await page.locator('.read-status').filter({hasText:'RPC unavailable'}).waitFor();assert.equal(await page.locator('.explorer-grid').count(),0);
  });
  await check(`${engine}: keyboard focus and skip link`,async()=>{
   await page.goto(url);await page.locator('.skip-link').waitFor({state:'attached'});await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to content');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
  });
  const routes=['','catalog','explorer','claim','fact-vs-artifact','integrate','whitelistcurator','about'];
  for(const width of [390,1280,320,780]){
   await page.setViewportSize({width,height:width===320?700:900});
   for(const route of routes){
    await check(`${engine}: ${route||'landing'} at ${width}`,async()=>{
     await page.goto(`${url}#/${route}`);await page.locator('h1').waitFor();if(route==='whitelistcurator')await page.locator('tbody tr').nth(65).waitFor();
     await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));await page.locator('.footer-inner > .source').filter({hasText:'RPC unavailable'}).waitFor();
     const measure=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,h1:document.querySelector('h1').textContent,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)}));
     assert(measure.scroll<=measure.width+1,`page overflow ${measure.scroll} > ${measure.width}`);assert(measure.images,'An image failed');
     if(route==='catalog')assert.equal(await page.locator('.class-segment').count(),5); // 25 facts + four classes + four windows
     if(route==='whitelistcurator')assert.equal(await page.locator('.source-line').count(),59);
     if(route==='whitelistcurator'){
      const gutters=await page.locator('.source-line').evaluateAll(lines=>lines.map(line=>{const n=line.querySelector('.line-number').getBoundingClientRect();const code=line.querySelector('code').getBoundingClientRect();return {codeLeft:code.left,numberRight:n.right};}));
      assert(gutters.every(g=>Math.abs(g.codeLeft-gutters[0].codeLeft)<1&&g.codeLeft>=g.numberRight-1),'Every source line must keep the same non-overlapping number gutter');
     }
     if((width===390||width===1280)&&engine==='chromium'){
      const name=`${route||'landing'}-${width}.png`;await page.screenshot({path:resolve(out,name),fullPage:route==='explorer'?false:false});shots.push(name);
     }
     return measure;
    });
   }
  }
  await page.setViewportSize({width:390,height:844});
  await check(`${engine}: claim pre-wallet, payment choice and recoverable flow`,async()=>{
   await page.goto(`${url}#/claim`);await page.getByRole('button',{name:'Mint card',exact:true}).click();await page.getByText('Connect your wallet to continue.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Approve exact IMD',exact:true}).isEnabled(),false);
   await page.reload();await page.getByText('Connect your wallet to continue.',{exact:true}).waitFor();assert.equal(await page.locator('.transaction-steps li').count(),2);
   await page.getByRole('button',{name:'Clear finished flow',exact:true}).click();await page.getByLabel('ETH',{exact:true}).first().check();await page.getByRole('button',{name:'Mint card',exact:true}).click();assert.equal(await page.locator('.transaction-steps li').count(),3);await page.getByRole('link',{name:'Buy IMD on Uniswap',exact:true}).waitFor();
  });
  await check(`${engine}: catalog / source navigation`,async()=>{
   await page.getByRole('link',{name:'Catalog',exact:true}).click();await page.getByRole('link',{name:'WhitelistCurator.sol is not sybil-resistant by design',exact:true}).click();await page.locator('.source-line').nth(58).waitFor();assert.equal(await page.locator('h1').innerText(),'WhitelistCurator');
   await page.waitForFunction(()=>document.getElementById('source').getBoundingClientRect().top<50);
   const excerpt=JSON.parse(await readFile('web/public/data/curator-source.json','utf8'));
   assert.deepEqual(await page.locator('.source-line code').allTextContents(),excerpt.lines.map(line=>line.text));
  });
  await check(`${engine}: wallet picker, dismissal and focus return`,async()=>{
   await page.goto(url);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('dialog',{name:'Connect a wallet'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Coinbase Wallet',exact:true}).count(),1);
   assert.equal(await page.getByRole('button',{name:'Browser wallet',exact:true}).count(),1);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Connect');
  });
  if(AxeBuilder){
   for(const route of routes){
    await check(`${engine}: automated accessibility / ${route||'landing'}`,async()=>{
     await page.goto(`${url}#/${route}`);await page.locator('h1').waitFor();if(route==='whitelistcurator')await page.locator('.source-line').nth(58).waitFor();
     const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
     const ownerApproved=report.violations.filter(v=>v.id==='color-contrast'&&v.nodes.every(n=>n.target.every(target=>String(target).includes('.line-number'))));
     const applicable=report.violations.filter(v=>!ownerApproved.includes(v));
     assert.deepEqual(applicable.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[]);
     return {passes:report.passes.length,incomplete:report.incomplete.length,ownerApproved:ownerApproved.map(v=>({id:v.id,nodes:v.nodes.length,reason:'The reviewed palette uses #5f6861 for decorative source line numbers (aria-hidden). Workflow requires unchanged colours; measured contrast 3.43:1 at 12px is retained and documented, not an AA pass.'}))};
    });
   }
  }
  if(engine==='chromium'){
   await page.goto(`${url}#/whitelistcurator#source`);await page.locator('.source-line').nth(58).waitFor();await page.waitForFunction(()=>document.getElementById('source').getBoundingClientRect().top<50);await page.screenshot({path:resolve(out,'verified-source-390.png')});
   await page.goto(url);await page.locator('.footer-inner > .source').filter({hasText:'RPC unavailable'}).waitFor();await page.getByRole('button',{name:'Explore wallet',exact:true}).focus();await page.screenshot({path:resolve(out,'focus-390.png')});
  }
  await check(`${engine}: no runtime API, font or script CDN calls`,async()=>{
   assert(!external.has('api.imd.fun'));assert([...external].every(host=>['ethereum-rpc.publicnode.com','eth.drpc.org'].includes(host)));return [...external];
  });
  await check(`${engine}: local resources and console`,async()=>{const expectedRpcErrors=errors.filter(e=>/access control/.test(e)&&/rpc\.thirdweb|rpc\.publicnode|rpc\.mevblocker/.test(e));const scriptErrors=errors.filter(e=>!expectedRpcErrors.includes(e));assert.deepEqual(localFailures,[]);assert.deepEqual(scriptErrors,[]);return {localFailures,scriptErrors,expectedRpcErrors};});
  await context.close();
 }
}finally{
 await Promise.all(browsers.map(b=>b.close()));await new Promise(r=>server.close(r));
 await writeFile(resolve(out,'results.json'),JSON.stringify({results,shots},null,2)+'\n');
}
if(failures.length)process.exitCode=1;
