# Sworn

Sworn (collection symbol `SWORN`) is an ownerless onchain registry of verifiable wallet feats on Ethereum mainnet:
one transferable ERC-721 card per wallet, traits as facts about the wallet that minted it, every trait backed by
evidence anyone can rerun. Direct reads from the settled `WhitelistCurator` (THE LIST) are free and frozen on the
card at mint; everything else is attested by the IMD swarm through the onchain Intake and verified in the
registry's callback; every fee the registry takes is burned through the IMD BurnExecutor V2. `hasTrait(wallet,
traitId)` needs no card.

**This branch holds the specification, not the code.** The product is built from it by the Identity.md swarm, every
line: contracts, tests, goldens, generator, deployment script, site. The two earlier deployments (2026-10-18 and
2026-10-20, `DEPLOYMENTS.md`) were tests, never announced; their trees are on the `main` branch and are not an input
of this build.

## Read in this order

1. `docs/REBUILD.md`: the complete specification, self-contained on every rule; what is given and what the builder
   writes; the public surface; the registry rules; the Composer and the operator recipe; the card; build, size and
   determinism; the tests; the deployment; the documents; acceptance.
2. `CONCEPT.md`: what it is, the card model, the flows, rendering, the contracts and the invariants.
3. `CATALOG.md`: the frozen catalog: 25 trait slots, ids, rules, canonical block windows, populations, the callback
   acceptance rule per class, spec registration, fees, the name table.
4. `TEMPLATES.md`: the question templates and the request body; `templates/fixtures/` holds the exact bodies.
5. `INTEGRATION.md`: Intake v2, the EIP-712 attestation and how it binds, addresses, the Curator's views, the
   transition table.
6. `docs/SITE.md`: the public site; `docs/DESIGN.md` the look of the earlier site.
7. `reference/`: vendored evidence (`reference/PROVENANCE.md` says what each file is).
8. `DISCLOSURE.md`, `DEPLOYMENTS.md`, `audits/`: the record of the earlier deployments.

## Build (what the delivered tree must pass)

```sh
git clone --recursive <this repository>
forge build --sizes
forge test                               # hermetic: no RPC, no ffi
forge fmt --check
python3 tools/gen_template.py --check    # the builder's generator: tables and goldens byte-exact
SWORN_FORK_RPC=<mainnet archive RPC URL> forge test --match-path 'test/fork/*'
cd web && npm ci && npm test && npm run build
```

`foundry.toml` pins solc 0.8.24, optimizer 200 runs, cancun, `bytecode_hash = "none"`, `cbor_metadata = false`: a
clean rebuild of a commit is byte-identical, which is how the deployed runtime code is checked against the reviewed
source after launch. Submodules: forge-std v1.9.7 and OpenZeppelin at `cab19933`.

## License

MIT (`LICENSE`). The vendored THE LIST record NFT under `reference/list-record/` is MIT as well.
