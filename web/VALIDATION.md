# Layout refinement validation

Worker checks on 2026-10-24; these are not independent certification. Scope: the eleven requested interface changes in the existing static Sworn site. Contracts, addresses, chain, ABI/runtime integrity, RPC pool, eligibility snapshot, routes, dependency manifests/lockfile and build configuration are preserved. No live signing, broadcast, deployment or publication occurred.

## Item coverage

`node tests/layout-refinement-browser.mjs` serves the production export under `/preview/`, using fake EIP-1193, RPC and API responses. Six scenario groups pass, including 44 route/width/wallet combinations and two additional Mint measurements; no console/page/local-resource errors or horizontal overflow were recorded.

| Item | Test case prefix and result |
| --- | --- |
| 1 | `1,5,8 all routes…`: selector/Retry top coordinates match at 1280px, controls remain inside the bottom row, group right edge equals footer right edge. All six canonical routes and five aliases, connected/disconnected, at 1280/390px. |
| 2 | `2 busy transaction…`: hold a fake wallet reply in awaiting-signature state, assert Follow progress enabled, focus/Enter opens Wallet and closes the dialog, reject the held fake call. No RPC send/sign call. |
| 3 | `3 six Catalog sources…`: all six exact URLs preserve the full c4ff3238 commit, CATALOG.md and original anchors in the deployed repository. The linked GitHub file separately returned HTTP 200. |
| 4 | `4,6,7,8,10 Mint structure…`: no Add facts heading or per-step Who can/Cost and risk/Who benefits block. |
| 5 | `1,5,8…`: inspect rendered structural borders against text/control/image rectangles; no consecutive empty boundaries. Includes Mint panel/part, first step, 02/03, home strip/evidence and final Wallet history/footer. |
| 6 | `4,6,7,8,10…`: exact three titles, accent number, 600 name/400 description, exact checksummed Read Contract URL, new-tab target. |
| 7 | Same case compares direct/community intros to Catalog and paid descriptions to their Catalog topics with step-02 pointers removed; three separate paragraphs start with bold topic names. |
| 8 | `1,5,8…` and Mint case measure page/part/step/subpart at 34/24/15/13px. Both named subparts are uppercase and muted. |
| 9 | `9,11 zero hidden…`: zero-count controls absent before connection and with no known negative result; positive count appears, shows/hides negative rows and exposes pressed state. |
| 10 | Mint case checks immediate intro/explanation adjacency, all four original link destinations, no explanation-bottom or 01-top rule, retained rules before 02/03. |
| 11 | `9,11…`: no 01 disclosure; disconnected/empty wallets list no direct facts, a two-fact wallet lists exactly its two held ids. Catalog retains thirteen direct rules. |

The existing refresh/correction suites retain their other checks. Only superseded assertions changed: descending title sizes, explanation position, direct filtering, busy navigation and conditional disclosure. Eligibility-focused suites now opt into negative rows when their asynchronous disclosure appears. Shared-request setup waits for wallet facts, and the tooltip test waits for the alias's initial anchor scroll before moving to the chart; neither changes product behavior.

## Actual checks

Installation used the unchanged web package/lockfile in an isolated temporary copy, with dependencies, npm cache and browsers outside the repository. Commands below are web-relative unless noted.

- `npm ci --no-audit --no-fund`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; three pinned ABI byte/canonical-Keccak comparisons pass. Existing upstream client-directive, worker-module and plugin-timing warnings remain.
- `npm test`: 108 unit/export tests passed; 55 Chromium route/width combinations at 320, 390, 780, 1280 and 1440 passed, including forms, wallet dialog focus/return, copy, compiled integration example and census interactions. Optional live RPC/fork cases explicitly skipped.
- `node tests/layout-refinement-browser.mjs`: six groups passed, 46 geometry observations, zero unexpected errors.
- `node tests/site-refresh-browser.mjs`: 14 groups passed. `node tests/correction-browser.mjs`: 11 groups passed, including late wallet reply, currency changes and sent-receipt persistence.
- Additional suites passed: `site-update-browser.mjs` (9 groups), `round8-browser.mjs` (10), `round8-revision-browser.mjs` (4), `eligibility-snapshot-browser.mjs` (6), `acceptance.mjs` (12), `actions.mjs` (11), `oracle-feed-browser.mjs` (10), `personal-facts-browser.mjs` (15), `followup.mjs` (10), `swarm-browser.mjs` (10), `site-review-browser.mjs` (9). All used fake wallet/RPC/API answers.

The pinned probe ran from the repository root: `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline`, using the externally installed Playwright module. It passes 14/16 checks. The two flags are inherited uppercase WHY SWORN/BUILT BY THE SWARM headings and established monospace prose, retained under the brief's copy/design constraint. Render, layout, targets, measured entry-page contrast, tracking, eyebrows, sizes, glyphs, slogans, repetition, copy budget, chrome, motion and share metadata pass.

