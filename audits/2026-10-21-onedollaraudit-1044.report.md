# Security Review — Renderer.sol (job 1044)

## Scope & Pin

- **Repo:** `https://github.com/identity-md-launches/launch-2341-renderer-composer-registry` @ commit `832cc45f59acdda805b51799647be24c0cae9741` (tag/ref as named in the job description). The commit was fetched directly (`git fetch --depth 1 origin 832cc45f59acdda805b51799647be24c0cae9741` succeeded, `git checkout --detach FETCH_HEAD` landed on `832cc45`), confirming it is reachable on the remote. An anonymous `git ls-remote <url> <sha>` returns nothing for a bare commit SHA that isn't also a ref name — that is expected GitHub behavior, not a sign the commit is unreachable; the successful depth-1 fetch is the stronger proof.
- **On-chain:** `0x4c7fe2202b29c23b54bd45053a6c88061f1296ef` on Ethereum mainnet (chain id 1). Deployed bytecode was fetched (`cast code`) and confirmed non-empty; a full bytecode-vs-recompiled-source byte-diff was not performed (out of scope for the time budget) — the audit reads and reasons about the GitHub source at the pinned commit, which the job description states as the canonical source for this deployment. `foundry.toml` requests `bytecode_hash = "none"` and `cbor_metadata = false` specifically so a rebuild is byte-identical to the deployed runtime code, per the repo's own stated intent.
- **Audited file:** `src/Renderer.sol` only (524 lines, 426 nSLOC), per the job description's explicit file scope. `src/Types.sol`, `src/TemplateData.sol`, `src/HiveData.sol` were read for context (Renderer.sol's direct imports) and `src/Registry.sol`/`src/Composer.sol` were read selectively to establish ground truth about what the real, deployed counterparty actually does — but no findings are filed against any of those four files; they are out of scope.
- **Compiler:** solc 0.8.24, optimizer on (200 runs), `via_ir = false`, `evm_version = "cancun"`.
- **Context:** client description states the contract is "Ownerless: no owner, setter or upgrade path" — independently confirmed below.

## Methodology

Four-phase pipeline: **Phase 0a** (mechanical x-ray pre-scan: enumeration, nSLOC recompute, entry-point grep) → **Phase 0** (3 parallel opus context agents: access-control inventory, protocol map, external-surface map — no findings, pure structural mapping) → **Phase 1** (6 parallel sonnet breadth agents on the ethskills checklists: general, precision-math, assembly, dos, access-control, erc721/metadata) → **Phase 2** (12 parallel sonnet attack agents — 9 single-specialty + 3 gap-hunter — run blind to Phase 1's findings, armed only with the Phase-0 structural map, following Pashov's solidity-auditor V4 methodology with real `judging.md` gates and the real `assemble.sh` assembler) → **reconciliation** (this document). All 21 hunting agents (6 + 12, plus the 3 context agents) ran independently; convergence between them is noted throughout as a confidence signal, not assumed.

**Severity counts:** 0 Critical · 0 High · 3 Medium · 5 Low · 8 Informational

---

## Findings

### [M-1] `_meta`'s hand-rolled parse of a raw `specOf` reply has no lower-bound check, letting a non-conforming registry force an out-of-gas revert or an out-of-buffer memory read

**Severity:** Medium
**Location:** `_meta()`, `Renderer.sol:143-166`

```solidity
143: function _meta(ICardSource r, address claimant, uint16 traitId) internal view returns (OracleMeta memory m) {
144:     m.traitId = traitId;
145:     (m.requestId, m.oracleRequestId,,) = r.verified(claimant, traitId);
146:     (bool ok, bytes memory ret) = address(r).staticcall(abi.encodeWithSelector(0x701ce949, traitId));
147:     if (!ok || ret.length < 13 * 32) revert UnknownTrait(traitId);
148:     uint256 head;
149:     uint256 nameAt;
150:     uint256 nameLen;
151:     assembly ("memory-safe") {
152:         head := add(add(ret, 0x20), mload(add(ret, 0x20)))
153:         mstore(add(m, 0x20), and(mload(head), 0xff))
...
157:         nameAt := add(head, mload(add(head, 0x160)))
158:         nameLen := mload(nameAt)
159:     }
160:     if (nameAt + 32 + nameLen > _end(ret)) revert UnknownTrait(traitId);
161:     bytes memory name = new bytes(nameLen);
162:     assembly ("memory-safe") {
163:         mcopy(add(name, 0x20), add(nameAt, 0x20), nameLen)
164:     }
```

