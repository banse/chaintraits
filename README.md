# Sworn

Sworn is an ownerless registry of wallet facts for Ethereum mainnet. Its only token is a transferable ERC-721 card, named **Sworn**, symbol **SWORN**. Supply starts at zero, is uncapped, and each wallet can mint once. Facts always describe the wallet that minted the card. `hasTrait(wallet, traitId)` is the credential and needs no card.

**Status:** the three application contracts, tests, generated artwork and ABI exports are implemented. Independent review, the launch manifest, deployment, source publication and the website belong to subsequent workflow stages. This tree asserts no new deployment address. The three earlier deployments were unannounced tests; their implementation trees were not used.

## Registry site

The current Ethereum deployment and static frontend are recorded in `dist/imd-deployment.json`. The site export is `dist/`; frontend source and its existing lockfile are in `web/`. To install, preview and rebuild with Node 22.12+:

```sh
cd web
npm ci
node scripts/agents.mjs
npm run typecheck
npm run build
npm run preview
```

Vite uses relative asset URLs and hash routes, so the export works below a static gateway path. The build verifies the pinned ABIs and writes an asset manifest. The publisher serves the committed export without rebuilding it. No server or key is required. The optional swarm-progress feed reads `https://api.imd.fun/intake/1/<request transaction hash>`, `https://api.imd.fun/oracle/requests` and request details; a failed progress read never prevents Registry reads or actions.

Run `node tests/wallet-mint-browser.mjs` from `web/` for this assignment’s ten items, `node tests/sworn-step-browser.mjs` for the previous step’s retained behavior, and `npm test` for unit/export and route checks. Payment, request and oracle-feed regressions use fake wallet/RPC/API answers; commands and actual results are in [validation](web/VALIDATION.md). See [frontend instructions](web/README.md), [current test notes](web/TEST-NOTES.md), [implemented design](DESIGN.md), [agent skill](agents/sworn/SKILL.md) and [agent index](llms.txt). The earlier contract-stage status above is historical; this contribution changes the existing frontend and does not deploy a contract.

The menu publishes Mint (`#/mint`) and Wallet (`#/wallet`); legacy URLs retain queries and anchors. Catalog hosts Explorer directly below its intro, including `#/explorer?address=…&trait=…` and the home form. The seven runtime JSON inputs retain their integrity checks. Mint and Explorer run bounded eligibility checks and hide known negatives behind a counted toggle; unknown results remain visible, as do selected facts and their advice. Mint’s direct summary lists only held facts. Wallet shows the interactive card beside its title, claimant and minted status, then full-width claimed facts: direct pairs and three-column sworn rows. Phones stack these fields. Minted wallets see a link to Wallet on Mint. The footer retains its source links without read controls. Current results and limits are in [validation](web/VALIDATION.md); historical round coverage remains in [TEST-NOTES.md](web/TEST-NOTES.md).

