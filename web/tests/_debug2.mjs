import fs from "node:fs";
import { createPublicClient, custom, encodeEventTopics } from "viem";
import { mainnet } from "viem/chains";
import { fakeChain, registryLog } from "./fake-chain.mjs";
const abi = JSON.parse(fs.readFileSync("../dist/abi/Registry.json"));
const requestId = "0x" + "a1".repeat(32);
const f = fakeChain({ token: 1n, pending: [{ id: 801, requestId, questionHash: "0x" + "b1".repeat(32), requestedAt: 1792600000n, cleared: true }] });
f.state.verifiedEvents = [registryLog("Missed", { requestId, traitId: 801, reason: 8 }, { logIndex: "0x10" })];
const client = createPublicClient({ chain: mainnet, transport: custom({ request: async (p) => f.answer(p) }) });
const names = ["TraitRequested", "Verified", "Missed", "NoVerdict", "Abandoned"];
const events = names.map((n) => abi.find((e) => e.type === "event" && e.name === n));
console.log(events.map((e) => e && e.name));
try {
  const logs = await client.getLogs({ address: "0x0da2679000ea5380d1361cc3cca7d4e8c881f766", events, fromBlock: 26240000n, toBlock: 26250000n });
  console.log(logs.map((l) => l.eventName));
} catch (e) { console.log("ERR", e.message); }
