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
node tests/layout-refinement-browser.mjs
node tests/site-refresh-browser.mjs
node tests/correction-browser.mjs
npm test
node tests/acceptance.mjs
node tests/actions.mjs
node tests/swarm-browser.mjs
node tests/followup.mjs
node tests/oracle-feed-browser.mjs
node tests/personal-facts-browser.mjs
npm run preview
```

Open the URL printed by Vite. The preview serves the committed export. `npm run dev` starts the source development server. On Linux, Playwright may also need its documented browser system dependencies. Browser downloads and dependency caches belong outside Git.

`node tests/layout-refinement-browser.mjs` checks this assignment’s eleven items: all routes/aliases at 1280/390px, connected/disconnected, exact Mint content, footer geometry, separator pairs, heading hierarchy, source URLs, conditional disclosure and busy-dialog navigation. `node tests/site-refresh-browser.mjs` retains 14 previous-refresh scenario groups. Both use fake wallet/RPC/API answers. `node tests/correction-browser.mjs` tests each of the nine earlier correction items on the production export with fake EIP-1193, RPC and API replies. It also tests Close/currency changes during an unanswered wallet request, ignored late success/rejection, and saved sent receipts after reload. `--only=4a` selects a case prefix and `--webkit` selects WebKit. `npm test` runs the unit/export checks and browser interactions. `node tests/acceptance.mjs` runs the A–E fake-chain/fake-wallet payment and RPC regressions; it never forwards a write to a network. `node tests/acceptance.mjs --webkit` runs those cases in WebKit when its system libraries are available. If `SWORN_TEST_RPC` is set, it also includes the isolated mainnet fork rehearsal; Anvil must be installed for that part. To run all checks with a public read endpoint:

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

The browser suite serves `dist/` below `/preview/`, checks nine canonical routes and two aliases at five widths, validates forms, clipboard controls, wallet dialog focus, mobile links and primary WebKit interactions. With a read endpoint it also loads live wallet previews. Actual results, exact commands, review findings and limitations are recorded in [TEST-NOTES.md](TEST-NOTES.md). Machine-readable evidence is in [docs/frontend](../docs/frontend/).

The revision suite checks Mint legacy anchors and the payment dialog, Explorer request prices and same-wallet refresh stability. Set `SWORN_TEST_RPC` to include live reads and connected preparation; without it, those cases are explicitly skipped. Its read-only test wallet uses the reviewer's 1 IMD balance fixture and refuses every signing/broadcast method. `--webkit` runs the same regressions in WebKit. The unit suite also renders the unavailable-price state without inventing an amount. See [revision-results.json](../docs/frontend/revision-results.json) for reproduced defects and rechecks.

The Explorer health suite uses no wallet fixture. With `SWORN_TEST_RPC`, it checks switching the footer's Public RPC, an HTTP 503 during the actual scheduled health callback, keyboard Retry reads, scheduled recovery without a reload, and retention of rows and scroll during a successful refresh. It forwards successful JSON-RPC requests unchanged. Without a read endpoint it explicitly reports the scenarios as skipped. The current revision's before/after results are in [explorer-health-results.json](../docs/frontend/explorer-health-results.json).

## Rebuild the static export

Run `node scripts/agents.mjs` before building after changing the canonical root `agents/sworn/SKILL.md` or `llms.txt`; it copies both public resources and preserves the legacy Markdown URL with correct relative links. `npm run build` first verifies the application ABIs against `docs/abi/<Contract>.json` at the handoff's pinned Git commit, including canonical Keccak hashes. Preserve that commit in the repository history. Vite then writes `../dist/` with `base: './'`. Finally, `scripts/manifest.mjs` enumerates every exported file except the manifest itself, calculates its SHA-256 and writes `dist/imd-deployment.json`. `npm run verify:export` independently checks that enumeration and configuration. Rebuild after changing any exported file; editing an export directly leaves its manifest stale.

`deployment-handoff.json` and `network.json` are exact input snapshots for reproducible builds. `src/runtime-assets.ts` bundles their application configuration, the five public ABI JSON files and `public/data/renderer-preview.json`. The configuration is derived from the same inputs as `scripts/manifest.mjs`; there is no startup fetch waterfall. `runtime-integrity.mjs` still checks the network, ABI paths, all three canonical ABI hashes and preview source. The existing live chain ID, bytecode and dependency checks still precede writes. The downloadable `imd-deployment.json` and ABI/preview copies remain in the export. The runtime-input test compares their values. Public reads retain the unchanged PublicNode, Tenderly, MEV Blocker /fast and thirdweb pool, chain checks, cooldown and independent agreement for historical logs. Retry reads remains available in the footer bottom row.

The handoff contains no `poolKey`. The export therefore adds none. The optional ETH route's market descriptor is derived from public onchain initialization events and current liquidity; router and quoter addresses come from the unchanged network object. The route buys the exact missing IMD, caps ETH input at a ceiling of 101% of the quote, expires after 120 seconds and refunds unused ETH in the swap transaction. An expired quote or a changed oracle price requires preparation again. Every Registry operation is nonpayable; ETH goes only to the configured swap router. IMD approval appears only when the allowance is below the total. A positive short allowance is reset first; a sufficient allowance needs no new approval.

Application API reads are limited to the optional Intake admission lookup and swarm-progress feed described below. No analytics, backend, relay or project ID is needed. Browser extensions use EIP-6963 through wagmi; mobile visitors receive in-wallet links; Coinbase Wallet supplies its SDK/passkey option. RPC selection and the receipt journal are stored only in the visitor's browser. Reloading never resends a transaction, and an uncertain or replaced broadcast must be recovered before continuing.

## Settled-event eligibility snapshot

The nine settled curator catalog facts (701, 801, 901, 1001 and 1101–1105) use only `data/eligibility/` in the static export. A wallet loads one shard, verifies its SHA-256 and byte length against the bundle's generated pin, and reads exact counts for all nine facts. Missing wallets have zero matches. A missing or corrupt file gives the existing advisory warning for that check; it does not block the ordinary paid request or trigger an RPC fallback. Facts 601 and 1301 and community rules retain their existing live checks.

To regenerate from Ethereum mainnet, run from the repository root after `cd web && npm ci`:

```sh
node web/scripts/snapshot-eligibility.mjs --rpc https://gateway.tenderly.co/public/mainnet --rpc https://rpc.mevblocker.io/fast
cd web
npm run typecheck
npm run build
node tests/eligibility-snapshot-browser.mjs
npm run verify:export
```

The generator reads the deployed Registry specs and compares every historical log range on two public endpoints before emitting anything. With a single `--rpc URL` it makes two separate reads per range. It validates chain 1, the closing block, exact event totals and all FirstDeposit indices, and fails closed on discrepancies. Public limits can change: supply other keyless Ethereum URLs using repeated `--rpc` flags. No credential is required. Endpoint provenance/range partitions can differ across runs; sorted shard contents and hashes must reproduce identically. A fresh `--check` run compares the committed counts and hashes without rewriting them.

The manifest records every spec/window/filter, event/fact totals, comparison digests, generator command and shard hashes. The bundle also pins the manifest's own hash. Source data lives in `web/public/data/eligibility/`, and Vite copies it to `dist/data/eligibility/`. The whole snapshot is 333,945 bytes; each wallet shard is at most 22,104 bytes. A normal build performs no historical chain read.

For an independent all-wallet count comparison, retain the generator's raw compared logs in scratch:

```sh
node web/scripts/snapshot-eligibility.mjs --rpc https://gateway.tenderly.co/public/mainnet --rpc https://rpc.mevblocker.io/fast --check --raw test/scratch/eligibility-mainnet-recheck.json
node web/tests/verify-snapshot-read.mjs test/scratch/eligibility-mainnet-recheck.json
```

`npm run test:unit` includes snapshot integrity, refused-RPC, exact counts, failures and deadline tests. `node tests/eligibility-snapshot-browser.mjs` checks actual rows/dialogs with real snapshot files, a fake EIP-1193 wallet and fake RPC answers. It never signs or broadcasts. See [TEST-NOTES.md](TEST-NOTES.md) for current results, the six-domain design review, all deleted paths and browser limitations.

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

The six canonical routes and their aliases use hash navigation and same-origin relative assets. Static `index.html` deliberately has title `swornbyswarm`; after rendering, each tab reads `Sworn | <page>`. The local PNG share image, favicon and social metadata are included.

[Root DESIGN.md](../DESIGN.md) documents the implemented design, including the pending notice and swarm feed. Contracts, addresses, chain, ABIs, build configuration, dependency manifests and lockfile are preserved. No publication or redeployment command is part of this delivery; the publisher hosts the completed export later under `swornbyswarm.site.identitymd.eth`.

The existing ignore files exclude generated frontend dependency, cache, coverage and browser-report directories. This revision changes no ignore file. Dependencies, package caches, downloaded browser libraries and temporary archives are excluded from the submission. No frontend dependency archive or new submodule is required. The inherited protected `lib/` Git entries are preserved.

Design guidance attribution and both upstream licenses are retained in `LICENSES/Better-Interface.txt`; the bundled wallet marks retain `LICENSES/RainbowKit.txt`.


## Current paid-action checks

Paid action entry buttons read Mint card, Mint selected facts, Mint this fact and Mint registration. Applying a stored shared fact reads Apply shared fact; clearing an eligible pending request reads Abandon request. Preparation reads Checking… and then Ready: confirm the steps in the dialog. They open the same native dialog. It shows the current action’s amount and fee destination, balance, disclaimer and card preview when minting. A confirmed mint replaces the preview with its receipt-derived card number; Wallet shows its Registry image. Personal and shared request receipts show “request sent, the panel answers in a few minutes”. The dialog directs progress to Wallet with its named navigation button. Registration retains its receipt-derived id. The next step is checked silently after the disclaimer and preceding receipt; a successful check enables its explicit signing button. A failed check displays a plain reason and Retry check. No Simulate button exists, and no check signs automatically. Every signature also requires a fresh check. A closed dialog retains the flow. Reloading preserves outcomes, expires simulations, always clears the disclaimer checkbox and treats outstanding broadcasts as uncertain until receipt recovery. Consent is never saved or restored from browser storage. No transaction is automatically resent.

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

Catalog contains Explorer immediately below its intro. `#/explorer?address=…&trait=…` and the home address form open it with that wallet loaded. Mint keeps Mint Card, Mint facts, its combined fact picker and existing pending notice/feed. Why add facts after minting? and its four links sit directly below the Mint facts intro and run into 01 without a rule. Step 02 places the payment group below the panel/quorum paragraph and ends with the pending Swarm progress feed when the wallet has a pending fact. Publish `#/mint` and `#/wallet`; legacy `#/claim` and `#/wallet-facts` aliases preserve queries and anchors.

