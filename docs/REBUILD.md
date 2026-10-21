# Sworn, built from nothing: the complete specification

This branch (`rebuild-base`) holds no product code. It holds the specification of Sworn and the evidence behind it, and
the swarm writes every line of code from it: the three contracts, their tests and goldens, the generator of the
renderer's tables, the deployment script, the public site. The owner's reason (2026-10-21): the live deployment's tree
was built by the swarm on a brief that carried owner-written code (a Curator interface, a generator, hive lines,
tests); after this build no line of the product carries the entrant's authorship.

This file is the top of the specification and is self-contained on every rule. The other documents are the long
form and the evidence; where one of them disagrees with this file, this file wins. Reading order:

1. this file;
2. `CONCEPT.md` (what it is, the card model, the flows, the invariants), `CATALOG.md` (ids, rules, windows,
   populations, the name table, spec registration), `TEMPLATES.md` (the question templates and the request body),
   `INTEGRATION.md` (the Intake, the attestation, the external contracts, the transition table);
3. `templates/fixtures/` (the exact question bodies the Composer must reproduce byte for byte) and `reference/`
   (verified sources and ABIs, served attestations, decoded completions, block headers, the plane's checks and
   quotes, the plane's `questionHash` goldens, the THE LIST record NFT this card model mirrors, the Curator census);
4. `docs/SITE.md` (the public site), `docs/DESIGN.md` (the look of the earlier site, kept as the design record);
5. `DEPLOYMENTS.md`, `DISCLOSURE.md`, `audits/` (the two earlier deployments and their audits: history, not
   instructions; they keep the words of the earlier design).

What is given, and what is yours: given are the compiler pins and the two libraries (`foundry.toml`,
`remappings.txt`, `lib/forge-std` v1.9.7, `lib/openzeppelin-contracts` at `cab19933`, both submodules), the
documents, the fixtures and `reference/`. Yours are `src/`, `test/`, `script/`, `tools/`, `web/`, every golden, every
generated table and the documents named in section 10. Nothing in `lib/`, `foundry.toml` or `remappings.txt`
changes. The earlier trees exist on this repository's `main` branch and in the swarm's delivery repositories; they
are not an input of this build and are not to be copied: the point of the build is a second, independent
implementation of the same specification. Where this file says "as today" or "unchanged", it means: as the
documents of item 2 describe, not as any earlier code did it.

Public texts name no version: the product is Sworn, the two earlier deployments were tests, never announced. This
file's name is an internal label.

## 1. The product in one paragraph

An ownerless registry of facts about wallets on Ethereum mainnet. One transferable ERC-721 card per wallet; every
trait is a fact about the wallet that minted the card (the claimant), never about the holder. Thirteen Curator-read
traits are read free from the settled `WhitelistCurator` (THE LIST) and frozen on the card at mint; every other
trait is a verdict of the IMD swarm, asked through the onchain Intake, signed by the plane's attester and verified
in the registry's callback; one shared fact (the top-32 list) serves many wallets at once; anyone may register a
community spec for 6.4 IMD and the swarm answers it for every wallet that pays. `hasTrait(wallet, traitId)` is the
credential and needs no card. Every fee the registry takes is transferred at once to the IMD BurnExecutor V2 to be
burned; the registry never holds IMD at rest and never handles ETH. No owner, no setter, no pause, no upgrade path.
Not an eligibility list, not a sybil verdict, not a token.

## 2. The three contracts and their public surface

Three contracts, deployed in this order by the IMD launch pipeline in one mainnet transaction: `Renderer` (no
constructor arguments, no storage), `Composer` (no constructor arguments, no storage), `Registry`
(`ERC721("Sworn", "SWORN")`, seven constructor arguments, section 3.9). Solidity 0.8.24, Foundry, OpenZeppelin from
`lib/` (ERC721, `ECDSA.tryRecover`, `MessageHashUtils`, `ReentrancyGuard`, `SafeERC20`; never the `EIP712` base,
which holds immutables). No `immutable` anywhere, no `receive`, no `fallback`, no `payable` function, no `tx.origin`,
no `selfdestruct`, no `delegatecall`, no `create`. Every external dependency address is ordinary storage set once by
the constructor.

The surface below is binding in names, argument and return types and order (integrators and the site read it); the
builder may add views, never remove or rename one. Types are Solidity's; `Spec` is the struct of `CATALOG.md`
section 5 (field order is the ABI); `OracleAttestation` is the 15-field struct of `INTEGRATION.md` section 4.

### 2.1 Registry

```solidity
// constants
function ACTION() view returns (bytes32);        // bytes32("oracle.request@oracle-1")
function MINT_FEE() view returns (uint256);      // 0.1 ether (IMD, 18 decimals)
function SPEC_FEE() view returns (uint256);      // 6.4 ether (IMD)

// dependencies, fixed at construction
function curator() view returns (address);
function imd() view returns (address);
function intake() view returns (address);
function attester() view returns (address);
function renderer() view returns (address);
function composer() view returns (address);
function burnExecutor() view returns (address);

// cards (plus the ERC-721 and ERC-4906 surface: name, symbol, balanceOf, ownerOf, approve, getApproved,
// setApprovalForAll, isApprovedForAll, transferFrom, safeTransferFrom x2, supportsInterface, tokenURI,
// MetadataUpdate, BatchMetadataUpdate)
function mintCard() returns (uint256 tokenId);                 // 0.1 IMD, burned; once per wallet
function tokenOf(address wallet) view returns (uint256);       // 0 = no card
function claimantOf(uint256 tokenId) view returns (address);   // the minter, for ever
function mintedAtBlock(uint256 tokenId) view returns (uint64);
function frozenDirect(uint256 tokenId) view returns (uint32);  // the direct snapshot taken at mint (3.2)
function totalSupply() view returns (uint256);

// traits
function hasTrait(address wallet, uint16 traitId) view returns (bool);        // the credential; no card needed; never reverts
function hasDirectTrait(address wallet, uint16 traitId) view returns (bool);  // the 13 Curator-read ids only (3.2)
function traitsOf(address wallet) view returns (uint16[] memory ids);         // every true catalog id, all tiers, no specs
function verifiedSpecsOf(address wallet) view returns (uint16[] memory);      // every verified community id, in order
function traitName(uint16 traitId) view returns (string memory);
function upgrade(uint16[] calldata traitIds, uint256 maxPrice);               // k oracle requests, k x priceOf
function abandon(bytes32 requestId);
function verified(address claimant, uint16 traitId) view
    returns (bytes32 requestId, bytes32 oracleRequestId, uint64 fromBlock, uint64 toBlock);
function pendingOf(address claimant, uint16 traitId) view returns (bytes32 requestId);
function pendingRequest(bytes32 requestId) view
    returns (address claimant, uint16 traitId, uint64 requestedAt, bytes32 questionHash);
function composeBody(uint16 traitId, address claimant) view returns (bytes memory body, bytes32 questionHash);
function attestationDigest(OracleAttestation calldata a) view returns (bytes32);

// Intake consumer (the Intake only)
function onResult(bytes32 requestId, OracleAttestation calldata a, bytes calldata signature);
function onFailure(bytes32 requestId, uint8 status, bytes32 reason, uint16 agreed, uint16 answered,
    bytes calldata signature);

// community specs
function registerSpec(Spec calldata spec, uint256 expectedId) returns (uint16 traitId);  // 6.4 IMD, burned
function specOf(uint16 traitId) view returns (Spec memory);                              // catalog ids too; reverts for an unknown id
function nextSpecId() view returns (uint16);

// shared facts
function requestSharedFact(uint16 factId, uint256 maxPrice);
function applySharedFact(uint16 factId, address[] calldata list);
function sharedFact(uint16 factId) view returns (bytes32 requestId, bytes32 answerHash, uint16 length);
function sharedPending(uint16 factId) view returns (bytes32);
```

Events: `CardMinted(address indexed claimant, uint256 indexed tokenId)`, `TraitRequested(address indexed claimant,
uint16 indexed traitId, bytes32 requestId, bytes32 questionHash)` (a shared-fact request emits it with claimant zero),
`Verified(address indexed claimant, uint16 indexed traitId, bytes32 requestId, bytes32 oracleRequestId)`,
`Missed(bytes32 requestId, uint16 traitId, uint8 reason)`, `NoVerdict(bytes32 requestId, uint16 traitId, uint8 status,
bytes32 reason, uint16 agreed, uint16 answered)`, `Abandoned(bytes32 requestId)`, `SpecRegistered(uint16 indexed
traitId, address indexed registrant)`, `SharedFactStored(uint16 indexed factId, bytes32 requestId, uint16 length)`,
ERC-4906 `MetadataUpdate(uint256)` on every transfer and every verified upgrade of a wallet that has a card.

Errors: `AlreadyMinted(address)`, `AlreadyPending(address, uint16)`, `AlreadyVerified(address, uint16)`,
`DependencyHasNoCode()`, `FactAlreadyStored(uint16)`, `FactNotStored(uint16)`, `ListMismatch()`, `NoCard(uint256)`,
`NoTraits()`, `NotASharedFact(uint16)`, `NotAnOracleTrait(uint16)`, `NotClaimant()`, `NotInList()`, `NotIntake()`,
`NotPending(bytes32)`, `PriceAboveMax(uint256 price, uint256 maxPrice)`, `RequestIdTaken(bytes32)`, `TooEarly()`,
`UnexpectedSpecId(uint256 expected, uint256 next)`, `ZeroAddress()`, `ZeroPrice()`, plus OpenZeppelin's ERC-721,
`SafeERC20` and reentrancy errors and the Composer's `BadSpec(string field)` surfacing through `registerSpec`.

### 2.2 Composer (views only; never called inside `onResult`)

```solidity
function compose(uint16 traitId, Spec calldata s, address claimant, address consumer, address curator) view
    returns (bytes memory body, bytes32 questionHash);              // the request body and the plane's questionHash of it
function catalogSpec(uint16 traitId, address curator) pure returns (Spec memory);   // every catalog oracle id, 601 included
function validateSpec(Spec calldata s, uint256 blockNumber) view;  // reverts BadSpec(field); kinds 1 to 5 only
function directSnapshot(address wallet, address curator) view returns (uint32 bits);  // 3.2; no IdentityMD argument
function traitsOf(address registry, address wallet) view returns (uint16[] memory ids);
function mainnetHeightBound() view returns (uint256);
function DEPOSITED() view returns (string memory);
```

Errors: `BadSpec(string field)`, `NotACatalogOracleTrait(uint16)`.

### 2.3 Renderer (pure over its inputs; it reads the registry)

```solidity
function tokenURIOf(address registry, uint256 tokenId) view returns (string memory);
function traitName(uint16 traitId) pure returns (string memory);
```

Errors: `NoCard(uint256)`, `UnknownTrait(uint16)`. The registry's `tokenURI(tokenId)` returns
`renderer.tokenURIOf(address(this), tokenId)`.

## 3. Registry rules

### 3.1 Cards

- `mintCard()`: once per wallet (`AlreadyMinted`); pulls `MINT_FEE` from `msg.sender` with `safeTransferFrom` and
  transfers it in the same transaction to `burnExecutor` (the executor's pending amount is its IMD balance; anyone
  bridges and burns it on Base by paying the LayerZero fee); takes the direct snapshot (3.2); `_mint` (not
  `_safeMint`: no receiver callback); records `claimantOf`, `mintedAtBlock`, `tokenOf`; increments `totalSupply`;
  emits `CardMinted`. Order: fee, state, mint. IMD has no `permit`; the claimant approves the registry first.
- Token ids start at 1 and count up. `tokenOf(c) != 0` implies `claimantOf(tokenOf(c)) == c`; transfers never
  change `tokenOf`, `claimantOf`, `mintedAtBlock`, `frozenDirect` or any verified entry. A sold card keeps its
  claimant; no re-mint after a sale. The metadata `description` ends with "Facts about the wallet that minted it;
  direct traits frozen at mint; transferable."
- Holding a card gives no power over it and takes none away from the holder: every mutating entry point
  (`upgrade`, `requestSharedFact`, `applySharedFact`, `registerSpec`, `mintCard`) acts on `msg.sender`'s own wallet
  facts, whatever cards that wallet holds; nothing is keyed by the token. No rule may make a wallet's eligibility
  depend on an incoming transfer.
- `_update` emits `MetadataUpdate(tokenId)` on transfers; every verified upgrade and every `applySharedFact` of a
  wallet with a card emits it too (id 0 is never emitted).
- No ERC-2981: there is no treasury to pay royalties to.

### 3.2 Direct traits (families 1 to 5, thirteen ids)

- The thirteen Curator-read ids are 101, 201, 202, 301, 302, 303, 401, 402, 403, 404, 501, 502, 503, with the rules
  of `CATALOG.md` section 3 (read only `firstHourOf`, `txCountOf`, `contributedBy`, `pointsOf`; never
  `contributors()`; a non-member is `(0, false)` and has none of them; `hasTrait(address(0), id)` is false).
- `Composer.directSnapshot(wallet, curator)` returns the thirteen bits in one `uint32`: bit
  `(id / 100 - 1) * 4 + (id % 100 - 1)` is set when the rule holds (101 = bit 0, 202 = bit 5, 404 = bit 15,
  503 = bit 18). Bits 19 and above are never set.
- `mintCard` stores that word as `frozenDirect[tokenId]`. `hasDirectTrait(wallet, id)` answers from the snapshot
  for a wallet that has a card and from the live read for a wallet without one; `hasTrait` and `tokenURI` use it.
  `hasDirectTrait(wallet, id)` is false for every id outside the thirteen, 601 included.
- Tiers are monotone (`CATALOG.md` section 2): the snapshot of a wallet with ten deposits has 301, 302 and 303; an
  hour-0 wallet has 201 and 202. The card shows the highest tier per family.

### 3.3 Oracle traits: asking

- Oracle ids are the catalog's 601, 701, 801, 901, 1001, 1101 to 1105, 1301 and every registered community id of
  kinds 1, 2, 4 and 5. `upgrade(traitIds, maxPrice)`: for each id, in order: not a shared-fact id (`NotASharedFact`
  for 1201 and every kind-3 spec), an oracle id (`NotAnOracleTrait` for a direct id or an unknown id), not verified
  (`AlreadyVerified`), not pending (`AlreadyPending`), no duplicate inside the call; an empty array reverts
  `NoTraits`. The price is `intake.priceOf(ACTION, imd)` read in the same transaction: zero reverts `ZeroPrice`,
  above `maxPrice` reverts `PriceAboveMax`. The registry pulls `k x price` from `msg.sender`, approves the Intake per
  request (`forceApprove` per iteration: Intake v2 pulls inside `request`, so each approval is consumed before the
  next is set) and calls `requestWithFailure(ACTION, body, (this, onResult.selector), onFailure.selector, imd,
  price)` once per id. A wallet without a card may upgrade (the traits attach to the claimant; the card renders them
  when minted).
- The body is `Composer.compose(traitId, specOf(traitId), msg.sender, address(this), curator)`: byte-exact to
  `TEMPLATES.md` and the fixtures for the catalog ids, with `consumer = {block.chainid, address(this)}`; the
  question's `chainId` stays 1. `composeBody(traitId, claimant)` returns body and hash for free.
- The pending record: `pending[requestId] = (claimant, traitId, requestedAt, questionHash, fromBlock, toBlock)` with
  the reverse index `pendingOf[claimant][traitId] = requestId`; for a shared fact `claimant == 0` and
  `sharedPending[factId] = requestId`. **A pending record is never overwritten:** when `pending[requestId].requestedAt
  != 0` for the id the Intake returns, revert `RequestIdTaken(requestId)`. The window stored is the one the body was
  composed with (a constant window for catalog ids, the spec's window for a community id, the living window for 601).
- `TraitRequested(claimant, traitId, requestId, questionHash)` is emitted per request.

### 3.4 Oracle traits: the callback

- `onResult(requestId, a, signature)` and `onFailure(...)`: `msg.sender == intake` first (`NotIntake` otherwise);
  an unknown `requestId` (abandoned, consumed, never ours) is `Missed(requestId, 0, 1)` and touches nothing.
- **Order: clear, then check.** The first callback for a pending id deletes the pending record and the reverse index
  (the index only if it still equals this id), then verifies; a non-conforming delivery emits `Missed` with its reason
  and the request is over, so the claimant can request again at once. The Intake completes a request exactly once; a
  replay of a consumed attestation is reason 1.
- The checks, in this order, with `INTEGRATION.md` section 4 as the long form and its reason codes (1 not pending,
  2 signer, 3 chainId, 4 answerType, 5 panel or quorum, 6 window, 7 expiry or dates, 8 rule, 9 decode, 10
  questionHash):
  1. `signature.length == 65` (else 2); `a.answer.length <= 2112` and, for a bool or uint256 kind, `== 32` (else 9);
     these run before any dynamic copy or hash; the expected kind comes from the pending trait, never from
     `a.answerType`.
  2. `a.chainId == 1` (else 3).
  3. The EIP-712 digest under domain `{"IdentityMD Oracle", "2", block.chainid, address(this)}` with the type string
     of `INTEGRATION.md` section 4, computed at verification time (never a cached separator); `ECDSA.tryRecover`
     (never `recover`); an error, a zero signer or a signer other than `attester` is 2.
  4. `a.answerType` equals the kind's code (bool 0 for kinds 4, 5, 6; uint256 3 for kinds 1, 2; address[] 4 for
     kind 3) (else 4).
  5. `a.agreed >= a.quorum`, `a.quorum >= the kind's quorum`, `a.panelSize >= the kind's panel` (chain kinds 1, 2, 4:
     5 / 3; kinds 3, 5, 6: 11 / 7) (else 5). The plane has signed below its own quorum; this check is what keeps a
     below-quorum panel from becoming a permanent fact.
  6. `a.fromBlock` and `a.toBlock` equal the pending record's window (else 6).
  7. Dates: `block.timestamp <= a.expiresAt`; `a.issuedAt <= block.timestamp + 1 hours`; `a.issuedAt >=
     p.requestedAt`; `a.issuedAt <= p.requestedAt + ISSUE_WINDOW` with `ISSUE_WINDOW = 1 days`; `a.expiresAt <=
     a.issuedAt + VALID_FOR_SECONDS` (2,592,000) (else 7). With `ABANDON_AFTER = 31 days` every attestation a
     request can ever receive is dead before anyone may abandon it, so a late valid answer never collides with an
     abandoned request.
  8. `a.questionHash == p.questionHash` (else 10).
  9. The answer, decoded defensively (never a plain `abi.decode` on hostile bytes): kinds 1 and 2 `value >=
     threshold`; kinds 4, 5, 6 the word is 0 or 1 (else 9) and `== 1` (else 8); kind 3 the canonical envelope
     (`length == 64 + 32 n`, word 0 `0x20`, word 1 `n`, `n` equal to the fact's `head` exactly, clean address words;
     else 9).
- On success, personal: `verified[claimant][traitId] = (requestId, a.requestId, fromBlock, toBlock)`; a community id
  is appended once to `verifiedSpecsOf(claimant)`; `Verified`; `MetadataUpdate(tokenOf[claimant])` if a card exists.
  Shared: `sharedFact[factId] = (requestId, keccak256(a.answer), a.requestId, n)`; `SharedFactStored`. `verified()`
  returns the window the request was asked with (stored or derived; for 601 it must be the living window of that
  request).
- `onFailure(requestId, status, reason, agreed, answered, signature)` (status 1 refused, 2 ended without a result):
  clears the pending pair, emits `NoVerdict(requestId, traitId, status, reason, agreed, answered)`, verifies no
  signature (the plane documents none; `NoVerdict` is Intake-attributed), marks nothing. The pair may be requested
  again.
- `onResult` fits the Intake's mainnet callback stipend of 200,000 gas in the worst case (cold storage, a community
  id appended, a card to refresh), measured by a test that delivers through a mock Intake's real
  `call{gas: 200000}`; neither callback ever reverts on an envelope that decodes (a revert is a permanent
  `delivered == false` at the Intake).

