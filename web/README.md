# Sworn frontend

Sworn is an ownerless Ethereum registry of facts about wallets. This Vite, React and TypeScript application reads the deployed Registry, Composer and Renderer, explores public wallet facts, mints cards, requests oracle facts and registers community specs. The finished static site is delivered in repository-root `dist/`.

## Install, check and preview

Use Node 22.12 or newer and npm 10 or newer. From the repository root:

```sh
cd web
npm ci
npx playwright install chromium webkit
npm run typecheck
npm test
npm run build
npm run preview
```

Open the URL printed by Vite. The preview serves the committed export. `npm run dev` starts the source development server. On Linux, Playwright may also need its documented browser system dependencies. Browser downloads and dependency caches belong outside Git.

`npm test` runs the unit/export checks and browser interactions. If `SWORN_TEST_RPC` is set, it also includes the isolated mainnet fork rehearsal; Anvil must be installed for that part. To run all checks with a public read endpoint:

```sh
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com npm test
```

The fork uses impersonation of public contributors inside Anvil, with no private key and no mainnet broadcasts. Its browser wallet is explicitly a test provider. The shared-answer application fixture is identified separately from the real contract transactions.

Additional commands:

```sh
npm run test:unit
npm run test:browser
npm run test:revision
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com npm run test:revision -- --webkit
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com npm run test:fork
npm run verify:export
npm run format:check
node scripts/check-reads.mjs https://ethereum-rpc.publicnode.com
```

The browser suite serves `dist/` below `/preview/`, checks all eight routes at five widths, validates forms, clipboard controls, wallet dialog focus, mobile links and primary WebKit interactions. With a read endpoint it also loads live wallet previews. Actual results, exact commands, review findings and limitations are recorded in [TEST-NOTES.md](TEST-NOTES.md). Machine-readable evidence is in [docs/frontend](../docs/frontend/).

The revision suite checks Claim acknowledgement and journal links, Explorer request prices and same-wallet refresh stability. Set `SWORN_TEST_RPC` to include live reads and connected preparation; without it, those cases are explicitly skipped. Its read-only test wallet uses the reviewer's 1 IMD balance fixture and refuses every signing/broadcast method. `--webkit` runs the same regressions in WebKit. The unit suite also renders the unavailable-price state without inventing an amount. See [revision-results.json](../docs/frontend/revision-results.json) for reproduced defects and rechecks.

## Rebuild the static export

`npm run build` first verifies the application ABIs against `docs/abi/<Contract>.json` at the handoff's pinned Git commit, including canonical Keccak hashes. Preserve that commit in the repository history. Vite then writes `../dist/` with `base: './'`. Finally, `scripts/manifest.mjs` enumerates every exported file except the manifest itself, calculates its SHA-256 and writes `dist/imd-deployment.json`. `npm run verify:export` independently checks that enumeration and configuration. Rebuild after changing any exported file; editing an export directly leaves its manifest stale.

`deployment-handoff.json` and `network.json` are exact input snapshots for reproducible builds. At runtime, the site fetches **only the exported `imd-deployment.json`** for application contract addresses and network configuration, then loads its referenced ABI JSON files. There is no second runtime application deployment map. Dependency addresses come from the seven Registry getters. The runtime checks ABI integrity, chain ID and all three compiled runtime hashes before enabling writes. It shows read failures and can recover with Retry reads or the next refresh.

The handoff contains no `poolKey`. The export therefore adds none. The optional ETH route's market descriptor is derived from public onchain initialization events and current liquidity; router and quoter addresses come from the unchanged network object. The route buys the exact missing IMD, caps ETH input at a ceiling of 101% of the quote, expires after 120 seconds and refunds unused ETH in the swap transaction. An expired quote or a changed oracle price requires preparation again. Every Registry operation is nonpayable; ETH goes only to the configured swap router. IMD approvals are exact amounts and reset an existing different allowance first.

No runtime connection to an application API, analytics, backend, relay or project ID is needed. Browser extensions use EIP-6963 through wagmi; mobile visitors receive in-wallet links; Coinbase Wallet supplies its SDK/passkey option. RPC selection and the receipt journal are stored only in the visitor's browser. Reloading never resends a transaction, and an uncertain or replaced broadcast must be recovered before continuing.

## Regenerate derived assets

The checked-in layout and art make a normal build offline with respect to chain reads after dependencies have been installed. For deliberate regeneration against the pinned source and deployed contracts:

```sh
npm run derive:storage
node scripts/read-live.mjs https://ethereum-rpc.publicnode.com
node scripts/select-market.mjs https://ethereum-rpc.publicnode.com
node scripts/generate-art.mjs https://ethereum-rpc.publicnode.com
npm run art:share
npm run build
```

The compiler script uses Solidity 0.8.24 with the protected repository compiler settings and reads dependencies without changing them. It derives preview mapping slots and runtime hashes; `--check` compares the delivered data without editing it. Temporary compilation and verification files go under `test/scratch/`, which is not a build input or deliverable. A fresh fork test regenerates its compilation fixture there when necessary.

`generate-art.mjs` calls the deployed Renderer with a Registry code override supplying labelled synthetic illustrations. It writes the sample and 25 mini SVGs and extracts their cell geometry. Live Explorer previews instead call the authentic contracts with a compiler-derived state override for an unminted wallet. A minted wallet uses its own `tokenURI`. No runtime metadata is fabricated or substituted when a read fails.

## Delivery and design

The eight routes use hash navigation and same-origin relative assets. Static `index.html` deliberately has title `swornbyswarm`; after rendering, each tab reads `Sworn | <page>`. The local PNG share image, favicon and social metadata are included.

The assignment's write budget is `web/**`, `dist/**`, `docs/**` and the single explicit ignore path `web/.gitignore`. [docs/DESIGN.md](../docs/DESIGN.md) contains the implemented design record; a root `DESIGN.md` is outside that overriding budget. Root README, build configuration, contracts and dependencies were preserved. No publication or redeployment command is part of this delivery; the publisher hosts the completed export later.

The only changed ignore file is `web/.gitignore`; it excludes generated frontend dependency, cache, coverage and browser-report directories at nested locations. Dependencies, package caches, downloaded browser libraries and temporary archives are excluded from the submission. No frontend dependency archive or new submodule is required. The inherited protected `lib/` Git entries are preserved.

Design guidance attribution and both upstream licenses are retained in `LICENSES/Better-Interface.txt`; the bundled wallet marks retain `LICENSES/RainbowKit.txt`.
