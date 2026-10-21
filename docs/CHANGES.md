# Changes this tree needs

This tree is the swarm's build of `docs/REBUILD.md` as it stood at rebuild-base `f0739cd8` (swarm job 00b86a67, commit
`4255293d`). The plane's verifier accepted it (tests and Slither) and the swarm's adversarial review found no defect.
Since then the specification gained decision D9 (`docs/REBUILD.md` section 12, from a three-pass audit of this very
tree) and a static-analysis rule (section 6). This file lists every difference. Bring the code to the current
`docs/REBUILD.md` with these changes and nothing else: every other rule is already met and its tests already pass.

1. **`settle` waits for the Intake** (3.4). `settle` runs only when Intake v2's public getter `requests(requestId)`
   (returns `payer, callbackTarget, callbackSelector, completed`) reports `completed == true`; otherwise it reverts
   `NotSettleable(requestId, 11)`. Reason 11 joins the reason codes. Tests: section 7 item 18.
2. **The panel check is exact** (3.4, check 5). `a.panelSize` and `a.quorum` equal the kind's panel and quorum
   (5 / 3 for kinds 1, 2, 4; 11 / 7 for kinds 3, 5, 6) and `a.quorum <= a.agreed <= a.panelSize`; otherwise reason 5.
   Tests: item 8.
3. **Kind-3 list entries** (3.4, check 9). Every entry of a shared-fact list is at least `2**80`; otherwise reason 9.
   Test: item 9 (the answer of `templates/fixtures/negative/1201-grouped-by-data-field.json`).
4. **Every event parameter is named** (3.6). `type,`, `type indexed,`, `type indexed)` and a parameter named `indexed`
   revert `BadSpec("item")`, so the topic position and the three-indexed limit count every indexed parameter.
   Tests: item 10.
5. **Typed spec fields** (3.6). `sumArg` names a parameter of type `uint8` to `uint256` (otherwise `BadSpec("sumArg")`);
   `fixedArg` names an indexed parameter of a static value type, never `string`, `bytes` or an array (otherwise
   `BadSpec("fixedArg")`). Tests: item 10.
6. **Early abandon of a completed request** (3.7). The stored claimant may abandon a personal request at once when the
   Intake reports it completed while it is still pending here; a shared fact keeps the 31 days. Tests: item 2.
7. **The T2 units text is fixed** (4.1). `definitions.units` of a T2 body is the text of `TEMPLATES.md` for every spec;
   the spec's `sumArg` fills only the places `TEMPLATES.md` marks. Test: item 11 (a T2 body with `sumArg` `weightAdded`).
8. **Static analysis** (section 6). Slither reports no High-impact finding after these changes; the tree passes today,
   so keep it that way: no `abi.encodePacked` of two or more strings, no shift of a constant by a variable.

Keep: the size budget (the three runtimes together at most 69,800 bytes; 60,255 today), the Glamsterdam rule of 3.11
(a delivery writes no slot that holds zero before it), every existing test green, the fixtures and the
`questionHash`es byte for byte. Record one line per change in `test/NOTES.md`, and bring `README.md`, `DISCLOSURE.md`
and the documents of section 10 up to date.
