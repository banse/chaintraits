/* Illustrative fixture snapshots only. No transport, wallet provider or oracle execution. */
export const DEMO_DATA={
 // Public IDMD token IDs are example identities; all participation and answers are mocked.
 identityTokenIds:["1431", "102", "1859", "631", "660", "286", "1177", "1125", "1979", "901", "824"],
 wallet:'0x2000000000000000000000000000000000000001',
 // Illustrative name for the mock wallet. No ENS lookup or wallet connection is made.
 walletEnsName:'sworn-demo.eth',
 question:'Up to block 26,267,872 on Ethereum mainnet, did the wallet 0x2000000000000000000000000000000000000001 operate an IdentityMD seat through at least 3 accepted Identity.md swarm jobs while it held that seat? Answer true or false.',
 preview:'Did this wallet operate an IdentityMD seat through at least 3 accepted Identity.md swarm jobs while it held that seat? The final closing block is pinned by the request transaction.',
 cells:[{family:6,x:500,y:480},{family:1,x:500,y:313.7},{family:2,x:644,y:396.9},{family:3,x:644,y:563.1},{family:4,x:500,y:646.3},{family:5,x:356,y:563.1},{family:7,x:356,y:396.9},{family:8,x:644,y:230.6},{family:9,x:788,y:480},{family:10,x:644,y:729.4},{family:11,x:356,y:729.4},{family:12,x:212,y:480},{family:13,x:356,y:230.6}],
 names:['Spawned','Zero-Shot','Hopper','Bullfrog','Identity','Swarmed','Uptime','Chatter','Signal','Roots','Rank','Top Weights','Pretrained'],
 stages:{
 tx:{label:'Transaction pending',short:'Waiting for Ethereum',index:0,tone:'working',time:'00:18',responses:[],eventCount:1,description:'Your request transaction was sent. Waiting for its receipt; no oracle job has started yet.'},
 admission:{label:'Swarm request pending',short:'Request confirmed · waiting for job',index:1,tone:'working',time:'00:42',responses:[],eventCount:3,description:'Ethereum confirmed the request. Waiting for the matching oracle job to appear.'},
 panel:{label:'Agents are checking your fact',short:'5 true · 7 needed',index:2,tone:'working',time:'01:26',responses:['true','true','false','true','true','true','working','working','working','queued','queued'],eventCount:11,description:'The oracle job is running. Each member evaluates the same pinned question.'},
 quorum:{label:'Quorum reached',short:'7 agree · result not yet signed',index:3,tone:'attention',time:'02:14',responses:['true','true','false','true','true','true','true','true','working','working','queued'],eventCount:14,description:'Enough agents agree. Waiting for the signed result; your wallet fact is not yet recorded.'},
 delivery:{label:'Waiting for the Registry',short:'Signed result · delivery pending',index:4,tone:'attention',time:'02:48',responses:['true','true','false','true','true','true','true','true','true','true','failed'],eventCount:19,description:'The result is signed. Waiting for the Registry to accept and record it for your wallet.'},
 registry:{label:'Confirming the Registry result',short:'Delivery confirmed · checking wallet fact',index:5,tone:'attention',time:'03:01',responses:['true','true','false','true','true','true','true','true','true','true','failed'],eventCount:20,description:'The delivery transaction is confirmed. Waiting for the matching Registry result and a fresh wallet-fact read.'},
 saved:{label:'Swarmed is saved in the Registry',short:'Fact minted · your card is updated',index:5,tone:'success',time:'03:06',responses:['true','true','false','true','true','true','true','true','true','true','failed'],eventCount:23,description:'Registry write confirmed and the wallet fact read is true. The new fact is ready to use.'},
 failed:{label:'No fact was added',short:'Panel ended without quorum',index:2,tone:'failure',time:'03:21',responses:['true','true','false','true','false','true','false','false','true','false','failed'],eventCount:0,description:'Neither answer reached 7 matching responses. The attempt ended without a stored fact; the request fee was spent.'},
 offline:{label:'Checking the latest status',short:'Connection interrupted · attempt retained',index:2,tone:'attention',time:'01:28',responses:['true','true','false','true','true','true','working','working','working','queued','queued'],eventCount:11,description:'Showing the last observed state. A failed read does not mean the request failed. Check again without sending a new request.'}
 },
 events:[
 {id:'tx',time:'14:32:00',source:'Wallet',title:'Request transaction sent',detail:'Hash captured. Waiting for the receipt; the attempt is already tracked.'},
 {id:'receipt',time:'14:32:24',source:'Ethereum',title:'Request transaction confirmed',detail:'Successful receipt received. Approval was a separate earlier action.'},
 {id:'request',time:'14:32:24',source:'Registry',title:'Request recorded · question pinned',detail:'TraitRequested links wallet, fact 601, request ID and the question hash.'},
 {id:'job',time:'14:32:43',source:'Swarm',title:'Oracle job linked to this request',detail:'Consumer and question hash match. The 11-member panel is now visible.'},
 {id:'working',time:'14:32:48',source:'Swarm',title:'Panel members reported work in progress',detail:'Only reported member states are shown. No tool-call trace was supplied.'},
 {id:'a1',time:'14:33:01',source:'IDMD #1431',title:'Valid answer received · TRUE',detail:'Matches the leading answer. 1 of 7 required matching answers.'},
 {id:'a2',time:'14:33:04',source:'IDMD #102',title:'Valid answer received · TRUE',detail:'2 of 7 required matching answers.'},
 {id:'a3',time:'14:33:08',source:'IDMD #1859',title:'Valid answer received · FALSE',detail:'A valid differing answer. It is not an agent error.'},
 {id:'a4',time:'14:33:14',source:'IDMD #631',title:'Valid answer received · TRUE',detail:'3 of 7 required matching answers.'},
 {id:'a5',time:'14:33:18',source:'IDMD #660',title:'Valid answer received · TRUE',detail:'4 of 7 required matching answers.'},
 {id:'a6',time:'14:33:26',source:'IDMD #286',title:'Valid answer received · TRUE',detail:'5 of 7 required matching answers.'},
 {id:'a7',time:'14:33:53',source:'IDMD #1177',title:'Valid answer received · TRUE',detail:'6 of 7 required matching answers.'},
 {id:'a8',time:'14:34:14',source:'IDMD #1125',title:'Valid answer received · TRUE',detail:'7 of 7 required matching answers.'},
 {id:'quorum',time:'14:34:14',source:'Swarm',title:'Quorum reached · awaiting signed result',detail:'Panel agreement does not itself create a wallet fact.'},
 {id:'a9',time:'14:34:22',source:'IDMD #1979',title:'Valid answer received · TRUE',detail:'8 matching TRUE answers.'},
 {id:'a10',time:'14:34:31',source:'IDMD #901',title:'Valid answer received · TRUE',detail:'9 matching TRUE answers.'},
 {id:'a11',time:'14:34:34',source:'IDMD #824',title:'Member finished without a valid answer',detail:'This member does not contribute to quorum.'},
 {id:'signed',time:'14:34:40',source:'Swarm',result:true,title:'Oracle result signed',detail:'Attestation reports 9 matching TRUE answers. Registry delivery remains separate.'},
 {id:'delivery',time:'14:34:48',source:'Ethereum',title:'Result delivery transaction pending',detail:'Only shown when a delivery hash is reported. No Registry acceptance yet.'},
 {id:'delivery-receipt',time:'14:35:01',source:'Ethereum',title:'Delivery transaction confirmed',detail:'Successful receipt observed. The matching Registry result and fresh wallet-fact read still need to be checked.'},
 {id:'stored',time:'14:35:01',source:'Registry',title:'Wallet fact recorded · Verified event',detail:'The event matches this request, claimant and fact ID.'},
 {id:'read',time:'14:35:04',source:'Registry',title:'Wallet fact confirmed · hasTrait = true',detail:'The saved fact is ready to use. This is the celebration gate.'},
 {id:'art',time:'14:35:06',source:'Card display',title:'Artwork refreshed · Swarmed highlighted',detail:'The Renderer reads the wallet facts. The card display does not write another fact.'}
 ]
};
