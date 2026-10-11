# chaintraits

An ownerless onchain registry of verifiable wallet feats on Ethereum mainnet: one transferable ERC-721 card per
wallet, traits as facts about the wallet that minted it, every trait backed by evidence anyone can rerun. Direct
reads from the settled `WhitelistCurator` (THE LIST) are free; everything else is attested by the IMD swarm through
the onchain Intake and verified in the registry's callback. `hasTrait(wallet, traitId)` needs no card.

**Status: built (2026-10-12) from the round-2 brief.** `src/` holds `Registry`, `Renderer`, `Composer` and the
interfaces; `test/` the hermetic suite; `script/Deploy.s.sol` the deployment. The product's name, collection symbol and trait names
are pending (2026-10-16); the code uses the working names and a single name table, so the rename touches no logic.

## Read in this order

1. `CONCEPT.md`: what it is, the card model, flows, rendering, the contracts and the eleven invariants.
2. `CATALOG.md`: the frozen v1 catalog: 25 trait slots, ids, rules, canonical block windows, populations, the
   callback acceptance rule per class, spec registration, the pool rules, the name table.
3. `TEMPLATES.md`: the five question templates and the request body; `templates/fixtures/` holds the exact bodies,
   all ten checked and quoted by the plane.
4. `INTEGRATION.md`: Intake v2 (`requestWithFailure`, `complete`, the 200,000-gas callback, the failure hook), the
   EIP-712 attestation struct and how it binds (`consumer`, `questionHash`), addresses, the Curator's views and their
   traps, the transition table.
5. `reference/`: vendored evidence (both Intakes' verified sources, ABIs, five served attestations including two for
   real consumers, the decoded mainnet completions, block headers, the plane's check and quote responses, the THE LIST
   record NFT whose card model and golden-test method this registry mirrors). `reference/PROVENANCE.md` says what each
   file is and what is only measured, not vendored.
6. `DISCLOSURE.md`.

## Interface summary (the public surface the tests pin)

```solidity
// cards
function mintCard() external returns (uint256 tokenId);                 // 0.1 IMD to the registry, once per wallet
function tokenOf(address wallet) external view returns (uint256);       // 0 = no card
function claimantOf(uint256 tokenId) external view returns (address);   // immutable
function mintedAtBlock(uint256 tokenId) external view returns (uint64); // immutable
function tokenURI(uint256 tokenId) external view returns (string memory);

// traits
function hasTrait(address wallet, uint16 traitId) external view returns (bool);   // no card needed
function traitsOf(address wallet) external view returns (uint16[] memory);        // the 25 catalog ids that are true (all tiers), no specs
function verifiedSpecsOf(address wallet) external view returns (uint16[] memory);  // every verified community spec id
function upgrade(uint16[] calldata traitIds, uint256 maxPrice) external;           // k oracle requests, k x priceOf, priceOf <= maxPrice
function abandon(bytes32 requestId) external;                                      // after 14 days
function verified(address claimant, uint16 traitId) external view
    returns (bytes32 requestId, bytes32 oracleRequestId, uint64 fromBlock, uint64 toBlock);
function pendingOf(address claimant, uint16 traitId) external view returns (bytes32 requestId);
function composeBody(uint16 traitId, address claimant) external view
    returns (bytes memory body, bytes32 questionHash);                              // the exact body and the plane's hash of it

// Intake consumer (Intake only)
function onResult(bytes32 requestId, OracleAttestation calldata a, bytes calldata signature) external;
function onFailure(bytes32 requestId, uint8 status, bytes32 reason, uint16 agreed, uint16 answered,
    bytes calldata signature) external;

// community specs
function registerSpec(Spec calldata spec) external returns (uint16 traitId);       // 1 IMD to the registry
function specOf(uint16 traitId) external view returns (Spec memory);

// shared facts
function requestSharedFact(uint16 factId, uint256 maxPrice) external;              // one price, no claimant, one pending per fact
function applySharedFact(uint16 factId, address[] calldata list) external;         // gas only; list must hash to the stored answer
function sharedFact(uint16 factId) external view returns (bytes32 requestId, bytes32 answerHash, uint16 length);

// sponsor pool (CONCEPT 4; catalog chain traits only)
function sponsor(uint256 amount) external;
function upgradeSponsored(uint256 idmdTokenId, uint16[] calldata traitIds) external; // IDMD holder, own wallet, one call per token id ever
function claimSponsored(uint16 traitId) external;                                   // from day 30, member, own wallet, once per pair
function poolUsed(address claimant, uint16 traitId) external view returns (bool);
function deployedAt() external view returns (uint64);
function pool() external view returns (uint256);                                     // = IMD.balanceOf(this)

// catalog
function traitName(uint16 traitId) external view returns (string memory);
function traitClass(uint16 traitId) external view returns (uint8);                 // 0 direct, 1 chain, 2 panel, 3 shared
```

