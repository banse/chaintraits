import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = new URL("../../dist/", import.meta.url),
  handoff = JSON.parse(
    fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
  ),
  net = JSON.parse(
    fs.readFileSync(new URL("../network.json", import.meta.url)),
  );
function walk(dir, prefix = "") {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = prefix + e.name;
      return e.isDirectory()
        ? walk(path.join(dir, e.name), p + "/")
        : p === "imd-deployment.json"
          ? []
          : [
              {
                path: p,
                sha256: createHash("sha256")
                  .update(fs.readFileSync(path.join(dir, e.name)))
                  .digest("hex"),
              },
            ];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
const assets = walk(root.pathname);
if (assets.length > 128) throw Error("More than 128 assets");
const bytes = assets.reduce((n, a) => {
  const s = fs.statSync(new URL(a.path, root)).size;
  if (s > 8388608) throw Error("Asset exceeds 8 MiB");
  return n + s;
}, 0);
if (bytes > 16 * 1024 * 1024)
  throw Error("Export leaves insufficient HTTP budget");
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts: handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
    abiPath: `abi/${name}.json`,
  })),
  assets,
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
  ...net,
};
if (process.argv.includes("--check")) {
  if (
    JSON.stringify(
      JSON.parse(fs.readFileSync(new URL("imd-deployment.json", root))),
    ) !== JSON.stringify(manifest)
  )
    throw Error("Manifest drift");
} else
  fs.writeFileSync(
    new URL("imd-deployment.json", root),
    JSON.stringify(manifest, null, 2) + "\n",
  );
console.log(
  `${process.argv.includes("--check") ? "Verified" : "Wrote"} manifest: ${assets.length} assets, ${bytes} bytes`,
);
