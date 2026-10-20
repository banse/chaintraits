# Sworn design implementation

This documents the implemented frontend in `web/src`, preserving the reviewed site as the approved workflow requires. The root `DESIGN.md` requested by the general acceptance text is placed here because the assignment's overriding path budget permits `docs/**`, `web/**` and `dist/**`, and does not permit a root document.

## Visual direction

An ownerless Ethereum registry presented as a compact terminal-style reference: dark background, green hive imagery, monospace text, square controls, thin structural rules, and source links beside claims. Existing pages, palette, card art, source excerpts, section labels and typography are retained. Wallet and pool components use that same system.

## Tokens and typography

Source: `web/src/styles.css:1`.

| Role | Implemented value |
| --- | --- |
| Page background | `--bg: #0a0a0a` |
| Main text | `--text: #d9e0da` |
| Secondary text | `--muted: #8c968e` |
| Faint rules/numbers | `--faint: #5f6861` |
| Structural borders | `--rule: #1f1f1f`; `--row-rule: #151515` |
| Primary action / links | `--accent: #00ff41` |
| Direct facts | `--direct: #00cc33` |
| Shared facts | `--shared: #dbfee6` |
| Panel facts | `--panel: #8ff0a4` |
| Errors | `--danger: #ff7777` |
| Typeface | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

Root type is 13px/1.55 with tabular numbers. Existing display sizes are 34px for the landing headline, 24px for page titles and mint title, and 15px for ordinary headings. Prose uses 13px or 15px/1.6; mobile measure text uses 14px. Supporting sizes are 12px, 11px and 10px. Weights are 400, 500 and 600. Inputs become 16px at 600px and below to avoid iOS focus zoom. The probe reports seven repeated sizes/eight including one-offs; this inherited scale and monospace prose are retained under the no-redesign instruction rather than described as meeting the probe's six-size preference.

Uppercase tracked section labels (`.12em`), table labels, the `.22em` brand and source-caption treatment are part of the reviewed design. Addresses and critical values wrap; exact numeric formatting is always en-US and never uses floating-point conversion for token amounts. Long code tables scroll in labelled keyboard-focusable regions, with a mobile scrolling cue.

## Layout and surfaces

The page maximum width is 1200px with 32px horizontal gutters; narrow content is 976px. Gutters become 16px at 600px. Main top spacing is 38px, reduced to 24px on phones. Sections use 30px vertical spacing, reduced to 24px. The existing spacing vocabulary includes 4/8/12/16/20/24/28/32/36px, with 44px controls and 48px numbered columns.

All surfaces and controls remain square. Borders organize tables, sections, forms and mint content; there are no card shadows or gradient text. The wallet overlay has a black 75% backdrop and a native modal dialog with the page's dark surface. Its content has 16px padding and 48px minimum wallet rows. There are no animated transitions or autoplay effects, including under reduced motion.

## Components and behavior

- Header: hive brand at the left, named page links, one Connect control at the right. At 1100px and below navigation occupies a second row.
- `AddressForm`: persistent visible label, pasteable input, inline validation, focus on the invalid field, and Explore wallet submission. The landing product and action are visible at 390×844.
- `Section`, `Table`, `ClassMark`, `Source`, `MiniCard`: reused from the reviewed site. Evidence classes have words as well as color. Synthetic static previews are identified as illustrations.
- Explorer: a read status, live image, 13-family summary, all 25 trait results, proof links, pending states and lossless raw metadata. A wallet with no mint is labelled as a preview. Failures clear old results and offer Retry reads.
- Claim: the mint action precedes the longer explanatory flow so it is visible on the first phone screen. Existing explanation, trait classes, payment choices, previews and numbered transaction flow remain. The live Intake price and sponsor-pool balance are adjacent immediately above the pool action, with explicit eighth-of-pool/2 IMD/zero-price warnings.
- Transaction journal: exact purchase, exact approval, Registry call, explicit wallet confirmations, receipt links, pending/rejection/failure/replacement/recovery states, five named burn reasons and the receipt-derived spec id. A reload never resends a transaction automatically.
- Wallet picker: EIP-6963 names and icons, generic Browser wallet only when unnamed, Coinbase Wallet/passkey support, and four mobile in-wallet links. Native modal focus containment, Escape/backdrop/close dismissal and focus restoration. It is a bottom sheet below 640px; desktop width is at most 420px. Connected state displays the short checksum address and Disconnect; wrong chain offers Switch to Ethereum.

## Responsive behavior

At 1100px the header wraps and address controls may wrap. At 900px class cards form two columns. At 780px the landing, Explorer, mint panel and three-column stories become single-column layouts; the mint controls precede their image. At 640px class cards, flow steps and hour bands stack, and the wallet picker becomes a bottom sheet. At 600px gutters, spacing, forms, contract address rows and footer controls adapt to the phone width. Tables retain their readable minimum width inside their own scroll regions.

Rendered overflow and interaction checks cover 320, 390, 780 and 1280px; the design probe also covers 1440px. Contrast checks cover resolved solid text/background pairs, not every pixel of SVG art. Decorative source-line numbers retain the reviewed `#5f6861` value and are hidden from assistive technology; their measured 3.43:1 ratio is recorded as an exception, not an AA claim.

Use native controls, existing tokens, wrapped full addresses and explicit read/error states. Preserve the hive drawing, source quotations and reviewed palette. Do not show synthetic artwork as a live wallet result, enable signatures before deployment verification, or use card ownership as a credential.

Design guidance attribution is retained in `web/LICENSES/Better-Interface.txt`; wallet mark attribution is in `web/LICENSES/RainbowKit.txt`. Coverage and limitations are recorded in `web/TEST-NOTES.md`.
