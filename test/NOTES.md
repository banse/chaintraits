# Sworn implementation and verification record

This is an independent implementation from the specification-only baseline `f0739cd85476faa771f779f5c31a19abdf796b89`. No earlier product implementation was read or copied. Exact recipe wording and protocol vectors are specification data. No deployment, broadcast, paid oracle request, live lab run or launch manifest was made. The entrant performs deployment, live runtime verification and the subsequent site stage.

## Reproduction and measurements

The unchanged scaffold pins solc 0.8.24, Cancun, optimizer 200, no IR, no metadata hash or CBOR, and no FFI. Use the commands in README. All ordinary tests are offline; the optional fork test skips without `SWORN_FORK_RPC`. The requested fuzz seed is `0x8ce961bd394c0f2f09c24c769f68936047a69c8620d66bdac95e135b62c6ed69`. Invariants run 256 sequences of depth 64, with `fail_on_revert = true`; handlers guard expected failures. The completed full run passed 62 tests, skipped only the optional fork test, and exercised 16,384 handler calls with no reverts. `forge build --offline --sizes` and `forge fmt --check` pass, both generator drift checks pass, all four Python unit tests pass, and all three section 3.8 removal greps are empty.

| Runtime | Bytes | EIP-170 headroom |
|---|---:|---:|
| Registry | 20,912 | 3,664 |
| Composer | 22,277 | 2,299 |
| Renderer | 17,066 | 7,510 |
| Sum | **60,255** | **9,545 below the 69,800 combined limit** |

`ArtifactsTest.test_runtimeSizesAndSumPinned` asserts these exact three sizes and sum as well as the hard bounds. Every runtime has no immutable references and is byte-identical across independent deployments, even with different constructor values. `test_noForbiddenRuntimeOperations` walks opcode boundaries, including appended constant data, and rejects the prohibited operations. Helpers have no storage or constructor arguments; all libraries used by product contracts have internal functions and no link placeholders.

`LimitsTest.test_maximumStateTokenURIGas` prepares all 25 catalog traits, applies a real 32-address shared result, registers and verifies 32 maximum-field kind-2 specs through the mock Intake, cools the three contracts, and measures **9,005,154 gas** for a **43,453-byte URI**. This is above the aspirational 8,000,000 target and below the mandatory 10,317,448 bound. Each maximum spec has a 256-byte item, 32-byte name, arg, fixedArg and sumArg fields, maximum uint256 threshold/fixed value and a uint64-width window.

Gas below is measured around the mock Intake's assembly `call`, including its call overhead, without copying returndata. Calldata construction occurs before that measurement, as it does before the real Intake's callback. All successful and failed callback paths record storage accesses and reject every write whose previous value was zero. The specified future estimate adds 89,000 per zero-origin write and 7,200 per other write; even unchanged SSTORE operations are counted conservatively. These are local state-diff estimates, not a claim of measurements on a live Sepolia node. The entrant repeats the delivered-runtime comparison against Sepolia as specified in REBUILD 3.11/11.2.

| Callback path | Current gas | Specified Glamsterdam estimate |
|---|---:|---:|
| Cold catalog 701 with card | 43,077 | 64,677 |
| Cold first community fact with card | 51,159 | 94,359 |
| Cold 601 with card | 41,057 | 62,657 |
| Cold shared fact, 32 addresses | 48,835 | 77,635 |
| Failure, including 262,144-byte signature | 13,385 | 20,585 |
| Miss 1, unknown/consumed request with huge fields | 9,278 | 9,278 |
| Miss 2, bad signer | 21,649 | 28,849 |
| Miss 3, chain | 13,230 | 20,430 |
| Miss 4, answer type | 24,024 | 31,224 |
| Miss 5, panel | 24,561 | 31,761 |
| Miss 6, window | 27,612 | 34,812 |
| Miss 7, dates | 28,488 | 35,688 |
| Miss 8, predicate | 33,892 | 41,092 |
| Miss 9, malformed answer | 13,198 | 20,398 |
| Miss 10, question hash | 31,494 | 38,694 |
| 262,144-byte signature | 12,573 | 19,773 |
| 262,144-byte answer | 12,946 | 20,146 |

Reason 1 is measured separately with both oversized fields, makes no storage write, and is asserted below 175,000. The worst cold success leaves **105,641 gas** of the 200,000 stipend under the future estimate, exceeding the required 25,000 reserve. `ColdCallbacksTest` creates requests in `setUp`, so the measured test begins with clean transaction storage; `GasTest` covers the remaining paths, including unsigned failure.

| Largest user operation | Specified Glamsterdam estimate |
|---|---:|
| Mint with all direct bits | 1,112,011 |
| Request 601 | 4,411,511 |
| Register maximal spec | 2,964,710 |
| Request maximal kind-2 spec | 2,881,533 |
| Apply 32-address shared fact | 181,757 |

