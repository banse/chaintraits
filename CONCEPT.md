# CONCEPT.md: what the registry is and how it works

The product is **Sworn** (collection symbol `SWORN`, named 2026-10-16). These pages say *the registry* and *the
card*; the per-wallet facts are *traits*. Family display names are the final names of `CATALOG.md` section 7:
Spawned, Zero-Shot, Hopper, Bullfrog, Benchmarked, Swarmed, Uptime, Holdout, Final Token, Hotfix, PID, Top Weights,
Pretrained.

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
| **direct read** | the registry reads a view of the settled Curator: once at mint, frozen on the card; live for a wallet without a card | gas only; no transaction at all for `hasTrait` |
| **chain-proven** | an IMD oracle question with `evidence: chain`, one of the deployer's recipes, rerun by the deployer before it is signed; the attestation is verified in the registry's callback | the Intake's price (0.5 IMD on 2026-10-12) + gas |
| **panel-attested** | an IMD oracle question with `evidence: panel`: a pinned RPC read every member repeats (1301), or the operator fact's log and state reads across three contracts (601, `docs/REBUILD.md` 4.2) | the same price + gas |
| **shared fact** | one chain-proven question whose answer serves many wallets (the Top Weights list, 1201) | paid once by whoever asks first |

## 3. One card per wallet: claimant and holder

Mirrors the THE LIST record NFT (`reference/list-record/`):

- `tokenOf(wallet)` is the wallet's card (0 = none). `claimantOf(tokenId)` is the wallet that minted it and never
  changes. `mintedAtBlock(tokenId)` is immutable. `ownerOf(tokenId)` is the holder and may differ after a sale.
- **Direct-read traits (families 1 to 5) are read from the Curator's views**: once at `mintCard` and frozen on the
  card (`frozenDirect`), live for a wallet without a card (`hasDirectTrait`). No per-trait action, no oracle. Trait
  601 (Swarmed, family 6) is not a direct read: it is the sworn operator fact of kind 6 (`docs/REBUILD.md` 4.2),
  stored like every oracle trait.
- **Oracle traits are stored per `(claimant, traitId)`** once an attestation is verified in the callback:
  `verified[claimant][traitId] = (bytes32 requestId, bytes32 oracleRequestId, uint64 fromBlock, uint64 toBlock)`
  (the README's `verified()` returns exactly this tuple; `requestId` is the Intake's id, `oracleRequestId` the plane's
  signed id, see `INTEGRATION.md` section 4). They never change and never move with the card.
- `hasTrait(wallet, traitId)` is the credential: the direct-read rule evaluated live, or a `verified` entry. **It
  needs no card.** The card is the display and the collectible; the registry is the credential.
- One card per claimant; no re-mint after a sale, so a sold card keeps its claimant and the facts stay queryable.
- `_update` emits ERC-4906 `MetadataUpdate` on transfers; every verified upgrade emits it too, so marketplaces
  refresh the card as traits arrive.
- First line of the integration guide: a card proves facts about the **claimant**, never about the holder.
  Allowlists read `hasTrait`, never `ownerOf`.

## 4. Flows

**Mint the card.** `mintCard()`: one transaction by the claimant, 0.1 IMD pulled from the claimant and transferred in
the same transaction to the BurnExecutor V2, which holds it for bridging and burning on Base (the claimant has
approved the registry; IMD has no `permit`). The card appears with every direct-read trait the wallet qualifies for, frozen at that block.

