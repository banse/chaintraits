# Sworn frontend validation

This is worker validation of the frontend source and static export, not an independent network certification. Contracts were already deployed; this task made no contract-source changes, live transactions, redeployments or publication calls.

## Review revision: reproduced defects and rechecks

All three supplied findings reproduced against the accepted export before source edits at 390×844. The revision is limited to their navigation, price and refresh behavior, associated tests, rebuilt assets and evidence. [revision-results.json](../docs/frontend/revision-results.json) retains the actual before/after observations. The root `.imd-responses.json` is the revision's explicitly requested response-file exception to the frontend path budget. No ignore file or dependency changed.

| Finding | Reproduction and source correction | Recheck |
| --- | --- | --- |
| High, `6c2e9499…`: Claim anchor links discard the trait query | `#/claim?trait=701` lost its selected checkbox after the acknowledgement link. A prepared 601 request changed from two ready steps / one confirmation button to two unknown steps / zero confirmation buttons. `web/src/navigation.ts:1`, `web/src/claim.tsx:27` and `web/src/transactions.tsx:404` now preserve the active query in acknowledgement, journal and originating-step anchors. | Chromium and WebKit keep the same main element, selection, acknowledgement, named prepared plan, two ready steps and one confirmation control through journal/origin links and browser Back. Keyboard activation focuses the acknowledgement. No signature or broadcast was attempted. |
| High, `14910a7a…`: Explorer request links omit price | Successful live reads left both 601 and 1301 request rows without an amount. `web/src/components.tsx:350` now pairs each request link with `imd(health.price)` and `priceOf · live`, with explicit unavailability when health is absent. `web/src/styles.css:930` wraps the existing text/link styles. | Both engines show the RPC-fetched `0.50 IMD · priceOf · live`, correct trait URLs and no request link on impossible facts. No page overflow at 320, 390 or 1440px. Server-render coverage also checks 6.4 IMD and an unavailable price with no numeric stand-in. |
| Medium, `6000363d…`: Explorer refresh removes the result and clamps scroll | Invoking the captured production 45000ms callback while holding a wallet read removed all 25 rows, shortened height 5443→1245 and clamped scrollY 3754→401. `web/src/pages.tsx:349` retains same-address facts; `:390` limits initial trait scrolling; `:416` updates a stable loading status. | Both engines retain all result nodes, height and reading position during and after refresh, including an initial trait deep link. Chromium remained at scrollY 3769 / height 5446. A different address and failed lookup clear old facts, and retry restores them. |

Actual revision commands: `npm ci --cache /tmp/sworn-revision-npm-cache --no-audit --no-fund --loglevel=error`, `npm run build`, `npm run typecheck`, `npm run format:check`, `npm run verify:export`, `npm test`, and `npm run test:revision -- --webkit`. Live browser and fork checks used `SWORN_TEST_RPC` with the supplied transport; the public RPC source is `https://ethereum-rpc.publicnode.com`, and runtime RPC configuration was preserved. The default npm cache was read-only; the temporary-cache install passed. The existing lockfile was preserved.

`npm test` passed **27 unit/export tests, 40 route/width combinations, seven Chromium revision groups and 17 isolated-fork checks**. A separate WebKit run passed the same seven revision groups. Both engines were Chromium 156.0.8078.4 / WebKit 27.2. The complete route suite reported no page, console or local-resource errors. The unavailable-price test adds real component rendering to the original 26 unit tests. The production build verifies pinned ABI bytes/hashes before exporting; the final manifest verifies all 45 assets. The broader fork checks still exercise actual isolated swap, approval, mint and request transactions; their fixture limitations below remain.

The pinned probe was rerun with `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` using the locally installed Playwright module. It passes **14/16**, retaining the specified uppercase headings and monospace prose. Its 390px first-screen screenshot was inspected: the product and Explore wallet action remain visible. The probe is deliberately offline; live read behavior is established by the separate RPC-enabled browser checks.

The six Better Interface domains were rechecked on the changed surfaces: **Accessibility**—native link/checkbox names, keyboard activation and focus; **Layout**—responsive price/link wrapping and stable background refresh; **Writing**—live/unavailable/refresh labels state what is known; **Typography**—existing size tokens, complete amounts and common formatter; **Colors**—existing muted/accent roles, with the probe's measured global contrast checks retained; **UI**—prepared, refreshing, error and retry states exercised without animation or new surfaces. No new design tokens were introduced. The implemented behavior is updated in `docs/DESIGN.md`; its scoped location remains required by the overriding write budget.