Events: `CardMinted(address indexed claimant, uint256 indexed tokenId)`, `TraitRequested(address indexed claimant,
uint16 indexed traitId, bytes32 requestId, bytes32 questionHash)`, `Verified(address indexed claimant, uint16 indexed
traitId, bytes32 requestId, bytes32 oracleRequestId)`, `Missed(bytes32 requestId, uint16 traitId, uint8 reason)`,
`NoVerdict(bytes32 requestId, uint16 traitId, uint8 status, bytes32 reason, uint16 agreed, uint16 answered)`,
`Abandoned(bytes32 requestId)`, `SpecRegistered(uint16 indexed traitId, address indexed registrant)`,
`SharedFactStored(uint16 indexed factId, bytes32 requestId, uint16 length)`, `Sponsored(address indexed from, uint256
amount)`, `PoolSpent(address indexed claimant, uint16 indexed traitId, bytes32 requestId)`, and ERC-4906
`MetadataUpdate`.

Names in this summary are the working names. Types, arities and the behaviour described in `CONCEPT.md` are the
contract; a builder who finds a reason to change one writes it in the submission's notes rather than silently.

## Build

```sh
git clone --recursive <this repository>
forge build
forge test                       # hermetic: no RPC, no ffi
CHAINTRAITS_FORK_RPC=https://rpc.mevblocker.io forge test --match-path 'test/fork/*'   # the fork tests, pinned block
python3 tools/gen_template.py --check    # the template blob, offsets and goldens are byte-exact
```

`python3 tools/gen_template.py` regenerates `template/blob.hex`, `template/offsets.txt`, `src/TemplateData.sol` and
the goldens under `test/fixtures/`; `--check` and `python3 -m unittest discover -s tools` pass on a clean tree. The
fork tests named above are not delivered (see the deviations below).

`foundry.toml` pins solc 0.8.24, `bytecode_hash = "none"` and `cbor_metadata = false`: a clean rebuild of a commit
is byte-identical, which is how the deployed runtime code is checked against the reviewed source after launch. That
check also needs **no `immutable` anywhere**, including inherited ones (OpenZeppelin's `EIP712` base has seven; do not
inherit it, see `INTEGRATION.md` section 4). `fs_permissions` allows tests to read `template/`, `templates/fixtures/`,
`test/fixtures/`, `out/` and `reference/{attestations,intake,plane}/`. Submodules: forge-std v1.9.7 and OpenZeppelin
at `cab19933` (both as in the record NFT this mirrors).

## What the builder delivers

- `src/Registry.sol` (working name), `src/Renderer.sol`, `src/interfaces/{IIntake,IOracleConsumer}.sol`, the
  catalog as constants (ids, rules, windows from `CATALOG.md` sections 1 to 3), the name table, the template
  composer for the five templates **and the canonical question document plus its keccak** (`INTEGRATION.md` section
  4, check 7), the `Spec` struct of `CATALOG.md` section 5, no `immutable` anywhere.
- `tools/gen_template.py` adapted to the trait-grid card; `template/card.svg` redrawn; goldens under
  `test/fixtures/` for synthetic wallets only (the convention `0x…c1a1`; never a real wallet).
- Tests for every invariant in `CONCEPT.md` section 6: unit, fuzz, invariant; fork tests against the mainnet Curator
  at a pinned recent block (skipped without `CHAINTRAITS_FORK_RPC`); golden tests that `tokenURI` bytes equal the
  generator's; golden tests that the composed request bodies equal `templates/fixtures/*.json` byte for byte and that
  `questionHashOf` equals `reference/plane/questionHashes.json` for all ten; a gas test that `onResult` stays under the
  Intake's callback stipend in the worst case; signature-recovery tests over the five served attestations in
  `reference/attestations/` (three under the zero domain, two under their consumer's domain; the loader maps the JSON
  `answerType` name to its uint8 code); a test that both artifacts have empty `immutableReferences` and that two
  deployments have identical runtime code; a mock Intake v2 that forwards with the real 200,000 stipend and exercises
  `onResult`, `onFailure`, malformed envelopes and the transition table of `INTEGRATION.md` section 4b.
