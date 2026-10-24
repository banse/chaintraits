# Sworn site refresh: worker validation

This report covers the eleven requested interface changes and the production export in `dist/`. It is worker-side evidence, not independent certification. The existing contracts, chain, addresses, ABI bytes, RPC pool, snapshot and read windows remain unchanged. There was no deployment, publication, mainnet wallet signature or broadcast.

## Implementation and requirement coverage

| Item | Production behavior | Check in `web/tests/site-refresh-browser.mjs` |
| --- | --- | --- |
| 1 | Deployment/network, five ABIs and preview are bundled; header, navigation and route text have no startup JSON wait. The original runtime validation remains. | `1 bundled startup…`: cold context with 400ms interception on all seven former JSON paths; zero requests for them, shell/title visible and Explore on the first 390×844 screen. `runtime-integrity.test.mjs` verifies the same export inputs and rejects network, each application ABI, unsafe path and preview-source changes. |
| 2 | UI prose/labels use fact/facts; contract names and URL parameters retain their spelling. | `2 and 5…`: rendered text-node scan of all canonical routes and aliases at 1280/390, including contract names only in code. `2b…` expands a metadata preview containing legacy wording, checks fact labels and lossless large integers, and verifies the exact original download bytes. AST label preservation still passes. |
| 3 | Non-Catalog tables hide known negative/impossible facts, count them and retain unknowns. Catalog’s own 25 rows remain. | `3…` nonmember Mint/Explorer disclosure/counts and unknown 601; `3b…` selected 701’s existing negative check, automatic hiding and restoration. Prior snapshot/browser checks retain exact negative advice and Request anyway. |
| 4 | Held facts show Minted in the action/status column with attestation UTC time; direct facts show the card’s mint block and UTC time. | `4…` personal 801, shared 1201, Explorer and direct 101. API/Registry replies are deterministic fixtures. |
| 5 | Public RPC and Retry reads are the footer bottom row’s last group and align right. | `2 and 5…` every route; `5 footer…` actual group/right-edge measurements at both widths. |
| 6 | Explorer immediately follows Catalog’s intro. Its old hash/query and the home form load the same wallet there; Mint has no Explorer section. | `6…` DOM order, aliases, address value, Catalog title, highlighted deep-linked fact and home submit. Earlier correction suite retains scroll/anchor/no-duplicate-id checks. |
| 7 | Fact/table row vertical padding is 8px or less. | Computed padding checks on all visible Catalog, Explorer, Mint and Wallet fact rows at desktop/phone widths. Native td/th source also uses 8px. |
| 8 | Step 02’s panel/quorum paragraph is followed by payment and its note; its last subsection is Why add facts after minting? and four links. | `7 and 8…` exact DOM adjacency/order, link count, default IMD and ETH radio interaction. |
| 9 | Dialog results have no feed/live minted-card updates and link to Wallet. Wallet shows personal and receipt-backed shared pending feeds and refreshes chain facts/card after delivery. | `9…` restored confirmed request, dialog absence/navigation, pending feed, explicit Registry poll/delivery and new held fact; `9b…` shared requester receipt/state matching and completion. Oracle-feed suite exercises the unchanged matching/quorum/question controls after following the dialog link. |
| 10 | Registry tokenURI image sits right of detailed facts at 1280, above them at 390; no-card history stays full width. | `10 and 11…` measured geometry and exact image value; `10 without…` no image/no-card note. Prior correction suite retains every meaning/proof and paired direct grid. |
| 11 | Non-empty family buttons highlight every matching fact, toggle off and move selection. Empty cells have no handler. | `10 and 11…` PID 1101/1105, all Hopper/Zero-Shot tiers, clear/move/empty center; `11 community…` fill plus three rings in a family, no frame-only fact highlight, no row movement. |

Tests serve the actual export under `/preview/`. Fixtures are explicitly synthetic EIP-1193, RPC and API responses; no test key or runtime stand-in is shipped. API results never establish a credential. Known missing attestation time is reported rather than invented.

## Commands and results