### 3.5 Shared facts (kind 3: 1201 and every kind-3 community spec)

- `requestSharedFact(factId, maxPrice)` by anyone: a kind-3 id (`NotASharedFact` otherwise), not stored
  (`FactAlreadyStored`), not pending (`AlreadyPending`), one price pulled and forwarded as in 3.3, claimant zero,
  `sharedPending[factId]` set.
- `applySharedFact(factId, list)` by the wallet that wants the fact: the fact is stored (`FactNotStored`),
  `keccak256(abi.encode(list)) == answerHash` (`ListMismatch`), `msg.sender` is within the first `head` entries
  (`NotInList`), not verified yet (`AlreadyVerified`); marks `verified[msg.sender][factId] = (sharedRequestId,
  oracleRequestId, window)`, appends a community id to `verifiedSpecsOf`, emits `Verified`, refreshes the card. Gas
  only. The list is public (the `complete` transaction's calldata and the plane's served attestation).
- `sharedFact(factId)` returns `(requestId, answerHash, length)`; the registry stores a hash and a length, never a
  list.
- The stored 1201 answer of the live registry (`sharedFact(1201).answerHash =
  0xe2321ca2…2543`, 32 addresses) is the reference for the new deployment's first 1201 request: the same question
  text must produce the same list.

### 3.6 Community specs

