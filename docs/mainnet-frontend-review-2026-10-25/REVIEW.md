# Sworn mainnet candidate — independent source review

Date: 25 October 2026. Reviewer: Code Reviewer agent. Target: `sworn-mainnet-site/`, derived from the revised mock and compared with the pristine frontend at `55475816f2b5d548a3e89a9a4042b02539ced51b` in `evidence/upstream/web/`.

## Verdict

**PASS for the scoped integration/source review. No unresolved material source finding remains after the corrections below.** The separation into models, controllers, data adapters and React views is bounded and preserves the existing loading interfaces. This is not a contract audit, payment authorization, publication approval, or proof of a real paid mint/oracle round.

The review inspected source and build/package logic, independently ran 16 focused tests, and inspected the root's final typecheck, 184-test and build records. The root owns browser verification, archive extraction/rebuild comparison, preservation checks and public RPC evidence; these are not represented here as independently repeated measurements.

## Findings resolved before completion

### P2 — A fresh failed metric read inherited stale data

`web/src/models/curator-live.mjs:32` initially retained old non-null numeric metrics when a newer current read returned null. The merged row carried the newer block number, so numeric filtering could use an older value without its original provenance.

The final merge preserves the chosen current row's complete metric set, including unknown/null values. Historical discovery cannot overwrite a current record. A targeted regression test now checks this case and passed independently during this review. Range filtering excludes unknown bounded metrics; the final UI also counts unresolved bounded reads rather than calling them ineligible.

### P2 — Packaging could pair current source with stale static output

`package-release.py:14` initially ran only `verify:export`. That checked the built files against their own manifest, but could accept an old build after source edits.

Packaging now runs the normal build before export verification and archiving. Build failure stops packaging. The deployment handoff explains this enforced order. The root is separately checking extraction and rebuilding of the source archive.

### P3 — Mock wording remained on live routes

The wallet request history still described scripted results, mock IMD and a mock receipt; rule validation described a local Composer fixture. These strings were corrected in `wallet-facts.tsx` and `claim.tsx`. The final reachable source scan found no fixture transport or misleading mock/scripted wording. `mock:false` remains only as an explicit data-schema discriminator, not as a simulation path.

## Integration checks

| Area | Result and evidence |
| --- | --- |
| Runtime and mainnet binding | Startup no longer installs global mock interception or rewrites explorers. The existing chain-ID, contract bytecode, ABI and dependency checks remain in `chain.ts` and `runtime-integrity.mjs`. Build input hashes bind the five public ABIs, deployment/network and preview files without requiring unavailable Git ancestry. |
| Wallet selection | The original injected/EIP-6963 and Coinbase paths are restored. The selected live connector supplies the provider. No mock provider is reachable. |
| Submission | The controller requires simulation and a positive gas estimate, refreshes fees/allowance and checks the actual account/network. Its provider guard rechecks account, chain and connector immediately before `eth_sendTransaction`. There is no automatic signing path. Approvals remain bounded to the prepared amount. |
| Receipt recovery | Sender, nonce, target, value and calldata are checked for replacement/recovery. A different replacement or cancellation is not a successful mint. Deployment-bound mainnet storage namespaces cannot restore the old mock journal. |
| Swarm loading | `oracle-progress.mjs`, `oracle.mjs`, `settlement.ts`, RPC/runtime adapters and historical eligibility loader are byte-identical to pristine upstream. `page-reads.mjs` adds explicit invalidation. Request matching, chain events, API detail loading and fallback recovery remain intact. |
| Progress authority | Live panel responses drive progress only. A matching Registry event plus `hasTrait` is required for the successful wallet-fact state. Missing/failed answers are not fabricated approvals. Shared-list storage is distinct from wallet application. |
| Settlement transport | Recovery reads completion calldata from Ethereum rather than depending on the non-CORS attestation endpoint. The existing Registry simulation authenticates the candidate settlement. |
| Curator and Explorer | Arbitrary addresses, including wallets without cards or census membership, reach real Registry reads. Historical shards and optional full census are discovery evidence, never accepted credentials. Unknown reads remain unknown; exports carry evidence mode and per-wallet block information. |
| Async behavior | Scoped reads and controller cancellation prevent late results from replacing a newer wallet/rule selection. Current filters and read provenance are distinct from fixed exported-list membership. Full-census admission checks count, uniqueness and the pinned closing block. |
| Static export | Hash routes, relative assets, public data, agent reference and Docs remain bundled. The export gate rejects fixture transports and root-relative entry assets; manifest limits remain enforced. Packaging excludes dependency symlinks and rejects non-regular selected files. |
| MVC/KISS | Transaction orchestration is separated from its view and journal model. Curator has a data/model layer and a loading controller. Existing focused adapters remain in place. No server or framework rewrite was introduced merely to satisfy MVC terminology. |

## CROPS review

- **Censorship resistance:** the chosen static frontend can be mirrored; public RPC providers can be selected separately. RPCs and IMD can still deny service. IMD progress availability does not override settled Registry facts. New oracle verification still depends on the existing fixed protocol infrastructure.
- **Open source and freedom:** original MIT licensing, contract/ABI references, lockfile, portable build inputs and source archive are retained. No private backend or secret configuration is required. Reproducibility evidence belongs to the root's archive build check, not merely to this source inspection.
- **Privacy:** wallet addresses, facts and transactions are public. RPC and API services can observe requested data and client network information; the existing wallet connector SDKs remain external dependencies. This review does not certify SDK telemetry behavior or anonymity.
- **Security:** keys remain in the user's wallet. Exact approvals, simulation, positive gas estimation, chain/runtime checks and submission-context validation are retained. Oracle acceptance and semantic correctness are separate trust boundaries. Direct contract calls and the inspectable ABI/source remain alternate access paths if a frontend or progress service disappears.

## Verification and limits

Independently executed `curator-live.test.mjs`, `mainnet-runtime.test.mjs`, `release-pin.test.mjs` and `static-release.test.mjs`: **16 passed**, including cardless/outside-census facts, unknown responses, cancellation, stale-metric prevention, connector isolation, signing-context checks and build/export guards. Root logs show **184 unit tests passed**, TypeScript passed, and the mainnet static export gate passed.

The root's dated RPC capture at block `26267034` records Ethereum chain 1 and matching runtime hashes for Registry, Composer and Renderer. The reviewer inspected that record but did not independently repeat network requests. No reviewer signing, transaction, payment, oracle execution, push or publication occurred. Browser accessibility, real wallet execution, full-census provider performance and future public hosting remain outside this source-review verdict.
