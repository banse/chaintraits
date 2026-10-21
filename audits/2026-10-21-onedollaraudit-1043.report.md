# Security Review — Composer.sol (job 1043)

**Repo:** `https://github.com/identity-md-launches/launch-2341-renderer-composer-registry`
**Commit (pinned by client, verified reachable on remote):** `832cc45f59acdda805b51799647be24c0cae9741`
**On-chain target:** `0x1d7da5353830248b042fc1396d5d12c31ac69824` (Ethereum mainnet, chain id 1)
**Scope (client-pinned, single file):** `src/Composer.sol` (666 lines; nSLOC ≈ 585). Imports (`src/Types.sol`,
`src/interfaces/IWhitelistCurator.sol`, `src/interfaces/IIDMD.sol`) and the sole in-repo caller (`src/Registry.sol`)
were read for context and impact-tracing only — no findings are filed against them; they are out of scope.
**Methodology:** two-phase-audit v3 — x-ray pre-scan → context (protocol map) → ethskills breadth (5 checklists,
sonnet) → pashov solidity-auditor V4 depth (12 agents, blind, sonnet, small-scope) → hybrid reconciliation.

**Severity counts:** 0 Critical · 1 High · 3 Medium · 5 Low · 6 Informational

---

## 0. What this contract is

`Composer` is a standalone, **ownerless and storage-less** contract (zero state variables; every contract-level
value is `constant`; no constructor logic). All 7 external/public members are `view` or `pure`. It composes the
text and JSON body of oracle-attestation "questions" for a trait/catalog system, and computes
`questionHash = keccak256(canonical(q))`, the value an off-chain oracle "plane" is expected to independently
re-derive and sign against (per `INTEGRATION.md`, read for context). Because the contract holds no funds and has
no access-control surface by design, the realistic ceiling on impact here is **corruption of the attestation's
integrity or a fee loss for a requester downstream** — not direct fund drainage from this file alone.

Every finding below was produced by this job's own phase 0 context map, 5 breadth agents, and 12 depth agents
(summarized at the end), then independently re-verified by hand (Python byte-length computations, direct reads
of `validateSpec`'s real line numbers, and the project's own `TEMPLATES.md` / `INTEGRATION.md` / test suite) before
being assigned final severity. Two items that multiple phase-2 agents raised as apparent bugs were **downgraded to
Informational after verification** — see §6 and §7 — because the project's own documentation and test suite
show they are intentional design or a measurement artifact, not defects. This recalibration is reported explicitly,
not silently dropped, so the client can see what was checked and why.

---

## 1. Access-Control Inventory

| Function | Guard | Caller | State written | Moves value |
|---|---|---|---|---|
| `DEPOSITED()` (L21, auto getter) | none | anyone | none | no |
| `catalogSpec(uint16,address)` (L74) | none (arg check only, L76) | anyone | none (pure) | no |
| `directSnapshot(address,IWhitelistCurator,IIDMD)` (L136) | none | anyone | none (view) | no |
| `traitsOf(address,address)` (L174) | none | anyone | none (view) | no |
| `validateSpec(Spec calldata,uint256)` (L203) | none (field checks only) | anyone | none (view) | no |
| `mainnetHeightBound()` (L266) | none | anyone; also internal (L204) | none (view) | no |
| `compose(uint16,Spec,address,address,address)` (L345) | none | anyone | none (view) | no |

**Roles:** none exist. No inheritance, no modifiers, zero `msg.sender`/`tx.origin` references in the file.
**Unguarded state-changing entrypoints:** none — there are zero state-changing entrypoints of any kind, guarded or
not, because the contract has no storage to change. Confirmed by direct reading, not assumed.

---

## 2. Findings

### [H-1] `validateSpec` never checks that a count/sum spec's `arg`, `fixedArg`, or `sumArg` names a real indexed field of the event — a registered trait can be permanently unanswerable, losing every requester's fee

**Severity:** High
**Confidence:** 85
**Location:** `validateSpec()`, `src/Composer.sol:222-240` (contrast with the kind-3-only check at line 230)

