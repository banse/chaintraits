# Mainnet runtime and transaction integration

Owned implementation: the new `sworn-mainnet-site/web` entrypoint, wallet UI, App shell, transaction/claim/Swarm views, request history and the controller/model files listed below. The existing mockups were not edited. Original production behavior was compared with the pinned frontend source `55475816f2b5d548a3e89a9a4042b02539ced51b` retained in this report's `evidence/upstream/web/`.

## Changes

- `main.tsx` no longer installs the global mock boundary or substitutes the mock explorer. Bundled, validated deployment assets select Ethereum and its real explorer.
- `wallet.tsx` restores the original EIP-6963 injected discovery, injected wallet connector, Coinbase connector, deployment RPC transport, mobile links and selected live provider. It retains the revised shared switch-network control.
- `App.tsx` removes mock controls and describes mainnet read state, while preserving Mint / Mint Card / Mint Facts / Mint Rule, Docs, the revised layout and progress placement.
- `transactions.tsx` is now the transaction view and a compatibility export for existing callers. `controllers/transactions.tsx` owns preparation, consent, preflight, submission, receipt/replacement recovery and result recording. It preserves the no-auto-resend behavior and delayed-wallet recovery from the revised UI.
- `models/transaction-journal.mjs` encodes/restores recovery hints with an explicit mainnet namespace, chain/Registry binding and version. Old unbound mock journals cannot restore. Interrupted wallet intent becomes unknown, never confirmed or automatically signable. Storage denial falls back safely.
- `controllers/wallet-connection.mjs` resolves a connector from wagmi's current list and rechecks account, network and connector identity at the `eth_sendTransaction` transport boundary.
- `controllers/submission-check.mjs` requires successful contract simulation and a positive gas estimate both before enabling the action and immediately before wallet submission. Missing gas-price data stays unavailable, never a fabricated zero. No fiat feed was invented.
- Claim/payment text describes real IMD fees and ETH gas, live quotes, nonrefundable oracle requests and separate fee forwarding/bridge/burn operations. Success messages and dismissals remain, with mainnet-specific storage keys.
- `swarm.tsx` retains the existing exact Intake/request/event/question matching and polling loader. It removes scripted-fixture copy without manufacturing missing answers. Agent marks still reflect returned member data; the final wallet congratulations requires matching Registry evidence and a true wallet fact read.

## Verification

Five new behavioral mainnet tests were written before implementation. They cover selected-provider resolution, cross-chain/Registry and old-mock journal rejection, interrupted intent, simulation/gas-estimation refusal and final wallet/network/connector identity checks.

The focused suite passed **41 tests**, including the inherited transaction lifecycle/replacement cases, tab-scoped request history, progress authority/matching and dismissal behavior. See `runtime-focused-tests.log`. TypeScript `npm run typecheck` passed after implementation.

The inherited transaction lifecycle harness was redirected to the extracted controller and the real journal model; its scenarios and assertions remain. Interface-label checks were updated for the explicitly removed mock controls and the Ethereum receipt label. Browser, deployed reads and final static-export verification are owned by the parent integration task.

No signing, payment, transaction submission, oracle run, wallet connection or deployment was executed by this worker. The application deliberately has real wallet transaction capability for user-confirmed operation; the offline tests do not certify a mainnet transaction outcome.

After the parent generated the first candidate export, the inherited full unit suite also passed **182 tests, zero failed/skipped** (`runtime-unit-final.log`). Its Vite-backed test loaders emitted sandbox-denied HMR listener diagnostics for port 24678; those did not fail the tests and are not browser-runtime evidence. The parent should still perform its final build/browser/export checks after all workers finish.

Final review cleanup: wallet request history now says IMD and links to the Ethereum request receipt; Composer validation names the deployed Composer; the page title is `Sworn | …`. The assigned reachable files were scanned for mock/fixture/scripted wording with no remaining matches. TypeScript passed again. Runtime source is stable for the final integrated build.