- `registerSpec(spec, expectedId)` by anyone: `Composer.validateSpec(spec, block.number)` (the guards of
  `CATALOG.md` section 5; kind 3 additionally requires a non-anonymous event and an `address`-typed indexed grouping
  key; kinds 1 to 4 require `fromBlock <= toBlock`, at least 7,200 inclusive blocks and `toBlock <= H - 64`; kind 5
  `fromBlock == toBlock` and `toBlock + 7200 <= H`; `H` is `block.number` on chain 1 and
  `Composer.mainnetHeightBound()` elsewhere); `expectedId != 0 && expectedId != nextSpecId` reverts
  `UnexpectedSpecId(expected, next)`; pulls `SPEC_FEE` and transfers it to `burnExecutor`; stores the spec under the
  next id (`uint16`, 10001 upward, registration ends at 65,534: `registerSpec` reverts for ever once the counter is
  exhausted); emits `SpecRegistered`. A spec never changes. Kind 6 is not registrable.
- `specOf(id)` returns the stored spec; for a catalog id it returns `Composer.catalogSpec(id, curator)`; an unknown
  id reverts. A spec's class is its kind (1, 2, 4 chain; 3 shared; 5 and 6 panel).

### 3.7 Abandon

- `abandon(requestId)` at `requestedAt + ABANDON_AFTER` (31 days) or later: a personal pair by its stored claimant
  only (`NotClaimant` for anyone else); a shared fact (claimant zero) by anyone. Earlier: `TooEarly`. It clears the
  pending record and the reverse index (only if it still equals this id), emits `Abandoned`, returns no price. A late
  callback for the abandoned id is reason 1 and leaves a successor request untouched.