These measurements include dependency writes recorded by the test, not just Registry writes. `LimitsTest.test_largestUserCallsWithinGlamsterdamLimit` bounds each by 15,000,000. Deployment is exempt under the specification; its byte budget is tested instead. Actual transaction gas also includes intrinsic calldata costs, well within the remaining margins.

## Storage and request lifecycle

The inherited ERC-721 occupies slots 0–4 and the reentrancy guard slot 5. The seven dependency addresses occupy slots 6–12. `tokenOf`, `claimantOf`, `mintedAtBlock`, `frozenDirect`, `totalSupply`, `nextSpecId`, `_specs`, `_requests`, `_pairs`, `_lists`, `_previous` occupy roots 13–23, respectively. The compiler emits the complete storage layout in the artifacts.

At `keccak256(abi.encode(requestId,20))`, a request uses six slots: +0 packs claimant (20 bytes), trait id (2), request timestamp (8), kind (1), state (1); +1 question hash; +2 from/to blocks; +3 threshold or shared head; +4 oracle UUID; +5 shared answer hash. States are 0 unused, 1 pending, 2 verified, 3 closed. The paid request initializes +4 to one and, for shared requests, +5 to one. The first community request also initializes the wallet's packed list header (`tail`, `count`, `prepared=true`) and its predecessor entry to 65,535. The header therefore stays nonzero even before its first verified element, and every predecessor later written by a callback was prepared already.

A callback first changes pending state 1 to closed state 3, then checks. Success changes state to 2 and overwrites the prepared UUID/hash fields; personal community success overwrites the prepared predecessor and packed list header. There is no append to an initially empty dynamic array. `verifiedSpecsOf` walks the predecessor links backwards into a correctly ordered result. A shared application runs outside the callback and may prepare its own wallet list entries.

The pair index is a pointer to the latest request. Public pending views return data only in state 1, verified/shared views only in state 2, and claimant zero never has a credential. Closed tombstones and pair pointers stay in storage but read as absent. This achieves clear-before-check semantics without creating state during delivery and prevents any request id from being reused. A late old callback cannot alter a successor pair. Prepared list entries are absent from every public credential, list and metadata view until verification.

## Decisions and boundaries

- REBUILD 7.18 suggests a 60,000-gas stipend to force failed delivery. The optimized cold first-community callback already succeeds at 51,159. `ColdCallbacksTest.test_sixtyThousandStipendAlreadySuffices` pins that success; the recovery test lowers the mock stipend to **40,000** to force an actual out-of-gas failure. This changes only the failure stimulus and preserves the requested recovery behavior without adding wasted gas to production.
- “Deletes the pending record” is implemented as logical deletion through the state byte and filtered getters. Retaining the nonzero records is necessary for the explicit no-zero-origin-write rule and used-id protection; public behavior and event order remain the specified ones.
- Intake id zero is rejected as `RequestIdTaken(0)`, since zero is the public absent-id sentinel. Actual Intake ids are nonzero hashes. Reused ids are refused after any terminal outcome, not merely while pending.
- REBUILD 3.6 names `mainnetHeightBound()` as H off mainnet but parenthetically says the supplied block argument counts there. The implementation follows the explicit H definition and CATALOG's field table: it ignores that argument on both chains and derives H from actual block height on chain 1 or the documented timestamp bound elsewhere. It never accepts a caller-inflated mainnet height.
- If a synthetic pre-anchor chain would put the living end below its start, Composer and Registry both clamp the end to the start, satisfying 7.5's never-inverted-window requirement. Normal mainnet and current timestamp windows use H minus 64.
- The canonical document uses minimal JSON with sorted keys. Fixtures use pretty JSON and omit their final file newline when returned as body bytes. T6 definition order is retained in the body and sorted only for the hash. All eleven fixture body/hash tests pass.
- Geometry uses local one-decimal polygon coordinates with one-decimal translated cell centres; this is the allowed independent SVG serialization. Zero is normalized to `0.0`; all clip geometry, positions, colors, opacities and path rules follow the numeric specification.
- The optional `renderSpec(uint16)` view returns only kind, target and name to avoid loading long recipe strings during metadata rendering. Renderer falls back to bounded `specOf` decoding for adapters implementing only the specified surface. All hostile-reply tests exercise that fallback.
- Bounded `specOf` and `renderSpec` replies are decoded with Solidity's typed ABI decoder after the whole reply is capped. Bad offsets therefore revert cleanly; no unchecked custom offset read is used for strings. Catalog trait reads copy at most 25 words and ignore out-of-family ids when computing visual slots.
- The preview path is a synthetic registry adapter: `Renderer.tokenURIOf(adapter,0)` reads the adapter's claimant and trait views without requiring an actual Registry card. `GoldensTest.test_singleQuoteEscapedAndNoCardPreview` demonstrates it with claimant `0x…c1a1`. Actual `Registry.tokenURI` still rejects an unminted token. Previews are renderings, never credentials.
- The Intake interface exposes its required ERC-20 calling surface without payable mutability, which does not alter the selector and permits the required no-native-value consumer. The verified protocol tuple and callback selectors are unchanged. No configurable oracle owner or signer setter was introduced from the background examples.
- The optional fork test's single `vm.envOr` is the explicit REBUILD 7.15 exception to environment-independent ordinary tests. No test writes an environment variable. Tests use `vm.getBlockTimestamp()` and `vm.getBlockNumber()` around clock/height mutations to prevent compiler reuse of environment reads across cheatcodes. All deployment configuration is constants and the directly tested `deployForChain()` function.
- The entry assignment is contracts-only without deployment. No website or live deployment verification was attempted; `web/README.md` points to the workflow's later site stage. Existing deployment history remains untouched.
- The oracle wording was not resubmitted or changed: the eleven pinned plane checks and quotes are the evidence, and the T6 lab rerun is explicitly excluded. Tests prove byte equality to the admitted bodies.

