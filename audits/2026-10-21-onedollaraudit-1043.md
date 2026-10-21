# One Dollar Audit, job 1043: dispositions

**Date:** 2026-10-21. **Reviewed target:** `src/Composer.sol` at commit `832cc45f59acdda805b51799647be24c0cae9741`
(github.com/identity-md-launches/launch-2341-renderer-composer-registry), deployed as the Composer
`0x1d7da5353830248b042fc1396d5d12c31ac69824` on Ethereum mainnet (swarm launch #2341, 2026-10-20, `DEPLOYMENTS.md`).
**Reviewer:** One Dollar Audit (onedollaraudit.com, LeftClaw Services), automated multi-agent pipeline (x-ray pre-scan,
context, 5 breadth checklists, 12 blind depth agents, reconciliation), commissioned by the entrant for 1 USDC on Base
(x402, EIP-3009), job 1043 complete 2026-10-21 00:56:37 UTC. **Report:** `2026-10-21-onedollaraudit-1043.report.md`
(verbatim; sha256 `a8f782fb54dcc22a59d875701b510f806fcd4a4e9d6b9d2570e4812fc29685c5`), IPFS `bafkreifi66bpwvg4yivftwdvoanvcd4an7guutu5noosk4heqex4ffufyu`, HTML
https://leftclaw.services/result/1043.html. Companion job 1044 (Renderer) was still in progress when this was written.

**Verdict:** 0 critical, 1 high, 3 medium, 5 low, 6 informational. The Composer is a stateless view contract with no
funds and no access control; the one high is a registration guard that is missing, and it goes into the next cut
(`docs/V3.md` items 31 to 33) before that cut is paid. The user-facing summary for the live deployment is in
`DISCLOSURE.md` ("Limits of this deployment").

# Disposition (the entrant, 2026-10-21)

States: **accepted as designed** (a decision written down; no change), **this cut** (a change in `docs/V3.md`, built
before the next deployment), **noted** (no defect, or documentation).

| Finding | State | Disposition |
|---|---|---|
| H-1: `validateSpec` never checks that a kind-1/2 spec's `arg`, or any `fixedArg` / `sumArg`, names a real (indexed) parameter of the event; such a spec registers and can never be answered, and every request about it loses its fee | this cut | `docs/V3.md` item 31: for kinds 1 and 2 `arg` must be an indexed `address` parameter of `item` (the claimant filter), `fixedArg` when set an indexed parameter of `item`, `sumArg` (kinds 2 and 3) a parameter of `item`; `BadSpec("arg")`, `BadSpec("fixedArg")`, `BadSpec("sumArg")` before the fee; the site's community form checks the same before the transaction. Live deployment: a registrant can still register such a spec there; `DISCLOSURE.md` says so, and no such spec exists (no community spec is registered on 2026-10-21). |
| M-1: `compose()` does not validate a community `Spec`; a direct caller can inject `"` into the composed body and hash | accepted as designed | `compose` is a view that returns its output to the caller and changes nothing; the only integration, `Registry.registerSpec`, validates every spec before it is stored, and `Registry.composeBody` / `upgrade` pass only stored specs. A direct caller corrupts a document that nobody signs or stores. Written into `INTEGRATION.md` (item 20): the Composer's views trust their arguments. A re-validation inside `compose` costs bytes the Composer does not have (955 under EIP-170 before the kind-6 texts of item 12). |
| M-2: the `item` charset admits ordinary prose that `compose()` prints verbatim into the question an LLM panel reads | this cut | `docs/V3.md` item 32: `item` must parse as a minimal signature (`event Name(type [indexed] name, …)` or exactly `function name(address) view returns (uint256)`), identifiers at most 32 bytes from a closed type list, nothing outside the grammar, `anonymous` refused for every event kind (an anonymous event has no topic 0, so the T1/T2 method's topic filter is wrong for it too); the audit's two proof strings are regression tests. The panel is a set of LLM agents (the entrant's own seats are three of them), so the injection path is real, not hypothetical. |
| M-3: caller-supplied `curator` / `idmd` / `registry` can grief `directSnapshot` / `traitsOf` with oversized return data | accepted as designed | The Registry passes its own constructor-pinned addresses (immutable in effect: ordinary storage set once, no setter); a direct caller of the Composer chooses the targets and griefs only its own call. Written into `INTEGRATION.md` (item 20). `idmd` leaves the signature in this cut (item 7). |
| L-1: `validateSpec` trusts its `blockNumber` argument on mainnet | this cut | `docs/V3.md` item 33: on chain 1 `validateSpec` reads `block.number` itself; the argument counts off mainnet only. The Registry already passed `block.number`. |
| L-2: catalog trait 1105's window (1,028 blocks) is below the 7,200-block minimum community specs must meet | accepted as designed | The catalog windows are frozen anchors of the Curator's history (`CATALOG.md` section 1); `W_FIRST1000` is the first-thousand window by definition and ends at block 25,770,897, deep in finality. The community minimum guards registrations near the head, which no catalog window is. Written into `CATALOG.md` section 5 (item 20). |
| L-3: catalog traits take the caller-supplied `curator` as target; 1301 hardcodes the mainnet address in its text | accepted as designed | `docs/V2.md` item 17 chose the Registry's `curator` argument so a test chain's mocks compose; the question text names `MAINNET_CURATOR` because every question is about Ethereum mainnet (`INTEGRATION.md` section 1). The Registry passes its pinned curator; a direct caller composes a document nobody signs. |
| L-4: kind-4 questions hash `fromBlock` though the text names only `toBlock`; two specs for one fact can differ in hash | accepted as designed | Each spec is its own paid registration (6.4 IMD); a duplicate costs its registrant, nobody else, and the hash binds the window the panel is told. Noted in `TEMPLATES.md` T4 (item 20). |
| L-5: the kind-3 method says "include positions beyond `<N>`" while the Registry accepts exactly `<N>` addresses | noted | The sentence instructs the panel's working, not the answer: the plane's log-rank recipe returns the first `head` entries (the stored 1201 answer of the live registry has exactly 32, `SharedFactStored(1201, …, 32)`), and agreement is on those. The text stays byte-exact (item 14). |
| I-1 `consumer` outside the canonical document | noted | Intentional; the EIP-712 domain binds the consumer (`INTEGRATION.md` section 4). |
| I-2 the comment's "definition <= 512 bytes" reads as a per-object bound | noted | The rule is per value (`TEMPLATES.md`); the comment is reworded in this cut (item 33). |
| I-3 `mainnetHeightBound()` drift off mainnet | noted | Documented in `INTEGRATION.md` section 1; dead on the mainnet deployment. |
| I-4 `_topicOf` edge cases produce false negatives only | noted | A usability limit; item 32's grammar makes the parse exact. |
| I-5 all-or-nothing revert on a reverting target | accepted as designed | Fail closed (site principle 2). |
| I-6 forward note: M-3 nested inside a mint | noted | The Registry's targets are pinned; see M-3. |
