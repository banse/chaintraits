# Sworn: implemented design

## Overview

Sworn explores and requests Ethereum wallet facts. Keep the established terminal design: dark canvas, system monospace, green hive art, square controls and quiet structural rules. Six canonical hash routes share the header, Connect control and deployment footer. Catalog starts with Explorer. Mint offers card minting to wallets without a card and links minted wallets to Wallet. Wallet places the card block before its full-width claimed facts. At 390px the first home screen contains the product, address field and Explore action.

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

Status words accompany color. Selected families expose `aria-pressed` and fact outlines; each cell has an accessible family name. Sworn fact rows use the same text labels and colors as Mint: Chain-proven uses `--accent`, Shared uses `--shared`, and Panel-sworn uses `--panel`. The modal backdrop is `#000c`. Measured pairs and review limits are in `web/VALIDATION.md`.

## Typography

Use `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, weights 400 and 600, with tabular numbers. No font downloads. The regular source tokens are `--label:11px`, `--small:12px`, `--body:13px`, `--prose:15px`, `--title:24px`, `--display:34px`; numbered Mint steps retain the previous step’s `--step:19px`. Phone form inputs use 16px.

Page h1 is 34px/1.3, part h2 is 24px/1.5, ordinary h3 is 15px/1.5, and subpart h4 is 13px/1.5. `.step-title` is 19px/1.4, with an accent name and a grey 15px description. `.subpart-title` uses 13px muted capitals: the explanation is semantically h3 under the Mint facts h2, but visually subordinate to the numbered steps. Page/part tracking is -0.02em; the landing headline retains 34px/1.25 and -0.03em. Step names inherit weight 600; `.step-description` uses 400. Subparts use CSS uppercase without changing their source copy.

Body is 13px/1.6 and prose 15px/1.65. Standalone prose retains the full content width; the three 02 category lines and following note also span that width at 13px. Copy beside art stays within its column. Addresses, hashes, amounts and times wrap; code blocks scroll internally. Contract identifiers retain their original spelling. Explorer's fact-labelled metadata preview preserves the exact raw download and integer bytes.

## Layout

The shared maximum width is 1264px with 32px gutters, reduced to 16px below 600px. Spacing tokens are 4, 8, 12, 16, 20, 24, 32, 40 and 48px. Main padding is 40px above/72px below, or 28px/48px on phones. Sections start after 48px (32px on phones), with a 24px inset. Parts use 64px before and 32px inset.

Navigation wraps below 1150px; evidence grids reduce at 900px; main paired columns stack at 780px; forms and picker rows adapt at 640px. Wallet reuses `.mint-panel`: `minmax(0,1.2fr) minmax(0,0.8fr)` with a 48px gap, claimant copy left and card right, stacked at 780px. The figure is centered and capped at 300px, 280px below 780px and 240px below 600px. The only text under it is a selection hint when a cell can be selected. The card block is absent without a card.

Claimed facts always follow at full content width. `.direct-facts` retains two name/meaning pairs per row with subgrid alignment. `.sworn-facts` has one fact per row, using `1fr 1.5fr 12ch` columns for id/name, short rule and type; both sworn groups share these edges. All row fields stack at 780px. Group titles stay green and every row retains its leading rule and inset highlight. `.why-steps > li` resets the global sibling margin so the three info columns begin together.

Data rows use at most 8px vertical padding while buttons retain 44px targets. Picker columns are text, 56px preview and 164px actions, with 16px gaps. At 640px text spans the first row; preview/actions follow below.

Each boundary has one separator owner: the record strip and Mint panel keep their top rule; the following section owns the next rule. Fact-history rows draw leading rules, avoiding an extra trailing line before the footer. Explorer and Catalog fact lists (`.fact-rows`) draw rules between rows but not under the last row. Mint steps 01, 02 and 03 each own one leading rule. Pending Swarm progress stays inside 02, with a 24px top margin and no own rule; the last `.swarm-seats li` has no trailing rule. The old `add-traits` anchor remains on an unstyled wrapper.

The footer’s bottom row contains the established owner/backend/coin line and four source links, wrapping on phones. It has no public RPC selector or Retry reads control, as delivered by the previous step.

## Elevation & Depth

Flat structural borders; no shadows or gradients. Native dialogs use a translucent backdrop. Payment dialogs are at most 680px wide and `100dvh - 48px` high; below 640px they fill the viewport with 16px padding and contained scrolling. The existing waiting ring rotates only under `prefers-reduced-motion: no-preference`.

## Shapes

Controls are square; buttons have a 44px minimum and source links a 24px minimum. Hive geometry comes from `web/src/hive-layout.ts`; Wallet family targets follow its hexagons. Empty cells have no button. Selection uses an inset outline without moving text.

## Components

| Source | Reuse and behavior |
| --- | --- |
| `App.tsx`, `navigation.ts` | Shared shell, hash routes/aliases, titles, focus and footer. |
| `components.tsx` | `Section`, `Status`, `Mark`, labelled `AddressForm`, `Card`, `WalletFactRows`; `Card.showCaption` defaults true, with false only for Wallet. `Sources` links to the deployed source; `CommunityIntro` shares exact Catalog/Mint wording. |
| `claim.tsx` | Card minting, held-only direct summary, three numbered steps, paid picker and immutable community form. Catalog topic descriptions feed the step intros. |
| `fact-ui.tsx` | Mint and Explorer share `useFactChecks`, with bounded/cancelled checks, a positive-count disclosure and visible unknown results. Selected paid rows keep their advice. Step 01 has no disclosure; Mint/Explorer retain held-fact provenance. |
| `wallet-facts.tsx` | Mint-style card/title/claimant block, grouped short fact rows, evidence type labels, family highlights and pending progress. Wallet has no proof details or redundant caption/status below its card. |
| `transactions.tsx` | Prices, consent, simulation, refusal/retry and receipt recovery. Follow-progress navigation remains enabled during wallet work and opens Wallet. |
| `wallet.tsx`, `swarm.tsx` | Existing wallet discovery/mobile handoff, modal focus/return and read-only oracle progress. API progress never establishes a credential. |
| `chain.ts`, `runtime-assets.ts`, `runtime-integrity.mjs` | Bundled pinned inputs and retained integrity/dependency checks. |
| `pages.tsx` | Catalog/Explorer, copyable integration examples and keyboard/touch hourly chart. |

## Do's and Don'ts

Build new pages inside the existing shell using `Section`, `Status`, native controls and the six-size scale. Use one filled primary action and outlined secondary actions. Keep full critical values readable and provide local loading, empty, error and retry states. Keep the Catalog complete; only filter held direct facts on Mint. Reuse existing spacing before adding rules, and inspect adjacent boundaries at both desktop and phone widths.

Preserve contract addresses, ABIs, chain, RPC pool, wallet infrastructure and eligibility integrity. Treat the card as a view rather than proof. Retain query-preserving `claimAnchor` links. Attribution remains in `web/LICENSES/Better-Interface.txt` and `web/LICENSES/RainbowKit.txt`; performed checks and limits are in `web/VALIDATION.md`.
