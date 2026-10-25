# Sworn — revised mainnet frontend

The improved interface connects to the same Ethereum mainnet contracts and public IMD Swarm data as the deployed site. This is a separate candidate: the before mock on 8798, revised mock on 8799, documentation server and self-hosted site are preserved.

Local preview: **http://127.0.0.1:8804/**. This is a mainnet interface. Reads are public; transactions require the connected wallet's approval and spend real IMD/ETH. Verification did not sign or submit public transactions or oracle requests.

## Build and preview

```sh
cd web
npm ci
npm run build
npm run typecheck
npm run test:unit
npm run verify:export
cd ..
./start.sh
```

The workspace reuses its existing dependency installation. A source archive needs the lockfile and `npm ci`, without another checkout's Git ancestry, private environment file, signer or mock server. `start.sh --port 8805` selects another loopback port without stopping services. The server serves only `dist/` and does not proxy Ethereum or Swarm requests.

## Model, controller and view boundaries

- **Models:** pure selection/export rules, transaction journal records and request outcomes. `web/src/models/` contains mainnet records and validation; existing focused `.mjs` modules remain where moving them adds no benefit.
- **Data adapters:** `chain.ts`, `rpc.mjs`, `page-reads.mjs`, hash-checked historical shards and `oracle-progress.mjs`. They preserve the original deployment metadata, RPC fallback and Swarm request matching.
- **Controllers:** `web/src/controllers/` owns transaction preparation/recovery, wallet provider resolution, submission checks and Curator asynchronous loading, cancellation and unknown/error states.
- **Views:** React pages/components, mint dialog, cards, progress and Curator. Hash routes and relative assets support a static IPFS export.

This is incremental separation, not an MVC framework rewrite. No contracts or private backend were introduced.

## Mainnet behavior

Mock request interception is removed. Injected/EIP-6963 wallets and the original Coinbase connector are restored. Provider resolution uses the currently selected connector. Submission requires simulation, a positive gas estimate and a fresh wallet/account/network check. Recovery history has a separate namespace bound to chain and Registry. Fees come from contract reads; unavailable fiat conversion is not invented.

Mint Card, Mint Facts, Mint Rule, clickable cards, dismissible success/progress, full questions and Docs are retained. Swarm progress loads the real public request/detail/Intake endpoints. API answers are progress information; Registry state determines facts. Unknown agents are not displayed as successful.

Curator separates discovery from eligibility. Published hash-pinned shards provide historical candidates, not granted credentials. A full census scan is optional; arbitrary addresses can be checked without cards or census membership. Current checks use the Registry; errors stay unknown. Exports record historical/current provenance and block information. The census is not a complete index of wallets with later community facts.

Bundled docs reuse previous how-to content and illustrations. Sections about the local mock remain labeled as such.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Swarm handoff and packaging. `web/source-pin.json` binds deployment/network data, five ABIs and the Renderer preview. Build checks work without `git show`; runtime still checks chain ID, bytecode and dependencies. The release check refuses fixture transports and root-relative entry assets. The manifest records every public file and preserves the original size limits.

Original frontend: `identity-md-launches/launch-2412-workflow-frontend-stage-context` at `55475816f2b5d548a3e89a9a4042b02539ced51b`. Contracts: `identity-md-launches/launch-2404-renderer-composer-registry` at `c4ff3238390fc51962fb67e86affc20cf418126e`. See `provenance.json` and `web/source-pin.json`.
