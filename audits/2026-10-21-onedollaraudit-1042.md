# One Dollar Audit, job 1042: dispositions

**Date:** 2026-10-21. **Reviewed target:** `src/Registry.sol` at commit `832cc45f59acdda805b51799647be24c0cae9741`
(github.com/identity-md-launches/launch-2341-renderer-composer-registry), deployed as the Registry
`0xdd0017e40f1a5fe514d15d108ce01eb52f2a5edb` on Ethereum mainnet (swarm launch #2341, 2026-10-20, `DEPLOYMENTS.md`).
**Reviewer:** One Dollar Audit (onedollaraudit.com, LeftClaw Services), automated multi-agent pipeline (phase 0 context, 7
breadth checklists, 12 blind depth agents, reconciliation), commissioned by the entrant for 1 USDC on Base (x402, EIP-3009),
job 1042 complete 2026-10-20 23:37:37 UTC. **Report:** `2026-10-21-onedollaraudit-1042.report.md` (verbatim; sha256
`75e7c96d3fc7aeaa196867e8cadf2ee5814a66727148a2285de5be789e56ef3b`), IPFS
`bafkreidv47ew2p6hv2vbs2dh5dfn6lxfqffgm4trjcrcqxpfxz4j4vxphm`, HTML https://leftclaw.services/result/1042.html.
Companion jobs 1043 (Composer) and 1044 (Renderer) were still in progress when this was written.

**Verdict:** 3 high, 3 medium, 7 low, 5 informational. The contracts have no owner and no setter, so nothing below changes the
deployment; each line says what the entrant does instead. The user-facing summary is in `DISCLOSURE.md` ("Limits of this
deployment").

# Disposition (the entrant, 2026-10-21)

States: **accepted as designed** (a decision written down before the launch; no change), **mitigated** (an operational step
that closes the path for this deployment), **next cut** (a code change for a later deployment, none planned), **noted**
(no defect, or a lead that does not clear its own gate).

| Finding | State | Disposition |
|---|---|---|
| F-1 H: one IDMD seat can be passed from wallet to wallet to mint any number of cards with "Armed" (601) frozen on | accepted as designed | `docs/V2.md` item 14 (One Dollar Audit 1033 M-2, decided 2026-10-19): Armed is a snapshot at the mint block and the catalog says so ("held an IDMD seat when the card was minted"). The IDMD collection records no holding history, so a minimum holding period cannot be checked against it; a borrowed seat counts. Cost of a forged Armed card: one card per wallet, 0.1 IMD plus gas, and the seat must sit in that wallet at the mint block. No value depends on 601 inside Sworn. The limit is now stated in `DISCLOSURE.md`; a contract that gates on 601 should treat it as "had access to a seat", not "is a seat holder". |
| F-2 H: a Curator member can draw from the pool for a fact known to be false, every UTC day, because a failed sponsored request gives its (wallet, trait) reservation back and only verified traits count toward the lifetime limit | accepted as designed | `docs/V2.md` item 3 (cross audit 2026-10-19, written 2026-10-20): "ten failed sponsored attempts on ten UTC days are all accepted and the pool pays ten prices; accepted, the pool draw cap bounds the damage". Bounds: one draw per wallet per UTC day, at most an eighth of the pool and 2 IMD per draw (item 1). The pool is a subsidy made of mint fees, registrations and donations, not user deposits; on 2026-10-21 it holds 0.1 IMD and no draw is possible below 4 IMD at the 0.5 IMD price. Next cut: keep the reservation after a judged-false verdict (`Missed` reason 8) and release it only when the oracle gives no verdict (`onFailure`, check reasons 2 to 7, 9, 10). |
| F-3 H: a shared-fact request that the plane never completes locks the fact id for everyone, because only its payer may `abandon` after 31 days | accepted as designed, mitigated | `docs/V2.md` item 5 (One Dollar Audit 1033 M-4): the opposite risk, a stranger clearing a paid request after 14 days while the oracle has 30, was fixed by vesting `abandon` in the payer. The lock needs the Intake to never complete a request; it completes every request with `onResult` or `onFailure`, and both clear the pair. The fee is non-refundable in every case. Mitigation for the one catalog shared fact (1201): the entrant requests it once from its own wallet (rehearsed on a mainnet fork at block 26,237,384 on 2026-10-21: 376,895 gas, fee delivered to the Intake); once stored, `FactAlreadyStored` closes the request path for good. Community T3 specs (none registered) keep the exposure; next cut: permissionless `abandon` of a shared fact after `ABANDON_AFTER`. |
| F-4 M: no aggregate daily cap on pool outflow across distinct member wallets | accepted as designed | The per-draw cap (an eighth of the pool, 2 IMD) is the only aggregate bound; N colluding members can take up to 1 − (7/8)^N of the pool in a day. Same subsidy argument as F-2. Next cut candidate: a daily outflow ceiling as a fraction of the pool at day start. |
| F-5 M: the constructor's empty-floor branch skips the code checks of `renderer`, `composer` and `burnExecutor` | next cut | Moot for this deployment: all eight dependencies had code at construction (the floor branch did not run; the launch gate compared the eight getters and the decoded constructor arguments, `DEPLOYMENTS.md`). Next cut: check the three unconditionally. |
| F-6 M: one fixed attester key, no rotation; panel size and quorum are the attester's own numbers | accepted as designed | The attester is the IMD plane's signer, fixed at construction like every dependency; an ownerless registry has no rotation path by design. Stated on the site ("the oracle signer, Intake, BurnExecutor V2 and bridge have their own trust and operational boundaries") and in `DISCLOSURE.md`. The consumer-side checks (`agreed >= quorum`, minimum panel and quorum per kind, issue #20) are the bound the registry can enforce. |
| F-7 L: attestation bound to the pending record by `questionHash` only; `expiresAt − issuedAt` not bounded on chain | noted, next cut | The delivery is bound by `_pending[requestId]` (the Intake's consumer id, completed exactly once). The oracle's own id `a.requestId` is assigned off chain and is not derivable at request time, so the recommended `a.requestId == requestId` check cannot exist. The expiry gap is real for an attestation issued more than a day after its request: a late valid answer after an `abandon` lands as `Missed(…, 1)` and the fee is already spent. Next cut: require `a.issuedAt >= p.requestedAt` and `a.expiresAt <= a.issuedAt + VALID_FOR_SECONDS`. |
| F-8 L: the shared fact's address list is not in any event | accepted as designed | Gas: the list is recoverable from the `onResult` calldata, and the site's "apply the list" flow rebuilds it from there. Next cut candidate: emit the list. |
| F-9 L: `uint16` downcast of the answer length relies on cross-file bounds | noted | `_decodeAndJudge` checks `n == threshold` (32 for 1201, the spec's threshold for a community T3) before the downcast in `onResult`; the bound is local. |
| F-10 L: `_request` stores under the Intake's id without an occupancy check | next cut | Intake v2 derives ids from its own counter and completes each once; a one-line `requestedAt != 0` revert costs nothing and goes into the next cut. |
| F-11 L: unbounded returndata copy from `previewBridge()` | next cut | The executor is the fixed BurnExecutor V2 (`DEPLOYMENTS.md`), read behind a 600,000-gas stipend; a bounded copy goes into the next cut. |
| F-12 L: `_specsOf` grows without bound and is read by `verifiedSpecsOf` and `tokenURI` | accepted as designed | `docs/V2.md` item 19: `tokenURI` at the maximum state measures 10,317,448 gas (regression test in the repo); the caps bound it. |
| F-13 L: core reads have no `try/catch` | accepted as designed | Fail closed is the rule (site spec principle 2): an unavailable dependency reverts rather than answers. |
| F-14 I: the refund-revert path of `_burnOrRefund` can undo an already placed sponsored request, against its own comment | noted | A caller harming its own transaction; the comment is corrected in the next cut. |
| F-15 I: `nextSpecId` is `uint16`; registration ends after 55,534 community specs | accepted as designed | `docs/V2.md` item 9 kept 16-bit ids; a test pins the end at id 65,534. |
| F-16 I: fixed gas stipends to the executor | accepted as designed | Measured from a cold mainnet trace (`PREVIEW_GAS`, `BURN_GAS`, item 6) with 2.2x headroom; a repricing that breaks them skips the burn with `BurnSkipped`, never the request. |
| F-17 I: duplicate trait ids revert the whole `upgrade` batch | accepted as designed | Atomic batches; the site prevents duplicates. |
| F-18 I: no length cap on `upgrade()`'s array | noted | Bounded by gas and by the IMD the caller pays per id. |

**Resolved during the auditor's own reconciliation:** the "`safeTransferFrom` to a codeless `imd` silently succeeds" lead was
refuted by the auditor against OpenZeppelin v5's `AddressEmptyCode` revert; two self-harm-only leads were not reported.

**What this changes:** nothing in the deployment and nothing in the launch decision. No finding gives a third party a way to
take user funds or to write a false fact. The three highs are limits the entrant chose and wrote down before the launch
(F-1, F-2) or a liveness tension of a chosen fix (F-3), now stated for users in `DISCLOSURE.md`, with F-3 closed for the
catalog's shared fact by the entrant's own request. The next-cut list, in order: F-3 permissionless shared abandon, F-2
reason-aware release, F-7 expiry bound, F-5 unconditional code checks, F-10 occupancy check, F-11 bounded copy, F-4 daily
cap, F-8 list event.

---

The verbatim report follows.

# Security Review — Registry.sol (Sworn registry)

**Scope (as pinned by the client):** `src/Registry.sol` only, from
**Repo:** https://github.com/identity-md-launches/launch-2341-renderer-composer-registry
**Commit:** `832cc45f59acdda805b51799647be24c0cae9741` (verified reachable: `git ls-remote` confirms this commit on the remote `main`-tracked history; checked out via `git fetch --depth 1 origin <sha> && git checkout --detach FETCH_HEAD`)
**On-chain target named in the job:** `0xdd0017e40f1a5fe514d15d108ce01eb52f2a5edb` (Ethereum mainnet, chain id 1)
**Compiler:** solc 0.8.24, optimizer runs 200, evm-version cancun, `bytecode_hash = "none"`

Imported files (`Composer.sol`, `Renderer.sol`, `Types.sol`, `HiveData.sol`, `TemplateData.sol`, `src/interfaces/*.sol`) were read for call-chain and cross-file-assumption context only, per the client's file-scoped brief — every finding below roots its defect in `Registry.sol` itself.

**Methodology:** four-phase audit — Phase 0a mechanical pre-scan (scope-scaled to the single-file brief: grep-verified entry points + invariant catalog, hand-built rather than running the full-repo `x-ray` scripts against the ~21k-LOC monorepo, which is disproportionate for a one-file scope) → Phase 0 context building (3 parallel opus agents: access-control inventory, protocol map, external-surface map) → Phase 1 breadth (7 sonnet agents, one per `evm-audit-*` checklist: general, precision-math, access-control, erc721, signatures, oracles, dos) → Phase 2 depth (12 sonnet agents — pashov solidity-auditor V4's 9 specialists + 3 gap-hunters — run **blind** to Phase 1's findings, armed with the Phase 0 map and the invariant catalog) → hybrid reconciliation (this document). A prior audit of a byte-identical or overlapping target may exist in the marketplace's history; every finding below was independently re-derived by this job's own phase 0/1/2 agents, not copied forward.

**Severity counts:** 3 High · 3 Medium · 7 Low · 5 Informational

**Coverage:** 10/10 state-changing entrypoints addressed · 9/9 threat-catalog rows answered · 8/8 inferred invariants answered (5 hold, 2 violated → findings below, 1 could not be independently verified; 0 coverage holes — every row had already been examined by Phase 0/1/2, this pass only re-derived citations). Full detail in **Coverage Gate** and **Invariant Verification** below.

---

## Findings

### [F-1] One IdentityMD NFT can mint unlimited, permanently-"Armed" Sworn cards with zero holding period
**Severity:** High
**Location:** `mintCard()` — `Registry.sol:246-256`; bit layout `Registry.sol:116-118`; live source `hasDirectTrait()` `Registry.sol:293-300`; underlying read `Composer.sol:168` (`_direct`, context file)

**Description:** `mintCard()` freezes `composer.directSnapshot(msg.sender, curator, idmd)` into `frozenDirect[tokenId]` forever (`Registry.sol:253`), with no block-delay or holding-period requirement. Twelve of the thirteen direct traits read immutable, already-settled `WhitelistCurator` ledger entries that cannot be recreated on demand. Trait 601 ("Armed") is the one exception: `Composer._direct` resolves it as `idmd.balanceOf(wallet) >= 1` (`Composer.sol:168`) — a live, freely transferable ERC-721 balance, with no minimum-holding check anywhere in either file.

```solidity
// Registry.sol:253
frozenDirect[tokenId] = composer.directSnapshot(msg.sender, curator, idmd);
```
```solidity
// Composer.sol:168
if (traitId == 601) return idmd.balanceOf(wallet) >= 1;
```

**Proof of Concept:** An attacker holding one IdentityMD NFT in wallet `W0` repeats, for `i = 1..N`: `idmd.transferFrom(W0, Wi, tokenId)` → `Registry(Wi).mintCard()` (pulls `frozenDirect[tokenId_i]` with bit 20 set, per `Registry.sol:117`) → `idmd.transferFrom(Wi, W0, tokenId)`. Each `Wi` ends up with `hasDirectTrait(Wi, 601) == true` forever (`frozenDirect` is never rewritten after mint — grep-confirmed single write site), for a per-wallet cost of `MINT_FEE` (0.1 IMD) plus gas. One real NFT forges an unbounded number of permanent "Armed" credentials.

**Recommendation:** Require a minimum holding duration (e.g., `idmd` balance held for N blocks, checked via a snapshot/checkpoint mechanism) before trait 601 can be frozen, or source it from a non-transferable record instead of a live `balanceOf`.

---

### [F-2] `claimSponsored` lets any Curator member drain the shared pool for free by repeatedly claiming a trait it already knows will fail
**Severity:** High
**Location:** `claimSponsored()` — `Registry.sol:721-736`; `_release()` — `Registry.sol:488-490`; failure branch — `Registry.sol:511-514`

**Description:** `claimSponsored` pays for an oracle request out of the shared pool (`pool() == imd.balanceOf(address(this))`) on behalf of any wallet the external `WhitelistCurator` reports as having ever deposited (`curator.firstHourOf`, confirmed by the interface's own NatSpec to mean "ever joined," not literally "first hour" — `src/interfaces/IWhitelistCurator.sol:20-22`). On a failed verdict (`onResult` reason != 0), `_release()` unconditionally deletes `poolUsed[p.claimant][p.traitId]` — with no distinction between "the oracle could not reach a verdict" and "the claim is deterministically false." `sponsoredVerified` only increments on **success** (`Registry.sol:522`), so a wallet that always targets a trait it is known in advance to fail never advances toward the 9-lifetime cap, and `poolUsed` resets every time, re-opening the same (wallet, trait) slot for the very next UTC day.

```solidity
// Registry.sol:488-490
function _release(Pending memory p) internal {
    if (p.sponsored) delete poolUsed[p.claimant][p.traitId];
}
```
```solidity
// Registry.sol:511-514
if (reason != 0) {
    _release(p);
    emit Missed(requestId, p.traitId, reason);
    return;
}
```

**Proof of Concept:** A wallet that joined the WhitelistCurator game but is provably not, e.g., contributor #19522 calls `claimSponsored(1104, maxPrice)` (trait 1104 = "PID #19522", a deterministically-false claim for this wallet). The pool pays `price` IMD to Intake (`_request`, `Registry.sol:733`); the oracle attests the claim is false (`reason = 8`); `_release` deletes `poolUsed[attacker][1104]`; `sponsoredVerified[attacker]` stays untouched. The next UTC day, `lastPoolDay` allows a repeat, and `poolUsed` is clear again — the attacker repeats indefinitely, draining `pool()/8` (capped at `POOL_DRAW_CAP` = 2 IMD) from the shared pool every day at zero cost beyond gas, bypassing both the "once per (wallet, trait)" and "9 lifetime" budgets, which bind only successful claims.

**Recommendation:** Keep `poolUsed[claimant][traitId]` set after a failed **sponsored** draw (do not release it in `_release` when `p.sponsored` is true and the failure reason indicates a deterministic "no," as opposed to "no verdict reached"), or charge the claimant rather than the pool for each sponsored attempt.

---

### [F-3] A shared-fact request can become permanently un-resolvable if the oracle pipeline stalls and the original payer never calls `abandon`
**Severity:** High
**Location:** `requestSharedFact()` — `Registry.sol:669-674`; `_request()` — `Registry.sol:447-474`; `abandon()` — `Registry.sol:418-426`

**Description:** `requestSharedFact` is the only way to populate a shared catalog fact; while `sharedPending[factId] != 0`, every further call reverts (`AlreadyPending`, `Registry.sol:456`). The only paths that clear it are `onResult`/`onFailure` (Intake-gated) or `abandon`, which for a shared fact is restricted to `msg.sender == p.payer` — the one wallet that happened to call `requestSharedFact` first (`Registry.sol:422`, `p.payer` set at `Registry.sol:469`). Registry has no owner, admin, or permissionless rescue path anywhere (grep-confirmed).

```solidity
// Registry.sol:422
if (msg.sender != (p.claimant != address(0) ? p.claimant : p.payer)) revert NotClaimant();
```

**Proof of Concept:** Any wallet (including a disposable/burner address, or an attacker deliberately griefing a popular fact id) calls `requestSharedFact(1201, maxPrice)`. If the Intake/attester pipeline never resolves that specific request — a scenario this contract is explicitly designed to tolerate for personal traits via `abandon` — fact 1201 is permanently blocked for every other wallet in the ecosystem, because only the original payer may call `abandon` once 31 days pass, and nothing compels or allows anyone else to. This is a shared, community resource gated by a single historical caller's goodwill or key custody, unlike personal traits where the natural, motivated beneficiary (the claimant) holds that same right over their own slot.

**Recommendation:** Make `abandon` permissionless for shared (non-personal) pending requests once `ABANDON_AFTER` has elapsed — a shared resource benefiting arbitrary third parties via `applySharedFact` has no reason to vest a monopoly retry-right in one historical caller, especially since the fee is already non-refundable either way.

---

### [F-4] No cap on how many distinct Curator-member wallets can each draw from the shared pool on the same day
**Severity:** Medium
**Location:** `claimSponsored()` — `Registry.sol:721-736`; `sponsor()` — `Registry.sol:713-716`; `pool()` — `Registry.sol:709-711`

**Description:** Independent of F-2's single-wallet retry mechanism, `claimSponsored`'s rate limits (`poolUsed`, `sponsoredVerified`, `lastPoolDay`) are all keyed to `msg.sender`; nothing bounds how many **distinct** eligible wallets (an externally-controlled, already-settled population — see F-2) can each draw up to `pool()/8` on the same UTC day. An entity controlling or coordinating N member wallets can compound-drain up to `1-(7/8)^N` of the pool's balance in one day, funded by whatever mint/spec fees and `sponsor()` donations happen to sit in the same undifferentiated balance (`pool()` is simply `imd.balanceOf(address(this))`, with no segregated accounting).

**Proof of Concept:** N distinct wallets, each independently satisfying `curator.firstHourOf`, each call `claimSponsored` for a (possibly different) catalog-chain trait id on the same day; each individually passes every per-wallet guard, and each draw is capped only relative to the pool balance *at that instant*, so successive draws compound against an already-shrinking pool.

**Recommendation:** Add an aggregate daily pool-outflow cap independent of the per-wallet limit (e.g., a `dailyPoolSpent` ceiling as a fraction of the pool's balance at day-start), if this exposure is not an accepted design tradeoff.

---

### [F-5] The constructor's "empty floor" branch skips code-presence checks for `renderer`, `composer`, and `burnExecutor`, none of which relate to the floor condition
**Severity:** Medium
**Location:** Constructor — `Registry.sol:205-239`, specifically `Registry.sol:220-230`

**Description:** `floor` is defined only from `curator_`, `idmd_`, `imd_`, `intake_` all being codeless (`Registry.sol:220-221`). When `floor` is true, the entire `if (!floor)` block is skipped — including the code-length checks on `idmd_`/`renderer_`/`composer_` and the `ExecutorHasNoCode` check on a nonzero `burnExecutor_` — even though `renderer_`, `composer_`, and `burnExecutor_` are logically unrelated to whether `curator_`/`idmd_`/`imd_`/`intake_` have code. All eight addresses are then stored unconditionally with no setter anywhere in the contract.

```solidity
// Registry.sol:220-230
bool floor =
    curator_.code.length == 0 && idmd_.code.length == 0 && imd_.code.length == 0 && intake_.code.length == 0;
if (!floor) {
    if (idmd_.code.length == 0 || renderer_.code.length == 0 || composer_.code.length == 0) {
        revert DependencyHasNoCode();
    }
    require(curator.isSettled(), "Curator not settled");
    require(IERC20Metadata(imd_).decimals() == 18, "IMD decimals");
    require(IIntake(intake_).priceOf(ACTION, imd_) != 0, "Intake price");
    if (burnExecutor_ != address(0) && burnExecutor_.code.length == 0) revert ExecutorHasNoCode();
}
```

**Proof of Concept:** A deployer performing a documented "empty-chain floor" launch (curator/idmd/imd/intake not yet deployed) passes a predicted-but-not-yet-deployed `burnExecutor_` address (or a stale placeholder) alongside the floor addresses. The constructor stores it with no code check. The contract's own comment (`Registry.sol:195-197`) explains the consequence precisely: `_burnOrRefund`'s preview decode happens outside the `try/catch`, so a codeless nonzero executor reverts **every** `claimSponsored` call forever, with no recovery path since the contract is non-upgradeable and has no setter. The same applies to `renderer`/`composer` — if either never receives code, `tokenURI`/`mintCard`/`upgrade`/`registerSpec`/`claimSponsored` all revert permanently.

This requires deployer misconfiguration rather than a third-party attack (Gate 3 of our validation standard: an admin/deployer-only action needs a concrete unprivileged amplifier to rate above Medium, and none applies here — the harm lands on the deployer's own launch, not a victim distinct from the party making the mistake), so it is rated Medium rather than High despite the "forever" consequence.

**Recommendation:** Check `renderer_.code.length`, `composer_.code.length`, and (if nonzero) `burnExecutor_.code.length` unconditionally, outside the `if (!floor)` block, since none of the three are part of the floor condition.

---

### [F-6] Every oracle trait depends on one fixed EOA's signature with no rotation path, and the "panel" is a self-reported count never verified on-chain
**Severity:** Medium
**Location:** `_check()` — `Registry.sol:562-590` (signature check `Registry.sol:581-582`, panel/quorum check `Registry.sol:585`); `attester` storage — `Registry.sol:108`, set once at `Registry.sol:234`

**Description:** Every oracle-sourced trait, for every wallet, past and future, is gated by exactly one ECDSA signature from a single fixed EOA with no setter anywhere in the file (grep-confirmed). The "5/3" and "11/7" panel semantics (`_panelOf`, `Registry.sol:338-340`) enforced at `_check`'s check 5 (`Registry.sol:585`) are pure integers taken verbatim from the attester's own attestation payload — the actual panel members' identities and votes are never independently verified on-chain in any form.

**Proof of Concept:** Not independently exploitable without first compromising the attester key or the off-chain attestation pipeline (out of this file's scope) — this is reported as a structural trust-concentration risk, not a demonstrated code bug. Given that precondition, an attacker can mint arbitrary verified traits for any claimant, including permanent, uncorrectable shared facts (`_verified`/`_shared` are never deleted or overwritten once set — `AlreadyVerified`/`FactAlreadyStored` guards at `Registry.sol:452`/`455`/`682`).

**Recommendation:** Consider an on-chain threshold/multisig scheme for the attester role, or at minimum a timelocked/guarded rotation mechanism, so a compromised key does not imply permanent, irrecoverable compromise of the entire identity registry. If a single-signer trust model is an accepted design tradeoff for this launch, state it explicitly in client-facing documentation.

---

### [F-7] `onResult` does not bind an attestation to the specific pending request it resolves, and `_check` does not bound the gap between `issuedAt` and `expiresAt`
**Severity:** Low
**Location:** `onResult()` — `Registry.sol:500-524`; `_check()` — `Registry.sol:562-590` (specifically check 10, `Registry.sol:588`, and the window check, `Registry.sol:587`); `abandon()` — `Registry.sol:418-426`; constant `ABANDON_AFTER` — `Registry.sol:77-79`

**Description:** `_check` binds a delivered attestation to a pending record only via `a.questionHash == p.questionHash` (`Registry.sol:588`). Because `composeBody`/`Composer.compose` derives `questionHash` purely from `(traitId, spec-fields, claimant)` with no per-request nonce, every re-request of the same `(claimant, traitId)` — e.g. after a `Missed` verdict, which the code's own comment explicitly permits retrying "at once" (`Registry.sol:498`) — produces an **identical** `questionHash`. Separately, `_check` verifies only that an attestation has not yet expired and was not issued too far in the future (`Registry.sol:587`); it never bounds `a.expiresAt - a.issuedAt` against `Composer.VALID_FOR_SECONDS` (30 days), which is the assumption `ABANDON_AFTER = 31 days` (one day past that 30-day window) explicitly relies on per its own comment (`Registry.sol:77-79`) to guarantee a late answer can never collide with an abandoned slot.

This gap converged across **seven independent Phase 1/Phase 2 passes** (access-control, general, and five of the twelve depth agents), which is strong signal that the code-level gap is real. One Phase 2 agent raised it as a full FINDING with a "pays twice" framing; on reconciliation we down-rate that framing, because the described sequence (abandon a slow request, re-request, the stale attestation lands as a harmless `Missed(requestId, 0, 1)` no-op against the already-cleared slot) does not demonstrate double-crediting or theft on its own — Registry's own `_pending[requestId]` lookup (keyed on the exact Intake-assigned id) is a real, concrete guard that interrupts same-id redelivery. A genuine double-credit or misattribution would additionally require the out-of-scope Intake contract to route a stale attestation's data against a *different*, newer `requestId` — a scenario none of the seven converging agents could verify from Registry.sol alone, and which Gate 1 of our validation standard treats as a REJECTED/DEMOTED speculative completion rather than a cleared attack path.

**Proof of Concept (of the code-level gap, not of fund loss):** Request a catalog trait at `t0`; the attester legitimately issues a signature at `issuedAt = t0 + 10 days` with `expiresAt = issuedAt + 30 days = t0 + 40 days`. At `t0 + 31 days`, `abandon()` is already callable (`Registry.sol:421`), while the attestation remains cryptographically valid for 9 more days — the invariant the `ABANDON_AFTER` comment claims ("an attestation is dead before a pending pair can be abandoned") does not hold in this scenario.

**Recommendation:** Add `a.requestId == requestId` (the Intake-level id) as an explicit check inside `_check`, and additionally enforce `a.expiresAt <= a.issuedAt + Composer.VALID_FOR_SECONDS` on-chain, so the safety margin `ABANDON_AFTER` relies on is guaranteed by code rather than assumed of off-chain parties.

---

### [F-8] A shared fact's answer list is only recoverable from raw `onResult` calldata, not from any emitted event
**Severity:** Low
**Location:** `onResult()` — `Registry.sol:516-520`; `SharedFactStored` event — `Registry.sol:145`

**Description:** On a successful kind-3 (shared fact) resolution, Registry stores only `keccak256(a.answer)` and a length (`Registry.sol:518`) and emits `SharedFactStored(factId, requestId, n)` — no addresses. `applySharedFact` (`Registry.sol:678`) requires a caller to supply the exact original list to prove membership; standard event-indexers will never surface it, since it was never logged.

**Proof of Concept:** Not an exploit — a liveness/discoverability gap. A frontend built purely against Registry's events has no way to let a legitimate list member call `applySharedFact` without separately parsing the raw `onResult` transaction's calldata.

**Recommendation:** Emit the full address list (or a reference sufficient for low-friction retrieval) in `SharedFactStored`, or document explicitly that integrators must index `onResult` calldata.

---

### [F-9] `onResult`'s `uint16` length downcast relies on cross-file bounds that are never asserted locally
**Severity:** Low
**Location:** `onResult()` — `Registry.sol:517`

**Description:** `uint16 n = uint16(uint256(bytes32(a.answer[32:64])))` truncates silently if the parsed value exceeded 65,535. This is safe today only because `_check` caps `a.answer.length <= 2112` (`Registry.sol:571`, limiting `n <= 64` for a kind-3 answer) and `Composer.validateSpec` separately caps every community T3 spec's `threshold` at 32 (`Composer.sol:247`, context file) — and `_decodeAndJudge` requires `n == threshold`. No code path asserts this chain of bounds at the point of the downcast itself.

**Proof of Concept:** Not independently exploitable under the current, immutable deployment (no setter exists for `composer`, and the 2112-byte/32-threshold constants are hardcoded). This is a defense-in-depth gap, not a live attack.

**Recommendation:** Reuse the already-bounds-checked `n` from `_decodeAndJudge` instead of re-parsing `a.answer` in `onResult`, or add an explicit local assertion so the invariant is visible at the point of truncation.

---

### [F-10] `_request` stores a new pending record under an Intake-supplied id with no occupancy check
**Severity:** Low
**Location:** `_request()` — `Registry.sol:447-474`, specifically the write at `Registry.sol:468`

**Description:** `_pending[requestId] = Pending(...)` writes unconditionally, with no check that the slot is currently empty. Registry assumes Intake (out of scope) always supplies a fresh, collision-free `requestId` and delivers each one to `onResult`/`onFailure` exactly once. If that assumption ever broke — a reused or colliding id — the new write would silently overwrite an existing claimant's live pending record with no revert and no event.

**Proof of Concept:** Not independently exploitable from Registry.sol alone; depends entirely on out-of-scope Intake behavior. Reported as a defense-in-depth gap (also noted structurally in the invariant catalog as X-1).

**Recommendation:** Add `require(_pending[requestId].requestedAt == 0)` before the write in `_request`, as a cheap, independent check against a non-unique `requestId`.

---

### [F-11] Unbounded `returndata` copy from `burnExecutor.previewBridge()` is not capped
**Severity:** Low
**Location:** `_burnOrRefund()` — `Registry.sol:747`

**Description:** The `try`-decoded call to `previewBridge()` copies the callee's entire returndata before decoding three `uint256`s. A callee returning far more than 96 bytes forces the caller to pay the full copy and memory-expansion cost out of the outer transaction's gas, not the 600,000-gas stipend given to the sub-call.

**Proof of Concept:** Not attacker-reachable today — `burnExecutor` is deployer-fixed with no setter, not attacker-controlled. Reported as a hardening gap should the executor ever be considered less than fully trusted, or the pattern reused elsewhere.

**Recommendation:** Use a raw `staticcall` and manually cap the `returndatacopy` to the expected 96 bytes.

---

### [F-12] `_specsOf` grows without bound and is read in full by `verifiedSpecsOf`/`tokenURI`
**Severity:** Low
**Location:** `_mark()` — `Registry.sol:619-625`; `verifiedSpecsOf()` — `Registry.sol:307-309`

**Description:** Every oracle-verified community spec a wallet earns is appended and never removed. Growth is strictly self-inflicted (keyed to the acting wallet in every write path), but could eventually make a wallet's own `tokenURI`/`verifiedSpecsOf` call revert in a gas-capped context (e.g. an on-chain consumer, or a gas-limited `eth_call`).

**Recommendation:** Document the self-inflicted nature, and/or add a paginated getter alongside the full-array one.

---

### [F-13] Core dependency reads (`curator`, `idmd` via `composer`) have no `try/catch` fallback
**Severity:** Low
**Location:** `mintCard()` — `Registry.sol:253`; `claimSponsored()` — `Registry.sol:722`; `hasDirectTrait()` — `Registry.sol:299`

**Description:** If `curator`/`idmd`/`composer` ever reverted (e.g. an upstream pause or a future buggy upgrade behind one of these addresses — none of which Registry controls or can change), `mintCard`, `hasDirectTrait`, and `claimSponsored` become uncallable with no on-chain fallback. Not attacker-triggerable — all three are deployer-fixed, trusted dependencies.

**Recommendation:** Consider wrapping critical-path reads in `try/catch` with an explicit "dependency unavailable" revert reason, for clearer failure diagnostics.

---

### [F-14] `_burnOrRefund`'s refund-revert path can undo an already-placed sponsored oracle request, contradicting its own "never undoes it" documentation
**Severity:** Informational
**Location:** `_burnOrRefund()` — `Registry.sol:742-770`; `_refund()` — `Registry.sol:772-775`

**Description:** The function's own comment states the burn step is "best effort... never undoes" the oracle request already placed. However, `_refund` reverts the whole call with `BurnRefundFailed()` if a plain ETH send to `msg.sender` fails (`Registry.sol:772-775`), and the gas-floor check (`Registry.sol:746`) can revert with `InsufficientGas()` before any burn attempt — either unwinds the already-placed request, `poolUsed`, and `lastPoolDay` writes from the same `claimSponsored` call. This only affects the caller's own transaction when the caller's wallet cannot receive plain ETH, which is self-inflicted rather than a third-party harm, so it is recorded as Informational (a documentation/robustness inconsistency) rather than a Low finding under our "self-harm only" exclusion.

**Recommendation:** Wrap `_refund`'s call in its own try/catch so a refund failure degrades to a `BurnSkipped` event instead of reverting the already-placed request, matching the documented guarantee.

---

### [F-15] `nextSpecId` (`uint16`) would overflow after 55,534 community-spec registrations, permanently halting `registerSpec`
**Severity:** Informational
**Location:** `registerSpec()` — `Registry.sol:656-664`; `nextSpecId` — `Registry.sol:128`

**Description:** `nextSpecId` starts at `FIRST_SPEC_ID = 10001` and increments by 1 with no cap check; at `traitId == 65535`, `nextSpecId = traitId + 1` overflows a `uint16` and reverts under Solidity 0.8 checked arithmetic, with no recovery path.

**Proof of Concept:** Reaching this requires roughly 355,000 IMD in cumulative spec fees (55,534 × 6.4 IMD) — not verified to be economically reachable, hence Informational.

**Recommendation:** No action required unless the project expects that volume of registrations; otherwise purely a documentation note.

---

### [F-16] Fixed gas stipends to `burnExecutor` are a single point of future failure against gas repricing
**Severity:** Informational
**Location:** `_burnOrRefund()` — `Registry.sol:742-770`; constants `PREVIEW_GAS`/`BURN_GAS` — `Registry.sol:73-76`

**Description:** Hardcoded gas caps calibrated against today's opcode costs could, after a future repricing or on-chain reuse at a different gas schedule, cause `previewBridge`/`bridgeToBaseBurnReceiver` to exhaust gas and be silently caught — disabling the best-effort burn feature with no funds at risk.

**Recommendation:** None required for the current deployment; worth a comment for anyone redeploying this code elsewhere.

---

### [F-17] Duplicate trait ids in `upgrade()` revert the whole batch after the full pull is already computed
**Severity:** Informational
**Location:** `upgrade()` — `Registry.sol:395-413`

**Description:** `upgrade` pulls `price * k` up front, then loops; a duplicate id later in the array hits `AlreadyPending` and reverts the entire (already-pulled, atomic) transaction. No funds are lost, only gas on a late revert.

**Recommendation:** Optional client-side dedup, or an early duplicate check; not a security requirement.

---

### [F-18] `upgrade()`'s `traitIds` array has no length cap
**Severity:** Informational
**Location:** `upgrade()` — `Registry.sol:395-413`

**Description:** An unbounded caller-supplied array can exceed the block gas limit and revert atomically — self-inflicted gas waste only, no cross-user impact, no fund loss.

**Recommendation:** Optional hardening only.

---

## Resolved during reconciliation (not findings)

**"`safeTransferFrom` to a codeless `imd` silently succeeds" — REFUTED.** An initial Phase 1 pass (general checklist) flagged that the constructor's "empty floor" branch skips the `imd_` code-length check, and speculated this lets `mintCard`/`registerSpec`/`sponsor` report success while moving no real value via a raw low-level call to a codeless address. A Phase 2 access-control agent, running blind to this, independently traced OpenZeppelin's vendored `SafeERC20`/`Address.functionCall` (this repo pins OZ v5, confirmed via `IERC4906` usage and the flattened `reference/IntakeV2.sol`'s SafeERC20 copy) and found that `Address.verifyCallResultFromTarget` reverts with `AddressEmptyCode` whenever a call succeeds with empty returndata against a codeless target — a fix OZ introduced specifically to close this class of bug. This means `safeTransferFrom` against a codeless `imd_` **reverts**, not silently succeeds. The floor-mode branch is self-protecting on this specific point; we found no live exploit of it. This resolution is recorded here rather than silently dropped, per our standard for cross-phase contradictions.

**Self-harm-only leads not independently reported:** two Phase 2 leads (a gas-griefing path via `_refund`'s raw call, and a reentrancy-via-hook scenario in `_burnOrRefund`) were traced to completion and found to affect only the acting caller's own transaction with no third-party victim; per our validation standard's "self-harm only → rejected" rule, these are not listed as standalone findings (F-14 above captures the one case with a documentation-consistency angle worth recording).

---

## Access-Control Inventory

No owner, admin, role, or pause mechanism exists anywhere in `Registry.sol` (grep-confirmed: zero matches for `onlyOwner|onlyRole|Ownable|AccessControl|Pausable|receive\(\)|fallback\(\)|tx\.origin|delegatecall|selfdestruct|initializer`). All eight dependency addresses (`curator`, `idmd`, `imd`, `intake`, `attester`, `renderer`, `composer`, `burnExecutor`) are written exactly once, in the constructor, with no setter.

| Function | Guard | Caller | Moves value |
|---|---|---|---|
| `mintCard()` L246 | `nonReentrant` + one-card check | anyone (once) | in: 0.1 IMD |
| `upgrade()` L395 | `nonReentrant` | anyone | in: price×k IMD |
| `abandon()` L418 | in-body claimant/payer check, 31-day wait | original requester only | none |
| `onResult()` L500 | `msg.sender==intake` | Intake only | none |
| `onFailure()` L529 | `msg.sender==intake` | Intake only | none |
| `registerSpec()` L656 | `nonReentrant` | anyone | in: 6.4 IMD |
| `requestSharedFact()` L669 | `nonReentrant` | anyone | in: price IMD |
| `applySharedFact()` L678 | data-derived (hash + membership) | anyone (self-scoped) | none |
| `sponsor()` L713 | `nonReentrant` | anyone | in: amount IMD |
| `claimSponsored()` L721 | `nonReentrant` + external curator-membership check + 4 rate-limit guards | Curator members (anyone who ever deposited in the game — confirmed via `IWhitelistCurator`'s own NatSpec) | in: ETH (burn fee); pool IMD out to Intake |

## Threat Model

- **Intake (trusted, external):** sole caller of both callbacks; also sets price (bounded by caller `maxPrice` and, for pool draws, `pool()/8`/`POOL_DRAW_CAP`). F-7/F-10 note binding gaps that depend on Intake's own (out-of-scope) correctness.
- **Attester (trusted, off-chain):** single fixed EOA, sole authority over every oracle trait — F-6.
- **Curator/IDMD (trusted, external):** `curator` is read-only and frozen (`isSettled`) at deploy; `idmd` is a live, transferable balance — the one live input to an otherwise-frozen snapshot, which is F-1's root cause.
- **BurnExecutor (semi-trusted, external):** best-effort, wrapped in try/catch; F-11 and F-14 note hardening gaps around it.
- **Any wallet (permissionless):** 6 of 10 entrypoints are fully unguarded; F-1, F-3, F-9, F-10, F-12, F-15, F-17, F-18 all sit on this surface.
- **Curator members (a real, already-settled, broad population):** the only additional gate beyond "any wallet," and the surface for F-2 and F-4.

## Invariant Verification

| ID | Property | On-chain | Verdict |
|---|---|---|---|
| G-1..G-17 | Per-call guards (reference only) | — | Not independently scored — mechanical dump, confirmed present as cataloged |
| I-1 | One card per wallet, forever | Yes | **Holds** — `tokenOf` has one write site, never cleared |
| I-2 | `_pending[requestId]` written once, cleared exactly once | Yes | **Holds** — all three clear sites snapshot-then-gate on `requestedAt==0` |
| I-3 | Identity (claimant) binding survives NFT transfer | Yes (by design) | **Holds** — confirmed consistent everywhere by the ERC721 breadth pass; no code path substitutes `ownerOf` for `claimantOf`/`tokenOf` |
| I-4 | Sponsored draw rate limit per (wallet, trait) and per wallet-day | Yes, as derived | **Mechanism confirmed exactly as specified — but that same mechanism (release-on-failure) is F-2's root cause.** The guard fires correctly; its design is what's exploitable. |
| I-5 | `sponsoredVerified[w] <= 9` | Yes | **Holds** — structurally capped by exactly 9 catalog-chain ids, each one-shot |
| X-1 | Intake delivers each `requestId` exactly once | Yes (in-scope no-op path), contingent on Intake | **Could not independently verify** the Intake-side half — folded into F-10 |
| X-2 | Composer/Registry bit-packing layout agreement | — | **Holds** — confirmed identical formula in both files, all 14 direct ids checked |
| E-1 | Aggregate daily sponsor-pool outflow is bounded | No | **Violated → F-4** |

**Coverage:** `Entrypoints: 10 in source, 10 addressed. Threat rows: 9 in catalog, 9 answered. Invariants: 8 inferred rows (excluding the 17 reference guards), 8 answered — 5 hold, 2 violated → findings, 1 could not independently verify. Coverage holes closed this pass: 0` (every row had already been examined across Phase 0/1/2; this pass re-derived and verified citations against the live file rather than discovering new unexamined ground).

## Reconciliation Summary

Phase 1 (7 breadth checklists) raised 14 items; Phase 2 (12 blind depth agents across 3 specialty waves + 3 gap-hunters) raised 3 FINDINGs and roughly 20 LEADs, the large majority converging on two clusters already partially surfaced in Phase 1 (the questionHash/abandon-window binding gap, and the aggregate/repeated pool-drain family). After cross-phase dedup, gate evaluation (`judging.md`'s four gates), and two explicit corrections — refuting Phase 1's floor-mode `safeTransferFrom` claim against OZ v5's actual `AddressEmptyCode` behavior, and down-rating a Phase 2 agent's self-declared "FINDING" on the questionHash gap back to Low because its stated exploit path did not clear Gate 1 without an unverified assumption about the out-of-scope Intake contract — this report lists 18 findings: 3 High, 3 Medium, 7 Low, 5 Informational.

The two High findings discovered only in Phase 2 (F-1's flash-balance trait freeze, F-2's free-retry pool drain) were not surfaced by any Phase 1 checklist, illustrating the value of the blind depth pass; conversely, F-3 (stuck shared fact) and F-6 (single attester) were Phase 1 discoveries that Phase 2's agents touched only indirectly, illustrating the value of checklist breadth alongside attacker-mindset depth.

> ⚠️ This review was performed by an AI-orchestrated multi-agent audit pipeline. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Independent human security review, and on-chain monitoring after deployment, are strongly recommended.