The nine settled-event eligibility checks now use a bundled, hash-pinned snapshot generated from two matching public mainnet reads. The manifest is [dist/data/eligibility/manifest.json](dist/data/eligibility/manifest.json); regeneration and fresh-chain verification commands are in the [frontend README](web/README.md#settled-event-eligibility-snapshot). The normal build stays offline with respect to historical logs. Run `node tests/eligibility-snapshot-browser.mjs` from `web/` for the additional fake-wallet interaction checks.

## Read in this order

1. `docs/REBUILD.md`, the approved specification.
2. `CONCEPT.md`, `CATALOG.md`, `TEMPLATES.md`, and `INTEGRATION.md`.
3. `test/NOTES.md`, which maps the requirements to checks and records decisions and measurements.
4. `docs/ABI.md` and `docs/abi/{Registry,Composer,Renderer}.json`.
5. `DISCLOSURE.md` for operational limits; `reference/` for supplied protocol evidence.
6. `docs/SITE.md` for the later website contribution.

## Build and check

The existing configuration and dependencies are unchanged: Solidity 0.8.24, optimizer 200, Cancun, no via-IR, no bytecode metadata, and no FFI. The application libraries are internal and require no linking. A clean build produces identical runtime code for every deployment.

```sh
forge build --sizes
FOUNDRY_FUZZ_SEED=0x6fa601721e66c925144dbbdb7886dc4d1952338d26407adc33353cb6eb6a4422 forge test --offline
forge fmt --check
python3 tools/gen_template.py --check
python3 -m unittest discover -s tools
python3 tools/record_generation.py --check
python3 tools/export_abi.py --check
python3 tools/run_slither.py
```

The generator and its tests use Python's standard library. `tools/slither-toolchain/` supplies a compact offline Slither 0.11.3 runtime for CPython 3.12 on Linux x86_64. The runner verifies its checksum and extracts it into a fresh temporary directory under `test/scratch/`, without pip or downloads. The detailed analyzer report goes there too. The toolchain README records the retained dependencies and packaging choices; it is optional for contract compilation.

Mainnet integration tests opt in through Forge's explicit fork arguments. With no active fork they skip, without reading or changing environment variables:

```sh
forge test --match-contract MainnetForkTest --fork-url https://rpc.mevblocker.io --fork-block-number 26237654 -vv
```

To regenerate source tables, synthetic goldens and ABIs, run `python3 tools/gen_template.py`, `forge fmt`, `forge build`, and `python3 tools/export_abi.py`. Generated table checks allow Foundry's layout changes while comparing every Solidity token and literal; golden files are compared byte for byte.

## Interfaces and funds

- `mintCard()` charges 0.1 IMD, freezes the thirteen Curator traits, and mints without a receiver callback. Transfers retain the claimant, mint block and snapshot. ERC-4906 signals metadata changes; there are no royalties.
- `upgrade([traitId], maxPrice)` asks exactly one personal question. `composeBody` previews the exact request. The current Intake price must be positive and within the caller's cap. IMD is pulled and approved for exactly that request; residual Intake allowance is cleared.
- `requestSharedFact(id, maxPrice)` purchases a kind-3 result. Its canonical list hash is stored; a listed wallet calls `applySharedFact(id, list)` for gas only.
- `registerSpec(spec, expectedId)` charges 6.4 IMD after validation. Community ids run from 10001 through 65534. An expected id of zero accepts the next id. Specs never change.
- `onResult` and `onFailure` accept only the pinned Intake. The first delivery clears pending status before verification; a miss or failure permits another paid request. Public reads hide all storage prepared for undelivered requests.
- Anyone can `settle` a valid true verdict after the Intake has completed a still-pending request. A claimant can abandon a completed personal request immediately. Otherwise abandonment requires strictly more than 31 days; a shared request can then be abandoned by anyone. No outcome refunds the Intake price.

The mint and registration fees are **forwarded to the BurnExecutor for bridging and burning on Base** in the same transaction. The Registry promises forwarding. The bridge and destination execution happen separately. The Registry accepts no ETH, has no withdrawal function, and retains no IMD from its own operations. Unsolicited transfers cannot be recovered. The fixed IMD dependency is assumed to retain its standard 18-decimal, exact-transfer behavior.

## Deployment parameters

The launch service deploys **Renderer**, then **Composer**, then **Registry**. The helpers have no constructor arguments. Registry arguments are, in order:

| Argument | Ethereum mainnet value |
|---|---|
| curator | `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` |
| imd | `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` |
| intake | `0xa43e6F75ee006411F79Ac1C84120606C2330DE82` |
| attester | `0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982` |
| renderer | the Renderer from this build |
| composer | the Composer from this build |
| burnExecutor | `0xe29386719C155B6847aD5a4E97C6674f10ffc750` |

There is no owner or admin argument. All seven addresses are ordinary storage fixed at construction. Helpers must have code. If all of Curator, IMD and Intake are codeless, the specified empty-chain rehearsal floor makes no dependency call and permits a codeless executor. Otherwise the executor must have code, the Curator must be settled, IMD must report 18 decimals and Intake must quote a positive price. Passing the rehearsal floor does not establish live readiness.

`script/Deploy.s.sol` exposes `deployForChain()` and `run()` for local rehearsal, with the supplied Sepolia constants on chain 11155111 and the mainnet constants otherwise. It reads no configuration and never broadcasts. The manifest contribution supplies `launch.json`; this source contribution does not create it.

## After launch

There are no owner settings or initialization transactions. The deployment service must compare rebuilt runtimes and all seven getters with the reviewed artifacts, then supply the confirmed contract set to the website stage. Operators monitor Intake availability, its price and callback stipend, the signer, question format and the operator recipe's three external contracts. A signer or protocol change needs a successor Registry. Users should stop paying for requests that the fixed dependencies can no longer answer.

Anyone may fund the executor's bridge transaction after inspecting its quote. Its administrator, LayerZero delivery and the Base receiver remain external responsibilities. Monitor incomplete requests and retrieve undelivered true attestations for `settle` before expiry. An independent adversarial review is still required before release; local tests and static analysis do not replace it.

## The card image

The 1000 × 1000 SVG contains thirteen flat-topped hexagonal cells, with Swarmed in the center. The catalog families occupy the specified inner and outer rings. Direct, chain, shared and panel classes have their prescribed colors. Partial tiers fill from below, rare top ids carry a white dot, the first 39 community facts add up to three rings per cell, and later facts advance the outer frame path. The image contains no text, external artwork or user-provided strings.

`tools/gen_template.py` computes every polygon, clipping shape, frame step, JSON envelope and ASCII offset table. The Renderer selects these constants; it performs no trigonometry and uses no external storage pointer. Metadata lists all true catalog tiers, the first 32 community ids in verification order, and their evidence records. `verifiedSpecsOf` returns the complete community list.

## How to verify a card

A rendering is not a credential. `Renderer.tokenURIOf` renders any supplied registry, and the image itself identifies none. Establish the authentic Registry from the deployment handoff, read `claimantOf(tokenId)`, and query that claimant's `hasTrait`. `ownerOf` only identifies the current holder.

For oracle facts, read `verified` and `specOf`. Metadata records the template, target, requested block window, exact panel requirements and both request ids. Retrieve the attestation by its `oracleRequestId`, reproduce the EIP-712 digest in this Registry's domain, and rerun the public recipe over the recorded Ethereum window. The Intake id and signed oracle id intentionally differ. A shared list is available in completion calldata and must hash to `sharedFact.answerHash`. Direct traits come from the mint-time snapshot; pre-mint previews use live Curator reads.

On chains other than Ethereum, `mainnetHeightBound()` is a timestamp-derived upper bound, not a head oracle: `15537395 + floor((timestamp - 1663224191) / 12)`, with the anchor value before that timestamp. Skipped slots make it overestimate the real head. Check actual Ethereum finality before paying for community windows. Trait 601 stores its own request window rather than recomputing it at delivery.

## License

MIT, as in `LICENSE`. Vendored libraries and the bundled analysis dependencies retain their upstream licenses.
