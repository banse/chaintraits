// Local in-memory UI fixture. No RPC forwarding, keys, signing, EVM or agents.
import fs from "node:fs";
import crypto from "node:crypto";
import { catalogSpec, mockRecipe, mockAnswer } from "./question-fixtures.mjs";
import { EXPLORER_SAMPLES } from "../src/explorer-samples.mjs";
import { NAMES, metadataUri } from "./card-renderer.mjs";
import { validateSpec } from "../src/pure.mjs";
import {
  decodeFunctionData,
  encodeFunctionData,
  decodeAbiParameters,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  encodeErrorResult,
  parseAbi,
  toHex,
  zeroHash,
  keccak256,
} from "viem";
import {
  fakeChain,
  registryLog,
  wallet as WALLET,
  multicall3,
  deployment,
} from "./fixture-chain.mjs";
export { WALLET };
const handoff = JSON.parse(
  fs.readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
);
const deps = handoff.manifest.contracts.find(
  (c) => c.contract === "Registry",
).constructorArgs;
export const addresses = {
  ...Object.fromEntries(deployment.contracts.map((c) => [c.name, c.address])),
  curator: deps[0],
  imd: deps[1],
  intake: deps[2],
  router: deployment.network.uniswapV4.universalRouter,
  quoter: deployment.network.uniswapV4.quoter,
};
export const abis = {
  Intake: JSON.parse(
    fs.readFileSync(new URL("../public/abi/IntakeV2.json", import.meta.url)),
  ),
  Composer: JSON.parse(
    fs.readFileSync(new URL("../public/abi/Composer.json", import.meta.url)),
  ),
  Curator: JSON.parse(
    fs.readFileSync(
      new URL("../public/abi/WhitelistCurator.json", import.meta.url),
    ),
  ),
  Registry: JSON.parse(
    fs.readFileSync(new URL("../public/abi/Registry.json", import.meta.url)),
  ),
  Renderer: JSON.parse(
    fs.readFileSync(new URL("../public/abi/Renderer.json", import.meta.url)),
  ),
  token: parseAbi([
    "function approve(address,uint256) returns(bool)",
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
  ]),
  router: parseAbi([
    "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  ]),
  multicall: parseAbi([
    "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])",
  ]),
};
const MINT_FEE = 100000000000000000n,
  PRICE = 500000000000000000n,
  SPEC_FEE = 6400000000000000000n;
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const hash = () => `0x${crypto.randomBytes(32).toString("hex")}`;
const json = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
const err = (message, code = -32000, data) =>
  Object.assign(new Error(message), { code, ...(data ? { data } : {}) });
const uint = (value, name) => {
  if (
    typeof value !== "string" ||
    !/^\d{1,78}$/.test(value) ||
    BigInt(value) >= 2n ** 256n
  )
    throw err(`Invalid ${name}`, -32602);
  return BigInt(value);
};
const presets = {
  fresh: {},
  "already-minted": { token: "1" },
  "wrong-chain": { chainId: 8453 },
  "no-imd": { imdBalance: "0" },
};
export function createEngine({ now = Date.now } = {}) {
  let fixture,
    settings,
    ethBalance,
    transactions,
    requests,
    events,
    head,
    nonce;
  function event(type, message) {
    events.push({ timestamp: now(), type, message });
    events = events.slice(-100);
  }
  function reset(options = {}) {
    const scenario = options.scenario || "fresh";
    if (!(scenario in presets)) throw err("Unknown scenario", -32602);
    fixture = fakeChain();
    fixture.state.sharedFacts = {};
    fixture.state.verifiedSpecs = [];
    fixture.state.specs = Object.fromEntries(
      [601, 701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201, 1301].map(
        (id) => [id, catalogSpec(id)],
      ),
    );
    settings = {
      chainId: 1,
      txDelayMs: 3000,
      swarmDelayMs: 12000,
      deliveryDelayMs: 0,
      walletDelayMs: 800,
      outcome: "success",
      swarmOutcome: "success",
      readFailure: false,
    };
    ethBalance = 10n ** 18n;
    transactions = new Map();
    requests = [];
    events = [];
    head = 26250000n;
    nonce = 0;
    configure({ ...presets[scenario], ...options.settings });
    event("reset", `Reset ${scenario} fixture`);
    return state();
  }
  function configure(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw err("Invalid settings", -32602);
    const allowed = new Set([
      "chainId",
      "txDelayMs",
      "swarmDelayMs",
      "deliveryDelayMs",
      "walletDelayMs",
      "outcome",
      "swarmOutcome",
      "readFailure",
      "imdBalance",
      "ethBalance",
      "allowance",
      "token",
    ]);
    const next = { ...settings },
      numbers = {};
    for (const [key, value] of Object.entries(input)) {
      if (!allowed.has(key)) throw err(`Unknown setting ${key}`, -32602);
      if (["imdBalance", "ethBalance", "allowance", "token"].includes(key)) {
        numbers[key] = uint(value, key);
        continue;
      }
      if (key === "chainId") {
        if (![1, 8453].includes(value))
          throw err("Unsupported mock wallet chain", -32602);
      } else if (key.endsWith("DelayMs")) {
        const max =
          key === "swarmDelayMs"
            ? 120000
            : key === "walletDelayMs"
              ? 30000
              : 60000;
        if (!Number.isInteger(value) || value < 0 || value > max)
          throw err(`Invalid ${key}`, -32602);
      } else if (key === "outcome") {
        if (!["success", "reject", "revert"].includes(value))
          throw err("Invalid outcome", -32602);
      } else if (key === "swarmOutcome") {
        if (!["success", "failed", "false"].includes(value))
          throw err("Invalid swarm outcome", -32602);
      } else if (key === "readFailure" && typeof value !== "boolean")
        throw err("Invalid read failure", -32602);
      next[key] = value;
    }
    settings = next;
    if (numbers.imdBalance !== undefined)
      fixture.state.balance = numbers.imdBalance;
    if (numbers.ethBalance !== undefined) ethBalance = numbers.ethBalance;
    if (numbers.allowance !== undefined)
      fixture.state.allowance = numbers.allowance;
    if (numbers.token !== undefined) fixture.state.token = numbers.token;
    return state();
  }
  function state() {
    advance();
    return json({
      mock: true,
      wallet: WALLET,
      ...settings,
      imdBalance: fixture.state.balance,
      ethBalance,
      allowance: fixture.state.allowance,
      token: fixture.state.token,
      proven: fixture.state.proven,
      verifiedSpecs: fixture.state.verifiedSpecs,
      transactions: [...transactions.values()].map((t) => ({
        hash: t.hash,
        functionName: t.decoded.functionName,
        replacement: t.replacement,
        status: t.replacement
          ? "replaced"
          : t.receipt
            ? t.receipt.status === "0x1"
              ? "confirmed"
              : "reverted"
            : "pending",
        submittedAt: t.submittedAt,
        readyAt: t.readyAt,
      })),
      requests: requests.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        traitId: r.traitId,
        status: r.status,
        createdAt: r.createdAt,
        readyAt: r.readyAt,
      })),
      events,
    });
  }
  function decode(tx) {
    const abi = same(tx.to, addresses.imd)
      ? abis.token
      : same(tx.to, addresses.Registry)
        ? abis.Registry
        : same(tx.to, addresses.router)
          ? abis.router
          : null;
    if (!abi) throw err("Mock target is not supported", -32602);
    try {
      return { ...decodeFunctionData({ abi, data: tx.data || tx.input }), abi };
    } catch {
      throw err("Invalid mock calldata", -32602);
    }
  }
  function validate(call) {
    const fn = call.functionName,
      args = call.args || [];
    let cost = 0n;
    if (fn === "mintCard") {
      if (fixture.state.token !== 0n)
        throw err(
          "Already minted",
          3,
          encodeErrorResult({
            abi: abis.Registry,
            errorName: "AlreadyMinted",
            args: [WALLET],
          }),
        );
      cost = MINT_FEE;
    } else if (fn === "upgrade") {
      if (args[0].length !== 1 || args[1] < PRICE)
        throw err("Mock request requires one fact and the current price");
      const id = Number(args[0][0]),
        spec = fixture.state.specs[id];
      if (!spec || spec.kind === 3)
        throw err(
          "Choose a registered wallet fact; shared facts use requestSharedFact",
        );
      if (fixture.state.proven.includes(id)) throw err("Fact already verified");
      if (fixture.state.pending.some((p) => !p.cleared && p.id === id))
        throw err("Fact request already pending");
      cost = PRICE;
    } else if (fn === "requestSharedFact") {
      const id = Number(args[0]),
        spec = fixture.state.specs[id];
      if (!spec || spec.kind !== 3) throw err("Not a shared fact");
      if (args[1] < PRICE) throw err("Price exceeds maximum");
      if (fixture.state.sharedFacts[id])
        throw err("Shared fact already stored");
      if (fixture.state.pending.some((p) => !p.cleared && p.id === id))
        throw err("Shared request already pending");
      cost = PRICE;
    } else if (fn === "applySharedFact") {
      const id = Number(args[0]),
        stored = fixture.state.sharedFacts[id];
      if (!stored) throw err("Shared fact not stored");
      if (
        keccak256(encodeAbiParameters([{ type: "address[]" }], [args[1]])) !==
        stored.answerHash
      )
        throw err("Shared list does not match the stored result");
      if (!stored.list.some((a) => same(a, WALLET)))
        throw err("Wallet is not in this shared list");
      if (fixture.state.proven.includes(id)) throw err("Fact already verified");
    } else if (fn === "registerSpec") {
      const errors = validateSpec(args[0], head);
      if (Object.keys(errors).length)
        throw err("Invalid specification: " + Object.values(errors).join(" "));
      if (Number(fixture.state.nextSpecId || 10001) >= 65535)
        throw err("Specification IDs exhausted");
      if (
        args[1] !== 0n &&
        args[1] !== BigInt(fixture.state.nextSpecId || 10001)
      )
        throw err("Unexpected mock specification ID");
      cost = SPEC_FEE;
    } else if (fn === "approve") {
      if (!same(args[0], addresses.Registry))
        throw err("Mock approval spender is not Registry");
      return;
    } else if (
      !["execute", "applySharedFact", "abandon", "settle"].includes(fn)
    )
      throw err("Unsupported simulated action", -32601);
    if (cost > fixture.state.balance) throw err("Insufficient IMD balance", 3);
    if (cost > fixture.state.allowance)
      throw err("Insufficient IMD allowance", 3);
    if (
      fn === "execute" &&
      BigInt(args[2]) * 1000n <= BigInt(Math.floor(now()))
    )
      throw err("The ETH quote expired", 3);
    return cost;
  }
  function requestFact(id, tx) {
    const uuid = crypto.randomUUID(),
      requestId = hash(),
      questionHash = hash();
    const entry = {
      id: uuid,
      requestId,
      traitId: Number(id),
      questionHash,
      transactionHash: tx.hash,
      recipe: mockRecipe(
        Number(id),
        WALLET,
        head,
        fixture.state.specs?.[Number(id)],
      ),
      shared: fixture.state.specs[Number(id)]?.kind === 3,
      status: "assessing",
      createdAt: new Date(now()).toISOString(),
      readyAt: now() + settings.swarmDelayMs,
      durationMs: settings.swarmDelayMs,
      deliveryAt: now() + settings.swarmDelayMs + settings.deliveryDelayMs,
      outcome: settings.swarmOutcome,
      claimant:
        fixture.state.specs[Number(id)]?.kind === 3
          ? "0x0000000000000000000000000000000000000000"
          : WALLET,
    };
    requests.push(entry);
    fixture.state.pending.push({
      id: Number(id),
      requestId,
      questionHash,
      transactionHash: tx.hash,
      claimant: entry.claimant,
      requestedAt: BigInt(Math.floor(now() / 1000)),
    });
    event("swarm", `Mock fact ${id}: waiting for scripted result (no agents)`);
    return registryLog(
      "TraitRequested",
      {
        claimant: entry.claimant,
        traitId: Number(id),
        requestId,
        questionHash,
      },
      { transactionHash: tx.hash, blockNumber: toHex(head) },
    );
  }
  function apply(tx) {
    const { functionName: fn, args = [] } = tx.decoded;
    const cost = validate(tx.decoded) || 0n;
    let logs = [];
    if (fn === "approve") fixture.state.allowance = args[1];
    else if (fn === "execute") {
      const maximum = BigInt(tx.value || 0);
      if (maximum > ethBalance) throw err("Insufficient mock ETH");
      const outer = decodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes[]" }],
        args[1][0],
      );
      const take = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        outer[1][2],
      );
      fixture.state.balance += take[1];
      ethBalance -= (maximum * 100n) / 101n;
    } else {
      fixture.state.balance -= cost;
      fixture.state.allowance -= cost;
      if (fn === "mintCard") {
        fixture.state.token = 1n;
        fixture.state.mintedAtBlock = head;
        fixture.state.frozenTraits = [101];
        logs = [
          registryLog(
            "CardMinted",
            { claimant: WALLET, tokenId: 1n },
            { transactionHash: tx.hash, blockNumber: toHex(head) },
          ),
        ];
      } else if (fn === "upgrade")
        logs = args[0].map((id) => requestFact(id, tx));
      else if (fn === "requestSharedFact") logs = [requestFact(args[0], tx)];
      else if (fn === "registerSpec") {
        const id = fixture.state.nextSpecId || 10001;
        fixture.state.specs = { ...fixture.state.specs, [id]: args[0] };
        fixture.state.nextSpecId = id + 1;
        logs = [
          registryLog(
            "SpecRegistered",
            { traitId: id, registrant: WALLET },
            { transactionHash: tx.hash, blockNumber: toHex(head) },
          ),
        ];
      } else if (fn === "applySharedFact") {
        const id = Number(args[0]),
          stored = fixture.state.sharedFacts[id];
        acceptFact(id, [
          stored.requestId,
          stored.oracleRequestId,
          stored.fromBlock,
          stored.toBlock,
        ]);
        logs = [
          registryLog(
            "Verified",
            {
              claimant: WALLET,
              traitId: id,
              requestId: stored.requestId,
              oracleRequestId: stored.oracleRequestId,
            },
            { transactionHash: tx.hash, blockNumber: toHex(head) },
          ),
        ];
        fixture.state.verifiedEvents.push(...logs);
      }
    }
    return logs;
  }
  function acceptFact(id, record) {
    if (!fixture.state.proven.includes(id)) fixture.state.proven.push(id);
    if (id >= 10001 && !fixture.state.verifiedSpecs.includes(id))
      fixture.state.verifiedSpecs.push(id);
    fixture.state.verifiedRecords = {
      ...fixture.state.verifiedRecords,
      [id]: record,
    };
  }
  function recordCompletion(r, oracleRequestId) {
    // This is a synthetic ABI envelope only; no signature is produced or checked.
    // The real UI recovers a shared list through Completed + complete calldata.
    const status = r.outcome === "failed" ? 1 : 0;
    const answer = encodeAbiParameters(
      [{ type: r.recipe.answerType }],
      [mockAnswer(r.recipe, r.outcome === "success", WALLET)],
    );
    const attestation = {
      requestId: oracleRequestId,
      chainId: 1n,
      questionHash: r.questionHash,
      answerType:
        r.recipe.answerType === "address[]"
          ? 4
          : r.recipe.answerType === "uint256"
            ? 3
            : 0,
      answer,
      figure:
        r.recipe.answerType === "bool"
          ? r.outcome === "success"
            ? 1n
            : 0n
          : r.outcome === "success"
            ? BigInt(r.recipe.threshold)
            : 0n,
      fromBlock: BigInt(r.recipe.window.fromBlock),
      toBlock: BigInt(r.recipe.window.toBlock),
      blockHash: "0x" + "44".repeat(32),
      panelJobId: oracleRequestId,
      panelSize: r.recipe.panelSize,
      quorum: r.recipe.quorum,
      agreed: progress(r).agreement.agreed,
      issuedAt: BigInt(Math.floor(now() / 1000)),
      expiresAt: BigInt(Math.floor(now() / 1000) + 3600),
    };
    const args =
      status === 0
        ? encodeAbiParameters(
            abis.Registry.find((x) => x.name === "onResult").inputs,
            [r.requestId, attestation, "0x" + "11".repeat(65)],
          )
        : "0x";
    const input = encodeFunctionData({
      abi: abis.Intake,
      functionName: "complete",
      args: [r.requestId, status, keccak256(answer), "local-mock", args],
    });
    const event = abis.Intake.find((x) => x.name === "Completed");
    const log = {
      address: addresses.intake,
      blockNumber: toHex(head),
      blockHash: "0x" + "44".repeat(32),
      transactionHash: hash(),
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false,
      topics: encodeEventTopics({
        abi: [event],
        eventName: "Completed",
        args: { requestId: r.requestId },
      }),
      data: encodeAbiParameters(
        event.inputs.filter((x) => !x.indexed),
        [status, keccak256(answer), "local-mock", true],
      ),
    };
    r.completion = { log, input };
  }
  function advance() {
    if (!transactions) return;
    for (const tx of transactions.values())
      if (!tx.receipt && !tx.replacement && now() >= tx.readyAt) {
        head++;
        let status = "0x1",
          logs = [];
        const snapshot = structuredClone(fixture.state),
          savedEth = ethBalance,
          savedRequests = requests.length,
          savedEvents = events.length;
        try {
          if (tx.outcome === "revert") throw err("Scripted revert");
          logs = tx.decoded.functionName === "cancel" ? [] : apply(tx);
        } catch (e) {
          status = "0x0";
          tx.failure = e.message;
          for (const key of Object.keys(fixture.state))
            delete fixture.state[key];
          Object.assign(fixture.state, snapshot);
          ethBalance = savedEth;
          requests.length = savedRequests;
          events.length = savedEvents;
        }
        tx.receipt = {
          transactionHash: tx.hash,
          transactionIndex: "0x0",
          blockHash: `0x${"44".repeat(32)}`,
          blockNumber: toHex(head),
          from: WALLET,
          to: tx.to,
          cumulativeGasUsed: "0x186a0",
          gasUsed: "0x186a0",
          contractAddress: null,
          logs,
          logsBloom: `0x${"00".repeat(256)}`,
          status,
          effectiveGasPrice: "0x3b9aca00",
          type: "0x2",
        };
        ethBalance =
          ethBalance > 100000000000000n ? ethBalance - 100000000000000n : 0n;
        event(
          "receipt",
          `Mock ${tx.decoded.functionName} ${status === "0x1" ? "confirmed" : "reverted"}`,
        );
      }
    for (const r of requests) {
      if (r.status === "assessing" && now() >= r.readyAt) {
        r.status = r.outcome === "failed" ? "failed" : "attested";
        if (r.status === "attested")
          r.attestedAt = new Date(r.readyAt).toISOString();
        event(
          "panel",
          `Mock fact ${r.traitId}: panel ${r.status}; waiting for fixture delivery`,
        );
      }
      if (r.status !== "assessing" && !r.delivered && now() >= r.deliveryAt) {
        r.delivered = true;
        const pending = fixture.state.pending.find(
          (p) => p.requestId === r.requestId,
        );
        if (pending) pending.cleared = true;
        head++;
        const oracleRequestId =
          "0x" + r.id.replaceAll("-", "") + "00".repeat(16);
        recordCompletion(r, oracleRequestId);
        if (r.outcome === "success") {
          if (r.shared) {
            const list = mockAnswer(r.recipe, true, WALLET);
            fixture.state.sharedFacts[r.traitId] = {
              requestId: r.requestId,
              oracleRequestId,
              answerHash: keccak256(
                encodeAbiParameters([{ type: "address[]" }], [list]),
              ),
              list,
              fromBlock: BigInt(r.recipe.window.fromBlock),
              toBlock: BigInt(r.recipe.window.toBlock),
            };
          } else
            acceptFact(r.traitId, [
              r.requestId,
              oracleRequestId,
              BigInt(r.recipe.window.fromBlock),
              BigInt(r.recipe.window.toBlock),
            ]);
          fixture.state.verifiedEvents.push(
            registryLog(
              r.shared ? "SharedFactStored" : "Verified",
              r.shared
                ? {
                    factId: r.traitId,
                    requestId: r.requestId,
                    length: Number(r.recipe.threshold),
                  }
                : {
                    claimant: WALLET,
                    traitId: r.traitId,
                    requestId: r.requestId,
                    oracleRequestId,
                  },
              { blockNumber: toHex(head) },
            ),
          );
        } else
          fixture.state.verifiedEvents.push(
            registryLog(
              r.outcome === "false" ? "Missed" : "NoVerdict",
              r.outcome === "false"
                ? { requestId: r.requestId, traitId: r.traitId, reason: 8 }
                : {
                    requestId: r.requestId,
                    traitId: r.traitId,
                    status: 1,
                    reason: zeroHash,
                    agreed: progress(r).agreement.agreed,
                    answered: progress(r).members.filter((m) => m.ok === true)
                      .length,
                  },
              { blockNumber: toHex(head) },
            ),
          );
        event(
          "swarm",
          `Mock fact ${r.traitId}: ${r.outcome === "success" ? "stored" : r.outcome === "false" ? "answer false" : "failed"}; no oracle executed`,
        );
      }
    }
  }
  function currentRows() {
    const direct =
      fixture.state.frozenTraits && fixture.state.token !== 0n
        ? fixture.state.frozenTraits
        : [101];
    const active = {
      address: WALLET,
      tokenId: String(fixture.state.token),
      owner: fixture.state.token ? WALLET : null,
      censusMember: true,
      directFacts: direct,
      verifiedFacts: [...new Set(fixture.state.proven)],
      historicalFacts: [101],
      pendingFacts: fixture.state.pending
        .filter((p) => !p.cleared)
        .map((p) => p.id),
      metrics: { hour: 2, deposits: 1, largestWei: "1", points: 1, index: 1 },
    };
    const examples = EXPLORER_SAMPLES.map((s, i) => ({
      address: s.address,
      tokenId: String(s.token),
      owner: s.token ? s.owner || s.address : null,
      censusMember: true,
      directFacts: s.held.filter((id) => id < 601),
      verifiedFacts: s.held.filter((id) => id >= 601),
      historicalFacts: [
        ...s.held.filter((id) => id < 601),
        ...(s.requestStatus === "shared" ? [1201] : []),
      ],
      pendingFacts: s.requestStatus === "pending" ? [601] : [],
      metrics: {
        hour: 0,
        deposits: 3,
        largestWei: "750000000000000000",
        points: 20,
        index: i + 2,
      },
    }));
    return [
      active,
      ...examples,
      {
        address: "0x4000000000000000000000000000000000000001",
        tokenId: "0",
        owner: null,
        censusMember: false,
        directFacts: [],
        verifiedFacts: [601],
        historicalFacts: [],
        pendingFacts: [],
        metrics: {
          hour: null,
          deposits: null,
          largestWei: null,
          points: null,
          index: null,
        },
      },
    ];
  }
  function knownWallet(address) {
    const row = currentRows().find((w) => same(w.address, address));
    if (!row)
      throw err("No local fixture for this wallet; its eligibility is unknown");
    return row;
  }
  function curator() {
    advance();
    if (settings.readFailure) throw err("Simulated local RPC outage");
    return json({
      mock: true,
      chainId: 1,
      registry: addresses.Registry,
      sourceCommit: handoff.sourceCommit,
      blockNumber: Number(head),
      generatedAt: new Date(now()).toISOString(),
      facts: [
        ...Object.entries(NAMES).map(([id, name]) => ({
          id: Number(id),
          name,
          kind: catalogSpec(Number(id))?.kind || 0,
          builtin: true,
        })),
        ...Object.entries(fixture.state.specs)
          .filter(([id]) => Number(id) >= 10001)
          .map(([id, s]) => ({
            id: Number(id),
            name: s.name,
            kind: s.kind,
            builtin: false,
          })),
      ],
      wallets: currentRows(),
    });
  }
  function metadata(tokenId, p) {
    // viem's cardless preview overrides claimantOf[1]; honor that explicit wallet.
    const overrides = Object.values(p?.params?.[2] || {}).flatMap((o) =>
      Object.values(o.stateDiff || {}),
    );
    const preview = overrides
      .map((value) =>
        typeof value === "string" ? "0x" + value.slice(-40) : "",
      )
      .find((address) =>
        currentRows().some((row) => same(row.address, address)),
      );
    if (overrides.length && !preview)
      throw err("No local fixture for the preview wallet");
    const row = preview
      ? knownWallet(preview)
      : currentRows().find(
          (w) => w.tokenId !== "0" && w.tokenId === String(tokenId),
        );
    if (!row) throw err("No card or explicit preview fixture for this token");
    return metadataUri(row, fixture.state.specs);
  }
  function answer(p) {
    if (
      p.method === "eth_getLogs" &&
      same(p.params?.[0]?.address, addresses.intake)
    ) {
      const filter = p.params[0];
      return requests
        .flatMap((r) => (r.completion ? [r.completion.log] : []))
        .filter(
          (log) =>
            BigInt(log.blockNumber) >= BigInt(filter.fromBlock || 0) &&
            BigInt(log.blockNumber) <=
              (filter.toBlock === "latest" || !filter.toBlock
                ? head
                : BigInt(filter.toBlock)) &&
            (filter.topics || []).every(
              (wanted, i) =>
                wanted == null ||
                (Array.isArray(wanted)
                  ? wanted.some((v) => same(v, log.topics[i]))
                  : same(wanted, log.topics[i])),
            ),
        );
    }
    // A fixed seat receipt makes the mock wallet's 601 preflight meaningful.
    // It is synthetic history, not evidence read from the IdentityMD collection.
    if (
      p.method === "eth_getLogs" &&
      same(p.params?.[0]?.address, catalogSpec(601).target)
    ) {
      const filter = p.params[0],
        block = 25090086n;
      const topics = encodeEventTopics({
        abi: parseAbi([
          "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
        ]),
        eventName: "Transfer",
        args: {
          from: "0x0000000000000000000000000000000000000000",
          to: WALLET,
          tokenId: 1n,
        },
      });
      const matches = (filter.topics || []).every(
        (wanted, i) =>
          wanted == null ||
          (Array.isArray(wanted)
            ? wanted.some((v) => same(v, topics[i]))
            : same(wanted, topics[i])),
      );
      if (
        !matches ||
        BigInt(filter.fromBlock || 0) > block ||
        (filter.toBlock &&
          filter.toBlock !== "latest" &&
          BigInt(filter.toBlock) < block)
      )
        return [];
      return [
        {
          address: catalogSpec(601).target,
          topics,
          data: "0x",
          blockNumber: toHex(block),
          blockHash: "0x" + "55".repeat(32),
          transactionHash: "0x" + "66".repeat(32),
          transactionIndex: "0x0",
          logIndex: "0x0",
          removed: false,
        },
      ];
    }
    if (p.method === "eth_call" && same(p.params?.[0]?.to, multicall3)) {
      const { args } = decodeFunctionData({
        abi: abis.multicall,
        data: p.params[0].data,
      });
      const result = args[0].map((c) => {
        try {
          return {
            success: true,
            returnData: answer({
              method: "eth_call",
              params: [
                { to: c.target, data: c.callData },
                ...p.params.slice(1),
              ],
            }),
          };
        } catch (e) {
          if (!c.allowFailure) throw e;
          return { success: false, returnData: e.data || "0x" };
        }
      });
      return encodeFunctionResult({
        abi: abis.multicall,
        functionName: "aggregate3",
        result,
      });
    }
    if (p.method === "eth_call") {
      const tx = p.params[0];
      if (
        [
          addresses.Registry,
          addresses.imd,
          addresses.router,
          addresses.Renderer,
          addresses.Composer,
          addresses.curator,
        ].some((a) => same(a, tx.to))
      ) {
        let call;
        try {
          const name = ["Renderer", "Composer", "curator"].find((name) =>
            same(tx.to, addresses[name]),
          );
          const abi = name ? abis[name === "curator" ? "Curator" : name] : null;
          call = abi
            ? { ...decodeFunctionData({ abi, data: tx.data }), abi }
            : decode(tx);
        } catch {}
        if (call) {
          const fn = call.functionName,
            args = call.args || [],
            output = (value) =>
              encodeFunctionResult({
                abi: call.abi,
                functionName: fn,
                result: value,
              });
          if (fn === "validateSpec") {
            const errors = validateSpec(args[0], head);
            if (Object.keys(errors).length)
              throw err(
                "Invalid specification: " + Object.values(errors).join(" "),
              );
            return output(undefined);
          }
          if (fn === "specOf") {
            const spec = fixture.state.specs[Number(args[0])];
            if (!spec) throw err("No fixture specification for this ID");
            return output(spec);
          }
          if (fn === "sharedFact") {
            const stored = fixture.state.sharedFacts[Number(args[0])];
            return output(
              stored
                ? [stored.requestId, stored.answerHash, stored.list.length]
                : [zeroHash, zeroHash, 0],
            );
          }
          if (
            [
              "tokenOf",
              "traitsOf",
              "verifiedSpecsOf",
              "hasTrait",
              "verified",
              "pendingOf",
              "firstHourOf",
              "txCountOf",
              "contributedBy",
              "pointsOf",
              "directSnapshot",
            ].includes(fn)
          ) {
            const row = knownWallet(args[0]),
              held = [...row.directFacts, ...row.verifiedFacts],
              active = same(row.address, WALLET),
              id = Number(args[1]);
            if (fn === "tokenOf") return output(BigInt(row.tokenId));
            if (fn === "traitsOf")
              return output(
                held.filter((n) => n < 10001).sort((a, b) => a - b),
              );
            if (fn === "verifiedSpecsOf")
              return output(row.verifiedFacts.filter((n) => n >= 10001));
            if (fn === "hasTrait") return output(held.includes(id));
            if (fn === "verified")
              return output(
                active
                  ? fixture.state.verifiedRecords?.[id] || [
                      zeroHash,
                      zeroHash,
                      0n,
                      0n,
                    ]
                  : row.verifiedFacts.includes(id)
                    ? [
                        "0x" + "88".repeat(32),
                        "0x" + "99".repeat(32),
                        25769870n,
                        25789604n,
                      ]
                    : [zeroHash, zeroHash, 0n, 0n],
              );
            if (fn === "pendingOf")
              return output(
                active
                  ? fixture.state.pending.find(
                      (p) =>
                        !p.cleared && p.id === id && same(p.claimant, WALLET),
                    )?.requestId || zeroHash
                  : row.pendingFacts.includes(id)
                    ? "0x" + "aa".repeat(32)
                    : zeroHash,
              );
            if (fn === "firstHourOf")
              return output([BigInt(row.metrics.hour || 0), row.censusMember]);
            if (fn === "txCountOf")
              return output(BigInt(row.metrics.deposits || 0));
            if (fn === "contributedBy")
              return output(BigInt(row.metrics.largestWei || 0));
            if (fn === "pointsOf")
              return output(BigInt(row.metrics.points || 0));
            if (fn === "directSnapshot")
              return output(
                row.directFacts.reduce(
                  (n, id) =>
                    n |
                    (1n <<
                      BigInt((Math.floor(id / 100) - 1) * 4 + (id % 100) - 1)),
                  0n,
                ),
              );
          }
          if (
            ["ownerOf", "claimantOf", "frozenDirect", "mintedAtBlock"].includes(
              fn,
            )
          ) {
            const row = currentRows().find(
              (w) => w.tokenId !== "0" && w.tokenId === String(args[0]),
            );
            if (!row) throw err("No local card fixture for this token");
            if (fn === "ownerOf") return output(row.owner);
            if (fn === "claimantOf") return output(row.address);
            if (fn === "mintedAtBlock")
              return output(
                same(row.address, WALLET)
                  ? fixture.state.mintedAtBlock || head
                  : 26249900n,
              );
            return output(
              row.directFacts.reduce(
                (n, id) =>
                  n |
                  (1n <<
                    BigInt((Math.floor(id / 100) - 1) * 4 + (id % 100) - 1)),
                0n,
              ),
            );
          }
          if (["tokenURI", "tokenURIOf"].includes(call.functionName))
            return encodeFunctionResult({
              abi: call.abi,
              functionName: call.functionName,
              result: metadata(
                call.functionName === "tokenURI" ? call.args[0] : call.args[1],
                p,
              ),
            });
          if (
            tx.from &&
            [
              "mintCard",
              "approve",
              "execute",
              "upgrade",
              "requestSharedFact",
              "registerSpec",
              "applySharedFact",
              "settle",
              "abandon",
            ].includes(call.functionName)
          )
            validate(call);
        }
      }
    }
    if (p.method === "eth_getBlockByNumber") {
      const block = fixture.answer(p);
      return {
        ...block,
        number: p.params[0] === "latest" ? toHex(head) : p.params[0],
        timestamp: toHex(Math.floor(now() / 1000)),
        transactions: [...transactions.values()]
          .filter(
            (t) =>
              t.receipt?.blockNumber ===
              (p.params[0] === "latest" ? toHex(head) : p.params[0]),
          )
          .map((t) => (p.params[1] ? transactionObject(t) : t.hash)),
      };
    }
    if (p.method === "eth_blockNumber") return toHex(head);
    return fixture.answer(p);
  }
  // Explicit test control, not a real mempool or wallet replacement.
  function replace(original, kind = "speedup") {
    advance();
    const tx = transactions.get(original);
    if (
      !tx ||
      tx.receipt ||
      tx.replacement ||
      !["speedup", "cancel", "revert"].includes(kind)
    )
      throw err(
        "Choose an unreplaced pending transaction and speedup, cancel or revert",
      );
    const replacement = hash();
    const next = {
      ...tx,
      hash: replacement,
      submittedAt: now(),
      readyAt: now() + settings.txDelayMs,
      outcome: kind === "revert" ? "revert" : "success",
    };
    if (kind === "cancel")
      Object.assign(next, {
        to: WALLET,
        data: "0x",
        value: "0x0",
        decoded: { functionName: "cancel", args: [] },
      });
    tx.replacement = replacement;
    transactions.set(replacement, next);
    event("replacement", `Mock ${kind}: ${original} → ${replacement}`);
    return { original, replacement, kind };
  }
  function transactionObject(t) {
    return {
      hash: t.hash,
      from: WALLET,
      to: t.to,
      nonce: toHex(t.nonce),
      gas: "0x186a0",
      gasPrice: "0x3b9aca00",
      maxFeePerGas: "0x77359400",
      maxPriorityFeePerGas: "0x3b9aca00",
      value: t.value || "0x0",
      input: t.data,
      type: "0x2",
      chainId: "0x1",
      blockHash: t.receipt?.blockHash || null,
      blockNumber: t.receipt?.blockNumber || null,
      transactionIndex: t.receipt ? "0x0" : null,
      v: "0x1",
      r: zeroHash,
      s: zeroHash,
    };
  }
  async function rpc(p) {
    if (
      !p ||
      typeof p.method !== "string" ||
      (p.params !== undefined && !Array.isArray(p.params))
    )
      throw err("Invalid RPC payload", -32602);
    advance();
    const params = p.params || [];
    if (p.method === "eth_sendTransaction") {
      if (settings.outcome === "reject")
        throw err(
          "Mock wallet rejected the request; nothing was signed or sent",
          4001,
        );
      const tx = params[0];
      if (
        !tx ||
        !same(tx.from, WALLET) ||
        !/^0x[0-9a-fA-F]{40}$/.test(tx.to || "") ||
        !/^0x[0-9a-fA-F]*$/.test(tx.data || "")
      )
        throw err("Invalid mock transaction", -32602);
      if (settings.chainId !== 1)
        throw err("Switch the mock wallet to Ethereum", 4901);
      if (tx.value !== undefined && !/^0x[0-9a-fA-F]+$/.test(tx.value))
        throw err("Invalid mock transaction value", -32602);
      if (ethBalance < 100000000000000n + BigInt(tx.value || 0))
        throw err("Insufficient ETH for the simulated value and gas");
      const decoded = decode(tx);
      if (
        ![
          "approve",
          "mintCard",
          "execute",
          "upgrade",
          "requestSharedFact",
          "registerSpec",
          "applySharedFact",
          "settle",
          "abandon",
        ].includes(decoded.functionName)
      )
        throw err("Unsupported mock action", -32601);
      const id = hash();
      transactions.set(id, {
        ...tx,
        hash: id,
        decoded,
        nonce: nonce++,
        submittedAt: now(),
        readyAt: now() + settings.txDelayMs,
        outcome: settings.outcome,
      });
      event(
        "submitted",
        `Mock ${decoded.functionName}: waiting ${settings.txDelayMs} ms`,
      );
      return id;
    }
    if (p.method === "eth_getTransactionReceipt")
      return transactions.get(params[0])?.receipt || null;
    if (p.method === "eth_getTransactionByHash") {
      const t = transactions.get(params[0]);
      if (!t) {
        const completion = requests.find(
          (r) => r.completion?.log.transactionHash === params[0],
        )?.completion;
        if (!completion) return null;
        return {
          ...transactionObject({
            hash: params[0],
            nonce: 0,
            to: addresses.intake,
            data: completion.input,
            receipt: completion.log,
          }),
          from: deps[3],
        };
      }
      return transactionObject(t);
    }
    if (p.method === "eth_getTransactionCount") return toHex(nonce);
    if (p.method === "eth_getBalance") return toHex(ethBalance);
    if (p.method === "eth_estimateGas") {
      validate(decode(params[0]));
      return "0x186a0";
    }
    if (["eth_gasPrice", "eth_maxPriorityFeePerGas"].includes(p.method))
      return "0x3b9aca00";
    if (p.method === "eth_chainId") return "0x1";
    if (p.method === "eth_accounts") return [WALLET];
    if (
      ![
        "eth_call",
        "eth_getCode",
        "eth_getBlockByNumber",
        "eth_getLogs",
        "eth_blockNumber",
      ].includes(p.method)
    )
      throw err(`Unsupported mock method ${p.method}`, -32601);
    if (settings.readFailure) throw err("Simulated local RPC outage");
    return answer({ ...p, params });
  }
  function progress(r) {
    const size = r.recipe.panelSize;
    const fraction = Math.max(
      0,
      Math.min(1, (now() - Date.parse(r.createdAt)) / (r.durationMs || 1)),
    );
    const count = r.status !== "assessing" ? size : Math.floor(size * fraction);
    const minority = Math.floor((size === 11 ? 7 : 3) / 2);
    const members = Array.from({ length: size }, (_, i) => {
      const base = {
        agentId: 90000 + i,
        tokenId: i + 1,
        seatTokenId: i + 1,
        workerId: `mock-${i + 1}`,
      };
      if (i >= count) return { ...base, status: "running" };
      if (r.outcome === "failed" && i >= minority * 2)
        return {
          ...base,
          status: "failed",
          ok: false,
          reason: "Mock agent could not obtain sufficient evidence",
        };
      return {
        ...base,
        status: "completed",
        ok: true,
        answer: {
          answer: mockAnswer(
            r.recipe,
            r.outcome === "success" || (r.outcome === "failed" && i < minority),
            WALLET,
          ),
        },
      };
    });
    return {
      id: r.id,
      status: r.status,
      question: r.recipe.question,
      definitions: r.recipe.definitions,
      window: r.recipe.window,
      questionHash: r.questionHash,
      consumer: { chainId: 1, verifyingContract: addresses.Registry },
      createdAt: r.createdAt,
      ...(r.attestedAt ? { attestedAt: r.attestedAt } : {}),
      panelSize: size,
      quorum: size === 11 ? 7 : 3,
      answerType: r.recipe.answerType,
      agreement: {
        agreed: Math.max(
          members.filter(
            (m) =>
              m.ok === true &&
              JSON.stringify(m.answer.answer) ===
                JSON.stringify(mockAnswer(r.recipe, true, WALLET)),
          ).length,
          members.filter(
            (m) =>
              m.ok === true &&
              JSON.stringify(m.answer.answer) ===
                JSON.stringify(mockAnswer(r.recipe, false, WALLET)),
          ).length,
        ),
      },
      members,
      jobId: `mock-${r.id}`,
      mock: true,
    };
  }
  function swarm(path = "/oracle/requests") {
    advance();
    const url = new URL(path, "http://mock.local");
    if (url.pathname.startsWith("/intake/")) {
      const tx = url.pathname.split("/").at(-1);
      return {
        mock: true,
        entries: requests
          .filter((r) => r.transactionHash === tx)
          .map((r) => ({
            requestId: r.requestId,
            admission: { result: { requestId: r.id } },
          })),
      };
    }
    const id = url.pathname.split("/")[3];
    if (id) {
      const found = requests.find((r) => r.id === id);
      return found ? progress(found) : { mock: true, error: "No mock request" };
    }
    return {
      mock: true,
      requests: requests.map(progress),
      entries: [],
      counts: { total: requests.length },
    };
  }
  reset();
  return { rpc, state, configure, reset, swarm, replace, curator };
}
