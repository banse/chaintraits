# Implementation and verification record

This is the contracts contribution for Sworn. The approved starting specification is `docs/REBUILD.md` at base commit `60b0ec0b54780399eabfbfeafe1fd72835b85e57`. No earlier implementation tree was read or copied. The supplied verified dependency ABIs, protocol signatures, question texts and canonical hashes are evidence inputs. Deployment, the manifest, independent review and the website are separate workflow contributions.

## Reproduction

Use the unchanged root Foundry configuration: Solidity 0.8.24, optimizer 200, Cancun, no via-IR, no bytecode metadata, FFI disabled. Run the commands in README. The fuzz seed used is `0x6fa601721e66c925144dbbdb7886dc4d1952338d26407adc33353cb6eb6a4422`. No test reads or changes environment variables. The invariant configuration remains 256 runs, depth 64, `fail_on_revert = true`; handlers guard expected failures. Tests use independent deployments, deterministic synthetic actors and no shared external state.

The final hermetic run passed **76 tests**, with zero failures and one skipped fork setup. It covers unit, fuzz, invariant, complete metadata golden, actual served-signature and protocol-vector tests. The two invariant properties each execute 16,384 handler actions with zero unexpected reverts. The mainnet suite is separately selected with `--fork-url https://rpc.mevblocker.io --fork-block-number 26237654`; without an active fork its setup skips. It performs local fork simulation only. The three fork tests passed: real mint forwarding and executor preview, the real Intake's rejection/failure paths, and successful real Intake completion with an explicitly local test signer. The actual production signer is checked separately against the five supplied signatures, not impersonated for signing. The executor preview reported 17.027144 IMD sendable after the fee at that pinned state.

`python3 tools/record_generation.py --check` runs the generator drift check and all ten Python tests, then checks every recorded hash. `docs/generation-record.json` contains SHA-256 hashes of every generated table and golden after formatting, plus generator and fixture inputs. The contribution service assigns the submission commit after upload; the supplied base commit and exact hashes identify this build without inventing a commit id. The record includes the successful tiling test. Generated Solidity comparisons preserve all tokens and literal bytes while allowing `forge fmt` whitespace; golden comparisons are byte-exact.

## Size and gas

Pinned optimized artifacts:

| Contract | Runtime bytes | Creation-code bytes |
|---|---:|---:|
| Registry | 21,015 | 22,740 |
| Composer | 24,402 | 24,431 |
| Renderer | 20,527 | 20,556 |
| Combined runtime | **65,944** | |

Each runtime is below 24,576 bytes; combined runtime is below 69,800. The creation codes, including Registry's seven encoded address arguments, are below 49,152. There are no linked external library placeholders or immutable substitutions. Composer has only 174 bytes of runtime headroom: future changes need a fresh size check. `DeploymentTest` compares two deployed runtimes, reads artifacts, pins all size limits and scans non-PUSH opcodes including constant tables.

The largest valid real-state `tokenURI` measured **9,300,430 gas**, returning **43,421 bytes**. This is below the hard 10,317,448 bound, above the aspirational 8,000,000 target. The state is built through minting, registration, mock Intake delivery and shared application: all 25 catalog traits, a 32-address shared answer, and 32 kind-2 specs with 256-byte items, all 32-byte string fields, maximum fixed value and threshold, and 19-digit uint64 windows. The requested 601 window remains unchanged a day and many blocks later. The widest synthetic golden additionally covers a uint256 token id and hostile strings that real registration would reject.

Cold callback measurements include the mock's CALL overhead. Every callback path records storage writes and rejects any write whose previous value is zero. The conservative future-schedule calculation adds 89,000 for each zero-to-nonzero write and 7,200 for every other write, including repeated writes. These are the specification's model coefficients, not a claim to have run a different EVM fork locally.

| Callback path | Current gas | Modeled gas |
|---|---:|---:|
| Catalog true | 42,226 | 63,826 |
| 601 true | 40,146 | 61,746 |
| First community fact, claimant has a card | 56,059 | 92,059 |
| Shared answer, 32 addresses | 54,419 | 83,219 |
| Worst measured miss | 31,894 | 39,094 |
| 262,144-byte signature | 12,575 | 19,775 |
| 262,144-byte answer | 12,948 | 20,148 |
| Failure with 262,144-byte signature | 13,387 | 20,587 |

