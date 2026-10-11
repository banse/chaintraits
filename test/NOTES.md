# Test notes (round 3: the suite the brief demands, plus the fork tests)

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

- `Registry._check` tests `chainId` before the signer, so an attestation that is wrong on both reports reason 3,
  while `INTEGRATION.md` section 4 lists the signer first. Reason codes are diagnostics; no trait is marked either
  way. `test_fuzz_anyFieldAlteredAfterSigningIsASignatureMiss` pins the implemented order.
- `nextSpecId` is a `uint16` starting at 10001: after 55,535 registrations `registerSpec` reverts on overflow for
  ever. At 1 IMD each this is a bound, not a path anyone reaches by accident.
- The mainnet Intake v2's `signer()` is `0x169b…279f`, not the attester `0x5598…2982`. The registry never reads
  `signer()`; it trusts the attester constructor argument, which is what the five served attestations recover to.
- A claimant-paid request whose callback the plane never completes locks the pair for 14 days (`abandon`); a
  shared fact likewise locks the fact id. Accepted in the brief (CONCEPT.md section 4), exercised by the abandon tests.
