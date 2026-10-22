# Current A–E evidence

See [ae-results.json](ae-results.json) and [current test notes](../../web/TEST-NOTES.md) for this delivery. The captures [home](screenshots/ae-home-390.webp), [payment dialog](screenshots/ae-mint-dialog-390.webp) and [card #1](screenshots/ae-owned-card-390.webp) are from actual Chromium with fake wallet/RPC fixtures. The older records below are historical. Two archived screenshots are now lossless WebP with identical decoded pixels to meet the submission budget.

# Frontend evidence

The implemented design is documented in [../DESIGN.md](../DESIGN.md). Installation and rebuild instructions are in [../../web/README.md](../../web/README.md). The consolidated requirements and six-domain review are in [../../web/TEST-NOTES.md](../../web/TEST-NOTES.md).

| Record | What it establishes |
| --- | --- |
| [live-deployment.json](live-deployment.json) | Mainnet code hashes match the pinned Solidity compilation; seven getters and observed Intake price |
| [independent-reads.json](independent-reads.json) | Four wallets × 25 frontend results match independent `cast` calls, with `tokenOf` and preview metadata hashes |
| [browser-results.json](browser-results.json) | Eight routes at five widths, primary Chromium/WebKit interactions, no observed page/console/local-resource errors |
| [fork-results.json](fork-results.json) | Seventeen isolated-fork checks, real swap/refund/mint/request transactions, browser rejection/reload/replacement/outage and quote/price guards |
| [taste-results.json](taste-results.json) | Pinned taste@1 output: 14/16, with the two deliberate specification overrides explained in TEST-NOTES |
| [delivery.json](delivery.json) | Final export, ABI/manifest, build/typecheck, source-scope and byte-budget summary |
| [revision-results.json](revision-results.json) | Reproduced review findings, Chromium/WebKit regression checks, held-read scroll measurements and final revision integrity checks |
| [explorer-health-results.json](explorer-health-results.json) | Current revision: reproduced null-health crashes, RPC switching, failed health reads, keyboard/scheduled recovery and successful-refresh retention in Chromium and WebKit without a wallet fixture |

Selected screenshots are actual production-export captures. [Home at 390 CSS pixels](screenshots/home-390.webp) and [home at 1440](screenshots/home-1440.webp) show the first screen. [Explorer](screenshots/explorer-390.webp) uses a public contributor. [Integrate at 320](screenshots/integrate-320.webp) shows the corrected source-hash wrapping and intentionally scrollable code. The [minted state](screenshots/minted-fork-390.webp) is explicitly from the isolated fork with its test wallet, not evidence of a mainnet mint. The [mobile wallet picker](screenshots/wallet-390.webp) uses an emulated phone viewport; physical app handoff and passkey creation remain unperformed.

A real successful settlement for the newly deployed Registry and the requested recorded Sepolia failure replay remain unverified. The delivered recorded-mainnet completion fixture checks decoding and RPC retrieval, not signature acceptance by this Registry. All limitations and fixture distinctions remain in TEST-NOTES.

The revision screenshots show the [prepared journal](screenshots/revision-journal-390.webp), [request price](screenshots/revision-price-390.webp), [acknowledgement focus](screenshots/revision-ack-390.webp) and [retained reading position](screenshots/revision-refresh-390.webp). They are actual captures of the revised static export. Journal preparation uses a read-only injected test wallet and the explicit balance fixture; no signature or mainnet broadcast occurs.

The current health revision shows [an outage with keyboard focus on Retry reads](screenshots/explorer-outage-390.webp) in Chromium and [the recovered Explorer](screenshots/explorer-recovered-webkit-390.webp) in WebKit, both at 390×844 with no injected wallet. Earlier fork and transaction evidence above is retained; those transactions were not repeated for this render-guard change.