**Description:** For kind 3 (ranking) specs, `validateSpec` runs `_topicOf(item, arg) == 0` (line 230) to confirm
`arg` actually names an indexed, `address`-typed parameter of the event in `item`. For kind 1 (count) and kind 2
(sum) specs, which rely on the **identical** semantic claim — the composed question explicitly says *"whose indexed
`{arg}` argument equals..."* and the `method` definition instructs the reader to filter `eth_getLogs` by that
field as a topic — `validateSpec` only checks `arg`'s length and charset (lines 222-228), never whether it names
a real field of `item`, let alone an indexed one. The same gap applies to `fixedArg` (lines 231-234) and `sumArg`
(lines 235-240, kind 2 only): neither is ever checked against `item`'s actual parameter list.

**Proof of Concept:** Register a kind-1 community spec with `item` = the real event text
`"event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)"`
and `arg = "amount"` — a real field of that event, but a non-indexed `uint256` data field, not an address topic —
or `arg = "zzNotAField"`, a name that appears nowhere in the signature. Both pass every check in `validateSpec`
(kind ≤ 3 only requires non-empty, ≤32 bytes, charset-valid). The spec registers successfully. `question()`
(lines 383-402) then composes: *"...count the `event Deposited(...)` events emitted by the contract C whose
indexed amount argument equals 0x\<claimant\>..."* — a filter that can never match a real log, because `amount`
is not an indexed topic (or does not exist). This trait is now permanently, structurally unanswerable by any
honest execution of its own stated method. Two of this job's twelve depth agents (execution-trace and
first-principles specialists, working independently and blind to each other) constructed this exact PoC and
traced its consequence through the project's own `Registry.sol`/`reference/IntakeV2.sol` (read for impact context,
out of this file's scope): a requester who later pays to request this trait (`Registry.upgrade`/`requestSharedFact`)
has their fee forwarded to the Intake's `payTo` immediately on request; when the panel cannot resolve the
impossible filter, `Registry.onFailure` clears the pending state but performs no refund — the fee is gone with
no possibility of a correct answer ever being delivered, by construction of the registered spec.

**Recommendation:** Extend the `_topicOf`-based existence/indexed check (or an equivalent parameter-presence check
against `item`) to `arg` for kind 1 and kind 2, and to `fixedArg`/`sumArg` wherever they are set, so `validateSpec`
cannot accept a count/sum spec whose claimed field does not exist or is not indexed.

---

### [M-1] `compose()` never validates a community `Spec` before using it — any direct caller can inject unescaped characters into the hashed question document

**Severity:** Medium
**Confidence:** 80
**Location:** `compose()`, `src/Composer.sol:345-359`; consumed by `question()` (363-564), `encodeBody()`
(577-619), `canonical()` (624-647); the missing guard is `validateSpec()`'s charset check, `_charset()` (273-289)