The supplied browser connector could not launch its missing Chrome executable. Actual inspections used local Playwright Chromium and WebKit; temporary system libraries and software EGL allowed WebKit to run, and none is delivered. The focused wallet uses only the explicitly supplied 1 IMD balance fixture and refuses signing/broadcast methods. Refresh checks invoke the actual scheduled callback and hold a read rather than waiting 45 real seconds. Physical wallet apps, passkeys, screen readers and native browser zoom remain unperformed. These are worker checks; publication and independent review remain later stages. **Complete for the stated revision scope.**

## Scope and consequential readings

- Delivered eight required hash routes, keyless public reads, wallet connection, minting, one-fact oracle requests, shared facts, community spec validation, ETH payment quotes, receipt recovery, coding-agent Markdown, census and source quotations.
- The overriding write budget permits `web/**`, `dist/**`, `docs/**` and exactly `web/.gitignore`. Therefore the design record is `docs/DESIGN.md`, and install/rebuild instructions are in `web/README.md`; protected root files stay intact.
- The exact fixed headline, terminal monospace, required uppercase headings, palette, square controls and no animation take priority over the general design guide's preferences. The normal content scale has six sizes; mobile form text uses 16px to prevent iOS zoom.
- The handoff has no `poolKey`, so the deployment manifest adds none. ETH market parameters are discovered from public initialization events and checked with live liquidity and exact-output quotes. Native ETH and the absence of hooks legitimately use the protocol's zero address; no missing contract, recipient, key or identifier was replaced with a stand-in.
- The nonpayable requirement applies to Registry/executor paths. The explicitly required ETH purchase calls the external Uniswap router's payable `execute`; no ETH is sent to Registry or the fee executor.
- The community-cost sentence preserves the fixed `0.5` wording when that is the live price. Per-fact amount displays use the common two-decimal formatter below 1 IMD. The total and new price are recomputed, never copied from a dated price.
- Public reads default to the site's specified MEV Blocker endpoint. The unchanged network object is also exported, and its endpoints are offered with the specified thirdweb alternative. The selected endpoint persists only in this browser.
- The current Registry's shared answer starts absent; no answer from an earlier registry is imported. An illustration is explicitly labelled, and unavailable reads never become absent credentials or invented prices.
- The strict removed-feature lexical check also matched a React internal cache property in a dependency bundle. The frontend-only Terser setting shortens that one internal property name; no fee, contract call or wallet protocol is altered. Both source and final export are checked against the prohibited-feature strings.
- The inherited Git entries under protected `lib/` are unchanged. No frontend dependency is delivered as a submodule.
- The historical `site-check` utility is not installed here; the delivered Playwright and Anvil suites check the named behaviors instead.
- The optional landing claims feed is omitted. Required transaction and evidence flows received the available implementation and validation effort.

## Build and integrity evidence

Actual commands run from this repository include:

```sh
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run test:unit
npm --prefix web run test:browser
npm --prefix web run test:fork
npm --prefix web test
node web/scripts/verify-abis.mjs
node web/scripts/derive-storage.mjs
node web/scripts/check-reads.mjs https://ethereum-rpc.publicnode.com
node web/scripts/manifest.mjs --check
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

The final machine-readable summaries under `docs/frontend/` record the completed runs. The supplied browser MCP could not start because its Chrome executable was absent; separate local Playwright browsers supplied the actual inspections. Browser binaries, operating-system libraries, npm cache and scratch outputs are excluded from Git. A clean install, final build, typecheck, formatting and size audit are recorded in `docs/frontend/delivery.json`.

ABI verification compares exact files against `docs/abi/<Contract>.json` at `c4ff3238390fc51962fb67e86affc20cf418126e` and checks canonical Keccak. A separate Solidity 0.8.24 compile confirms the same ABI entries and derives storage layout and runtime code hashes. All three mainnet deployed runtimes match that compilation. See `docs/frontend/live-deployment.json` for the byte counts, hashes, seven getters and observed price.

`dist/imd-deployment.json` is generated after Vite, contains the exact handoff contract set and network configuration, and enumerates every other exported file with lowercase SHA-256. The runtime loads this same manifest and its ABI JSON; there is no independent runtime address map. The manifest is checked again after the final export. All assets are relative and the browser suite serves them below `/preview/`.

Vite emits third-party client-directive and unused worker-compatibility warnings. The production export has no observed page-script or local-resource failures in the recorded route checks. The dependency audit reports no known vulnerabilities after the pinned compiler's temporary-file dependency override.

## Interaction evidence

- **26 unit/export tests pass.** They cover attested ABI hashes, exact large-integer formatting, the ETH cap, shared-id routing, eligibility, valid T1–T5 specs, invalid claimant fields, prose-padded signatures, anonymous/four-topic events, parameter and window guards, lossless metadata, all asset hashes, social metadata, Renderer artwork, census sums and a recorded undelivered mainnet completion's calldata.
- **40 route/width combinations pass.** All eight pages render at 320, 390, 780, 1280 and 1440px, with route-specific titles, no horizontal page overflow, no missing local files and no observed console/page errors in the read-enabled run.
- **Chromium:** address validation/focus, native wallet dialog containment and dismissal, trait deep links, payment selection, disconnected write gates, community audit cases, clipboard controls, Solidity gate compilation, the agent download, the 66 census rows and 59 source lines are exercised.
- **Live reads:** three public contributors and a nonmember load all 25 facts and unminted Renderer previews. Separate `cast call` results match all 100 `hasTrait` answers and all four `tokenOf` results; see `docs/frontend/independent-reads.json`. Hive-family inspection is keyboard-addressable and exercised in the browser.
- **WebKit:** primary address validation and wallet-dialog open/Escape behavior pass at 390px. This required browser dependencies installed outside the repository and software EGL. These are actual WebKit interactions, not inferred compatibility.
- **Fork rehearsal:** uses the authentic deployed contracts at a pinned mainnet height, public-contributor impersonation and an explicitly labelled EIP-1193 test provider. The real exact-output swap, exact approval, mint, fee forwarding and own-tokenURI lookup pass. A registered shared spec receives its own receipt-derived id and is requested under that id. Application is tested with an explicit verified-state fixture; it does not claim a real oracle callback occurred.
- **Connected browser:** exercises named EIP-6963 discovery, the exact switch/add-chain fallback, rejection/retry, mint receipts and refresh, three individually simulated/sent requests, reload without resend, receipt-only recovery, outage recovery and the four mobile wallet links with Coinbase Smart Wallet. Extended guard results are in the final fork summary.

No mainnet signature or transaction is sent by these checks. Browser test-provider signatures are represented by Anvil impersonation inside its isolated chain.

## Better Interface: six-domain review

| Domain | Checked coverage | Evidence / remaining limits |
| --- | --- | --- |
| Accessibility | Native controls and headings; visible labels; inline errors; polite statuses; disabled reasons; focus on routes and invalid fields; dialog containment/return; keyboard cell controls; 24px citations and 44px actions | Chromium/WebKit interactions and design probe. Physical screen readers and native-device sessions unperformed. |
| Layout | First 390px screen contains product and Explore; 320px reflow; intermediate and desktop layouts; wrapped data/addresses; sole census-table exception; bottom sheet | 40 route/width results, screenshots and probe. Native 200% browser zoom, translation expansion and RTL variants unverified. |
| Writing | Fixed copy retained; verb-first actions; class/risk/payment explanations near actions; source links; errors say what to do next; “not claimed” distinguished from impossible and unavailable | Source review and interaction states. Required fixed wording overrides generic headline/casing preferences. |
| Typography | Six content tokens, two weights, one local system stack; 12px instructions; 11px source labels; tabular numbers; lossless metadata and wrapped critical text | Probe and computed styles. Exact system fallback face varies by platform; mobile input 16px is intentional. |
| Colors | Reused palette; actual class/state words; visible focus; resolved solid text contrast; faint reserved for borders | Probe passes measured contrast. No assertion about every SVG-art pixel or every disabled state. |
| UI | Square structural surfaces; no shadows, gradients or motion; distinct button states; official wallet marks; native overlay; inline loading/retry/receipt states | Production screenshots and interactions. Physical wallet app handoff and real passkey onboarding unperformed. |

Measured token/background pairs on `#0a0a0a`: main text 14.73:1, muted 6.48:1, accent 14.50:1, direct 9.13:1, shared 18.23:1, panel 14.30:1 and danger 7.69:1. The faint border token is 3.43:1 and is not used for instructional text. The primary green fill uses the dark canvas text color.

