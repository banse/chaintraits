# Security Review — Sworn Registry

**Audit target (on-chain source):** `0x39Bec7648259d5a128c29b24951eAbcD4d1F95A6` on Ethereum mainnet (chain id 1), contract name `Registry`. Source retrieved via Etherscan's multichain verified-source API (standard-JSON-input bundle), **not a git clone** — no commit hash or repository exists for this audit; the retrieved bundle is the complete, compiler-verified source matching the deployed bytecode at this address. Compiler: `solc 0.8.24+commit.e11b9ed9`, optimizer enabled (200 runs), `evmVersion: cancun`, `bytecodeHash: none`.

**In-scope files** (6, 1623 nSLOC): `src/Registry.sol` (601), `src/Composer.sol` (574), `src/Renderer.sol` (354), `src/HiveData.sol` (53), `src/TemplateData.sol` (9), `src/Types.sol` (32). Out-of-scope context: `src/interfaces/*.sol` (5 files, external dependency shapes only).

**Live deployed dependency addresses** (confirmed via on-chain read during this audit): `curator` = `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` (WhitelistCurator), `idmd` = `0x0000ec93127baa929e58e97dd0095a2bfb38ec1d` (IdentityMD collection), `imd` = `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` (fee token), `intake` = `0xa43e6f75ee006411f79ac1c84120606c2330de82` (Intake v2), `burnExecutor` = `0xe29386719c155b6847ad5a4e97c6674f10ffc750`. All four have code and are live — the constructor's "empty-floor" bootstrap branch did **not** fire on this deployment.

**Methodology:** two independent hunting passes, run blind to each other, then reconciled. Phase 0 (opus) built a protocol map, access-control inventory, and threat catalog with no findings. Phase 1 (8 opus checklist agents: general, precision-math, erc20, erc721, access-control, signatures, dos, assembly) ran a breadth pass. Phase 2 (12 opus attacker agents, pashov-methodology, 1 pass, blind to Phase 1) ran a depth pass, each gated through a 4-step attack-execution / reachability / trigger / impact validation before being reported as a finding rather than a lead. This report merges both passes, deduplicates by root cause, and reports convergence counts — a finding independently rediscovered by many agents working blind to each other is strong evidence it is real, not an artifact of one agent's reasoning.

**Severity counts:** 0 Critical · 1 High · 5 Medium · 7 Low · 14 Informational

**Coverage:** 16/16 entrypoints addressed (finding or "examined, no issue"). 10/10 threat-catalog rows answered. 12/12 inferred invariant rows from the pre-scan catalog answered (holds / violated / vacuous — see Invariant Verification). Holes closed this pass: 0 (the Phase 0 catalog was already exhausted by Phase 1 + Phase 2 hunting).

---

## Findings

### [H-1] Sponsor-pool draws have no ceiling on the Intake's quoted price — one call can spend the entire shared IMD pool
**Severity:** High
**Location:** `Registry._fromPool()`, Registry.sol:718-731, contrasted with `_price()` Registry.sol:439-442 (used by `upgrade`/`requestSharedFact`)
**Convergence:** 8 independent discoveries across both phases (Phase 1 general-checklist + access-control agents; Phase 2 economic-security, execution-trace, invariant, numerical-gap, trust-gap agents).

**Description.** Every caller-paid oracle request path bounds the Intake's price with a caller-supplied ceiling:

```solidity
// Registry.sol:439-442
function _price(uint256 maxPrice) internal view returns (uint256 price) {
    price = intake.priceOf(ACTION, address(imd));
    if (price > maxPrice) revert PriceAboveMax(price, maxPrice);
}
```

`upgrade()` (Registry.sol:402) and `requestSharedFact()` (Registry.sol:645) both route through it. The sponsor-pool path does not:

```solidity
// Registry.sol:718-721
function _fromPool(uint16 traitId) internal {
    uint256 price = intake.priceOf(ACTION, address(imd));
    uint256 balance = pool();
    if (balance < price) revert PoolTooSmall(balance, price);
```