## Better Interface review

The pinned workflow, six domains and documentation method informed implementation. Existing licenses remain in `web/LICENSES/Better-Interface.txt`. `DESIGN.md` describes actual source values.

| Domain | Checked evidence and limitations |
| --- | --- |
| Accessibility | Native labelled controls, keyboard follow-progress activation, pressed disclosure, route/form focus and native wallet-dialog focus/return. Focused 390px Explore screenshot inspected. Screen reader, native zoom and physical devices unperformed. |
| Layout | 1280/390 connected/disconnected route matrix; existing 320–1440 sweep. Desktop footer and phone home/Mint screenshots inspected using the supplied browser. No empty border pairs or overflow measured. RTL/translation expansion unperformed. |
| Writing | Exact titles, source link, shared topic intros and four moved links tested. AST test protects unchanged control/link labels; no public version labels or burned-fee claim introduced. |
| Typography | Distinct descending sizes and step weights measured on every route; phone/desktop Mint screenshots inspected. Existing monospace/full-width prose retained. Platform font fallback may vary. |
| Colors | Existing tokens retained; computed muted `rgb(140,150,142)` on canvas `rgb(10,10,10)` measures 6.475:1 in the supplied browser. Entry-page probe contrast passes. Decorative SVG pixels/overlays not comprehensively measured. |
| UI | Native controls and flat surfaces retained; loading, empty, refusal, retry, held facts, conditional disclosure and busy dialog exercised. No new motion; existing reduced-motion probe passes. Physical wallet handoff/passkeys unperformed. |

Findings fixed and rechecked:

| Finding | Source and correction | Recheck |
| --- | --- | --- |
| Medium: desktop footer button wrapped | `src/styles.css:562`: give RPC controls a non-shrinking nowrap group and 256px selector, retain phone wrapping. | All route desktop rectangles; supplied-browser footer screenshot. |
| Medium: repeated empty boundaries | `src/styles.css:459`, `:690`, `:830`, `:956`: single top-rule ownership for strip/panel/history, no rule before 01. | Rendered border/content matrix and Mint screenshots. |
| Medium: indistinct titles | `src/styles.css:162`, `src/claim.tsx:1344`: descending scale, accent numbers, regular descriptions, muted uppercase subparts. | Computed heading matrix and screenshots. |
| Medium: obsolete/misplaced Mint content | `src/claim.tsx:1301`: move explanation below intro, remove title-only section and per-step blocks, reuse Catalog intros. | Exact content/order/link checks. |
| Medium: misleading empty disclosure and absent direct rules | `src/fact-ui.tsx:37`, `src/claim.tsx:1369`: suppress zero count; direct summary contains held ids only. | Zero/positive counts, two-fact and empty fixtures; complete Catalog. |
| Medium: progress navigation blocked during wallet work; stale source links | `src/transactions.tsx:809`, `src/components.tsx:148`: enable navigation and correct repository while retaining commit/file/anchors. | Held fake wallet reply and exact six-link assertions; source HTTP 200. |

Scratch screenshots/results are reproducible under `test/scratch/layout-refinement-chromium/`, `test/scratch/taste/` and `test/scratch/manual-shots/`; they are intentionally excluded from submission. The supplied-browser preview served the actual export assets with a scratch-only fake-RPC bootstrap; no service answers were treated as live evidence.

## Final export and delivery

`npm run verify:export` passes: 65 manifest-listed assets plus `imd-deployment.json`, 66 files total, 1,539,295 runtime bytes. Rebuilding after the final source change produced the same 66 paths and SHA-256 values as delivered `dist/`, including `index.html`, `art/full-house.svg` and the manifest. Only current hashed assets remain; relative asset URLs and metadata pass existing export tests.

Prettier passes for every changed source/test file; `git diff --check` passes. Protected paths, manifests/lockfile, ignore files and inherited dependency entries are unchanged. No dependency/cache directory, new submodule, registry mirror or npm archive is submitted; all required inherited/runtime assets remain. The complete current-tree Git pack is below **8,388,608 bytes**, measured with temporary index/objects outside the repository.

Complete for the requested implementation/build scope, subject to these explicit verification limits.

## Limits

Chromium checks are performed. WebKit was downloaded but launch failed for missing host libraries (GTK4, Graphene, GStreamer and others), so WebKit interaction is unperformed. Live provider/CORS behavior, physical wallets, passkeys, real payments/settlement, screen readers and native 200% zoom are unverified. External source availability was checked once; future availability is outside this export. IPFS pinning/site-name update follow contributor submission; no publication is claimed. Repository metadata is protected, so the complete source/export is left for the submission system to commit.