`_meta` makes a raw `staticcall` to a hardcoded selector `0x701ce949` (confirmed via `cast sig "specOf(uint16)"`) on the caller-supplied `registry` — deliberately absent from the declared `ICardSource` interface — and decodes the reply by hand instead of through Solidity's ABI decoder. The only length check (line 147) bounds the *total size* of the reply; nothing bounds `head` (line 152) or `nameAt` (line 157) against the reply's actual data region before they are dereferenced. Both are built with unchecked 256-bit Yul `add` from words the callee fully controls. `nameLen` (line 158) is read *one line before* the function's only other check (line 160) runs, and that check is upper-bound-only — it never verifies `nameAt >= add(ret, 0x20)`.

Two independently-reproducible effects, each separately confirmed by multiple agents with concrete numbers:

- **Deterministic gas-bomb / OOG revert.** A reply whose first word is an astronomically large value (e.g. `2**255`) makes `head` resolve to a near-arbitrary address; the very first `mload(head)` at line 153 forces the EVM's quadratic memory-expansion cost at that address, consuming gas far beyond any block limit before any check can fire. One agent built a standalone Foundry repro confirming this numerically: a crafted offset consumed 5,001,844 of a 5,000,000 gas stipend.
- **Out-of-buffer read copied into the output.** Setting the head offset to `0` (keeping the four field reads harmless) and the name-offset word to a small two's-complement-negative value (e.g. `-200`) makes `nameAt` resolve to an address *before* `ret`'s own allocation — inside whatever memory Renderer was already using for the in-progress `Card`/`Buf`/`Hive` structures. The upper-bound check at line 160 reduces to `nameLen > 584` for that offset, which the overwhelming majority of incidental 32-byte words (lengths, small integers, addresses) satisfy as false, i.e. the check **passes**, and the subsequent `mcopy` (line 163) copies that out-of-buffer memory into `m.name`, which flows through `escapeJson` into the final returned JSON.

**Verified reachability caveat (why this is Medium, not High):** this is only reachable when `tokenURIOf`'s caller supplies a `registry` that does not encode `specOf`'s reply the way the real `Composer`/`Registry` pair does. One agent independently read `Registry.sol:355-362` and confirmed the production `Registry.specOf`, for catalog ids, forwards `Composer.catalogSpec`'s returndata **verbatim** — meaning the real, deployed counterparty's encoding is exactly what `_meta` expects, and this bug does not fire against it. The entire call chain is `STATICCALL`/`view`; Renderer holds no storage and no value, so the blast radius of either effect is bounded to the one `tokenURIOf` call that chose the non-conforming registry — there is no cross-call, cross-user, or state-corruption path (EVM memory is per-call-frame, confirmed independently by three agents tracing re-entrancy). This is the single most-corroborated issue in the entire audit: independently found by both Phase-0 context agents, both the assembly and precision-math Phase-1 checklists, and 8 of the 12 Phase-2 attack agents (one of whom built a working numeric gas-consumption PoC), with no agent finding a path to a third-party victim distinct from whoever chose the registry argument.

**Recommendation:** validate `head` against both the lower and upper bounds of `ret`'s data region immediately after computing it, before any `mload(head + ...)` — and validate `nameAt` the same way, *before* `nameLen` is read, not after:
```diff
         head := add(add(ret, 0x20), mload(add(ret, 0x20)))
+        if or(lt(head, add(ret, 0x20)), gt(add(head, 0x180), add(add(ret, 0x20), mload(ret)))) {
+            revert(0, 0)
+        }
         mstore(add(m, 0x20), and(mload(head), 0xff))
         ...
         nameAt := add(head, mload(add(head, 0x160)))
+        if lt(nameAt, add(ret, 0x20)) { revert(0, 0) }
         nameLen := mload(nameAt)
```
A simpler, more robust alternative: decode `specOf`'s reply with Solidity's typed ABI decoder (declaring `specOf` on `ICardSource` and calling it normally) instead of hand-rolled assembly, matching the other four `ICardSource` calls in this file, all of which get this validation for free from the compiler.