The transaction dialog keeps its cost, consent, simulation, receipt and recovery controls. Oracle feeds and minted-card updates now live on Wallet, reached with Follow progress on the Wallet page. Wallet reads the connected claimant’s current Registry card and detailed facts: card right/facts left on desktop, card first on phones. The first 39 community rings follow Renderer slots. Selecting a non-empty cell toggles every corresponding held fact; empty cells do nothing. The no-card layout stays as before. Pending personal requests and this connected preparer’s receipt-backed shared requests use the existing oracle feed; independent Registry polling refreshes the card/facts after delivery. Completed requests leave the pending feed. Saved receipts remain reviewable after reload.

Non-Catalog fact tables start with known negative/impossible facts hidden and retain unknowns. Each table has one counted show/hide control; Catalog’s listing remains complete. Minted facts display attestation UTC time, or a direct card’s mint block/time. Attestation record failures retain an explicit unavailable state and bounded retry. Public RPC and Retry reads are right-aligned in the footer’s bottom row on every route.

`swarm.tsx` verifies the request’s `TraitRequested` event and uses its transaction hash for `GET https://api.imd.fun/intake/1/<tx>`. An entry whose Registry request id matches supplies `admission.result.requestId`, labelled **exact**. Any refusal (including CORS), malformed answer or read error silently falls back to `/oracle/requests?q=<claimant>` for personal facts; shared facts use the unfiltered listing. Listings carry the question and panel `jobId`, without consumer or question hash. The question is checked before loading a candidate’s detail; Registry/hash/time matching remains local to detail responses. The **oldest** candidate naming the Registry, the same question hash and `createdAt >= requestedAt` is labelled **matched**. The listing ignores consumer/questionHash filters, so matching is local. Cached identities keep an earlier match readable after it leaves the newest-100 listing; later duplicates cannot take over. A previously established exact identity survives temporary admission outages. Every personal request, including exact Intake admissions and Registry-confirmed ids, must name the claimant from its `TraitRequested` event in its question, ignoring letter case. This works in Explorer without a connected wallet. A mismatched detail shows “This request is not about this wallet.” and “Expected wallet: <claimant>”, shortened to its first six and last four characters, with no panel answers. Other question addresses, including the Curator, are never labelled as the wallet. Shared requests keep their existing matching path. No API-supplied link is followed, and credentials are omitted.

