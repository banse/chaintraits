# Local Mint Facts simulation

This runs the current Fact Check frontend against an isolated Anvil chain and a
deterministic, delayed oracle panel. Open **http://127.0.0.1:8812/#/request**.
Port 8811 remains the mainnet-connected preview. A second, independent delayed
simulation runs at **http://127.0.0.1:8813/#/request**.

The badge always identifies this as **LOCAL SIMULATION — NOT PROOF**. The wallet
is a local test provider. Its IMD, ETH, history, agents, and signatures are test
data. No wallet extension or external RPC/API request is used by this page.

## Start

From `sworn-fact-check-site/web`:

```sh
npm run build
node simulation/build.mjs
node simulation/server.mjs --port 8812
```

To build and start the separate delayed instance without resetting port 8812:

```sh
node simulation/build.mjs --root simulation/.runtime-delayed
node simulation/server.mjs --port 8813 --root simulation/.runtime-delayed --profile delayed
```

Each server starts its own Anvil process on a free loopback port. Use a distinct
runtime root and HTTP port for each running instance. The build also snapshots
the mock wallet shim into that root. The delayed profile is reapplied after
“reset chain”; changes in its controls do not change the other instance's chain,
wallet selection, oracle records, or settings.

The `delayed` profile uses these waits:

| Step | Seconds |
| --- | ---: |
| Gas-estimation preflight | 2 per estimate |
| Mock wallet confirmation | 3 per submission |
| IMD approval mining | 5 |
| Fact transaction mining | 6 |
| Swarm admission | 12 |
| First agent answer after admission | 8 |
| Between individual agent answers | 2 |
| Signed result after quorum | 12 |
| Delivery submission after result | 10 |
| Delivery / Registry transaction mining | 6 |
| Card artwork read | 4 per read or multicall batch |

The mock wallet returns no transaction hash until its confirmation wait ends.
After submission it returns the real local hash immediately, while its receipt
stays pending until the mining delay ends. Read delays affect gas estimation and
artwork only; normal receipt polling and history reads remain responsive. Artwork
latency also applies to previews and initial card reads, not just the final card.

Requires the existing web dependencies and `~/.foundry/bin/anvil` (or `ANVIL`
pointing to a local binary). Build and runtime need no network. The build compiles
the current Solidity source with solc 0.8.24 and fails unless Registry, Composer,
and Renderer match the runtime hashes pinned by the frontend. Public dependency
sources are vendored; their origins and hashes are recorded in `provenance.json`.

The generated `.runtime/` is ignored. Rerun `node simulation/build.mjs` after a
frontend build to refresh the simulated site. Stop the server with Ctrl+C; its
Anvil child stops too. Restarting or choosing “reset chain” clears local results.

## Manual test

1. Open the local simulation controls at the top of the page.
2. Select wallet **B · cardless, nonce 25** to reproduce a fact request without a
   card. Wallets A and C already have cards; D has no historical qualifying facts.
3. Set the next answer and delivery mode, and expand the delay controls if needed.
4. Connect **Mock wallet (local)**, select Pretrained / 1301 on Mint Facts, approve
   test IMD, and request the fact.
5. Watch Transaction, Swarm request, individual agents, signed result, delivery,
   and the final Registry result on Fact Check.

Each transaction freezes its settings when the mock wallet receives it, before
wallet confirmation or mining. Read operations capture settings when received.
Changing controls affects subsequent operations only. With delivery `hold`,
the signed result waits until “Release delivery.” With `starved`, the local Intake
callback runs out of gas. Its receipt honestly reports `delivered=false`; “Recover
callback” subsequently calls the real Registry `settle` with the same signed
attestation. A failed callback is never reported as a stored fact.

## Local controls

`GET /__mock__/state` returns readiness, wallets, settings, and records. Records
include the oracle UUID, Registry request ID, originating transaction/block,
frozen configuration, stage timestamps, and actual delivery/recovery receipts.
`instance` identifies the profile, runtime root and owned loopback RPC.
`transactions` retains wallet-confirmation, submission and receipt timestamps
for the latest 50 local wallet calls.

`POST /__mock__/state` accepts the following JSON fields. Changes are limited to
the loopback test environment; browser writes require the same origin.

