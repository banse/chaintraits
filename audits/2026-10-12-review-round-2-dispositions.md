<!-- copied from the entrant's workspace on 2026-10-19; the repository was banse/chaintraits at the time -->
# chaintraits brief, review round 2 (Codex): findings, re-measurement, dispositions

Reviewed target: `github.com/banse/chaintraits` at `7ad6f93613175e6a42391b3df5d126df4994ee00` (after round 1).
Review record: the entrant's private review folder (`review.md`, `verification.md`, `adversarial-test-plan.md`, `evidence/`). Verdict there: "changes required before freezing the swarm brief";
17 findings: 4 blockers, 10 should-fix, 3 nits. Applied in commit `f6c52f9101619aaf56ae47c7b886d17b63ff5c82` on 2026-10-12.

## What I re-measured before acting (all free reads, no payment)

- **Finding 1 is worse than the reviewer could show offline.** The signed `requestId` is the plane's UUID
  (`0x03f89e74…` right-padded), never the Intake id, on all five status-0 completions on mainnet (decoded from
  `complete` calldata). Round 1's check "`a.requestId == requestId`" would have made every real callback a miss.
- The EIP-712 `verifyingContract` is the body's `consumer.verifyingContract` (two third-party attestations verified with
  `cast wallet verify` under that domain, refused under zero). One of them names a consumer that is not the callback
  target. Round 1 assumed the callback target.
