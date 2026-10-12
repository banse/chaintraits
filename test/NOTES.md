# Test notes: review follow-up (a) to (h)

Continues the accepted build and test job. No deployment or launch was performed. The frozen ids, windows,
question templates, request/attestation fixtures, canonical questionHash document, quorum predicate and pool
rules are unchanged. Only the requested rendering template and its generated goldens were regenerated.

## Changes and reasons

| change | implementation and reason | regression coverage |
|---|---|---|
| (a) Bound callback inputs before copying/hashing | `_check` reads calldata lengths first: signature other than 65 bytes is reason 2; answer over 2,112 bytes, or not exactly 32 for a pending bool/uint256 kind, is reason 9. After those checks: chainId, signer, type, panel/quorum, window, expiry, questionHash, defensive decode and rule. Valid-length signature words are loaded directly from calldata for OpenZeppelin's `tryRecover(v,r,s)` overload, preserving its high-s/v checks without a memory copy. The redundant later scalar length check was removed. This prevents a single oversized, ABI-valid callback from exhausting the Intake stipend and locking the pair for 14 days. The exact precedence is in `INTEGRATION.md`. | `ReviewChanges.t.sol`: 262,144-byte signatures and answers, simultaneous errors, 64/65-address boundary, scalar lengths 0/31/33/2,112/2,113, wrong claimed type, full diagnostic precedence, unknown/stale request, and successful immediate retries. Calls go through the mock Intake's 200,000 stipend with Registry storage cooled. Existing signature-shape, malformed-envelope and worst-case success tests remain. |
| (b) Ordinal is not a tier family | `cardOf` keeps the first ascending id for family 11, so the lowest verified ordinal appears in both SVG and the Ordinal attribute. Tier families still use the highest id. | Fuzzed subsets of all five ordinals, acquired in descending order, including no ordinal; checks card slot, JSON attribute, SVG and the other tier maxima. |
| (c) Community traits in standard attributes | Each of the first 32 verified community ids now has `{"trait_type":"Community <id>","value":"<escaped spec name>"}` in `attributes`. `community_count` retains the full count, and the custom id array remains. Names come from the already bounded oracle metadata; the Card ABI is unchanged. Generator, 36 splice offsets, template blob and all three goldens were regenerated. The renderer-only width case now shows ordinal 1101 and supplies names for all 32 ids and checks hostile-name escaping for each. | The existing 34-spec test now parses all 32 id/name attributes and the full count, and refuses a 33rd displayed entry. Solidity golden tests and Python generator tests cover zero, one and 32 community attributes, escaping, and byte-exact JSON/URI output. |
| (d) Label metadata minima correctly | Oracle JSON keys are `minPanelSize` and `minQuorum`. The ABI tuple retains its existing field names and types; comments clarify their meaning. The README identifies `/oracle/requests/<oracleRequestId>/attestation` as the source of the signed panelSize/quorum/agreed values. No additional callback storage or quorum rule was introduced. | A signed panel of 30, quorum 20, agreed 22 verifies for chain and panel traits; metadata still reports minima 5/3 and 11/7, excludes the old JSON keys and preserves oracleRequestId. |
| (e) Reject an unused nonzero fixedVal | T1/T2 `validateSpec` reverts `BadSpec("fixedVal")` when fixedArg is empty but fixedVal is nonzero. The serialized question omits an empty filter, so the stored value must not imply one. | Fuzzed nonzero values (including uint256.max), both kinds; rejection leaves fees and nextSpecId unchanged. Empty/zero and named filters matching zero or nonzero remain accepted. |
| (f) Require a settled Curator | The constructor requires `curator.isSettled()` with a passive view call. This enforces the assumption that Curator-derived facts are final. Addresses remain constructor-only ordinary storage. Deployment documentation now describes the required settled chain state. | `Artifacts.t.sol`: settled deployment succeeds, false/reverting/no-code Curators fail, and zero-address guards remain. Artifact and served-attestation test deployments now use actual settled mocks. |
| (g) Restore Registry runtime headroom | Catalog enumeration and the unchanged direct-read predicates moved into Composer. Registry keeps every existing public function and its ABI, forwards view work using STATICCALL, and still performs all callback verification locally. The name table and spec guards were already in Composer. No immutables were added. | Artifact ABI comparison retained every pre-change entry for all three contracts. `test_twoDeploymentsHaveIdenticalRuntimeCode`, `test_noImmutableReferencesInAnyArtifact`, no-forbidden-opcodes checks, direct-read fuzzing, goldens and invariants remain. The Registry size assertion now enforces 23,076 bytes. |
| (h) Wrap the clipped footer | The evidence legend ends its first line after “shared fact;”; the claimant caveat continues on the second line. The sybil caveat and source credit occupy a lower baseline with a clear gap. No wording was removed. | All three regenerated SVG goldens have the wrap. A local font-metric check with the card's installed DejaVu Sans Mono fallback placed every footer line within x=60..940 and below y=975, inside the border. The longest line ends at x=704.8; the sybil caveat ends at x=663.9, before the source credit starts at x=735.3. |