**Description:** For `traitId < 10001` (catalog ids), `compose()` discards the caller's `s` and rebuilds it from
hardcoded constants (lines 350-353). For `traitId >= 10001` (community ids), it uses the caller-supplied `Spec`
**verbatim** — `compose()` never calls `validateSpec()` itself, anywhere in the function. `validateSpec`'s
`_charset` checks (which forbid `"` and `\` in `item`/`arg`/`fixedArg`/`sumArg`/`name`) are therefore not enforced
on this path. `compose()` is `external` with **no access control** on a standalone, ownerless, deployed contract —
anyone can call it directly, bypassing the registration discipline the file's own comment assumes ("spec strings
are charset-checked at registration, so no JSON escaping is ever needed here," lines 18-19). Neither `encodeBody()`
nor `canonical()` escapes any character — both build their output with raw `bytes.concat`.

**Proof of Concept** (independently constructed by four of twelve depth agents with working, hand-traced byte
sequences): call `compose(10001, s, claimant, consumer, curator)` with `s.kind = 1`, `s.item` a valid event
signature, and `s.arg = 'contributor", "evidence":"panel'` (a plain quote character inside an otherwise
charset-legal-looking string). `question()`'s kind-1 branch (lines 383-402) concatenates `s.arg` directly into
`q.question` with no escaping; `encodeBody()` (lines 605-607) then wraps `q.question` as
`'"question": "' + q.question + '",\n  "quorum": ...'`. The emitted `body` bytes read
`..."question": "...whose indexed contributor", "evidence":"panel argument equals ...` — the embedded quote closes
the `"question"` string early and injects a second, attacker-chosen `"evidence"` key that overwrites the
contract's own `"evidence": "chain"` field written earlier in the same object. `canonical()` performs the identical
raw concatenation, so `questionHash = keccak256(canonical(q))` is computed over an equally corrupted document.

**Mitigating factor (why this is Medium, not High):** the one real integration in this repository,
`Registry.registerSpec()` (`src/Registry.sol:659`, read for context), always calls `composer.validateSpec(spec,
block.number)` before persisting a community spec, and `Registry.composeBody()` only ever passes `compose()` a
spec already pulled from that validated storage. No path through the real, deployed Registry reaches `compose()`
with an unvalidated `Spec`. The gap is real and directly exploitable against the standalone `Composer` contract
itself — which is deployed independently on mainnet with its own address and no access control — but no
fund-moving or state-changing consequence was found for a direct call, since `compose()` is `view`-only and its
output is simply returned to whoever called it.

**Recommendation:** Call `validateSpec(s, block.number)` (or re-run its `_charset`/length/kind checks) inside
`compose()` itself for every `traitId >= 10001`, before `question()` runs, so the invariant the file's own comment
already claims is actually enforced by this contract rather than only by caller convention.

---

### [M-2] `validateSpec`'s charset allows ordinary English prose inside `item`/`arg`, which `compose()` prints verbatim into the natural-language question an off-chain panel reads

**Severity:** Medium
**Confidence:** 55 (impact depends on an off-chain panel mechanism not verifiable from this file)
**Location:** `_charset()` mode 1, `src/Composer.sol:273-289`; consumed by `question()` (363-564)

**Description:** Unlike M-1, this path is reachable **through the fully validated registration flow** — no bypass
of `validateSpec` is required. `_charset` mode 1 (used for `item`) permits letters, digits, `_`, space, comma,
`(`, `)`, `[`, `]`, and `validateSpec` only checks a fixed `"event "`/`"function "` prefix and (for kind 3 only)
the indexed-address grouping key (line 230) — it never confirms `item` is otherwise a syntactically valid
signature beyond that. A registrant can therefore pad `item` (up to 256 bytes) or `arg`/`fixedArg`/`sumArg`
(up to 32 bytes each) with ordinary, charset-legal English words, and `compose()`/`question()` copy that text
verbatim into the sentence sent to the off-chain panel (per `INTEGRATION.md`, the panel is a multi-party quorum of
5-11 members requiring 3-7 agreement, read for context only).

**Why this is flagged at Medium and not higher:** the audit could not confirm from in-scope code whether the
panel's judging process is automated/LLM-assisted (where embedded natural-language instructions could function as
a prompt-injection vector) or purely human reviewers manually checking `eth_getLogs` results (where injected prose
is closer to a misleading-but-not-structurally-exploitable nuisance, and would need to independently mislead
multiple quorum members to change the outcome). This is reported as a genuine, validated-path-reachable gap in
`validateSpec`'s coverage rather than a demonstrated attack, consistent with how the depth agent that raised it
qualified its own finding.

**Recommendation:** Tighten `_charset` mode 1 (or add a dedicated grammar check) so a registered `item`/`arg` must
parse as a minimal, well-formed event/function signature rather than merely satisfying a permissive character
allow-list — closing the gap regardless of what the off-chain panel turns out to do with the text.

---

### [M-3] Caller-supplied `curator`/`idmd`/`registry` targets can grief `directSnapshot`/`traitsOf`'s gas cost via oversized return data, independent of the declared ABI return type

**Severity:** Medium
**Confidence:** 75
**Location:** `_direct()`, `src/Composer.sol:151,157,161,165,168`; `traitsOf()`, `src/Composer.sol:179`

**Description:** `directSnapshot`/`traitsOf` take `curator`, `idmd`, and `registry` as plain caller-supplied
addresses and make up to 14 (resp. 25) external `view` calls to them via Solidity's high-level call syntax,
declared to return small static types (`(uint256,bool)`, `uint256`, `bool`). Solidity's generated calling
convention does **not** bound the `returndatacopy` to the declared return size — it copies the callee's full
`returndatasize()` before decoding, and the same applies on the revert-bubbling path. Empirically verified against
this repo's exact solc 0.8.24 pragma via a disposable Foundry test (deleted afterward): a malicious callee
returning 1,000,000 bytes from a function declared `returns (uint256, bool)` costs the caller ≈2,002,567 gas to
copy-and-decode; 5,000,000 bytes costs ≈48,153,934 gas — already exceeding a mainnet block gas limit — regardless
of the small declared return type.