**Upgrade with oracle traits.** `upgrade(uint16[] traitIds, uint256 maxPrice)` with exactly one id: one transaction,
one Intake request, one `priceOf` (reverts when `priceOf > maxPrice`). For the trait the registry composes the body from the trait's
template (`TEMPLATES.md`) with `msg.sender` as the claimant and itself as the `consumer` on the deployment
chain (`consumer.chainId = block.chainid`); the question's `chainId` remains 1, Ethereum mainnet. It computes the plane's
`questionHash` of that body (`INTEGRATION.md` section 4, check 7), stores
`pending[requestId] = (claimant, traitId, requestedAt, questionHash, fromBlock, toBlock)` plus the reverse index
`pendingOf[claimant][traitId] = requestId`, and calls `Intake.requestWithFailure` with `onResult` and `onFailure` as
the two callbacks. Minutes later the writer calls `Intake.complete`, which calls `onResult` (a result) or `onFailure`
(a refusal or a panel without a verdict); the registry verifies (`INTEGRATION.md` section 4), writes
`verified[claimant][traitId]`, clears the pending pair, and emits `MetadataUpdate(tokenOf[claimant])` only if the
claimant has a card (id 0 is never emitted). Every other outcome clears the pending pair and stores nothing (the
transition table in `INTEGRATION.md` section 4b); the price is spent either way, and the claimant may request the
trait again. After 31 days (`ABANDON_AFTER`; `block.timestamp` since `requestedAt`) only the stored claimant may call
`abandon(requestId)` to clear a personal pair the plane never completed; a stranger gets `NotClaimant()`.
Anyone may abandon a shared fact, whose claimant is zero. Abandoning returns no price; the dates of an attestation are bounded to its request
(`docs/REBUILD.md` 3.4), so every answer a request can receive is dead before that day and a late answer never
settles an abandoned request. At most one pending request per `(claimant, traitId)`; duplicate ids in one `upgrade`
call revert; an already verified trait cannot be requested again. A wallet without a card may upgrade too (the traits
attach to the claimant; the card renders them when minted). `composeBody(traitId, claimant)` is a public view that
returns the exact body and its `questionHash`, so a front end or a third party can preview and quote a request for
free before paying.

**Register a spec.** `registerSpec(Spec, expectedId)` by anyone, 6.4 IMD transferred to the BurnExecutor V2 (for bridging and burning on Base); guards in `CATALOG.md` section 5 and `docs/REBUILD.md` 3.6; emits
`SpecRegistered(id, registrant)`. From then on `upgrade` accepts the new id for every wallet, paid by the claimant.
At the 0.5 IMD oracle price, registration plus the first claim costs 6.9 IMD, excluding gas.

**Shared facts.** `requestSharedFact(factId, maxPrice)` by anyone for any T3 id (1201 or a registered T3 spec), one
price, no claimant; at most one pending request per fact id, and refused once the fact is stored. The callback checks
the answer's canonical `address[]` envelope (`INTEGRATION.md` check 8) and stores only
`sharedFact[factId] = (requestId, keccak256(a.answer), n)`: thirty-two fresh storage slots would cost about 700,000
gas, far above the Intake's 200,000-gas stipend, and a malformed envelope must not poison the fact forever (it is a
miss; the fact can be requested again). `applySharedFact(factId, address[] calldata list)` recomputes
`keccak256(abi.encode(list))`, compares it with the stored hash, and marks
`verified[msg.sender][factId] = (sharedRequestId, oracleRequestId, window)` if `list[0..min(head, n))` contains
`msg.sender`; gas only; once per claimant and fact. The list is public: it is in the `complete` transaction's calldata
and in the attestation the plane serves at `/oracle/requests/<oracleRequestId>/attestation`, so anyone can supply it.

**Fees.** The registry takes two fees, 0.1 IMD at `mintCard` and 6.4 IMD at `registerSpec`, and transfers each in
the same transaction to the IMD BurnExecutor V2 (`0xe29386719C155B6847aD5a4E97C6674f10ffc750`), whose pending amount
is its IMD balance; anyone may bridge it to Base, where it is burned, by paying the LayerZero fee. The registry
promises the forward, not the burn. Oracle prices go to the Intake.
The registry never holds IMD at rest, never handles ETH, has no `payable` function and nothing that moves money it
holds (`docs/REBUILD.md` 3.8).

## 5. Rendering

- One card image, the **hive symbol** (2026-10-16; README "The card image"): thirteen hexagonal cells, one per
  family, lit in the family's class colour, part-filled with honey up to the tier reached, ringed by the first 39
  community specs, dotted white at a rare top tier, framed by a ring that a path circles as the community count
  grows. Polygons, clip paths, one circle per rare tier, one path and one text element only; the whole renderer
  inside the EIP-170 limit; a second renderer only if it ever needs it.
- The JSON envelope and every coordinate string of the image are **compile-time constants** in the renderer's
  bytecode (`bytes constant`; solc emits a `codecopy`),
  not a constructor argument and not a deploy-dependent immutable. **Do not copy the vendored renderer's mechanism:**
  `ListRecordRenderer` takes the blob as a constructor argument, writes it to an SSTORE2 pointer and keeps that
  address in an immutable, which is exactly what the launch check forbids; mirror only its splice loop and its
  golden-test method. Reason: the launch pipeline accepts only static constructor arguments, and
  the deployed runtime code must equal a clean rebuild of the reviewed source (`foundry.toml` sets
  `bytecode_hash = "none"`). Constants and ordinary storage only.
