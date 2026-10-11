# chaintraits

An ownerless onchain registry of verifiable wallet feats on Ethereum mainnet: one transferable ERC-721 card per
wallet, traits as facts about the wallet that minted it, every trait backed by evidence anyone can rerun. Direct
reads from the settled `WhitelistCurator` (THE LIST) are free; everything else is attested by the IMD swarm through
the onchain Intake and verified in the registry's callback. `hasTrait(wallet, traitId)` needs no card.

**Status: brief.** This repository is the specification the IMD swarm builds from. There is no contract code yet
beyond `src/interfaces/`. The product's name, collection symbol and trait names are pending (2026-10-16); the code
uses the working names and a single name table, so the rename touches no logic.

## Read in this order

1. `CONCEPT.md`: what it is, the card model, flows, rendering, the contracts and the eleven invariants.
2. `CATALOG.md`: the frozen v1 catalog: 25 trait slots, ids, rules, canonical block windows, populations, the
   callback acceptance rule per class, spec registration, the name table.
3. `TEMPLATES.md`: the five question templates and the request body; `templates/fixtures/` holds the exact bodies
   that passed the plane's free check.
4. `INTEGRATION.md`: the Intake (`request`, `complete`, the 200,000-gas callback), the EIP-712 attestation struct,
   addresses, the Curator's views and their traps.
5. `reference/`: vendored evidence (the Intake's verified source, ABIs, the THE LIST record NFT whose card model and
   golden-test method this registry mirrors). `reference/PROVENANCE.md` says what each file is.
6. `DISCLOSURE.md`.

## Interface summary (the public surface the tests pin)

```solidity
// cards
function mintCard() external returns (uint256 tokenId);                 // 0.1 IMD to the pool, once per wallet
function tokenOf(address wallet) external view returns (uint256);       // 0 = no card
function claimantOf(uint256 tokenId) external view returns (address);   // immutable
function mintedAtBlock(uint256 tokenId) external view returns (uint64); // immutable
function tokenURI(uint256 tokenId) external view returns (string memory);

// traits
function hasTrait(address wallet, uint16 traitId) external view returns (bool);   // no card needed
function traitsOf(address wallet) external view returns (uint16[] memory);        // the 25 catalog ids that are true (all tiers), no specs
function verifiedSpecsOf(address wallet) external view returns (uint16[] memory);  // verified community spec ids
function upgrade(uint16[] calldata traitIds, uint256 maxPrice) external;           // k oracle requests, k x priceOf <= k x maxPrice
function abandon(bytes32 requestId) external;                                      // after 14 days
function verified(address claimant, uint16 traitId) external view returns (bytes32 requestId, uint64 fromBlock, uint64 toBlock);

// Intake consumer
function onResult(bytes32 requestId, OracleAttestation calldata a, bytes calldata signature) external; // Intake only

// community specs
function registerSpec(Spec calldata spec) external returns (uint16 traitId);       // 1 IMD to the pool
function specOf(uint16 traitId) external view returns (Spec memory);

// shared facts
function requestSharedFact(uint16 factId, uint256 maxPrice) external;              // one price, no claimant, one pending per fact
function applySharedFact(uint16 factId, address[] calldata list) external;         // gas only; list must hash to the stored answer
function sharedFact(uint16 factId) external view returns (bytes32 requestId, bytes32 answerHash);

// sponsor pool
function sponsor(uint256 amount) external;
function upgradeSponsored(uint256 idmdTokenId, uint16[] calldata traitIds) external; // IDMD holder, one call per token id ever
function payForward(address wallet, uint16 traitId) external;                        // from day 30, chain traits only, guarded (CONCEPT 4)
function deployedAt() external view returns (uint64);
function pool() external view returns (uint256);

// catalog
function traitName(uint16 traitId) external view returns (string memory);
function traitClass(uint16 traitId) external view returns (uint8);                 // 0 direct, 1 chain, 2 panel, 3 shared
```

Events: `CardMinted(address indexed claimant, uint256 indexed tokenId)`, `TraitRequested(address indexed claimant,
uint16 indexed traitId, bytes32 requestId)`, `Verified(address indexed claimant, uint16 indexed traitId, bytes32
requestId, uint8 shape)`, `Missed(bytes32 requestId, uint16 traitId, uint8 reason)`, `Abandoned(bytes32 requestId)`,
`SpecRegistered(uint16 indexed traitId, address indexed registrant)`, `SharedFactStored(uint16 indexed factId,
bytes32 requestId)`, `Sponsored(address indexed from, uint256 amount)`, and ERC-4906 `MetadataUpdate`.

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
goldens under `test/fixtures/`. `tools/rasterize_goldens.py` needs a macOS font path and is optional (a visual aid,
not a gate).

`foundry.toml` pins solc 0.8.24, `bytecode_hash = "none"` and `cbor_metadata = false`: a clean rebuild of a commit
is byte-identical, which is how the deployed runtime code is checked against the reviewed source after launch.
Submodules: forge-std v1.9.7 and OpenZeppelin at `cab19933` (both as in the record NFT this mirrors).

## What the builder delivers

- `src/Registry.sol` (working name), `src/Renderer.sol`, `src/interfaces/{IIntake,IOracleConsumer}.sol`, the
  catalog as constants (ids, rules, windows from `CATALOG.md` sections 1 to 3), the name table, the template
  composer for the five templates, the `Spec` struct of `CATALOG.md` section 5, no `immutable` anywhere.
- `tools/gen_template.py` adapted to the trait-grid card; `template/card.svg` redrawn; goldens under
  `test/fixtures/` for synthetic wallets only (the convention `0x…c1a1`; never a real wallet).
- Tests for every invariant in `CONCEPT.md` section 6: unit, fuzz, invariant; fork tests against the mainnet Curator
  at a pinned recent block (skipped without `CHAINTRAITS_FORK_RPC`); golden tests that `tokenURI` bytes equal the
  generator's; golden tests that the composed request bodies equal `templates/fixtures/*.json` byte for byte; a gas
  test that `onResult` stays under the Intake's callback stipend; signature-recovery tests over the three served
  attestations in `reference/attestations/`.
- A README section **"How to verify a card"**: how a third party reruns a trait's recipe against public RPCs from the
  metadata alone, and how to compare the deployed runtime code with a rebuild.
- `script/Deploy.s.sol` that deploys renderer and registry with the five static addresses, plus the same shape as a
  launch-pipeline input (constructor arguments only).

## How to verify a card (to be written by the builder)

Placeholder. The section explains, for one trait of one card: read `verified(claimant, traitId)`, take the window
and the template parameters from `tokenURI`, rerun the recipe (an `eth_getLogs` count, a sum, a ranking, an
`eth_call` or an `eth_getTransactionCount` at the pinned block) against two public RPCs, and compare.

## License

MIT (`LICENSE`). The vendored THE LIST record NFT under `reference/list-record/` is MIT as well.
