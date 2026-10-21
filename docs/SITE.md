# Sworn site: the specification for a build from nothing

The public site of Sworn, built in `web/` from this file after the contracts of `docs/REBUILD.md` are live, and
published by the workflow's hosting stage (a static export pinned to IPFS under the site label, named under ENS).
This file states requirements; it is derived from the entrant's feature file of the earlier site (aidude
`docs/sworn-site-spec.md`, rows F-01 to F-50, whose ids are kept in brackets for traceability) with every row that
described the earlier build or the removed pool dropped or rewritten. The earlier site is not an input of this
build: its design record `docs/DESIGN.md` says how it looked, and section 2 says what must look the same.

## 0. What the workflow provides, what the site delivers

- Input: the delivered contracts tree, the deployment file `.imd/reads/deployment.json` (the three addresses, the
  launch record, the ABIs) and this repository's documents. Every address and ABI on the site comes from that file
  or from the build's own artifacts; none is typed in.
- Output: `web/` (Vite + TypeScript or plain TypeScript; `npm ci`, `npm test`, `npm run build`), its static export
  copied to the root `dist/` (the files the workflow pins), `web/TEST-NOTES.md` (what was checked, at which widths,
  and every place the builder chose between two readings of this file). The export ships `dist/imd-deployment.json`
  as the workflow requires, and every ABI it fetches comes from the build's artifacts (a script checks their hashes).
- Hosting: IPFS and ENS by the workflow; no server, no API key, no analytics, no cookies. The hosted copy must
  behave exactly like the export (same-origin assets only, hash routes, no absolute URLs to another host but the
  public RPCs and the documented links).

## 1. Facts and constants

| item | value |
|---|---|
| chain | Ethereum mainnet (1); nothing on Sepolia |
| Registry (name Sworn, symbol SWORN), Composer, Renderer | from `.imd/reads/deployment.json`; shown on the landing footer, the Integrate page and the About page in full |
| WhitelistCurator | `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91`, settled, 19,522 contributors, 28,353 deposits, blocks 25,769,870 to 25,789,604 (66 hours) |
| IdentityMD (IDMD) | `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` (named only in the Swarmed recipe's explanation) |
| IMD token | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| Intake v2 | `0xa43e6f75ee006411f79ac1c84120606c2330de82`; action `oracle.request@oracle-1`; price `priceOf` read live, never a dated figure in copy |
| attester | `0x5598aa9146215bc13eb26f2c692ad1461fd32982` |
| BurnExecutor V2 | `0xe29386719C155B6847aD5a4E97C6674f10ffc750`: where every fee goes; "the fee is forwarded to the BurnExecutor for bridging and burning on Base" is the only sentence about fees, never "burned" alone |
| fees | mint 0.1 IMD, forwarded to the BurnExecutor; oracle request `priceOf` per fact, to the Intake; community spec 6.4 IMD, forwarded to the BurnExecutor (6.9 with the first claim at a 0.5 IMD price; the figure is computed from the live price) |
| panels | chain evidence (kinds 1, 2, 4) 5 seats / quorum 3; shared (kind 3), panel (kinds 5, 6) 11 / 7; constants of `REBUILD.md` 4.1 |
| windows | `W_LIFE` 25,769,870 to 25,789,604; `W_JUDGED` 25,777,045 to 25,789,604; `W_FIRST1000` 25,769,870 to 25,770,897; `W_DEPLOY` block 25,769,870; Swarmed: living, 25,090,085 to the request block − 64 |
| census, the three bands | hours 0 to 23: 22,395 deposits, 15,620 new contributors, 114,291 ETH; hours 24 to 45: 5,073 / 3,095 / 12,846; hours 46 to 65: 885 / 807 / 994; totals 28,353 / 19,522 / 128,131 ETH (sum of `amount`, whole ETH); per hour in `reference/census/hours.json`, the method in `reference/census/census.py` |
| the Curator's source | `reference/census/curator-source.json` (lines 4 to 62 of the verified contract with their line numbers and the source's SHA-256) |
| shared fact 1201 | the live registry's stored answer (32 addresses, `answerHash 0xe2321ca2…2543`) is the reference; on the new registry the fact is "not requested yet" until someone requests it, and the page reads `sharedFact(1201)` live |
| public RPCs offered | `rpc.mevblocker.io` (default), `ethereum-rpc.publicnode.com`, `1.rpc.thirdweb.com`; user-switchable; the choice persists in the browser only |
| links | this repository, the launch record, the job records of this workflow, imd.fun, imd.fun/docs, x.com/swornbyswarm |

