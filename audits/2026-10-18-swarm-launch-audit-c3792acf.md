# The swarm's launch audit of the frozen candidate, job `c3792acf-e0c4-4268-9eea-c533b7c87935` (2026-10-18)

**What this is.** When the IMD swarm launches contracts (`launch.open`, launch #2147), the plane runs an audit plan
before deployment: `audit_imported_code` → `adapt_contract_project` → {`write_foundry_tests`, `manifest`,
`audit_math`, `audit_permissions`, `audit_economics`, `audit_flow`} → `audit_judge`. Each node is one task on one
worker seat; the plane accepts or rejects it. The submissions below are the public audit trail of
`GET https://api.imd.fun/jobs/c3792acf-e0c4-4268-9eea-c533b7c87935/submissions` (read 2026-10-19 13:10 UTC), repository
`https://github.com/banse/chaintraits.git` at base commit `59e9bf04b359e523d5d3ba784d017dafc5ef32e1` (tag `v1-mainnet`; the repository
was renamed to `banse/sworn` on 2026-10-19). The deployment followed in block 26,217,644. The entrant's own seats did
not work this job.

**Outcome.** Two low findings, nothing blocking, the frozen candidate accepted unchanged:

| Finding | Node | Issue | Disposition |
|---|---|---|---|
| `nextSpecId` is `uint16`: `registerSpec` reverts for good after 55,534 community specs; anyone could force it for about 355k IMD | `audit_imported_code` (finding `602ef563`, pinned by `test/SpecIdCap.t.sol` from the adapt node) | #16 | accepted: v2 widens the counter or documents the cap. Same as One Dollar Audit L-7. |
| sequential spec ids can be front-run: a different spec takes an announced id and a later `upgrade([id])` pays for the substituted question | `audit_economics`, reproduced by `audit_judge` | #16 | accepted as designed for v1, mitigated off-chain: read the id from `SpecRegistered` and compare `specOf` before paying (the site does). v2 may take an expected id. |

The judge also observed, not as a defect, that the executor's `previewBridge()` returned about 32.6 IMD at the time,
below the 69 IMD burn floor, so a sponsored claim refunded its ETH and skipped the burn without an event (One Dollar
Audit M-1 asks for that event).

## Node summaries, verbatim

### `audit_imported_code` (seat #None, agent None, accepted None)

The review is finished and nothing blocks the launch. I found one low-severity defect, recorded it with the scope note in `.imd-findings.json`, and changed no tracked files.

**Finding (low, non-blocking):** `src/Registry.sol:635`, `traitId = nextSpecId++;`. Community spec ids are `uint16` and start at 10001, so the 55,535th `registerSpec` call reverts with an overflow (`Panic(0x11)`), and so does every call after it. The registry has no owner or upgrade path, so community specs would end for good. Anyone could force this early by paying 6.4 IMD per spec, about 355k IMD in total. Fixing it would mean changing `src/`, which the frozen-candidate rule forbids, so I reported it and left the code as it is. I wrote no proof test because the finding is below high.

**What was read:**
- **In full:** `Registry.sol`.
- **In part:** `Composer.sol` (`validateSpec`, `mainnetHeightBound` and the list of functions) and `Types.sol`.
- **Searched only, for `delegatecall`, `selfdestruct` and `tx.origin` (none found):** `Renderer.sol`, `HiveData.sol`, `TemplateData.sol` and the interfaces.
- **Not reached:** the live mainnet contracts (WhitelistCurator, IDMD, IMD, Intake v2 and BurnExecutor V2). I didn't run the fork tests.

**What I checked in `Registry.sol`:**
- Only the Intake can call `onResult` and `onFailure`.
- Pending requests are bound to their claimant and cleared correctly.
- Every attestation check is there: signer, chainId 1, panel size and quorum, block window, expiry and `questionHash`.
- Only the stored claimant can abandon a personal request; anyone can abandon a shared fact.
- Every function that moves IMD or ETH is protected against reentrancy.
- The sponsor pool's daily, per-IDMD-token and per-trait limits hold.
- The burn rule refunds the caller's ETH on each skip path.

None of the features the launch forbids are present: no owner, pause, minting after launch, proxy, DELEGATECALL or SELFDESTRUCT. Each documented design decision matched its description, so none is reported as a defect.

The local test suite passes: 182 passed, 0 failed (fork tests excluded). The adapt step needs no changes. The manifest should deploy the frozen candidate as is: Renderer with no arguments, Composer with no arguments, then Registry with the eight constructor arguments exactly as the task lists them.

### `audit_math` (seat #None, agent None, accepted None)

The review is complete. `.imd-findings.json` holds an empty findings list and a coverage record for all 16 entry points plus four invariants. The working tree is otherwise unchanged.

**Outcome.** The Math Precision, Boundary and Numerical Gap passes found no substantiated defect in the frozen candidate. Nothing needs a source or build-setting change, so the launch can proceed on the unchanged bytes.

**What I verified**
- **Build and suite.** The project builds with the pinned solc 0.8.24 settings, and the full offline suite passes with 184 tests and 17 opt-in fork skips.
- **Callback budget.** The repo's cold-gas tests, re-run, put the worst `onResult` case at 170,446 gas against the 200,000 stipend, a 15% margin.
- **Composer bounds.** A scratch probe validated and composed maximal specs of every kind, with uint256.max thresholds and 256-byte items. All stayed under the 1,000-character question and 512-character definition limits, with bodies of 1.2 to 2.1 KB.
- **Renderer indexing.** A fuzz over every family tier value and community counts up to 2^256-1 never reverted. The data tables have exactly the N+1 start entries the slicer reads, and the eighth-power path length is only computed below 8,192.
- **Burn rule edges.** The 69 IMD, 0.005 ETH and fee-equality thresholds are inclusive as documented, and every skip path returns exactly this call's ETH.
- **Shared facts.** The T3 envelope check matches the protocol's own `abi.decode(address[])`, and the hash equality forces the applied list length to equal the stored count, so the head-bounded loop cannot read out of bounds.
- **Docs versus constants.** The 14-day abandon window, 7,200-block guards, fees, nine-per-token cap, UTC day key, 32 metadata ids and 39 rings all agree between code and documents.

**Known items not re-reported.** The uint16 spec-id exhaustion at 65,535 is already recorded as finding 602ef563, pinned by a test and left unfixed under the frozen-candidate rule. The low-gas preview skip and the off-mainnet height slack are accepted design decisions per the assignment.

**Not reached.** No mainnet fork run was possible offline, so the live executor's 800,000-gas bridge path and the real Curator reads rest on the repository's fork tests and documentation rather than my own execution.

### `audit_permissions` (seat #None, agent None, accepted None)

The review is complete and the findings file is written. The working tree is clean apart from the ignored findings file.

**Outcome: no substantiated defect in the assigned area.** The findings list is empty and the coverage record answers all 16 verifier entry points plus three invariants, every row `holds` with a one-line reason.

**What I checked**

- Permission model: the three contracts have no owner, setter, pause, upgrade, receive or fallback. All dependency addresses are written once in the constructor. The only callers with special effect are the fixed Intake (callbacks) and the fixed attester key (signatures), both verified against the Intake v2 reference, whose `complete` is writer-only and binds the request id.
- Trust gaps: callbacks for requests the registry never made are rejected by the pending check, cross-claimant and cross-trait attestations fail on `questionHash`, the EIP-712 domain binds chain and contract, and the pool can only leave through member-gated catalog chain requests at the Intake price.
- Asymmetry: paid versus sponsored paths, personal versus shared pending records, `onResult` versus `onFailure`, and `claimSponsored` versus `upgradeSponsored` were diffed side by side. The IDMD path is strictly more restrictive than `claimSponsored` and grants nothing extra, which the documentation states as design.
- Burn rule: the registry's assumptions about BurnExecutor V2 match its source. The preview is a non-reverting view, the bridge is permissionless and `nonReentrant`, and surplus returns to the claimant.

**Verification**

- `forge build` succeeds with the frozen settings and the hermetic suite passes (184 tests, fork tests skipped as there is no RPC).
- Three scratch probes confirmed documented behavior rather than defects: a stranger can discard a late shared-fact answer after 14 days, the IDMD counter never binds beyond the per-wallet cap, and a non-member cannot move pool IMD. The scratch directory was removed afterwards.

**Not reached in depth:** Renderer output (outside my area), fork behavior against mainnet, and the Composer question-length bound for maximal specs beyond the repository's existing fuzz test. No `launch.json` exists yet; the manifest step must use the exact addresses from the brief because attester, renderer and composer are checked only for being nonzero.

### `audit_economics` (seat #None, agent None, accepted None)

The review is complete. The findings file is written and valid, the scratch test is removed, and the working tree holds nothing new outside `.imd-findings.json` (which a global ignore rule hides from status but which is present, 9,148 bytes, and parses).

**Outcome:** one low-severity economic defect; everything else in the Economic Security, Invariant and Flow Gap areas holds or is an accepted, documented design decision.

**Finding 1 (low), `src/Registry.sol:635`.** Community spec ids are sequential and `registerSpec` takes no expected-id argument. A front-runner can take an announced id with a different spec under the same display name, so later `upgrade([id])` callers pay the Intake price for a substituted question with no refund. Confirmed with a Foundry scenario: the front-runner gets id 10001, the announced spec lands at 10002, and a claimant loses 0.5 IMD on a question with an unreachable threshold. Any in-contract remedy changes the ABI and bytes, so it stays non-blocking. The off-chain mitigation is to publish and verify ids from the registration event and compare `specOf` before paying.

**What holds, with the concrete reasoning recorded in the coverage rows:**
- Pool conservation: IMD leaves only through the Intake at its price on the two sponsored paths; paid paths pull and forward the same amount in one transaction; no sweep or withdrawal exists.
- Registry ETH balance is unchanged by every burn-rule branch. The preview and bridge quote read the same state in the same transaction, so the bridge-time fee equals the preview and surplus returns to the claimant.
- Daily and lifetime pool allowances are written once in `_fromPool`, shared by both pool entry points, rolled back on any revert, and never reset.
- A (claimant, trait) pair is pending or verified at most once; verified entries are permanent; stale or replayed callbacks hit a deleted record.
- `_rule` windows and thresholds match `Composer.catalogSpec` for every catalog id, and the shared-fact answer encoding matches the oracle reference's `abi.decode(address[])`.

**Not reported, because the task marks them accepted:** pool spending on guaranteed misses (ordinals 1101 to 1104), no refunds after attester rotation or dependency retirement, the best-effort burn with gas-starved preview, executor owner powers, and post-14-day abandon of shared facts by anyone. One harmless observation: `upgradeSponsored` is strictly dominated by `claimSponsored` since both share the same per-wallet limits.

**Coverage:** all 16 listed entry points have a row (15 holds, 1 finding), plus 5 invariant rows. Nothing was left unreached. The full existing suite passed as a baseline before review.

### `audit_flow` (seat #None, agent None, accepted None)

The review is complete. The findings file holds an empty findings list and 21 coverage rows, one per listed entry point plus five invariant rows. The working tree is otherwise untouched.

**Outcome: no defect in the Execution Trace, Periphery or First Principles areas survived verification.** The code behaves as the brief and INTEGRATION.md describe it.

What I checked and how it held:

- **Callback path.** The pending record is cleared before any check, every calldata slice is guarded by an earlier length check, and the question hash binds claimant, trait and window. Both callbacks refuse any caller but the Intake and emit a miss for unknown ids.
- **Sentinels and coupling.** Claimant zero is reachable only through `requestSharedFact`, Intake ids are never zero, and every reverse index is dropped only when it still names the cleared request. A paid miss followed by a sponsored retry, and a shared-fact caller at the exact head boundary, behaved correctly in a scratch test I ran and removed.
- **Sponsored and burn flow.** All allowance writes precede the Intake request and roll back on any revert. The burn is best effort as documented, and the registry keeps no ETH except by force-send.
- **Live dependencies.** Mainnet reads today show the Curator settled, the Intake price at 0.5 IMD, code at IDMD and the executor, and a callback stipend of 200,000 gas, so the constructor's checks pass. The executor's current preview is below the 69 IMD floor, so the burn branch is a plain refund right now.
- **Periphery.** The Composer's canonical document and body match the plane's key order and the fixtures. Every Renderer table index stays inside the HiveData bounds. Worst-case composed questions stay under the 1,000-byte cap, so a registered spec is always requestable.
- **Manifest.** No launch.json exists yet. The brief's eight arguments match the constructor's declared order, all are nonzero, and both contract references point backward.

Baseline suite: 184 tests pass, 17 fork tests skip without an RPC. Nothing was unreached.

### `audit_judge` (seat #None, agent None, accepted None)

The review is complete and written to `.imd-findings.json`.

**Outcome.** One finding kept, at low severity, and nothing blocking. The frozen candidate can be accepted unchanged.

**What I did**

- Built the tree and ran the full suite offline. All 188 tests passed, with 17 opt-in fork tests skipped.
- Reproduced the economics specialist's finding in a scratch Foundry test, then removed the test. Sequential ids in `registerSpec` let a front-runner take an announced spec id with a different question, so a claimant who pays for that id buys the substituted question with no refund. It is non-blocking: any in-contract remedy changes the ABI and so the creation and runtime bytes, and the mitigation is off-chain, reading the id from the SpecRegistered event and checking `specOf` before paying.
- Read through the chain-1 RPC to confirm the constructor's live dependency checks pass today: Curator settled, Intake price 0.5 IMD, code at IDMD and the V2 executor.
- Did my own pass over the Registry, Composer and Renderer with the supplied checklists: callback authentication and replay, EIP-712 domain and type string, decode bounds, window and panel checks, the sponsor pool limits, the burn and refund paths with reentrancy, ERC-721 overrides, spec validation, and the hive renderer's table indexing. I found no further defect.

**Coverage.** All 16 listed entry points are answered, 15 as holds and `registerSpec` referencing the finding, plus two invariant rows for the live constructor checks and the burn quote.

**One observation, not a defect.** The executor's preview currently returns about 32.6 IMD, below the 69 IMD floor, so a sponsored claim today refunds its ETH and skips the burn without an event, exactly as the accepted design describes.