`price` is capped only by `balance < price` — an underflow guard, not a ceiling; `price == balance` is explicitly permitted. `claimSponsored(uint16)` (Registry.sol:708) and `upgradeSponsored(uint256,uint16[])` (Registry.sol:695) accept no `maxPrice` parameter at all, so no caller — and critically, no *sponsor* whose fees or donations built the pool — can bound a single draw. `pool()` (Registry.sol:684-686) is simply `imd.balanceOf(address(this))`: every `MINT_FEE` (0.1 IMD), `SPEC_FEE` (6.4 IMD), and `sponsor()` donation accumulates there undifferentiated.

**Proof of concept.** Pool holds 1,000 IMD from accumulated mint/spec fees and donations. `intake.priceOf(ACTION, imd)` normally returns ~1 IMD (0.1% of the pool per draw). If that price rises to 1,000 IMD — through ordinary Intake-side repricing, no compromise required — the next Curator member who calls `claimSponsored(701)` (a routine, incentivized action) triggers `_fromPool`: `balance < price` is `1000 < 1000` = false, `forceApprove(intake, 1000e18)`, and the Intake pulls the registry's entire IMD balance for one oracle request. Every other member's accumulated pool entitlement is gone.

**Fix.** Add a `maxPrice` parameter to `claimSponsored` and `upgradeSponsored`, routed through `_price(maxPrice)` as the other paid paths are, **and** add a hard ceiling independent of caller input (e.g. `price <= pool() / K`), since the member spending the pool has no personal incentive to cap it tightly — they didn't fund it.

---

### [M-1] `_burnOrRefund`'s gas-capped executor preview is caller-starvable, silently skipping the IMD burn and ETH fee
**Severity:** Medium
**Location:** `Registry._burnOrRefund()`, Registry.sol:735-760; `PREVIEW_GAS = 600_000` (Registry.sol:67), `BURN_GAS = 800_000` (Registry.sol:64)
**Convergence:** 9 independent discoveries — the single most corroborated finding in this audit (Phase 1 dos + general-checklist agents; Phase 2 economic-security, execution-trace, first-principles, asymmetry, boundary, numerical-gap, flow-gap agents — 5 of these at full-finding confidence with concrete gas-window math).

**Description.** Every sponsor-pool draw ends with a best-effort attempt to burn the executor's accumulated IMD, which the code's own comment frames as never allowed to block the already-paid request:

```solidity
// Registry.sol:735-738
function _burnOrRefund() internal {
    if (address(burnExecutor) != address(0)) {
        try burnExecutor.previewBridge{gas: PREVIEW_GAS}() returns (uint256 amount, uint256, uint256 fee) {
            if (amount >= BURN_MIN) {
```

`{gas: X}` is a *ceiling* under EIP-150 (`min(X, gasleft() - gasleft()/64)` is actually forwarded), never a floor. Registry.sol:65-67's own comment states the executor "catches its inner OFT quote running out of gas and returns `(0,0,0)` below about 272,000 gas at the CALL." A caller who leaves less than ~276,000 gas available at the `previewBridge` call site gets exactly that: `amount == 0`, which fails the `amount >= BURN_MIN` (69 IMD) test, so the `if (msg.value < fee) revert BurnFeeRequired(fee)` check at Registry.sol:742 is never reached and **no event is emitted at all** — not even `BurnSkipped`. The draw completes with no burn and no ETH fee paid.

**Proof of concept.** A Curator member calls `claimSponsored(701)` with `msg.value = 0` and a transaction gas limit tuned so `gasleft()` at the `previewBridge` call site is ~270,000: forwarded gas = `270,000 × 63/64 ≈ 265,781 < 272,000`, so `previewBridge` returns `(0,0,0)`. The pool-funded oracle request still completes (`PoolSpent` emitted); the member pays none of the up-to-`BURN_FEE_CAP` (0.005 ETH) bridge fee and the registry's ≥69 IMD burn never happens. A miss (wrong gas guess) merely reverts with no state change, so the exact window can be found for free by local simulation before sending the real transaction. A second, independently sufficient window exists at the `bridgeToBaseBurnReceiver` call (Registry.sol:744): starving it similarly lands in the `catch` as `BurnSkipped(2)` and refunds the full `msg.value`.

**Fix.** `require(gasleft() >= (PREVIEW_GAS + BURN_GAS) * 64 / 63 + slack)` before the `previewBridge` call, so an underfunded gas limit reverts the whole draw instead of silently skipping the burn rule.