---

### [M-2] Unbounded growth of a claimant's verified community specs can make `tokenURIOf` permanently unreadable through ordinary use — no attacker required

**Severity:** Medium
**Location:** `cardOf()`, `Renderer.sol:117-119`

```solidity
117: uint16[] memory specs = r.verifiedSpecsOf(claimant);
118: c.communityCount = specs.length;
119: uint256 shown = specs.length < MAX_COMMUNITY_IN_METADATA ? specs.length : MAX_COMMUNITY_IN_METADATA;
```

`cardOf` reads the **entire** `verifiedSpecsOf(claimant)` array before capping what it actually uses (`shown`, capped at `MAX_COMMUNITY_IN_METADATA = 32`). By the time that cap is applied, Solidity has already ABI-decoded and copied the full array into memory — the cap protects only what gets *printed*, not what gets *read*. EVM memory-expansion cost is quadratic (`3a + a²/512` gas for `a` words); a `uint16[]` of `N` elements costs roughly `N+2` words to copy. At `N = 100,000` that is ≈19.8M gas for the copy alone — past typical 10–25M `eth_call` budgets used by marketplaces/indexers — and at `N ≈ 123,900` the copy alone consumes the entire 30M mainnet block gas limit, making the call unexecutable in any block regardless of gas supplied.

Verified community specs are accrual-only in this system's domain model (registration adds to `_specsOf[claimant]`; nothing in the reviewed scope removes an entry) — a claimant who stays active in the community-verification system over a long period grows this array without bound, through entirely ordinary, legitimate use. Once the threshold above is crossed, that claimant's `tokenURIOf` becomes permanently unreadable, by any caller, forever.

**Reachability caveat (why Medium, not High):** this is a different mechanism from M-1/L-1/L-2 — it requires no hostile registry, only the real system's own accrual behavior — but its practical reachability depends on the economic cost of registering tens of thousands of specs against the real `Registry`/`Composer` (registration is fee-gated; per Phase-0 context, a per-registration fee was noted in passing in the repo's own documentation). This audit's scope was pinned to `Renderer.sol` alone, so the exact fee schedule and whether it makes 50,000+ registrations economically implausible could not be verified from the in-scope file. The gas-math itself is independently verifiable and not in doubt; the open question is purely about real-world reachability over a long enough time horizon or at a low enough per-registration cost.

**Recommendation:** never let `cardOf` pull (or let Solidity copy into memory) the full, unbounded `verifiedSpecsOf` array just to read its length and the first 32 entries. Add a bounded/paginated view to `ICardSource` (e.g. `verifiedSpecsCountOf(address) view returns (uint256)` plus a capped `verifiedSpecsPage(address, uint256 limit)`), or — if the interface cannot change — use a low-level `staticcall` + manual `returndatacopy` capped to the bytes needed for 32 entries, so Renderer never pays to copy more than it will ever use regardless of how large the backing array has grown.

---

### [M-3] Any address can call `tokenURIOf` with a self-controlled registry and produce output that prints unconditional "verified"/"oracle-attested" language for fabricated trait data

**Severity:** Medium
**Location:** `tokenURIOf()`, `Renderer.sol:97-99`; `cardOf()`, `Renderer.sol:103-137`; `TemplateData.TEMPLATE`

```solidity
97: function tokenURIOf(address registry, uint256 tokenId) external view returns (string memory) {
98:     return tokenURI(cardOf(registry, tokenId));
99: }
```

`tokenURIOf` takes `registry` as a bare, unchecked caller-supplied argument — no allowlist, no code-hash/interface check, no comparison against any known address (none exists; the contract has no storage). Because every rendering byte — the SVG hive card, the JSON schema, and critically the fixed `TemplateData.TEMPLATE` prose itself — is a compile-time constant shared across every call, an attacker who deploys a minimal `ICardSource` stub (returning hand-picked top-tier `traits`, fabricated `verifiedSpecsOf` ids, and a crafted `specOf` reply with any desired "name") gets back a fully valid `data:application/json;base64,...` tokenURI that is byte-for-byte structurally identical to one the real `Registry` would produce. The fixed template text asserts unconditional verification language (decoded from `TemplateData.TEMPLATE`: "...chain-proven, panel-attested and shared-fact traits are attested by the IMD oracle through the Intake and verified in the registry...") for *every* registry's output, with no field in the output identifying which `registry` address actually produced it.

