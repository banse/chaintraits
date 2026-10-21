import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  stringToHex,
  parseAbi,
  encodeAbiParameters,
  pad,
  toHex,
  type Address,
  type Abi,
  type PublicClient,
} from "viem";
import { canonical, decodeMetadata } from "./pure.mjs";
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    uniswapV4: any;
    pairToken: any;
  };
  walletAddChain: any;
};
export type Runtime = {
  deployment: Deployment;
  abis: Record<string, Abi>;
  preview: any;
  chain: ReturnType<typeof defineChain>;
};
export const asset = (p: string) => new URL(p, document.baseURI).href;
async function json(p: string) {
  const r = await fetch(asset(p));
  if (!r.ok) throw Error(`Cannot load ${p}: HTTP ${r.status}`);
  return r.json();
}
export async function loadRuntime(): Promise<Runtime> {
  const deployment: Deployment = await json("imd-deployment.json");
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId
  )
    throw Error("Deployment network mismatch.");
  const abis: Record<string, Abi> = {};
  for (const c of deployment.contracts) {
    if (c.abiPath.includes("..") || c.abiPath.startsWith("/"))
      throw Error("Unsafe ABI path");
    abis[c.name] = await json(c.abiPath);
    if (keccak256(stringToHex(canonical(abis[c.name]))).slice(2) !== c.abiHash)
      throw Error(`${c.name} ABI integrity check failed.`);
  }
  for (const name of ["WhitelistCurator", "IntakeV2"])
    abis[name] = await json(`abi/${name}.json`);
  const preview = await json("data/renderer-preview.json");
  if (preview.sourceCommit !== deployment.sourceCommit)
    throw Error("Preview storage layout source mismatch.");
  return {
    deployment,
    abis,
    preview,
    chain: defineChain({
      id: deployment.chainId,
      name: deployment.network.name,
      nativeCurrency: deployment.network.nativeCurrency,
      rpcUrls: { default: { http: deployment.network.rpcUrls } },
      blockExplorers: {
        default: { name: "Explorer", url: deployment.network.explorer },
      },
    }),
  };
}
export const contract = (r: Runtime, name: string) => {
  const c = r.deployment.contracts.find((c) => c.name === name);
  if (!c) throw Error(`Missing deployed contract: ${name}`);
  return c;
};
export const makeClient = (r: Runtime, url: string) =>
  createPublicClient({
    chain: r.chain,
    transport: http(url, { timeout: 15000, retryCount: 1 }),
    batch: { multicall: false },
  });
export const read = async (
  client: any,
  r: Runtime,
  name: string,
  fn: string,
  args: any[] = [],
  extra: any = {},
) =>
  client.readContract({
    address: contract(r, name).address,
    abi: r.abis[name],
    functionName: fn,
    args,
    ...extra,
  });
