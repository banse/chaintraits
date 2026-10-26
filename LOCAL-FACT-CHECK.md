# Local Fact Check integration

This copy adds a combined Fact Check page to the frontend deployed at `https://sworn.sites.imd.fun/` on 26 October 2026:

- `#/fact-check` — the reviewed mainnet oracle visualization above **Fact History**. An explicit request link selects that request. Otherwise the page shows the connected wallet's pending/latest saved request, falling back to its latest proven oracle fact. Each history entry shows the short fact question or direct rule, fact name, block and transaction link. Public `?wallet=` links remain supported. An empty history offers Mint Card and Mint Facts links.
- Former `#/oracle` and `#/fact-check-demo` bookmarks resolve to Fact Check, preserving request parameters. There is no separate IMD Oracle navigation item. Demo controls and sample data are excluded from production.

Mint Card now contains **Your Sworn Card**, and Mint Facts contains **Claimed Facts** above the picker. Wallet is removed from navigation; old Wallet/card and held-fact bookmarks resolve to the corresponding Mint destination. Both Mint Card and Mint Facts are directly available in navigation. Catalog, Curator, Integrate, About and documentation remain available. The existing mainnet transaction flow uses the same hive presentation, embedded in the payment dialog without a nested dialog. Oracle payments use IMD; Ethereum gas remains separate.

The moved sections reuse Claim's wallet-bound reads. Claimed Facts includes all Registry-held community facts, even beyond the card's display limit; a cardless direct preview is never labeled claimed. Recent failed, abandoned and successful request attempts remain in a collapsed disclosure on Mint Facts, using its existing event scan. Card and fact-history links lead to the appropriate task. See `../reports/sworn-fact-check-integration-2026-10-26/WALLET-MOVE-REVIEW.md` for the UI, UX and visual storytelling review and validation.

## Baseline

The source was copied from `../sworn-mainnet-site`. Its 221 frontend source, public, script, test and configuration files match the clean `banse/sworn` `swornv2` checkout at `f4e1627`. Before adding these pages, a fresh build reproduced all 84 assets in the live deployment manifest byte for byte.

`baseline/dist/` preserves the captured deployment. `provenance.json` identifies the frontend baseline. The deployment manifest's `sourceCommit` identifies contract source, not the frontend revision.

Evidence is in `../reports/sworn-fact-check-integration-2026-10-26/evidence/`.

## Structure

`web/src/fact-check/` separates the state model, live reads, and shared presentation. Fact Check composes the request view followed by the history section. The presentation consumes a snapshot and performs no blockchain writes. All added styles are scoped to the Fact Check view. Scripted scenarios and card fixtures live only under `web/tests/fixtures/fact-check/`; the static release check rejects demo UI in production assets.

Oracle links select a wallet, request ID, fact ID and optional starting block. The observer validates these against actual Registry events, including chain, Registry consumer, claimant and question binding. Pending transaction views start only after a request transaction has been broadcast, never for approval or signature prompts. Saved results require Registry evidence and the actual onchain card image, or an explicit cardless-wallet state. Shared results remain separate from personal eligibility until applied. API failures, missing images and unavailable evidence remain visible states. Removed logs cannot settle the observer.

The history section discovers successful `Verified` events and groups direct facts frozen at `CardMinted`. Requests, failures, rule registrations and unapplied shared results are excluded from the history list. Reads use 7,200-block windows. After the first page, older windows load automatically, one at a time, with a 1.8-second pause between completed batches. Existing rows and the Refresh history button stay in place. Loading pauses in hidden tabs, resumes on return, and cancels when the wallet changes or the page is left. A failed read keeps existing rows and offers a retry; an empty state requires complete successful coverage. Questions summarize the built-in rules or registered community spec already loaded by the site; they are not verbatim oracle transcripts. Unavailable rules stay unavailable rather than becoming sample evidence. Registry completion in the oracle view refreshes the history below it.

## Local use

From `web/`:

```sh
npm ci
npm run build
npm run test:unit
npm run typecheck
npm run verify:export
npm run preview -- --host 127.0.0.1 --port 8811 --strictPort
```

This workspace currently reuses the existing preview's installed dependencies through a local `web/node_modules` symlink. The lockfile is preserved; a fresh checkout can install independently with `npm ci` after removing that symlink.

Open `http://127.0.0.1:8811/#/fact-check`. Hash routes and relative asset paths preserve static hosting and IPFS subdirectory compatibility. No local API server is required.

Build before running the inherited suite: some tests inspect `dist/`. Do not run the build and those tests concurrently.

## Verified locally

See `../reports/sworn-fact-check-integration-2026-10-26/FACT-CHECK-COMBINED.md` for validation of the combined page, and `MAINNET-ORACLE.md` in that directory for the preceding mainnet integration evidence. Earlier history checks also covered a fully scanned empty wallet and background loading. Scripted phase checks remain test-only and do not prove a new live request completed.

A public completed mainnet request was read independently and through the integrated oracle view: wallet `0xc0f79284cd128bacb59f196a61b05da0fee965fa`, fact 601, card 12, Registry request `0x2bfa9ce2bac224fd163aa99f9fcf54aa17069bc328eee94b490cf413d05870ee`, oracle request `328faf29-cd5c-43f8-a39f-9f4e9d6cc7ad`. Nine reported members included seven TRUE and two FALSE answers. Renderer, Composer and Registry runtime hashes matched their pinned mainnet versions. Fact History shows this wallet's saved Swarmed fact and its short question below the oracle view. No new paid request or signature was submitted.

Applied shared/community facts appear once a wallet-bound `Verified` event exists. Merely storing a global shared result does not create a wallet history entry. Direct facts from the same card mint remain one simultaneous group. Older history appears progressively without a load-more button. A new paid request, wallet signature or oracle run was not part of verification.

## Trust and dependency boundaries

- Censorship resistance: the static bundle retains configurable public RPC reads and the existing contract deployment. Oracle progress still depends on the public IMD API; authoritative outcomes come from Registry reads.
- Open source: existing source and contract pins remain intact; the local additions are available in this folder.
- Privacy: entering a wallet sends public read queries to the configured RPC and IMD API. No new account service, private key storage or telemetry is introduced.
- Security: opening a public request is read-only. Existing wallet transaction actions retain their consent, chain, simulation and recovery checks. No permissions, custody, signer or contract changes are added by this integration.

This is a local preview. It has not been committed, pushed or deployed.