- System monospace font stack, no web fonts, no `<image>`, no external URLs (marketplace sandboxes block them).
- The card draws the 13 families, not the 25 ids: the tier reached shows as the honey level and the rare top tiers
  as a dot. Community traits (ids 10001 and up) are drawn only as a count (rings up to 39, the path beyond) and are
  never named in the image; the JSON `attributes` list the claimant's verified community ids from
  `verifiedSpecsOf(claimant)`, **at most the
  first 32**, each with its spec name, plus a `community_count` attribute with the full count, so metadata stays bounded whatever a claimant
  buys; `verifiedSpecsOf` returns every id. Only the claimant can add to that index (`upgrade` and `applySharedFact`
  act for `msg.sender`), and an id is appended once (a second verification of
  the same pair is impossible: a verified trait cannot be requested or applied again).
- `tokenURI` returns `data:application/json;base64,...` with the SVG percent-encoded inside, built from the
  envelope by splicing per-card values at fixed offsets; the image value is assembled from precomputed,
  pre-encoded strings selected by index (no trigonometry onchain). The generator in `tools/` is the normative
  drawing and produces the envelope blob, the offsets, the hive data and the goldens, and the golden tests prove
  the Solidity output byte-exact (see the vendored `Renderer.t.sol` and `Template.t.sol` for the method).
- Every oracle trait's metadata carries its template, parameters, pinned window, `minPanelSize`, `minQuorum` (acceptance minima; signed values are in the served attestation), the Intake
  `requestId` and the plane's `oracleRequestId`, so a third party can rerun the recipe against public RPCs or fetch the
  served attestation without trusting the registry or the swarm.
- The card prints the Curator author's caveat: "this list is not sybil-resistant by design; filter offchain".

## 6. Contracts

Three contracts: `Registry`, `Renderer` and `Composer`; the registry's constructor takes seven arguments.

| contract | role | constructor |
|---|---|---|
| `Registry` (`ERC721("Sworn", "SWORN")`) | ERC-721 + IERC4906; catalog table; `mintCard`, `upgrade`, `hasTrait`; Intake consumer (`onResult`, `onFailure`); specs; shared facts | seven static addresses `(curator, imd, intake, attester, renderer, composer, burnExecutor)` stored in storage (no `immutable`), every one nonzero; the renderer and the composer are deployed first and passed in as static addresses (the registry creates no contract: with both helpers embedded its init code would exceed EIP-3860); `renderer`, `composer` and `burnExecutor` must have code, always; outside the floor (all three of Curator, IMD and Intake codeless) it requires `curator.isSettled()` true, `imd.decimals() == 18` and `intake.priceOf(ACTION, imd)` nonzero |
| `Renderer` | template `bytes constant` + offsets as constants + splice + Base64 | none |
| `Composer` | the five templates, body and canonical-document serialisers, catalog specs, spec guards, name table, catalog enumeration and direct-read predicates; views only, never called inside `onResult` | none |
| interfaces | `IWhitelistCurator` (written by the builder from the verified ABI `reference/abi/WhitelistCurator.json`), `IIntake` (v2: `requestWithFailure`, from `reference/IntakeV2.sol`), `IOracleConsumer` (`onResult`, `onFailure`); the executor needs no interface: the registry only transfers IMD to it | |

The constructor skips its dependency reads only when **all three of Curator, IMD and Intake lack code**: the
pipeline's empty-chain floor, no external call at all. If any of the three has code, all three reads run. The code
checks of the renderer, the composer and the executor and the seven nonzero-address checks always apply. The factory
probe deploys Renderer, Composer and Registry in order, but operational launch still requires the deployer to verify
every address and both helpers. `deployForChain()` uses the Sepolia set on 11155111 and the mainnet constants on
every other chain. Parameters are in `INTEGRATION.md` section 1.

