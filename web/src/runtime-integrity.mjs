import { keccak256, stringToHex } from "viem";
import { canonical } from "./pure.mjs";

// The exact exported inputs are bundled. Validation still precedes any chain read.
export function validateRuntimeAssets(deployment, abis, preview) {
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId
  )
    throw Error("Deployment network mismatch.");
  for (const c of deployment.contracts) {
    if (c.abiPath.includes("..") || c.abiPath.startsWith("/"))
      throw Error("Unsafe ABI path");
    if (keccak256(stringToHex(canonical(abis[c.name]))).slice(2) !== c.abiHash)
      throw Error(`${c.name} ABI integrity check failed.`);
  }
  if (preview.sourceCommit !== deployment.sourceCommit)
    throw Error("Preview storage layout source mismatch.");
  return { deployment, abis, preview };
}
