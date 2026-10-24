import handoff from "../deployment-handoff.json";
import network from "../network.json";
import Registry from "../public/abi/Registry.json";
import Renderer from "../public/abi/Renderer.json";
import Composer from "../public/abi/Composer.json";
import WhitelistCurator from "../public/abi/WhitelistCurator.json";
import IntakeV2 from "../public/abi/IntakeV2.json";
import preview from "../public/data/renderer-preview.json";

// The same pinned inputs used by scripts/manifest.mjs; no host round trips.
export const runtimeAssets = {
  deployment: {
    ...handoff,
    ...network,
    contracts: handoff.contracts.map((c) => ({
      ...c,
      abiPath: `abi/${c.name}.json`,
    })),
  },
  abis: { Registry, Renderer, Composer, WhitelistCurator, IntakeV2 },
  preview,
};
