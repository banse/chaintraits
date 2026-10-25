# Swarm deployment handoff

Use this candidate as the frontend change set for the existing Sworn repository, reviewed base `55475816f2b5d548a3e89a9a4042b02539ced51b`. Reuse the Ethereum chain-1 deployment in `web/deployment-handoff.json`; do not deploy, upgrade or replace contracts.

Keep public Swarm loading in `web/src/oracle-progress.mjs` and original pinned data under `web/public/data/`. Do not replace it with mock responses, a private backend or a new indexer. Preserve the configured public RPC fallback. Registry acceptance remains authoritative when progress is unavailable.

## Build contract

```sh
cd web
npm ci
npm run typecheck
npm run build
npm run test:unit
npm run verify:export
cd ..
python3 package-release.py
```

Output: **`dist/`**. Upload its contents as the site root. Routing uses `#/…`; Vite assets, data and Docs use relative paths. No SSR, rewrite server, API proxy, signing service or secret environment variable is required. Preserve every exported file, including the manifest, ABIs, shards, agent reference and Docs.

Packaging rebuilds from the current source, verifies the export and creates `release/sworn-mainnet-static.zip`, `release/sworn-mainnet-source.zip` and `release/SHA256.json`. This prevents a changed source tree from being bundled with stale static output. The source bundle includes the lockfile, public data, supporting contract sources/docs and build instructions. Nothing is published, signed, paid or pushed.

For a later paid Swarm continuation, bind the exact request body to the final reviewed revision and run the workspace's mandatory `ensure`/`verify` rehearsal. Do not substitute the closed member-site endpoint for the original job/workflow publication path.

## Future publication acceptance

1. Confirm chain 1 and unchanged Registry/Composer/Renderer bindings, source and ABI hashes.
2. Build with the lockfile; verify export hashes/limits and absence of fixture transports or synthetic wallet controls.
3. Check a static subdirectory deployment in a browser: Wallet/Explorer, Mint, Community, Curator, Docs and an existing request's Swarm progress. RPC/API failures must stay unknown or error.
4. Check account/network isolation and acknowledgments with a controlled provider. A real paid mint requires separate authorization.
5. After publication, record the new CID/URL and compare hosted assets with the export. Recheck live bytecode/API behavior then; local evidence is dated.

## Dependencies

Public RPCs see addresses and network information. For another provider, configure `READ_RPCS` in `web/src/rpc.mjs` and rebuild; this edition has no arbitrary RPC URL settings form. IMD's progress API can be unavailable while Ethereum holds a settled result. Onchain facts and wallet actions are public. The frontend holds no private keys. Source, ABIs and contract links provide alternate access. Original MIT licensing is retained. Runtime checks are not a new security audit or a guarantee that an attested statement is correct.
