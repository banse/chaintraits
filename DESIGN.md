# Sworn: implemented design

## Overview

Sworn explores and requests Ethereum wallet facts. Keep the established terminal design: dark canvas, system monospace, green hive art, square controls and quiet structural rules. Six canonical hash routes share the header, Connect control and deployment footer. Catalog starts with Explorer, Mint has card minting followed by Mint facts, and Wallet pairs claimed facts with the Registry-rendered card. At 390px the first home screen contains the product, address field and Explore action.

## Colors

Canonical tokens live in `web/src/styles.css`, `:root`.

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#0a0a0a` | Canvas, fields, dialogs |
| `--text` | `#d9e0da` | Main text and focus ring |
| `--muted` | `#8c968e` | Secondary copy, captions, subparts |
| `--faint` | `#5f6861` | Control outlines |
| `--rule` | `#1f1f1f` | Structural separators |
| `--row-rule` | `#151515` | Hover and disabled surfaces |
| `--accent` | `#00ff41` | Links, primary fill, step numbers, selection |
| `--direct` | `#00cc33` | Direct evidence |
| `--shared` | `#dbfee6` | Shared evidence |
| `--panel` | `#8ff0a4` | Panel evidence |
| `--danger` | `#ff7777` | Errors |

Status words accompany color. Selected families expose pressed state, a named status and fact outlines. The modal backdrop is `#000c`. The inspected subpart pair (`--muted` on `--bg`) measures 6.48:1; broader coverage and limits are in `web/VALIDATION.md`.

## Typography

Use `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, weights 400 and 600, with tabular numbers. No font downloads. Six source tokens are `--label:11px`, `--small:12px`, `--body:13px`, `--prose:15px`, `--title:24px`, `--display:34px`. Phone form inputs use 16px.

Page h1 is 34px/1.3, part h2 is 24px/1.5, step h3 is 15px/1.5, and subpart h4 is 13px/1.5. `.subpart-title` also uses 13px muted capitals: the explanation is semantically h3 under the Mint facts h2, but visually subordinate to the numbered steps. Page/part tracking is -0.02em; the landing headline retains 34px/1.25 and -0.03em. Step numbers use accent; the name inherits weight 600 and `.step-description` uses 400. Subparts use CSS uppercase without changing their source copy.

Body is 13px/1.6 and prose 15px/1.65. Standalone prose retains the full content width; copy beside art stays within its column. Addresses, hashes, amounts and times wrap; code blocks scroll internally. Contract identifiers retain their original spelling. Explorer's fact-labelled metadata preview preserves the exact raw download and integer bytes.

## Layout

The shared maximum width is 1264px with 32px gutters, reduced to 16px below 600px. Spacing tokens are 4, 8, 12, 16, 20, 24, 32, 40 and 48px. Main padding is 40px above/72px below, or 28px/48px on phones. Sections start after 48px (32px on phones), with a 24px inset. Parts use 64px before and 32px inset.

Navigation wraps below 1150px; evidence grids reduce at 900px; main paired columns stack at 780px; forms and picker rows adapt at 640px. Wallet uses `minmax(0,1fr) minmax(280px,360px)` and a 32px gap. At 900px and below its card comes above the facts. No-card Wallet history stays full width. Direct facts use two aligned name/meaning pairs at 1280px, one pair at 901–1150px, and stacked fields at 780px.

Data rows use at most 8px vertical padding while buttons retain 44px targets. Picker columns are text, 56px preview and 164px actions, with 16px gaps. At 640px text spans the first row; preview/actions follow below.

Each boundary has one separator owner: the record strip and Mint panel keep their top rule; the following section owns the next rule. Fact-history rows draw leading rules, avoiding an extra trailing line before the footer. Explorer and Catalog fact lists (`.fact-rows`) draw rules between rows but not under the last row, because the following section's top rule closes the list. Mint facts' intro and four-link explanation flow into 01 with space and no rule; a wallet's pending Swarm progress feed sits at the end of 02 (24px top margin, no rule of its own, a muted uppercase sub-part title), never between the explanation and 01. Rules remain before 02 and 03. The old `add-traits` anchor remains on an unstyled wrapper.

Desktop footer controls form a non-shrinking, non-wrapping group with a 256px selector, automatic leading margin and end alignment. At 600px they may wrap; the group stays right aligned.

## Elevation & Depth

Flat structural borders; no shadows or gradients. Native dialogs use a translucent backdrop. Payment dialogs are at most 680px wide and `100dvh - 48px` high; below 640px they fill the viewport with 16px padding and contained scrolling. The existing waiting ring rotates only under `prefers-reduced-motion: no-preference`.

## Shapes

Controls are square; buttons have a 44px minimum and source links a 24px minimum. Hive geometry comes from `web/src/hive-layout.ts`; Wallet family targets follow its hexagons. Empty cells have no button. Selection uses an inset outline without moving text.

## Components

| Source | Reuse and behavior |
| --- | --- |
| `App.tsx`, `navigation.ts` | Shared shell, hash routes/aliases, titles, focus and footer. |
| `components.tsx` | `Section`, `Status`, `Mark`, labelled `AddressForm`, `Card`, `WalletFactRows`; `Sources` links to the deployed source; `CommunityIntro` shares exact Catalog/Mint wording. |
| `claim.tsx` | Card minting, held-only direct summary, three numbered steps, paid picker and immutable community form. Catalog topic descriptions feed the step intros. |
| `fact-ui.tsx` | Counted ineligible disclosure only for positive counts; unknown eligibility remains visible. Step 01 has no disclosure. Held facts show UTC attestation or direct mint block/time. |
| `wallet-facts.tsx` | Detailed proof/history, authentic card, family highlights and pending progress. |
| `transactions.tsx` | Prices, consent, simulation, refusal/retry and receipt recovery. Follow-progress navigation remains enabled during wallet work and opens Wallet. |
| `wallet.tsx`, `swarm.tsx` | Existing wallet discovery/mobile handoff, modal focus/return and read-only oracle progress. API progress never establishes a credential. |
| `chain.ts`, `runtime-assets.ts`, `runtime-integrity.mjs` | Bundled pinned inputs and retained integrity/dependency checks. |
| `pages.tsx` | Catalog/Explorer, copyable integration examples and keyboard/touch hourly chart. |

## Do's and Don'ts

Build new pages inside the existing shell using `Section`, `Status`, native controls and the six-size scale. Use one filled primary action and outlined secondary actions. Keep full critical values readable and provide local loading, empty, error and retry states. Keep the Catalog complete; only filter held direct facts on Mint. Reuse existing spacing before adding rules, and inspect adjacent boundaries at both desktop and phone widths.

Preserve contract addresses, ABIs, chain, RPC pool, wallet infrastructure and eligibility integrity. Treat the card as a view rather than proof. Retain query-preserving `claimAnchor` links. Attribution remains in `web/LICENSES/Better-Interface.txt` and `web/LICENSES/RainbowKit.txt`; performed checks and limits are in `web/VALIDATION.md`.