**Proof of Concept:** Deploy a contract implementing `IWhitelistCurator.firstHourOf` (or any of the other four
read methods) whose body does `assembly { return(0, 3_000_000) }` instead of returning the expected tuple. Call
`Composer.directSnapshot(wallet, maliciousCurator, idmd)`; the first catalog id resolving to that function
(reached on the very first loop iteration of the 14) triggers the oversized copy and the whole call either reverts
out-of-gas or costs tens of millions of gas.

**Recommendation:** If `curator`/`idmd`/`registry` are ever meant to tolerate semi-trusted addresses, replace the
high-level calls with manual `staticcall` + `returndatacopy` bounded to the expected word count (or
`require(returndatasize() == expectedSize)` before decoding). Absent that, document clearly that these parameters
must always be pinned, trusted, non-upgradeable addresses — Composer performs no sanitization of their return
data size.

---

### [L-1] `validateSpec` trusts a caller-supplied `blockNumber` verbatim on mainnet instead of reading `block.number` itself

**Severity:** Low
**Confidence:** 65
**Location:** `validateSpec()`, `src/Composer.sol:203-204`, consumed at lines 251-261

On `chainid == 1`, `validateSpec` uses the `blockNumber` parameter exactly as supplied, with no comparison to
`block.number`. Any direct caller can pass `type(uint256).max` to make the finality-margin checks pass regardless
of the real chain height. The one known caller, `Registry.registerSpec` (`src/Registry.sol:659`, read for
context), always supplies its own correctly-read `block.number`, so the real registration flow is unaffected.
**Fix:** read `block.number` directly on the `chainid == 1` branch instead of trusting the parameter.

### [L-2] Catalog trait 1105's hardcoded window violates the 7,200-block minimum `validateSpec` enforces on every community spec

**Severity:** Low
**Confidence:** 70
**Location:** `_catalogSpec()`, `src/Composer.sol:112-117` (`fromBlock = B_DEPLOY = 25,769,870`,
`toBlock = B_FIRST1000 = 25,770,897`, a 1,028-block span — verified by direct computation); contrast with
`validateSpec()`'s window rule at `src/Composer.sol:255-260`

Catalog specs (`traitId < 10001`) are built by `_catalogSpec` and never run through `validateSpec` — `compose()`
has no call to it for either branch. Trait 1105's hardcoded window is roughly one-seventh of the 7,200-block
minimum every community spec must satisfy. Not attacker-reachable (the constants are hardcoded, not
caller-supplied), and both blocks are now deep in mainnet's past (≈2022), so the real-world finality concern the
7,200-block rule exists to guard against does not currently bite. **Fix:** either widen the constant or document
explicitly why catalog ids are exempt from the window rule community specs must satisfy.

### [L-3] Seven of the eight non-1301 catalog traits trust a caller-supplied `curator` address with no comparison against the hardcoded `MAINNET_CURATOR` constant

**Severity:** Low
**Confidence:** 60
**Location:** `_catalogSpec()`, `src/Composer.sol:80-131` (contrast trait 1301's hardcoding at line 127 and the
prose reference to `MAINNET_CURATOR` at line 512)

Trait 1301 ignores its `curator` argument entirely and hardcodes `address(0)` plus a literal reference to
`MAINNET_CURATOR` (line 38) in its question text. Every other catalog trait (701, 801/901, 1001, 1101-1105, 1201)
instead sets `s.target = curator` directly from the caller-supplied parameter, with no check against the same
constant. `catalogSpec()`/`compose()` are both `external` with no access control, so a direct caller fully
controls `curator` for these seven ids. The real caller, `Registry.sol` (out of scope, read for context), always
supplies its own immutable, constructor-set `curator`, so no exploit path was found through the deployed system.
**Fix:** either pin every catalog trait's target to `MAINNET_CURATOR` for consistency (as 1301 already does), or
document why the others are intentionally caller-configurable.

### [L-4] Kind-4 ("call-compare") questions hash `fromBlock` even though the rendered question text never mentions it

**Severity:** Low
**Confidence:** 55
**Location:** `question()` kind-4 branch, `src/Composer.sol:470-499`; `q.fromBlock` set unconditionally at line 369

