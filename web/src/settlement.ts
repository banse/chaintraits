import { decodeCompletion } from "./oracle.mjs";
import {
  decodeFunctionData,
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  type Hex,
} from "viem";
import { asset, read, contract, type Runtime, type Health } from "./chain";
// Read-back windows (owner's decision): the oracle feed reads the last 600
// blocks (2 hours); request history and shared-fact attempts the last 7,200
// blocks (24 hours). Only "Check older blocks" reads back to the launch block.
export const FEED_WINDOW = 600n;
export const HISTORY_WINDOW = 7200n;
const OLDER_CHUNK = 100000n;
let launch: Promise<bigint> | undefined;
export const launchBlock = () =>
  (launch ??= fetch(asset("data/launch.json"))
    .then((r) => r.json())
    .then((v) => BigInt(v.blockNumber))
    .catch((e) => {
      launch = undefined;
      throw e;
    }));
// The head is read fresh for every scan: viem's cached block number can lag
// behind a request confirmed seconds ago.
export const latestBlock = async (client: any) =>
  BigInt(await client.request({ method: "eth_blockNumber", params: [] }));
export type EventRange = { fromBlock: bigint; toBlock: bigint };
export async function registryEvents(
  client: any,
  r: Runtime,
  names: string[],
  id?: number,
  options: { window?: bigint; fromBlock?: bigint } = {},
): Promise<any[] & EventRange> {
  const [first, latest] = await Promise.all([
    launchBlock(),
    latestBlock(client),
  ]);
  let start = first;
  // The window is inclusive of the head: [latest - window + 1, latest].
  if (options.window !== undefined && latest - options.window + 1n > start)
    start = latest - options.window + 1n;
  if (options.fromBlock !== undefined && options.fromBlock > start)
    start = options.fromBlock;
  const events = names.map((name) =>
    r.abis.Registry.find((e: any) => e.type === "event" && e.name === name),
  );
  const result: any[] = [];
  for (let from = start; from <= latest; from += OLDER_CHUNK) {
    const to =
      from + OLDER_CHUNK - 1n > latest ? latest : from + OLDER_CHUNK - 1n;
    const logs = await client.getLogs({
      address: contract(r, "Registry").address,
      events,
      fromBlock: from,
      toBlock: to,
    });
    result.push(
      ...logs.filter(
        (l: any) =>
          id === undefined ||
          l.eventName === "Abandoned" ||
          Number(l.args.traitId ?? l.args.factId) === id,
      ),
    );
  }
  return Object.assign(
    result.sort((a, b) =>
      a.blockNumber !== b.blockNumber
        ? a.blockNumber < b.blockNumber
          ? -1
          : 1
        : Number(a.logIndex) - Number(b.logIndex),
    ),
    { fromBlock: start, toBlock: latest },
  );
}
export async function completion(
  client: any,
  r: Runtime,
  h: Health,
  requestId: Hex,
  options: { window?: bigint } = {},
) {
  const [first, latest] = await Promise.all([
    launchBlock(),
    // Fresh head, never viem's cached block number.
    client.getBlockNumber({ cacheTime: 0 }) as Promise<bigint>,
  ]);
  const event = r.abis.IntakeV2.find(
    (e: any) => e.type === "event" && e.name === "Completed",
  );
  // Automatic reads stay inside their window; a button press reads from launch.
  let start = first;
  if (options.window !== undefined && latest - options.window + 1n > start)
    start = latest - options.window + 1n;
  for (let from = start; from <= latest; from += 1500n) {
    const logs = await client.getLogs({
      address: h.deps.intake,
      event,
      args: { requestId },
      fromBlock: from,
      toBlock: from + 1499n > latest ? latest : from + 1499n,
    });
    for (const log of logs) {
      if (Number(log.args.status) !== 0)
        return {
          delivered: log.args.delivered,
          status: Number(log.args.status),
          txHash: log.transactionHash,
        };
      const tx = await client.getTransaction({ hash: log.transactionHash });
      if (tx.to?.toLowerCase() !== h.deps.intake.toLowerCase())
        throw Error("Completion transaction target mismatch.");
      const decoded = decodeCompletion(
        r.abis.IntakeV2,
        r.abis.Registry,
        requestId,
        tx.input,
      );
      return {
        delivered: log.args.delivered,
        status: 0,
        txHash: log.transactionHash,
        attestation: decoded.attestation,
        signature: decoded.signature,
      };
    }
  }
  return null;
}
export async function sharedState(
  client: any,
  r: Runtime,
  h: Health,
  id: number,
  older = false,
) {
  const [fact, pending, events] = await Promise.all([
    read(client, r, "Registry", "sharedFact", [id]),
    read(client, r, "Registry", "sharedPending", [id]),
    registryEvents(
      client,
      r,
      ["TraitRequested", "SharedFactStored", "Missed", "NoVerdict"],
      id,
      older ? {} : { window: HISTORY_WINDOW },
    ),
  ]);
  const attempts = events.filter(
    (e) => e.eventName === "TraitRequested",
  ).length;
  // A request ends once; a later event for the same request id never replaces it.
  const ended = new Set<string>();
  const last = events
    .filter((e) => {
      if (e.eventName === "TraitRequested") return false;
      const key = String(e.args.requestId).toLowerCase();
      if (ended.has(key)) return false;
      ended.add(key);
      return true;
    })
    .at(-1);
  let list: any[] = [],
    result: any = null;
  if (!/^0x0+$/.test(fact[0])) {
    // The stored state is known from sharedFact; its completion (and list) is
    // read automatically only inside the 24-hour window.
    result = await completion(
      client,
      r,
      h,
      fact[0],
      older ? {} : { window: HISTORY_WINDOW },
    );
    if (result?.attestation) {
      list = decodeAbiParameters(
        [{ type: "address[]" }],
        result.attestation.answer,
      )[0] as any[];
      if (
        keccak256(encodeAbiParameters([{ type: "address[]" }], [list])) !==
        fact[1]
      )
        throw Error("Stored shared answer hash mismatch.");
    }
  }
  return { fact, pending, events, attempts, last, list, result, older };
}
