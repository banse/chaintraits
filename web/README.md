# Sworn frontend

The reviewed Sworn site, updated for the attested Ethereum mainnet deployment. Source lives in `web/`, implementation-derived ABIs and evidence in `docs/`, and the complete static export in repository-root `dist/`. Hosting, naming and IPFS publication belong to the subsequent publisher stage.

## Install, build and preview

Use Node 22.12+ (validated here with Node 24) and npm:

```sh
cd web
npm ci
npm test
npm run typecheck
npm run check:abi
npm run build
npm run check:export
npm run preview
```

Vite prints the local preview address. `npm run dev` starts development mode. Run commands from `web/`. If the environment has a read-only default npm cache, pass `--cache /tmp/sworn-npm-cache` to `npm ci`; no dependency cache belongs in the repository.

The build uses a relative Vite base and writes directly to `../dist/`. It prepares deployment downloads, checks the three ABI hashes, typechecks, builds, and **then** enumerates every exported file into `dist/imd-deployment.json` with its SHA-256. Do not edit `dist/` after this step; rebuild to update the manifest. `check:export` checks the exact contract set, network, configuration keys, ABI hashes, complete asset inventory, content hashes, relative entrypoint assets and size limits. No `.imd/` input is needed to rebuild the delivered source.

`deployment-handoff.json` and `network.json` preserve the supplied handoffs. `docs/abi/<Contract>.json` contains the ABIs derived from the exact deployed source commit. `scripts/prepare.mjs` verifies these against the handoff and copies them for runtime loading. The browser fetches the exported manifest and its referenced ABI JSON before rendering. `addresses.json` and the data downloads are generated compatibility files; the application does not use them as a separate deployment map. `dependencies.json` describes the pre-existing Curator/IMD/Intake/burn/swap dependencies and compiler-verified runtime hashes.

## Reads and wallet actions

Public reads use the handoff's Ethereum RPCs, selectable in the footer. Dependency getters, chain id and all three runtime hashes are checked before signing. No browser request is made to `api.imd.fun`; attestation URLs are links a visitor may open separately.

One wallet picker supports EIP-6963 extensions, Coinbase Wallet/passkeys and four mobile in-wallet deep links. It needs no relay or project id. Wagmi stores the last authorized connector locally for reconnect; transaction intent and hashes are saved separately in session storage. Keys and signatures are not stored by this site. Each transaction requires an explicit wallet action; reload and receipt recovery never automatically resend a swap or approval.

The existing ETH payment path buys an exact IMD output via the pinned pre-existing Uniswap market, with 1% maximum-input slippage, a 30-second quote age limit and a 120-second transaction deadline. Purchases, exact approvals and Registry calls have separate confirmations. Contract simulation, receipt checks, account/chain invalidation and current-price checks protect progression between them.

See [preview details](../docs/preview.md) for the deployed Renderer's read-only state-override preview path and RPC compatibility requirement. It does not mint or deploy anything.

## Validation and design

Actual commands, results, review findings and unperformed checks are in [TEST-NOTES.md](TEST-NOTES.md). The implemented design tokens/components/responsive behavior are in [docs/DESIGN.md](../docs/DESIGN.md), under the allowed documentation scope. The root README and root build configuration are protected and unchanged.

Optional browser tooling is installed outside the repository:

```sh
npm install --prefix /tmp/sworn-browser playwright@1 @axe-core/playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/sworn-pw /tmp/sworn-browser/node_modules/.bin/playwright install chromium webkit
# From repository root:
PLAYWRIGHT_BROWSERS_PATH=/tmp/sworn-pw \
IMD_PLAYWRIGHT=/tmp/sworn-browser/node_modules/playwright/index.mjs \
SWORN_AXE_MODULE=/tmp/sworn-browser/node_modules/@axe-core/playwright/dist/index.mjs \
node web/tests/browser.mjs
```

`web/tests/live-browser.mjs` adds live Explorer and simulated-provider wallet checks; `web/tests/fork.mts` tests local-only transactions against a mainnet fork with Anvil. Optional `SWORN_RPC`/`SWORN_FORK_RPC` select an operator transport for those tests, without changing the exported public network configuration. Never point a transaction test at a funded mainnet signer. Shared-fact application still needs a real accepted attested list and is checked by ABI/unit validation rather than a fabricated mainnet verdict.

The production build emits nonfatal third-party Rollup annotation/chunk-size warnings from the wallet dependencies. Required runtime files remain bundled; dependencies, caches, browser binaries and registry archives are not part of the delivery.
