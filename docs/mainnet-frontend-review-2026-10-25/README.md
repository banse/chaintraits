# Mainnet frontend verification — 25 October 2026

This change promotes the revised local Sworn interface into a separate mainnet frontend while preserving the original contract bindings and Swarm loading. The base frontend commit is `55475816f2b5d548a3e89a9a4042b02539ced51b`; contract source remains `c4ff3238390fc51962fb67e86affc20cf418126e`.

- 184 unit tests and TypeScript passed.
- 12 browser check groups passed, including mainnet health, actual Renderer artwork, cardless eligibility, Curator exports, Swarm API CORS, nested static paths and a controlled RPC outage.
- All three deployed runtime hashes matched mainnet at block 26267034; see `mainnet-read.json`.
- A relocated source archive reproduced all 85 export files using the existing lock-compatible dependencies. No fresh npm installation was claimed.
- Independent source review passed; its stale-metric, stale-package and residual mock-copy findings were corrected.

The detailed reports in this directory retain their original workspace paths as provenance. The deployable project is now this repository root: `web/` is source, `dist/` is the static export. See the root `DEPLOYMENT.md` for build and publication instructions.

No signatures, paid requests, real oracle runs, transactions or deployments were performed during verification. Historical discovery remains distinct from accepted credentials; the census is not a complete global wallet index. A fresh mainnet transaction or paid Swarm publication is a separate action.