---

### [M-2] Trait 601 ("Armed") is a live, un-latched external read — one IDMD token grants it to unlimited wallets in turn, and a sold card silently loses it with no refresh signal
**Severity:** Medium
**Location:** `Composer.hasDirectTrait()` Composer.sol:157, reached via `Registry.hasTrait()` Registry.sol:301-305
**Convergence:** 4 independent discoveries (Phase 1 general-checklist agent; Phase 2 economic-security, execution-trace, trust-gap agents — the last elevating it to full-finding confidence).

**Description.**

```solidity
// Composer.sol:157
if (traitId == 601) return idmd.balanceOf(wallet) >= 1;
```

Every other direct-read trait (101/201/202/301-303/401-404/501-503) reads the `WhitelistCurator`, which the constructor requires to be `isSettled()` (Registry.sol:207) — and `IWhitelistCurator.sol`'s own NatSpec states that once settled, "every per-address view above is frozen for ever." Trait 601 alone reads an ordinary, freely transferable ERC-721 (`idmd`) live, on every call, with no freeze and no snapshot.

**Proof of concept.** Wallet A holds one IDMD token. A calls `mintCard()` (0.1 IMD); the card's `tokenURI` genuinely displays trait 601 ("Armed") at that moment. A sells the card to B. A then transfers the IDMD token to a second wallet A2 (or sells it). The card's `tokenURI` now evaluates `idmd.balanceOf(A)` (the original claimant, frozen in `claimantOf` — see M-3) as 0, and trait 601 silently disappears from B's purchased card. No `MetadataUpdate` is ever emitted for this change: `_update` (Registry.sol:288-291) fires it only on card transfer (which doesn't touch trait content), and `_mark` (Registry.sol:596-602) fires it only on oracle verification, which trait 601 never goes through — so any marketplace that caches metadata per ERC-4906 convention keeps showing "Armed" indefinitely after it is gone. The same mechanism lets A grant trait 601 to an unbounded sequence of wallets by moving one IDMD token between them, defeating any external allowlist that reads `Registry.hasTrait` — the collection's own documented integration point ("Allowlists read `hasTrait`, never `ownerOf`").

**Fix.** Snapshot `idmd.balanceOf(msg.sender) >= 1` into storage at `mintCard` time (the same pattern `mintedAtBlock` already uses), and read the stored value for trait 601 instead of the live external call.

---

### [M-3] The NFT is freely transferable; the "claimant" facts attached to it are not — a sold card's displayed content stays under the seller's permanent control
**Severity:** Medium
**Location:** `Registry.mintCard()` Registry.sol:225-234, `Registry.cardOf()` Registry.sol:243-276, `Registry._update()` Registry.sol:288-291
**Convergence:** Phase 1 erc721-checklist agent (single-agent finding, not independently rediscovered by Phase 2, but directly corroborated by and the root cause behind M-2 above).

**Description.** `claimantOf[tokenId]` (Registry.sol:230) is written once at mint and never updated by `_update`, the override point for every ERC-721 transfer. `tokenURI`/`cardOf` resolve all content — direct traits (including the live-read trait 601 from M-2), verified oracle traits, and the growing `_specsOf` community-spec list — against `claimantOf`, not against the current NFT owner. The protocol's own on-chain description blob (`TemplateData.TEMPLATE`) discloses this design choice explicitly ("every trait is a fact about the claimant wallet that minted the card, never about the holder"), which is why this is rated Medium rather than higher — but the disclosure sits in on-chain JSON most buyers never decode before purchasing, and nothing in the rendered output flags that the content can move after the sale.

**Proof of concept.** A mints a card with all 14 direct traits verified true, lists it, sells it to B for its displayed trait set. A's qualifying state (e.g. IDMD holding — see M-2) changes after the sale; the card's displayed content changes with it, under A's continued control, with B having no recourse and no on-chain signal that anything changed.

**Fix.** Either make the card non-transferable between non-zero addresses (revert in `_update` when both `from` and `to` are nonzero), matching the stated "fact about the minter" semantics exactly; or, if transferability is required, snapshot every direct-read trait at mint time so a sold card's content is frozen along with its claimant binding.

---