## 2. Principles (every build)

1. Keyless and static: no server, API key, analytics, cookies; no request to `api.imd.fun` from the browser. The
   only outside calls are JSON-RPC reads to the public RPCs above and the wallet's own provider.
2. Live reads fail closed: an unavailable RPC is shown as unavailable, never as a false credential or an invented
   price. A price change stops a prepared flow. After an outage and recovery every transaction button is enabled
   again without a reload [F-26].
3. Numbers are en-US formatted whatever the locale; `tokenURI` integers (`fixedVal`, `threshold`) are exact, never
   parsed as doubles; one IMD formatter across the page (two decimals below 1 IMD, exact digits otherwise); an ETH
   maximum is shown rounded up to six decimals in a commitment sentence with the exact wei in the details [F-41].
4. Credentials are `hasTrait(wallet, id)` and `tokenOf`, never `ownerOf`. A card is an artifact; a trait is a fact
   about its claimant. A card can be sold; its direct traits are frozen at mint and its facts stay about the wallet
   that minted it, which alone can add traits [F-19.3].
5. Unproven oracle facts read "not claimed". Rare ids are the Renderer's: 202, 801, 901, 1001, 1101 to 1104, 1201.
6. No owner wallet, seat or synthetic account in any showcase; examples use public contributors or `0x…c1a1`.
7. Names: Sworn, SWORN (symbol), WhitelistCurator in menus and titles, WhitelistCurator.sol where the contract is
   named, Identity.md, IMD agents, Swarmed (trait 601). No working names, no version names; the earlier deployments
   are "tests, never announced".
8. Look: background `#0a0a0a`, text `#d9e0da`, muted `#8c968e`, faint `#5f6861`, rules `#1f1f1f` / `#151515`, one
   accent `#00ff41`, danger `#ff7777`; evidence-class greens direct `#00cc33`, chain-proven `#00ff41`, shared
   `#dbfee6`, panel `#8ff0a4`; a white dot for rare ids; system monospace for everything; labels 11 px uppercase
   tracked 0.12em; body 13 px; page titles 24 px; landing headline 34 px; the 32 px hive logo and SWORN in the header;
   square controls, thin rules, no shadows, no gradients, no animation. Type sizes and a 4 px spacing scale are
   `:root` tokens [F-50]. `docs/DESIGN.md` records the earlier site's layout and breakpoints; follow it where this
   file is silent.
9. Everything the site states about a wallet is reproducible with `cast call` against the Registry and the Curator.
10. Accessibility: DOM order brand, menu, Connect (Connect visually last at every width); `#main` receives focus on a
    hash change without an anchor; headings form one outline per route; every control has a visible label; no rule,
    consequence or instruction is set smaller than 12 px; block-level citation links have a 24 px target; contrast
    at least 4.5:1 for text [F-42, F-43].
11. Phone first: every route renders at 390 px with no horizontal page scroll and no data table scrolling sideways
    (two- or three-line rows with the answer first); the 66-hour table alone may scroll with a note above it [F-32].

## 3. Fixed copy (verbatim)

