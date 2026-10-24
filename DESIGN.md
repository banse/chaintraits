# Sworn: implemented design

## Overview

Sworn explores and requests Ethereum wallet facts. Its existing terminal design remains: dark canvas, system monospace, green hive artwork, square controls and structural rules. Six canonical hash routes share the header, wallet control and deployment footer. At 390px the home screen contains the product, address field and Explore action.

Catalog opens with its intro, then Explorer, then every catalog fact. Mint contains Mint Card and Mint facts. Wallet pairs the connected claimant's detailed facts with its Registry-rendered card and shows pending-request progress. No contract, address, ABI, connector or RPC pool is changed by this interface update.

## Colors

The canonical tokens are in `web/src/styles.css`, `:root`.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0a0a0a` | Canvas, fields, dialogs |
| `--text` | `#d9e0da` | Main text, keyboard focus |
| `--muted` | `#8c968e` | Secondary text, captions |
| `--faint` | `#5f6861` | Control outlines |
| `--rule` | `#1f1f1f` | Structural separators |
| `--row-rule` | `#151515` | Hover/disabled surfaces |
| `--accent` | `#00ff41` | Links, primary fill, confirmed/selected states |
| `--direct` | `#00cc33` | Direct evidence |
| `--shared` | `#dbfee6` | Shared evidence |
| `--panel` | `#8ff0a4` | Panel evidence |
| `--danger` | `#ff7777` | Error text |

Statuses include words. Family selection has a pressed button, an outline on every matching fact and a named status. The modal backdrop is `#000c`. The production probe measures resolved solid text/background pairs; current coverage and limitations are in `web/VALIDATION.md`.

## Typography