| Field | Values / meaning |
| --- | --- |
| `reset` | `true` recreates the local chain and sample wallets |
| `active` | One of the four addresses returned by `wallets` |
| `nextAnswer` | `auto`, `true`, `false`, `split` (no quorum), `stall` |
| `delivery` | `normal`, `hold`, `starved` |
| `preflightSeconds` | Delay for each `eth_estimateGas` preflight |
| `walletSeconds` | Mock wallet confirmation delay before a transaction is sent |
| `approvalSeconds` | IMD approval mining delay; `null` inherits `transactionSeconds` |
| `transactionSeconds` | Delay before the wallet transaction is mined |
| `pickup` | Delay before API admission becomes visible |
| `firstAnswerSeconds` | Delay after admission before the first answer |
| `answerEverySeconds` | Interval between individual agent answers |
| `attestAfterSeconds` | Delay from quorum to signed result |
| `deliverAfterSeconds` | Delay from signed result to delivery submission |
| `registrySeconds` | Delay before the delivery transaction is mined |
| `artworkSeconds` | Delay for Registry/Renderer artwork reads, including Multicall3 batches |
| `speed` | Agent-answer pace multiplier; prefer 1 with explicit intervals |
| `releaseDelivery` | Oracle UUID whose held signed result should be submitted |
| `recoverDelivery` | Oracle UUID with an attempted but failed callback |
| `advanceBlocks` | Mine 1–1000 blocks, only with no pending transaction |
| `advanceDays` | Advance the local chain clock by up to 400 days |
| `exactIntake` | `false` simulates an unreadable admission endpoint |
| `failHistory` | `true` simulates unavailable synthetic historical logs |

All timing fields accept 0–600 seconds, including fractional seconds.
`releaseDelivery` and `recoverDelivery`
use the oracle UUID (`oracleId`), not the Registry's bytes32 `requestId`.
Transaction submission returns a hash immediately; the receipt stays absent until
the scheduled mining time. Intake completion and Registry callback execute in
the same EVM transaction. There is no invented delay between those two events.
No-quorum results also wait for delivery submission and receipt; callback recovery
uses the same configured Registry mining delay. Reset cancels pending reads,
wallet confirmations and mining waits. Concurrent reset requests are refused;
clock/block advancement is refused while a transaction is waiting to be mined.

## Verification

```sh
node --test simulation/tests/*.test.mjs
# Against the running simulator; resets its synthetic state:
node simulation/tests/lifecycle.mjs
# Full current-frontend browser flow (owned by the frontend test suite):
node tests/fact-mint-simulation-e2e.mjs
```

Verification on the separate delayed instance (resets **8813 only**):

```sh
node simulation/tests/delayed-controls.mjs http://127.0.0.1:8813
node simulation/tests/lifecycle.mjs http://127.0.0.1:8813
SWORN_SIM_URL=http://127.0.0.1:8813/ SWORN_SIM_PROFILE_TIMING=1 \
  SWORN_SIM_OUTPUT=delayed-instance node tests/fact-mint-simulation-e2e.mjs
```

Browser coverage includes cardless and card-owning wallets, false answers,
no quorum, held delivery and failed callback recovery. It checks observed wait
times, agent IDs, reload continuity, pending receipts, actual Registry events,
and that no browser request leaves the simulator.

The lifecycle integration test verifies settings freezing, held delivery,
`Completed.delivered=true` plus `Verified`, a gas-starved callback with no
`Verified`, signed local recovery through `Registry.settle`, and a reset while a
request is pending without leaking its receipt into the replacement oracle. Browser tests
exercise the user-facing flow and retain their own screenshots and evidence.

## Fidelity and boundaries

This adapts the existing `tools/surf/sworn-local` diagnostic workflow using bounded
source imports. It runs the real pinned Registry/Composer/Renderer bytecode with
real EVM state changes, signed attestations, callbacks, receipts, and rendered
card data. The local chain deliberately uses chain ID 1 and the pinned addresses
so the current deployed frontend executes unchanged. The local signer differs
from production. Intake, token, curator, and market dependencies are stand-ins;
pre-genesis facts and oracle members are synthetic.

It is distinct from `bin/imd-swarm-test contract-oracle`, whose native-runner
adapter requires chain 31337. No native Codex oracle workers, production relayer,
mainnet transactions, or paid IMD jobs are run here. Passing these tests proves
the local UI/contract lifecycle only; it does not authorize payment or establish
mainnet delivery health.
