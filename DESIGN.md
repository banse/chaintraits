# Sworn: implemented design

## Overview

Sworn is an Ethereum wallet-fact explorer and transaction interface. The existing terminal design remains: dark canvas, system monospace, green hive art, square controls and structural rules. Eight hash routes share the same header and deployment footer. Agents is a direct Markdown link on every route. At 390px the first screen contains the product, wallet address input and Explore action.

The Claim route groups minting, fact requests and community registration. The action entry buttons read Mint. One native payment dialog reviews the cost and consequences, silently checks the next eligible call after consent, then offers one explicit wallet confirmation per step. A wallet with an original card sees its card id and image.

## Colors

Definitions live in `web/src/styles.css`, `:root`.

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#0a0a0a` | Canvas, fields and dialogs |
| `--text` | `#d9e0da` | Text and focus indicator |
| `--muted` | `#8c968e` | Secondary text and captions |
| `--faint` | `#5f6861` | Control outlines |
| `--rule` | `#1f1f1f` | Structural separators |
| `--row-rule` | `#151515` | Hover and disabled surfaces |
| `--accent` | `#00ff41` | Links, primary action, confirmed text |
| `--direct` | `#00cc33` | Direct evidence |
| `--shared` | `#dbfee6` | Shared evidence |
| `--panel` | `#8ff0a4` | Panel evidence |
| `--danger` | `#ff7777` | Error text |

Statuses always include words; color alone carries no outcome. The payment backdrop is `#000c`. The entry-page probe checks rendered text against resolved solid backgrounds; results and coverage limits are in `web/TEST-NOTES.md`.

## Typography

System stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. No fonts are fetched. Weights are 400 and 600; numbers use tabular figures. Root body is 13px with a unitless 1.6 line height. The six source size tokens are 11, 12, 13, 15, 24 and 34px (`--label`, `--small`, `--body`, `--prose`, `--title`, `--display`). Mobile text inputs use 16px to avoid focus zoom. Prose uses 15px/1.65 and a 75ch maximum measure.

The existing headline, uppercase section names and monospace prose remain under the assignment's preserve-copy/design constraint. Long addresses, amounts and receipt hashes wrap instead of being clipped. Code blocks scroll within their containers.

## Layout

Shared content has a 1264px outer maximum, 32px desktop gutters, and 16px gutters below 600px. Spacing tokens cover 4, 8, 12, 16, 20, 24, 32, 40 and 48px. Sections use 48px separation and a 24px inset after the divider. Main content has 40px top and 72px bottom padding.

Navigation wraps below 1150px with the brand left and Connect right. Evidence grids reduce at 900px. Landing, Explorer, mint and comparison columns stack at 780px; forms and remaining grids stack at 640px. At 600px the main top inset becomes 28px and the dense census chart is hidden; its data table remains available. The census table and code regions scroll internally; other content reflows.

With watched requests, Claim's `.mint-panel.has-swarm` uses three `minmax(0, …)` columns in DOM order: `.claim-copy`, `.swarm-feed`, then the card. Column proportions are 1 / 1.15 / 0.8 with a 24px gap and top alignment. At 1000px and below those columns stack in the same order. A green left rule marks the pending-fact notice above the panel. Each notice names its fact and displays the Registry request time in UTC. Long answers, token ids, figures and failure reasons wrap. The ordinary two-column mint layout remains when there are no watched requests.

The payment dialog is at most 680px wide and `100dvh - 48px` high on desktop. At 640px and below it occupies the entire viewport: width 100%, height 100dvh, zero margin/border, 16px content padding. Summary rows stack, action buttons stack and the dialog scrolls. Its overscroll is contained. Browser checks cover all routes at 320, 390, 780, 1280 and 1440px, plus the dialog at 390×844.

## Elevation & Depth

Flat surfaces use borders for structure. There are no shadows, gradients or animations. Wallet and payment dialogs use native modal behavior and a black translucent backdrop. Only one payment dialog exists on Claim, shared by its four paid flows.

## Shapes

Controls and surfaces are square. The hive is the identifying geometric asset. Buttons have a 44px minimum height; wallet picker rows are 48px. Block citation links use a 24px target. Dialog close controls are at least 44px wide.

## Components

| Component / source | Use and states |
| --- | --- |
| `App`, `web/src/App.tsx` | Hash navigation, direct Agents link, route title/focus, dependency status, RPC selector and Retry reads. Recovered endpoint failures do not become visible errors. |
| `AddressForm`, `web/src/components.tsx` | Labelled address input, inline error, focus on invalid submission and wallet exploration. |
| `Status`, `Mark`, `Section`, same file | Polite live status, named evidence classes and consistent section spacing. |
| `Card`, same file | Explicit synthetic/preview/minted captions. Authentic Renderer metadata supplies live images; a card is never a credential. |
| `WalletProvider`, `web/src/wallet.tsx` | EIP-6963, mobile wallet links, Coinbase option, native modal, network switch, disconnect. |
| `CommunityForm`, `web/src/claim.tsx` | Empty inputs and template selector; examples only in placeholders. Validation appears on edited fields or attempted submission. Registration requires valid typed values. |
| `SharedFact`, same file | Read/pending/stored/request states, complete-log safety checking before a paid shared request. |
| `useTransactions`, `web/src/transactions.tsx` | Live price, balance and allowance; silent safety/simulation checks after consent and preceding receipts; a fresh check before each explicit confirmation; plain refusal reasons and Retry check; confirmed receipts and uncertain/rejected outcomes. |
| `RequestTime`, `SwarmFeed`, `web/src/swarm.tsx` | Registry time; native expandable panel with polite status/count updates, seat answers and figures, quorum, pending/failed/attested states, and Retry progress. Check swarm expands and focuses the matching summary. A five-second poll updates progress; an independent Registry poll detects chain delivery. API results never establish proof. |
| `TransactionJournal`, same file | One `.payment-dialog` with total, balance, payment destinations, card preview, disclaimer, numbered states and receipts. Close/reopen retains the flow; reload preserves results and requires a new simulation before signing. |
| `WalletFactRows`, `web/src/components.tsx` | All 25 facts, proof windows, pending/unproven states and live request prices. Same-wallet refresh retains rows and scroll; failures clear credential results and expose retry. |

Primary buttons use green fill. Secondary buttons have a faint outline, green hover border/text and dark text on green when pressed. Disabled controls remain native disabled controls. Focus uses a 2px foreground outline with a 4px offset. Native dialogs contain keyboard focus, close with Escape or their close control and restore focus. Each payment action stays locked until the disclaimer, previous receipt and its own successful silent simulation; restored simulations expire and are checked again when reviewed. No Simulate control is rendered. Failed checks keep signing disabled and offer Retry check. A pending fact locks only its own picker row. The feed uses existing status colors plus explicit status words; its disclosure and retry controls inherit the native keyboard and focus treatment. Approve appears only for a short allowance.

## Do's and Don'ts

Reuse `Section`, `Status`, existing token names and the six-size scale. Keep exact integers and full addresses readable. Keep cost, balance and consequences beside payment controls. Start another route from the shared shell and use hash navigation.

Keep form examples in placeholders. Treat unavailable reads as unavailable, retain retry and never substitute a cached credential for failed state. Derive addresses from the deployment. Preserve the existing palette, square geometry and motion-free behavior. Never treat a rendered card as proof.

Better Interface attribution and licenses are retained in `web/LICENSES/Better-Interface.txt`; wallet marks are attributed in `web/LICENSES/RainbowKit.txt`. The six-domain review, findings, browser observations and limitations are in `web/TEST-NOTES.md`.
