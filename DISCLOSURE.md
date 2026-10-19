# Disclosure

- The entrant operates three IMD worker seats (IDMD #420, #3 and #7). They may be assigned any swarm job on this
  repository; the entry says so, and the seats are not excluded onchain, because an onchain list would name wallets.
- The entrant's seats and wallets abstain from the sponsor pool's upgrades and never appear in a showcase, a
  screenshot or a demo. Sample cards use synthetic addresses (the convention `0x…c1a1`) or public figures.
- The registry is Sworn (collection symbol SWORN). It has no owner, no upgrade path, no pause and no fee switch.
  There is no token.
- Every oracle question the registry sends is paid by the claimant (or the sponsor pool) through the Intake; the
  entrant earns nothing from it.
- Sponsor-pool money (mint fees, spec fees, `sponsor`, plain transfers) is an irrevocable donation: no one, the
  entrant included, can withdraw it; it is spent only on members' own catalog traits through the Intake, and a remainder
  below the Intake's price stays in the contract.
- IDMD holders who are list members may draw one catalog chain request per UTC day, nine per token and nine per
  wallet over a lifetime. Every list member likewise has one per day from launch, with no 30-day wait. The two
  paths share the wallet's daily allowance and once-per-trait lifetime usage; token transfers do not reset a
  token's nine-request counter. Each accepted request spends its allowance regardless of the oracle outcome.
  Paid upgrades and shared-fact requests have no pool daily or lifetime limit.
- Spec registration costs 6.4 IMD into the pool; at the 0.5 IMD oracle price, a spec plus its first claim costs
  6.9 IMD, excluding gas. Construction checks IDMD code, the Curator's settlement and the Intake's nonzero
  action/IMD quote by passive view reads, and code at a nonzero executor. Those dependency checks are skipped
  only when all four of Curator, IDMD, IMD and Intake lack code: the pipeline's empty-chain floor. The seven
  nonzero-address checks still apply. A successful floor probe does not establish operational readiness.
  The deployer must verify the configured addresses and helper code; these checks do not guarantee future
  Intake availability or prices, and the Registry has no administrator to repair dependencies.
- After 14 days, a personal pending request may be abandoned only by its stored claimant, including sponsored
  requests; a shared fact may be abandoned by anyone. The price and sponsored allowances are never returned.
  Every oracle question remains about Ethereum mainnet (chainId 1); the consumer domain uses the deployment chain.

- Free claims also attempt the IMD burn rule through BurnExecutor V2
  (`0xe29386719C155B6847aD5a4E97C6674f10ffc750`), using its own waiting IMD. At least 69 IMD and a quote no greater
  than 0.005 ETH requires the claimant to provide the native fee. The executor pays LayerZero and force-refunds
  surplus; paid upgrades are unchanged. A failing executor never blocks a claim solely because a preview or
  bridge reverted: the registry skips it and returns attached ETH. Insufficient fee and a claimant rejecting a
  nonzero registry refund still revert the claimant's transaction, including its oracle request and allowances.
- The preview runs with `PREVIEW_GAS` = 600,000 gas: the executor answers zeros, not a revert, when its inner OFT
  quote runs out of gas, which a measurement on 2026-10-16 placed below about 272,000 gas at the CALL (block
  26,202,500; a cold trace at block 26,202,203 needs 264,408). The earlier 200,000 cap read zeros on mainnet and
  never burned. At the pinned block 26,202,203 the corrected preview returns the real quote and the fork test's
  cold sponsored claim burns through the real executor and OFT. The rule stays best effort: a future quote
  needing more than 600,000 gas or above the 0.005 ETH cap is a skip, and there is no guarantee that every free
  claim burns tokens.
- A claimant should attach exactly the fee quoted by `previewBridge()` in the same block: the executor re-quotes
  when it bridges and keeps the whole attachment if its quote rose; only the part above its own quote comes back.
- Outside the all-four-empty floor, the constructor rejects a nonzero executor address without code
  (`ExecutorHasNoCode()`): the preview's three
  return words are decoded outside the registry's `try`/`catch`, and an executor returning nothing would revert
  every sponsored claim for ever in a registry nobody can repair. A coded executor that returns fewer than three
  words still reverts a claim; that residual is accepted rather than adding a low-level call.
- The registry's eighth argument is fixed ordinary storage; zero still disables the burn rule at contract level,
  but both launch sets use nonzero executors. Sepolia uses V1 `0x097A19e0f021BBA5072701132625ad2401043A2E`, whose
  reverting preview skips with code 1; the launch manifest rejects zero. The executor's owner can change its token, OFT, destination, options and minimum, and can rescue funds. The OFT and
  LayerZero have configuration authorities too. These are owner-configurable external dependencies, not registry
  administration. They may call the claimant; the registry retains its reentrancy guard and makes no promise
  that all dependency callbacks are impossible.
- A successful `BurnTriggered` records an Ethereum bridge submission. **The Base burn is asynchronous** and still
  depends on message delivery and the configured receiver. Operators must monitor dependency configuration and
  eventual delivery/burns. The fork tests exercise the source-chain send and refunds, not Base execution.

## Audits

The reviews of this code and the disposition of every finding are in `audits/README.md`; the One Dollar Audit of the
deployed v1 Registry (2026-10-19: 1 high, 5 medium, 7 low) is `audits/2026-10-19-onedollaraudit-1033.md`. v1 stays
deployed as it is; the fixes go into a v2 redeploy, tracked in the issues.
