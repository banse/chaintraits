# CONCEPT.md: what the registry is and how it works

The product has no name yet. These pages say *the registry* and *the card*; the per-wallet facts are *traits*.

## 1. In one paragraph

A registry of verifiable onchain feats, each backed by evidence anyone can rerun: a fact read straight from a
settled, immutable contract, or a chain-evidence verdict attested by the IMD swarm through the onchain Intake.
One transferable ERC-721 card per wallet; traits are facts about the wallet that minted the card, never about the
holder. The first catalog is built on THE LIST, the `WhitelistCurator` game on Ethereum mainnet (19,522 wallets
that paid real gas, hour after hour, in a quiet market; settled in hour 66). Any contract can read
`hasTrait(wallet, traitId)` with no card and no token; which traits a mint, an airdrop or a grant should trust is
the consumer's policy, not the registry's.

What it is not: not an eligibility list, not a sybil verdict, not a token.

## 2. Four evidence classes, printed on every card

| class | how the fact is established | cost to the claimant |
|---|---|---|
| **direct read** | the registry calls a view of the settled Curator (or IDMD `balanceOf`) when rendering or when asked | gas only; no transaction at all for `hasTrait` |
| **chain-proven** | an IMD oracle question with `evidence: chain`, one of the deployer's recipes, rerun by the deployer before it is signed; the attestation is verified in the registry's callback | the Intake's price (0.5 IMD on 2026-10-11) + gas |
| **panel-attested** | an IMD oracle question with `evidence: panel`: a pinned RPC read every member repeats | the same price + gas |
| **shared fact** | one chain-proven question whose answer serves many wallets (the top-32 list) | paid once by whoever asks first |

## 3. One card per wallet: claimant and holder

Mirrors the THE LIST record NFT (`reference/list-record/`):

- `tokenOf(wallet)` is the wallet's card (0 = none). `claimantOf(tokenId)` is the wallet that minted it and never
  changes. `mintedAtBlock(tokenId)` is immutable. `ownerOf(tokenId)` is the holder and may differ after a sale.
- **Direct-read traits are computed live** in `tokenURI` and `hasTrait` from the Curator's views and IDMD
  `balanceOf`. No per-trait action, no storage, no oracle.
- **Oracle traits are stored per `(claimant, traitId)`** once an attestation is verified in the callback:
  `verified[claimant][traitId] = (bytes32 requestId, uint64 fromBlock, uint64 toBlock)` (the README's `verified()`
  returns exactly this tuple). They never change and never move with the card.
- `hasTrait(wallet, traitId)` is the credential: the direct-read rule evaluated live, or a `verified` entry. **It
  needs no card.** The card is the display and the collectible; the registry is the credential.
- One card per claimant; no re-mint after a sale, so a sold card keeps its claimant and the facts stay queryable.
- `_update` emits ERC-4906 `MetadataUpdate` on transfers; every verified upgrade emits it too, so marketplaces
  refresh the card as traits arrive.
- First line of the integration guide: a card proves facts about the **claimant**, never about the holder.
  Allowlists read `hasTrait`, never `ownerOf`.

## 4. Flows

**Mint the card.** `mintCard()`: one transaction by the claimant, 0.1 IMD into the sponsor pool (the claimant has
approved the registry; IMD has no `permit`). The card appears with every direct-read trait the wallet qualifies for.

**Upgrade with oracle traits.** `upgrade(uint16[] traitIds)`: one transaction, k Intake requests, k x `priceOf`.
For each the registry stores
`pending[requestId] = (address claimant, uint16 traitId, uint64 requestedAt)` plus the reverse index
`pendingOf[claimant][traitId] = requestId`, and calls `Intake.request` with the body composed from the trait's template
(`TEMPLATES.md`). Minutes later the writer calls `Intake.complete`, which calls the registry's `onResult`; the registry
verifies (`INTEGRATION.md` section 4), writes `verified[claimant][traitId]`, clears the pending pair, and emits
`MetadataUpdate(tokenOf[claimant])` only if the claimant has a card (id 0 is never emitted). A miss is recorded, never
minted. After `14 days` (`block.timestamp` since `requestedAt`) anyone may call `abandon(requestId)` to clear the
pending pair; the price is spent either way. At most one pending request per `(claimant, traitId)`; duplicate ids in
one `upgrade` call revert; an already verified trait cannot be requested again. A wallet without a card may upgrade
too (the traits attach to the claimant; the card renders them when minted). `upgrade` and `requestSharedFact` take a
`maxPrice` and revert when `priceOf` exceeds it.