| key | text |
|---|---|
| headline | Facts about wallets, onchain and sworn by the swarm. |
| landing description | Sworn is an ownerless registry on Ethereum mainnet. It records verifiable facts about wallets, starting with 25 built on the 19,522 wallets in WhitelistCurator.sol: some read live from the chain, the rest proven by panels of IMD agents and signed. A card shows a wallet's facts; any contract can check them. Everyone can add facts. ("IMD agents" links to imd.fun/docs) |
| WHY SWORN (landing and About) | WhitelistCurator.sol set out to curate a permissionless onchain allowlist of proven wallets, for mints, early access, airdrops or reputation, that a contract reads directly at mint time, with no merkle root and no snapshot. Its 66-hour game recorded 19,522 wallets that kept paying real gas, hour after hour, in a quiet market, and it left the reading of that record to builders. Sworn is built on it: it turns the record into facts any contract can check with hasTrait, so a mint or a grant can use the signal without indexing the list itself. Some facts are read live from the Curator, the rest are proven by the swarm, and anyone can add more. |
| BUILT BY THE SWARM | The contracts were built, audited and deployed by Identity.md's swarm in paid jobs, and so was this site. The job records are public. |
| NO COIN | Sworn has no coin of its own; its only token is the card. |
| claim, mint block | Mint your card now. It updates itself. |
| claim, mint lead | A card costs 0.10 IMD; no trait claim is needed before minting. |
| claim, community trait | A community trait costs 6.9 IMD: 0.5 for your first claim and 6.4 IMD that registerSpec() forwards to the BurnExecutor for bridging and burning on Base. |
| claim, Swarmed | Swarmed: operated a seat through 3 accepted swarm jobs. Counted up to 64 blocks before the block of your request; request again after more jobs. |
| About, ownerless | Ownerless: no owner roles, no upgrade path, pause or fee switch; dependencies fixed at construction. MIT. Static: no backend, no key, no analytics. |
| About, earlier deployments | Three earlier deployments (Registry 0x39bec764…95a6, swarm launch #2147, 2026-10-18; Registry 0xdd0017e4…5edb, swarm launch #2341, 2026-10-20; Registry 0x9cb36ecc…a828, swarm launch #2362, 2026-10-21) were tests, never announced; this registry replaced them on <date>. |
| community spec form, help | The event must be written as its signature, `event Name(type indexed name, …)`, and must not be `anonymous`; the claimant field must be an indexed address of that event. The registry refuses anything else before the fee is taken. |

The 6.9 figure is computed from the live price (0.5 IMD on 2026-10-21) and restated when the price differs.

## 4. Pages (eight hash routes)

| route | purpose | blocks | live reads |
|---|---|---|---|
| `/` landing | the thesis and the entry points | headline, description, address box → Explorer, a sample card (a synthetic illustration, labelled), class cards explaining the four evidence classes and how a fact is sworn [F-18.29], two HOW IT WORKS stories with subheaders: the wallet's (mint a card, add traits, swear new facts; its steps link to `#/claim` and its steps) and the curator's (a human looking for real wallets; "Read hasTrait" links to `#/integrate`) [F-18.30, F-34], WHY SWORN verbatim with the Curator's "for builders" message quoted [F-18.28], BUILT BY THE SWARM verbatim with the explorer links of this workflow's jobs under it [F-18.31], footer with the three addresses, the RPC switch and a dependency check | `curator()`, `intake()`, `priceOf` |
| `#/catalog` | the 25 facts | one table per evidence class with a short description above it (what the class means, how it is proven or sworn, how a wallet gets it, what it costs, what the risk of a sworn non-fact is) and a link to the claim step; the Swarmed row with its living window; a community section with explanation and a live table of registered specs (a placeholder when empty) [F-18.17]; four block windows; limits of the record (not sybil-resistant); cost boxes reading `priceOf` live with the `priceOf · live` mark or saying "the live oracle price per fact" [F-48]; every CATALOG citation links to its own section anchor [F-44] | `nextSpecId`, `specOf`, `priceOf` |
| `#/explorer` | any wallet, no connection | all 25 `hasTrait`, `traitsOf`, `verifiedSpecsOf`, `frozenDirect` when a card exists; Curator views; the hive for any address (its own `tokenURI` if it minted a card, else the Renderer's live preview of its facts labelled "preview, no card minted" [F-23]); an interactive card: a click on a cell shows that family's facts and how each was proven [F-18.8]; oracle facts still requestable with the live price and a link to `#/claim?trait=N`; a fact that cannot be true for the wallet (ids 701 to 1105 and 1201 for a wallet with `firstHourOf(A).joined == false`) reads "cannot be true: not in WhitelistCurator.sol" with no request link [F-28]; community and raw metadata (lossless); the "never ownerOf" rule; `#/explorer?address=…&trait=…` deep links [F-33, F-38] | Registry, Curator, Renderer, `priceOf` |
| `#/claim` | the wallet flows | the mint block first (h2 "Mint your Sworn card", the lead sentence of section 3; on connect it reads `tokenOf` and shows the wallet's own preview "preview, no card minted" or its card "Sworn #n · minted" with the mint button disabled and the reason "already minted" [F-31, F-45]); an intro that starts from "why do I need to add traits to a card I already minted?" and answers it with a minimal flow chart [F-18.18]; "Add traits" (h2) with three steps as h3 "Step 0n · title": 01 direct reads (already true, free, the source and what it proves [F-18.2]), 02 paid upgrade and the shared fact (catalog ids, Swarmed, community ids; the Top Weights block: greyed out once stored, how it was sworn with the oracle request link and the panel result, one click to apply for a connected wallet in the list, "not in the list" otherwise [F-18.6, F-18.24, F-10]), 03 register a community trait (the T1 to T5 form with examples per input, who benefits: a curator airdrops a new trait to their community [F-18.25]); every step with an info box: who can, the cost, the risk, who benefits [F-18.19, F-18.20, F-18.21]; pay with IMD or exact-output ETH swap, chosen once at the head of "Add traits" and echoed as text beside every prepare button [F-39, F-18.16]; the oracle acknowledgement (a mandatory checkbox: the price is spent whatever the answer) with the first gated button, one shared state, every disabled reason naming it a link that scrolls to and focuses it [F-30, F-18.13]; the paid-upgrade picker as a selectable table: checkbox, id and name, rule · window, class mark and a mini preview of the trait on an empty card, with the class sentence and the "who benefits" sentence once above it [F-36, F-18.4, F-18.14, F-18.15, F-18.22]; the community table in the same layout, live from `nextSpecId`/`specOf`, a placeholder when empty [F-18.23]; the transaction block: "Exact amount" with every selected id, name and per-fact price, a journal whose heading names its subject and links back to the step, numbered steps with receipts, state words coloured by state, errors under the step that failed, a Connect button in place of the "connect first" sentence while no wallet is connected, recover a hash, clear [F-29, F-35, F-37, F-40]; every outcome that names the Explorer links to `#/explorer?address=<wallet>` [F-38] | everything above plus `priceOf`, the Quoter for the ETH swap, `sharedFact`, `pendingOf` |
| `#/fact-vs-artifact` | what a fact is | card vs credential; claimant vs holder; what an attestation proves; How to verify a card (links to the README); the comparison as rows, not a wide table [F-32] | none |
| `#/integrate` | for builders | ids and tiers; a Solidity example (a gate reading `hasTrait`, solc 0.8.24) and `cast` lines, every one naming the live addresses from the deployment file; a Copy button per code block and the sideways-scroll note under each [F-24, F-47]; contracts and getter check (the seven getters) | Registry getters |
| `#/whitelistcurator` | the record Sworn stands on | the lifetime window: three bands with deposits, new contributors and ETH (section 1); the per-hour chart (at 600 px and below: axis labels ≥ 11 px as HTML and bars ≥ 8 px, or no chart there) and the 66-row table with the ETH column before "First deposits"; the verified source lines 4 to 62 verbatim with line numbers in the muted colour; the hour-24 cliff and the hour-65 last deposit named [F-01, F-46] | none live; `reference/census/*` copied into `dist/data/` |
| `#/about` | why and who | WHY SWORN, Ownerless, NO COIN, BUILT BY THE SWARM, the note on the earlier deployments, the history and lore of WhitelistCurator.sol [F-18.1], links | none |

Per-route tab titles and anchors apply on a direct load (`#/claim#step-02`, `#/claim?trait=N` scrolls to and
highlights the row, 1201 to the shared-fact block) [F-33]. The header: hive brand at the left, named page links, one
Connect control at the right; at 600 px and below the address placeholder reads "0x… (42 characters)" [F-49].

## 5. Behaviour the site must have (and how the entrant checks it)

| id | requirement | verify |
|---|---|---|
| S-1 [F-05] | eight routes, live reads over the chosen public RPC, en-US numbers, no console error and no horizontal overflow at 1280 and 390 px | `site-check pages` |
| S-2 [F-06] | one-click wallet connect: EIP-6963 providers and `window.ethereum`, a bottom sheet below 640 px, focus containment, Escape and backdrop close, wrong chain offers "Switch to Ethereum", connected state shows the short address and Disconnect | `site-check connect` |
| S-3 [F-07] | a registered kind-3 spec is requested and applied under its own id, never 1201, never through `upgrade`; the spec id is read from the receipt (`SpecRegistered`) or the return value, never predicted | `site-check kind3` |
| S-4 [F-08] | replaced or lost broadcasts: a recover form takes a hash; a replacement transaction is never shown as confirmed; a reload never resends a transaction | `site-check replace`, manual |
| S-5 [F-09] | pay with ETH: an exact-output swap for the IMD a flow needs, 1 % maximum input over the quote, 120 s deadline, exact approval only, refunds shown; the IMD route is the default | the builder's fork run, recorded in `web/TEST-NOTES.md` |
| S-6 [F-23] | a wallet with `tokenOf == 0` gets the Renderer's live preview of its facts, labelled "preview, no card minted", drawn by `eth_call` (a Renderer view that takes the wallet, or an `eth_call` with a state override whose slot is read from the build's `storageLayout`, never a typed constant); a minted wallet gets its own `tokenURI`; a metadata decode error shown in place of a result is a blocker; checked before and after a mint by a test that performs the lookup | browser test in `web/tests/` |
| S-7 [F-21] | no token-id text in any shipped SVG: the sample card and the trait previews are generated against the deployed Renderer by a script in `web/scripts/` at build time; `grep -l '>#[0-9]*</text>' web/public -r` finds nothing; in a run where the Renderer does not answer, leave the files, say so in `web/TEST-NOTES.md`, never a `needs_input` | site test |
| S-8 [F-24, F-25] | no page, sample or example names an earlier Registry except the About note of section 3; a search for `39bec764`, `dd0017e4` and `9cb36ecc` under `web/src` and `web/public` finds only that note; the About note is present and worded as section 3 says; no "v1", "v2" or "pool" anywhere in the copy | site test, `grep` |
| S-9 [F-27] | the registration copy states the cost from the live `priceOf` at the moment of the click and says it can change | manual |
| S-10 [F-28] | no oracle fact is offered that cannot be true for the wallet (Explorer and claim step 02): for a wallet outside WhitelistCurator, ids 701 to 1105 and 1201 show "cannot be true: not in WhitelistCurator.sol" with the prepare button disabled for that reason; 1301, 601 and community ids stay requestable; "It does not mean the fact is false" appears only for requestable ids | with `0x…c1a1` connected at 390 and 1280 |
| S-11 [F-29] | each prepare, apply, register and mint button shows its own busy, error and success line (`role=status`) directly under itself; a journal step whose simulation or send fails shows the error under that step and changes its state word from "ready" | step 03 with an invalid spec at 390 |
| S-12 [F-30, F-18.13] | the oracle acknowledgement checkbox sits with the first gated button, one shared state; every disabled reason that names it is a link that scrolls to and focuses it; buttons for facts that cannot be true stay disabled whatever the checkbox | at 390 the checkbox and the first gated button fit one viewport |
| S-13 [F-31] | the mint block on connect: the wallet's own preview or its minted card with "Mint card" disabled and the reason | connect a wallet that minted (read-only) |
| S-14 [F-32] | no data table scrolls sideways at 390 px (section 2, principle 11) | every route at 390 with an overflow probe and a screenshot per table |
| S-15 [F-33] | the route handler runs once after the first render: tab title per route, anchors scrolled into view on a direct load, `?trait=N` highlighted | direct loads at 390 and 1280 |
| S-16 [F-35] | "Exact amount" lists every selected id with name and per-fact price ("701 Uptime · 0.5 IMD"); the journal heading names its subject ("Request 1 oracle fact: 701 / Uptime") with a link "from step 02"; the step shows "Prepared, see Transaction steps" linking to the block | prepare two facts, read the block before signing |
| S-17 [F-36] | the paid-upgrade picker row: checkbox, id and name, rule · window (citation style), class mark, 56 px mini preview; wraps to two lines at 390 with the preview on the right | step 02 at 390 |
| S-18 [F-37] | caught errors use the danger colour; the journal's state word is coloured by state (danger for failed, rejected, unknown; accent for confirmed; muted otherwise) | "Insufficient IMD" renders in the danger colour |
| S-19 [F-39] | one IMD / ETH radio group in the accessibility tree, at the head of "Add traits", echoed as text beside each prepare button ("Pay with: ETH") | accessibility tree |
| S-20 [F-40] | the mint button carries the same verb as the other prepare buttons; while no wallet is connected a Connect button (the header's handler) stands inside the transaction block | unconnected at 390 |
| S-21 [F-42] | headings: the claim steps are h3 under the h2 "Add traits" with accessible names "Step 0n · title" (the numeral visual, aria-hidden); Tab order brand, menu, Connect | Tab order at 1280; the accessibility tree of the claim route |
| S-22 [F-43] | small type: nothing instructional at 10 px; `.source` and table headers at 11 px; the Curator excerpt's line numbers in the muted colour; 24 px targets for block-level citation links | computed styles on claim and whitelistcurator |
| S-23 [F-44] | every CATALOG citation links to its own section anchor; Registry constants link to the Registry's source or read tab; no two different citations share one href | the citation hrefs on the catalog |
| S-24 [F-45] | the claim h1 equals the menu label; the mint heading is a 15 px h2 "Mint your Sworn card"; the lead sentence of section 3 | headings at 1280 |
| S-25 [F-46] | the WhitelistCurator chart and table at 600 px and below as section 4 says | screenshot at 390 |
| S-26 [F-47] | a Copy button per code block on Integrate and the sideways-scroll note under each | 390 |
| S-27 [F-48] | the catalog's cost boxes read `priceOf` live or state "the live oracle price per fact"; no dated price anywhere | the catalog copy |
| S-28 [F-49] | the address input's placeholder at 600 px and below cannot be mistaken for an address | 390 screenshot |
| S-29 [F-50] | CSS: `th { text-align: start }`; info boxes single-column at 600 px and below; secondary buttons with a visible hover and active (text and border colour on hover, accent fill and dark text on active); the footer's "Public RPC" label unbroken; the connect sheet's border in the faint token and a 20 px close glyph; selects beside a card capped at 650 px; type sizes and a 4 px spacing scale as tokens; a 15 px prose rule on a `.prose` class | computed styles |
| S-30 [F-19.4] | the shared-fact block states the cost in words above the request button: one attempt at panel 11 / quorum 7 costs the full price (`priceOf` now), an attempt whose panel misses the quorum refunds nothing; the attempt count and the last panel result are read from the Registry's events (`SharedFactStored`, `Missed`, `NoVerdict` for the fact id) | manual |
| S-31 | the Swarmed copy of section 3 everywhere the trait is named; the claim guide offers it as a paid upgrade with the living-window note; the Explorer shows the window a verified 601 was asked with | manual |
| S-32 | every fee line says the fee is forwarded to the BurnExecutor for bridging and burning on Base (BurnExecutor V2 named once, on About and in the catalog's cost boxes), never "burned" alone; there is no sponsor pool, free claim or donation anywhere: over `web/` (source, tests, config, public files, the export; `package-lock.json` and `node_modules/` excluded, since npm's funding links name `github.com/sponsors`) `grep -rniE 'sponsor\|donat'` and `grep -rniE '\bpool\b\|pool\(\)\|poolUsed\|lastPoolDay\|PoolSpent\|PoolDraw'` print nothing (Uniswap's own identifiers in swap code and vendored ABIs, `poolManager`, `PoolKey`, `poolId`, do not match and stay; copy that calls the ETH/IMD market "a pool" is reworded). No burn status block: no `previewBridge` read, no "waiting IMD" figure, no LayerZero fee quote, no burn journal outcomes (`docs/DESIGN.md`'s "burn reasons" belong to the earlier design and are void), no `payable` call path; at most the executor's pending amount once on About beside the fee sentence | `grep` |
| S-33 [F-02, F-03, F-04] | the fixed copy of section 3 appears word for word where section 4 places it, the headline included; the builder changes no fixed text | site test |
| S-34 [F-18.9] | an agents page: `#/agents` or a block on Integrate that serves the fact-vs-artifact rules as a Markdown skill file a coding agent can read (`dist/agents/sworn.md`): what a fact is, `hasTrait` not `ownerOf`, the ids, how to verify a card | the file exists in the export and is linked |
| S-35 [F-11, optional] | if the budget allows after S-1 to S-34 and S-36: a live claims feed on the landing (the Registry's `CardMinted`, `Verified`, `Missed` with reason text, `SharedFactStored`, `SpecRegistered` from the launch block, newest first, with the attestation link where one exists); otherwise `web/TEST-NOTES.md` says it was left out | manual |
| S-36 | the community spec form (step 03) checks before the transaction what `validateSpec` checks (`CATALOG.md` section 5): the item grammar, no `anonymous`, `arg` an indexed `address` parameter of the event, `fixedArg` an indexed parameter, `sumArg` a parameter, the window bounds; a refused field is named with the reason in words beside it, and the register button stays disabled while one is refused | site test with the audit's two cases (`arg = "amount"` on `Deposited`, a data field; `arg = "zzNotAField"`) and a prose-padded item |

The self-hosted extended site of the entrant (rows F-10, F-12, F-13, F-18.5, F-18.7, F-18.10 of the entrant's file)
is not part of this build.

## 6. Acceptance (the entrant checks these before accepting a delivery)

1. `site-check --dist dist --registry <new Registry> --steps <a steps file written for this DOM>`: pages PASS, connect
   PASS, kind3 PASS; replace PASS or INCONCLUSIVE with the manual pass recorded.
2. Section 3 texts appear word for word where section 4 places them, the headline included.
3. WhitelistCurator page: the three bands with all three figures from section 1; the 66-row table sums to the band
   figures; the quoted source equals lines 4 to 62 of the verified contract; the page names the hour-24 cliff and the
   hour-65 last deposit.
4. Explorer answers for three public contributors and a stranger equal `cast call` against the Registry; a wallet
   without a card gets the Renderer preview labelled as such; a wallet with a card gets its own `tokenURI`.
5. No request to `api.imd.fun` in the network panel on any route; every script and asset is same-origin; no console
   errors; the export opens from IPFS exactly as from `dist/`.
6. Every address on the site is in section 1, from the deployment file, or `0x…c1a1`; no owner wallet or seat.
7. Claim guide: prices read live, "spent whatever the answer" stated and acknowledged, the 6.4 IMD spec fee stated
   as forwarded to the BurnExecutor for bridging and burning on Base, `maxPrice` pinned, exact approval only, the three
   steps numbered 01 to 03 with every link following; S-36's field checks refuse the audit's two cases.
8. The rows S-10 to S-14 checked by hand on a phone at 390 px; every row of section 5 has its verification in
   `web/TEST-NOTES.md`, and every browser test runs from the repository with `npm test`.