## Rule-to-test index

Each line names a rule or normative subrule and its executable evidence. Contract prefixes identify the corresponding `test/*.t.sol` file. Runtime-dependent live checks are identified separately rather than represented as completed local checks.

- 3.1 / fee, one card, sequential supply, no receiver hook: `RegistryTest.test_feesForwardedAndAtomicFailure`, `test_forwardFailureRollsBackPullAndNonReceiverCanMint`, `MetadataTest.test_noCardAndCollectionInterfaces`.
- 3.1 / claimant permanence, mint block and frozen traits across transfers: `RegistryTest.test_transferPreservesFactsAndBuyerIndependence`, `InvariantsTest.invariant_claimantSnapshotAndSupply`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 3.1 / every claim acts on caller, independently of held cards: `RegistryTest.test_transferPreservesFactsAndBuyerIndependence`.
- 3.1 / transfer and verification MetadataUpdate, no id zero update: `RegistryTest.test_transferPreservesFactsAndBuyerIndependence`, `SettlementTest.test_settleUndeliveredTrueByStrangerAndReplay`; `_mark` gates updates on nonzero token.
- 3.1 / no royalties: `MetadataTest.test_noCardAndCollectionInterfaces`.
- 3.2 / thirteen predicates, membership gate, zero-wallet gate and bitmap layout: `ComposerTest.test_directBitsAndNonMembers`, `RegistryTest.testFuzz_directTierMonotonicity`.
- 3.2 / snapshot at mint versus live unminted reads: `RegistryTest.test_transferPreservesFactsAndBuyerIndependence`, `InvariantsTest.invariant_claimantSnapshotAndSupply`.
- 3.2 / all tiers and highest displayed tier, PID lowest id: `GoldensTest.test_allSyntheticGoldensByteForByte`, `RegistryTest.testFuzz_directTierMonotonicity`.
- 3.3 / personal versus shared ids, duplicates, no-card claims and exactly one id: `RegistryTest.test_upgradeGuardsPriceAndAllowance`, `test_transferPreservesFactsAndBuyerIndependence`.
- 3.3 / current nonzero capped price, exactly one quote, pull and consumed exact allowance: `RegistryTest.test_upgradeGuardsPriceAndAllowance`, `InvariantsTest.invariant_feesAndRequestPricesConservedWithoutRegistryBalance`.
- 3.3 / composed body, consumer domain, mainnet question: `ComposerTest.test_fixtureBodiesAndCanonicalHashes`, `test_bodyConsumerChangesWithoutChangingQuestionHash`.
- 3.3 / pending ids, stored windows, request id collision atomicity: `RegistryTest.test_reusedRequestIdRollsBackPaymentAndApproval`, `test_livingWindowStoredAfterHeadAdvances`, `test_abandonSharedAndPersonalStrictBoundary`.
- 3.4 / only Intake, unknown/consumed reason 1, clear before checks: `RegistryTest.test_callbackOnlyIntakeUnknownReplayAndUnsignedFailure`, `test_missesAllReasonsAndPrecedence`.
- 3.4 / check 1 signature and expected-kind length bounds before copies: `GasTest.test_callbackGasEveryMissAndHugeFields`, `RegistryTest.test_missesAllReasonsAndPrecedence`.
- 3.4 / check 2 mainnet attestation chain: `RegistryTest.test_missesAllReasonsAndPrecedence`.
- 3.4 / check 3 exact protocol digest, consumer domain and safe recovery: `AttestationsTest.test_fiveServedProtocolSignaturesAndWrongDomain`, `test_protocolVectorDigestRecoveryAndCanonicalSelector`, `RegistryTest.test_missesAllReasonsAndPrecedence`.
- 3.4 / correctly formed signatures reject tampering, wrong chain domain and wrong consumer: `AdversarialTest.test_validSignaturesCannotCrossDomainsOrAuthenticateTampering`.
- 3.4 / every panel bound and future-clock skew: `AdversarialTest.test_everyPanelAndClockSkewCondition`.
- 3.4 / check 4 kind-dependent answer type: `RegistryTest.test_missesAllReasonsAndPrecedence`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 3.4 / check 5 panel and agreement minima: `RegistryTest.test_missesAllReasonsAndPrecedence`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 3.4 / check 6 exact stored window: `RegistryTest.test_livingWindowStoredAfterHeadAdvances`, `SettlementTest.test_settleRejectsMissesWithoutClearing`.
- 3.4 / check 7 all date bounds and expiry/abandon ordering: `RegistryTest.test_datesRejectEarlyLateAndLongThenRetry`, `test_datesExactLastSecondBothKindsBothOrderings`.
- 3.4 / check 8 claimant/window question hash: `AdversarialTest.test_questionCannotMoveBetweenWalletsOrRequests`, `RegistryTest.test_missesAllReasonsAndPrecedence`.
- 3.4 / check 9 threshold, defensive bool and canonical clean address list: `AdversarialTest.test_defensiveBoolAndArrayDecoding`, `RegistryTest.test_sharedExactEnvelopeAndMembership`.
- 3.4 / success records, verification-order community append and events: `RegistryTest.test_communityVerificationOrderAndHiddenPreparation`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`, `SettlementTest.test_settleUndeliveredTrueByStrangerAndReplay`.
- 3.4 / unsigned failure clears without marking: `RegistryTest.test_callbackOnlyIntakeUnknownReplayAndUnsignedFailure`, `GasTest.test_callbackGasCatalogCommunityOperatorSharedAndFailure`.
- 3.4 / both callbacks fit and hostile ABI-valid data never exhausts stipend: `ColdCallbacksTest` and `GasTest` (all methods); invalid top-level ABI correctly fails in `AdversarialTest.test_defensiveBoolAndArrayDecoding`.
- 3.4 / anyone settles only a checked true pending result: all three `SettlementTest` methods; false and bad attestations leave pending state intact.
- 3.5 / shared request eligibility, one pending and no rerequest once stored: `RegistryTest.test_sharedExactEnvelopeAndMembership`, `test_abandonSharedAndPersonalStrictBoundary`.
- 3.5 / exact hash, membership, duplicate protection, personal record after application: `RegistryTest.test_sharedExactEnvelopeAndMembership`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 3.5 / shared hash and head stored without address array: `RegistryTest.test_sharedExactEnvelopeAndMembership`, `GasTest.test_preparedStorageInvisibleAfterMissFailureAbandon`; compiler storage layout.
- 3.5 / historical 1201 wording remains identical: `ComposerTest.test_fixtureBodiesAndCanonicalHashes` (the new answer itself requires a later paid request).
- 3.6 / registration guards before fees, expected id and exhaustion: `ComposerTest.test_specsGrammarAndFields`, `test_finalityAndExpectedId`, `LimitsTest.test_specIdsEndAt65534`.
- 3.6 / all kind/target/name/threshold/op/field guards before fees: `SpecValidationTest.test_allFieldGuardsRunBeforeFee`.
- 3.6 / exact minimum and finality windows, off-mainnet height and pre-anchor clamp: `SpecValidationTest.test_windowBoundariesAndOffMainnetHeight`.
- 3.6 / rejected near-miss integer, bytes and array types: `SpecValidationTest.test_closedTypeGrammarRejectsNearMisses`.
- 3.6 / exact grammar, closed types, 32-byte identifiers, no trailing prose or anonymous event: `ComposerTest.test_specsGrammarAndFields`, `AdversarialTest.test_grammarEveryTypeAndFunctionIdentifierBounds`, `testFuzz_malformedItemsNeverPanic`.
- 3.6 / no fourth indexed field, including claimant/fixed filters: `ComposerTest.test_specsGrammarAndFields`.
- 3.6 / actual indexed address arg, actual indexed fixed field and actual sum field: `ComposerTest.test_specsGrammarAndFields`.
- 3.6 / finalized minimum windows and mainnet argument independence: `ComposerTest.test_finalityAndExpectedId`, `LimitsTest.testFuzz_maximalSpecBodyCaps`.
- 3.6 / maximal question, definitions and request sizes: `LimitsTest.testFuzz_maximalSpecBodyCaps`, `test_largestUserCallsWithinGlamsterdamLimit`.
- 3.6 / catalog/stored immutable specs and class mapping, kind 6 excluded: `ComposerTest.test_catalogWindowsNamesAndLive601`, `test_fixtureBodiesAndCanonicalHashes`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 3.6 / trusted helper arguments: `ComposerTest.test_bodyConsumerChangesWithoutChangingQuestionHash`, `GoldensTest.test_singleQuoteEscapedAndNoCardPreview`; README documents caller-selected helper inputs.
- 3.7 / strict 31-day boundary, claimant-only personal and permissionless shared abandon: `RegistryTest.test_abandonSharedAndPersonalStrictBoundary`, `test_datesExactLastSecondBothKindsBothOrderings`.
- 3.7 / successor survives late old callback and no refunds: `RegistryTest.test_abandonSharedAndPersonalStrictBoundary`, `InvariantsTest.invariant_feesAndRequestPricesConservedWithoutRegistryBalance`.
- 3.8 / exactly two forwarded fees and separately paid requests: `RegistryTest.test_feesForwardedAndAtomicFailure`, `test_forwardFailureRollsBackPullAndNonReceiverCanMint`, `InvariantsTest.invariant_feesAndRequestPricesConservedWithoutRegistryBalance`.
- 3.8 / no native payment, no retained operating balance, no obsolete surface: `RegistryTest.test_forwardFailureRollsBackPullAndNonReceiverCanMint`, `InvariantsTest`; section 3.8 removal greps produce no output.
- 3.9 / seven nonzero ordinary-storage dependencies and fixed helper code: `ConstructorTest.test_allSevenZeroArgumentsRevert`, `test_helpersAlwaysCodeExecutorOnlyOffFloorAndDecimals`, `ArtifactsTest.test_runtimeIdenticalAndImmutableReferencesEmpty`.
- 3.9 / sixteen code combinations and exact empty-chain floor: `ConstructorTest.test_allCodeCombinationsFloorOnlyWhenAllThreeEmpty`.
- 3.9 / decimals, settled curator, nonzero price and executor checks: `ConstructorTest.test_helpersAlwaysCodeExecutorOnlyOffFloorAndDecimals`.
- 3.9 / mainnet and Sepolia constructor constants and empty-chain script: `ConstructorTest.test_deployScriptEmptyChainMainnetAndSepolia`.
- 3.10 / fixed upstream dependencies and no recovery administration: README and DISCLOSURE; zero-price failure in `RegistryTest.test_upgradeGuardsPriceAndAllowance`, wrong signer in `RegistryTest.test_missesAllReasonsAndPrecedence`.
- 3.11 / no callback creates storage and at least 25,000 reserve: all `ColdCallbacksTest` and `GasTest` methods.
- 3.11 / bounded one-id requests and maximal user calls: `RegistryTest.test_upgradeGuardsPriceAndAllowance`, `LimitsTest.test_largestUserCallsWithinGlamsterdamLimit`.
- 3.11 / later settlement survives reduced callback stipend: `SettlementTest.test_settleUndeliveredTrueByStrangerAndReplay` (40,000 stimulus, decision above).
- 3.11 / state-diff future schedule formula: `GasTest.measured`, `ColdCallbacksTest.measure`, `LimitsTest.accountCost`; live Sepolia reproduction belongs to the entrant.
- 4.1 / every T1–T5 body and canonical hash, formatting, topic position, panels and consumer: `ComposerTest.test_fixtureBodiesAndCanonicalHashes`, `test_specsGrammarAndFields`, `test_bodyConsumerChangesWithoutChangingQuestionHash`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 4.2 / T6 exact eight-key text, lengths, panel class and living request window: `ComposerTest.test_fixtureBodiesAndCanonicalHashes`, `test_catalogWindowsNamesAndLive601`.
- 4.2 / stored window after delayed delivery, paid permanent fact independent of membership: `RegistryTest.test_livingWindowStoredAfterHeadAdvances`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 4.2 / seat/agent/feedback attribution, missing archive evidence, three-entry predicate: exact T6 fixture comparison in `ComposerTest.test_fixtureBodiesAndCanonicalHashes`; archived plane checks and prior lab record are supplied evidence, not a new local oracle execution.
- 4.3 / oracle catalog ids, targets, frozen anchors, thresholds and names: `ComposerTest.test_fixtureBodiesAndCanonicalHashes`, `test_catalogWindowsNamesAndLive601`, `GoldensTest.test_allSyntheticGoldensByteForByte`.
- 5.1 / metadata key order, description, exact decimal values and both URI encodings: `GoldensTest.test_allSyntheticGoldensByteForByte`.
- 5.1 / claimant and top-tier attributes, 25 catalog cap, first 32 community ids with full count: `GoldensTest.test_allSyntheticGoldensByteForByte`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 5.1 / oracle record keys and stored 601 window, panel minima equal Composer: `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 5.1 / escape names including apostrophe, no recipe strings in SVG: `GoldensTest.test_allSyntheticGoldensByteForByte`, `test_singleQuoteEscapedAndNoCardPreview`.
- 5.1 / hostile head/name offsets, 1 MB reply and out-of-family ids under 5 million: `GoldensTest.test_hostileRepliesFailCleanlyAndForeignFamiliesSkip`.
- 5.1 / rendering versus credential and no-card preview: `GoldensTest.test_singleQuoteEscapedAndNoCardPreview`, README and Renderer NatSpec.
- 5.2 / thirteen cells, centers, radii, outlines, class colors and opacities: `GoldensTest.test_allSyntheticGoldensByteForByte`; `tools/test_gen_template.py` numeric geometry checks.
- 5.2 / every partial tier, complementary honey clips and upper outlines: partials1/2/3 goldens and `TemplateTests.test_tables_tile_without_gap_or_overlap`.
- 5.2 / nine rare dots and no 1105 dot: rare and ordinal goldens plus `GoldensTest.test_rareDotsRingsAndStepTable`.
- 5.2 / zero through three rings, first 39 slots, logarithmic frame path and six edges: `GoldensTest.test_rareDotsRingsAndStepTable`, short_path/six_segments goldens.
- 5.2 / one-decimal precomputed coordinates, ASCII offsets and constant envelope: `RecipeTablesTests.test_hive_offsets_are_ascii_and_tile_exactly`, `ArtifactsTest.test_noForbiddenRuntimeOperations`.
- 5.3 / cold maximal real-state metadata gas: `LimitsTest.test_maximumStateTokenURIGas` (measurement above).
- 6 / pinned compiler/settings, runtime determinism, immutable-reference and code-size budgets: all `ArtifactsTest` methods; `forge build --offline --sizes`, `forge fmt --check`.
- 6.1 / standard-library regeneration and drift detection: `python3 tools/gen_template.py --check`, `python3 tools/build_recipe_text.py --check`.
- 6.1 / independent synthetic SVG and URI goldens with widest token, 32 hostile 32-byte names and 256-byte hostile items: `GoldensTest.test_allSyntheticGoldensByteForByte` (fourteen cases, all claimant `0x…c1a1`).
- 6.1 / tables tile without gaps or overlap; compression bounded and safe: all four Python unit tests in `tools/test_gen_template.py` and `tools/test_recipe_text.py`.
- 7.1 / fees and bridge preview: `RegistryTest.test_feesForwardedAndAtomicFailure`, `test_forwardFailureRollsBackPullAndNonReceiverCanMint`; optional `ForkTest.testFork_realDependenciesFeeBridgePreviewAndComplete`.
- 7.2 / shared/personal abandon callers and day boundaries: `RegistryTest.test_abandonSharedAndPersonalStrictBoundary`.
- 7.3 / all requested date cases and both orderings: `RegistryTest.test_datesRejectEarlyLateAndLongThenRetry`, `test_datesExactLastSecondBothKindsBothOrderings`.
- 7.4 / reused-id atomic rollback and old callback isolation: `RegistryTest.test_reusedRequestIdRollsBackPaymentAndApproval`, `test_abandonSharedAndPersonalStrictBoundary`.
- 7.5 / Swarmed living window, off-mainnet bound, metadata and registration exclusion: `ComposerTest.test_catalogWindowsNamesAndLive601`, `test_fixtureBodiesAndCanonicalHashes`, `RegistryTest.test_livingWindowStoredAfterHeadAdvances`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- 7.6 / all constructor branches, seven arguments and empty-chain creation: all four `ConstructorTest` methods.
- 7.7 / transferred card remains claimant's and buyers act independently: `RegistryTest.test_transferPreservesFactsAndBuyerIndependence`.
- 7.8 / real-style completion/stipend, diagnostic transition cases, huge fields and empty/multiple ids: `RegistryTest.test_callbackOnlyIntakeUnknownReplayAndUnsignedFailure`, `test_missesAllReasonsAndPrecedence`, `test_upgradeGuardsPriceAndAllowance`, all `GasTest` and `ColdCallbacksTest` methods.
- 7.9 / exact shared head, outside membership, anonymous/non-address grouping and topic 2: `RegistryTest.test_sharedExactEnvelopeAndMembership`, `AdversarialTest.test_defensiveBoolAndArrayDecoding`, `ComposerTest.test_specsGrammarAndFields`.
- 7.10 / spec grammar/fields/finality/id races/maxima/exhaustion: `ComposerTest.test_specsGrammarAndFields`, `test_finalityAndExpectedId`, `AdversarialTest`, `LimitsTest.testFuzz_maximalSpecBodyCaps`, `test_specIdsEndAt65534`.
- 7.11 / eleven exact bodies and hashes: `ComposerTest.test_fixtureBodiesAndCanonicalHashes`.
- 7.12 / five served signatures, named answer-code loader rejects unknown values: `AttestationsTest.test_fiveServedProtocolSignaturesAndWrongDomain`; protocol vector and canonical selector tests provide independent conformance evidence.
- 7.13 / all renderer goldens, gas, preview, hostile replies, escaping and panel minima: `GoldensTest`, `LimitsTest.test_maximumStateTokenURIGas`, `MetadataTest`.
- 7.14 / no immutables, identical runtimes, exact size pins and table-byte safety: `ArtifactsTest`, `RecipeTablesTests`.
- 7.15 / pinned real-dependency fork with actual complete and fee preview: `ForkTest.testFork_realDependenciesFeeBridgePreviewAndComplete`; skipped in the hermetic run, not represented as live-verified.
- 7.16 / this rule/test index, measurements, layout, decisions and generated hashes: this document and the build record below.
- 7.17 / all callback paths under state-diff recording, maximal user calls, prepared state invisible: `ColdCallbacksTest`, `GasTest`, `LimitsTest.test_largestUserCallsWithinGlamsterdamLimit`.
- 7.18 / true failed-delivery recovery, stranger settlement, terminal replay rejection, bad reasons preserve pending and shared settlement: all three `SettlementTest` methods and the explicit 60,000-gas success test.