The final taste@1 probe passes **14/16**. Layout, targets, contrast, tracking, heading labels, type sizes, glyphs, slogans, repetition, first-screen copy budget, surfaces, motion, rendering and social metadata pass. The two flags are required uppercase headings and the required monospace prose; both are specification overrides, retained deliberately. The exact long headline also comes from the fixed-copy requirement.

## Findings, corrections and rechecks

| Finding | Source and correction | Recheck |
| --- | --- | --- |
| High: network switching could depend on an unavailable wallet-client query | `web/src/wallet.tsx:212`, `ConnectControl`: resolve the connected provider and send switch/add directly, using exact manifest parameters | Connected browser switch/add fallback passes |
| High: restored connector descriptors may lack a provider method | `web/src/wallet.tsx:37`, `connectedProvider`, and `web/src/transactions.tsx:184`, `execute`: resolve the current connector by uid/id before creating the wallet client | Reload, recovery and subsequent prepared-action checks |
| High: pending selections could remain checked and block later requests | `web/src/claim.tsx:661`: prune pending, verified and ineligible selections when fresh facts arrive; include community ids in pending/proof reads | Multi-request refresh and following preparation |
| Medium: hive click regions used a generic grid | `web/src/components.tsx:203` and `web/src/hive-layout.ts`: use geometry extracted from Renderer output | Family-6 inspection returns its own fact, then restores all 25 |
| High: a grouped selector change allowed a source hash to overflow at 320px | `web/src/styles.css:262`: restore wrapping for critical values/status text and preserve scoped proof-grid rules | Reproduced 329px page width; final 320px check re-run |
| Medium: unverified verdict URLs were not reproducible proof links | `web/src/components.tsx:235`, `SignedVerdict`: read the public completion calldata and link its actual transaction; preserve integer fields as strings | Recorded calldata regression; real-new-Registry verdict still unavailable |
| Medium: community data initially looked empty before reads completed | `web/src/pages.tsx:205`, `Catalog`, and `web/src/claim.tsx:1061`: separate reading/error/empty states | Final route/browser checks |
| Medium: inactive cell labels could cover hive artwork | `web/src/styles.css:910`: keep the label background transparent until hover/focus | Final Explorer screenshot and cell inspection |
| Medium: acknowledgement was separated from the first gated action | `web/src/claim.tsx:990`: keep the single acknowledgement beside the selected-facts prepare action after the picker | Phone source/render review and shared acknowledgement interaction |
| Medium: a prepared request could encounter an old displayed price | `web/src/transactions.tsx:84`, `prepare` and `execute`: re-read live price, invalidate differing caps, refresh after a preparation mismatch and refuse signing on a change | Controlled-price guard in the extended fork browser run |
| Medium: uncertain broadcasts needed a hard continuation gate | `web/src/transactions.tsx:184`, `execute` and journal controls: block continuation while a step is unknown and expose recovery | Replacement/recovery guard in the extended fork run |
| Medium: code example address literals need Solidity checksums | `web/src/pages.tsx:611`, `Integrate`: checksum the manifest-derived literal | The actual exported example compiles with Solidity 0.8.24 |
| Medium: a completed mint kept its earlier preparation message | `web/src/claim.tsx:803`: prefer the actual minted state and label the receipt link | Minted-state status assertion and final phone screenshot |
| Low: SVG-only social art has limited unfurl support | `web/assets/share.svg:1` and `web/scripts/render-share.mjs:1`: preserve source SVG and export its local 1200×630 PNG | Social metadata and local asset checks pass |

The review follows the pinned Better Interface core principles for all six domains and its documentation method. Upstream attribution and licenses are retained. No independent adversarial frontend review or comprehensive accessibility certification is claimed.

## SITE requirement coverage

