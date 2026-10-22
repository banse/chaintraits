import {
  createPublicClient,
  defineChain,
  http,
  custom,
  keccak256,
  stringToHex,
  parseAbi,
  encodeAbiParameters,
  pad,
  toHex,
  decodeErrorResult,
  type Address,
  type Abi,
  type PublicClient,
} from "viem";
import { canonical, decodeMetadata, MISS_REASONS } from "./pure.mjs";
import { READ_RPCS, resilientRpc } from "./rpc.mjs";
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
    transport: custom(
      resilientRpc({ urls: [url, ...READ_RPCS.filter((u) => u !== url)] }),
      { retryCount: 0 },
    ),
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
  mintFee: bigint;
  specFee: bigint;
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
  const [price, block, supply, mintFee, specFee] = await Promise.all([
    client.readContract({
      address: deps.intake,
      abi: r.abis.IntakeV2,
      functionName: "priceOf",
      args: [ACTION, deps.imd],
    }),
    client.getBlockNumber(),
    read(client, r, "Registry", "totalSupply"),
    read(client, r, "Registry", "MINT_FEE"),
    read(client, r, "Registry", "SPEC_FEE"),
  ]);
  if (price <= 0n) throw Error("The live oracle price is unavailable or zero.");
  return { block, price, deps, supply, mintFee, specFee };
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
export const explain = (e: any, abi?: Abi) => {
  const reverted = e?.walk?.((cause: any) => cause.data?.errorName) || e;
  let data = reverted?.data;
  // Some RPCs wrap a revert with a generic node error. Decode its retained
  // returndata as well as viem's already-decoded ContractFunctionRevertedError.
  if (!data?.errorName) {
    const raw =
      e?.walk?.(
        (cause: any) =>
          typeof cause.data === "string" && cause.data.startsWith("0x"),
      )?.data || (typeof e?.data === "string" ? e.data : undefined);
    if (raw)
      try {
        data = decodeErrorResult({ abi: abi || [], data: raw });
      } catch {}
  }
  const name = data?.errorName;
  const args = data?.args || [];
  const fields: Record<string, string> = {
    kind: "template",
    target: "contract address",
    item: "event or function signature",
    arg: "claimant or group field",
    fixedArg: "second indexed filter",
    fixedVal: "filter value",
    sumArg: "field to sum",
    op: "comparison",
    threshold: "threshold or ranking head",
    fromBlock: "first block",
    toBlock: "last block",
    window: "block window",
    name: "trait name",
    question: "question length",
    definitions: "rule length",
  };
  const reasons: Record<string, string> = {
    AlreadyPending: `Fact ${args[1]} already has a pending request. Wait for its answer; you can request a different fact.`,
    AlreadyVerified: `Fact ${args[1]} is already proven for this wallet. Refresh wallet facts.`,
    AlreadyMinted: "This wallet already has a card. Refresh wallet facts.",
    FactAlreadyStored:
      "This shared fact is already stored. Refresh and apply it instead.",
    FactNotStored:
      "This shared fact has not been stored yet. Wait for its answer.",
    NotInList:
      "This wallet is not in the shared list and cannot apply this fact.",
    ListMismatch:
      "The list does not match the stored fact. Refresh its chain reads.",
    NotPending: "This request is no longer pending. Refresh wallet facts.",
    NotClaimant: "Only the wallet that requested this fact can clear it.",
    TooEarly:
      "This request cannot be cleared yet. Wait for completion or the 31-day limit.",
    PriceAboveMax:
      "The live oracle price increased. Start the action again to review the new price.",
    ZeroPrice: "The live oracle price is unavailable. Retry chain reads.",
    NoTraits: "Select at least one fact.",
    TooManyTraits:
      "The Registry accepts one fact per request. Start the action again.",
    UnexpectedSpecId:
      "Another spec was registered first. Start registration again.",
    NotASharedFact: "This fact does not support a shared-list request.",
    NotAnOracleTrait: "This fact does not support an oracle request.",
    NotSettleable: `Cannot store the verdict: ${MISS_REASONS[Number(args[1])] || "the verdict does not meet the Registry rules"}.`,
    ERC20InsufficientBalance:
      "Insufficient IMD for this action. Check your balance and retry.",
    ERC20InsufficientAllowance:
      "The IMD allowance is too low. Start the action again to review approval.",
    SafeERC20FailedOperation:
      "The IMD transfer was refused. Check your balance and allowance, then retry.",
    BadSpec: `The Composer refused the ${fields[String(args[0])] || "rule"}. Check the spec fields and retry.`,
    RequestIdTaken:
      "The Intake returned a request id already in use. Retry chain reads before requesting again.",
    NoCard: "This card does not exist. Refresh wallet facts.",
    SpecsExhausted: "The Registry has no remaining community spec ids.",
    DependencyHasNoCode:
      "A required contract is unavailable. Retry chain reads.",
    BadDependency: "A required contract failed its check. Retry chain reads.",
  };
  if (name === "Error" && typeof args[0] === "string")
    return args[0].slice(0, 700);
  if (reasons[name]) return reasons[name];
  const raw = [e?.shortMessage || e?.message || String(e), e?.details]
    .filter(Boolean)
    .join(" ");
  return /rejected|denied|4001/i.test(raw)
    ? "Rejected in your wallet. You can try again."
    : raw.slice(0, 700);
};