**Concrete path:** attacker deploys `FakeRegistry` implementing the four `ICardSource` views plus a handler for raw selector `0x701ce949`; `claimantOf` returns a nonzero address, `traitsOf` returns ids engineered to hit the top tier of every family, `verifiedSpecsOf`/`specOf` return fabricated "verified" community facts. Calling `Renderer.tokenURIOf(address(FakeRegistry), anyTokenId)` directly (an ordinary call to a public, unauthenticated function) returns a complete, well-formed tokenURI with all-top-tier traits and fabricated "verified" attestations. That output can be shared out-of-band (a decoded-image screenshot, a Discord/Twitter post, a fake marketplace listing) as purported "proof" of a real token's traits, with no way for a casual viewer to detect that the registry behind it was not genuine.

**Mitigating factors (why Medium, not High):** the intended, documented integration path is not spoofable this way — `Registry.tokenURI` always calls `renderer.tokenURIOf(address(this), tokenId)` with its own, fixed address, never caller-controlled input, so a legitimate marketplace reading the real collection's `tokenURI` is unaffected. The exposure is specific to direct, out-of-band calls to `Renderer` being mistaken for authoritative output. Separately, because the repository and its rendering logic are public, a motivated attacker could already fabricate similarly convincing fake imagery/JSON without ever calling this contract — the marginal capability this bug adds over "anyone can fake a screenshot" is real but bounded.

**Recommendation:** document prominently, in `tokenURIOf`'s own NatSpec, that its output is not self-authenticating and that integrators must independently verify the `registry` argument against the canonical collection address before treating any returned metadata as authoritative. Consider embedding the `registry` address into the emitted JSON (e.g. as an attribute) so a reader can at least cross-check provenance instead of receiving a payload that is architecturally indistinguishable regardless of source.

---

### [L-1] `cardOf` indexes a 13-slot family array from an unvalidated trait id, relying on incidental compiler panics instead of an explicit check

**Severity:** Low
**Location:** `cardOf()`, `Renderer.sol:111-115`; contrast `traitName()`, `Renderer.sol:75`

```solidity
111: uint16 id = c.traits[i];
112: uint256 fam = id / 100;
...
115: if (fam != 11 || c.top[fam - 1] == 0) c.top[fam - 1] = id;
```

`traitName` computes the identical `fam = traitId / 100` and explicitly reverts with `UnknownTrait` when `fam < 1 || fam > 13` (line 75) before ever indexing with it. `cardOf` performs the same division on `traitsOf`'s externally-supplied return value and indexes the fixed-size `uint16[13] top` array with no equivalent guard. An id below 100 (`fam = 0`) underflows `fam - 1` under Solidity 0.8's checked arithmetic (`Panic(0x11)`); an id of 1400 or above (`fam >= 14`) indexes past the 13-slot array (`Panic(0x32)`). Both are deterministic, clean reverts — no memory corruption, no state write.

One agent independently read `Composer.sol`'s `CATALOG` table and confirmed it only ever contains ids that decode to `fam ∈ [1,13]` — the real, deployed counterparty structurally cannot trigger this. Reaching it requires `tokenURIOf` to be called with a caller-supplied registry whose `traitsOf` returns an out-of-range id, which — as with M-1 — only reverts the call that chose that registry. Independently confirmed by 12 of the 12 Phase-2 attack agents in some form (as either a FINDING or a corroborating LEAD), making this the second most-corroborated issue in the audit.

**Recommendation:** add the same `fam < 1 || fam > 13` check `traitName` already uses, and skip (or revert `UnknownTrait`) rather than index on failure.

---

### [L-2] No cap on the number of trait ids that trigger oracle-metadata sub-calls, unlike the explicit cap on the community-spec path

**Severity:** Low
**Location:** `cardOf()`, `Renderer.sol:109,126-136`; `_meta()`, `Renderer.sol:143-166`

The community-spec path is explicitly capped: `shown = min(specs.length, MAX_COMMUNITY_IN_METADATA)` (line 119) bounds the number of `_meta` calls that path can trigger to at most 32. The sibling trait path has no equivalent cap — every element of the uncapped `c.traits` array with `id >= 701` triggers one more `_meta` call (line 132), and each `_meta` call makes two further outbound calls (`r.verified` plus the raw `specOf` staticcall). Total outbound call count is `3 + 2*(n + shown)`, where `n` is driven entirely by `traitsOf`'s return length — unbounded from Renderer's perspective.