| Id | Implemented behavior and actual validation |
| --- | --- |
| S-1 | Eight routes, chosen public RPC, en-US formatting, five-width overflow/console/resource checks |
| S-2 | EIP-6963 and browser fallback, modal/bottom sheet, keyboard/backdrop/Escape, exact switch/add, address/disconnect; browser and fork checks |
| S-3 | New kind-3 id parsed from receipt; own-id request and application on fork, with application fixture explicitly identified |
| S-4 | Reload never resends, hash recovery is read-only, unknown/replaced steps cannot continue; extended replacement result recorded separately |
| S-5 | Actual exact-output ETH swap on fork, 1% maximum, 120s quote, exact approval and measured refund |
| S-6 | Actual lookup before/after fork mint; live preview uses compiler-derived mapping slots; minted lookup equals own tokenURI; decode errors are surfaced |
| S-7 | Sample and all 25 mini SVGs come from deployed Renderer calls; token-number SVG scan and 26-file count pass; assets are preserved for ordinary builds |
| S-8 | Earlier registry fragments occur only in the specified About note; no earlier deployment is used for runtime configuration |
| S-9 | Registration reads current price during preparation, states it can change and reads the new spec id from its receipt |
| S-10 | Nonmember eligibility disables Curator-only requests; independent Swarmed, Pretrained and community rules remain available; unit tests and stranger live reads |
| S-11 | Each prepare/apply/register/mint surface has adjacent status; simulation/rejection/receipt errors stay under their journal step |
| S-12 | One acknowledgement state, links focus its checkbox; impossible facts remain disabled; acknowledgement sits with its first gated prepare action |
| S-13 | Connected preview/card, Already minted control and own tokenURI; actual fork mint and browser refresh |
| S-14 | All ordinary data rows reflow; only the explicitly permitted 66-hour table scrolls sideways; five-width route checks |
| S-15 | Direct hash loads set titles, scroll anchors and highlight requested traits; paid/community deep-link handlers |
| S-16 | Exact amount lists every selected id/name/price; journal names its subject and origin step; three-fact browser check |
| S-17 | Paid picker includes checkbox, id/name, rule/window, class and 56px preview; 390px screenshot review |
| S-18 | Named journal states plus danger/accent/muted text; rejection and error browser checks |
| S-19 | One accessible IMD/ETH radio group, IMD default, payment echoed beside preparation surfaces |
| S-20 | Prepare mint verb follows other prepare actions; a Connect control exists inside the disconnected journal |
| S-21 | Claim h3 steps sit under Add traits; full accessible step names; DOM brand/menu/Connect order |
| S-22 | Instructions >=12px; source/table labels 11px; muted source line numbers and block citations >=24px |
| S-23 | Distinct Catalog citations use distinct document anchors; deployment links point to authenticated contracts |
| S-24 | Claim h1, 15px Mint your Sworn card h2 and fixed lead sentence |
| S-25 | Three exact bands, 66 rows with ETH before first deposits; chart omitted at <=600px; sums and browser counts pass |
| S-26 | Copy per Integrate block, scroll cue per block, actual Solidity compilation |
| S-27 | Catalog costs use live price or explicit unavailable wording; no dated request price |
| S-28 | Phone address placeholder is “0x… (42 characters)” with a persistent label |
| S-29 | Start-aligned headers, stacked phone info, button states, unbroken RPC label, faint sheet border, 20px close glyph, 650px select cap and tokenized type/spacing |
| S-30 | Full shared-attempt cost and no-refund consequence above the request control; attempt/result data from Registry events; no fabricated live attempt |
| S-31 | Exact Swarmed copy and living request window; verified windows exposed in Explorer proof rows |
| S-32 | No removed funding UI or executor transaction path; full forwarding sentence; lexical scan over source and export |
| S-33 | Fixed headline, description, why, build, no-coin, mint, Swarmed, ownerless, history and form-help copy retained; live-price substitution documented |
| S-34 | Exported and linked `agents/sworn.md` contains fact/artifact rules, all catalog ids and live-address verification calls |
| S-35 | Optional claims feed intentionally omitted |
| S-36 | Client grammar/field/window checks plus live Composer validation before preparation; both audit claimant cases and prose-padding refusal pass |
| S-37 | One id per upgrade, one simulation/signature/receipt per request; three-request fork browser check |
| S-38 | Completion calldata read through RPC, lossless attestation/signature decoding, settle simulation and named refusal reasons. Recorded undelivered mainnet calldata regression passes. A recorded Sepolia delivery-failure replay was not supplied and remains unperformed. |
| S-39 | Exact static title and og:title; all rendered routes set `Sworn | <page>` |

## Remaining limits

The recorded checks use emulated browsers and an isolated fork. They do not establish physical-device wallet handoff, Coinbase passkey creation, a real extension's signing UI, screen-reader operation, native zoom or every SVG-art contrast pair. There is no new live oracle verdict on the just-deployed Registry to store during this validation. The mainnet completion fixture checks wire decoding only and is not an attestation for this Registry; a real successful settlement and the requested Sepolia recorded-failure replay remain unverified.

Publication, IPFS pinning, named hosting and the control-plane checks run after worker source/export delivery. No public URL or CID is claimed here. Source/export and the performed worker checks are delivered; the limits above remain explicit.
