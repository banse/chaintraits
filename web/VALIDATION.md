# Wallet and Mint validation

Worker checks on 2026-10-24 UTC, not independent certification. Scope: the ten requested changes to the existing Sworn site. Addresses, chain, ABIs, RPC pool, runtime integrity checks, routes, snapshot, contracts, build configuration and dependencies remain unchanged. Static source and the rebuilt repository-root `dist/` are the delivery; hosting follows network submission.

## Requirement coverage

`tests/wallet-mint-browser.mjs` serves the production export under `/preview/` with fake EIP-1193, RPC and API replies. Its eleven scenario groups pass, with 54 geometry observations and no console/page/local-resource errors or signing calls. All ten items have explicit assertions.

| Item | Passing case and evidence |
| --- | --- |
| 1 | `1 Wallet card…` checks exact title, claimant and minted status, below-intro ordering, left/right layout at 1280 and stacking at 390, authentic fixture image, no caption/status in the card aside, only the requested hint. Pointer, Space and Enter select/clear a family; catalog and community facts sharing its cell highlight together; empty cells have no control. `1,3 Wallet without…` checks no block without a card and no hint/controls on a minted empty card. |
| 2 | `2 Wallet full-width groups…` measures full content width, two direct facts per row, one sworn fact per row and three aligned columns across both sworn groups. Exact type labels, Mint colors, green titles, short rules and phone stacking are asserted. |
| 3 | `3 Mint with card…` asserts the exact single line, its Wallet link and navigation, and no card block. No-card controls/preview remain, with the exact capitalized fee sentence. Wallet's redundant Claimed facts line and empty-card hint are absent. |
| 4 | `4,7 Mint 02 intro…` compares each category paragraph and the note's width to 01 and 03 at 1280px. |
| 5 | `5 Community rows…` holds a spec read to check the single loading status immediately above the payment notice, releases it and checks the registered row, then tests empty and failed reads. Trailing Community facts heading/success/empty copy are absent. |
| 6 | `6 Paid facts checked…` checks the historical nonce request at block 25,769,870 and nonce 5 hiding 1301 on load in a counted disclosure. Reveal/select/hide retains its row and exact note; the dialog repeats the note; deselecting hides it again. Held 1301 remains visible without a nonce check. `6 Failed or unanswered…` covers unavailable history and the deadline branch (20-second timer shortened to 200ms in that test only), with no inferred negative. |
| 7 | `4,7…` measures equal top edges of all three Why columns at 1280px. |
| 8 | `8 Pending seats…` uses an expanded 11-seat panel with true, false, failed and waiting seats. Its final row has no trailing rule, earlier rows retain their lines, and 01/02/03 each have one leading rule. Rendered borders are compared with intervening content across every canonical route, connected/disconnected, at 1280/390/320; no empty separator pair. |
| 9 | `9,10 Exact BurnExecutor…` checks rendered Mint, Catalog, Wallet and About text for the removed version/dependency phrases and burned-fee claims, plus About's exact paragraph. `3…` checks the capitalized no-card fee sentence. |
| 10 | `9,10…` asserts `Account nonce ≥ 20 at launch of WhitelistCurator` on Mint, Catalog and held Wallet. |

The last group also checks Explore and Connect on the first 390×844 screen, address validation/keyboard navigation, title/favicon/description/OG metadata and no signing. Screenshots of Wallet at 1280/390, Why columns, 02 intros, populated pending seats and focused phone Home were made and visually inspected.

## Actual checks

Dependencies were installed from the unchanged lockfile in a temporary repository copy, with npm cache and dependencies outside the submission. The provided Playwright installation was used with its Chromium runtime. The original Git object store was read for the pinned ABI comparison; no repository metadata was edited. Commands are web-relative unless noted.

- `npm ci --cache /tmp/sworn-npm-cache --no-audit --no-fund`: passed in the temporary build copy.
- `npm run typecheck`: passed on final source.
- `npm run build`: passed on final source; all three pinned ABI byte/canonical-Keccak checks passed. Inherited upstream client-directive, worker-module and bundler timing warnings remain.
- `npm run verify:export`: passed, 65 manifest-listed assets and 1,524,359 listed bytes. With `imd-deployment.json`, the export has 66 files and 1,535,577 bytes.
- A second production build was compared to delivered `dist/`: identical relative paths and SHA-256 values for all 66 files, including index, assets, `art/full-house.svg` and manifest. No obsolete hashed assets remain.
- `npm test`: passed, 108 unit/export tests and 55 Chromium route/width combinations at 320, 390, 780, 1280 and 1440, plus legacy anchor checks. Optional live RPC/fork cases explicitly skipped.
- `node tests/wallet-mint-browser.mjs`: 11 groups passed, 54 geometry observations, zero errors or signing calls.
- `node tests/sworn-step-browser.mjs`: all 6 previous-step groups passed, including 34 separator observations and unchanged footer/Integrate/About behavior.
- Additional fake-wallet regression suites passed: `acceptance.mjs` (12 groups), `actions.mjs` (11), `followup.mjs` (10), `swarm-browser.mjs` (10), `oracle-feed-browser.mjs` (10), `personal-facts-browser.mjs` (15), `eligibility-snapshot-browser.mjs` (6). Fake wallet prompts in those suites never sign or broadcast to a network.
- Source/test formatting and `git diff --check`: passed for changed formatted files. The previous step's existing unformatted test file retains its formatting except the changed assertions.

