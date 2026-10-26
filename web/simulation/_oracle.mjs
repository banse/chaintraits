// Simulated IMD oracle for the Sworn mock: every fact request the local Registry sends to the
// stand-in Intake gets a panel whose seats answer over time, the shapes of api.imd.fun's
// /oracle/requests routes, and, once a quorum agrees, a signed attestation delivered on chain.
import { randomUUID } from "node:crypto";
import { defaults, freezeRequest } from "./_settings.mjs";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  hexToString,
  keccak256,
  toHex,
  stringToHex,
  pad,
  parseAbiItem,
  toEventSelector,
} from "viem";
import { A, intakeRequests, registryEvents, factValue } from "./_chain.mjs";

const DEPLOYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const uuidWord = (id) => pad(`0x${id.replaceAll("-", "")}`, { dir: "right", size: 32 });
const iso = (ms) => new Date(ms).toISOString();
const shuffle = (xs, seed) => {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function createOracle(chain, samples, log = () => {}) {
  const records = new Map(); // oracle request id -> record
  const byTx = new Map(); // request transaction hash -> [{ requestId, oracleId }]
  // nextAnswer: true | false | split (no quorum) | stall (no seat answers).
  // delivery: normal | starved (the Intake callback runs out of gas, delivered=false).
  // speed: answer pace multiplier for test runs (the pause before signing is not scaled).
  // pickup: seconds before the plane lists a new request (the site shows its waiting state meanwhile).
  const panel = samples.panel;
  // nextAnswer auto: each seat answers what the sample chain data says (the default).
  // questionWallet other: the listed question names another wallet (tests the site's wallet check).
  // detailJobId false: the request detail omits jobId (the listing keeps it).
  const settings = { ...defaults };
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  function parseBody(hex) {
    try {
      return JSON.parse(hexToString(hex));
    } catch {
      return {};
    }
  }

  async function open({ request, event, txHash, answer, deliver, createdAt, settings: requestSettings, blockNumber }) {
    const config = freezeRequest(requestSettings ?? settings);
    const body = parseBody(request.body);
    const traitId = Number(event.args.traitId);
    const spec = await chain.call(A.registry, chain.abis.Registry, "specOf", [traitId]);
    const kind = Number(spec.kind);
    const panelSize = Number(body.panelSize ?? (kind === 3 || kind >= 5 ? 11 : 5));
    const quorum = Number(body.quorum ?? (kind === 3 || kind >= 5 ? 7 : 3));
    const id = randomUUID();
    const t0 = createdAt ?? Date.now();
    let want = answer ?? config.nextAnswer;
    const claimant = event.args.claimant;
    const truthValue = kind === 3 ? null : factValue(chain, spec, claimant);
    // 601's threshold counts accepted jobs; the sample data only holds the seat, so a seat means true.
    const meets = kind === 3 || (kind === 6 ? truthValue > 0n : truthValue >= BigInt(spec.threshold));
    if (want === "auto") want = meets ? "true" : "false";
    const seed = Number(BigInt(event.args.requestId) % 1000003n);
    const seats = shuffle(panel.seats, seed).slice(0, panelSize);
    // Planned answers: the agreeing answer except every dissentEvery-th seat; "split" never agrees.
    const plan = [];
    const speed = config.speed;
    // Seats can only answer what the plane has listed: the first answer comes after the pickup.
    let at = t0 + Number(config.pickup || 0) * 1000 + (config.firstAnswerSeconds * 1000) / speed;
    for (let i = 0; i < (want === "stall" ? 0 : panelSize); i++) {
      const truth = want === "split" ? i % 2 === 0 : want !== "false";
      const dissent = want !== "split" && panel.dissentEvery > 0 && i % panel.dissentEvery === panel.dissentEvery - 1;
      plan.push({ seat: seats[i], at, truth: dissent ? !truth : truth, figureless: i % 3 === 1 });
      const [lo, hi] = [config.answerEverySeconds, config.answerEverySeconds];
      at += ((lo + ((seed + i * 7) % (hi - lo + 1))) * 1000) / speed;
    }
    const record = {
      id,
      jobId: randomUUID(),
      status: "assessing",
      createdAt: iso(t0),
      updatedAt: iso(t0),
      attestedAt: null,
      chainId: 1,
      question: (() => {
        const q = body.question ?? `Fact ${traitId} for ${claimant}`;
        return config.questionWallet === "other" ? q.replaceAll(claimant.toLowerCase(), "0xbadc0ffee0000000000000000000000000000001") : q;
      })(),
      questionHash: event.args.questionHash,
      window: body.window ?? null,
      answerType: body.answerType ?? (kind <= 2 ? "uint" : kind === 3 ? "address[]" : "bool"),
      evidence: body.evidence ?? "panel",
      definitions: body.definitions ?? {},
      panelSize,
      quorum,
      consumer: { chainId: 1, verifyingContract: A.registry },
      validForSeconds: body.validForSeconds ?? 2592000,
      signer: chain.attester.address.toLowerCase(),
      members: [],
      agreement: null,
      failure: null,
      // Not part of the API answer:
      _seats: seats,
      _plan: plan,
      _config: config,
      _blockNumber: blockNumber,
      _timeline: { requested: t0, admission: t0 + config.pickup * 1000 },
      _attempted: false,
      _deliveryReceipt: null,
      _kind: kind,
      _value: truthValue,
      _spec: spec,
      _traitId: traitId,
      _claimant: event.args.claimant,
      _requestId: event.args.requestId,
      _txHash: txHash,
      _delivered: false,
      _deliverNow: !!deliver,
    };
    records.set(id, record);
    const list = byTx.get(txHash.toLowerCase()) || [];
    list.push({ requestId: event.args.requestId, oracleId: id });
    byTx.set(txHash.toLowerCase(), list);
    log(`oracle ${id.slice(0, 8)}: fact ${traitId} for ${event.args.claimant.slice(0, 8)}…, panel ${panelSize}/${quorum}, answers "${want}"`);
    if (deliver) {
      for (const p of plan) p.at = Math.min(p.at, Date.now());
      await tick(record);
    }
    return record;
  }

  // Seats' answers in the API's shape.
  function answerOf(record, p) {
    const k = record._kind;
    const threshold = BigInt(record._spec.threshold);
    let value, figure;
    if (k <= 2) {
      // The count the chain data gives, moved across the threshold only when the panel is told to.
      const real = record._value ?? 0n;
      const v = p.truth ? (real >= threshold ? real : threshold) : real < threshold ? real : threshold > 0n ? threshold - 1n : 0n;
      value = Number(v);
      figure = value;
    } else if (k === 3) {
      value = p.truth ? sharedList(record) : sharedList(record).slice().reverse();
      figure = value.length;
    } else {
      value = p.truth;
      figure = p.figureless ? null : p.truth ? 38 : 0;
    }
    return { value, figure };
  }

  function sharedList(record) {
    const s = chain.sharedSpecs.find((x) => x.id === record._traitId) || record._spec;
    // Only the spec's own event inside its window: other facts log other events at the same contract.
    const event = parseAbiItem(s.item);
    const sel = toEventSelector(event);
    const totals = new Map();
    for (const l of chain.history.logs) {
      const b = BigInt(l.blockNumber);
      if (l.address !== s.target.toLowerCase() || l.topics[0] !== sel || b < BigInt(s.fromBlock) || b > BigInt(s.toBlock)) continue;
      const { args } = decodeEventLog({ abi: [event], data: l.data, topics: l.topics });
      const who = args[s.arg].toLowerCase();
      totals.set(who, (totals.get(who) || 0n) + BigInt(args[s.sumArg]));
    }
    return [...totals]
      .sort(([a, x], [b, y]) => (x === y ? (BigInt(a) < BigInt(b) ? -1 : 1) : x > y ? -1 : 1))
      .slice(0, Number(s.threshold))
      .map(([a]) => a);
  }

  const key = (v) => JSON.stringify(v);

  async function tick(record) {
    if (record.status !== "assessing" || record._busy) return;
    record._busy = true;
    try {
      const now = Date.now();
      let changed = false;
      while (!record._quorumAt && record.members.length < record._plan.length && record._plan[record.members.length].at <= now) {
        const p = record._plan[record.members.length];
        const { value, figure } = answerOf(record, p);
        record.members.push({
          tokenId: p.seat,
          wallet: `0x${keccak256(stringToHex(`seat ${p.seat}`)).slice(26)}`,
          ok: true,
          reason: null,
          submissionHash: keccak256(stringToHex(`${record.id} ${p.seat}`)).slice(2),
          answer: {
            v: 1,
            requestId: record.id,
            chainId: 1,
            window: record.window,
            answerType: record.answerType,
            answer: value,
            figure: figure === null ? null : String(figure),
            definitions: record.definitions,
            recipe: { kind: record.evidence, source: "local mock chain (127.0.0.1)" },
          },
        });
        changed = true;
      }
      if (changed) { record.updatedAt = iso(now); record._timeline.firstAnswer ??= now; record._timeline.lastAnswer = now; }
      // Agreement on the answer alone (the figure does not split a cluster, as measured live).
      const groups = new Map();
      for (const m of record.members) {
        const k = key(m.answer.answer);
        groups.set(k, [...(groups.get(k) || []), m]);
      }
      const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
      // The plane signs a little after the quorum forms; the site shows "Panel agreed" in between.
      if (best.length >= record.quorum && !record._deliverNow) {
        record._quorumAt ??= now;
        record._timeline.quorum ??= now;
        if (now - record._quorumAt < record._config.attestAfterSeconds * 1000) return;
      }
      if (best.length >= record.quorum) {
        const figure = best.find((m) => m.answer.figure !== null)?.answer.figure ?? null;
        record.status = "attested";
        record.attestedAt = iso(now);
        record._timeline.attested = now;
        record.updatedAt = iso(now);
        record.agreement = {
          agreed: best.length,
          answer: best[0].answer.answer,
          figure,
          quorum: record.quorum,
          cluster: best.map((m) => m.submissionHash),
          recipe: { kind: record.evidence, source: "local mock chain (127.0.0.1)" },
        };
        log(`oracle ${record.id.slice(0, 8)}: attested, ${best.length} of ${record.members.length} agree`);
        record._best = best;
        const delay = record._deliverNow ? 0 : record._config.deliverAfterSeconds * 1000;
        if (record._config.delivery !== "hold" || record._deliverNow) later(() => deliver(record, best).catch((e) => { record._deliveryError = e.message; log(`delivery failed: ${e.message}`); }), delay);
        if (record._deliverNow) await new Promise((r) => setTimeout(r, 10)).then(() => waitDelivered(record));
      } else if (record._plan.length && record.members.length === record._plan.length) {
        record.status = "no_verdict";
        record._timeline.noVerdict = now;
        record.updatedAt = iso(now);
        record.failure = `No verdict: the largest group of equal answers had ${best.length} of ${record.members.length} seats; ${record.quorum} are needed.`;
        log(`oracle ${record.id.slice(0, 8)}: no verdict, best ${best.length} of ${record.members.length}`);
        const delay = record._deliverNow ? 0 : record._config.deliverAfterSeconds * 1000;
        later(() => fail(record, best.length).catch(e => { record._deliveryError = e.message; log(`no-verdict delivery failed: ${e.message}`); }), delay);
      }
    } finally {
      record._busy = false;
    }
  }

  async function waitDelivered(record) {
    for (let i = 0; i < 200 && !record._delivered; i++) await new Promise((r) => setTimeout(r, 25));
  }

  async function deliver(record, best) {
    if (record._attempted || record._delivering) return;
    record._delivering = true;
    record._timeline.deliverySubmitted = Date.now();
    const k = record._kind;
    const pending = await chain.call(A.registry, chain.abis.Registry, "pendingRequest", [record._requestId]);
    const requestedAt = BigInt(pending[2]);
    const latest = await chain.rpc("eth_getBlockByNumber", ["latest", false]);
    const chainNow = BigInt(latest.timestamp);
    const issuedAt = chainNow > requestedAt ? chainNow : requestedAt;
    const value = best[0].answer.answer;
    const answer =
      k === 3
        ? encodeAbiParameters([{ type: "address[]" }], [value])
        : encodeAbiParameters([{ type: "uint256" }], [k <= 2 ? BigInt(value) : value ? 1n : 0n]);
    const w = record.window || {};
    const a = {
      requestId: uuidWord(record.id),
      chainId: 1n,
      questionHash: record.questionHash,
      answerType: k <= 2 ? 3 : k === 3 ? 4 : 0,
      answer,
      figure: BigInt(record.agreement?.figure ?? (k === 3 ? value.length : 0)),
      fromBlock: BigInt(w.fromBlock ?? record._spec.fromBlock),
      toBlock: BigInt(w.toBlock ?? record._spec.toBlock),
      blockHash: w.toBlockHash ?? pad("0x0"),
      panelJobId: uuidWord(record.jobId),
      panelSize: record.panelSize,
      quorum: record.quorum,
      agreed: best.length,
      issuedAt,
      expiresAt: issuedAt + 30n * 86400n - 1n,
    };
    const digest = await chain.call(A.registry, chain.abis.Registry, "attestationDigest", [a]);
    const signature = await chain.attester.sign({ hash: digest });
    const onResult = chain.abis.Registry.find((f) => f.name === "onResult");
    const args = encodeAbiParameters(onResult.inputs, [record._requestId, a, signature]);
    record._attestation = a;
    record._signature = signature;
    const starved = record._config.delivery === "starved";
    if (starved) await chain.tx(DEPLOYER, A.intake, chain.mocks.MockIntake.abi, "setCallbackGas", [30000n]);
    const { hash, receipt } = await chain.sendDelayed(DEPLOYER, A.intake, encodeFunctionData({ abi: chain.mocks.MockIntake.abi, functionName: "complete", args: [record._requestId, 0, keccak256(answer), "", args] }), undefined, record._deliverNow ? 0 : record._config.registrySeconds);
    record._deliveryTx = hash;
    const rc = await receipt;
    if (starved) await chain.tx(DEPLOYER, A.intake, chain.mocks.MockIntake.abi, "setCallbackGas", [0n]);
    captureDelivery(record, rc);
    record._delivering = false;
    const events = record._deliveryReceipt.events;
    log(`oracle ${record.id.slice(0, 8)}: callback delivered=${record._delivered}, Registry emitted ${events.join(", ") || "nothing"}`);
    return rc;
  }

  async function fail(record, agreed) {
    const args = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint8" }, { type: "bytes32" }, { type: "uint16" }, { type: "uint16" }, { type: "bytes" }],
      [record._requestId, 2, stringToHex("no quorum", { size: 32 }), agreed, record.members.length, "0x"],
    );
    record._timeline.deliverySubmitted = Date.now();
    const { hash, receipt } = await chain.sendDelayed(DEPLOYER, A.intake,
      encodeFunctionData({ abi: chain.mocks.MockIntake.abi, functionName: "complete", args: [record._requestId, 2, pad("0x0"), "", args] }),
      undefined, record._deliverNow ? 0 : record._config.registrySeconds);
    record._deliveryTx = hash;
    const rc = await receipt;
    captureDelivery(record, rc);
  }

  function captureDelivery(record, rc) {
    const events = registryEvents(chain, rc).map(e => e.eventName);
    let completed;
    for (const l of rc.logs) {
      if (l.address.toLowerCase() !== A.intake) continue;
      try { const e = decodeEventLog({ abi: chain.mocks.MockIntake.abi, data: l.data, topics: l.topics });
        if (e.eventName === "Completed") completed = e.args;
      } catch {}
    }
    record._attempted = true;
    record._delivered = completed?.delivered === true;
    record._timeline.registryReceipt = Date.now();
    record._deliveryReceipt = { transactionHash: rc.transactionHash, blockNumber: rc.blockNumber,
      status: rc.status, delivered: record._delivered, intakeStatus: completed?.status, events };
  }

  async function release(id) {
    const r = records.get(id);
    if (!r || !r._best) throw Error("No signed result for this oracle id");
    if (r._attempted) throw Error("Delivery already attempted; use recover for a failed callback");
    await deliver(r, r._best);
  }

  async function recover(id) {
    const r = records.get(id);
    if (!r?._attempted || r._delivered || !r._attestation) throw Error("No failed signed callback to recover");
    if (r._recovering) throw Error('Recovery is already pending');
    r._recovering = true;
    let rc;
    try {
      const { hash, receipt } = await chain.sendDelayed(DEPLOYER, A.registry,
        encodeFunctionData({ abi: chain.abis.Registry, functionName: "settle", args: [r._requestId, r._attestation, r._signature] }),
        undefined, r._config.registrySeconds);
      r._recoveryTx = hash;
      r._timeline.recoverySubmitted = Date.now();
      rc = await receipt;
    } finally { r._recovering = false; }
    const events = registryEvents(chain, rc).map(e => e.eventName);
    r._recoveryReceipt = { transactionHash: rc.transactionHash, blockNumber: rc.blockNumber, status: rc.status, events };
    r._timeline.recovered = Date.now();
    return r._recoveryReceipt;
  }

  // A confirmed transaction: one panel per Intake request it opened.
  async function fromReceipt(receipt, opts = {}) {
    const reqs = intakeRequests(chain, receipt);
    const events = registryEvents(chain, receipt).filter((e) => e.eventName === "TraitRequested");
    const out = [];
    for (const event of events) {
      const request = reqs.find((r) => r.requestId === event.args.requestId);
      if (request) out.push(await open({ request, event, txHash: receipt.transactionHash, blockNumber: receipt.blockNumber, ...opts }));
    }
    return out;
  }

  const timer = setInterval(() => {
    for (const r of records.values()) tick(r).catch((e) => log(`oracle tick: ${e.message}`));
  }, 100);

  const publicDetail = (r) => ({
    ...Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_") && (k !== "jobId" || r._config.detailJobId))),
    // Assigned seats are known in this simulator before they submit. Expose
    // their identities in a stable order; pending seats are not valid answers.
    // Keep the internal members array as submitted answers for quorum/delivery.
    members: r._seats.map(tokenId => r.members.find(member => member.tokenId === tokenId) || {
      tokenId,
      wallet: `0x${keccak256(stringToHex(`seat ${tokenId}`)).slice(26)}`,
      ok: null,
      reason: null,
      answer: null,
    }),
  });
  const listingEntry = (r) => ({
    answerType: r.answerType, attestedAt: r.attestedAt, chainId: r.chainId, createdAt: r.createdAt, id: r.id,
    jobId: r.jobId, question: r.question, signer: r.signer, status: r.status, updatedAt: r.updatedAt, window: r.window,
  });

  // GET routes of api.imd.fun the site reads, answered from the records above.
  const listed = (r) => Date.now() - Date.parse(r.createdAt) >= Number(r._config.pickup) * 1000;
  function api(pathname, search) {
    const q = new URLSearchParams(search);
    let m;
    if (pathname === "/oracle/requests") {
      let rows = [...records.values()].filter(listed).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (q.get("q")) rows = rows.filter((r) => r.question.toLowerCase().includes(q.get("q").toLowerCase()));
      if (q.get("status")) rows = rows.filter((r) => r.status === q.get("status"));
      if (q.get("jobId")) rows = rows.filter((r) => r.jobId === q.get("jobId"));
      return { status: 200, body: { requests: rows.slice(0, 100).map(listingEntry) } };
    }
    if ((m = pathname.match(/^\/oracle\/requests\/([A-Za-z0-9-]+)$/))) {
      const r = records.get(m[1]);
      return r && listed(r) ? { status: 200, body: publicDetail(r) } : { status: 404, body: { error: "not_found" } };
    }
    if ((m = pathname.match(/^\/intake\/(\d+)\/(0x[0-9a-fA-F]{64})$/))) {
      const rows = (byTx.get(m[2].toLowerCase()) || []).filter((x) => listed(records.get(x.oracleId)));
      return {
        status: 200,
        body: {
          chainId: Number(m[1]),
          transactionHash: m[2],
          entries: rows.map((x) => ({ requestId: x.requestId, admission: { result: { requestId: x.oracleId, kind: "oracle" } } })),
        },
      };
    }
    return { status: 404, body: { error: "not_found", note: "not served by the local mock" } };
  }

  const byJob = (jobId) => [...records.values()].find((r) => r.jobId === jobId);

  return { fromReceipt, api, settings, records, byJob, publicDetail, release, recover, stop: () => { clearInterval(timer); for (const t of timers) clearTimeout(t); timers.clear(); } };
}