## Runtime sizes (solc 0.8.24, unchanged foundry.toml)

| contract | runtime bytes | EIP-170 headroom (24,576 minus runtime) |
|---|---:|---:|
| Registry | 23,027 | 1,549 |
| Composer | 23,455 | 1,121 |
| Renderer | 11,791 | 12,785 |

The Registry limit for this assignment is 23,076 bytes. All three deployed bytecode artifacts have empty
immutableReferences, and an artifact-wide scan found no nonempty immutableReferences. The measured personal
callback worst case (community append plus card refresh) is 164,954 gas. The existing 64-address shared result and
all five template success paths also pass through the Intake's real stipend; the shared/personal margin test uses
180,000 gas.

## Re-review and check notes

Review covered the changed validation order, signature loading, ABI decoding and bounds, pending/reverse-index
clearing, replay handling, Ordinal choice, community names/count/escaping, metadata provenance, spec fees and
ids on rejected registration, constructor preconditions, helper call graph and runtime determinism. No additional
contract defect was identified in this bounded re-review. The code movement adds static view calls only; it
introduces no authority, setter, external call in onResult, or money-moving path. Every pre-existing public ABI
entry was compared with the pre-change build, including tuple component names.

The full run exposed one pre-existing **test harness** defect: `FullHandler.upgradeSponsored` computed
`which + i` before reducing an unrestricted uint256 selector. The shrunk input was
`(12_242_742, uint256.max, 57)`, which overflowed inside the handler before reaching Registry. Selection now reduces
`which` modulo the catalog length before adding the bounded loop index. A deterministic regression exercises
that input with sufficient pool funds. This repair is necessary for reliable invariant runs and changes neither
production pool rules nor invariant assertions. No failing test was removed or disabled.

A disposable `test/scratch` harness compiled the original Registry source and reproduced both 262,144-byte
failures: the mock Intake reported not delivered and the pair stayed pending. The corresponding fixed-version
regressions deliver a Missed event, clear the pair, and accept an immediate retry. The scratch sources were removed
after this comparison.

The existing fork tests skip without their explicit RPC setting; this follow-up uses no RPC and does not refresh
live evidence. The prior round's fork claims below are historical. No Slither or Mythril run was performed; the
review used the supplied oracle/security references, source review, Foundry unit/fuzz/invariant tests and the
Python generator checks. This local re-review is not a new independent contributor audit.

## Final local validation

- `forge build --offline`: passes with the pinned solc 0.8.24 and unchanged build configuration.
- `env -u CHAINTRAITS_FORK_RPC forge test --offline -vv`: **90 passed, 0 failed, 11 skipped** across 10 suites.
  The 11 skips are the existing RPC-dependent fork tests. Both invariant groups pass with zero handler reverts;
  the extended handler also passes the exact max-seed regression above.
- `forge fmt --check`: passes.
- `python3 tools/gen_template.py --check`: all 12 generated artifacts match.
- `python3 -m unittest discover -s tools`: all 7 tests pass.
- Artifact scan: no nonempty immutableReferences; all original ABI entries retained; all three runtime sizes match
  the table above. Runtime identity and forbidden-opcode tests pass.
- `git diff --check`: passes. Build/dependency configuration, dependencies, question templates, request fixtures,
  served attestations, reference material and the canonical questionHash fixture are unchanged.

## Prior round 3 notes (historical)

This round added `test/Adversarial.t.sol`, `test/InvariantsExtended.t.sol` and `test/fork/Mainnet.fork.t.sol`
on top of the accepted suite. No implementation defect was found that needed a fix in `src/`; the review
observations that are not defects are listed at the end and in `.imd-findings.json` (info level).

## Running

```sh
forge test                                                        # hermetic: no RPC, no ffi; the fork tests skip
CHAINTRAITS_FORK_RPC=https://rpc.mevblocker.io/fast forge test --match-path 'test/fork/*'   # mainnet, block 26,170,000
python3 tools/gen_template.py --check                             # templates, offsets and goldens byte-exact
```

