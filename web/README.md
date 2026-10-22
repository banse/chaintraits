# Sworn frontend

Sworn is an ownerless Ethereum registry of facts about wallets. This Vite, React and TypeScript application reads the deployed Registry, Composer and Renderer, explores public wallet facts, mints cards, requests oracle facts and registers community specs. The finished static site is delivered in repository-root `dist/`.

## Install, check and preview

Use Node 22.12 or newer and npm 10 or newer. From the repository root:

```sh
cd web
npm ci
npx playwright install chromium webkit
node scripts/agents.mjs
npm run typecheck
npm run build
npm test
node tests/acceptance.mjs
node tests/actions.mjs
node tests/swarm-browser.mjs
node tests/followup.mjs
node tests/oracle-feed-browser.mjs
npm run preview
```

Open the URL printed by Vite. The preview serves the committed export. `npm run dev` starts the source development server. On Linux, Playwright may also need its documented browser system dependencies. Browser downloads and dependency caches belong outside Git.

`npm test` runs the unit/export checks and browser interactions. `node tests/acceptance.mjs` runs the A–E fake-chain/fake-wallet payment and RPC regressions; it never forwards a write to a network. `node tests/acceptance.mjs --webkit` runs those cases in WebKit when its system libraries are available. If `SWORN_TEST_RPC` is set, it also includes the isolated mainnet fork rehearsal; Anvil must be installed for that part. To run all checks with a public read endpoint:

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
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com npm run test:explorer-health
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com npm run test:explorer-health -- --webkit
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com npm run test:fork
npm run verify:export
npm run format:check
node scripts/check-reads.mjs https://ethereum-rpc.publicnode.com
```

The browser suite serves `dist/` below `/preview/`, checks all eight routes at five widths, validates forms, clipboard controls, wallet dialog focus, mobile links and primary WebKit interactions. With a read endpoint it also loads live wallet previews. Actual results, exact commands, review findings and limitations are recorded in [TEST-NOTES.md](TEST-NOTES.md). Machine-readable evidence is in [docs/frontend](../docs/frontend/).

The revision suite checks Claim legacy anchors and the payment dialog, Explorer request prices and same-wallet refresh stability. Set `SWORN_TEST_RPC` to include live reads and connected preparation; without it, those cases are explicitly skipped. Its read-only test wallet uses the reviewer's 1 IMD balance fixture and refuses every signing/broadcast method. `--webkit` runs the same regressions in WebKit. The unit suite also renders the unavailable-price state without inventing an amount. See [revision-results.json](../docs/frontend/revision-results.json) for reproduced defects and rechecks.

The Explorer health suite uses no wallet fixture. With `SWORN_TEST_RPC`, it checks switching the footer's Public RPC, an HTTP 503 during the actual scheduled health callback, keyboard Retry reads, scheduled recovery without a reload, and retention of rows and scroll during a successful refresh. It forwards successful JSON-RPC requests unchanged. Without a read endpoint it explicitly reports the scenarios as skipped. The current revision's before/after results are in [explorer-health-results.json](../docs/frontend/explorer-health-results.json).

## Rebuild the static export

Run `node scripts/agents.mjs` before building after changing the canonical root `agents/sworn/SKILL.md` or `llms.txt`; it copies both public resources and preserves the legacy Markdown URL with correct relative links. `npm run build` first verifies the application ABIs against `docs/abi/<Contract>.json` at the handoff's pinned Git commit, including canonical Keccak hashes. Preserve that commit in the repository history. Vite then writes `../dist/` with `base: './'`. Finally, `scripts/manifest.mjs` enumerates every exported file except the manifest itself, calculates its SHA-256 and writes `dist/imd-deployment.json`. `npm run verify:export` independently checks that enumeration and configuration. Rebuild after changing any exported file; editing an export directly leaves its manifest stale.

`deployment-handoff.json` and `network.json` are exact input snapshots for reproducible builds. At runtime, the site fetches **only the exported `imd-deployment.json`** for application contract addresses and network configuration, then loads its referenced ABI JSON files. There is no second runtime application deployment map. Dependency addresses come from the seven Registry getters. The runtime checks ABI integrity, chain ID and all three compiled runtime hashes before enabling writes. Public reads default to PublicNode, retry once and rotate through Tenderly, MEV Blocker /fast and thirdweb. Each endpoint must answer chain 1. Historical logs require independent endpoint agreement. Only an unrecovered failure is displayed; Retry reads and the next refresh can recover it.

The handoff contains no `poolKey`. The export therefore adds none. The optional ETH route's market descriptor is derived from public onchain initialization events and current liquidity; router and quoter addresses come from the unchanged network object. The route buys the exact missing IMD, caps ETH input at a ceiling of 101% of the quote, expires after 120 seconds and refunds unused ETH in the swap transaction. An expired quote or a changed oracle price requires preparation again. Every Registry operation is nonpayable; ETH goes only to the configured swap router. IMD approval appears only when the allowance is below the total. A positive short allowance is reset first; a sufficient allowance needs no new approval.

Application API reads are limited to the optional Intake admission lookup and swarm-progress feed described below. No analytics, backend, relay or project ID is needed. Browser extensions use EIP-6963 through wagmi; mobile visitors receive in-wallet links; Coinbase Wallet supplies its SDK/passkey option. RPC selection and the receipt journal are stored only in the visitor's browser. Reloading never resends a transaction, and an uncertain or replaced broadcast must be recovered before continuing.

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

[Root DESIGN.md](../DESIGN.md) documents the implemented design, including the pending notice and swarm feed. Contracts, addresses, chain, ABIs, build configuration, dependency manifests and lockfile are preserved. No publication or redeployment command is part of this delivery; the publisher hosts the completed export later under `swornbyswarm.site.identitymd.eth`.

The existing ignore files exclude generated frontend dependency, cache, coverage and browser-report directories. This revision changes no ignore file. Dependencies, package caches, downloaded browser libraries and temporary archives are excluded from the submission. No frontend dependency archive or new submodule is required. The inherited protected `lib/` Git entries are preserved.

Design guidance attribution and both upstream licenses are retained in `LICENSES/Better-Interface.txt`; the bundled wallet marks retain `LICENSES/RainbowKit.txt`.


## Current paid-action checks

Paid action entry buttons read Mint card, Mint selected facts, Mint shared fact and Mint registration. Applying a stored shared fact reads Apply shared fact; clearing an eligible pending request reads Abandon request. Preparation reads Checking… and then Ready: confirm the steps in the dialog. They open the same native dialog. It shows the current action’s amount and fee destination, balance, disclaimer and card preview when minting. A confirmed mint replaces the preview with the receipt’s card number and its Registry image. Personal and shared request receipts show “request sent, the panel answers in a few minutes” and their own feed inside the dialog. Registration retains its receipt-derived id. The next step is checked silently after the disclaimer and preceding receipt; a successful check enables its explicit signing button. A failed check displays a plain reason and Retry check. No Simulate button exists, and no check signs automatically. Every signature also requires a fresh check. A closed dialog retains the flow. Reloading preserves outcomes, expires simulations, always clears the disclaimer checkbox and treats outstanding broadcasts as uncertain until receipt recovery. Consent is never saved or restored from browser storage. No transaction is automatically resent.

The spec form starts empty. Template examples are placeholders. A kind-3 transfer/from-or-to rule is refused immediately. Every kind-3 registration and shared request recomputes the full pinned ranking before preparation and again before simulation/signing; low top-head addresses, short heads, partial logs, conflicting endpoints and changed closing blocks block payment.

Additional validation:

```sh
node --test tests/safety.test.mjs tests/skill.test.mjs
node tests/acceptance.mjs
# Opt-in read-only mainnet examples; requires cast. No transaction is sent.
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com SWORN_CAST=cast node tests/skill-live.mjs
```

`SWORN_TEST_RPC` is a test-only relay target; it is not written into the export. For environments with a read-only default npm cache, use `npm ci --cache /tmp/sworn-npm-cache`. Browser downloads, dependencies and caches stay outside Git. Current observed results and limitations take precedence over earlier historical validation entries in `TEST-NOTES.md`.


## Swarm progress and pending facts

Claim names each connected-wallet pending fact and its Registry request time at the top. Only that fact is disabled. The feed sits between the text and card above 1000px, and follows text → feed → card at smaller widths. Check swarm opens and focuses its corresponding feed while retaining the existing chain-based settlement checks.

`swarm.tsx` verifies the request’s `TraitRequested` event and uses its transaction hash for `GET https://api.imd.fun/intake/1/<tx>`. An entry whose Registry request id matches supplies `admission.result.requestId`, labelled **exact**. Any refusal (including CORS), malformed answer or read error silently falls back to `/oracle/requests?q=<claimant>` for personal facts; shared facts use the unfiltered listing. Listings carry the question and panel `jobId`, without consumer or question hash. The question is checked before loading a candidate’s detail; Registry/hash/time matching remains local to detail responses. The **oldest** candidate naming the Registry, the same question hash and `createdAt >= requestedAt` is labelled **matched**. The listing ignores consumer/questionHash filters, so matching is local. Cached identities keep an earlier match readable after it leaves the newest-100 listing; later duplicates cannot take over. A previously established exact identity survives temporary admission outages. Every personal request, including exact Intake admissions and Registry-confirmed ids, must name the connected wallet’s full address in its question, ignoring letter case. A mismatched exact or confirmed request shows “This request is not about your wallet.” with no panel answers. The question’s wallet is shortened to its first six and last four characters. Shared requests keep their existing matching path. No API-supplied link is followed, and credentials are omitted.