All modeled callbacks are below 175,000, preserving the required 25,000 of the 200,000 stipend. Unknown and replayed requests write no storage. Mutation models include dependency writes and test-call overhead: mint 1,002,933; 601 request 3,209,276; maximal registration 2,816,909; maximal kind-2 request 2,455,925; 32-entry shared application 200,127; transfer 189,050; shared request 2,440,756; abandonment 68,465; undelivered community settlement 187,657. Every measured path is below 15,000,000. Measurement values can shift slightly with test compiler layout; assertions enforce the limits.

The deployment service/entrant still reproduces the delivered runtime's cost against the target network, including the requested Sepolia repricing comparison, before launch. This contribution supplies the structural assertions and conservative model; no live Sepolia state override measurement or transaction is claimed.

## Callback storage layout

`Request` is archived under the Intake id. Its first slot packs claimant (20 bytes), request time (8), trait id (2), state (1) and kind (1). Other slots hold the canonical hash, packed from/to/head, threshold, oracle UUID and shared-answer hash. State is 1 while pending, 2 when verified and 3 when cleared. A separate pair pointer and shared pointer select the latest request. Public pending views expose only state 1; evidence and shared views expose only state 2. A used Intake id is never reusable, even after abandonment.

Request-time payment prepares nonzero oracle-id and answer-hash words. For personal community requests it also reserves a nonzero array word and initializes a count stored as verified-count-plus-one. Callbacks overwrite those words and increase that already nonzero count. Only the verified prefix of the array is returned; extra reservations left by failed requests are invisible. Multiple outstanding community requests can complete in either order. Applying a shared community result reserves and appends in the payer's own user transaction.

`onResult` changes status before checking any verdict; it makes no external contract call. It bounds dynamic calldata before hashing, manually validates scalar/list decoding and stores only after all checks. It does not call Composer. `onFailure` clears status and emits unsigned diagnostics. Neither moves funds. `settle` checks Intake completion before signature checks, accepts only a successful verdict and preserves pending status on a rejected verdict. The state-gated archive implements observable deletion while retaining nonzero words required by section 3.11; `GoldensTest.test_preparedStorageInvisibleInEveryViewAfterEveryUnsuccessfulOutcome` checks every relevant public view and the full URI for both personal and shared requests.

## Requirement map: sections 3–6

Test names below omit the `test_` prefix where unambiguous.

