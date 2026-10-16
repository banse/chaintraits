# Step 5: the Renderer hive image (2026-10-16)

`src/Renderer.sol` draws the card image per the normative SVG by selecting and concatenating `HiveData` strings
(per family: outline, zones, honey/above clips and clipped rings from lv, n and k; rare dot; empty rings; frame
ghost; the overflow path only above 39 with steps = 64 from 8192 else min(64, bitlen(count ** 8) - 41); token id
text). The JSON envelope and every non-image byte are unchanged. Registry, Composer and Types are untouched.

| measure (solc 0.8.24, optimizer 200, Cancun) | value |
|---|---:|
| Renderer runtime size (`test_reportRendererRuntimeSize`) | 21,570 B (3,006 under EIP-170) |
| tokenURI gas, synthetic_width | 10,810,085 |
| tokenURI gas, synthetic_fullhouse | 9,147,472 |
| tokenURI gas, synthetic_honey | 9,589,924 |
| `forge test` (verifier seed) | 159 passed, 0 failed, 15 fork skips |

Tests added in `test/Goldens.t.sol`: gas report (bounded under 30M for an `eth_call`), runtime size report, no
path at 39 / a path at 40, identical images at 8192 and `uint256.max` (no `count ** 8` overflow), and 40 vs 53
rendering differently (exponentiation, not XOR). Every golden is checked byte-equal through `Renderer.tokenURI`.
Operational note: the image costs about 9-11M gas to read; indexers calling `tokenURI` need an `eth_call` gas
cap above that (most public RPCs allow 30M or more). Nothing is deployed by this step; the Renderer stays pure and
takes no constructor arguments.

---

# Step 4: the hive generator, data and goldens (2026-10-16)

`tools/gen_template.py` now holds the normative drawing of the card image (`hive_svg`, README "The card image") and
writes two Solidity data libraries: `src/TemplateData.sol` (the JSON envelope, 21 slots and 22 slices: name id,
image, claimant, the thirteen family values, the community count and attributes, the three lists) and the new
`src/HiveData.sol` (163 point strings and 34 markup fragments, each stored once, percent-encoded, with ASCII-hex
start tables and index constants). `template/card.svg` and its SVG value slots are gone; `template/blob.hex` and
`template/offsets.txt` describe the envelope only. The Renderer was brought onto the new data so that the goldens are
the executable specification of the image: `Renderer.image(card)` selects and concatenates `HiveData` strings (no
trigonometry; levels, rings, rare dots and the path length are the only logic), `preimage` splices the 21 slots.
The Card struct, `tokenURI(Card)`/`preimage(Card)` and every metadata byte other than the image value are unchanged
(the old `synthetic_direct`, `synthetic_oracle` and `synthetic_width` preimages differ from the previous commit only
in the `image` value). Registry and Composer are untouched. The later Renderer step may restructure the contract;
the goldens and `--check` pin what it must produce.

| artifact | state |
|---|---|
| goldens | 8 cases x {preimage, svg, uri}: `synthetic_direct` (1), `synthetic_oracle` (2), `synthetic_width` (uint256 max), `synthetic_newcomer` (3), `synthetic_outsider` (4), `synthetic_honey` (5), `synthetic_collector` (6), `synthetic_fullhouse` (7); synthetic `0x...c1a1` claimants only |
| Renderer runtime | 21,570 bytes (3,006 of EIP-170 headroom); no immutables, no storage, no constructor arguments |
| `python3 tools/gen_template.py --check` | 28 artifacts byte-equal |
| `python3 -m unittest discover -s tools` | 18 tests: the step table at 32,39,40,53,70,100,200,1000,5000,8191,8192,65535 = 0,0,2,5,9,13,21,39,58,63,64,64, levels, rings, honey polygons, path points, element order, rare dots, opacities, string uniqueness and indexability, goldens, drift detection |
| `forge test` (verifier seed) | 155 passed, 0 failed, 15 fork skips; `forge fmt --check` and `forge build` pass |