After delivery, a Registry `Verified` event for the same request overrides API matching. Its `oracleRequestId` holds the UUID’s first 16 bytes followed by 16 zero bytes. The feed labels this **confirmed by the Registry** and explicitly identifies the prior request when the id changes. A saved confirmed request can reconstruct its identity from the originating event and block after reload, when `pendingRequest` is cleared. Verification polls scan from that request’s block and stop scanning after confirmation. The fallback can only find candidates exposed by the service’s available listing; an older request outside that listing and not previously seen is not silently asserted to be an exact match.

Five-second polls update assessing/attested/failed status and every seat’s answer or failure reason. Before the oracle request and panel are available, the feed shows “Waiting for the swarm to pick up the request…” with a loading indicator. Unanswered seats load beside “Awaiting answer”; attested or failed panels instead show “No answer” without motion. Reduced motion disables the indicators’ animation. Boolean summaries count literal successful true/false seat answers locally, report true votes against the required quorum, and explain either true or false consensus before attestation. Other answer types retain the service’s agreement number and say “no agreement yet” when absent. Seat rows show no figures. The question previews at two rendered lines with native Show full question / Show less controls when needed; short questions have no control. A known `jobId` supplies the View on the IMD explorer link to `https://explorer.imd.fun/jobs/<jobId>` in a new tab. API results are progress information, never proof. Attestation triggers a fresh Registry lookup (`hasTrait` and the card); an independent chain poll detects delivery even during an API outage. Only chain results change proven facts. The literal “progress unavailable” state offers Retry progress; it never changes chain health or gates an action. Claim feeds and request identities are kept only for the current wallet/page session and clear on disconnect.

