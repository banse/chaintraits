# Sworn mainnet candidate — IPFS loading and Swarmed eligibility

2026-10-25. Local candidate: http://127.0.0.1:8804/. Existing commit `bad218e817c65b5585cd2f83c362390b986cd6c5` remains unchanged; these fixes are uncommitted follow-up changes. No public transaction, signature, oracle execution, payment, push or deployment occurred.

## Findings and repairs

1. **False-positive advisory, confirmed in live and candidate.** `eligibility.mjs` returned `state: met` on the first IDMD Transfer to a wallet. That proves neither an agent binding nor three accepted-work entries. The deployed bundle `assets/index-D0qhRisg.js`, SHA-256 `847cd8427a7af9f337cee1cc6d0019594d3952bbbab466d0646296a3b2207b9b`, contains the identical positive-return branch. The candidate now returns unknown with explicit partial-evidence wording. Complete empty seat-history reads are negative; unavailable or incomplete reads stay unknown. Both Explorer and Mint show the advice. Already accepted Registry facts are preserved. The user's particular wallet address was not supplied; this confirms the faulty code path rather than identifying their wallet's history.

2. **Wallet-connect race.** Claim's child effect could start a check with the previous account's already-aborted signal, then leave `checking` in the transaction journal forever. The controller now prepares its scope in a layout effect, before child passive effects. The browser failure and page text are preserved in `browser-before-wallet-fix.json`; the final connect-with-601-preselected case passes.

3. **Repeated background deployment downloads.** Every 45-second app refresh re-read runtime bytecodes, constructor dependencies and all community definitions. Validation is now cached per RPC pool and pinned runtime. Community definitions have a five-minute cache, invalidated by a changed `nextSpecId`; head, supply and prices remain live. Refreshes are single-flight, scoped, limited to 25 seconds and canceled on hide/unmount/provider change. Visible-tab resume triggers a fresh read. Separate active-request progress polling can still run while hidden.

4. **Permanently pending snapshot cache.** A gateway that never completed headers or body could leave a shared shard promise pending forever, even after the caller timed out. A 15-second shared deadline now aborts the fetch, rejects all waiters, evicts failure and allows retry. Hash and length checks remain mandatory.

## IPFS and RPC evidence

- Relative Vite assets, hash routing, local Docs and hash-pinned shards remain static; no private backend, API proxy or secret is required. Browser regressions ran under `/preview/` with no rewrite server.
- Actual home-page loading: **8 HTTP RPC requests at startup, 3 at the next refresh**, with no repeated `eth_getCode`. This is a dated measurement for the current catalog, not a fixed request budget for all pages.
- The exact batched `eth_call` captured from the site succeeded through native browser CORS on all four configured RPCs: PublicNode 43 ms, Tenderly 126 ms, MEV Blocker 142 ms, Thirdweb 393 ms. The page also verified mainnet using fallback RPCs with the primary forced to HTTP 429. Measurements originated at the local preview; a newly published gateway must still be checked after publication.
- Real Swarm public request-list fetch returned HTTP 200 in the browser. Its API remains progress information; the Registry is authoritative.
- Existing RPC concurrency limit (6), per-endpoint timeout (8 seconds), cooldowns, dual-endpoint log agreement and historical scan cancellation remain intact. Existing degradation/deadline regressions pass.
- The full AgentBound/accepted-feedback history is deliberately not reconstructed in each browser. Seat history is only an exclusion/preliminary check; the 11/7 panel follows the composed recipe. A current non-holder may legitimately qualify from historical work. No oracle was executed for this review.

## Verification

- Typecheck, build, static export/manifest verification: PASS.
- Unit suite: **192 passed**, zero failed/skipped.
- Nested-path browser: never-held wallet, seat-history-only wallet, unavailable history, accepted Registry fact, and Mint connection with 601 preselected: PASS; zero signatures and uncaught errors.
- Mobile Mint warning rendered within 390px viewport; screenshots under `output/playwright/sworn-ipfs-eligibility-2026-10-25/` in the parent workspace.
- Failed-before evidence: `eligibility-before.log`, `snapshot-before.log`, `browser-before-wallet-fix.json`.
- Final evidence: `tests.log`, `typecheck.log`, `build.log`, `package.log`, `browser.json`, `live-loading.json`, `read-loading-tests.log`.
- Original mocks/docs/self-hosted preserved baseline: **1,493 files unchanged** (`preserved.json`).
- Agency Code Reviewer checked both the cache changes and final eligibility integration; no further blocker found. This is a frontend review, not a contract audit.

## Trust and limits

IPFS serves files; live RPC and IMD API availability still matter. Four RPC operators provide redundancy, but they see queried addresses and browser network metadata. The UI has no arbitrary custom-RPC settings form; operators can change `READ_RPCS` and rebuild the MIT-licensed source. Contract/ABI references remain bundled for alternate clients. The RPC and snapshot work does not introduce custody or signing services. Refresh caches are session-local and are not proof of chain history. Existing cards/facts continue to come from the deployed contracts.

Current official IMD reference was fetched at review time: `imd-llms.txt`, SHA-256 `345b1dd0c740914f52df327322a4d4b11917d4072a7b675141979e91aa704412`. The deployed `Questions.sol` recipe remains authoritative for Swarmed, including ownership intervals, agent bindings, feedback entries and the 64-block cutoff.

Local KB lessons: `9bf19b1a2ad09beeedb968364d17c1414a4e7cf0` (partial seat evidence) and `de2306e204fab30ad17d500b2131d5b1e6a5e1e0` (shared IPFS download timeout). Neither was pushed.
