# Sworn: implemented frontend design

## Overview

Sworn is a compact reference and transaction interface for an ownerless Ethereum registry. The implementation in `web/src/` preserves the specification's terminal character: dark canvas, system monospace, green hive artwork, square controls and thin structural rules. Facts, their sources and their consequences lead each task.

The landing pairs the exact approved headline with an address form and a Renderer-generated illustration. At 390 pixels the product and Explore wallet action appear on the first screen. Claim starts with minting; longer paid and community flows follow in numbered steps. Eight hash routes share the header, deployment footer and runtime configuration.

This document is under `docs/` because the overriding path budget excludes a repository-root `DESIGN.md`. It replaces the earlier design record's obsolete implementation claims with the delivered source.

## Colors

Canonical definitions are in `web/src/styles.css`, `:root`.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0a0a0a` | Canvas, inputs and modal |
| `--text` | `#d9e0da` | Primary text and keyboard focus |
| `--muted` | `#8c968e` | Secondary text, captions, source line numbers |
| `--faint` | `#5f6861` | Input borders and structural emphasis |
| `--rule` | `#1f1f1f` | Section and row separators |
| `--row-rule` | `#151515` | Subtle hover and disabled surfaces |
| `--accent` | `#00ff41` | Links, main action and confirmed state |
| `--direct` | `#00cc33` | Direct-read evidence |
| `--shared` | `#dbfee6` | Shared evidence and primary hover |
| `--panel` | `#8ff0a4` | Panel-sworn evidence |
| `--danger` | `#ff7777` | Errors and rejected/failed/unknown steps |

Evidence classes always have names alongside color. A white dot marks a rare id. The faint token is not used for instructional text. Text contrast is measured against resolved solid backgrounds by the design probe; coverage and remaining visual limits are recorded in `web/TEST-NOTES.md`.

## Typography

The stack is `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; no font download is needed. Weights are 400 and 600, with tabular numbers throughout. Root body text is 13px/1.6. `.prose` is 15px/1.65 with a 75-character maximum measure.

The six content tokens are `--label: 11px`, `--small: 12px`, `--body: 13px`, `--prose: 15px`, `--title: 24px`, and `--display: 34px`. The mobile input exception is 16px to avoid iOS focus zoom. The 20px close glyph is an icon treatment. Page headings use 24px/1.3; the landing headline uses 34px/1.25 and -0.03em tracking. Section and step headings use 15px/1.5. Labels and table headers follow the required 11px uppercase style where appropriate; instructions remain at least 12px.

The exact uppercase headings WHY SWORN and BUILT BY THE SWARM and monospace prose are specification requirements. They intentionally override the review probe's generic casing and prose-font preferences. Addresses, hashes and critical values wrap; they are never ellipsized. Code preserves whitespace in labelled scroll regions. Raw Renderer metadata remains available as lossless original JSON text.

## Layout

Shared page containers have a 1264px outer maximum and 32px inline padding. The spacing vocabulary is a 4px scale: 4, 8, 12, 16, 20, 24, 32, 40 and 48px. Main padding is 40px above and 72px below. Sections use 48px separation and a 24px inset after their rule.

The landing and Explorer use two columns, while evidence descriptions use four. The mint text precedes its image in DOM order. Controls, status and relevant instructions stay in the same group. Receipt errors appear within the step they belong to.

At 1150px the header navigation wraps; the brand stays at the left and Connect at the right. At 900px evidence descriptions become two columns. At 780px landing, Explorer, mint and comparison layouts stack; catalog rows become answer-first two-line rows. At 640px forms, census bands and remaining grids stack, and the wallet dialog becomes a bottom sheet. At 600px gutters become 16px, main top padding 28px, input text 16px, and the dense chart is omitted. Contract addresses wrap onto their own lines. The 66-hour census is the sole sideways-scrolling data table and has a visible cue. Other data rows reflow without horizontal page scrolling.

Rendered checks cover 320, 390, 780, 1280 and 1440px. The design probe independently covers 320, 390 and 1440px. Native browser zoom, translated content and physical-device behavior have not been certified.

## Elevation & Depth

The interface is flat: no shadows, gradients, entrance animation or continuous motion. Thin borders express structure, selection and disabled state. The native wallet dialog uses a black 80% backdrop, a faint border and normal browser modal focus containment. It is the only elevated overlay.

## Shapes

Buttons, inputs and sections are square. The hive is the distinguishing shape, rendered by the deployed Renderer. Interactive cell hit regions use geometry extracted from that SVG and retain rectangular visible keyboard focus. Buttons are at least 44px high; wallet rows are at least 48px. Links used as block citations have 24px targets.

## Components

| Component / source | Purpose and behavior |
| --- | --- |
| `App` / `App.tsx` | Shared header/footer, active navigation, route titles, focus on `#main`, dependency status, RPC choice and recovery |
| `AddressForm` / `components.tsx` | Persistent label, pasteable address, inline validation, focus on the invalid field, Explore submission |
| `Section`, `Status`, `Mark`, `Sources` / `components.tsx` | Reusable content grouping, polite status text, named evidence classes and block source citations |
| `Card` / `components.tsx` | Explicit illustration/preview/minted caption; authentic Renderer SVG; keyboard-operable family inspection |
| `CodeBlock` / `components.tsx` | Copy control, recoverable clipboard error and labelled code scrolling |
| `WalletProvider`, `ConnectControl` / `wallet.tsx` | EIP-6963 names/icons, mobile open-in links, Coinbase option, native modal, wrong-chain switch/add, disconnect and provider restoration |
| `Claim`, `CommunityForm`, `SharedFact`, `Settlement` / `claim.tsx` | Mint first, one payment group, one oracle acknowledgement, per-field grammar checks, shared-fact status and simulated verdict storage |
| `TransactionJournal` / `transactions.tsx` | Exact amount and per-fact price, numbered simulation/signature/receipt states, rejection/replacement recovery and receipt-only persistence |
| `WalletFactRows` / `components.tsx` | Proven / absent / not claimed / impossible / pending states, proof window and claim links |

`primary` buttons use the green fill for the central action. Secondary buttons have a visible faint border, green hover border/text and green pressed fill with dark text. Disabled controls state their reason in adjacent text. `:focus-visible` has a 2px foreground outline with 4px offset. Native dialog behavior traps focus, closes on Escape/backdrop/close and restores its trigger.

## Do's and Don'ts

Start a new route from the shared container and `Section`, preserve the heading outline and reuse the six content size tokens. Keep the immediate action above long explanations. Put error and progress text beside the control that starts the operation. Preserve exact addresses, integers, fee consequences and full receipt hashes.

Reuse the authentic deployment loader and ABI assets; a Renderer image alone is not a credential. Label synthetic artwork, clear failed live results and retain a recovery action. Keep the specified terminal palette, square controls and motion-free behavior. Do not introduce new deployment maps or replace an unavailable read with invented data.

Guidance attribution is in `web/LICENSES/Better-Interface.txt`; wallet mark attribution is in `web/LICENSES/RainbowKit.txt`. The consolidated six-domain review and measured validation are in `web/TEST-NOTES.md`.
