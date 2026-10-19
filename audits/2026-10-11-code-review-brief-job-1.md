<!-- copied from the entrant's workspace on 2026-10-19; the repository was banse/chaintraits at the time -->
# Review brief: the chaintraits registry code, as built by the IMD swarm (job 1)

For an independent reviewer with no access to this workspace. Everything needed is public.

## Target

- Repository: `https://github.com/banse/chaintraits`, branch **`swarm/job-1`**, commit
  **`7a9307c9703a5303f599adc355914be6ac9dd5ee`** (clone with `--recursive`; the submodules are forge-std v1.9.7 and
  OpenZeppelin `cab19933`). `main` (`f6c52f9`) is the specification the code was built from; the branch adds two
  commits by the swarm: `6a9942e` (contracts, renderer, generator, 46 tests, README) and `7a9307c` (49 more tests
  including 11 mainnet fork tests, `test/NOTES.md`).
- The specification is the five documents in the repository root (`README.md`, `CONCEPT.md`, `CATALOG.md`,
  `TEMPLATES.md`, `INTEGRATION.md`). Where code and specification disagree, say which is wrong. The builder's
  declared deviations are in README.md, section "What was built, and where it deviates from the brief".
- Context the reviewer may read, not required: the two earlier brief reviews lived at
  `audits/chaintraits/2026-10-11/` (round 2, Codex); their dispositions were applied in `f6c52f9`.

## How the code was produced and what has been checked already

The IMD swarm built it in one paid job of three steps, each by a different seat (build, tests, adversarial review),
each accepted by the plane's verifier ("all checks passed"). The swarm's own review reported no high or medium
finding, three lows and one info; the tester added two infos. The entrant then verified independently:

- `forge build --offline`, `forge test --offline`: 81 tests pass; two invariant campaigns in
  `test/InvariantsExtended.t.sol` fail with an arithmetic overflow **in the handler** (`FullHandler.upgradeSponsored`,
  `(which + i) % catalogChain.length`), not in the contracts. Known, to be fixed in the continuation.
- `CHAINTRAITS_FORK_RPC=https://rpc.mevblocker.io forge test --match-path 'test/fork/*'`: 11 of 11 pass on mainnet
  at block 26,170,000, including a real `requestWithFailure` through Intake v2 followed by `complete` from the real
  writer (pranked) under the real 200,000-gas stipend.
- `python3 -I tools/gen_template.py --check`: 12 artifacts byte-exact.
- No `immutable` in any artifact; two deployments give identical runtime; Registry runtime 24,072 bytes (EIP-170
  limit 24,576), Composer 21,258, Renderer 11,333.
- The composer's onchain `questionHash` for a real wallet equals the plane's free quote for the same body.

Known findings (so the reviewer verifies rather than rediscovers them; all are listed with reproductions in the
plane's public record `https://api.imd.fun/jobs/27391f0e-0419-4d15-a5d5-bb182f137bd9/submissions`, `findings[]`):

| sev | where | finding |
|---|---|---|
| low | `src/Registry.sol:221` | the card collapses the non-tier Ordinal family (1101 to 1105) to its highest id |
| low | `src/Registry.sol:566` | `a.chainId == block.chainid` can only pass on mainnet (the question's chain is 1) |
| low | `src/Composer.sol:182` | `validateSpec` lets a T1/T2 spec have `fixedVal != 0` with an empty `fixedArg` |
| info | `src/Registry.sol:571` | `agreed >= quorum` required for chain evidence; the plane's protocol reference says chain evidence may be signed with `agreed` below quorum after the deployer's rerun |
| info | `src/Registry.sol:566` | reason codes: `chainId` is tested before the signer, INTEGRATION lists the signer first |
| info | `src/Registry.sol:642` | `nextSpecId` is a uint16: 55,535 community specs at most |

## What the review should establish

1. **Does the code do what the specification says, and only that?** Walk `onResult`, `onFailure`, `_check`,
   `_decodeAndJudge`, `_request`, `_clear`, `abandon`, `applySharedFact`, `upgrade`, `upgradeSponsored`,
   `claimSponsored`, `registerSpec`, `mintCard`, `_update`, `hasTrait`, `traitsOf`, `cardOf`, `tokenURI` against
   INTEGRATION.md section 4 (checks 1 to 9, reason codes, the transition table 4b), CATALOG.md sections 2 to 6 and
   CONCEPT.md's eleven invariants. Name every divergence, with the line.
2. **Can an attacker mark a trait that is not theirs, or stop a legitimate one?** Attestation replay across
   requests, consumers and chains; a writer pairing one claimant's answer with another's request (the
   `questionHash` binding, INTEGRATION check 7); malformed `answer` bytes (bool, uint256, the T3 `address[]`
   envelope); signature shapes (`tryRecover` errors, high-s, 64/66 bytes); the 200,000-gas stipend (cold storage
   worst case; the Intake never retries a failed callback); pending-slot griefing; stale callbacks after `abandon`.
3. **Can anyone take or lock IMD?** `upgrade` pulls `k x priceOf` and forwards each request; `maxPrice`; the pool
   is the balance and leaves only through `claimSponsored` / `upgradeSponsored` (catalog chain traits, once per
   pair, member, IDMD once per id, from day 30); reentrancy through the token (the mocks include a reentrant
   token); `forceApprove` to the Intake; what happens when `priceOf` becomes 0 or the Intake is retired.
4. **Is the card safe to render?** `Renderer` and `Composer` escaping of spec strings in JSON and SVG; charset
   guards in `validateSpec`; the Base64 and percent-encoding; the three goldens; whether a hostile spec `name` or
   `item` can break the data URI or inject markup.
5. **Launch constraints.** No `immutable` anywhere (including inherited); `bytecode_hash = "none"`,
   `cbor_metadata = false`; static constructor arguments only (seven addresses); EIP-170 headroom of the Registry
   (504 bytes today; the launch pipeline's adapt step may add code); the template offsets kept as ASCII hex because
   the launch's opcode scan reads non-PUSH bytes; `script/Deploy.s.sol`.
6. **The tests themselves.** Do the 95 tests test what their names say? Are the invariant handlers sound
   (`fail_on_revert = true`)? What is not covered? Which of the 41 tests of the 10-11 plan are missing?
7. **The specification.** Anything in the five documents the code shows to be wrong, ambiguous or unmeasured.

## Deliverables

- `review.md`: verdict; findings ranked B (blocker) / S (should-fix) / N (nit), each with location, reproduction
  and the consequence; answers to the seven questions; a disposition of the six known findings (confirmed,
  reinterpreted, or not reproducible).
- Adversarial tests: Foundry tests in the reviewer's own clone (`test/review/*.t.sol`), hermetic (`ffi = false`,
  no RPC unless `CHAINTRAITS_FORK_RPC` is set), each named for the property it attacks; a failing test is a
  finding, a passing one is evidence. The network guard of the earlier work applies: no external connection
  except the clone and, if used, the one fork RPC.
- `verification.md`: commands, exits, versions, what was not run.

## Constraints

- Public facts only. The fork tests name three public contributors of THE LIST (the first, the 1,000th and the
  last to join); use those or synthetic addresses (`0x…c1a1`), never other wallets.
- Nothing is paid, nothing is sent to the plane except reads of public routes; no transaction.
- Do not edit the reviewed branch; put new tests and notes in the reviewer's own files.
- The product has no name yet; "chaintraits" is the repository name, "the registry" the working title.