After delivery, a Registry `Verified` event for the same request overrides API matching. Its `oracleRequestId` holds the UUID’s first 16 bytes followed by 16 zero bytes. The feed labels this **confirmed by the Registry** and explicitly identifies the prior request when the id changes. A saved confirmed request can reconstruct its identity from the originating event and block after reload, when `pendingRequest` is cleared. Outcome polls scan from that request’s block for Verified, Missed, NoVerdict and Abandoned and stop scanning after the matching request outcome. The feed reports the Registry result even if the optional progress API fails. The fallback can only find candidates exposed by the service’s available listing; an older request outside that listing and not previously seen is not silently asserted to be an exact match.

Five-second polls update assessing/attested/failed status and every seat’s answer or failure reason. Before the oracle request and panel are available, the feed shows “Waiting for the swarm to pick up the request…” with a loading indicator. Unanswered seats load beside “Awaiting answer”; attested or failed panels instead show “No answer” without motion. Reduced motion disables the indicators’ animation. Boolean summaries count literal successful true/false seat answers locally, report true votes against the required quorum, and explain either true or false consensus. Kind 1/2 summaries instead count successful integer answers at or above the live spec threshold, even when their values differ. Quorum messages remain through attestation until the request’s Registry event arrives. List answers report their length, agreement with the attested list (or the most common list before attestation), and the connected wallet’s rank, with Show list / Hide list revealing every address. Other answer types retain the service’s agreement number and say “no agreement yet” when absent. Seat rows show no figures. The question previews at two rendered lines with native Show full question / Show less controls when needed; short questions have no control. A known `jobId` supplies the View on the IMD explorer link to `https://explorer.imd.fun/jobs/<jobId>` in a new tab and survives later discovery of that same oracle request through a detail that omits the job id. API results are progress information, never proof. Attestation triggers a fresh Registry lookup (`hasTrait` and the card); an independent chain poll detects delivery even during an API outage. Only chain results change proven facts. The literal “progress unavailable” state offers Retry progress; it never changes chain health or gates an action. Pending feeds and request identities are scoped to the current connected wallet/page and clear on disconnect.

