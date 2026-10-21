# Sworn

Sworn is an ownerless registry of facts about wallets, with one transferable ERC-721 card per claimant. The collection is **Sworn / SWORN**, starts at zero supply, has no cap and has no burn function. Every fact belongs to the wallet that minted the card, even after a transfer. `hasTrait(wallet, traitId)` is the credential and requires no card.

This tree contains the independent contracts implementation for Ethereum mainnet. Nothing was deployed or broadcast in this assignment. The three earlier deployments in `DEPLOYMENTS.md` were tests, never announced. Their implementations were not inputs to this build. The public site is a subsequent stage, specified in `docs/SITE.md`.

## Reading order

1. [docs/REBUILD.md](docs/REBUILD.md), the controlling specification.
2. [CONCEPT.md](CONCEPT.md), [CATALOG.md](CATALOG.md), [TEMPLATES.md](TEMPLATES.md), [INTEGRATION.md](INTEGRATION.md).
3. `templates/fixtures/` and `reference/`: exact question bodies, canonical hashes, verified dependency interfaces, served signatures and historical evidence.
4. [test/NOTES.md](test/NOTES.md): rule coverage, storage design, measured gas, runtime sizes and decisions.
5. [DISCLOSURE.md](DISCLOSURE.md): current limits followed by historical disclosures.

## Build and check

The existing scaffold pins Solidity 0.8.24, optimizer runs 200, Cancun, no IR, no metadata hash, no CBOR and no FFI. The supplied libraries and build configuration are unchanged. No additional dependency is needed.

```sh
forge build --offline --sizes
FOUNDRY_FUZZ_SEED=0x8ce961bd394c0f2f09c24c769f68936047a69c8620d66bdac95e135b62c6ed69 forge test --offline
forge fmt --check
python3 tools/gen_template.py --check
python3 tools/build_recipe_text.py --check
python3 -m unittest discover -s tools
```

Run the two Python generators without `--check` to regenerate their files. The drawing generator independently produces the SVG and metadata goldens; the recipe generator compresses the specification text into a bounded dictionary without changing its bytes. Generated Solidity sections deliberately preserve their generator formatting.

`test/Fork.t.sol` is optional and skips when `SWORN_FORK_RPC` is absent. Set that variable to a mainnet archive RPC and run `forge test --match-contract ForkTest` for the test pinned to block 26,237,654. It exercises the real dependencies in a local fork with a test attester; it never broadcasts. The ordinary suite requires no RPC or other environment setting.

## Contract surface

| Contract | Functions |
|---|---|
| Registry | ERC-721 and ERC-4906; `mintCard`, `tokenOf`, `claimantOf`, `mintedAtBlock`, `frozenDirect`, `totalSupply`; `hasTrait`, `hasDirectTrait`, `traitsOf`, `verifiedSpecsOf`, `traitName`; `upgrade`, `abandon`, `settle`, `verified`, `pendingOf`, `pendingRequest`, `composeBody`, `attestationDigest`; `onResult`, `onFailure`; `registerSpec`, `specOf`, `nextSpecId`; `requestSharedFact`, `applySharedFact`, `sharedFact`, `sharedPending`; the seven dependency getters and fee/action constants. |
| Composer | `compose`, `catalogSpec`, `validateSpec`, `directSnapshot`, `traitsOf`, `mainnetHeightBound`, `DEPOSITED`; panel constants for cross-checking metadata. |
| Renderer | `tokenURIOf`, `traitName`. |

The signatures, tuple order, events and errors are in `docs/REBUILD.md` section 2 and the generated compiler ABIs. `Spec` and the fifteen-field `OracleAttestation` are defined in `src/interfaces/Types.sol`. The additional Registry view `renderSpec(uint16)` returns `(uint8 kind, address target, string name)`, avoiding reads of long recipe fields during rendering. Renderer also supports the specified `specOf` interface when that extra view is absent.

Minting costs 0.1 IMD; registering a community spec costs 6.4 IMD. Each fee is **forwarded to the BurnExecutor for bridging and burning on Base**, in the transaction that pulls it. Oracle questions use the existing Intake's current price, paid by the requester with an explicit `maxPrice`. `upgrade` accepts exactly one id. Approve the Registry on the existing IMD token first; there is no permit or native payment. This project creates no ERC-20.

Direct traits are free reads, frozen at mint. Paid verdicts are permanent. A refused, false, malformed or expired result clears the pending pair and permits another paid request; it provides no refund. A signed true result whose delivery failed can be submitted by anyone with `settle`. Missing results can be abandoned strictly after 31 days, by the claimant for personal facts or anyone for a shared fact. The Intake's first completion is final; its unsigned failure hook never grants a fact.

## The card image