- A README section **"How to verify a card"**: how a third party reruns a trait's recipe against public RPCs from the
  metadata alone, fetches the served attestation by `oracleRequestId`, and compares the deployed runtime code with a
  rebuild.
- `script/Deploy.s.sol` that deploys renderer and registry with the five static addresses, plus the same shape as a
  launch-pipeline input (constructor arguments only).

## How to verify a card

A card proves facts about its **claimant** (`claimantOf(tokenId)`), never about `ownerOf`. Everything below needs
only public RPCs, the plane's public attestation endpoint and this repository. The same steps apply to
`hasTrait(wallet, traitId)` for a wallet without a card.

**1. Read the registry.** `verified(claimant, traitId)` returns `(requestId, oracleRequestId, fromBlock, toBlock)`:
a zero `requestId` means the trait was never verified. `tokenURI(tokenId)` decodes (Base64, then JSON) to a document
whose `oracle` array carries, for every verified oracle trait: `template` (T1 to T5), `evidence`, `fromBlock`,
`toBlock`, `panelSize`, `quorum`, the Intake `requestId`, the plane's `oracleRequestId`, and the recipe parameters
(`target`, `item`, `arg`, `fixedArg`, `fixedVal`, `sumArg`, `op`, `threshold`). `composeBody(traitId, claimant)`
returns the exact question the registry asked, for free.

**2. Rerun the recipe against two public RPCs** (CATALOG.md section 1 lists endpoints that served these windows;
hex block numbers, chunks of at most 1,500 blocks for `eth_getLogs`):

- T1 log-count (701, 801, 901, 1001, 1101 to 1105, T1 specs): `eth_getLogs` on `target` with `topic0 =
  keccak256(item signature)`, `topic1 = claimant` (and `topic2 = fixedVal` when `fixedArg` is set), from `fromBlock`
  to `toBlock`; the trait holds if the count is at least `threshold`.
- T2 log-sum: the same query; sum `sumArg` over the matching logs.
- T3 log-rank (1201): `eth_getLogs` for every `item` log in the window, group by `arg`, sum `sumArg`, sort
  descending by sum then ascending by address; the claimant must be within the first `threshold` (32). The list the
  registry hashed is public: it is `a.answer` in the `complete` transaction's calldata and in the served attestation;
  `sharedFact(1201)` returns `keccak256(abi.encode(list))` and its length.
- T4 call-compare: one `eth_call` of `item` with the claimant at block `toBlock`; compare with `threshold` using `op`.
- T5 panel nonce (1301, T5 specs): `eth_getTransactionCount(claimant, toBlock)` on an archive endpoint; the trait
  holds if the nonce is at least `threshold` (20 for 1301).
- Direct-read traits (101 to 601) need no attestation: call the Curator's `firstHourOf`, `txCountOf`,
  `contributedBy`, `pointsOf` or IDMD `balanceOf` at any block since settlement (601 is live and may change).

**3. Fetch and check the attestation.** `GET https://<plane>/oracle/requests/<uuid>/attestation`, where the UUID is
the first 16 bytes of `oracleRequestId` formatted `8-4-4-4-12`. Check `message.questionHash ==
keccak256(canonical document)`, where the document is the body of step 1 reduced as `INTEGRATION.md` section 4,
check 7 describes (`questionHashOf(bytes)` recomputes the keccak onchain; `reference/plane/questionHashes.json` has
ten worked examples), that `fromBlock`/`toBlock` equal step 1, that `agreed >= quorum`, and recover the signer of the
EIP-712 digest under domain `{IdentityMD Oracle, 2, 1, <registry address>}` (`attestationDigest(a)` on the registry
returns the digest; `cast wallet verify` or any EIP-712 library reproduces it). The signer must be
`0x5598aa9146215bc13eb26f2c692ad1461fd32982`.