| Requirement | Evidence |
|---|---|
| 3.1 Cards, original claimant, one mint, fee/state/mint ordering, ERC-4906, no royalties | RegistryTest `mintAndRegistrationFeesForwardExactly`, `directTraitsFreezeAndTransfersNeverMoveFacts`, `nonexistentCardRevertsAndNoCardMetadataEventIsEmitted`; TransfersTest both cases; DeploymentTest `noAdminOrRoyaltyAndERC4906Interface`; InvariantsTest |
| 3.2 Thirteen direct ids, only four Curator getters, frozen/live distinction and monotone tiers | RegistryTest `nonMemberAndZeroUnknownAnd601NeverDirect`, `directTraitsFreezeAndTransfersNeverMoveFacts`, `testFuzz_directMonotone`, `hasTraitNeverRevertsWhenDirectDependencyCannotAnswer`; Composer fixtures |
| 3.3 Exactly one oracle id, current price, cap, exact allowance, immutable pending window and collision handling | RegistryTest `priceCapsSingleIdAndInvalidKinds`, `requestIdCollisionRollsBackFeeAndLateOldCallbackKeepsSuccessor`, `successPendingVerifiedAndRefreshEvents`; ComposerTest all fixture bodies; InvariantsTest allowance/property |
| 3.4 Clear before checking, sender/domain/chain/panel/date/window/hash/rule/decoding order, total callback, manual settlement | RegistryTest callback, envelope, signature, panel, date, oversized-field and wrong-question tests; SharedAndSettlementTest settlement tests; AttestationsTest; GasTest |
| 3.5 Shared canonical list hash, exact head, application once, no card required | SharedAndSettlementTest `sharedListStoresOnlyHashAndAppliesOnce`, `sharedCommunityAndCardRefresh`, `shortLongLowAddressDirtyAndMalformedListMiss`, `negativeMeasuredAmountsFixtureRejected` |
| 3.6 Immutable specs, complete item grammar, named and typed fields, windows, expected id, fee after validation, id exhaustion | ComposerTest grammar, kind, window and fuzz tests; RegistryTest `registrationExpectedIdAndValidationBeforeFee`; DeploymentTest `registrationEndsAt65534`; GoldensTest maximal real state |
| 3.7 Personal/shared authorization, strict 31-day boundary, completed personal early release, late callbacks | RegistryTest abandon, dates, early-abandon and collision tests; SharedAndSettlementTest boundary/orderings |
| 3.8 Fee forwarding, no retained balance/allowance, rollback, no native payment | RegistryTest fee-in/fee-out failures and reentry; MainnetForkTest executor preview; InvariantsTest balances; DeploymentTest native-payment rejection. Removal scans cover delivered source, tests, tooling text and current product documents |
| 3.9 Seven fixed constructor addresses; floor only when all three dependencies lack code; helper checks always; executor check outside floor | DeploymentTest all 16 dependency/executor combinations, helper checks, decimals/settlement/price/zero-address checks, mainnet empty-chain rehearsal and chain-specific script |
| 3.10 Fixed dependency/signer liveness and operational limits | README After launch; DISCLOSURE deployment limits; abandonment and settlement tests |
| 3.11 Callback zero-write prohibition, gas model, single-id limit and settlement recovery | GasTest all six cases; GoldensTest prepared-storage invisibility; SharedAndSettlementTest; numerical table above |
| 4.1 T1–T5 text, topic index, fixed units, canonical document and consumer domain | ComposerTest `allElevenFixtureBodiesAndPlaneHashes`, `derivedTopicTwoAndFixedUnits`, `consumerChainDoesNotChangeQuestionHash`, maximal-body fuzz |
| 4.2 T6 exact eight definitions, living/stored window, former/current holder attribution, any earlier binding, entries rather than distinct jobs, incomplete evidence | ComposerTest T6 fixture and off-mainnet window; RegistryTest 601; GoldensTest stored window; `tools/test_operator_recipe.py` six independent local recipe tests |
| 4.3 Complete catalog names, specs, thresholds and windows; mainnet question target on every chain | Catalog and Composer fixture assertions; GoldensTest full catalog; RegistryTest tier fuzz and 601; ComposerTest consumer-chain case |
| 5.1 Ordered JSON, all tiers, capped community evidence, full count, escaping, bounded hostile spec reply, preview | GoldensTest all documents, widest values, prepared visibility, hostile registry reply, preview; EncodingTest escape and Base64 fuzz |
| 5.2 Geometry, colors, partial tiers, rare dots, community rings, frame path, ASCII tables | 31 independently generated SVG/JSON cases; GoldensTest `rareDotsAndRingCountsAgainstIndependentRules`, step/minima assertions; Python clipping/rings/steps/tiling tests |
| 5.3 Maximum real-state URI gas | GoldensTest `maximumRealStateTokenURIGasAndStored601Window`; measured above |
| 6 Compiler, deterministic artifacts, sizes, no forbidden opcode/library links, static analysis | Unchanged foundry.toml; DeploymentTest artifacts; `forge build --sizes`; Slither result below |
| 6.1 Independent generator and complete synthetic goldens | `tools/gen_template.py --check`; `tools/test_generator.py`; GoldensTest byte comparisons; `docs/generation-record.json` |

## Requirement map: section 7's eighteen named checks