Against the real `Registry`, `traitsOf` is capped at the fixed 25-entry catalog, so this never fires in production. It fires only against a caller-supplied registry that returns an arbitrarily long `traitsOf` array — e.g. 10,000 qualifying ids would trigger over 20,000 outbound calls and tens of millions of gas in memory expansion for the resulting `OracleMeta[]` array alone, well past typical `eth_call` gas budgets. As with M-1 and L-1, the only party affected is whoever chose to call `tokenURIOf` with that registry.

**Recommendation:** add an explicit upper bound on `c.traits.length` (or on the count of qualifying ids) inside `cardOf`, mirroring the existing `MAX_COMMUNITY_IN_METADATA` pattern, so Renderer's own cost ceiling does not depend on trusting whatever registry a caller supplies.

---

### [L-3] The raw `specOf` staticcall copies the callee's entire return into memory before any length check runs

**Severity:** Low
**Location:** `_meta()`, `Renderer.sol:146`

```solidity
146: (bool ok, bytes memory ret) = address(r).staticcall(abi.encodeWithSelector(0x701ce949, traitId));
147: if (!ok || ret.length < 13 * 32) revert UnknownTrait(traitId);
```

Assigning a `staticcall`'s result directly to `bytes memory ret` makes Solidity copy the entire returndata into freshly-allocated memory *before* line 147's length check can reject it. The check only enforces a minimum size; there is no upper bound. A registry returning several hundred KB to several MB forces a proportionally expensive copy — a 1MB reply costs roughly 2.0M gas in memory expansion alone, a 10MB reply roughly 191.6M gas (a guaranteed out-of-gas revert) — paid unconditionally regardless of whether the call is ultimately rejected as `UnknownTrait`. This compounds M-1: a larger `ret.length` also gives more slack for M-1's upper-bound check to pass with an out-of-bounds `nameAt`.

**Recommendation:** bound the copied size explicitly — e.g. a manual `returndatacopy` capped to `min(returndatasize(), MAX_EXPECTED_SIZE)`, or an early revert when `returndatasize()` exceeds that cap, before any implicit Solidity decode occurs.

---

### [L-4] Oracle panel-size/quorum constants are hardcoded in `_one`, duplicating logic that (per the file's own comment) also lives in the registry

**Severity:** Low
**Location:** `_one()`, `Renderer.sol:465-480`

```solidity
478: _put(b, panel ? bytes("11") : bytes("5"));
...
480: _put(b, panel ? bytes("7") : bytes("3"));
```

`_one` hardcodes the displayed `minPanelSize`/`minQuorum` fields as literal strings based on `panel = (m.kind == 3 || m.kind == 5)`, per the comment at lines 461-464 ("Kinds 1, 2 and 4 ask a 5/3 panel; kind 3 ... and kind 5 ... 11/7"). The authoritative verification-requirement constants for a given `kind` presumably live once in the registry/composer that actually runs verification (`Registry._panelOf` implements the identical `kind == 3 || kind == 5` rule independently, per Phase-0 analysis). This is a second, independent copy with no shared source of truth and no compiler-enforced link — if the registry-side constants for any kind ever change, or a new `kind` value is introduced, Renderer silently prints stale literals, misrepresenting the verification strength backing a minted trait's metadata.

**Recommendation:** have the registry expose panel size/quorum via its `specOf`/`verified` return so Renderer reads rather than re-derives these values, or add a cross-reference test that fails CI if the registry's authoritative constants ever diverge from `_one`'s literals.

---

### [L-5] `escapeJson` does not escape single quotes, leaving a residual gap against its own documented threat model

**Severity:** Low
**Location:** `escapeJson()`, `Renderer.sol:495-523`

The function's own doc comment (lines 492-494) states its purpose is to "neutralise markup... so a hostile spec string can break neither the JSON nor **an SVG a viewer might paste it into**." It escapes `"` and `\`, and `\u00XX`-escapes every byte below `0x20` plus `<`, `>`, `&` — but does not escape the single quote `'` (0x27). This is harmless for JSON itself (JSON strings are always double-quoted), but the comment explicitly extends the threat model to a consumer splicing the raw `name` string into markup — many naive templating patterns use single-quoted attributes (`<div data-x='VALUE'>`), which an unescaped `'` can still break out of even though `"`/`<`/`>` are neutralized.

