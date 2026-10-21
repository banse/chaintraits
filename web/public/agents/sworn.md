# Sworn: wallet facts for coding agents

A fact is a predicate about the original claimant wallet on Ethereum chain 1. A card is a transferable ERC-721 artifact. Never use ownerOf as a credential.

Deployment configuration: ../imd-deployment.json. Authentic Registry: 0x0da2679000ea5380d1361cc3cca7d4e8c881f766. Source: c4ff3238390fc51962fb67e86affc20cf418126e. Verify ABI hashes and deployed code before interacting.

## Verify a card

1. Read claimantOf(tokenId) on the authentic Registry.
2. Read hasTrait(claimant, id); a card is not required for a credential.
3. Read verified(claimant, id) for the request ids and pinned window. Check the signed oracle answer against the fixed attester, question hash, chain and exact panel requirements.
4. Direct facts are live for unminted wallets and frozen at mint. Transferring a card does not transfer or alter claimant facts.
5. A Renderer accepts its caller's registry argument. An image alone proves no fact.

## Catalog ids

101 Spawned; 201–202 Zero-Shot; 301–303 Hopper; 401–404 Bullfrog; 501–503 Benchmarked; 601 Swarmed; 701 Uptime; 801 Holdout; 901 Final Token; 1001 Hotfix; 1101–1104 PID; 1105 First thousand; 1201 Top Weights; 1301 Pretrained. There are 25 ids. Community specs start at 10001.

Direct tiers are monotone. The lowest verified PID ordinal is displayed. Swarmed means operated a seat through 3 accepted swarm jobs, counted up to 64 blocks before the request block.

## Calls

Set WALLET to the actual claimant, then run:

```sh
cast call 0x0da2679000ea5380d1361cc3cca7d4e8c881f766 'hasTrait(address,uint16)(bool)' "$WALLET" 101 --rpc-url https://ethereum-rpc.publicnode.com
cast call 0x0da2679000ea5380d1361cc3cca7d4e8c881f766 'tokenOf(address)(uint256)' "$WALLET" --rpc-url https://ethereum-rpc.publicnode.com
```

## Costs and failure

A card costs 0.10 IMD. A community spec costs 6.4 IMD; the fee is forwarded to the BurnExecutor for bridging and burning on Base. Oracle attempts use priceOf live, are paid whether true, false or no verdict, and grant no credential until verified. Shared kind-3 facts use requestSharedFact(id,maxPrice) and applySharedFact(id,list), never upgrade. A personal upgrade takes exactly one id. Verify all values directly over public JSON-RPC.