`test/Goldens.t.sol` adds the five renderer-only goldens and direct rule tests: the step table (segments per count,
closure at 64 steps, the cap at `uint256.max`), the rare dot for every catalog id, clip paths only for part-filled
families, ring counts and opacities at 0/1/14/27/39 and saturation at 5000, out-of-catalog ids rendering without a
revert (levels are clamped), and determinism across two deployments. `test/Rename.t.sol` and
`test/ReviewChanges.t.sol` asserted on the old text grid (the product name, the family labels, the Ordinal value
line); they now assert on the hive (the token id text, no label, the rare dot for 1101 to 1104 and not for 1105).

Assumptions stated: the image reads only `tokenId`, `top` and `communityCount` of the Card; `top[i]` outside its
family's tier list is clamped to the nearest level (the registry never produces one); `communityCount` is the full
count (the rings use at most 39 of it, the path its eighth power, 64 steps from 8192). Operationally nothing changes:
the Renderer is pure and launched without arguments; a drawing change is a generator change, a regeneration and a
new Renderer deployment, never a storage write. Not run: Slither, Mythril, the opt-in fork suites.

---

# Step 3: sponsored-claim burn rule (2026-10-16)

Only the burn-rule assignment is implemented here. Registry adds the eighth ordinary-storage constructor
argument, the two constants/getters, payable sponsored entry points, bounded preview/bridge calls, burn events
and native refunds. The original pool-check order is preserved by sharing the member check and moving the
shared price/balance check into `_fromPool`. Paid paths have no behavior change. All existing test deployments
pass an explicit zero executor unless exercising this rule. Deploy uses the specified mainnet executor and zero
for Sepolia. No contract was deployed and no live transaction was sent.

## Size and ABI evidence

Measured using the unchanged foundry.toml: solc 0.8.24, optimizer 200, no via-IR, Cancun, no CBOR metadata.

| build | Registry runtime bytes | EIP-170 headroom |
|---|---:|---:|
| accepted step-2 baseline | 23,364 | 1,212 |
| step 3 after local pool factoring | 24,495 | 81 |
| final local validation after test/documentation corrections | 24,495 | 81 |

The naive duplicated-pool implementation exceeded the limit; factoring the existing checks restored room without
removing behavior or introducing a deployed helper. The later independent review step must remeasure after its
own corrections using these same settings. Composer (23,377 bytes) and Renderer (11,712) have identical creation
and runtime bytes to the starting tree. All three artifacts have empty immutableReferences. ABI comparison retains
every original entry except the requested constructor extension and the two sponsored mutability changes; new
entries are `burnExecutor`, `BURN_MIN`, `BURN_FEE_CAP`, `BurnTriggered`, `BurnSkipped`, `BurnFeeRequired` and
`BurnRefundFailed`. No build configuration, dependency, catalog, composer, renderer, card struct or generated
metadata fixture changed.

## Coverage and operational limits

`BurnRule.t.sol` covers both pool paths with below-threshold/disabled refunds, threshold and cap boundaries,
no/insufficient/exact/excess native fees, full-value forwarding, executor forced refunds, preview/bridge reverts,
out-of-gas and large revert data, failure event codes, pending-request preservation, rollback of Intake payment
and all allowances, bounded gas including the value stipend, nonpayable claimants, rejected plain refunds,
executor/refund reentrancy, and unchanged paid non-payability. A mock checks that pending/allowance effects exist
before preview. Existing Registry-rules tests continue to pin eligibility and counter ordering.

`BurnInvariant.t.sol` runs 256 campaigns of depth 64 with fail_on_revert enabled. Each randomized call checks
native balance before/after, exact fees paid, claimant refunds, pool/Intake conservation and rollback of rejected
claims. The registry begins with ETH already present: it is neither a precondition nor available for refunds.
Unsolicited ETH during the call is outside the stated invariant. The mock's test-only force-refund helper uses
selfdestruct during its creation transaction; the compiler's deprecation warning applies to that helper, not
Registry runtime.