## CONCEPT invariant index

- Invariant 1 / claimant, token mapping and frozen snapshot survive transfer: `RegistryTest.test_transferPreservesFactsAndBuyerIndependence`, `InvariantsTest.invariant_claimantSnapshotAndSupply`, `MetadataTest.test_metadataWindowsPanelMinimaAndCommunityOrder`.
- Invariant 2 / once-per-wallet mint: `RegistryTest.test_transferPreservesFactsAndBuyerIndependence`, `InvariantsTest.invariant_claimantSnapshotAndSupply`.
- Invariant 3 / verified state only through checked attestation or matched shared membership: `RegistryTest.test_missesAllReasonsAndPrecedence`, `test_sharedExactEnvelopeAndMembership`, `AdversarialTest.test_questionCannotMoveBetweenWalletsOrRequests`.
- Invariant 4 / one completion, domain/window/question binding and defensive decoding: `RegistryTest.test_callbackOnlyIntakeUnknownReplayAndUnsignedFailure`, `AdversarialTest`, `AttestationsTest`.
- Invariant 5 / Intake-only callbacks, gas reserve and permissionless true recovery: `RegistryTest.test_callbackOnlyIntakeUnknownReplayAndUnsignedFailure`, `ColdCallbacksTest`, `GasTest`, `SettlementTest`.
- Invariant 6 / monotone direct tiers: `RegistryTest.testFuzz_directTierMonotonicity`.
- Invariant 7 / fixed specs, deterministic bodies and exact canonical hashes: `ComposerTest.test_fixtureBodiesAndCanonicalHashes`, `test_finalityAndExpectedId`, `RegistryTest.test_feesForwardedAndAtomicFailure`.
- Invariant 8 / claimant metadata, exact goldens and hostile-string escaping: `GoldensTest`, `MetadataTest`.
- Invariant 9 / zero retained IMD, consumed price allowance, deadlines and shared hash only: `InvariantsTest.invariant_feesAndRequestPricesConservedWithoutRegistryBalance`, `RegistryTest.test_abandonSharedAndPersonalStrictBoundary`, `test_sharedExactEnvelopeAndMembership`.
- Invariant 10 / non-member has no direct facts, 601 independent: `ComposerTest.test_directBitsAndNonMembers`, `RegistryTest.test_livingWindowStoredAfterHeadAdvances`.
- Invariant 11 / public wallet reads without caller authorization: all metadata/trait tests read ALICE from the test contract; product code contains no transaction-origin authorization.
- Invariant 12 / no native-value acceptance or spending: `RegistryTest.test_forwardFailureRollsBackPullAndNonReceiverCanMint`, `InvariantsTest.invariant_claimantSnapshotAndSupply`, runtime operation scan.

