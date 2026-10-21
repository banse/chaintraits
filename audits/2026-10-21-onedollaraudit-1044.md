# One Dollar Audit, job 1044: dispositions

**Date:** 2026-10-21. **Reviewed target:** `src/Renderer.sol` at commit `832cc45f59acdda805b51799647be24c0cae9741`
(github.com/identity-md-launches/launch-2341-renderer-composer-registry), deployed as the Renderer
`0x4c7fe2202b29c23b54bd45053a6c88061f1296ef` on Ethereum mainnet (swarm launch #2341, 2026-10-20, `DEPLOYMENTS.md`).
**Reviewer:** One Dollar Audit (onedollaraudit.com, LeftClaw Services), automated multi-agent pipeline (x-ray pre-scan,
3 context agents, breadth checklists, 12 blind depth agents, reconciliation), commissioned by the entrant for 1 USDC on
Base (x402, EIP-3009), job 1044 complete 2026-10-21 04:11:01 UTC after 4 h 31 min of pipeline time. **Report:**
`2026-10-21-onedollaraudit-1044.report.md` (verbatim; sha256 `3ddfdd4a7d5d4f2af0cf32786e1c0e953a44b720869ad36a352923910a82b23e`), IPFS `bafkreib537ouu7k5j4vpbtzspbxbyduvhjcloiegtljwunjjeoiqvavshy`,
HTML https://leftclaw.services/result/1044.html. The third and last of the three audits of launch #2341 (1042 Registry,
1043 Composer).

**Verdict:** 0 critical, 0 high, 3 medium, 5 low, 8 informational. The Renderer is a stateless view contract with no
funds, no storage and no access control; every finding needs either a caller who supplies a registry of its own (and
harms only its own call) or an implausible economic state. The cheap hardenings go into the next cut (`docs/V3.md`
items 15 and 34); the user-facing summary for the live deployment is in `DISCLOSURE.md` ("Limits of this deployment").

# Disposition (the entrant, 2026-10-21)

States: **accepted as designed** (a decision written down; no change), **this cut** (a change in `docs/V3.md`, built
before the next deployment), **noted** (no defect, or documentation).

| Finding | State | Disposition |
|---|---|---|
| M-1: `_meta`'s hand-rolled parse of the `specOf` reply checks only the total length; a non-conforming registry can force an out-of-gas revert or an out-of-buffer read into the returned JSON | this cut | Reachable only when `tokenURIOf` is called with a registry the caller chose; the real Registry forwards `Composer.catalogSpec`'s encoding verbatim, so the deployed pair never hits it, and the Renderer holds no state. Still cheap to close: `docs/V3.md` item 34 bounds `head` and `nameAt` against the reply's data region before any read (the auditor's diff), or decodes `specOf` through the typed ABI. |
| M-2: `cardOf` copies the whole `verifiedSpecsOf` array before capping what it prints; at ~124,000 verified community specs a claimant's `tokenURI` becomes unreadable | accepted as designed | Each entry needs a registered spec (6.4 IMD, burned) and a verification the claimant pays (the Intake price, 0.5 IMD on 2026-10-21): 124,000 entries cost that claimant about 62,000 IMD in oracle fees alone, and every spec must have been answered true by the swarm. `docs/V2.md` item 19 bounds `tokenURI` at the maximum state the tests exercise (32 specs, 10,317,448 gas). Stated in `DISCLOSURE.md` (item 21); a count-and-page view is the next-cut candidate if the number ever matters. |
| M-3: `tokenURIOf` with a self-controlled registry returns a well-formed tokenURI with "verified" language for fabricated data; the output names no registry | accepted as designed, documented | The collection's `tokenURI` always calls `renderer.tokenURIOf(address(this), id)`; a direct call with another registry is a preview of that registry's facts, which the site uses on purpose (a wallet without a card, `docs/SITE.md` S-6). The output is a rendering, not a credential: `hasTrait(wallet, id)` on the Registry is the credential (site principle 4; `CONCEPT.md` section 3), and a screenshot could always be faked. Item 20 puts the sentence into `tokenURIOf`'s NatSpec and `README.md` "How to verify a card"; embedding the registry address in the JSON is the next-cut candidate. |
| L-1: `cardOf` indexes the 13-slot family array from an unchecked trait id (a compiler panic on a foreign registry) | this cut | Item 34: the `fam < 1 || fam > 13` check `traitName` already has; unknown ids are skipped. |
| L-2: no cap on the trait ids that trigger `_meta` sub-calls (the catalog has 25) | this cut | Item 34: `cardOf` reads at most 25 catalog ids. |
| L-3: the raw `specOf` reply is copied whole before any length check | this cut | Item 34: the copy is bounded to the words `_meta` reads (or the typed decoder). |
| L-4: the Renderer hardcodes the panel minima (11/7 for kinds 3 and 5) that the Registry also encodes | this cut | Item 15 already renames family 6 as a panel family; it now says explicitly that the Renderer's `minPanelSize`/`minQuorum` literals cover kinds 3, 5 and 6 (11/7) and 1, 2, 4 (5/3), and a test cross-checks them against the Composer's constants so they cannot drift. |
| L-5: `escapeJson` leaves the single quote unescaped although its comment extends the threat model to markup a viewer pastes into | this cut | Item 34: `'` joins the escaped set (`'`); the goldens with a hostile name are regenerated. |
| I-1 `traitsOf` order trusted | noted | The Composer's `traitsOf` is ascending by construction; the family's top id is taken as the last seen (the lowest for PID), which the goldens pin. |
| I-2 `SLOTS`/`SLICES` literals | noted | Generated with the tables by the generator (`--check` fails on drift). |
| I-3 `traitName(1105)` reads "First thousand" | accepted as designed | The owner's name table (`CATALOG.md` section 7: 1105 keeps `First thousand`; it is a window fact, not a tier of the PID ids). |
| I-4 revert bubbling differs across the five registry calls | noted | Fail closed either way; a reverting registry reverts the render. |
| I-5 a community trait's displayed name is not checked against what the spec proves | accepted as designed | The name is the registrant's label (`CATALOG.md` section 5); the proof is the spec body, readable through `specOf(id)` and listed in the oracle record. |
| I-6 `tokenURIOf`'s open `registry` argument | noted | Deliberate (M-3). |
| I-7 bytes ≥ 0x7F pass `escapeJson` unvalidated | noted | Spec strings are ASCII by the registration charset; the renderer-only hostile golden covers the escaping path. |
| I-8 `pragma 0.8.24` emits PUSH0 | noted | The deployment chains are Cancun (mainnet, Sepolia). |