**4. Compare the deployed code with a rebuild.** `git checkout <reviewed commit> && forge build`, then
`cast code <registry> --rpc-url <rpc>` must equal `out/Registry.sol/Registry.json` `.deployedBytecode.object`
byte for byte (likewise `Renderer` and `Composer`). `foundry.toml` pins solc 0.8.24, `bytecode_hash = "none"`,
`cbor_metadata = false`, and no contract has an `immutable`, so the comparison is exact. Then read the five addresses
(`curator()`, `idmd()`, `imd()`, `intake()`, `attester()`) and the two helpers (`renderer()`, `composer()`) from the
deployed registry and compare them with `INTEGRATION.md` section 1 and the launch record.

## What was built, and where it deviates from the brief

Everything in "What the builder delivers" is in the tree, with these deviations, each with its reason:

- **Three contracts, seven constructor arguments.** `Registry(curator, idmd, imd, intake, attester, renderer,
  composer)`. The brief allowed a sixth address if the pipeline refuses a constructor that creates a contract; here
  the limit is EIP-3860: with both helpers' creation code embedded, the registry's init code was 56,723 bytes
  (> 49,152). `Renderer` and `Composer` take no constructor arguments and hold no storage, so the launch is three
  static deployments with the helpers referenced backward (`script/Deploy.s.sol` does exactly that; the registry
  constructor calls no external contract and stores every address in ordinary storage).
- **`src/Composer.sol`** holds the five templates, the body and canonical-document serialisers, the catalog oracle
  traits as `Spec`s (`catalogSpec`), the spec guards (`validateSpec`) and the catalog name table (`traitName`). The
  registry alone was 41,717 bytes of runtime; it is now 24,072 (EIP-170 is 24,576). The registry calls the composer
  only in user transactions and views, never inside `onResult`.
- **`verified()` derives the window from the rule** instead of storing it: check 6 makes the attested window equal
  the trait's canonical window (or the spec's), so storing it would be redundant and cost a third cold slot in
  `onResult`. Worst case measured (community id appended, card to refresh, cold storage): 164,696 gas under the
  200,000 stipend, delivered through the mock Intake's real `call(stipend, ...)`.
- **Added views:** `pendingRequest(requestId)`, `cardOf(tokenId)` (the renderer's input), `attestationDigest(a)`,
  `questionHashOf(bytes canonicalDocument)`, `sharedPending(factId)`, `idmdSponsorUsed(id)`. `traitClass` and
  `specOf` revert for an unknown id; `hasTrait` never does.
- **`template/offsets` live in the code as ASCII hex**, not packed bytes: the launch's opcode scan reads every
  non-PUSH byte of the runtime, and a packed offset `0x0cf2` would read as `CALLCODE`. The template blob is ASCII.
- **Goldens:** three synthetic cards (`0x…c1a1`, `0x…ac1a1`, `0xff…c1a1`), two rendered through the registry and the
  mocks, one through the renderer alone (width and escaping). `tools/rasterize_goldens.py` and its test were removed:
  they rasterised THE LIST's goldens with a pinned macOS font and were never a gate.
- **Fork tests are not delivered.** The verifier runs without network; the mock Curator at the real address
  reproduces the views' shapes, and the fixtures and attestations vendored under `reference/` are the mainnet
  evidence the tests check against.
- The `Verified` event keeps its name; the storage struct is `VerifiedEntry`.

### Deployment parameters and operational notes

| argument | mainnet value |
|---|---|
| `curator` | `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` |
| `idmd` | `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` |
| `imd` | `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` |
| `intake` | `0xa43e6F75ee006411F79Ac1C84120606C2330DE82` (Intake v2) |
| `attester` | `0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982` |
| `renderer`, `composer` | the two helper deployments of the same commit |

There is no owner and nothing to operate: no setter, pause, upgrade, fee switch, `receive` or `fallback`. The
accepted ways the registry can stop working are listed in `INTEGRATION.md` section 1 (Intake price, callback gas or
retirement; attester rotation; a changed attestation struct or canonical document); each needs a successor contract.
Pool money is an irrevocable donation. Users approve the registry for IMD (0.1 mint, 1 per spec, `k x priceOf` per
upgrade, read at call time and capped by `maxPrice`).

## License

MIT (`LICENSE`). The vendored THE LIST record NFT under `reference/list-record/` is MIT as well.