Dependencies and Playwright binaries were installed outside the repository. Commands below use `web/`-relative paths; they were executed against an isolated copy of the same source/export, with the repository’s pinned ABI commit available read-only. The finished export was copied back as a complete directory, removing obsolete hashed assets.

- `npm ci --no-audit --no-fund`: installed the unchanged lockfile.
- `npm run typecheck`: passed.
- `npm run build`: passed, including all three pinned ABI byte/canonical-Keccak checks. Existing upstream client-directive, worker-module and plugin-timing warnings remain.
- `npm test`: 108 unit/export tests passed; Chromium rendered 55 route/width combinations at 320, 390, 780, 1280 and 1440; form/focus/dialog/copy/census interactions passed. Optional live RPC and fork cases explicitly skipped without a supplied endpoint.
- `node tests/site-refresh-browser.mjs`: 14 scenario groups passed with zero console/page/local-resource errors and no measured overflow at 1280/390.
- `node tests/correction-browser.mjs`: 11 scenario groups passed, including late wallet reply/currency-change/receipt persistence and detailed facts.
- `node tests/site-update-browser.mjs`: 9 groups passed, including serial attestation recovery, automatic backfills, shared selection/application, common columns and hour tooltip.
- `node tests/round8-browser.mjs`: 10 groups passed; `node tests/round8-revision-browser.mjs`: 4 groups passed, including cancellation and wallet-proof isolation.
- `node tests/eligibility-snapshot-browser.mjs`: 6 groups passed; exact snapshot advice, one shard, zero curator historical reads, integrity failures and explicit negative consent retained.
- `node tests/acceptance.mjs` and `node tests/actions.mjs`: payment/safety/refusal/recovery checks passed with fake wallets.
- `node tests/oracle-feed-browser.mjs`: 10 groups passed; `node tests/personal-facts-browser.mjs`: 15; `node tests/followup.mjs`: 10; `node tests/swarm-browser.mjs`: 10; `node tests/site-review-browser.mjs`: 9. All reported no unexpected browser errors.

The final export inventory, independent rebuild equality, formatting and byte budget are recorded below. The pinned design probe is run from the repository root with `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline`, using the externally installed Playwright module. `--offline` prevents uncontrolled public RPC dependence; it does not bypass local asset rendering.

## Better Interface consolidated review

The pinned workflow and core principles of accessibility, layout, writing, typography, colors and UI were applied to the existing design. No unrelated redesign was introduced. `DESIGN.md` describes the implemented source tokens/components and responsive behavior. Attribution and both upstream licenses remain in `web/LICENSES/Better-Interface.txt`.

| Domain | Checked | Remaining limits |
| --- | --- | --- |
| Accessibility | Native buttons/radios/forms, bound labels, route and invalid-field focus, modal focus/return, pressed disclosure/family controls, keyboard cell activation and live named selection. h4 nesting under Step 02. | No physical screen reader or full accessibility certification; native zoom not tested. |
| Layout | First 390px home action; 320–1440 route sweep; exact 1280/390 card geometry, footer edges, table padding, responsive proof text and community-family selection without row movement. Screenshots viewed for home, Wallet and footer. | RTL/translation expansion and physical devices not tested. |
| Writing | Fact terminology and protected label AST checks; exact moved headings/intros; payment/risk wording and recovery states preserved; unknown eligibility/time remains explicit. | The clearly labelled metadata preview uses fact terminology; lossless downloads and ABI/source data retain original contract field names. |
| Typography | Existing six source tokens, two weights, system monospace, mobile 16px input, wrapped IDs and UTC provenance. Rendered desktop/phone screenshots inspected. | Platform font fallback can vary. Existing full-width standalone prose is preserved. |
| Colors | Existing palette/status words, named selection, visible focus and the probe’s resolved text/background measurements. | No claim about every SVG pixel, overlay or native disabled-control contrast. |
| UI | No new animation; reduced-motion behavior retained; loading/empty/unavailable/retry and modal states exercised; compact rows retain comfortable action targets. | Physical wallet-app handoff and passkey onboarding were not performed. |