Run `node tests/actions.mjs` for refusal/retry/pre-signature checks across ten transaction step types and `node tests/swarm-browser.mjs` for all six requested behaviors with a fake EIP-1193 wallet, fake RPC and fake API responses. Add `--webkit` to either command when the browser's system dependencies are installed. The tests serve the production export under `/preview/`, invoke the real poll callbacks directly without a timed wait, and sign or send nothing to a network. Current results and browser limitations are in [TEST-NOTES.md](TEST-NOTES.md).

## Personal fact advice and request history

Selecting a personal fact and opening its payment dialog each reads `specOf(id)` and checks public chain data. Kinds 1/2 scan inclusive event windows in chunks of at most 2,000 blocks, filtering the claimant and fixed field and counting or summing raw integers. Provider caps or range refusals shrink the chunk; incomplete reads are not treated as a negative answer. Kind 5 reads the wallet nonce at the exact historical block (1301: 25,769,870). Kind 4 calls the named view at the last block and applies the spec comparison. For 601, this is only the requested seat prerequisite: a Transfer to the wallet from the catalog's collection starting at 25,090,085, stopping at the first receipt. Finding a seat does not establish three accepted jobs; the advisory text says those still need the panel's check.

Row and dialog share the current check result. A known negative row is hidden by default; use its table’s counted control to inspect or request it explicitly. A negative result includes the live request price and needs the separate **Request anyway** confirmation after the ordinary payment acknowledgement, before any approval or paid-action signature. Failure or a 20-second deadline produces the prescribed not-checkable advice and permits the normal flow. Results never establish a credential; the checker uses the public client and never calls the wallet. A late response cannot resume a timed-out scan. Previously failed requests appear on their personal fact row, joined to this wallet by the originating `TraitRequested` request id. The displayed UTC minute is the request block's timestamp, not the later result block's time. A newer request or a proven fact suppresses the old failure.

