// Read-only examples: these never enter the mock transaction engine.
export const MOCK_WALLET = '0x2000000000000000000000000000000000000001';
const address = n => '0x300000000000000000000000000000000000000' + n;
const direct = [101,201,202,301];
export const EXPLORER_SAMPLES = [
  {key:'direct',title:'Direct facts, no card',address:address(1),token:0,held:[...direct],outcome:'Direct facts can exist before a card is created. This wallet has no card and has made no verification request.'},
  {key:'verified',title:'Verified wallet, no card',address:address(2),token:0,held:[...direct,601],outcome:'The sample Registry has stored Swarmed for this original wallet. A card is optional; verification does not mint one.'},
  {key:'transferred',title:'Card with a new holder',address:address(3),token:41,owner:address(9),held:[...direct,601,701,1301],outcome:'Card #41 now belongs to another holder. It still represents the original wallet shown here; transferring it does not transfer that wallet’s facts.'},
  {key:'pending',title:'Verification pending',address:address(4),token:42,held:[...direct],requestStatus:'pending',outcome:'The request for Swarmed is confirmed in this example. Five of eleven agents have answered; a stored wallet fact is still required. Swarmed is not present yet.'},
  {key:'failed',title:'No verdict',address:address(5),token:43,held:[...direct],requestStatus:'failed',outcome:'The sample attempt ended without a verdict. No Swarmed fact was added and the request fee was spent. Existing direct facts and the card remain available.'},
  {key:'shared',title:'Shared result, not applied',address:address(6),token:0,held:[...direct],requestStatus:'shared',outcome:'A stored Top Weights result includes this sample wallet, but it has not been applied. The shared result is ready; Top Weights is not yet a wallet fact.'},
];
export const sampleForAddress = value => EXPLORER_SAMPLES.find(s=>s.address.toLowerCase()===value?.toLowerCase());
export function sampleWalletFacts(sample, traits, cells) {
  const held = [...sample.held];
  const families = new Set(held.map(id=>Math.floor(id/100)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#090909"/><text x="500" y="100" text-anchor="middle" fill="#ddd" font-size="36" font-family="monospace">SWORN · SAMPLE</text>${cells.map(({family,x,y})=>`<polygon points="${Array.from({length:6},(_,i)=>`${x+84*Math.cos(i*Math.PI/3)},${y+84*Math.sin(i*Math.PI/3)}`).join(' ')}" fill="${families.has(family)?'#142b15':'#0a0a0a'}" stroke="${families.has(family)?'#65e845':'#596058'}" stroke-width="3"/>`).join('')}<text x="500" y="910" text-anchor="middle" fill="#bbb" font-size="26" font-family="monospace">SYNTHETIC EXAMPLE · NOT PROOF</text></svg>`;
  const metadata = {name:`Sworn sample${sample.token ? ' #'+sample.token : ' preview'}`,description:'Synthetic local example. Not deployed Renderer output, a real NFT or a wallet credential.',image:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),attributes:held.map(id=>({trait_type:'Sample fact',value:String(id)}))};
  const raw=JSON.stringify(metadata,null,2);
  return {address:sample.address,token:BigInt(sample.token),traits:held,verifiedSpecs:[],answers:traits.map(t=>held.includes(t.id)),joined:true,hour:0n,count:3n,capital:750000000000000000n,points:20n,frozen:sample.token ? 305n : null,mintBlock:sample.token ? 26249900n : null,mintTime:sample.token ? 1792600000n : null,uri:'data:application/json;charset=utf-8,'+encodeURIComponent(raw),metadata,raw,pending:{},verified:{}};
}