## Generator build record

Generation was performed on the working tree based on commit `f0739cd85476faa771f779f5c31a19abdf796b89`, using only the supplied specification fixtures. The submission process assigns the final source commit after this task; the SHA-256 values below identify the exact generator inputs authored here and every generated table/golden without depending on that future commit id. No git metadata was changed. Both `--check` commands pass; all four Python unit tests pass, including zero-gap/zero-overlap tiling.

| Generated artifact or generator | SHA-256 |
|---|---|
| `tools/gen_template.py` | `1223173822e234578aab2e4fb70ff1d632d3dfc2cbf21be23d7288a302f49dcd` |
| `tools/build_recipe_text.py` | `19761d8b4e3b58426e7fa5268de1a5b196c29ecc504a0aba8db27aea264b5851` |
| `src/lib/HiveTables.sol` | `a130085d7dcefefd043aa12c280e06c8c27362585519ec2b38384ee130ae6d2a` |
| `src/lib/RecipeText.sol` | `75226b75ba77b182b441456d9f3359f77eb0fa8035ede7d344c4db8e0bb1c61a` |
| `test/fixtures/cases.json` | `9abccbcdc476225192c011459faeed65be46eacf9af5c191f2617cf5bcb7051d` |
| `test/fixtures/empty.svg` | `0719587a955c13012f22ebe82f85bbbb0db63138d9b251a71b23722ccd556dc2` |
| `test/fixtures/empty.uri` | `63e676e7c75270d22f80889ceb9841eaaa79508f2483bfe6469ed27e2637c620` |
| `test/fixtures/escaping.svg` | `3454d54ff7ead3d9b4af6fde0b5377d9145ad179ffbe281d1af0af0359896608` |
| `test/fixtures/escaping.uri` | `23f1e5f4ef0d41f8f4cbd05db61dea55705a01f2ef2273d1e3bc5d93a23537b3` |
| `test/fixtures/first1000.svg` | `575d46fcb234acecf87c65fb33d7d006195aff4cb3338918db263ae0a8dee760` |
| `test/fixtures/first1000.uri` | `a3fee24428febdc52708fb991d5a497cdfacd7e538026117db9eb8696c7203a6` |
| `test/fixtures/ordinal1000.svg` | `436ce906c2659dd45cd28385f043cd4e1df57dc9905c99bc1d2bfe80e760bdf8` |
| `test/fixtures/ordinal1000.uri` | `07ec07ba41eeed4b237a963acfe80106558c928ab3d05e5b95483fc407a46514` |
| `test/fixtures/ordinal10000.svg` | `436ce906c2659dd45cd28385f043cd4e1df57dc9905c99bc1d2bfe80e760bdf8` |
| `test/fixtures/ordinal10000.uri` | `2b1f04804533707f6fc7700e7fe35f1f3b4de5522069481802320ec8183b4ec9` |
| `test/fixtures/ordinal19522.svg` | `436ce906c2659dd45cd28385f043cd4e1df57dc9905c99bc1d2bfe80e760bdf8` |
| `test/fixtures/ordinal19522.uri` | `4fd3f5d429c475d6deec679d7b1ab64f3d315c2a81cdb11b95be73b0ba8a3982` |
| `test/fixtures/partials1.svg` | `2d401289789cc3f7721b67c05d01dee45010ce80fd40628c6e5bd6a4e775fa66` |
| `test/fixtures/partials1.uri` | `b16852054f9e87962e6bd6c0b3442d11697bd2aebcebc9668856c462c9adbeeb` |
| `test/fixtures/partials2.svg` | `c5fb69c7c264382dfa79cbfe6082a6d6aacd921c07b6c5c76f45f2f4a8facf40` |
| `test/fixtures/partials2.uri` | `abbf433e40e8e11810556c1925286db299e9b08b87b0ff2d8aa378d65fdf090f` |
| `test/fixtures/partials3.svg` | `636afe435c545661679752b6fe925d923a51851e162a40b68962bf7d64fe4304` |
| `test/fixtures/partials3.uri` | `b15b037024ce5d9fdd0b8827dc22066229964017eb2de698313d219f0d8560f9` |
| `test/fixtures/rare.svg` | `801b4c317da0d589150c485e085b49503f6fbdf6df245d1021287c117e17dc7f` |
| `test/fixtures/rare.uri` | `652c54ffb915d8749aff0a3b6a09287fc903ee8cc4a0e3d7487b2c233200e5f8` |
| `test/fixtures/short_path.svg` | `8d78c539a67f10b691f18aa5017716f043a74480297d2d1fac03fc1cabcadf89` |
| `test/fixtures/short_path.uri` | `825f44f31c288abef1bd650b2fe03ac39171b0a19b7abe529a0579594ce26d7a` |
| `test/fixtures/single.svg` | `461c9e6ed7d89be4f8b96cf9ab45c35dd716ed43ee89ccf3fa559ef7ac16aa44` |
| `test/fixtures/single.uri` | `6670d520babc762d4c214b5abfd95a07e6788990963f1278056a1caf5c9ca36b` |
| `test/fixtures/six_segments.svg` | `e1728a33d54326f4ff64867c6e54c594c724b36e10e8592ba395f53e756797da` |
| `test/fixtures/six_segments.uri` | `64e03ccdf89c2c0efcdc6f0fe436e6e9701c0bb58052f4623a7d3bf1e200995e` |
| `test/fixtures/wide.svg` | `e11c9079dff361da135654f88b42885d0de82d4eb8ae52ef07a7e7e5b5312bff` |
| `test/fixtures/wide.uri` | `48a9b5fa7938732c387eb9f1f2806f05fd747970a04baa381b640e7753c04f8a` |