`BurnRule.fork.t.sol` runs against mainnet block **26,202,203**, block hash
`0x21d8ce848d55043d0539b2c88ca2c5dd6c0e9072137ae295a5906bc0cabae2bd` (chain, number and parent checked by the test).
It executes the deployed executor, IMD OFT, Intake and LayerZero code. The uncapped executor quote is
454939975000000000000 token units and 219261761563315 wei. Its preview under **200,000 gas returns zeros** after
catching an internal OFT quote failure, even though tokens are waiting. The regression explicitly asserts that a
sponsored claim skips, refunds attached ETH, and keeps its oracle request pending. A nonpayable claimant with no
value also succeeds (only its membership is mocked). Separate direct executor calls use the **800,000 CALL gas
argument** and prove real OFT sends, exact-fee success, forced surplus refunds to a nonpayable recipient, no native
retention, zero allowance after send, and only shared-decimal token dust left. These tests do not assert a
successful sponsored bridge at that snapshot or prove asynchronous Base delivery. Caps bound cost, not liveness.

The verified executor source and ABI are pinned as non-build reference files in `reference/burn/`, with provenance
and source hash. The Sourcify reported onchain runtime was compared to RPC eth_getCode. No new dependency is
required by the build. README, CONCEPT, INTEGRATION and DISCLOSURE distinguish the fixed ownerless Registry from
the external executor/OFT/destination configuration authorities, and document fee/refund failure conditions and
asynchronous Base burns. This is local implementation validation, not the separate independent review in step 6.

## Commands

```sh
forge build --sizes
FOUNDRY_FUZZ_SEED=0xbd9dd51f488abc7266bb0e9bbdb8f77e5594905fe92f55e8fb0a4983dd2701a6 forge test
forge fmt --check
forge test --match-contract BurnRuleForkTest --fork-url https://ethereum-rpc.publicnode.com --fork-block-number 26202203 -vv
```

Final validation: `forge build --sizes`, `forge fmt --check` and the diff whitespace check passed. The full suite
with the supplied seed passed **145 tests, 0 failures, 15 opt-in fork skips**. The four new pinned fork tests
passed separately. The default suite requires no network; those tests skip without an active
CLI fork, and read no environment variables. Existing MainnetForkTest remains opt-in via its prior RPC setting.
Slither and Mythril were not run. Nothing here changes the separate review step's obligations.

---

# Test notes: tests and docs follow-up (i) to (q)

Continues the review follow-up below (contract changes (a) to (h)). This step changes tests and documents only:
no file under `src/`, no id, window, template, fixture, questionHash document, quorum rule or pool rule changed, and
nothing was deployed.