The image is a 1000 by 1000 SVG on `#0a0a0a`, with thirteen flat-topped hexagons, no printed text and no external image. Swarmed occupies the centre; six inner and six outer cells occupy the specified positions around `(500,480)`. Outlines have radius 89, and the filled radius-77 zones use radii 62, 45 and 28 for community rings. Partial tiers clip the honey below the tier line; the unfilled region retains darker ring outlines. The nine specified rare ids add white radius-11 dots.

Direct families are `#00cc33`, chain families `#00ff41`, shared facts `#dbfee6`, and panel families `#8ff0a4`. The first 39 verified community specs add three rings in slot order. From the fortieth, a path grows clockwise around the radius-440 frame in 64 steps according to the specified bit-length formula. All geometry is precomputed in ASCII constant tables with ASCII offsets; neither helper stores state or has constructor arguments.

Metadata contains `name`, `description`, `image`, `attributes`, `traits`, `community`, `oracle`, in that order. All catalog tiers are listed; display slots use the highest tier except PID, which uses the lowest verified id. The first 32 community ids and names appear in verification order; the complete count drives the image. Strings are escaped, including apostrophes as `\u0027`. The body is a single JSON line, Base64 encoded; its SVG is percent encoded.

## How to verify a card

A rendering is not a credential. `Renderer.tokenURIOf` accepts any registry address, including a synthetic preview adapter. Verify against the canonical Registry published by the entrant after its deployment gate, and call `hasTrait` for the claimant. `ownerOf` identifies the holder, never the wallet whose facts the card describes.

For direct traits, read `claimantOf`, `mintedAtBlock` and `frozenDirect`, then rerun CATALOG's predicates against the four Curator views at that mint block. For each oracle record, read `specOf(traitId)` and `verified(claimant,traitId)`. Rerun the corresponding T1–T6 recipe over exactly the stored `fromBlock` and `toBlock`, with the stated target, arguments and threshold. For 601, use the stored window; `specOf(601).toBlock == 0` denotes a living recipe, not the already verified window. Its eight definitions specify seat holding intervals, agent bindings and accepted feedback attribution completely.

Retrieve the plane's served attestation by `oracleRequestId` (the first sixteen bytes encode the UUID), or recover it from the Intake `complete` transaction. Verify the fifteen-field EIP-712 signature in domain `IdentityMD Oracle`, version `2`, deployment chain id and the Registry's address; compare its question hash with the request event and the canonical document. The Intake request id and the signed UUID are different identifiers. For a shared fact, recover the list and compare `keccak256(abi.encode(list))` to `sharedFact` before examining membership. Archive reads must be complete; missing state is no evidence.

Finally, rebuild this reviewed source with the pinned settings and compare all three deployed runtimes byte for byte. Check the creation arguments, all seven dependency getters, `name`, and `symbol`. Empty-chain construction proves only that the launch probe can construct the contracts.

## Deployment parameters and responsibilities

Deploy Renderer, Composer and Registry in that order. Registry takes these seven ordinary-storage addresses, in order:

| Argument | Ethereum mainnet |
|---|---|
| curator | `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` |
| imd | `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` |
| intake | `0xa43e6F75ee006411F79Ac1C84120606C2330DE82` |
| attester | `0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982` |
| renderer | The Renderer deployed from this build |
| composer | The Composer deployed from this build |
| burnExecutor | `0xe29386719C155B6847aD5a4E97C6674f10ffc750` |

`script/Deploy.s.sol` has a caller-independent `deployForChain()` and a broadcast entry point `run()`. On chain 11155111 it selects Curator `0x0919ba50b206C3F31D516De818b1fBc7dA21653D`, imdTEST `0x56bcf2a5F47710649A4091219Ef0b56e2d1B58BF`, and executor `0x097A19e0f021BBA5072701132625ad2401043A2E`, with the same Intake and attester. Every other chain selects the mainnet constants. The entrant must explicitly select the intended chain and authorize any broadcast; no launch manifest or deployment record was created here.

Before launching, the entrant verifies dependency code and configuration, the settled Curator, 18 IMD decimals, a nonzero Intake price, the current signer and callback stipend, and the executor's token/OFT/destination settings. Renderer and Composer must always have code. Only when Curator, IMD and Intake all lack code does the empty-chain floor skip dependency calls and the executor code requirement.

After launch, operators monitor Intake pricing, signer or schema changes, undelivered completions, and executor configuration and delivery. Anyone may pay the executor's bridge fee; bridging and the Base action are separate asynchronous operations. The Registry has no owner, setter, pause, rescue or replacement path. Its `upgrade` function adds facts to a wallet and never changes contract code.

Off mainnet, community validation and the living window use `15,537,395 + floor((timestamp - 1,663,224,191)/12)` after that timestamp, and the anchor before it. This is an upper bound, not a head oracle; skipped slots can make it materially ahead. Check the actual mainnet head before paying for a window. The oracle price is spent even if the question cannot be answered.

## License

MIT. The existing dependency and reference licences remain with their respective files.