| Item | Tests |
|---|---|
| 1 Fees and live executor preview | RegistryTest fee tests; MainnetForkTest `realMintFeeAndExecutorPreview` |
| 2 Abandon and completed-but-undelivered requests | RegistryTest `abandonAuthorizationAndStrictBoundary`, `earlyAbandonOnlyCompletedPersonal` |
| 3 Bounded dates and both orderings at the final second | RegistryTest `datesAndLatestValidBoundary`, `expiredAt31DaysPlusOneMissesAndCanAbandon`; SharedAndSettlementTest boundary/orderings |
| 4 Request-id collision and late predecessor | RegistryTest `requestIdCollisionRollsBackFeeAndLateOldCallbackKeepsSuccessor` |
| 5 601 behavior and fixture | ComposerTest fixture/off-mainnet; RegistryTest `601StoresRequestWindowAfterHeadAdvances`; GoldensTest maximum state |
| 6 Constructor matrix, helper/executor floor, empty-chain creation | DeploymentTest first four cases |
| 7 Transfer invariants and buyer independence | RegistryTest `directTraitsFreezeAndTransfersNeverMoveFacts`; TransfersTest; InvariantsTest |
| 8 Realistic mock completion, every miss code, giant fields, exact panels, one id | RegistryTest callback tests; GasTest; mock `complete` uses assembly CALL with exactly the configured stipend and one-completion state |
| 9 Kind-3 canonical decoding, list entry floor, negative fixture, typed indexed grouping | SharedAndSettlementTest list cases; ComposerTest grammar and derived topic |
| 10 Grammar, finality, field limits, expected id, maximal body, exhaustion | ComposerTest all validation cases and fuzz; RegistryTest registration; DeploymentTest exhaustion; GoldensTest field-limit state |
| 11 All eleven request bodies and canonical hashes | ComposerTest `allElevenFixtureBodiesAndPlaneHashes`, `derivedTopicTwoAndFixedUnits` |
| 12 Five externally served signatures and protocol conformance | AttestationsTest both tests; unknown answer type names rejected by loader |
| 13 Renderer goldens, preview, hostile ABI, apostrophe, panel minima, gas | GoldensTest; EncodingTest |
| 14 Runtime determinism, immutable absence, individual/combined sizes, opcode scan | DeploymentTest `runtimeDeterminismSizesImmutableReferencesAndForbiddenOpcodes` |
| 15 Pinned real-mainnet integration, hermetic default | MainnetForkTest three opt-in cases; no environment access |
| 16 Notes, mappings, choices, sizes, gas and generation record | This document; `docs/generation-record.json` |
| 17 Conservative repricing, no zero callback writes, invisible preparation | GasTest all paths; GoldensTest prepared visibility and limits |
| 18 Completion-gated fallback settlement, bad verdict persistence, replay/refusal, shared settlement | SharedAndSettlementTest five settlement cases |

CONCEPT's twelve invariants map in order to: InvariantsTest and transfers (1–2); signed success/failure, wrong-question and shared tests (3–4); callback gas and settlement (5); direct monotonic fuzz (6); immutable-registration/fixture checks (7); goldens and frozen/stored-window tests (8); balances, deadlines and shared-list tests (9); nonmember/direct tests (10); public read/preview tests and opcode/source checks (11); native-payment rejection and no payable ABI entries (12).

## Decisions and operational boundaries

- The approved Sworn specification requires an ownerless application with fixed dependencies and its explicit constructor rehearsal floor. Those specific rules take precedence over generic oracle-consumer advice to add owner-settable dependencies, and over generic no-constructor-call wording. Helpers require code even on the floor. The floor's synthetic addresses occur only in tests; all launch arguments come from the supplied mainnet table or earlier helper deployments.
- Pending deletion is observable through status-gated views, not physical erasure of every archival word. This is the smallest layout change satisfying both clear-before-check behavior and the hard prohibition on callback writes to zero slots. Reusing an old Intake id is refused more strictly than just refusing currently pending ids.
- Replay protection is per Intake request. CONCEPT section 6 explicitly permits the same signed evidence for an identical canonical question in another pending request; no global UUID-consumption mapping was added. Completion gating still prevents an unrelated panel answer from settling an Intake request that remains incomplete. Distinct claimant/window questions have different hashes and are tested as noninterchangeable.
- The illustrative 60,000-gas failed delivery in section 7.18 would succeed for this callback. Tests lower the stipend to 10,000 to reproduce the intended out-of-gas condition, verify the Intake completed while Registry stayed pending, and then settle. The production fixture remains 200,000.
- The test brief prohibits environment access. Therefore explicit Forge fork arguments replace the specification's proposed environment-variable toggle. The default suite remains entirely offline and the selected fork is pinned by assertions.
- `mainnetHeightBound()` is the Merge anchor plus elapsed 12-second slots. It is an upper bound, not a live head oracle; skipped slots can overestimate the real head. Mainnet validation uses `block.number` and ignores the caller's block argument. Off-mainnet users must confirm actual Ethereum finality. Catalog windows are exempt from community registration guards.
- Renderer previews use a read adapter: return a synthetic token's claimant, live `traitsOf`, verified community ids, specs and evidence from the desired wallet while its real `tokenOf` remains zero. `RenderRegistry` exercises that path. A caller-supplied adapter can assert arbitrary facts; its output is not a credential. The later site must mark previews accordingly and query the authenticated Registry for eligibility.
- Metadata's oracle array is bounded to the same first 32 community ids as attributes/community, while `community_count` and rings use the complete count. Otherwise an unbounded evidence array would defeat section 5's gas bound. `verifiedSpecsOf` still returns every verified id. Item strings are never printed; only the explicitly required fields are read, with bounded `specOf` returndata and offset/length checks.
- Metadata keeps the specified historical `minPanelSize` and `minQuorum` key names, but the onchain acceptance rule is exact equality for both fields. Signed `agreed` must be between quorum and panel size. The metadata describes the required parameters, not a claim that larger panels are accepted.
- The specified T6 and other fixture questions already include the supplied plane checks/quotes and canonical hashes. They are reproduced exactly; no new paid request or lab run was made. `tools/operator_recipe.py` is a local explanatory model tested on synthetic logs, not a replacement oracle or a claim of live archive completeness.
- The only test keys, synthetic claimants and fabricated request identifiers are local fixtures. No worker key, account setting or machine configuration is an input or a deliverable. The deployment script has explicit chain constants, never reads a key and never broadcasts.
- The manifest, deployment simulation/gas ceiling, target-network repricing check, source attestation/publication, runtime comparison, independent adversarial review and post-launch website remain their designated workflow steps. There is no launch manifest or asserted new deployment address in this contribution.