| change | what changed | where |
|---|---|---|
| (i) | `FullHandler.upgradeSponsored` reduces `which` modulo `catalogChain.length` before adding the loop index (kept from the previous step, with its max-seed regression). `replayConsumed` is now among the targeted selectors (16), and counts the replays that reached the registry; a deterministic test replays a consumed id through `onResult` and `onFailure` and shows nothing changes. All five extended campaigns pass with `fail_on_revert = true`. | `test/InvariantsExtended.t.sol` |
| (j) | Cold `onResult` gas: the request and the signature are prepared first, then `vm.cool(registry)`, then delivery through the mock Intake's real `call(200,000)`; each test asserts `delivered` and logs the gas the mock measured around its `call` (new `MockIntake.lastCallbackGas`, which includes the cold account access). Measured: **133,356** first community verification with a card; **164,087** 64-address shared fact, catalog 1201; **170,445** 64-address shared fact, community T3 (head 32, the maximum). The independent reviewer measured 135,193 / 170,779 / 177,134 before the contract changes. | `test/ReReview.t.sol` `test_coldGas_*`; `test/mocks/Mocks.sol` |
| (k) | Re-entrancy: the token re-enters each of the five IMD-moving functions (`upgrade`, `sponsor`, `registerSpec`, `requestSharedFact`, `mintCard`) as a funded, approved attacker (the token contract itself holds IMD and approved the registry; an Intake selling in that token is wired in), and the test asserts the exact revert data `ReentrancyGuardReentrantCall()` (new `ReentrantIMD.reentryError`). Unguarded positive control: the same payloads fired from a frame without the guard succeed and take effect. High-s: each malformed signature, including the high-s twin, is now derived from the signature of the exact envelope delivered with it; the test also proves the twin recovers the attester under plain `ecrecover`, and the low-s original then verifies. New tests: (a) 262,144-byte signatures on a community shared fact and a community personal request with a card, cold, under the stipend; (b) a lower ordinal acquired later replaces a higher one and never the reverse; (c) community attributes appear only for verified specs, with the name; (e) an unused `fixedVal` is refused and an empty filter is never serialised, a named one is; (f) the constructor reads `isSettled` by static call (a writing Curator cannot deploy and is not written). Also (n) and (p) below. | `test/Adversarial.t.sol`, `test/ReReview.t.sol`, `test/mocks/Mocks.sol` |
| (l) | README "How to verify a card": `topic0` is the keccak of the canonical event signature, and topic positions come from the indexed-argument order of the stored item (`Transfer(from,to,value)` with `arg = "to"` puts the claimant in `topic2` and leaves `topic1` open); the catalog's layout is the special case. | `README.md` |
| (m) | README says how to run `test/fork/Mainnet.fork.t.sol` with `CHAINTRAITS_FORK_RPC` (archive RPC, block 26,170,000) and no longer says the fork tests are not delivered. | `README.md` |
| (n) | CONCEPT.md invariant 4: one pending request is consumed once; the same signed evidence may satisfy another request with an identical canonical question. Test: `test_sameSignedEvidenceSatisfiesAnotherRequestWithTheSameQuestion` (abandoned request is reason 1; successor with the same `questionHash` verifies with the same signature; successor then consumed). | `CONCEPT.md`, `test/ReReview.t.sol` |
| (o) | `questionHashOf` takes the canonical document, not the body: said in README (interface deviations, delivered tests, verification step 3) and CONCEPT.md invariant 7. | `README.md`, `CONCEPT.md` |
| (p) | CATALOG.md section 5: `nextSpecId` is a `uint16`, at most 55,534 community specs (ids 10001 to 65534). Test: `test_specIdsEndAt65534` (65534 registers, the next one reverts with an arithmetic panic). | `CATALOG.md`, `test/ReReview.t.sol` |
| (q) | CONCEPT.md section 6 and INTEGRATION.md section 1: three contracts (`Registry`, `Renderer`, `Composer`) and seven constructor arguments with renderer and composer as static addresses, matching README's deviations. CATALOG.md section 8: open question whether the plane ever signs chain evidence with `agreed` below quorum; the registry refuses it (reason 5). | `CONCEPT.md`, `INTEGRATION.md`, `CATALOG.md` |

Observation, not changed (outside the listed changes): `INTEGRATION.md` section 4, check 7, last sentence still
writes `questionHashOf(body)`; the test it describes passes the canonical document, as (o) now says elsewhere.

Re-review of this step: the edits touch only tests, mocks and documents. The two mock additions (`lastCallbackGas`
recorded after the callback returns; `reentryError` recorded on a failed re-entry) do not change what any existing
test asserts. Local validation after the changes: `forge build`; `forge test --offline` with no
`CHAINTRAITS_FORK_RPC` (all suites pass, the eleven fork tests skip); `forge fmt --check`;
`python3 tools/gen_template.py --check`. This is not an independent audit.

# Previous step: review follow-up (a) to (h)

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
the verifier's no-network run is unaffected. README now says how to run them (change (m) above).

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
- `nextSpecId` is a `uint16` starting at 10001: after 55,534 registrations (ids 10001 to 65534) `registerSpec`
  reverts on overflow for ever (CATALOG.md section 5, change (p)). At 1 IMD each this is a bound, not a path anyone reaches by accident.
- The mainnet Intake v2's `signer()` is `0x169b…279f`, not the attester `0x5598…2982`. The registry never reads
  `signer()`; it trusts the attester constructor argument, which is what the five served attestations recover to.
- A claimant-paid request whose callback the plane never completes locks the pair for 14 days (`abandon`); a
  shared fact likewise locks the fact id. Accepted in the brief (CONCEPT.md section 4), exercised by the abandon tests.