### [M-4] `abandon` on a shared-fact request has no owner check — any wallet can destroy a different wallet's still-valid, still-deliverable paid request
**Severity:** Medium
**Location:** `Registry.abandon()` Registry.sol:421-428; `ABANDON_AFTER = 14 days` (Registry.sol:68) vs `Composer.VALID_FOR_SECONDS = 2_592_000` (30 days, Composer.sol:47)
**Convergence:** 4 independent discoveries, 2 at full-finding confidence (Phase 1 access-control + dos-checklist agents; Phase 2 access-control and economic-security agents, both independently writing it up as a FINDING).

**Description.**

```solidity
// Registry.sol:425
if (p.claimant != address(0) && msg.sender != p.claimant) revert NotClaimant();
```

For a shared fact, `p.claimant` is the zero-address sentinel (set by `_request(address(0), factId, price)`, Registry.sol:647), so the ownership check is skipped entirely — **any** wallet may abandon it once 14 days have elapsed. `requestSharedFact` never records who paid, so no payer-identity check could exist today even if intended. Meanwhile the request body the registry itself composes grants the oracle 30 days to answer (`Composer.encodeBody`'s `validForSeconds`), and `_check` accepts any attestation up to `a.expiresAt` — so there is a 16-day window in which a stranger can discard a request the oracle is still entitled, and likely to, answer.

**Proof of concept.** Alice calls `requestSharedFact(1201, maxPrice)` at `t0`, paying `price` IMD; `sharedPending[1201] = R`. At `t0 + 14 days + 1 second`, Bob (any wallet, no stake in the outcome) calls `abandon(R)` for ~30k gas. `_clear` deletes `_pending[R]` and `sharedPending[1201]`. At `t0 + 20 days`, the oracle delivers a fully valid, correctly-signed attestation via `onResult(R, ...)` — `_pending[R].requestedAt == 0`, so the delivery is discarded as `Missed(R, 0, 1)` and returns. Alice's IMD bought nothing; trait 1201 ("Top Weights") remains unobtainable for every eligible wallet until someone pays again.

**Fix.** Record the payer in the shared `Pending` record and restrict `abandon` on a shared fact to that payer; or, more simply, raise `ABANDON_AFTER` above `VALID_FOR_SECONDS` so no live, still-answerable attestation window can ever be abandoned out from under it.

---

### [M-5] `tokenURI` at maximum decoration costs ~19M gas, dominated by quadratic string-concatenation in the renderer
**Severity:** Medium
**Location:** `Renderer._oracle()`/`_communityAttributes()`/`_list()` Renderer.sol:316-346, fed by `Registry.cardOf()` (bounded at 43 oracle metas, 32 community ids)
**Convergence:** Phase 1 dos-checklist agent (single-agent finding with direct empirical gas measurement against the real contracts under mocked dependencies; not independently reproduced by Phase 2, which focused on exploit paths over gas profiling).

**Description.** `Renderer._oracle`, `_communityAttributes`, and `_list` all accumulate output via `out = bytes.concat(out, ..., _one(ms[i]))` inside a loop — each iteration reallocates and recopies the entire accumulator so far (O(k²) memory traffic), and each `_one` call emits ~800-900 bytes (the full `Spec` struct, including a 256-byte-capable `item` field). Measured end-to-end against the real `Registry`+`Composer`+`Renderer` contracts with mocked dependencies: 1.37M gas for a card with only direct traits, rising to **18.99M gas** at the hard caps (25 catalog traits + 32 max-size community specs), plateauing near there. Over 75% of the cost at the cap is the quadratic string accumulation, not the SVG generation (which the `Buf` growable-buffer pattern in `image()` already handles correctly and cheaply).

**Why this matters despite being self-only.** No third party can inflate another wallet's `_specsOf` (every write is `msg.sender`-scoped), so this cannot be weaponized against a victim. It matters because ~19M gas exceeds the `eth_call` gas cap on a number of RPC providers (10-30M is a common ceiling), making `tokenURI` for a fully-decorated card unreadable through those providers, and entirely unusable from any on-chain consumer regardless of provider.

**Fix.** Replace the `bytes.concat`-in-a-loop accumulators with the `Buf` growable-buffer pattern `image()` already uses — this removes the quadratic term and should bring the worst case down by well over half.

---

### [L-1] Sponsor-pool rate limiters (`poolUsed`, `idmdSponsored`) are consumed before the oracle answers and never restored on failure or abandonment
**Severity:** Low
**Location:** `Registry._fromPool()` Registry.sol:718-731 vs `_clear()` Registry.sol:471-478 (reached from `onFailure`, `onResult`'s `Missed` branches, and `abandon`)
**Convergence:** 6 independent discoveries across both phases (Phase 1 access-control + general-checklist agents; Phase 2 math-precision, execution-trace, periphery, and asymmetry agents — the last elevating it to full-finding confidence).

**Description.** `poolUsed[msg.sender][traitId] = true` (Registry.sol:727) and `idmdSponsored[idmdTokenId]++` (Registry.sol:702) are the only write sites for these mappings — nothing ever clears them. `_clear` (called from `abandon`, `onFailure`, and every `Missed` branch of `onResult`) touches only `_pending`/`pendingOf`/`sharedPending`. So a routine, unprivileged oracle refusal (status 1/2 via `onFailure`) or a 14-day-unanswered timeout permanently burns one of a member's nine lifetime pool-draw slots for that trait, even though no trait was ever verified and no fault lies with the member.

**Fix.** Clear `poolUsed[p.claimant][p.traitId]` (and decrement `idmdSponsored` where applicable) inside `_clear`, or move the `poolUsed` write from `_fromPool` (request time) into `_mark` (verification time).

---

### [L-2] `upgradeSponsored`'s per-IDMD-token cap is vacuous — `claimSponsored` grants the identical draw with a strictly weaker precondition
**Severity:** Low
**Location:** `Registry.upgradeSponsored()` Registry.sol:695-704 vs `Registry.claimSponsored()` Registry.sol:708-711
**Convergence:** 9 independent discoveries across both phases — one of the highest-convergence items in the audit, though never scored above Low/Info since no exploit or privilege gain exists beyond what every Curator member already has.

**Description.** `upgradeSponsored` requires IDMD ownership, `_requireMember()`, and an unexhausted `idmdSponsored[idmdTokenId] < 9` counter, then calls `_fromPool(traitIds[0])`. `claimSponsored` requires only `_requireMember()` and calls the identical `_fromPool(traitId)`. The real binding limiter — `poolUsed[msg.sender][traitId]` over the nine `_isCatalogChain` ids — caps every Curator member at nine lifetime pool draws regardless of which entrypoint they use. No rational caller would ever choose `upgradeSponsored`: it demands strictly more (IDMD ownership, a lifetime token-slot) for an identical outcome `claimSponsored` already grants for free. `MAX_SPONSORED`, `idmdSponsored`, `IdmdSponsorExhausted`, and `NotIdmdHolder` constrain nothing real.

**Fix.** Decide the intended policy: if the per-token cap is meant to bind, remove or gate `claimSponsored` behind the same IDMD requirement; if `claimSponsored` is the intended universal path, delete `upgradeSponsored` and its associated dead state.

---

### [L-3] No fee-on-transfer accounting anywhere, and no `decimals()` assertion at construction
**Severity:** Low
**Location:** All five `imd.safeTransferFrom` sites (Registry.sol:227, 403, 634, 646, 689); fee constants Registry.sol:60-63
**Convergence:** Phase 1 erc20-checklist + precision-math agents (2 independent discoveries).

**Description.** No `balanceOf`-delta pattern exists anywhere — every fee path trusts the nominal transferred amount. If the live IMD token were ever fee-on-transfer (it almost certainly is not, given the protocol would have failed its very first `mintCard()` call at genesis if so — a reasonable argument this is moot in practice, but nothing in the code would catch a future change), the pool would be silently underfunded relative to what Intake expects to pull. Separately, the `ether`-denominated fee constants (`MINT_FEE`, `SPEC_FEE`, `BURN_MIN`) assume 18 decimals with no `decimals()` check at construction, and `imd` has no setter — a decimals mismatch at deploy would be a permanent, unrecoverable brick rather than a one-line fix.

**Fix.** Add `require(IERC20Metadata(imd_).decimals() == 18)` to the constructor as a cheap, permanent guard against an unrecoverable misconfiguration.

---

### [L-4] `_price`/`_fromPool` never reject a zero price from the Intake
**Severity:** Low
**Location:** `Registry._price()` Registry.sol:439-442, `Registry._fromPool()` Registry.sol:719-721
**Convergence:** Phase 1 erc20-checklist agent.

**Description.** If `intake.priceOf` ever returns 0 (e.g. IMD delisted for the registry's `ACTION`), `_fromPool`'s `balance < price` check (`balance < 0`) is always false, permitting free sponsored draws against an empty pool; on the caller-paid paths, a zero price passes any `maxPrice` and proceeds with a zero-amount transfer, whose behavior then depends entirely on how the Intake itself handles a zero-amount request.

**Fix.** `if (price == 0) revert` in both `_price` and `_fromPool`.

---

### [L-5] `onFailure`'s `signature` parameter is declared and never verified
**Severity:** Low
**Location:** `Registry.onFailure()` Registry.sol:509-521
**Convergence:** Phase 1 signatures-checklist + access-control agents (2 independent discoveries).

**Description.** The success path (`onResult`) independently re-verifies the attester's EIP-712 signature before writing any state — the protocol's stated defense against a misbehaving Intake. The failure path has no equivalent: its sixth parameter is declared `bytes calldata` with no name and is never read. The Intake alone, with only the `msg.sender == address(intake)` gate, can discard any live pending request (clearing `_pending` via `_clear`) and attribute an arbitrary `status`/`reason`/`agreed`/`answered` to the oracle in the `NoVerdict` event with no cryptographic backing.

**Fix.** Either verify an EIP-712 signature over the failure envelope the same way `_check` does for success, or document plainly that `NoVerdict` telemetry is Intake-attributed, not attester-attributed, so downstream consumers do not misread it as oracle-signed.

---

### [L-6] Constructor's "empty floor" bootstrap branch skips 4 dependency-liveness checks together; the live dependency check set is itself asymmetric
**Severity:** Low
**Location:** `Registry` constructor, Registry.sol:188-220
**Convergence:** 4 independent discoveries (Phase 1 general-checklist agent on the floor branch; Phase 2 invariant, boundary, and asymmetry agents on the asymmetric check set).

**Description.** Two related but distinct gaps, both confirmed harmless on the live deployment (verified via on-chain read: the floor branch did not fire; all five checked/unchecked dependencies are live and correctly wired) but worth recording for any future redeployment. First: when `curator_`/`idmd_`/`imd_`/`intake_` all have zero code at deploy time, the constructor skips the IDMD-code check, the Curator-settlement check, the Intake-price-liveness check, and the executor-code check together — intended as a bootstrap path, but it also means `burnExecutor_`'s code check (otherwise independent of the other four) is needlessly bundled into that branch. Second: `idmd_` and `burnExecutor_` get explicit `.code.length` checks; `renderer_` and `composer_` get only a zero-address check, despite `composer` being called by `hasTrait`, `traitsOf`, `traitName`, `specOf`, `composeBody`, and `registerSpec` — at least as load-bearing as `idmd`.

**Fix.** Check `burnExecutor_.code.length` unconditionally, independent of the `floor` branch. Add equivalent code-length checks for `renderer_` and `composer_`.

---

### [L-7] `nextSpecId` is a `uint16` — community-spec registration permanently reverts after 55,534 specs
**Severity:** Low
**Location:** `Registry.registerSpec()` Registry.sol:632-638; `nextSpecId` Registry.sol:116, `FIRST_SPEC_ID = 10001` Registry.sol:72
**Convergence:** 3 independent discoveries (Phase 2 math-precision, periphery, invariant agents).

**Description.** `traitId = nextSpecId++` on a `uint16` starting at 10001 permits exactly 55,534 registrations before the increment panics under Solidity 0.8's checked arithmetic; `registerSpec` then reverts for every caller forever, with no owner, setter, or migration path to raise the cap. Economically the cost to deliberately trigger this (355,000+ IMD plus ~16.6 billion gas) makes it an unlikely attack vector, but it is a permanent, unrecoverable ceiling on legitimate future growth of the registry's catalog.

**Fix.** Widen `nextSpecId` to `uint256` (or at minimum `uint32`) before deployment; not fixable after the fact given the lack of a setter.

---

## Informational

- **`_burnOrRefund` forwards the caller's full `msg.value` to the executor on success (not just the quoted `fee`) and returns without a local refund**, relying entirely on the external executor's documented (but, from in-scope code, unverifiable) force-refund behavior. (3-way convergence: Phase 2 asymmetry, boundary, trust-gap agents.)
- **`questionHash` is many-to-one over trait ids** — `Composer.canonical` omits the trait id, the spec `name`, and (for kinds 1/2) `threshold`, so two differently-configured specs can share a question fingerprint. Extensively investigated (9-way convergence across both phases): every agent who chased this to a concrete attempt found the verdict is still computed correctly, because `_decodeAndJudge` applies each trait's own `threshold` locally from `_rule`, never from the attestation. No exploitable path found; recorded to save future re-investigation.
- **`Composer.catalogSpec` discards its passed `curator` argument and always uses the hardcoded `MAINNET_CURATOR` constant.** Live-chain verification during this audit confirmed the deployed `curator_` equals that constant byte-for-byte — **no live impact** — but no on-chain assertion ties the two together, so a future redeployment with a different curator would silently desync trait reads from oracle question content. (5-way convergence.)
- **`onResult` clears the pending record before verifying the attester's signature** (Registry.sol:491 vs 493), so any delivery that fails `_check` still destroys the claimant's paid request with no retry. Requires the Intake itself (or whoever drives its completion callback, out of scope) to deliver non-conforming data; 5-way convergence, no confirmed exploit path independent of Intake's own trust model.
- **`upgrade`'s per-iteration `forceApprove` is a set, not an increment**; if the Intake does not pull synchronously within the same call (unverified — out of scope), a later iteration's approval reset could in principle strand part of an earlier iteration's fee in the pool rather than the Intake. Single-agent lead, unresolved.
- **`Composer.validateSpec`'s chain-evidence window (kinds 1-4) requires only that `toBlock < block.number` (1 block old), while the panel kind requires 7200 blocks** — a reorg could in principle flip a chain-evidence answer that then becomes permanently stored (`_verified`/`_shared` never un-set). Single-agent lead; the off-chain oracle plane may independently wait for finality.
- **`Composer.mainnetHeightBound()` over-estimates mainnet height when deployed off-mainnet** (models missed-slot-free blocks, ignoring the ~0.5-1% real miss rate), which would let `registerSpec` accept a `toBlock` slightly ahead of the real mainnet tip on a hypothetical non-mainnet deployment. Not reachable on the actual mainnet deployment (3-way convergence).
- **UTC-day bucket for the sponsor-pool daily limiter is a calendar bucket, not a rolling 24h window** — two draws can land ~1 second apart across midnight, compressing (not raising) the fixed 9-draw lifetime total. (3-way convergence.)
- **CEI ordering violation on all 5 IMD pulls** (external call before state write) — closed by `nonReentrant` plus `_mint` (not `_safeMint`) on the one path that matters; no live reentrancy surface. (Phase 1 erc20 agent.)
- **No ERC-2981 royalties, no `totalSupply()` getter, no on-chain supply accessor** — consistent with the ownerless, no-treasury design; noted as an integration gap, not a defect.
- **`deployedAt` is written once and never read** anywhere in the contract, and `claimSponsored`'s NatSpec opens with "From launch," suggesting a time-gate that may have been removed from the code but not the comment. (2-way convergence.)
- **Assembly-level `mcopy` bounds in `Renderer.preimage`/`_slice` depend on the generated `TemplateData`/`HiveData` tables tiling exactly**, verified numerically correct for the committed tables (zero gap, zero overlap, exact termination) with no on-chain assertion — a future regeneration of the offline table generator could silently introduce an out-of-bounds write. (Phase 1 assembly agent; independently re-verified by essentially every Phase 2 agent as a side effect of their own checks, with one agent additionally fuzzing all 46,080 tier combinations × 6 community counts and confirming well-formed output.)
- **The 65-byte signature-extraction assembly in `_check`, the EIP-712 digest construction, and signature malleability protections (OZ v5.7, high-`s` rejected) were all independently verified correct** — no finding.
- **No return-data-bomb, no force-send-ETH-stuck, no merkle/hash-forgery path exists** across the external-call surface — verified clean by multiple agents in both phases.
- **`_decodeAndJudge` accepts a T3 shared-fact answer shorter than the spec's own `threshold`/head** (e.g. a 1-address answer for trait 1201, which expects 32), and since `_shared` is write-once with no reset, the excluded ranks could lose the trait permanently. This requires the attester itself to sign a short answer — the attester is already the protocol's full content-trust root, so this is not an attacker-triggerable path, only a defensive-coding gap. (2-way convergence, Phase 2 only.)

---

## Invariant Verification

(From the pre-scan invariant catalog, `x-ray/invariants.md` — every inferred row answered.)

| ID | Property | On-chain (pre-scan) | Verdict (this audit) |
|---|---|---|---|
| I-1 | One card per wallet, forever | Yes | **Holds** — confirmed, `tokenOf` is write-once, no violation found. |
| I-2 | A (claimant, traitId) pair verifies at most once, never un-verifies | Yes | **Holds** — confirmed across both phases. |
| I-3 | `_shared`/`_specs` write-once per id | Yes | **Holds** — confirmed. The questionHash-collision investigation (Info) does not violate this; it concerns two *different* ids with the same question text, not a double-write to one id. |
| I-4 | `idmdSponsored <= 9` per IDMD token | Yes | **Holds, but vacuous** — see L-2. The bound is technically enforced but constrains nothing `claimSponsored` doesn't already permit with no IDMD token at all. |
| I-5 | `poolUsed`/`lastPoolDay` bound sponsor-pool draws | Yes (write) | **Holds for the write itself, but the limiter's failure-path behavior violates its evident intent** — see L-1: a limiter meant to bound legitimate draws also permanently consumes entitlement on an oracle failure outside the member's control. |
| I-6 | 8 dependency addresses immutable (by omission, no `immutable` keyword) | **No** | **Confirmed still No** — no setter exists for any of the 8; this audit found no function that violates it today, so the risk remains purely structural (a future diff could add a setter with no compiler backstop). |
| I-7 | Personal pending pair abandonable only after 14 days, by the claimant | Yes | **Partially holds** — the 14-day guard is sound; the *claimant restriction* has no equivalent for shared facts, which is exactly M-4. |
| I-8 | Sponsor pool is the live IMD balance, donation-susceptible by design | Yes (intentional) | **Holds**, confirmed intentional — not a gap. |
| X-1 | Intake delivers each callback exactly once per `requestId` (assumed, not enforced) | **No** | **Confirmed still No**, extensively investigated (Info: `onResult` clears before verifying). No exploit found independent of Intake's own trust model; the attester's independent signature check bounds the damage of any violation to a denied/stuck request, not a forged trait. |
| X-2 | Anyone can inflate the pool via donation (intentional, not a gap) | Yes (intentional) | **Holds**, confirmed intentional. |
| E-1 | Sponsored-pool spending is capped by the per-wallet/per-token sponsor limits | Yes | **Violated** — H-1 shows the claim holds only for *draw count*, not for *IMD per draw*; the per-draw price is completely uncapped. |
| E-2 | Trait forgery requires compromising both the Intake *and* the attester independently | Yes | **Holds**, re-verified extensively by Phase 2 (9+ agents attempted to break the `questionHash` binding and found no forgery path; content trust rests entirely on the attester's EIP-712 signature regardless of what the Intake delivers). |

---

## Reconciliation Summary

Phase 0 (context, opus) → Phase 1 (8 breadth agents, opus) → Phase 2 (12 depth agents, opus, blind to Phase 1) → this reconciliation. 23 unique (contract, function, bug-class) tuples raised across Phase 2's 12 raw agent outputs, all 23 covered in the findings/informational sections above (several merged under a shared root cause). Coverage: 16/16 entrypoints, 10/10 threat-catalog rows, 12/12 inferred invariant rows — all answered, 0 unanswered holes this pass. The report's top two findings (H-1, M-1) are each independently corroborated by 8-9 of the 20 total hunting agents across both phases working blind to one another — the strongest convergence signal this methodology can produce short of a formal proof, and the primary basis for their severity ratings despite neither requiring privileged access to trigger.

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Independent human review, a bug bounty program, and on-chain monitoring are strongly recommended before and after any further value is entrusted to this contract.