## Static analysis

Slither 0.11.3 ran against the pinned build with dependency/test/script findings filtered, no disabled detector and no High-impact findings: 20 Medium, 15 Low, 31 Informational, 7 Optimization. The compact offline runtime and its checksum are ordinary files in `tools/slither-toolchain/`; `tools/run_slither.py` extracts a fresh copy only into disposable scratch and reproduces the analysis without pip or downloads. Its detailed report remains in scratch because it contains local absolute paths.

The 16 strict-equality Medium diagnostics are exact enum/kind/state rules, not manipulable balance equality. Three unused-return diagnostics concern the unused ECDSA auxiliary error word, the three unrelated Intake request fields, and the Composer's directly returned tuple (both values reach the caller). The divide-before-multiply diagnostic is deliberate Base64 rounding, checked against OpenZeppelin over fuzzed bytes and boundary lengths.

The one benign-reentrancy Low diagnostic identifies request-state preparation after `requestWithFailure`. Both user entry points are nonreentrant, the trusted Intake returns the id only after pulling payment, and an early callback cannot create a valid pending record. Callbacks themselves make no external call. Dependency/token failure and attempted reentry roll back atomically. Remaining Low diagnostics concern bounded view loops and intentional timestamp-based freshness/timeout rules. Assembly is isolated in bounded buffers, serialization, hashing and returndata decoding; fuzz, adjacent-memory, malformed-input and external-vector tests exercise it. The immutable recommendations are intentionally not adopted because the approved deterministic runtime rule prohibits immutables.

No claim is made that these checks constitute an independent security audit. Slither and Foundry ran; Mythril did not. The independent review should focus on assembly buffer bounds, parser coverage, signed-question binding, fixed dependency trust, callback storage preparation and the launch constructor arguments before release.

## Submission-size repair

The original offline analyzer wheels exceeded the 8 MiB upload limit. They are replaced by a 6,352,648-byte XZ runtime bundle of the same 47 package versions. The compressed source archive, including the contracts, tests, fixtures, ABIs, documentation and analyzer, measures approximately 6.5 MiB. The original wheels and expanded working copies are confined to disposable scratch; none are required at verification time.

`tools/pack_slither.py` documents and reproduces the reduction from checksum-pinned originals: remove upstream test/documentation build trees and build-only extension sources, strip unneeded native symbols, and use the included Python implementations for two optional accelerators. All Slither files, runtime data and licenses are preserved. The runner validates the archive checksum and extracts a fresh copy, so stale installed packages cannot supply missing dependencies.

The repaired runner passed under `python3 -S`, with installed site packages disabled, and reproduced all 73 findings with zero High impact and 100 detectors enabled. The Foundry suite passed with the supplied seed (76 passed, zero failed, one opt-in fork skip); format, generator, generation-record and ABI checks passed. This repair changes no contract, deployment argument, ABI, golden or protected build dependency.