Some inherited test expectations predated the accepted starting tree. The interface-label snapshot was regenerated from that starting tree, not the new implementation: the only added control/link label is `Wallet page`, and none was removed. Browser expectations now reflect the requested card move/type/rule changes and the previous step's already-removed proof/footer controls. Disclosure helpers reveal once to avoid repeated clicks while on-load checks settle; bounded read tests account for both initial checks and selected-fact advice. Safety, consent, retry, receipt and integrity assertions remain exercised.

## Better Interface review

The pinned workflow, all six domain cores and documentation method were read and applied. Final tokens/components/responsive behavior are in root `DESIGN.md`; existing attribution remains in `web/LICENSES/Better-Interface.txt`.

| Domain | Checked coverage and limits |
| --- | --- |
| Accessibility | Native named links/buttons, cell pressed state, pointer/Space/Enter toggling, checkbox disclosure, keyboard form submission and existing wallet-dialog focus/return. Focus screenshot inspected. Screen readers, physical devices and native 200% zoom unperformed. |
| Layout | Card/fact order, full widths, row/column alignment, equal info tops and separator/content geometry at desktop/phone widths. Existing route sweep adds 780/1440 coverage. Wallet and Home screenshots inspected. RTL/localization expansion unperformed. |
| Writing | Exact requested rule/fee/minted-link copy, removed redundant lines and unchanged control/link labels. Loading, failure, empty and unknown states retain only supported claims. |
| Typography | Reused existing tokens, full-width 02 prose, compact row types and wrapping; phone and desktop screenshots inspected. Existing monospace design and previous step's 19px Mint titles retained. Font fallback can vary by platform. |
| Colors | Rendered Wallet text pairs measured against `rgb(10,10,10)`: muted 6.475:1, accent/Chain-proven 14.500:1, Panel-sworn 14.300:1, Shared 18.225:1. All exceed 4.5:1. Entry-page probe contrast passes. SVG pixels/overlays not comprehensively measured. |
| UI | Reused flat surfaces and card/hive geometry, preserved empty/loading/error/pending/selected states, and centered Wallet art using Mint's existing caps. No new motion; reduced-motion probe passes. Native wallet handoff and passkeys unperformed. |

Findings corrected and rechecked:

| Finding | Final source and fix | Recheck |
| --- | --- | --- |
| Card and facts competed for Wallet width | `src/wallet-facts.tsx:260`, `src/styles.css:980`: reuse Mint's card block, followed by full-width direct pairs and sworn columns. | Exact copy, layout rectangles, pointer/keyboard highlights and screenshots. |
| Redundant captions/status and empty hint | `src/components.tsx:197`, `src/wallet-facts.tsx:286`: optional caption, Wallet hint only with selectable families, remove below-card status. | Empty/nonempty/no-card fixtures; previous suite. |
| Known ineligible paid facts stayed visible on load | `src/claim.tsx:1118`: use Explorer's existing bounded hook and pass its result to disclosure; selected facts stay visible. | Nonce-5, held, failure/deadline and personal/snapshot regression cases. |
| Narrow 02 copy, offset Why columns, redundant community text | `src/styles.css:829`, `:1795`, `src/claim.tsx:1582`: remove measure cap, reset item margin, keep one loading/error line above payment notice. | Width/top-edge metrics and held/released/failed community reads. |
| Adjacent empty separator lines with populated pending panel | `src/styles.css:745`, `:806`: remove last seat's line and restore 01's leading rule. | Expanded populated panel plus all-route border/content matrix. |
| Old Wallet style left art aligned to its column edge | `src/styles.css:1751`: center figure while retaining Mint's responsive caps. | Final 1280/390 screenshots and geometry suite. |
| Outdated fee/rule wording | `src/components.tsx:156`, `src/pages.tsx`, `src/data.ts`: exact requested public copy. | Four rendered routes and pinned label test. |

The pinned probe ran from the repository root against final `dist/`:

```sh
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline
```

Result: **14/16 checks pass**. Render, layout, targets, contrast, tracking, eyebrows, sizes, glyphs, slogans, repetition, copy budget, chrome, motion and share pass. The flags are the inherited WHY SWORN/BUILT BY THE SWARM headings and monospace prose, retained because the brief preserves existing copy/style. Both screenshots and the probe's 390px first screen confirm the Explore action is visible. Full-width Mint text follows the brief despite the guide's usual prose measure recommendation.

## Delivery and limitations

The complete export is present with relative asset URLs, verified manifest and existing required artwork. Build configuration, dependencies/lockfile, ignore files, contracts, ABIs and network inputs are unchanged. No generated dependency/cache folder, registry archive or submodule is added. The current-tree Git pack is below 8,340,000 bytes against the 8,388,608-byte cap, measured in a separate temporary repository. One superseded historical preview, `docs/frontend/screenshots/explorer-390.webp`, was removed and its README updated; all runtime assets remain. Two inherited gitlinks under protected `lib/` remain unchanged; no new submodule is introduced.

Chromium rendering/interactions are checked. The separate browser MCP returned `Transport closed`; local Playwright Chromium and its screenshots supplied the browser evidence instead. WebKit's executable is unavailable, so WebKit interactions are unperformed. No live service accuracy, physical wallet, passkey, real payment/settlement, screen-reader or native zoom claim is made. Scratch evidence is reproducible under `test/scratch/` and intentionally excluded from submission. Publication and the final network commit are outside this workspace edit; no publish command or direct `.git/` change was made.

Complete for the requested implementation and worker-side build/check scope, with the explicit limits above.