The kind-4 template's question text (lines 472-499) only ever references `toBlock` ("At the last block of the
request's pinned window..."). `q.fromBlock` is nonetheless set from `s.fromBlock` and both `encodeBody()`
(612-615) and `canonical()` (641-644) hash it into the committed `window`. `validateSpec`'s only constraint on a
kind-4 `fromBlock` is the generic 7,200-block gap from `toBlock` (line 256) — unrelated to the question's actual
meaning. A registrant can therefore register two specs describing the identical real-world fact (same `target`,
`item`, `op`, `threshold`, `toBlock`) that differ only in an unused `fromBlock`, producing two different
`questionHash` values for what a reader of the rendered question would consider the same question. **Fix:** either
stop hashing `fromBlock` for kind-4 specs, or force it to one canonical value (e.g. `toBlock` minus the finality
margin).

### [L-5] Kind-3 "method" text instructs the panel to report more entries than the on-chain decoder will accept

**Severity:** Low
**Confidence:** 50 — the off-chain aggregation step may already trim the list before attestation; unconfirmed
**Location:** `question()` kind-3 branch, `src/Composer.sol:426-469` (method text at lines 460-468), contrasted
with `Registry._decodeAndJudge`'s exact-length requirement (out of scope, read for context only)

The composed kind-3 `method` definition reads *"...include positions beyond `{n}`, agreement is on the first
`{n}`"* — instructing the panel to return more than the `threshold` (`n`) ranked entries. The project's own
`Registry.sol` (read for context) requires the attested answer to contain **exactly** `threshold` addresses,
rejecting any other length. A panelist who follows the composed instruction literally would produce an answer
the chain rejects as a decode miss. **Fix:** align the composed wording with the on-chain decoder's exact-length
requirement.

---

## 3. Informational — investigated and found not to be bugs, or confirmed-but-inert

These items were raised by multiple independent agents during the blind hunting phases. Each is reported here,
with the verification that resolved it, rather than silently dropped — a finding a reader does not see is a
finding they cannot judge for themselves.

**[I-1] `canonical()` does not hash the `consumer` address — verified intentional, by design.** Three of twelve
depth agents, working independently, constructed the same observation: `encodeBody()` prints a `"consumer":
{"chainId":...,"verifyingContract":...}` object (`src/Composer.sol:594-597`) that `canonical()` (624-647) never
receives or hashes, so two `compose()` calls differing only in `consumer` produce different `body` bytes but an
identical `questionHash`. Direct verification against this repo's own `TEMPLATES.md` (line 186) and
`INTEGRATION.md` (section 4, lines 190, 276-277) confirms this is **documented, intentional design**: *"`consumer`
is excluded, so changing its chain does not change the canonical question hash."* The actual binding of an
attestation to one specific consuming contract happens through a **separate** mechanism — the EIP-712 domain
separator's `verifyingContract` field, computed independently by `Registry.sol` at signature-verification time
(`INTEGRATION.md` section 4, describing measured mainnet attestations that verify correctly under their own
domain and fail under a different one). This is exactly the kind of guard that interrupts a claimed exploit before
harm occurs: the questionHash intentionally binds only the *question's content*; a second, independent channel
binds the *consumer*. Downgraded from the agents' initial Medium/Finding-level framing to Informational.