**Register a spec.** `registerSpec(Spec)` by anyone, 1 IMD into the pool; guards in `CATALOG.md` section 5; emits
`SpecRegistered(id)`. From then on `upgrade` accepts the new id for every wallet.

**Shared facts.** `requestSharedFact(1201, maxPrice)` by anyone, one price, no claimant; at most one pending request
per fact id, and refused once the fact is stored. The callback stores only `sharedFact[1201] = (requestId,
keccak256(a.answer))`: thirty-two fresh storage slots would cost about 700,000 gas, far above the Intake's 200,000-gas
stipend. `applySharedFact(1201, address[] calldata list)` recomputes `keccak256(abi.encode(list))`, compares it with
the stored hash, and marks `verified[msg.sender][1201] = (sharedRequestId, W_LIFE)` if `list[0..head)` contains
`msg.sender`; gas only. The list is public (the attestation is served by the plane and emitted in the Intake's
`Completed` event's result document), so anyone can supply it.

**Sponsor pool.** `sponsor(amount)` from anyone. `upgradeSponsored(idmdTokenId, traitIds[])` lets the holder of IDMD
`idmdTokenId` (checked by `ownerOf`) draw chain-proven upgrades from the pool for their own wallet: **one call per
IDMD token id ever**, with k chain traits in that call; it reverts if the pool cannot cover k x `priceOf`. From
`deployedAt + 30 days` (timestamps), `payForward(wallet, traitId)` lets anyone spend the pool on the chain-proven
upgrade of any wallet, so no IMD can sit stuck in the ownerless contract. Guards against draining the pool on
guaranteed misses: the trait must be a chain class; `firstHourOf(wallet).hasJoined` must be true for the Curator
families (7xx to 12xx all imply membership); at most one pool-funded request per `(wallet, traitId)` ever; a pair with
a recorded miss or a verified entry is refused. Panel traits are never paid by the pool.

## 5. Rendering

- One card template: a grid of trait slots (name, value or evidence line, class glyph), text, rects and paths only;
  the whole card well inside the EIP-170 limit; a second renderer only if the grid needs it.
- The template is a **compile-time constant** in the renderer's bytecode (`bytes constant`; solc emits a `codecopy`),
  not a constructor argument and not a deploy-dependent immutable. **Do not copy the vendored renderer's mechanism:**
  `ListRecordRenderer` takes the blob as a constructor argument, writes it to an SSTORE2 pointer and keeps that
  address in an immutable, which is exactly what the launch check forbids; mirror only its splice loop and its
  golden-test method. Reason: the launch pipeline accepts only static constructor arguments, and
  the deployed runtime code must equal a clean rebuild of the reviewed source (`foundry.toml` sets
  `bytecode_hash = "none"`). Constants and ordinary storage only.
- System monospace font stack, no web fonts, no `<image>`, no external URLs (marketplace sandboxes block them).
- The card is a fixed grid of the 25 catalog slots; community traits (ids 10001 and up) are listed in the JSON
  `attributes` from the claimant's index of verified spec ids (`verifiedSpecsOf(claimant)`, appended on each
  verification, bounded by what the claimant paid for) and are not drawn in the grid.
- `tokenURI` returns `data:application/json;base64,...` with the SVG percent-encoded inside, built from the
  template by splicing per-card values at fixed offsets; the generator in `tools/` produces the template blob, the
  offsets and the goldens, and the golden tests prove the Solidity output byte-exact (see the vendored
  `Renderer.t.sol` and `Template.t.sol` for the method).
- Every oracle trait's metadata carries its template, parameters, pinned window, panel size, quorum and request id,
  so a third party can rerun the recipe against public RPCs without trusting the registry or the swarm.