export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const ACTION = stringToHex("oracle.request@oracle-1", { size: 32 });
export type Health = {
  block: bigint;
  price: bigint;
  deps: Record<string, Address>;
  supply: bigint;
};
export async function health(client: any, r: Runtime): Promise<Health> {
  const chain = await client.getChainId();
  if (chain !== r.deployment.chainId)
    throw Error(`RPC answers chain ${chain}; Ethereum is required.`);
  await Promise.all(
    r.deployment.contracts.map(async (c) => {
      const code = await client.getBytecode({ address: c.address });
      if (!code || code === "0x")
        throw Error(`${c.name} has no deployed code.`);
      if (r.preview.contracts[c.name].runtimeHash !== keccak256(code))
        throw Error(`${c.name} runtime differs from the pinned source.`);
    }),
  );
  const names = [
    "curator",
    "imd",
    "intake",
    "attester",
    "renderer",
    "composer",
    "burnExecutor",
  ];
  const values = await Promise.all(
    names.map((n) => read(client, r, "Registry", n)),
  );
  const deps = Object.fromEntries(names.map((n, i) => [n, values[i]]));
  for (const n of ["Renderer", "Composer"])
    if (
      deps[n.toLowerCase()].toLowerCase() !==
      contract(r, n).address.toLowerCase()
    )
      throw Error(`${n} getter does not match deployment.`);
  if (
    deps.imd.toLowerCase() !==
    r.deployment.network.pairToken.address.toLowerCase()
  )
    throw Error("IMD getter does not match network.");
  const [price, block, supply] = await Promise.all([
    client.readContract({
      address: deps.intake,
      abi: r.abis.IntakeV2,
      functionName: "priceOf",
      args: [ACTION, deps.imd],
    }),
    client.getBlockNumber(),
    read(client, r, "Registry", "totalSupply"),
  ]);
  if (price <= 0n) throw Error("The live oracle price is unavailable or zero.");
  return { block, price, deps, supply };
}
export type WalletFacts = {
  address: Address;
  token: bigint;
  traits: number[];
  verifiedSpecs: number[];
  answers: boolean[];
  joined: boolean;
  hour: bigint;
  count: bigint;
  capital: bigint;
  points: bigint;
  frozen: bigint | null;
  uri: string;
  metadata: any;
  raw: string;
  pending: Record<number, string>;
  verified: Record<number, any>;
};
function mappingSlot(key: string | bigint, slot: string, type = "address") {
  return keccak256(
    encodeAbiParameters(
      [{ type } as any, { type: "uint256" }],
      [key, BigInt(slot)],
    ),
  );
}
export async function lookup(
  client: any,
  r: Runtime,
  h: Health,
  address: Address,
  ids: number[],
): Promise<WalletFacts> {
  const [token, traits, verifiedSpecs, answers, first, count, capital, points] =
    await Promise.all([
      read(client, r, "Registry", "tokenOf", [address]),
      read(client, r, "Registry", "traitsOf", [address]),
      read(client, r, "Registry", "verifiedSpecsOf", [address]),
      Promise.all(
        ids.map((id) => read(client, r, "Registry", "hasTrait", [address, id])),
      ),
      ...["firstHourOf", "txCountOf", "contributedBy", "pointsOf"].map(
        (functionName) =>
          client.readContract({
            address: h.deps.curator,
            abi: r.abis.WhitelistCurator,
            functionName,
            args: [address],
          }),
      ),
    ]);
  let frozen = null,
    uri;
  if (token !== 0n) {
    [frozen, uri] = await Promise.all([
      read(client, r, "Registry", "frozenDirect", [token]),
      read(client, r, "Registry", "tokenURI", [token]),
    ]);
  } else {
    const snapshot = await read(client, r, "Composer", "directSnapshot", [
      address,
      h.deps.curator,
    ]);
    const slots = r.preview.slots;
    const stateOverride = [
      {
        address: contract(r, "Registry").address,
        stateDiff: [
          {
            slot: mappingSlot(address, slots.tokenOf),
            value: pad(toHex(1n), { size: 32 }),
          },
          {
            slot: mappingSlot(1n, slots.claimantOf, "uint256"),
            value: pad(address, { size: 32 }),
          },
          {
            slot: mappingSlot(1n, slots.frozenDirect, "uint256"),
            value: pad(toHex(snapshot), { size: 32 }),
          },
        ],
      },
    ];
    uri = await read(
      client,
      r,
      "Renderer",
      "tokenURIOf",
      [contract(r, "Registry").address, 1n],
      { stateOverride },
    );
  }
  const { data, raw } = decodeMetadata(uri);
  const oracleIds = ids.filter((id) => id >= 601);
  const [pendingValues, proofs] = await Promise.all([
    Promise.all(
      oracleIds.map((id) =>
        read(client, r, "Registry", "pendingOf", [address, id]),
      ),
    ),
    Promise.all(
      oracleIds.map((id) =>
        read(client, r, "Registry", "verified", [address, id]),
      ),
    ),
  ]);
  return {
    address,
    token,
    traits,
    verifiedSpecs,
    answers,
    joined: first[1],
    hour: first[0],
    count,
    capital,
    points,
    frozen,
    uri,
    metadata: data,
    raw,
    pending: Object.fromEntries(
      oracleIds.map((id, i) => [id, pendingValues[i]]),
    ),
    verified: Object.fromEntries(oracleIds.map((id, i) => [id, proofs[i]])),
  };
}
export async function community(client: any, r: Runtime) {
  const next = Number(await read(client, r, "Registry", "nextSpecId"));
  const ids = Array.from({ length: next - 10001 }, (_, i) => 10001 + i);
  const result = [];
  for (let start = 0; start < ids.length; start += 50)
    result.push(
      ...(await Promise.all(
        ids.slice(start, start + 50).map(async (id) => ({
          id,
          ...(await read(client, r, "Registry", "specOf", [id])),
        })),
      )),
    );
  return result;
}
export const explain = (e: any) => {
  const raw = e?.shortMessage || e?.message || String(e);
  return /rejected|denied|4001/i.test(raw)
    ? "Rejected in your wallet. You can try again."
    : raw.slice(0, 700);
};
