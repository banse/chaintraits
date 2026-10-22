# Sworn: implemented design

## Overview

Sworn is an Ethereum wallet-fact explorer and transaction interface. The existing terminal design remains: dark canvas, system monospace, green hive art, square controls and structural rules. Nine canonical hash routes share the same header and deployment footer. Agents is a direct Markdown link on every route. At 390px the first screen contains the product, wallet address input and Explore action.

The Mint route groups minting, fact requests and community registration. Paid action entry buttons read Mint; gas-only application reads Apply shared fact, and clearing an eligible pending request reads Abandon request. One native payment dialog reviews the cost and consequences, silently checks the next eligible call after consent, then offers one explicit wallet confirmation per step. A wallet with an original card sees its card id and image. Pending or failed card reads show Reading your card… or the existing retry control and hide the mint offer.

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

Navigation wraps below 1150px with the brand left and Connect right. Evidence grids reduce at 900px. Landing, Explorer, mint and comparison columns stack at 780px; forms and remaining grids stack at 640px. At 600px the main top inset becomes 28px. The census chart remains visible and fits the available width; hour values appear in a wrapping tooltip. Code regions scroll internally; ordinary content reflows.

Mint keeps its two-column text/card panel, stacking at 780px. Its live Swarm progress is a separate full-width `section.section.swarm-feed`, directly after “Why add traits after minting?” and before “Add traits”, present only with an open request for the connected wallet. A green left rule marks the pending notice above the mint panel. Wallet contains the claimed-facts history and no progress section.

Step 02 uses one id-sorted `.trait-picker` for personal and shared catalog/community facts. Each desktop `.picker-row` has `minmax(0, 1fr) 56px 164px` columns with the same 16px gap: text, preview, action. Preview and action are vertically centered over the entire row; explicit column placement retains the preview’s position without a button and the action’s position without a preview. Preview artwork has a 1px `--accent` border. At 640px, text occupies the first full-width row; preview then action occupy the second, with the same 16px gap. Shared details align with the label’s text using 32px desktop / 28px phone insets. Rows grow with rule, history, advice and status content.

Long oracle answers, token ids and failure reasons wrap. Questions preview at two rendered lines with a 44px disclosure button for longer text. The request’s originating claimant supplies its wallet label, independently of the connected wallet. Known explorer job links sit below the oracle id. Claimed-fact rows wrap full request ids, evidence windows, UTC times and inline recovery actions.
The payment dialog is at most 680px wide and `100dvh - 48px` high on desktop. At 640px and below it occupies the entire viewport: width 100%, height 100dvh, zero margin/border, 16px content padding. Summary rows stack, action buttons stack and the dialog scrolls. Its overscroll is contained. Browser checks cover all routes at 320, 390, 780, 1280 and 1440px, plus the dialog at 390×844.

## Elevation & Depth

Flat surfaces use borders for structure. There are no shadows or gradients. Only the small progress indicator animates: a 12px current-color ring rotates once per second while a request or seat is waiting, inside `prefers-reduced-motion: no-preference`. With reduced motion it remains static; completed panels remove unanswered-seat indicators. Wallet and payment dialogs use native modal behavior and a black translucent backdrop. Only one payment dialog exists on Mint, shared by its four paid flows.

## Shapes

Controls and surfaces are square; the circular loading ring is the small status-only exception. The hive is the identifying geometric asset. Buttons have a 44px minimum height; wallet picker rows are 48px. Block citation links use a 24px target. Dialog close controls are at least 44px wide.

## Components

