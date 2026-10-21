---
name: sworn
description: Read and verify Sworn wallet facts on Ethereum, integrate credential gates, and build reproducible allowlists or reputation lists using only public RPC. Use for Sworn credentials, shared facts, or WhitelistCurator signals.
---

# Sworn for agents

Sworn is an ownerless registry of wallet facts on Ethereum mainnet. Thirteen direct facts read WhitelistCurator; twelve further facts require signed IMD panel answers. Community specs define additional immutable predicates. A transferable card is an artifact depicting its original claimant's facts. **A card is never a credential.** A wallet needs no card to have facts. Evaluate the original wallet with `hasTrait`; never evaluate a card holder with `ownerOf` as proof.

Operate with Ethereum JSON-RPC only. No account, key, application API, or service login is needed for reads. Prefer https://ethereum-rpc.publicnode.com; retry a failed read once, then try https://gateway.tenderly.co/public/mainnet, https://rpc.mevblocker.io/fast and https://1.rpc.thirdweb.com. Check `eth_chainId` is 1. Pin one confirmed block number and hash for an output; pass that block to every read. If logs or historical state cannot be read in full, return unavailable, never false or an empty list. Require a second independent endpoint to confirm an empty historical log result.

## WhitelistCurator: for builders consuming this list

The following is WhitelistCurator.sol **lines 32–53**, verbatim (including Solidity comment markers), from the [verified source](https://eth.blockscout.com/api/v2/smart-contracts/0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91). The source SHA-256 is `b1dae6e11ebb4efdf8e0b583cbdd522298a40a87820c9e3c02aa8b67de0b98ec`.

```solidity
///  This contract does not pretend to solve sybil resistance, and you should not use it as if it
///  did. Nothing onchain can, once the ETH is handed straight back: fanning out across a hundred
///  wallets costs gas and nothing else, and the square-root curve actively rewards doing so.
///  Filter that off-chain. The events carry what you need to cluster it — first-seen hour, the
///  whole escalation ladder, tx counts, hour-by-hour timing — and a farm funded from one source
///  in one afternoon does not look like a hundred strangers.
///
///  What the contract DOES enforce is that the ETH was actually held. Only code-less EOAs may
///  deposit, so no depositor can sit inside a flash-loan callback and compose borrow → deposit →
///  refund → repay atomically. Every high-water mark on this list was real balance at the moment
///  it was recorded. That is the one capital claim you can take at face value.
///
///  What the list does give you is a signal that is expensive to fake and impossible to
///  backfill: addresses that were still showing up on mainnet, paying real gas, hour after hour,
///  in a quiet market after almost everyone else had left. Anyone can buy a token balance or
///  farm a testnet. Nobody can retroactively have been here. That presence is the product; the
///  points are just the scoreboard on top of it.
///
///  Practical consequence for a sybil: the payoff is a bigger share of whatever the list is spent
///  on — a whitelist allocation, an airdrop, a reputation score — and the downside is being
///  clustered and dropped from it entirely. They are wagering gas against total exclusion, which
///  is a deterrent that lives in your indexer, not in this contract.
```

## Deployment and verification

Ethereum mainnet, **chain 1**, **launch #2404**. Source repository: https://github.com/identity-md-launches/launch-2404-renderer-composer-registry at commit `c4ff3238390fc51962fb67e86affc20cf418126e`. Deployment block: **26242885**.

| Contract | Address | Canonical ABI Keccak-256 |
| --- | --- | --- |
| Registry | `0x0da2679000ea5380d1361cc3cca7d4e8c881f766` | `681346b3fa66ff9c620fb255a9617b0f102e975f5ad492bab6d4afd2f608e031` |
| Composer | `0xf564dd76bd081554170c5e0b78144abfb39f7061` | `37b9a6c54c65f302558b81c741465e5559c33284612d2046b4ffbfff6584eb6d` |
| Renderer | `0x3039eaf3b979759c77a2a3fc62850f9534162c3b` | `61a60df208f0a8712452ebc563183e54d1e5ba8b43dfa1a26fbe54f265b73817` |

[Deployment manifest](../../imd-deployment.json); [Registry ABI](../../abi/Registry.json); [Composer ABI](../../abi/Composer.json); [Renderer ABI](../../abi/Renderer.json); [Curator ABI](../../abi/WhitelistCurator.json); [Intake ABI](../../abi/IntakeV2.json). When installed locally, resolve these artifacts from the source repository's `dist/`, or use the signatures below; reads do not depend on these relative links.

Expected deployed runtime Keccak-256 (hash the bytes returned by `eth_getCode`, not their hex text):

| Contract | Runtime hash |
| --- | --- |
| Registry | `0xd5dc762312cd6df0875e1fed5ec70ced7a721f7810355826796059f50df7288c` |
| Composer | `0xbd07cb17d0496ea40e2ecdb7e941590d1323c5a5935e099d4832cc9379e83f4e` |
| Renderer | `0xcca7bdf93d170adf0f56d8dd86f026178eecbbe332c6e3a0c672caf3bcbb548e` |

Expected immutable Registry dependencies, taken from the launch constructor:

| Getter | Expected address |
| --- | --- |
| curator | `0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91` |
| imd | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| intake | `0xa43e6f75ee006411f79ac1c84120606c2330de82` |
| attester | `0x5598aa9146215bc13eb26f2c692ad1461fd32982` |
| burnExecutor | `0xe29386719c155b6847ad5a4e97c6674f10ffc750` |

Verify the source commit and the three ABI hashes above (UTF-8 JSON with recursively sorted object keys, array order preserved, no whitespace, then Keccak-256). Use `eth_getCode` for all three addresses at the pinned block; compare their Keccak-256 to the runtime table above. Rebuilding the exact source with its checked-in compiler settings is an additional independent check. Confirm Registry `composer` and `renderer` match the table. Read Registry `curator`, `imd`, `intake`, `attester`, and `burnExecutor`; compare to the dependency table above and the launch constructor arguments. Curator is `0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91`. Verify chain, code and dependencies before trusting results or offering a paid call. Code existing at an address alone does not authenticate its identity.

## Reading facts

Registry read signatures, with the exact return shapes:

```text
hasTrait(address,uint16) returns (bool)
traitsOf(address) returns (uint16[])
verified(address,uint16) returns (bytes32,bytes32,uint64,uint64)
verifiedSpecsOf(address) returns (uint16[])
claimantOf(uint256) returns (address)
tokenOf(address) returns (uint256)
```

`hasTrait(wallet,id)` is the credential predicate. `traitsOf` contains the 25 catalog facts that are present; `verifiedSpecsOf` lists the wallet's verified community ids. `verified` returns Registry request id, oracle request id, fromBlock and toBlock: all zero means no stored proof. These ids differ; preserve both. A personal fact without a verified answer is unproven, not a false historical assertion.

`tokenOf(wallet)` is zero if that wallet has never minted, otherwise its original card id even after transfer. For a nonzero id use `claimantOf(id)` to recover the original claimant. It does not follow current ERC-721 ownership. Direct facts are live before mint, then frozen at mint for that claimant. Paid facts can arrive later. A Renderer accepts a supplied registry; an image or metadata from an arbitrary registry authenticates nothing.

The **25 catalog ids** are exhaustive:

| Id | Fact | Evidence |
| --- | --- | --- |
| 101 | Spawned | Direct: joined Curator |
| 201 | Zero-Shot, hour <= 1 | Direct |
| 202 | Zero-Shot, hour 0 | Direct |
| 301 | Hopper >= 3 deposits | Direct |
| 302 | Hopper >= 5 deposits | Direct |
| 303 | Hopper >= 10 deposits | Direct |
| 401 | Bullfrog >= 1 ETH | Direct, largest single send |
| 402 | Bullfrog >= 10 ETH | Direct |
| 403 | Bullfrog >= 100 ETH | Direct |
| 404 | Bullfrog >= 800 ETH | Direct |
| 501 | Benchmarked >= 1000 points | Direct |
| 502 | Benchmarked >= 3162 points | Direct |
| 503 | Benchmarked >= 10000 points | Direct |
| 601 | Swarmed | Operated a seat through 3 accepted swarm jobs, through request block minus 64 |
| 701 | Uptime | Deposited again in hours 24–65 |
| 801 | Holdout | Deposited in hour 64 |
| 901 | Final Token | Last deposit, hour 65 |
| 1001 | Hotfix | Saved an hour |
| 1101 | PID #1 | FirstDeposit index 1 |
| 1102 | PID #1000 | FirstDeposit index 1000 |
| 1103 | PID #10000 | FirstDeposit index 10000 |
| 1104 | PID #19522 | FirstDeposit index 19522 |
| 1105 | First thousand | First deposit among first 1000 |
| 1201 | Top Weights | Shared: top 32 by summed weightAdded |
| 1301 | Pretrained | Nonce >= 20 at Curator deployment block |

Community ids begin at 10001 and end at 65534; read `nextSpecId`, `specOf` and `SpecRegistered` rather than inventing one. `traitsOf` includes monotone direct tiers; do not infer exclusivity from the highest tier drawn on a card. The lowest verified PID ordinal is displayed.

## DON'T

- **Do not register or request a kind-3 spec grouping Transfer, TransferSingle or TransferBatch by from or to.** Mint and burn entries can rank below `2**80`. Registry rejects every kind-3 answer with any top-head address below that bound, including address(0) or the usual dead burn address, or with fewer than the specified head entries. This produces **Missed reason 9**, and loses the request price. Never remove these entries to manufacture an acceptable answer: that changes the rule.
- Before any kind-3 registration or `requestSharedFact`, compute the complete pinned top list over public RPC, sum the specified unsigned field by the indexed address, sort descending by sum and break ties by lowercase address ascending. Refuse low addresses, fewer keys than head, undecodable, truncated, pruned, conflicting or incomplete logs. Split large ranges; require endpoint agreement, including empty ranges.
- **Do not use an image, preview, metadata, card, balance or `ownerOf` as proof of a wallet credential.** Use the authentic Registry's `hasTrait` for the claimant.
- **Do not offer or send a paid call without the user's explicit confirmation of that call, its live price and a successful simulation.** An approval is its own call and requires its own simulation and confirmation. Confirm its receipt before simulating the action. A missing price, allowance, balance, wallet state or dependency read blocks the call. A failed or changed price requires fresh confirmation. Do not auto-retry a broadcast.
- Do not invent ids, substitute a test deployment, deploy contracts, request keys, or silently replace the authentic Registry. Do not sign or send anything for a read-only task.

## Read-only examples

All examples use a caller-supplied real `WALLET`, not a fabricated example address. Pin `BLOCK` to a confirmed Ethereum block and record its hash. They consume only RPC and never sign or send.

### cast call

```sh
RPC=https://ethereum-rpc.publicnode.com
REGISTRY=0x0da2679000ea5380d1361cc3cca7d4e8c881f766
: "${WALLET:?Set WALLET to the actual claimant address}"
BLOCK=$(cast block-number --rpc-url "$RPC")
BLOCK=$((BLOCK - 64))
cast call "$REGISTRY" 'hasTrait(address,uint16)(bool)' "$WALLET" 101 --block "$BLOCK" --rpc-url "$RPC"
cast call "$REGISTRY" 'traitsOf(address)(uint16[])' "$WALLET" --block "$BLOCK" --rpc-url "$RPC"
cast call "$REGISTRY" 'verified(address,uint16)(bytes32,bytes32,uint64,uint64)' "$WALLET" 701 --block "$BLOCK" --rpc-url "$RPC"
cast call "$REGISTRY" 'verifiedSpecsOf(address)(uint16[])' "$WALLET" --block "$BLOCK" --rpc-url "$RPC"
cast call "$REGISTRY" 'tokenOf(address)(uint256)' "$WALLET" --block "$BLOCK" --rpc-url "$RPC"
```

For a nonzero card id from the last call, read `claimantOf(uint256)(address)` at the same block. Never substitute `ownerOf`.

### Solidity credential gate

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface ISworn {
    function hasTrait(address wallet, uint16 id) external view returns (bool);
}
contract SwornGate {
    ISworn constant REGISTRY = ISworn(0x0da2679000Ea5380d1361cc3Cca7D4e8c881F766);
    function eligible(address claimant) external view returns (bool) {
        return REGISTRY.hasTrait(claimant, 101);
    }
}
```

Use the predicate for the wallet your application has authenticated (normally msg.sender), not a caller's claim to own someone else's wallet. The gate can be evaluated by `eth_call` with a code state override; it need not be deployed to test it.

### viem reads

```js
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
const client = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com') });
const registry = '0x0da2679000ea5380d1361cc3cca7d4e8c881f766';
const abi = parseAbi([
  'function hasTrait(address,uint16) view returns (bool)',
  'function traitsOf(address) view returns (uint16[])',
  'function verified(address,uint16) view returns (bytes32,bytes32,uint64,uint64)',
  'function verifiedSpecsOf(address) view returns (uint16[])',
  'function tokenOf(address) view returns (uint256)',
  'function claimantOf(uint256) view returns (address)',
]);
const wallet = process.env.WALLET;
if (!wallet) throw Error('Set WALLET to the actual claimant');
const blockNumber = (await client.getBlockNumber()) - 64n;
const blockHash = (await client.getBlock({ blockNumber })).hash;
const present = await client.readContract({ address: registry, abi, functionName: 'hasTrait', args: [wallet, 101], blockNumber });
const traits = await client.readContract({ address: registry, abi, functionName: 'traitsOf', args: [wallet], blockNumber });
const proof = await client.readContract({ address: registry, abi, functionName: 'verified', args: [wallet, 701], blockNumber });
const community = await client.readContract({ address: registry, abi, functionName: 'verifiedSpecsOf', args: [wallet], blockNumber });
const token = await client.readContract({ address: registry, abi, functionName: 'tokenOf', args: [wallet], blockNumber });
const claimant = token === 0n ? null : await client.readContract({ address: registry, abi, functionName: 'claimantOf', args: [token], blockNumber });
console.log({ blockNumber, blockHash, present, traits, proof, community, token, claimant });
```

### Multicall3 batch

Continuing the same viem setup, this executes Multicall3 without a separately configured address; `deployless` uses `eth_call` only. Each result has its own success or failure state. Never convert a failed call to false.

```js
const batch = await client.multicall({
  deployless: true,
  allowFailure: true,
  blockNumber,
  contracts: [
    { address: registry, abi, functionName: 'hasTrait', args: [wallet, 101] },
    { address: registry, abi, functionName: 'traitsOf', args: [wallet] },
    { address: registry, abi, functionName: 'verifiedSpecsOf', args: [wallet] },
  ],
});
if (batch.some(result => result.status !== 'success')) throw Error('Incomplete credential batch');
console.log(batch);
```

## Build wallet lists for allowlists and onchain reputation

1. Choose one confirmed output block and record its number and hash. Fix a reproducible rule before scanning, for example `hasTrait(wallet,101) && hasTrait(wallet,701)` at that block, with the ids and their interpretation. Document AND/OR, thresholds, exclusions and any sybil-clustering rule; keep the rule alongside the final output.
2. For direct facts, enumerate the Curator's **19,522 wallets** from its `FirstDeposit` logs over blocks 25769870–25789604 inclusive. Deduplicate by contributor, verify the count with `totalContributors`, then call Registry `hasTrait` for each candidate at the output block (batching is useful). Direct reads emit no `Verified` event, so scanning Registry `Verified` alone misses them. Curator `firstHourOf`, `txCountOf`, `contributedBy` and `pointsOf` supply underlying signals; use the Registry predicate when matching frozen credentials.
3. For paid personal and community facts, scan authentic Registry `Verified` logs from deployment block 26242885 through the output block, collecting claimant and traitId. Recheck the predicate and `verified` at the same pinned output block. Events discover candidates; they do not replace present state or the signed proof.
4. For shared facts, discover `SharedFactStored`, read `sharedFact`, and recover the canonical address list from the Intake completion calldata. Verify its ABI-encoded list hash against the stored answerHash. Only `applySharedFact(id,list)` records a listed wallet's fact, emitting `Verified`; membership in the stored list alone does not mean `hasTrait` is true. A paid shared request uses `requestSharedFact`, never personal `upgrade`. Inspect `sharedPending` first.
5. Page all logs with inclusive nonoverlapping windows, split on provider limits or suspected truncation, and compare independent endpoints. Record ranges, endpoints, block hash, errors, script/source commit, ABI hashes, query parameters and sorted output hash. If incomplete, publish no definitive list. Sort the resulting unique addresses reproducibly, attach the rule and provenance, and keep observed and excluded wallets distinguishable. No key is required.

Presence and gas expenditure are signals, not uniqueness or personhood. Curator refunds principal; a farm can split capital across wallets. Record funding/timing clusters and your exclusion policy where appropriate. Do not claim Sworn solves sybil resistance or treat panel agreement as infallible.

## Costs, requests and Missed reasons

Read Registry `MINT_FEE` (0.10 IMD) and `SPEC_FEE` (6.4 IMD). These fees are **forwarded to the IMD BurnExecutor for bridging and burning on Base**; forwarding and destination execution are separate. Requests pay the IMD Intake. Read Registry `ACTION`, `imd` and `intake`, then Intake `priceOf(bytes32,address)` immediately before preparing and before sending. The oracle price is mutable; never promise a cached amount. IMD has 18 decimals. Ethereum gas is additional.

`mintCard()` freezes direct facts. `registerSpec(spec,expectedId)` creates an immutable rule and a receipt supplies its id via `SpecRegistered`; registration does not buy its first oracle request. `upgrade([id],maxPrice)` accepts exactly one personal id. Kind-3 uses `requestSharedFact(id,maxPrice)`, followed after storage by `applySharedFact(id,list)` for each included wallet. Application costs gas only. Chain facts use panel 5 / quorum 3; shared and panel facts use 11 / 7. A false answer, missed quorum, malformed answer or refused answer does not refund the request price. Inspect `TraitRequested`, `Verified`, `SharedFactStored`, `Missed`, `NoVerdict` and `pendingOf`; a request receipt alone proves no credential.

| Missed reason | Meaning |
| --- | --- |
| 1 | Request not pending |
| 2 | Invalid signature or wrong attester |
| 3 | Wrong answer chain |
| 4 | Wrong answer type |
| 5 | Wrong panel, quorum or agreement count |
| 6 | Block window mismatch |
| 7 | Expired or outside issuance window |
| 8 | Answer false / below threshold |
| 9 | Malformed answer, including low kind-3 address or wrong head length |
| 10 | Question hash mismatch |
| 11 | Intake request not completed (settlement) |

`NoVerdict` reports status, reason and agreed/answered separately. Before retrying any paid request, read current pending state and explain that the earlier price was spent. Missing or conflicting RPC data is unavailable evidence and never permission to pay.