- The plane's `questionHash` is `keccak256` of an RFC 8785 document (`v, chainId, question, definitions, answerType,
  window{fromBlock,toBlock}`, `head` if present, `evidence` if panel). Found by brute force against two known hashes,
  confirmed on twelve more free quotes; the x402 pilot's quote hash equals its attested hash. A live mainnet consumer
  (`SwarmFeed`) recomputes it onchain. This gives the authenticated body commitment the reviewer asked for.
- **The plane moved to Intake v2** (`0xa43e6f75ee006411f79ac1c84120606c2330de82`; v1 is `legacyIntakes`). v2 adds a
  failure hook (`requestWithFailure`, `onFailure(requestId, status, reason, agreed, answered, signature)`), which
  closes the "status 1 and 2 nothing arrives" gap. Record: `docs/imd-api-changelog.md`, 2026-10-12 entry.
- All ten regenerated fixture bodies passed `/requests/check` (zero blockers) and a free `/requests/quote`, with every
  canonical window pinned unchanged. Responses vendored under `reference/plane/`.

## Dispositions

| # | finding | severity | position | what changed |
|---|---|---|---|---|
| 1 | consumer callback binding unproven | blocker | **accepted, and measured as a real mismatch** | check 1 no longer compares `a.requestId`; the signed id is stored as `oracleRequestId`; new check 7 binds through `pending.questionHash`, computed onchain when the body is composed; the body carries `consumer`; two consumer-domain attestations vendored (`reference/attestations/`), five decoded completions (`reference/intake/completions.json`) |
| 2 | community specs can drain the pool via guaranteed misses | blocker | **accepted** | `payForward(wallet, traitId)` removed; `claimSponsored(traitId)` is a self-claim by a Curator member for one of the nine catalog chain traits, once per pair ever (`poolUsed`), from day 30; `upgradeSponsored` is catalog-only (k at most 9); community specs, panel and shared facts are never pool-funded; the economic policy is stated in CONCEPT 4 and DISCLOSURE |
| 3 | OZ `EIP712` has seven immutables | blocker | **accepted** (reviewer's runtime probe) | domain separator computed at verification time with `block.chainid` and `address(this)`, `MessageHashUtils.toTypedDataHash`; a test asserts empty `immutableReferences` and byte-identical runtime across two deployments |
| 4 | malformed T3 bytes permanently disable a shared fact | blocker | **accepted** | the callback validates the canonical `abi.encode(address[])` envelope (offset, length 1..64, clean words) and stores `(requestId, hash, n)` only on success; a bad envelope is reason 9 and leaves the fact requestable; `applySharedFact` uses `list[0..min(head, n))` |
| 5 | legacy 12-field acceptance contradicts the quorum invariant; no wire format | should-fix | **accepted; legacy support dropped** | one shape only; a different wire tuple fails to decode and is `delivered == false` at the Intake; `Verified` loses its `shape` field; a struct change is listed as a kill risk |
| 6 | `ECDSA.recover` reverts | should-fix | **accepted** | `ECDSA.tryRecover`, errors mapped to reason 2; the non-revert promise is scoped to envelopes that decode |
| 7 | no transition table | should-fix | **accepted** | INTEGRATION 4b: every outcome, who, what is cleared, what is stored, what is emitted; the reverse index is cleared only when it equals the stale id; no "recorded miss" flag; a miss never blocks a paid retry |
| 8 | Early bird ids reverse the tier order | should-fix | **accepted** | 201 = hour <= 1 (516), 202 = hour 0 (96); the card shows 202 when both hold |
| 9 | Operator contradicts invariants 8 and 10 | should-fix | **accepted** | 601 declared live; invariant 10 narrowed to families 1 to 5; IDMD `balanceOf` added to `tokenURI`'s inputs; INTEGRATION's "cannot change" sentence corrected |
| 10 | T5 nonce and explorer methods differ | should-fix | **accepted** | T5 asks for the account nonce only; the explorer alternative and the "sent at least N transactions" paraphrase are gone; both fixtures regenerated, checked and quoted; the 2026-10-11 attested wording is superseded (noted as open in CATALOG 8) |
| 11 | pool balance invariant ignores donations | should-fix | **accepted** | the pool is the IMD balance; no counter; invariant 9 restated as "the balance never decreases except through the two pool paths" |
| 12 | community metadata unbounded | should-fix | **accepted in part** | only the claimant can grow their own index (follows from 2); the JSON lists at most 32 community ids plus a count; `verifiedSpecsOf` returns all; a pair cannot be verified twice |
| 13 | `fs_permissions` lacks `reference/attestations` | should-fix | **accepted** (reviewer's probe) | `reference/{attestations,intake,plane}` added read-only; the name-to-code mapping for `answerType` is required of the loader |
| 14 | "self-contained evidence" overstated | should-fix | **accepted in part** | vendored: block headers, check and quote responses, questionHash goldens, decoded completions, Intake v2 source; PROVENANCE gained a "measured, not vendored" section for the census, Curator semantics, token internals and plane behaviour |
| 15 | T5 `(hex of <N>)` not byte-exact | nit | **accepted** | `<NH>` placeholder defined (lowercase `0x` hex) |
| 16 | wording conflicts (arities, T3 storage sentence, fixture provenance, invariant 3 scope, item 12) | nit | **accepted** | all corrected; invariant 3 covers any T3 id; item 12 is a harness note; all ten fixtures are now checked and quoted |
| 17 | font path and an address vector in the vendored test | nit | **accepted** | `CHAINTRAITS_FONT`; the vendored `Renderer.t.sol` vector replaced by a synthetic one and the edit recorded in PROVENANCE |

Trust/exit note (pool donors have no exit; "no IMD can sit stuck" was not a guarantee): accepted, the sentence is
gone and DISCLOSURE states the donation. The reviewer's adversarial test plan (41 tests) stands as the base of Codex's
suite v1; four of its "blocked oracle" items are now frozen (tier order, 601 inputs, pool surplus, T5 hex).

## Not done, and why

- A real request from this registry (the only thing that proves the end-to-end path with the registry as consumer) is
  paid work: planned for the Sepolia rehearsal, then mainnet before the candidate freeze. The two third-party
  consumer attestations are the closest free evidence and are vendored.
- The 2026-10-11 T5 attestations no longer match the T5 text; a paid re-attestation of the new wording is part of the
  rehearsal.