**Proof of Concept:** `OracleMeta.name = "x' onmouseover='alert(1)"` passes through `escapeJson` unchanged (no `"`, `\`, control byte, `<`, `>`, or `&` present). A consumer that interpolates this field into a single-quoted HTML attribute — a known failure mode for aggregators that trust already-"sanitized" NFT metadata — would have the attribute broken out of.

**Recommendation:** extend the escaped-character set to also `'`-escape `'`, consistent with the existing control/`<`/`>`/`&` branch — a one-line addition costing nothing in the common no-quotes case.

---

### [I-1] `cardOf` trusts `traitsOf`'s return order without checking or enforcing it

**Severity:** Informational
**Location:** `cardOf()`, `Renderer.sol:113-115`

The fold `if (fam != 11 || c.top[fam - 1] == 0) c.top[fam - 1] = id;` keeps the *last* id seen per family (so "highest tier wins") and the *first* id seen for family 11 ("lowest/rarest wins") — correct only if `traitsOf` returns ascending, de-duplicated ids, a property the comment states as fact about the registry but that `cardOf` never itself checks or sorts for. One agent independently read `Composer.traitsOf` and confirmed it is documented and implemented to iterate its fixed `CATALOG` table in ascending order — the invariant holds today, by construction of the real counterparty, not by anything in this file. Four of twelve Phase-2 agents independently flagged this exact gap; none could construct a path where it currently breaks against the real deployment. Unlike L-1/L-2, a violation of this assumption would not revert — it would silently display the wrong trait tier, with no error signal at all.

**Recommendation:** compute each family's true maximum (minimum for family 11) with an explicit numeric comparison instead of relying on input order, removing the dependency on an external, unenforced guarantee.

---

### [I-2] `SLOTS`/`SLICES` are independent literals, not references to `TemplateData`'s own constants

**Severity:** Informational
**Location:** `Renderer.sol:27-29` vs `TemplateData.sol:10-11`

`Renderer` re-declares `SLOTS = 21`/`SLICES = 22` rather than referencing `TemplateData.SLOTS`/`TemplateData.SLICES`. Verified independently by three separate agents: the 22 `OFFSETS` slices currently tile the 1205-byte `TEMPLATE` constant with zero gap and zero overlap, and the two declarations currently agree exactly — but because they are textually independent, nothing would catch a future regeneration of `TemplateData` (via `tools/gen_template.py`) that changes the slot/slice count without a matching edit here, which could silently produce truncated/garbled JSON or an out-of-bounds array write.

**Recommendation:** reference `TemplateData.SLOTS`/`TemplateData.SLICES` directly if Solidity's rules permit it in this context, or add a test asserting the two pairs match, so a future mismatch fails CI loudly instead of shipping silently.

---

### [I-3] `traitName(1105)` resolves to a name that reads inconsistently with the rest of its family

**Severity:** Informational
**Location:** `traitName()`, `Renderer.sol:72-88`; `FAMILY_TIERS`/`NAMES` constants

Family 11 (0-indexed position 10) has `FAMILY_TIERS[10] = 5`, so `traitName(1105)` passes validation and resolves to the string `"First thousand"` — a name that, by its wording, reads oddly next to the other four tiers of the same family (`"PID #1"`, `"PID #1000"`, `"PID #10000"`, `"PID #19522"`). The table arithmetic itself is internally consistent (confirmed by script: 314-byte `NAMES` sums exactly from 25 `NAME_LENS` entries, `FAMILY_BASE`/`FAMILY_TIERS` map bijectively) — this is a data-content observation, not a memory-safety one, and could not be confirmed as an actual authoring error without the out-of-scope `CATALOG.md`.

**Recommendation:** cross-check this specific entry against the catalog's own canonical documentation to confirm `"First thousand"` is the intended name for tier 5 of the PID family.

---

### [I-4] Four of five outbound registry calls bubble raw revert data; the fifth converts every failure to the same error

**Severity:** Informational
**Location:** `cardOf()`/`_meta()`, `Renderer.sol`

`claimantOf`, `traitsOf`, `verifiedSpecsOf`, and `verified` all bubble the registry's own revert reason unchanged to `tokenURIOf`'s caller (standard Solidity behavior for a typed external call that reverts). The raw `specOf` staticcall (`_meta`, line 146-147) instead converts any failure — a revert, or a too-short reply — into the same `UnknownTrait(traitId)`, discarding the callee's actual revert data. This asymmetry could in principle let an observer distinguish which of several registry calls failed and why, though no concrete information-disclosure impact was established, since the registry's own revert behavior is out of this audit's scope.

---

### [I-5] A community trait's displayed name is never checked against what its underlying spec actually proves

**Severity:** Informational
**Location:** `_one()`, `Renderer.sol:465-490`

`_one` prints a free-text `name` field — deliberately never decoded or cross-checked against the spec's `kind`/`item`/`threshold` (per the file's own doc comment, "without decoding the spec body") — directly alongside `"evidence":"chain"/"panel"` fields that read as a verification guarantee. Whether anything upstream (in the out-of-scope `Registry`/`Composer`) enforces that a spec's free-text name actually describes the threshold the spec enforces could not be verified from `Renderer.sol` alone.

---

### [I-6] `tokenURIOf`'s unchecked `registry` argument is a deliberate design choice, not an access-control gap

**Severity:** Informational
**Location:** `tokenURIOf()`, `Renderer.sol:97`

Independently re-verified by two separate agents across both phases: the contract has zero storage, zero roles, zero `msg.sender`/`tx.origin` checks, no modifiers, no constructor, and no admin/owner of any kind — fully consistent with the client's own "ownerless, no setter, no upgrade path" description. The one plausible "missing access control" candidate — `tokenURIOf` accepting any `registry` address with no validation — was specifically scrutinized and judged to be the intended flexible, shared-renderer design (any `ICardSource`-shaped contract may use it) rather than a defect; every call into `registry` is read-only (`STATICCALL`), so no privilege-escalation, fund-loss, or state-corruption path exists through this parameter in isolation. The genuine risks this design enables are tracked separately as M-1/M-3/L-1/L-2/L-3 above.

---

### [I-7] `escapeJson` passes bytes ≥0x7F through without UTF-8 validation

**Severity:** Informational
**Location:** `escapeJson()`, `Renderer.sol:495-523`

Every byte in `[0x7F, 0xFF]` — including invalid or lone UTF-8 continuation/lead bytes — passes through unescaped into a nominally UTF-8 JSON document. This cannot break JSON structure (UTF-8 continuation bytes can never alias the ASCII specials the function does escape), so the only consequence is cosmetic mojibake/replacement-character rendering in strict UTF-8 consumers, not a parsing failure or injection.

---

### [I-8] `pragma solidity 0.8.24` defaults to the PUSH0 opcode

**Severity:** Informational
**Location:** `Renderer.sol:2`

Solidity ≥0.8.20 emits `PUSH0` by default for the configured EVM version; some L2s/alt-EVM chains have historically lacked support for it. Given the job's own description and the on-chain pin above confirm Ethereum mainnet deployment (which fully supports `PUSH0`), this has no practical impact today — recorded only as a caveat should this renderer ever be redeployed to an older L2/alt-EVM chain without re-checking `PUSH0` support there.

---

## Access-Control Inventory

| Function | Guard | Caller | State written | Value |
|---|---|---|---|---|
| `traitName(uint16)` — `external pure`, L72 | None — permissionless; domain check only (`fam`/`tier` range, L75) | Anyone | None — zero storage exists | No |
| `tokenURIOf(address,uint256)` — `external view`, L97 | None — permissionless; no restriction on `registry` | Anyone | None — entire call chain is `STATICCALL`/`view` | No |

**Roles:** none. Zero storage slots, zero `owner`/`AccessControl`/`msg.sender` usage, no constructor, no immutables, no `delegatecall`/`selfdestruct`/upgrade path — independently confirmed by 3+ separate agents across both phases, matching the client's own description.

**Entrypoint coverage:** 2 external/public functions in source, 2 in the access-control inventory, 0 state-changing (both `view`/`pure`). Both addressed by findings above (traitName: I-3; tokenURIOf: M-1/M-2/M-3/L-1/L-2/L-3/I-6).

## Threat Model (summary)

| Actor | Reach | Potential gain | Invariant that must hold |
|---|---|---|---|
| Any caller, via a self-controlled `registry` | Full `cardOf`/`_meta` chain | Full control over every byte Renderer processes | Addressed — M-1, M-3, L-1, L-2, L-3 |
| Any caller, via `_meta`'s raw parse specifically | Memory read/gas-bomb inside one `tokenURIOf` call | Corrupted output or deterministic OOG for that call only | Violated — M-1 |
| Any claimant, via ordinary long-term protocol use | `verifiedSpecsOf` growth | Own token becomes permanently unrenderable | Violated (reachability uncertain) — M-2 |
| Any caller, via a hostile registry's revert data | Typed `ICardSource` calls | Spoofed error selectors indistinguishable from Renderer's own | Informational — I-4 |
| n/a — no privileged role exists | n/a | n/a | Holds — I-6 |

## Invariant Verification

| ID | Property | On-chain enforced? | Verdict |
|---|---|---|---|
| I-a | Every `traitsOf` element decodes to `fam ∈ [1,13]` | No (Renderer); Yes (real `Composer.CATALOG`, confirmed by direct read) | **Violated in Renderer → finding L-1** (currently masked by the real counterparty's own guarantee) |
| I-b | `traitsOf` returns ascending, de-duplicated ids | No (Renderer); Yes (real `Composer.traitsOf`, confirmed by direct read) | **Violated in Renderer → finding I-1** (currently masked the same way) |
| I-c | `OFFSETS` slices tile `TEMPLATE` with zero gap/overlap | Yes — verified by direct byte-decode (1205 bytes, 22 slices, exact sum) | **Holds** |
| I-d | `HiveData` point/fragment table indices stay within declared bounds for every reachable input | Yes — verified exhaustively across all `(i, lv, k, steps)` combinations | **Holds** |
| I-e | `_meta`'s raw `specOf` parse only reads within the returned buffer | No — only an upper bound is checked, and only after the vulnerable read | **Violated → finding M-1** |

Coverage: 2 entrypoints, 2 addressed. 5 threat-catalog rows, 5 answered. 5 inferred invariants, 5 answered (2 hold, 3 violated-in-Renderer-but-currently-masked-by-the-real-counterparty). Holes closed this pass: 0 — every row was already examined by Phase 1 and/or Phase 2.

## Reconciliation Notes

- **Convergence as a confidence signal, not a vote.** M-1 (the `_meta` bounds gap) was independently rediscovered by at least 13 separate analytical passes across all four phases — the strongest corroboration in this audit — and is reported at Medium specifically because every one of those passes also independently confirmed the same mitigating fact: the real, deployed `Registry`/`Composer` pair cannot trigger it. Severity reflects actual reachability against the live system, not the raw count of agents who found it.
- **Self-harm calibration.** Several Phase-2 agents explicitly declined to promote L-1/L-2/M-1-style findings to FINDING status, reasoning that a caller who supplies their own non-conforming `registry` is only harming their own call. This report includes them anyway, at reduced (Low, not High/Critical) severity, on the judgment that a permanently-deployed, ownerless, unpatchable library contract explicitly designed to accept *any* `ICardSource`-shaped caller has a legitimate robustness interest distinct from classic single-user self-harm — a view Agent 11 (trust-gap) and the majority of Phase-1 checklists independently converged on for at least the spoofing angle (M-3).
- **M-2 is the one finding that does not depend on a hostile registry at all** — it is the sole DoS mechanism in this report reachable through the real system's own ordinary accrual behavior, which is why it is held at Medium despite uncertain practical reachability (fee economics were out of this file's scope to verify).

## Coverage Statement

This review covers `src/Renderer.sol` only, as scoped by the job description. `src/Registry.sol`, `src/Composer.sol`, and the rest of the repository were read selectively for context and ground-truth verification of invariants Renderer depends on, but received no independent audit pass and may carry their own findings outside this report's scope.

---

> This review was performed by an AI-orchestrated multi-agent pipeline (21 independent analytical passes across context-building, breadth, and depth phases). AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Independent human review, and if applicable a bug bounty program, are recommended before treating this as the final word on `Renderer.sol`'s security.