### 3.8 Fees

- Exactly two fees: `MINT_FEE` 0.1 IMD at `mintCard`, `SPEC_FEE` 6.4 IMD at `registerSpec`. Both are transferred in
  the same transaction from the payer to the BurnExecutor V2 `0xe29386719C155B6847aD5a4E97C6674f10ffc750`. Oracle
  prices go to the Intake. The registry's IMD balance is zero before and after every transaction it makes; it has no
  function that moves IMD it holds and no function that accepts ETH. A plain `IMD.transfer(registry, x)` by a
  stranger is lost by that stranger's choice and is not a rule of the registry.
- There is no sponsor pool, no sponsored claim, no donation, no burn rule inside the registry. The words "pool",
  "sponsor", "sponsored" and "donate" do not occur in `src/`, `test/`, `script/`, `tools/`, `web/src/`,
  `web/public/`, `CATALOG.md`, `CONCEPT.md`, `INTEGRATION.md`, `TEMPLATES.md`, `README.md` or the site's copy of the
  delivered tree; `DEPLOYMENTS.md`, `DISCLOSURE.md`, `audits/` and `docs/` keep them as the record of the earlier
  deployments. Acceptance: `grep -ril 'pool\|sponsor\|donat' src test script tools web/src web/public CATALOG.md
  CONCEPT.md INTEGRATION.md TEMPLATES.md README.md` prints nothing.

### 3.9 Constructor and dependencies

- `constructor(address curator_, address imd_, address intake_, address attester_, address renderer_, address
  composer_, address burnExecutor_)`, in this order, seven arguments, all nonzero (`ZeroAddress`), all stored in
  ordinary storage. No `idmd` argument and no `idmd` getter: the IdentityMD collection is a constant of the operator
  recipe (section 4.2), nothing else.
- Unconditional code checks: `renderer_`, `composer_` and `burnExecutor_` must have code (`DependencyHasNoCode`).
- The floor branch, kept for test chains only: when **all three** of `curator_`, `imd_` and `intake_` lack code, the
  constructor makes no external call to them; otherwise it requires `IERC20Metadata(imd_).decimals() == 18`,
  `curator.isSettled() == true` and `intake.priceOf(ACTION, imd) != 0`, and an unavailable call reverts.
- `attester` is the plane's signer; the Intake writer is not an argument (the registry trusts the Intake as
  `msg.sender` and the attester as the signer, never the writer).
- Mainnet values (`sworn-verify` reads these seven getters): curator `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91`,
  imd `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`, intake `0xa43e6F75ee006411F79Ac1C84120606C2330DE82` (Intake v2),
  attester `0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982`, renderer and composer the two helpers of the same build,
  burnExecutor `0xe29386719C155B6847aD5a4E97C6674f10ffc750`. Sepolia (11155111): the sets of `INTEGRATION.md` section 1
  without an executor requirement (a Sepolia deployment names the mocks the entrant provides).

### 3.10 What can kill it (accepted; the audit record)

`INTEGRATION.md` section 1, "What can kill the registry", stands: the Intake's owner can zero the price or lower the
callback gas, the attester can rotate, the plane can change the attestation struct or the canonical document, the
batcher or adapter behind the operator recipe can change; the registry has no remedy and a successor contract is the
answer. `DISCLOSURE.md` says so for every deployment.

## 4. Composer: templates, the canonical document, the operator recipe

### 4.1 Templates T1 to T5 and the request body