| Component / source | Use and states |
| --- | --- |
| `App`, `web/src/App.tsx` | Hash navigation, direct Agents link, route title/focus, dependency status, RPC selector and Retry reads. An anchor whose row is still loading watches the main content until its first match; navigation cancels the observer. Recovered endpoint failures do not become visible errors. |
| `AddressForm`, `web/src/components.tsx` | Labelled address input, inline error, focus on invalid submission and wallet exploration. |
| `Status`, `Mark`, `Section`, same file | Polite live status, named evidence classes and consistent section spacing. |
| `Card`, same file | Explicit synthetic/preview/minted captions. Authentic Renderer metadata supplies live images; a card is never a credential. |
| `CommunityCard`, same file | Local SVG preview using the Renderer’s thirteen-cell geometry and single-community-fact ring. The fact’s id/name, rule and window supply escaped SVG title/description text. It reuses `Card` through its optional `image` prop, keeping the 56px preview column and green border without requesting a catalog SVG for a community id. |
| `WalletProvider`, `web/src/wallet.tsx` | EIP-6963, mobile wallet links, Coinbase option, native modal, network switch, disconnect. |
| `CommunityForm`, `web/src/claim.tsx` | Empty inputs and template selector; examples only in placeholders. Validation appears on edited fields or attempted submission. Registration requires valid typed values. |
| `SharedFactRow`, `web/src/claim.tsx` | Shared catalog/community entries in the ordinary picker, with checkbox, shared-list rule, panel/quorum, 24-hour attempts, last result, a preview for every row, Mint this fact or gas-only Apply shared fact. The catalog preview for 1201 is retained; community rows use `CommunityCard`. Shared requests join the same multi-selection dialog and pending area. Full ranking checks still guard payment. |
| `useTransactions`, `web/src/transactions.tsx` | Action-specific price and destination, balance and allowance; silent safety/simulation checks after consent and preceding receipts; a fresh check before each explicit confirmation; plain refusal reasons and Retry check; confirmed receipts and uncertain/rejected outcomes. |
| `RequestTime`, `SwarmFeed`, `web/src/swarm.tsx` | Registry time; request id and discovery label (exact, matched, confirmed by the Registry), with explicit corrections when confirmation changes the id; native expandable panel with polite status/count updates, answer-only seat rows, local boolean votes and kind 1/2 threshold counts; consensus messages retained through attestation until a Registry outcome, pending/failed/attested states, and Retry progress. Personal questions must name the Registry request claimant, including matched, exact and Registry-confirmed details; mismatches show a refusal and the expected claimant without seat answers. `ListAnswer` uses a native 44px Show list / Hide list button with aria-expanded/aria-controls and a full ordered wallet list; its summary includes agreement and the connected wallet’s rank. List addresses wrap within each seat at 390px. Registry outcome text stays separate from optional API progress, and a known job link survives discovery-path changes. `Question` measures rendered line length with ResizeObserver and exposes native Show full question / Show less controls with aria-expanded and aria-controls. The panel job link opens the fixed IMD explorer origin in a new tab. The waiting text and unanswered seats use `LoadingIndicator`; terminal unanswered rows read No answer. Check swarm expands and focuses the matching summary. A five-second poll updates progress; an independent Registry poll detects chain delivery. API results never establish proof. |
| Personal fact advice, `web/src/eligibility.mjs`, `claim.tsx` | Selected rows and the payment dialog share checking / met / not-met / not-checkable results. The existing muted and danger tokens distinguish advisory text, always accompanied by the full prescribed words. Negative advice uses the live price. A personal row’s last unsuccessful request appears as a single UTC history line, matched through Registry request ids. No fixed height clips additional text. |
| `TransactionJournal`, `web/src/transactions.tsx` | One `.payment-dialog` with the action’s total and destination, balance, card preview, disclaimer, numbered states and receipts. Confirmed results appear first: `MintResult` reads the receipt’s card image from the Registry; request results embed `SwarmFeed`. Opening or reopening reruns personal eligibility checks; settled checks reuse their verified wallet shard and retry a previously failed load. A negative result requires Request anyway after the existing payment acknowledgement; the button remains in place, pressed and disabled after confirmation. Unknown eligibility allows the ordinary request after the bounded check. Close/reopen retains the flow but resets this extra confirmation. Reload preserves results but always clears consent and requires a new simulation before signing. |
| Automatic history, `web/src/settlement.ts`, `page-reads.mjs` | Recent reads retain 600-block feed / 7,200-block history and attempt windows. An unresolved old stored list or request is read automatically from launch block 26242885, cached for the page view. A failed backfill stays failed until explicit Retry reads. No older-block button is rendered. |
| `WalletFacts`, `web/src/wallet-facts.tsx`, `attested-records.mjs` | Wallet’s history comes from Registry state. A per-wallet queue reads distinct oracle records one at a time, including response decoding; repeated ids share the result. Network/HTTP failures retry after 2 seconds, up to four total attempts. Terminal failure displays time unavailable and a native Retry button. Leaving the page or switching wallets stops the queue. |
| `HourChart`, `web/src/pages.tsx` | 66 full-height native bar controls retain the census. Mouseover, focus and tap show one `role=tooltip` with hour, deposits, rounded whole ETH and first deposits. The active hour stays visible across the outer chart, including the axis, gap and tooltip text. Leaving that container dismisses an unfocused tooltip; keyboard blur and Escape dismiss it as before. One bar is in the tab order; Left/Right, Home/End move focus. Values wrap below the chart; the window line and JSON download remain. |
| `WalletFactRows`, `web/src/components.tsx` | All 25 facts, proof windows, pending/unproven states and live request prices. Same-wallet refresh retains rows and scroll; failures clear credential results and expose retry. |

Primary buttons use green fill. Secondary buttons have a faint outline, green hover border/text and dark text on green when pressed. Disabled controls remain native disabled controls. Focus uses a 2px foreground outline with a 4px offset. Native dialogs contain keyboard focus, close with Escape or their close control and restore focus. Each payment action stays locked until the disclaimer, previous receipt and its own successful silent simulation; restored simulations expire and are checked again when reviewed. No Simulate control is rendered. Failed checks keep signing disabled and offer Retry check. Consent is not serialized into the journal and an older saved consent value is ignored. Pending and failed card reads never render a mint button. A pending fact locks only its own picker row. The feed uses existing status colors plus explicit status words; its disclosure and retry controls inherit the native keyboard and focus treatment. Approve appears only for a short allowance. The eligibility prerequisite applies before that approval as well as the paid action, so negative advice cannot be bypassed by starting an earlier wallet step. The nine settled curator facts use exact snapshot counts, verified against SHA-256 pins before display; they make no RPC or live spec read. One shared 19–22 KB wallet shard serves the rows and dialog. Missing wallets have zero matches; unavailable or corrupt files show the existing advisory sentence only for the affected check. The ordinary request flow stays available. Facts 601 and 1301 retain their public live reads. This adds no connector, server or persisted consent.

## Do's and Don'ts

Reuse `Section`, `Status`, existing token names and the six-size scale. Keep exact integers and full addresses readable. Keep cost, balance and consequences beside payment controls. Start another route from the shared shell and use hash navigation. Publish `#/mint` and `#/wallet`; the router also resolves legacy `#/claim` and `#/wallet-facts` queries/anchors. Use `claimAnchor` for query-preserving Mint step links.

Keep form examples in placeholders. Treat unavailable reads as unavailable, retain retry and never substitute a cached credential for failed state. Derive addresses from the deployment. Preserve the existing palette and square geometry; restrict motion to the waiting indicators and honor reduced motion. Never treat a rendered card as proof.

Better Interface attribution and licenses are retained in `web/LICENSES/Better-Interface.txt`; wallet marks are attributed in `web/LICENSES/RainbowKit.txt`. The six-domain review, findings, browser observations and limitations are in `web/TEST-NOTES.md`.