Findings corrected within the assigned surfaces:

| Finding | Source and fix | Evidence/recheck |
| --- | --- | --- |
| High: sequential runtime loading withheld the whole interface | `web/src/chain.ts:54`, `web/src/runtime-assets.ts:11`, `web/src/runtime-integrity.mjs:5`: bundle the exact inputs and validate them before reads. | Cold startup has no seven JSON requests; every prior startup rejection is exercised. |
| Medium: initial delayed route focus could interrupt a newly used form | `web/src/App.tsx:134`: establish focus before the delayed anchor observer. | Existing first-load invalid-form/focus checks pass after bundling. |
| Medium: compact history plus a new card column could crowd intermediate widths | `web/src/styles.css:1736`: retain paired desktop details, use one pair at 901–1150px and stack card/facts at 900px. | Prior paired-grid check, 390/1280 measurements and full route sweep pass. |
| Medium: rectangular cell targets could cover empty hex corners | `web/src/components.tsx:220`, `web/src/styles.css:1797`: omit empty controls and clip Wallet targets to Renderer hex geometry. | Empty-cell center and hex-target source review and family selection checks pass. |
| Medium: selecting a family could move the detailed rows | `web/src/styles.css:1817`: use an inset outline without adding row padding. | Community-family test compares the same fact’s bounds before/after selection. |
| Medium: legacy Renderer metadata exposed old terminology | `web/src/pages.tsx:565`: label the normalized fact preview and retain the exact raw download without numeric parsing. | `2b…` verifies displayed terminology, a large integer and original download bytes. |
| Medium: moving the explanation left an inappropriate heading level | `web/src/claim.tsx:1656`: nest the final explanation as h4 under Step 02’s h3. | Final subsection/order test and source hierarchy review. |

The taste probe passes 14/16 checks: rendering, layout, target spacing, measured solid-text contrast, tracking, eyebrows, type sizes, glyphs, slogans, repetition, first-screen copy budget, chrome, motion and metadata. Its two flags are the existing required uppercase headings and the established monospace prose. They are deliberate scope/design overrides, not new defects. The 390×844 home screenshot shows the product and Explore action; Wallet screenshots confirm card order and detailed proof wrapping. Scratch evidence is deliberately excluded from submission.

## Final export and delivery checks

- The production build contains **66 files**: 65 manifest-listed assets plus `imd-deployment.json`. The listed assets total **1,528,515 bytes**; the exact final inventory is verified by `node web/scripts/manifest.mjs --check`.
- A second build from a different temporary directory matched **all 66 file paths and SHA-256 values**, including the manifest and `art/full-house.svg`. The delivered directory matches that inventory. Obsolete hashed assets were removed.
- All modified/new source and test files pass Prettier; `git diff --check` passes. Protected build/dependency/configuration paths are unchanged. There are no generated dependency/cache directories or npm archives in the submission.
- The complete current Git tree packs to **under 8,385,000 bytes**, below the **8,388,608-byte** limit, using `git pack-objects --revs --compression=9` with temporary objects/index outside the repository. The inherited toolchain and required assets are preserved.
- The progress navigation button remains disabled during active wallet work; the earlier late-response/currency-change regression passes with this additional guard.
- Screenshots/probe data are reproducible scratch outputs: `test/scratch/taste/shots/` and `test/scratch/site-refresh/` in the validation tree. They were inspected and are intentionally excluded from Git. `web/VALIDATION.md` is the submitted report; `artifacts/validation.md` is an identical output copy because the repository excludes artifacts from Git.

Complete for the stated interface/build scope. The checks below remain unperformed and are not reported as passes.

## Limits

Chromium was used. WebKit download succeeded but launch reported missing system libraries (including GTK4/Graphene); WebKit interactions were not performed. Live provider/CORS behavior, real transactions, wallet-app handoff, passkeys, physical devices, screen readers and native 200% zoom were not checked. API/RPC failures and recoveries exercised by fixtures do not certify external services. IPFS pinning and the existing site-name update occur after delivery; no publication is claimed here.
