# Mainnet Curator and Explorer implementation

Scope: new `sworn-mainnet-site/web/` only. The original and revised mocks are unchanged. No transaction, signature, oracle execution or public write was performed by this worker.

## Data and UI separation

- `src/models/curator-live.mjs` contains the independent data adapters and three-state result composition. It validates the original Swarm-generated eligibility shards by their bundled byte lengths/SHA-256 hashes, reconstructs candidate-only rows, validates a complete FirstDeposit census, reads current wallet facts with injected Registry/Curator readers, and merges results without making failed current metrics inherit old values.
- `src/controllers/useCurator.ts` owns asynchronous work, explicit refreshes, cancellation/deadlines, the site client and deployment binding, and React state. It uses the existing resilient RPC/scoped client and deployed ABI/runtime references. It does not install a new backend or proxy.
- `src/curator-model.mjs` retains pure AND/OR selection, weights, exact-wei ranges, consumer examples and CSV/JSON serialization. It excludes historical-only rows from current credential selection, preserves unknown responses and exports per-wallet checked blocks.
- `src/curator.tsx` is the presentation layer. Its forms/tabs call the controller and display the model results. Existing styles and accessible tab/field labels remain.
- `src/pages.tsx` restores Explorer to arbitrary address reads through `lookup` and a scoped client while retaining clickable card families and community fact links. It no longer imports fixture wallets or calls a local mock directory.

## What the visitor can do

The initial directory uses the same sixteen hash-pinned historical eligibility shards shipped by the original frontend. These contain wallets matching nine fixed event predicates, not every one of the 19,522 historical participants. They are explicitly candidate evidence, never accepted Registry credentials.

**Load all 19,522 game wallets** is optional. It checks the mainnet Curator binding and pinned closing block hash, then uses the existing RPC pool to read FirstDeposit events over the exact game window. Duplicate addresses/indices, removed or malformed logs, an incomplete count and out-of-range indices fail the whole census. A full census adds first-hour/index research metrics. Current facts still require a Registry read.

**Add or refresh any wallet** reads `hasTrait` for the current catalog and discovered community definitions at one current block. Cardlessness and absence from the historical census do not prevent the read. Card metadata, original-wallet facts and underlying historical metrics are kept separate. Wallet checks run only when requested, with up to 50 matching candidates per batch and a two-minute deadline. A batch can be cancelled; completed reads retain their block while unfinished rows remain unchecked.

**Consume facts** is a separate direct check for any address against selected Registry IDs. It does not depend on directory membership or NFT ownership. OR can succeed on one confirmed positive even if another read is unknown; AND requires every fact positive. Required unknowns remain unknown, not false. No oracle is triggered.

Current exports include only matching checked rows, with the read block/time and explicit unknown fields. Unresolved rules or bounded metrics are counted visibly and excluded from the current selection without claiming ineligibility. Historical exports remain labeled as candidates. Both exports include the contract/deployment source and complete selection, not only the 50-row preview. Exact exported membership is separately testable from a current fact rule.

Explorer accepts any Ethereum address and uses the deployed Registry/Curator/Renderer path, including the existing read-only state-override preview for unminted wallets. It preserves the original live asynchronous settlement/Swarm components and all clickable family links. No fixture scenario is displayed as mainnet data.

## Verification

The new adapter tests were first run before implementation and failed because the module did not exist. Eight adapter tests now pass, covering shard integrity and failures, cancellation, cardless/outside-census community eligibility, unknown responses and three-state OR/AND, complete/unique census validation, merge behavior and the stale-metric regression.

Twelve pure-model tests pass, including original filtering/export behavior adapted to mainnet evidence and a new unknown-range/current-vs-history regression. **20 focused tests passed** in total. `npm run typecheck` passed after the production Explorer/Curator changes.

The source reviewer identified a stale-metric merge issue: a current read returning null could inherit an older non-null metric under its new block. A failing regression reproduced it, and the fix now gives each newer current row ownership of its full metrics set, including null. Historical merges never replace an existing current record.

Browser testing, mainnet read evidence and full inherited-suite/build verification belong to the parent task and are recorded separately. No screen-reader or live-transaction acceptance is claimed here.

## Deliberate limits

This is a static frontend, not a new global indexer. A historical directory cannot discover every later community-fact holder; arbitrary address checks remain available. A fresh visit reloads historical candidates and requires new current reads; saved filter/export metadata is retained separately. Unknown metrics do not become zero. Provider failures may prevent the optional full census or some current reads; no sample fallback replaces them.