The fork tests were run on 2026-10-11 against `rpc.mevblocker.io/fast` and `ethereum-rpc.publicnode.com`: all
eleven pass. They never write the environment (`vm.envOr` only) and skip cleanly when the variable is unset, so
the verifier's no-network run is unaffected. The README's statement that fork tests are not delivered predates
this round (README.md is outside this task's write paths).

## CONCEPT.md section 6, invariant by invariant

| # | invariant | tests |
|---|---|---|
| 1 | `tokenOf`/`claimantOf`/`mintedAtBlock`/`verified` survive transfers | `Registry.t.sol` mint/transfer; `Invariants.t.sol`; `InvariantsExtended.t.sol` `invariant_oneCardPerClaimant`, `invariant_markedExactly…`; `Adversarial.t.sol` `test_tokenURIDependsOnlyOnTheClaimantsFacts` |
| 2 | one card per claimant | `Registry.t.sol` `test_mintOncePerWallet…`; both invariant suites |
| 3 | marked only after every check for exactly `(c, t)`; `hasTrait` = live rule or entry | `Adversarial.t.sol` cross-pairing tests (another claimant, another trait with the same window), `test_questionHashIsBoundToTheClaimantAndTheTrait`; `InvariantsExtended.t.sol` `invariant_markedExactlyWhenAPassingAttestationWasDelivered`; `Registry.t.sol` direct reads; fork: direct rules against the real Curator |
| 4 | consumed once; every wrong field is a miss, never a revert; other consumer/chain never accepted | `Registry.t.sol` `test_missReasons`, `test_attestationForAnotherConsumerOrChain…`; `Adversarial.t.sol` fuzz over every altered field, panel/quorum, window, expiry/skew, count and bool answers, five signature shapes (incl. high-s); fork: `test_fork_attestationSignedForAnotherConsumerMissesOnTheRealIntake`; `InvariantsExtended` `deliverTampered`, `replayConsumed` |
| 5 | Intake-only callbacks; `onResult` under 200,000 | `Registry.t.sol` `test_callbacksRejectEveryoneButTheIntake`, `test_onResultGasWorstCase` (164,696 measured); `Adversarial.t.sol` shared-fact 64-address envelope (gas logged, < 180,000), every template with a card through the mock's real `call(stipend)`, a starved callback stays pending; fork: real `complete` from the writer with the real stipend |
| 6 | tiers monotone | `Registry.t.sol` `test_fuzz_tiersAreMonotone`; fork: `_assertDirectRulesAgree` on three real contributors |
| 7 | specs immutable; bodies deterministic and byte-exact; `questionHashOf` equals the plane's | `Templates.t.sol` (ten fixtures, ten hashes); `Adversarial.t.sol` maximal-spec fuzz (registers, composes, fits 16 KiB, can be asked), determinism fuzz; `InvariantsExtended` `invariant_specsAreImmutable` |
| 8 | `tokenURI` pure over storage + Curator + IDMD; goldens; escaping | `Goldens.t.sol`; `Adversarial.t.sol` `test_tokenURIDependsOnlyOnTheClaimantsFacts`, `test_cardShowsAtMostThirtyTwoCommunityIds…` |
| 9 | pool leaves only through pool-funded requests; abandon after 14 days; pool rules; one pending per pair/fact; `sharedFact` is a hash | `Registry.t.sol` pool tests; `Invariants.t.sol`; `InvariantsExtended` `invariant_poolIsFeesPlusDonationsMinusSponsoredRequests`, `invariant_sharedFactsAreHashesStoredOnlyOnDelivery`; `Adversarial.t.sol` k x price fuzz, all nine sponsored, duplicates, pending/verified claims, abandoned pool and shared requests, head fuzz for `applySharedFact` |
| 10 | non-member is `(0, false)`: never an early bird | `Registry.t.sol` `test_nonMemberIsNeverAnEarlyBird`; fork: `test_fork_nonMemberReadsZeroFalseAndHasNoCuratorTrait` on the real Curator |
| 11 | open reads; no `tx.origin` | `Registry.t.sol` `test_anyoneReadsAnyWallet…`; `Adversarial.t.sol` `test_fuzz_hasTraitAndTraitsOfNeverRevert`, re-entrancy through the token into every IMD-moving function |

Golden and byte-exact gates: `Goldens.t.sol` (three synthetic cards), `Templates.t.sol` (ten bodies, ten hashes),
`Artifacts.t.sol` (no immutables, identical runtime twice, no forbidden opcodes, deploy script), `Attestations.t.sol`
(five served attestations recover the attester under their own domain only).

## Review observations (not defects; recorded so nobody mistakes them for untested behaviour)

- The earlier diagnostic-order discrepancy is resolved by change (a) above. Signature and answer lengths now
  precede chainId and signer; `INTEGRATION.md` states the implemented precedence.
- `nextSpecId` is a `uint16` starting at 10001: after 55,535 registrations `registerSpec` reverts on overflow for
  ever. At 1 IMD each this is a bound, not a path anyone reaches by accident.
- The mainnet Intake v2's `signer()` is `0x169b…279f`, not the attester `0x5598…2982`. The registry never reads
  `signer()`; it trusts the attester constructor argument, which is what the five served attestations recover to.
- A claimant-paid request whose callback the plane never completes locks the pair for 14 days (`abandon`); a
  shared fact likewise locks the fact id. Accepted in the brief (CONCEPT.md section 4), exercised by the abandon tests.