**[I-2] The kind-5 "definitions" object exceeds the code comment's stated 512-byte bound — verified to be a
measurement/wording issue, not an enforced-invariant violation.** One depth agent, cross-checked independently
by hand (Python, computing the literal T5 template strings from the real source), confirmed the kind-5
`definitions` object is ≈941-968 bytes at minimum input — roughly double the figure in `compose()`'s own comment
("the door's bounds (question <= 1000, definition <= 512 bytes) hold by construction... the longest template
text (T3) stays under them," lines 354-355). However, direct review of this repo's own `TEMPLATES.md` (line 174)
states the real intended rule precisely: *"`definitions`: an object of ASCII strings, **each** at most 512
characters"* — a **per-value** bound, not a per-object one. Recomputing the four kind-5 values individually
(209, 435, 108, 143 bytes) confirms every one is comfortably under 512. The only bound this repository's own test
suite actually asserts (`test/Adversarial.t.sol:557`, `test_fuzz_maximalSpecRegistersComposesAndFitsTheBody`) is
`body.length <= 16_384` (the Intake's real `MAX_BODY_BYTES`), fuzzed across all five kinds including kind 5 at
`threshold = type(uint256).max`, and it passes. `Composer.sol`'s own inline comment (lines 354-355) is imprecisely
worded — a reader could misread "definition <= 512 bytes" as a total-object bound, as this audit's own depth
agent initially did — but no enforced invariant is actually violated. Recommend tightening the comment's wording
for clarity; not a security finding.

**[I-3] `mainnetHeightBound()`'s linear 12-second-slot estimate drifts from the true chain head over time — dead
code on the documented deployment.** Both breadth and depth passes flagged that `mainnetHeightBound()`
(`src/Composer.sol:266-269`) assumes zero missed slots since the Merge, so its estimate overshoots the real
mainnet head, eroding `validateSpec`'s finality margin. This substitution only fires when `block.chainid != 1`
(line 204). The documented, actual deployment (per `DEPLOYMENTS.md` and `Registry.sol`'s constructor, read for
context) is Ethereum mainnet only (chain id 1), where this branch never executes. Recorded for any future
non-mainnet deployment, not a live issue today.

**[I-4] `_topicOf` parsing edge cases (grammar-order-independent `"indexed"` matching, no nested-parenthesis
tracking, a parameter literally named `indexed` shadowing the keyword).** Three depth agents independently probed
`_topicOf()` (`src/Composer.sol:295-323`) for a false-positive (an attacker making a non-indexed or non-address
field appear to validate as one) and could not construct one — every attempt produced only false negatives
(a legitimately valid signature failing to validate), which is a usability gap, not a security gap. No finding.

**[I-5] All-or-nothing revert in `directSnapshot`/`traitsOf` on any caller-supplied target reverting.** No
`try`/`catch` exists in either loop; one reverting `curator`/`idmd`/`registry` call fails the whole invocation.
Architecturally unavoidable given the stateless design and not independently exploitable from Composer's own
trust boundary — the caller chooses these addresses. No finding.

**[I-6] Forward note for a Registry-side audit: gas-stacking risk if [M-3] is ever nested inside a larger
transaction.** If `directSnapshot`/`traitsOf` are called as one step of a larger Registry transaction (e.g. a
mint), [M-3]'s gas griefing could push that outer transaction over the block gas limit — flagged for whoever next
audits `Registry.sol`, since that is where the trust decision about `curator`/`idmd`/`registry` pinning actually
lives.

---

## 4. Invariant Verification

Candidate invariants from this job's own phase-0 pre-scan and context pass, each answered:

| ID | Property | On-chain enforced? | Verdict |
|---|---|---|---|
| I-A | Every `Spec` reaching `compose()` has passed `validateSpec()` | No (community path) | **Violated** → [M-1] |
| I-B | `"`/`\`/control bytes never reach the composed JSON output | Only via `validateSpec`'s charset, which `compose()` doesn't call for community specs | **Violated** → [M-1] |
| I-C | Every catalog `Spec` satisfies `validateSpec`'s rules | No — catalog path never calls it | **Violated** → [L-2] (window only; all other catalog fields hold, hand-verified) |
| I-D | `encodeBody()`/`canonical()` stay content-consistent on every shared field | Partial — T3's `evidence`/panel-sizing predicates differ (documented intentional divergence per `INTEGRATION.md`); `consumer` is excluded from `canonical()` by design, not a divergence bug | **Holds** (documented design) → see [I-1] |
| I-E | `q.keys` sortedness and `keys.length == values.length` are maintained by hand in every `question()` branch | Yes, by direct trace of all five branches | **Holds** |
| I-F | `_topicOf()` agrees between its two call sites (`validateSpec` and `question`'s T3 branch) | Yes — pure function, same inputs | **Holds** |
| I-1 (x-ray) | `canonical()`/`encodeBody()` serialize `q` consistently | Yes for all fields `canonical()` is defined to carry; `consumer`/`panelSize`/`quorum`/`validForSeconds` are intentionally excluded | **Holds** (documented) |
| I-2 (x-ray) | `compose()` is the only gate before a `Spec` reaches the serializers | No | **Violated** → [M-1], and further widened by [H-1] (validateSpec itself has a coverage gap) |
| I-3 (x-ray) | `hexMin()` output is consistent with other numeric renderings in the same document | Yes, hand- and Foundry-verified across `v=0`, powers of 16, `type(uint64).max` | **Holds** |
| I-4 (x-ray) | `_topicOf()` agrees with `validateSpec`'s own event-signature assumptions | Yes for kind 3 (the only kind it's checked for); **the absence of the same check for kind 1/2 is [H-1]** | **Holds for kind 3; gap is [H-1]** |

**Coverage:** 7 entrypoints, 7 addressed. 4 threat-catalog rows (actor × entrypoint × asset), 4 answered. 10
inferred invariants, 10 answered (6 hold, 3 violated and mapped to findings, 1 holds-as-documented-design after
re-examination). Coverage holes closed this pass: 0 (every row was examined by at least one phase).

---

## 5. Threat Catalog (from phase-0 context, answered)

| Actor | Reach | Could gain | Invariant | Resolution |
|---|---|---|---|---|
| Any address | `compose()` directly, bypassing Registry's validation gate, for a community `Spec` | A hash-bound "question" with unescaped/malformed content | I-A, I-B | Violated → [M-1] (Medium: real against the standalone contract, inert against the real Registry) |
| Any address | `directSnapshot`/`traitsOf` with a malicious `curator`/`idmd`/`registry` | Gas griefing via oversized returndata; an incoherent cross-call snapshot (latter is by-design, caller-trusting) | — | Violated (gas) → [M-3]; incoherent-snapshot is accepted design, no finding |
| Any address (registrant) | Register a count/sum spec whose `arg` doesn't name a real indexed field | A permanently unanswerable trait; any later requester's fee is lost | — | Violated → [H-1] |
| Any address | `compose()`/`catalogSpec()` for trait 1105 or any catalog id whose window violates the 7,200-block minimum | Composing a catalog question with a narrower-than-standard window | I-C | Violated, not attacker-reachable (hardcoded) → [L-2] |

---

## 6. Phase summary

**Phase 0 (context, opus):** built the access-control inventory, protocol map, and threat catalog above; identified
the central lead (`compose()` skipping `validateSpec()`) that later converged across both hunting phases.

**Phase 1 (breadth, 5 sonnet checklists):** general, precision-math, access-control, DoS, signatures. 2 checklists
(precision-math, access-control) returned clean with explicit verification, not absence of effort. 3 produced
findings, with the general and signatures checklists independently converging on the same root cause as Phase 0's
lead from two different angles (JSON-injection framing and hash-collision framing), and the DoS checklist
independently discovering [M-3] via an empirical Foundry repro.

**Phase 2 (depth, 12 sonnet agents — 9 single-specialty + 3 gap-hunter, blind to Phase 1, one pass, memory off):**
math-precision, access-control, economic-security, execution-trace, invariant, periphery, first-principles,
asymmetry, boundary, numerical-gap, trust-gap, flow-gap. The `compose()`/`validateSpec` gap ([M-1]) was
independently reconstructed with a working PoC by 6 of the 12 agents. [H-1] was independently found with full
proof by 2 agents (execution-trace, first-principles) and converged on as a lead by a third (boundary). The
consumer-not-hashed observation ([I-1]) was independently raised by 3 agents; the oversized-definitions
observation ([I-2]) by 1, cross-checked by this audit against `TEMPLATES.md` and the real fuzz test. No agent
found a Critical-severity issue, consistent with this being a stateless, fund-less, access-control-free contract.

**Reconciliation:** this report resolves 3 Phase-2 observations against the project's own documentation
(`TEMPLATES.md`, `INTEGRATION.md`) and test suite (`test/Adversarial.t.sol`) rather than taking blind-hunt severity
at face value — two were downgraded to Informational ([I-1], [I-2]) after confirming they are documented,
intentional design or a per-value-vs-per-object measurement artifact; one ([H-1]) was elevated above its
individual-agent framing after tracing its fee-loss consequence through the real Registry/Intake flow.

---

> ⚠️ This review was performed by an AI-orchestrated multi-phase audit pipeline. AI analysis can never verify the
> complete absence of vulnerabilities and no guarantee of security is given. Team security review, a bug bounty
> program, and on-chain monitoring are strongly recommended before relying on this contract's output for any
> value-bearing decision.