Run `node tests/actions.mjs` for refusal/retry/pre-signature checks across ten transaction step types and `node tests/swarm-browser.mjs` for all six requested behaviors with a fake EIP-1193 wallet, fake RPC and fake API responses. Add `--webkit` to either command when the browser's system dependencies are installed. The tests serve the production export under `/preview/`, invoke the real poll callbacks directly without a timed wait, and sign or send nothing to a network. Current results and browser limitations are in [TEST-NOTES.md](TEST-NOTES.md).

## Current follow-up validation

`node tests/followup.mjs` exercises the eight follow-up items against the production export with a fake EIP-1193 wallet, fake RPC and fake API. `--webkit` selects WebKit when its system libraries are available. No real transaction is signed or sent. `npm test` includes the oracle-selection regressions and an AST-based comparison against the original control/link/choice labels, permitting only the earlier four replacements and the three new oracle-feed link/disclosure labels.

The production build, typecheck, format check, export manifest check, 70 unit/export tests, 40 route/viewport checks, and the acceptance/action/swarm/follow-up Chromium suites passed. `node tests/oracle-feed-browser.mjs` additionally passed all 10 targeted browser groups for this seven-item change, including the result dialog, real new-tab behavior (mocked destination), keyboard disclosure, reduced motion, quorum transitions and rendered contrast. All service/RPC replies and the EIP-1193 wallet are fakes; no network transaction is signed or sent. The pinned taste probe passed 14/16 with the two existing design exceptions. WebKit launch was unavailable. Per-item observations, commands, findings and limits are in [TEST-NOTES.md](TEST-NOTES.md); they describe the current export and take precedence over historical records.