`TEMPLATES.md` is normative for the five templates and the request body; `templates/fixtures/*.json` are the exact
bodies for the catalog ids 701, 801, 1001, 1102, 1105, 1201, 1301 and the three composed examples (T2, T4, T5
community), every one of which the Composer must reproduce byte for byte from the stored parameters (sorted keys,
two-space indent, the fixture's synthetic claimant `0x…c1a1` and consumer `0x…c0de`, `vm.chainId(1)`). The kind-3
text is the one with the derived topic position (`<K>`, the 1-based position of the grouping key among the event's
indexed parameters of every type) and the no-data-field rule; 1201's fixture carries it with `contributor` = topic 1.
Panels: kinds 1, 2, 4 at 5 / 3; kinds 3, 5, 6 at 11 / 7; `validForSeconds` 2,592,000 everywhere. Every body carries
`consumer: {chainId: block.chainid, verifyingContract: <the registry, lowercase>}`; the top-level `chainId` stays 1.
Every `definitions` entry is at most 512 characters and the question at most 1,000; the longest catalog text (T3)
composes to 625 question and 398 definition bytes.

The plane's `questionHash` is `keccak256` of the RFC 8785 canonical document of `INTEGRATION.md` section 4, check 7
(`v`, `chainId`, `question`, `definitions`, `answerType`, `window.fromBlock`, `window.toBlock`, plus `head` when
present and `evidence` only when it is `panel`; `consumer`, `panelSize`, `quorum`, `validForSeconds` and
`toBlockHash` are outside it). `reference/plane/questionHashes.json` holds the plane's value and the canonical
document for the ten fixtures; a golden test proves the Composer's hash equal to each.

### 4.2 Kind 6: the operator fact, trait 601 "Swarmed"

Trait 601 is an oracle fact, sworn, not read: kind 6, catalog-only (not offered to `validateSpec`), evidence class
`panel` (archive state and logs across three contracts), panel 11 / quorum 7, answer type bool, `validForSeconds`
as the others. Family 6 keeps its name slot (the sixth family), its ring slot and its position on the hive and lights
from `hasTrait(wallet, 601)`; its class colour is the panel colour `#8ff0a4`. A `Missed` or `NoVerdict` 601 can be
requested again at once (more jobs later); 601 is a paid upgrade like every oracle id, and a wallet needs no seat at
request time (a former operator keeps the fact; every verified fact is permanent).

- **The window is living:** `fromBlock = 25,090,085` (the IdentityMD collection's creation block), `toBlock = the
  request's block.number - 64`. Two requests of the same wallet at different blocks carry different question hashes;
  the pending record stores the window and the callback compares the attestation's window with it (3.4, check 6), so
  an attestation for an earlier window of the same wallet misses with 6 or 10. `specOf(601)` returns kind 6, target
  the IdentityMD collection `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D`, `fromBlock` 25,090,085, `toBlock` 0 (0 means
  living), threshold 3, name "Swarmed".
- **The question** (the exact wording is the builder's, the meaning is not): "Up to block `<TO>` on Ethereum mainnet,
  did the wallet `<A>` operate an IdentityMD seat through at least 3 accepted Identity.md swarm jobs while it held
  that seat? Answer true or false."
- **`definitions.method`**, in this order, with these constants:
  1. *Seats held.* Every `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)` log of the
     IdentityMD collection `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` from block 25,090,085 to `<TO>` whose `from`
     or `to` is `<A>`. For each `tokenId`, the wallet's holding intervals: from the block of a transfer to `<A>`
     (inclusive) to the block of the next transfer of that token away from `<A>` (exclusive); an interval still open at
     `<TO>` ends at `<TO>` inclusive. Transfers in one block are ordered by log index.
  2. *The agent of each seat.* The `AgentBound(uint256 indexed agentId, uint8 indexed standard, address indexed
     tokenContract, uint256 tokenId, address registeredBy)` logs of the adapter `0xde152AfB7db5373F34876E1499fbD893A82dD336`
     with `tokenContract` equal to the collection and `tokenId` equal to the seat; the latest binding at or before `<TO>`.
     A seat without a binding has no agent and counts nothing.
  3. *Accepted jobs.* The `NewFeedback` logs (topic 0 `0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc`)
     of the reputation registry `0x8004baa17c55a88189ae136b182e5fda19de9b63` whose topic 1 is the agent id, whose
     topic 2 is the batcher `0xb6d0a187b050fa5bb0b87033a203f37becf4a775`, whose second data word (bytes 32 to 63) equals 1,
     and whose block lies inside one of the wallet's holding intervals of that seat.
  4. *The answer.* true when the entries of step 3, summed over every seat, number at least 3; false otherwise. A
     pruned, null or partial log read, or an endpoint without the window, is no evidence: write no answer, never false.
  The texts of `definitions.true` and `definitions.false` follow the T5 pattern of `TEMPLATES.md`; the body's
  `evidence` is `panel`, `panelSize` 11, `quorum` 7, `window` the living window, `answerType` `bool`.
- **Fixture:** `templates/fixtures/T6-operator-reference.json` holds the composed body for the synthetic claimant and
  a pinned `<TO>`, and the golden test reproduces it. The owner's cross audit of the recipe text (the third-cut
  handover, 2026-10-21) may still change a wording before this build is paid; the text above is then updated here
  first. Measured on 2026-10-21 (blocks 26,013,352 to 26,237,549): 28,328 `NewFeedback` entries by the batcher for
  952 agents, 471 rejections (second data word 0); 1,117 agents bound to seats by the adapter; 847 agents with three
  or more entries.
- `CATALOG.md` row 601: "Swarmed: ran an IdentityMD seat through at least 3 accepted swarm jobs while holding it;
  panel, T6, living window from the collection's creation block to the request block − 64; about 850 agents qualify
  (2026-10-21)".

### 4.3 Catalog specs and the name table

`catalogSpec(id, curator)` returns the `Spec` of every catalog oracle id with the curator argument as target (1301's
T5 target stays zero; 601's target is the collection), the canonical windows of `CATALOG.md` section 1
(`W_LIFE`, `W_JUDGED`, `W_FIRST1000`, `W_DEPLOY`) and the thresholds of section 3. Catalog oracle questions always
name the mainnet Curator `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` in their text, whatever the deployment chain;
the registry's `curator` argument feeds the constructor check and the direct reads. The name table is `CATALOG.md`
section 7 with 601 = **Swarmed**; `traitName` on Registry and Renderer answers it for every catalog id (community
ids answer the spec's name on the Registry); the thirteen family names are the metadata's `trait_type`s and the
card's labels.

## 5. Renderer: the card and its metadata

### 5.1 The metadata

`tokenURIOf(registry, tokenId)` returns `data:application/json;base64,<base64 of the document>`; the document's
top-level keys in this order: `name` (`Sworn #<tokenId>`), `description` (the approved text: "Sworn is an ownerless
onchain registry of verifiable wallet feats. One card per wallet; every trait is a fact about the claimant wallet
that minted the card, never about the holder. Direct-read traits are read from the settled WhitelistCurator;
chain-proven, panel-attested and shared-fact traits are attested by the IMD oracle through the Intake and verified
in the registry. Allowlists read hasTrait, never ownerOf. Facts about the wallet that minted it; direct traits frozen
at mint; transferable."), `image` (`data:image/svg+xml,<percent-encoded SVG>`; the encoded set is `% # " & space < >
?` and every byte at or above 0x80), `attributes`, `traits`, `community`, `oracle`.

- `attributes`: `{"trait_type":"Claimant","value":"<lowercase address>"}`, then one entry per family in catalog order
  with the family's name as `trait_type` and the family's top id as a decimal string or `"none"` (family 11 shows the
  lowest verified id, every other family the highest), then `{"trait_type":"community_count","value":<n>}`, then one
  `{"trait_type":"Community <id>","value":"<spec name>"}` per verified community id, the first 32 in verification
  order.
- `traits`: every true catalog id, all tiers, ascending. `community`: the first 32 verified community ids in
  verification order (`verifiedSpecsOf` returns them all).
- `oracle`: one record per verified oracle trait and per applied shared fact of the claimant: `traitId`, `template`
  (`T1` to `T6`), `evidence` (`chain` or `panel`), `fromBlock`, `toBlock` (the window the request was asked with),
  `minPanelSize`, `minQuorum` (the registry's acceptance minima, not the signed values), `requestId` (the Intake's
  id), `oracleRequestId` (the plane's signed id), `target`, `name`. The spec body stays readable through `specOf(id)`.
- Every spec string (`name`, and `item` where it is ever printed) is escaped in JSON (`"` and `\` escaped; control
  bytes, `<`, `>` and `&` as `\u00xx`) and never reaches the SVG; a hostile spec name cannot break the JSON or the
  image (escaping tests, a renderer-only hostile case).
- Integers are exact decimal digits; the document is one line without `\n` or `\r`.

### 5.2 The hive (the owner's approved design; numbers are normative, the serialisation is the builder's)

A 1000 x 1000 SVG (`viewBox 0 0 1000 1000`, system monospace font stack, no `<text>`, no `<image>`, no external
URL), background rect `#0a0a0a`. Thirteen flat-topped hexagonal cells, one per family, at the centres below
(slot offsets from `(500, 480)` with `H = 96 * sqrt(3) = 166.28`): Swarmed (family 6) at the centre `(0, 0)`; the
inner ring, clockwise from the top, Spawned `(0, -H)`, Zero-Shot `(144, -H/2)`, Hopper `(144, H/2)`, Bullfrog
`(0, H)`, Benchmarked `(-144, H/2)`, Uptime `(-144, -H/2)`; the outer ring Holdout `(144, -1.5 H)`, Final Token
`(288, 0)`, Hotfix `(144, 1.5 H)`, PID `(-144, 1.5 H)`, Top Weights `(-288, 0)`, Pretrained `(-144, -1.5 H)`. A
cell's hexagon of radius `r` has its vertices at angles 0°, 60°, … (the first vertex to the right of the centre).

Per cell, with class colour `c` (direct `#00cc33` for families 1 to 5, chain `#00ff41` for 7 to 11, shared
`#dbfee6` for 12, panel `#8ff0a4` for 6 and 13), off colour `#151515`, level `lv` = the family's tier reached
(0 none; families with several tiers count 1..n; PID counts 1 when any of its ids holds) of `n` tiers (1, 2, 3, 4, 3,
1, 1, 1, 1, 1, 1, 1, 1), and `k` = the number of community rings shown in this slot (0 to 3):

1. the outline: hexagon radius 89, `fill none`, `stroke c` when `lv > 0` else the off colour, `stroke-width 4`,
   `stroke-linejoin round`;
2. the zones: filled hexagons of radius 77 and then the shown rings' radii (62, 45, 28 for k = 1, 2, 3), `fill c`,
   with `fill-opacity` from the table by `k`: k 0 `1.00`; k 1 `0.35, 1.00`; k 2 `0.35, 0.68, 1.00`; k 3 `0.35, 0.57,
   0.78, 1.00` (outermost first); drawn whole when `lv == n`;
3. part-filled (`0 < lv < n`): the zones are clipped to the "honey" polygon, the part of the radius-77 hexagon below
   the line `y = bottom - (bottom - top) * lv / n`, and the shown rings are additionally drawn as outlines (`fill
   none`, `stroke #05751f`, `stroke-width 2`) clipped to the part of the cell above that line;
4. a white dot `r 11.0`, `fill #ffffff` at the centre when the family's top id is rare: 202, 801, 901, 1001, 1101,
   1102, 1103, 1104, 1201 (never 1105);
5. dark (`lv == 0`): the shown rings as outlines (`fill none`, `stroke #05751f`, `stroke-width 3`), no fill.

Community rings: the first 39 verified community specs light up to three rings per cell; spec 1 to 13 the outer ring
of slots 0 to 12 in slot order (centre first, then the inner ring, then the outer ring), 14 to 26 the middle ring, 27
to 39 the inner ring; `k` for a slot is the count of `d` in 0..2 with `13 d + slot < min(count, 39)`.

The frame: a hexagon of radius 440 around `(500, 480)`, `fill none`, `stroke #0c0c0c`, `stroke-width 3`. The
community path: from the fortieth spec on, a path along that frame's edges (`fill none`, `stroke #05751f`,
`stroke-width 5`, round caps and joins) starting at the frame's fifth vertex (index 4, the upper left) and running
clockwise through vertices 5, 0, 1, 2, 3 back to 4; its length in 64ths of the perimeter is `min(64,
bitlength(count^8) - 41)` for 40 <= count < 8192 (2 at 40, 9 at 70, 58 at 5,000) and 64 from 8,192 on; a partial
step ends at the interpolated point on the current edge.

Coordinates are formatted with one decimal (`f"{v:.1f}"`), polygon points as `x,y` pairs separated by spaces; the
token id, the address and the family labels are not printed on the image (they are in the metadata). Onchain there
is no trigonometry: the builder's generator (section 6) precomputes every point string once and writes it, with the
fixed markup fragments, into a Solidity library as `bytes constant` tables; the Renderer selects by index and
concatenates. Offset tables are written as ASCII hex, not packed bytes (the launch's opcode scan reads every
non-PUSH byte of the runtime and a packed `0xf2`, `0xf4` or `0xff` would read as `CALLCODE`, `DELEGATECALL` or
`SELFDESTRUCT`). The JSON envelope is likewise a `bytes constant` spliced at fixed offsets; never a constructor
argument, never an SSTORE2 pointer in an immutable (the vendored `ListRecordRenderer` does that and must not be
copied; mirror only its splice loop and golden-test method).

### 5.3 Gas

`tokenURI` at the maximum state (25 catalog traits lit, the 32-address shared answer applied, 32 verified community
specs each at the `validateSpec` maximum: `item` 256 bytes, `name`, `arg`, `fixedArg`, `sumArg` 32 bytes,
`fixedVal` and `threshold` at `uint256` max, the window at `uint64` width, every spec registered and verified through
the test Intake) is measured cold by a test and bounded: the target is 8,000,000 gas; the bound that must not be
exceeded is 10,317,448 (the live deployment's measurement). `test/NOTES.md` reports the number. Known levers: a
growable buffer, reading only what is printed, a tabled Base64 encoder.

## 6. Build, size, determinism

- `foundry.toml` as committed: solc 0.8.24, optimizer 200 runs, `evm_version = "cancun"`, `via_ir = false`,
  `bytecode_hash = "none"`, `cbor_metadata = false`, `ffi = false`, `ast = true`, `extra_output = ["storageLayout"]`;
  the `fs_permissions` list may gain the paths the builder's tests read. Nothing in `lib/` or `remappings.txt`
  changes. A clean rebuild of a commit is byte-identical, which is how the deployed runtime code is compared with the
  reviewed source after the launch (`immutableReferences` empty for all three artifacts; a test deploys twice and
  compares runtime bytes).
- **Size budget (hard).** The plane deploys the three contracts in one mainnet transaction under the 16,777,216-gas
  cap; the live build's 69,656 runtime bytes used 16,330,676 of it. The three runtimes together are at most
  **69,800 bytes**, each under EIP-170's 24,576, each init code under EIP-3860's 49,152 (the registry does not embed
  the helpers' creation code; they are deployed first and passed in). Prefer deleting over adding; `optimizer_runs`
  stays 200; `test/NOTES.md` records the three sizes and their sum, and a test pins the sum.
- Commands that must pass on a clean tree: `forge build --sizes`, `forge fmt --check`, `forge test` offline (no RPC,
  no ffi), the generator's `--check` (section 6.1), the site's `npm ci && npm test && npm run build`.

### 6.1 The generator and the goldens (the builder's)

`tools/gen_template.py` (Python 3, standard library only) is the normative drawing of section 5.2 and the source of
the envelope blob, its offsets and the hive tables under `src/`; `python3 tools/gen_template.py` regenerates them and
the goldens under `test/fixtures/`, `--check` fails on any drift. A unit test of the generator (`python3 -m unittest
discover -s tools`) asserts the tables tile with zero gap and zero overlap. Goldens are synthetic wallets only (the
`0x…c1a1` convention; never a real wallet) and cover at least: an empty hive, a single lit cell, every part-filled
tier, every rare dot, zero to three rings, no path, a short path and a six-segment path, the widest values the
renderer can meet (`tokenId` at `uint256` max, 32 community specs with a hostile name and item) and the escaping
case. `test/Goldens.t.sol` proves the Solidity output equal to each golden byte for byte and pins the step table, the
rare-dot rule and the ring counts directly.

## 7. Tests the tree must carry

Every invariant of `CONCEPT.md` section 6 has a unit, fuzz or invariant test (`fail_on_revert = true`; handlers guard
expected reverts). In addition, by name:

1. Fees: a mint raises the executor's IMD balance by exactly 0.1 IMD and leaves the registry's at zero; a
   registration by 6.4 IMD; on a mainnet fork at a pinned block `previewBridge()` on the executor reports the fee as
   pending.
2. Abandon: a stranger's `abandon` of a shared fact at day 15 reverts `TooEarly`, at day 32 succeeds and clears the
   pair; the claimant's personal abandon at day 32 succeeds; a stranger's personal abandon at day 32 reverts
   `NotClaimant`.
3. Dates: an attestation issued before the request, one issued two days after it, and one valid for 31 days each miss
   with 7 and clear the pair; one issued 23 hours after the request and valid for 30 days passes.
4. `RequestIdTaken`: a mock Intake that returns a used id makes the request revert.
5. 601: the window in the composed body equals the request block minus 64; an attestation for an earlier window of the
   same wallet misses with 6 or 10; a true verdict lights 601 and `traitsOf` lists it; `hasDirectTrait(…, 601)` is
   false for every wallet; `validateSpec` refuses kind 6.
6. Constructor: a codeless renderer, composer or executor reverts `DependencyHasNoCode` on a chain where the other
   dependencies have code and on the floor alike; the floor skips the Curator, IMD and Intake calls only when all
   three lack code; `decimals() != 18` reverts.
7. Transfers: with the mock curator, flip a membership after the mint and the card's trait stays; after `transferFrom`
   the minter's `upgrade` still lands on the card; a buyer with its own card updates only its own; a buyer without a
   card still claims facts for its own wallet and can mint later; nothing the holder calls changes `claimantOf`,
   `frozenDirect` or the minter's traits.
8. Callback: every delivery through `intake.complete` of a mock Intake v2 that forwards with the real 200,000 stipend
   and mirrors the one-completion rule; `onResult`, `onFailure`, malformed envelopes (an ABI-valid 262,144-byte
   signature or answer still ends as a miss under the stipend), the transition table of `INTEGRATION.md` section 4b,
   the diagnostic precedence, a replay (reason 1), the worst-case gas; after a `Missed` delivery `pendingOf` is zero
   and a new request for the same trait succeeds.
9. Kind 3: a decoded list shorter or longer than `head` misses with 9 and stores nothing; `applySharedFact` with a
   list that hashes right and a sender outside the head reverts `NotInList`; `registerSpec` refuses an anonymous
   kind-3 event and a non-address grouping key with `BadSpec("item")` / `BadSpec("arg")`; `event Receipt(address
   indexed account, address indexed sender, uint256 value) anonymous` grouped by `account` is the regression;
   `Transfer` grouped by `to` composes "topic 2".
10. Specs: `toBlock = block.number - 1` reverts, `block.number - 64` passes; two registrations in one block with the
    wrong `expectedId` revert, `expectedId 0` always registers; the maximal spec registers, composes and fits the body
    caps (fuzz); ids end at 65,534.
11. Composer goldens: every fixture body byte for byte; every fixture's canonical-document keccak equal to
    `reference/plane/questionHashes.json`; the T6 fixture.
12. Attestations: signature recovery over the five served attestations in `reference/attestations/` (three under the
    zero domain, two under their consumer's domain; the loader maps the JSON `answerType` name to its code and rejects
    unknown names).
13. Renderer: the goldens (6.1); the maximum-state gas (5.3); the preview path for a wallet without a card that
    the site relies on (`docs/SITE.md` row S-6) is documented in `test/NOTES.md` and exercised by a test.
14. Artifacts: all three `immutableReferences` empty; two deployments identical in runtime bytes; the three sizes under
    EIP-170 and their sum under 69,800 (pinned); no forbidden byte in the data tables.
15. Fork tests against mainnet at a pinned recent block (the real Curator, IMD, Intake v2, executor; a request
    completed by the real `complete` under the real stipend; a mint whose fee lands on the executor), behind
    `SWORN_FORK_RPC`, skipped when unset; plain `forge test` stays hermetic.
16. `test/NOTES.md`: one line per item of sections 3 to 7 with the test that pins it, the three sizes and their sum,
    the maximum-state gas, every place the builder chose between two readings of this file and why.

## 8. Deployment

`evm_contracts` on Ethereum mainnet (chainId 1) through the IMD launch pipeline, one transaction, static constructor
arguments, no token: Renderer (none), Composer (none), then Registry with `curator 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91,
imd 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7, intake 0xa43e6F75ee006411F79Ac1C84120606C2330DE82, attester
0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982, renderer $contract:Renderer, composer $contract:Composer, burnExecutor
0xe29386719C155B6847aD5a4E97C6674f10ffc750`. The pipeline allows only static address, uint, bool and bytes32
arguments, at most 16, and a passive constructor (stores, may read views, creates nothing, moves nothing, takes no
callback); its factory probe deploys the three creation codes on an empty chain with these same arguments, which is
what the floor branch of 3.9 is for. `script/Deploy.s.sol` deploys the three in that order with the chain's constants
(`deployForChain()`: Sepolia's set on 11155111, mainnet's everywhere else) and `launch.json` describes the same shape.
The deployed runtime code is compared with a clean rebuild of the reviewed commit before any address is published
(`sworn-verify`: runtime bytes, creation code, the seven decoded constructor arguments, the seven getters, name and
symbol).

The only token in this project is the ERC-721 card (name Sworn, symbol SWORN, no fixed supply: one per wallet,
never burned). Fees are paid in the existing IMD token, which this project does not create, mint or hold. No owner.

## 9. The site

`docs/SITE.md` specifies the public site (`web/`, a static Vite export, keyless, reads over public RPCs, no request
to `api.imd.fun` from the browser): principles, fixed copy, pages, the feature rows, acceptance. It is built from
nothing too, against the deployment file the workflow provides (`.imd/reads/deployment.json`), after the contracts
are live, and published by the workflow's hosting stage (IPFS under the site label, named under ENS).

## 10. Documents the builder writes

- `README.md`: what Sworn is, the status line (this deployment on Ethereum mainnet; the two earlier deployments were
  tests, never announced, no version names), the reading order, the interface summary (section 2 as built), the
  build commands, "The card image" (5.2 as built), "How to verify a card" (the third-party rerun of every recipe from
  the metadata alone, the served attestation by `oracleRequestId`, the rebuild comparison, the seven getters).
- `CATALOG.md` section 7 (the name table with Swarmed) and section 3 (row 601); `CONCEPT.md`, `INTEGRATION.md`,
  `TEMPLATES.md` (T6) brought to the delivered tree where this file changed them, without the words of 3.8.
- `DISCLOSURE.md`: a new section "Limits of this deployment" on top (the single attester; the living window's
  dependence on the batcher and adapter addresses; the oracle price per claim; the Intake's owner powers); the
  earlier sections stay as history.
- `test/NOTES.md` (7.16); `web/TEST-NOTES.md` (`docs/SITE.md`).
- `DEPLOYMENTS.md` is written by the entrant after the launch, not by the builder.

## 11. Acceptance (the entrant checks these before accepting)

1. `forge build --sizes`, `forge fmt --check`, `forge test` offline, the generator's `--check` and unit test, all green
   on a clean clone; every test of section 7 present and named in `test/NOTES.md`; the three sizes and their sum
   under the budget; the maximum-state gas reported.
2. Every fixture reproduced byte for byte; every `questionHash` equal to the plane's; the grep of 3.8 prints nothing.
3. The surface of section 2 complete; nothing of 3.9's seven arguments missing; no `immutable`, `payable`,
   `receive`, `fallback`, `tx.origin`, owner, setter or upgrade path anywhere.
4. Independent adversarial review of the delivered tree against this file (the workflow's review step), then the
   owner's cross audit (Codex) of the delivered diff before the launch; a One Dollar Audit of the new Registry after
   the launch (its dispositions in `audits/`).
5. `sworn-verify` GATE: PASS with seven getters on the three mainnet contracts; `DEPLOYMENTS.md` section written the
   same night; `site-check pages` PASS at 1280 and 390 px on the hosted site; the wallet scenarios of `docs/SITE.md`.

## 12. Provenance and decisions

This file folds in the decisions of the two earlier cuts (`docs/V2.md` and `docs/V3.md` on `main` at tag
`v3-base`) as absolute statements: from the second cut the price cap and zero-price rules, the 31-day abandon, clear
then check, exact-head kind-3 answers, `expectedId`, `totalSupply`, the unsigned `onFailure`, transferable cards with
the frozen direct snapshot, kind-3 panel 11 / 7, the finality margin, the derived topic position and the
non-anonymous rule, the shrunk community record, the tiling test, the constructor checks, no version names in public
texts; from the third cut the pool's removal and every fee burned, the permissionless shared abandon, the bounded
dates, `RequestIdTaken`, Swarmed as the kind-6 operator fact with the living window, the seven-argument constructor,
the unconditional code checks, the site rows F-28 to F-50. Kept from the beginning: ids, rules, windows, thresholds,
templates, fixtures, the questionHash document, the card model, the card design, the compiler settings. What the
earlier cuts said about regenerating owner-written tables or keeping owner-written files is void here: there are
none.

Decisions the owner took for this branch (2026-10-21), with the default applied here:

- D1 the scaffold stays (`lib/`, `foundry.toml`, `remappings.txt`, `.gitignore`, `LICENSE`): zero product lines, the
  compiler pins are musts anyway, and the plane's known-good build path needs no network for libraries;
- D2 `docs/V2.md` and `docs/V3.md` are not on this branch (they are diffs against code that is not here); this file
  is self-contained, and the cross audit checks that nothing of theirs is missing;
- D3 the question bodies stay byte-exact to the fixtures (the recipes do not change; the stored 1201 answer is the
  reference), the kind-6 text follows the third-cut audit's final wording;
- D4 the card keeps the approved design by its numbers (5.2); the SVG bytes and the goldens are the builder's;
- D5 the public surface keeps the live names and types for everything that survives the pool's removal (section 2),
  so integrators and the site keep working;
- D6 the site is rebuilt from `docs/SITE.md` with the rows marked for this build there;
- D7 one workflow (contracts, independent review, deployment, site, hosting) is the planned order; a plain contracts
  job is the fallback.