Ownerless, no upgrade, no pause, no fee switch, no `payable`, no `receive`, no `fallback`, no `immutable`, no `tx.origin`. Solidity
0.8.24, Foundry, OpenZeppelin from `lib/` (ERC721, ECDSA.tryRecover, MessageHashUtils, ReentrancyGuard; **not** the
`EIP712` base, which holds immutables: the domain separator is computed at verification time, `INTEGRATION.md`
section 4). `hasTrait(wallet, unknownId)` returns false, never reverts; `hasTrait(address(0), id)` returns false
(OpenZeppelin's `balanceOf(0)` reverts, so guard it). The registry's own events use names the Intake does not
(`TraitRequested`, not `Requested`).

### Invariants (every one gets a test: unit, fuzz or invariant; fork tests against the mainnet Curator)

1. `tokenOf(c) != 0` implies `claimantOf(tokenOf(c)) == c`; transfers never change `tokenOf`, `claimantOf`,
   `mintedAtBlock` or any `verified` entry.
2. At most one card per claimant. `mintCard` twice reverts.
3. A `verified[c][t]` entry exists only after an attestation that passed every check in `INTEGRATION.md` section 4
   and whose pending record named exactly `(c, t)` with the `questionHash` of the body the registry composed for
   `(c, t)`, or, for any T3 id, after `applySharedFact` matched the stored hash and found `c` within `head`.
   `hasTrait(c, t)` uses the frozen direct snapshot when a card exists, live direct rules otherwise, and stored verified entries for oracle traits.
4. An attestation is consumed once: one pending request is consumed once (its first callback clears it, and any later
   callback for that request id is reason 1 and touches nothing). The same signed evidence is not tied to one request:
   it may satisfy another pending request whose canonical question is identical (same `questionHash`, which binds
   the claimant, the trait and the window), because the registry checks the question, not the attestation's identity.
   A wrong signer, wrong `verifyingContract`, wrong `chainId`, wrong `questionHash`,
   wrong answer type, malformed answer bytes, wrong window, insufficient quorum, expiry or a failing rule never marks
   a trait and never reverts the callback for an envelope that decodes (no unchecked `abi.decode`); each records a
   `Missed` event with its reason code. An attestation signed for another consumer or another chain is never
   accepted, whatever else it says.
5. `onResult` and `onFailure` from any sender but the Intake are rejected; both fit in the Intake's callback gas
   stipend of 200,000 under today's schedule and under Glamsterdam's, with 25,000 to spare (a delivery writes no slot
   that holds zero before it; worst case: cold storage, a community id appended, a card to refresh); a true verdict
   that still arrives undelivered is stored by anyone through `settle`, with the same checks.
6. Tiers are monotone: `hasTrait(c, 303)` implies `hasTrait(c, 302)` and `hasTrait(c, 301)`; `hasTrait(c, 202)`
   implies `hasTrait(c, 201)`; likewise 4xx and 5xx. The PID family (11xx, working name Ordinal) is not a tier family.
7. A registered spec never changes; the body sent to the Intake is a deterministic function of the spec and the
   claimant (golden tests per template against `templates/fixtures/`), and the Composer's returned question hash, which hashes the canonical document of `INTEGRATION.md` section 4, check 7,
   not the body, equals the plane's value for every fixture (`reference/plane/questionHashes.json`); registration fees are forwarded to the BurnExecutor for bridging and burning on Base.
8. `tokenURI` renders the Registry's claimant, frozen direct traits, stored facts and specs; the renderer output
   decodes to the golden bytes; a hostile spec name cannot break the JSON or the SVG (escaping tests).
9. The registry's IMD balance is zero after every transaction it makes: a fee reaches the executor in the
   transaction that pulls it, and a claimant-paid request pulls and forwards in one transaction; `abandon` releases a
   pending pair only after 31 days, by its claimant for personal requests or anyone for a shared fact; one pending
   request per pair and per fact id; `sharedFact` holds a hash and a length, never a list.
10. Curator-derived direct-read traits (families 1 to 5) for a non-member are all false (`firstHourOf` returns
    `(0, false)`): a non-member never renders as an hour-0 Zero-Shot. 601 (Swarmed) is an oracle fact and independent
    of membership.
11. Any address can call `hasTrait` and `tokenURI` for any wallet; no function depends on `tx.origin`.

12. The registry never receives or holds ETH: no function is `payable`, there is no `receive` or `fallback`; its ETH
    balance is zero unless force-sent, and nothing can spend it.

Harness discipline (not a product invariant): invariant handlers guard expected reverts (a second `mintCard`, a
duplicate pending pair), because `fail_on_revert = true` is kept.

## 7. Launch

Through the IMD launch pipeline, kind `evm_contracts`, Ethereum mainnet: one transaction, static constructor
arguments, no token. The pipeline runs audit, adapt, re-audit; the adapt step may change code, so the deployed
runtime code is compared with a clean rebuild of the reviewed commit before any address is published, and the
artifacts' `immutableReferences` are checked to be empty first (a non-empty table means the comparison can never
pass).