- The card prints the Curator author's caveat: "this list is not sybil-resistant by design; filter offchain".

## 6. Contracts

| contract | role | constructor |
|---|---|---|
| `Registry` (name pending) | ERC-721 + IERC4906; catalog table; `mintCard`, `upgrade`, `hasTrait`; Intake consumer (`onResult`); specs; shared facts; sponsor pool | `(curator, idmd, imd, intake, attester)` static addresses stored in storage (no `immutable`); it deploys its renderer itself, or takes it as a sixth address if the pipeline refuses a constructor that creates a contract; records `deployedAt = block.timestamp` |
| `Renderer` | template `bytes constant` + offsets as constants + splice + Base64 | none |
| interfaces | `IWhitelistCurator` (in `src/interfaces/`), `IIntake`, `IOracleConsumer` | |

Ownerless, no upgrade, no pause, no fee switch, no `receive`, no `fallback`, no `immutable`, no `tx.origin`. Solidity
0.8.24, Foundry, OpenZeppelin from `lib/`. `hasTrait(wallet, unknownId)` returns false, never reverts;
`hasTrait(address(0), id)` returns false (OpenZeppelin's `balanceOf(0)` reverts, so guard it). The registry's own
events use names the Intake does not (`TraitRequested`, not `Requested`).

### Invariants (every one gets a test: unit, fuzz or invariant; fork tests against the mainnet Curator)

1. `tokenOf(c) != 0` implies `claimantOf(tokenOf(c)) == c`; transfers never change `tokenOf`, `claimantOf`,
   `mintedAtBlock` or any `verified` entry.
2. At most one card per claimant. `mintCard` twice reverts.
3. A `verified[c][t]` entry exists only after an attestation that passed every check in `INTEGRATION.md` section 4
   and whose pending record named exactly `(c, t)`, or, for 1201, after `applySharedFact` matched the stored hash. `hasTrait(c, t)` equals the live rule for direct-read traits and
   the `verified` entry for oracle traits, card or no card.
4. An attestation is consumed once. A wrong signer, wrong `verifyingContract`, wrong `chainId`, wrong `requestId`,
   wrong answer type, malformed answer bytes, wrong window, insufficient quorum, expiry or a failing rule never marks
   a trait and never reverts the callback (no unchecked `abi.decode`); each records a `Missed` event with its reason
   code.
5. `onResult` from any sender but the Intake is rejected; `onResult` fits in the Intake's callback gas stipend
   (measured in a gas test at 200,000 with margin).
6. Tiers are monotone: `hasTrait(c, 303)` implies `hasTrait(c, 302)` and `hasTrait(c, 301)`; likewise 2xx, 4xx, 5xx.
7. A registered spec never changes; the body sent to the Intake is a deterministic function of the spec and the
   claimant (golden tests per template against `templates/fixtures/`); registration fees reach the pool.
8. `tokenURI` is pure over storage and the Curator's views; the renderer output decodes to the golden bytes; a
   hostile spec name cannot break the JSON or the SVG (escaping tests).
9. The registry's IMD balance equals the pool plus amounts of requests not yet forwarded; `abandon` releases a
   pending pair only after 14 days; `payForward` only from day 30 and only with its guards; `upgradeSponsored` at
   most one call per IDMD token id and only for chain traits; the pool never pays a panel trait; one pending request
   per fact id; `sharedFact` holds a hash, never a list.
10. Direct-read traits for a non-member are all false (`firstHourOf` returns `(0, false)`): a non-member never
    renders as an hour-0 early bird.
11. Any address can call `hasTrait` and `tokenURI` for any wallet; no function depends on `tx.origin`.
12. Invariant handlers guard expected reverts (a second `mintCard`, a duplicate pending pair), because
    `fail_on_revert = true` is kept.

## 7. Launch

Through the IMD launch pipeline, kind `evm_contracts`, Ethereum mainnet: one transaction, static constructor
arguments, no token. The pipeline runs audit, adapt, re-audit; the adapt step may change code, so the deployed
runtime code is compared with a clean rebuild of the reviewed commit before any address is published.