## Current Mint and Wallet validation

After building, run these deterministic suites from `web/`. They serve `dist/` below `/preview/` and use fake EIP-1193 wallets, RPC and API answers; no real transaction is signed or sent.

```sh
npm test
node tests/site-refresh-browser.mjs
node tests/site-review-browser.mjs
node tests/site-update-browser.mjs
node tests/round8-browser.mjs
node tests/round8-revision-browser.mjs
node tests/personal-facts-browser.mjs
node tests/eligibility-snapshot-browser.mjs
node tests/acceptance.mjs
node tests/actions.mjs
node tests/followup.mjs
node tests/swarm-browser.mjs
node tests/oracle-feed-browser.mjs
npm run verify:export
npm run format:check
```

`site-update-browser.mjs` checks record serialization/recovery/four-attempt exhaustion, canonical and legacy routes, progress placement, measured preview/button columns, automatic launch fallback, old stored-list application, mixed shared/personal selection, shared pending rows and hour-64 hover/focus/tap. `personal-facts-browser.mjs --group=N` selects one of 15 scenario groups, including retained round-7 consent, identity and history checks. `round7.test.mjs` and `rpc-deadline.test.mjs` cover endpoint cooldown, fresh heads, first terminal outcomes, deadline/page cancellation and mixed-refusal splitting rules.

`site-review-browser.mjs` checks every shared row’s loaded preview at 1280/390px, SVG escaping and common column alignment, pointer travel onto the hour tooltip at 320/390/1440px, delayed canonical/legacy community anchors, and navigation cancellation. It serves `dist/` below `/preview/` with fake wallet/RPC/API fixtures and sends no signatures or transactions. Add `--webkit` when that browser’s system dependencies are available. The reopened-review reproduction, fixes and actual results are recorded at the beginning of [Rounds 7 and 8](TEST-NOTES.md#rounds-7-and-8).

For an opt-in **read-only** browser observation of actual mainnet providers:

```sh
node tests/mainnet-browser.mjs
```

That runner serves the current export at the site's HTTPS gateway origin through same-origin static-file interception, leaves external RPC fetches native (including CORS), then blocks each endpoint in turn and simulates tenderly 429 for the 601 read. It does not publish the export or certify the remote gateway. Results go only to `test/scratch/mainnet-browser/`. The recorded observation, requester comparison, exact per-item results, six-domain review and limits are in [TEST-NOTES.md](TEST-NOTES.md#rounds-7-and-8).

Wallet reads attestation records serially, retrying failures about two seconds later up to four total reads per id. After exhaustion only the row's Retry starts another batch. Automatic older-state backfills are cached for a page view; the existing Retry reads clears failed backfills. Shared 1201 and community facts are part of the id-sorted picker and one payment dialog. The hour table is replaced by the keyboard/touch-capable chart tooltip; the original census download remains.

Current build, typecheck, interaction results and limits are recorded in [VALIDATION.md](VALIDATION.md), with an item-by-item mapping. These results supersede older layout/progress descriptions in historical validation records. The current unit suite has 108 cases; the route sweep covers 55 route/width combinations. The design probe retains its two established design/copy exceptions. No package, lockfile, build configuration or ignore file changes are required. Physical wallet, live transaction, screen-reader and native zoom sessions remain outside this worker check; WebKit launch was blocked by missing system libraries.


## Current layout refinement

The heading scale is page 34px, part 24px, step 15px and muted uppercase subpart 13px. Mint facts begins with its intro and four-link explanation, then 01 without an intervening rule. Step 01 lists held direct facts only; Catalog retains all thirteen direct rules. Public RPC and Retry reads share the desktop footer row. See [VALIDATION.md](VALIDATION.md) for actual commands/results, the six-domain review, reproducibility/size checks and browser limitations; this section supersedes earlier descriptions of those changed surfaces.
