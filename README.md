# chaintraits

An ownerless onchain registry of verifiable wallet feats on Ethereum mainnet: one transferable ERC-721 card per
wallet, traits as facts about the wallet that minted it, every trait backed by evidence anyone can rerun. Direct
reads from the settled `WhitelistCurator` (THE LIST) are free; everything else is attested by the IMD swarm through
the onchain Intake and verified in the registry's callback. `hasTrait(wallet, traitId)` needs no card.

**Status: brief, review round 2 applied (2026-10-12).** This repository is the specification the IMD swarm builds
from. There is no contract code yet beyond `src/interfaces/`. The product's name, collection symbol and trait names
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

Today `--check` and `python3 -m unittest discover -s tools` fail on purpose: the vendored generator still expects
THE LIST's goldens, which are not vendored. They pass once the builder has adapted the generator and regenerated the
goldens under `test/fixtures/`. `tools/rasterize_goldens.py` is optional (a visual aid, not a gate); it reads the
pinned font from `CHAINTRAITS_FONT` (default: the macOS Menlo path) and checks its SHA-256.

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

## How to verify a card (to be written by the builder)

Placeholder. The section explains, for one trait of one card: read `verified(claimant, traitId)`, take the window
and the template parameters from `tokenURI`, rerun the recipe (an `eth_getLogs` count, a sum, a ranking, an
`eth_call` or an `eth_getTransactionCount` at the pinned block) against two public RPCs, fetch
`/oracle/requests/<oracleRequestId>/attestation` and check its signature, and compare.

## License

MIT (`LICENSE`). The vendored THE LIST record NFT under `reference/list-record/` is MIT as well.
