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
  6.9 IMD, excluding gas. Construction checks the Curator's settlement and the Intake's nonzero action/IMD quote
  by passive view reads. The deployer must verify the configured addresses and helper code; these checks do not
  guarantee future Intake availability or prices, and the Registry has no administrator to repair dependencies.

- Free claims also attempt the IMD burn rule through BurnExecutor V2
  (`0xe29386719C155B6847aD5a4E97C6674f10ffc750`), using its own waiting IMD. At least 69 IMD and a quote no greater
  than 0.005 ETH requires the claimant to provide the native fee. The executor pays LayerZero and force-refunds
  surplus; paid upgrades are unchanged. A failing executor never blocks a claim solely because a preview or
  bridge reverted: the registry skips it and returns attached ETH. Insufficient fee and a claimant rejecting a
  nonzero registry refund still revert the claimant's transaction, including its oracle request and allowances.
- The 200,000 preview cap and 800,000 CALL gas argument (plus value stipend) bound cost, not burn liveness. At the
  pinned mainnet block 26,202,203 the executor catches an internal quote failure under the preview cap and returns
  zero, so the registry skips despite IMD waiting. The tests record that outcome and separately exercise the real
  executor/OFT exact-fee and forced-surplus paths. There is no guarantee that every free claim burns tokens.
- The registry's eighth argument is fixed ordinary storage; zero disables the burn rule for Sepolia. The
  executor's owner can change its token, OFT, destination, options and minimum, and can rescue funds. The OFT and
  LayerZero have configuration authorities too. These are owner-configurable external dependencies, not registry
  administration. They may call the claimant; the registry retains its reentrancy guard and makes no promise
  that all dependency callbacks are impossible.
- A successful `BurnTriggered` records an Ethereum bridge submission. **The Base burn is asynchronous** and still
  depends on message delivery and the configured receiver. Operators must monitor dependency configuration and
  eventual delivery/burns. The fork tests exercise the source-chain send and refunds, not Base execution.
