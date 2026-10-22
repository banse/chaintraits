import { decodeCompletion } from "./oracle.mjs";
import {
  decodeFunctionData,
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  type Hex,
} from "viem";
import { asset, read, contract, type Runtime, type Health } from "./chain";
export async function registryEvents(
  client: any,
  r: Runtime,
  names: string[],
  id?: number,
  fromBlock?: bigint,
) {
  const start =
    fromBlock ??
    BigInt(
      (await fetch(asset("data/launch.json")).then((r) => r.json()))
        .blockNumber,
    );
  const latest = await client.getBlockNumber();
  const result: any[] = [];
  for (let from = start; from <= latest; from += 1500n) {
    const to = from + 1499n > latest ? latest : from + 1499n;
    for (const name of names) {
      const event = r.abis.Registry.find(
        (e: any) => e.type === "event" && e.name === name,
      );
      const logs = await client.getLogs({
        address: contract(r, "Registry").address,
        event,
        fromBlock: from,
        toBlock: to,
      });
      result.push(
        ...logs.filter(
          (l: any) =>
            id === undefined || Number(l.args.traitId ?? l.args.factId) === id,
        ),
      );
    }
  }
  return result.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
}
export async function completion(
  client: any,
  r: Runtime,
  h: Health,
  requestId: Hex,
) {
  const launch = await fetch(asset("data/launch.json")).then((r) => r.json());
  const event = r.abis.IntakeV2.find(
    (e: any) => e.type === "event" && e.name === "Completed",
  );
  const latest = await client.getBlockNumber();
  for (let from = BigInt(launch.blockNumber); from <= latest; from += 1500n) {
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
) {
  const [fact, pending, events] = await Promise.all([
    read(client, r, "Registry", "sharedFact", [id]),
    read(client, r, "Registry", "sharedPending", [id]),
    registryEvents(
      client,
      r,
      ["TraitRequested", "SharedFactStored", "Missed", "NoVerdict"],
      id,
    ),
  ]);
  const attempts = events.filter(
    (e) => e.eventName === "TraitRequested",
  ).length;
  const last = events.filter((e) => e.eventName !== "TraitRequested").at(-1);
  let list: any[] = [],
    result: any = null;
  if (!/^0x0+$/.test(fact[0])) {
    result = await completion(client, r, h, fact[0]);
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
  return { fact, pending, events, attempts, last, list, result };
}