The stack is `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; there is no downloaded font. Source weights are 400 and 600, with tabular numbers. The six source sizes are 11, 12, 13, 15, 24 and 34px (`--label`, `--small`, `--body`, `--prose`, `--title`, `--display`). Body text is 13px/1.6; prose is 15px/1.65. Phone inputs are 16px to avoid focus zoom.

Page/part titles use 24px/1.3 and -0.02em tracking. The landing headline uses 34px/1.25 and -0.03em. Standalone prose fills the content width, preserving the previous assignment; prose beside a card stays inside its column. Required uppercase headings and the established monospace prose remain. Critical addresses, amounts, times and hashes wrap. Code blocks scroll internally. Explorer labels its metadata as a preview with fact terminology, preserving the untouched exact metadata download and large integers. Contract names such as `hasTrait` retain their spelling and use code markup; interface prose uses fact/facts.

## Layout

The shared outer maximum is 1264px, with 32px desktop gutters and 16px below 600px. Spacing tokens are 4, 8, 12, 16, 20, 24, 32, 40 and 48px. Sections start after 48px, with a 24px inset and a divider. Main padding is 40px above and 72px below; the phone top inset is 28px.

Navigation wraps below 1150px, keeping the brand and Connect at opposite edges. Evidence grids reduce at 900px. Landing, Explorer, Mint and comparison columns stack at 780px; forms/pickers adapt at 640px. The hour chart fits the width and exposes a wrapping tooltip. Ordinary data reflows; code scrolls within its container.

Wallet with a minted card uses `.wallet-record.with-card`: `minmax(0, 1fr) minmax(280px, 360px)` with a 32px gap. Facts occupy the left column and the card the right. At 900px and below the card comes first, then facts. The card precedes the facts in DOM order for this phone reading order. Without a card, Wallet retains its full-width history. At 1280px, direct facts keep two aligned id/name-and-meaning pairs per row; between 901px and 1150px they use one pair; at 780px they stack the name above its meaning. The shared direct-provenance note and each panel fact's detailed proof remain.

Catalog rows, Explorer rows, Mint picker rows, claimed-fact rows and native table cells use at most 8px vertical padding. Actions retain their 44px hit areas. The desktop picker has `minmax(0, 1fr) 56px 164px` columns with 16px gaps: text, preview, action or Minted/time. At 640px its text spans the first row and preview/action follow below. All rows can grow with content.

Each non-Catalog fact table has one ineligible-facts toggle with a hidden count and `aria-pressed`. A failed rule or impossible Curator fact is hidden initially; unknown eligibility remains visible. Catalog's own fact listing stays complete. Held facts show Minted with a UTC attestation time, or the direct card's mint block and UTC time. Missing time has an explicit reading/unavailable state and retry where appropriate.

In Step 02, payment immediately follows the paragraph beginning “Chain-proven facts use 5 agents / quorum 3.” Its existing note stays beside the radios. “Why add facts after minting?” and its four links form the final subsection, with an h4 under Step 02's h3.

The footer bottom row contains the existing statement and two links, followed by Public RPC and Retry reads. The controls use automatic inline-start margin and end alignment; on phones their full-width group wraps while keeping its contents aligned right.

## Elevation & Depth

Flat surfaces use structural borders; there are no shadows or gradients. Native wallet/payment dialogs use a translucent backdrop. The payment dialog is at most 680px wide and `100dvh - 48px` high on desktop; at 640px it fills the viewport and scrolls with 16px padding and contained overscroll.

Only the existing 12px waiting indicator rotates, once per second inside `prefers-reduced-motion: no-preference`. Reduced motion makes it static. No new animation is introduced.

## Shapes

Controls and surfaces are square. Wallet rows are 48px high; buttons have a 44px minimum; block citations use 24px targets. The loading ring is circular. The hive uses Renderer-derived hex geometry from `web/src/hive-layout.ts`. Wallet hit regions are clipped to the actual hexagon; empty cells have no button. Selected facts use an inset outline that does not move their text.

## Components

| Source / component | Behavior and reuse |
| --- | --- |
| `App.tsx`, `App` | Shared shell, route titles/focus, aliases, deployment status and footer. `#/explorer?address=…&trait=…` opens Catalog's Explorer. Route focus is established before delayed anchor work, preserving early form interaction. |
| `chain.ts`, `runtime-assets.ts`, `runtime-integrity.mjs` | Pinned deployment/network, five ABIs and preview are bundled. The original network/path/ABI/source checks run before reads; live runtime/dependency checks still precede writes. No startup JSON round trips. |
| `components.tsx`, `AddressForm` | Persistent label, full-address validation, focused inline error and Explorer navigation. |
| `components.tsx`, `Status`, `Mark`, `Section` | Polite status, named evidence classes, consistent section structure. |
| `components.tsx`, `Card` | Sample/preview/minted captions; Registry tokenURI images for minted cards. Optional family controls use native buttons, pressed state and Renderer coordinates. |
| `components.tsx`, `WalletFactRows` | Explorer proof windows, pending/unproven states, live prices, filtering and Minted provenance. |
| `fact-ui.tsx` | Shared eligibility predicate, counted toggle, bounded attestation reader and Minted UTC display. Explorer's eligibility reads use the existing deadline/cancellation rules. |
| `claim.tsx`, `SharedFactRow` | One id-sorted personal/shared/community picker, previews, gas-only application and shared eligibility. Hidden shared rows remain mounted so their reads/retry behavior remains available. |
| `claim.tsx`, `CommunityForm` | Typed immutable-rule registration, placeholders/examples, field validation and existing safety checks. |
| `transactions.tsx`, `useTransactions`, `TransactionJournal` | Exact prices, consent, silent simulation, refusal/retry, explicit confirmation, receipt recovery and saved sent journals. The dialog shows confirmed receipt text and “Follow progress on the Wallet page”; it contains no oracle feed or live minted-card updates. Pre-signature card preview remains. |
| `wallet-facts.tsx`, `WalletFacts` | Detailed Registry history and current card, account-scoped reads, pending feeds, and family selection. Saved shared-request receipts are matched to the connected preparer and checked against `sharedPending`. Chain completion refreshes facts/card independently of the API. |
| `swarm.tsx`, `SwarmFeed`, `RequestTime` | Existing request identity/claimant checks, polling, quorum/list/question disclosure, Registry outcomes and retry. API progress never establishes a credential. Mint retains its existing pending feed; Wallet now shows the same pending progress. |
| `attested-records.mjs` | Per-wallet serial record queue, deduplication, four bounded attempts, explicit Retry after failure, cancellation on leave/switch. |
| `wallet.tsx`, `WalletProvider` | Existing EIP-6963 discovery, mobile wallet links, Coinbase option, chain switching and native modal focus/return. |
| `pages.tsx`, `HourChart`, `CodeBlock` | Existing keyboard/touch hour tooltip, full source/census downloads and copyable verification examples. |

Family selection toggles all held catalog tiers in that family, including PID points and fills. Community rings use the Renderer's slot order for the first 39 community facts; later community facts advance the frame and have no family-cell highlight. Clicking another cell moves the selection; selecting it again clears it.

## Do's and Don'ts

Start a page inside the shared hash-routed shell. Reuse `Section`, `Status`, `Mark`, native controls and the existing six-size scale. Use green fill for the primary action, with secondary actions outlined. Keep full addresses and exact integers readable. Retain local loading, empty, error and retry states; unknown reads never become false facts.

Keep chain-derived credentials separate from optional progress. Preserve the pinned deployment, runtime checks, RPC pool and wallet connector. Treat the rendered card as a view, not proof. Use `claimAnchor` for query-preserving Mint step links. Keep the runtime asset source and public exported copies in sync through the normal build.

Design guidance attribution and licenses remain in `web/LICENSES/Better-Interface.txt`; wallet marks remain attributed in `web/LICENSES/RainbowKit.txt`. The current six-domain review, actual checks and unperformed checks are recorded in `web/VALIDATION.md` and linked from `web/TEST-NOTES.md`.
