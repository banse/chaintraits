import {
  progressCounts,
  progressStatus,
  sameList,
  walletList,
} from "./oracle-progress.mjs";
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
export const isSharedFact = (id, spec) =>
  id === 1201 || (id >= 10001 && Number(spec?.kind) === 3);
export const unsubmittedFactIds = (ids, results, complete) =>
  complete
    ? []
    : ids.filter(
        (id) =>
          !results.some((step) =>
            step.result?.facts?.some((fact) => fact.id === id),
          ),
      );
export function agentResult(member, spec = null, agreed = null, ended = false) {
  if (member?.ok === false)
    return { kind: "error", icon: "!", label: "Could not answer" };
  if (member?.ok !== true)
    return ended
      ? { kind: "missing", icon: "—", label: "No answer" }
      : { kind: "waiting", icon: "…", label: "Waiting" };
  const value = member.answer?.answer;
  let positive = null;
  if (typeof value === "boolean") positive = value;
  else if (
    [1, 2].includes(Number(spec?.kind)) &&
    /^\d+$/.test(String(value)) &&
    (typeof value !== "number" || Number.isSafeInteger(value))
  )
    positive = BigInt(value) >= BigInt(spec.threshold);
  else if (walletList(value) && agreed) positive = sameList(value, agreed);
  return positive === true
    ? { kind: "positive", icon: "✓", label: "Confirmed" }
    : positive === false
      ? { kind: "negative", icon: "✕", label: "Did not confirm" }
      : { kind: "received", icon: "·", label: "Answer received" };
}
export function verificationPhase({
  fact,
  wallet,
  progress = null,
  spec = null,
  event = null,
  hasFact = null,
  requestConfirmed = false,
}) {
  const matched = event && same(event.args?.requestId, fact.requestId);
  if (
    matched &&
    event.eventName === "Verified" &&
    Number(event.args.traitId) === fact.id &&
    same(event.args.claimant, wallet)
  ) {
    if (hasFact === true)
      return {
        kind: "proven",
        title: "Fact proven for your wallet",
        tone: "positive",
      };
    return {
      kind: "recorded",
      title: "Result delivered · checking your wallet fact",
      tone: "pending",
    };
  }
  if (
    matched &&
    event.eventName === "SharedFactStored" &&
    Number(event.args.factId) === fact.id
  )
    return { kind: "shared", title: "Shared result ready", tone: "positive" };
  if (matched && ["Missed", "NoVerdict", "Abandoned"].includes(event.eventName))
    return {
      kind: "failed",
      title:
        event.eventName === "NoVerdict"
          ? "No verdict · no fact added"
          : event.eventName === "Missed" && Number(event.args.reason) === 8
            ? "Answer false · no fact added"
            : "Verification ended · no fact added",
      tone: "negative",
    };
  if (progress) {
    const counts = progressCounts(progress, spec),
      status = progressStatus(progress);
    const yes = counts.count
      ? counts.met
      : counts.boolean
        ? counts.trueAnswers
        : counts.agreed;
    const no = counts.count
      ? counts.below
      : counts.boolean
        ? counts.falseAnswers
        : 0;
    if (status === "failed")
      return {
        kind: "panel-failed",
        title: "Panel could not complete · checking final outcome",
        tone: "negative",
      };
    if (status === "attested" && yes >= progress.quorum)
      return {
        kind: "approved",
        title: isSharedFact(fact.id, spec)
          ? "Panel approved · saving shared result"
          : "Panel approved · saving your fact",
        tone: "positive",
      };
    if (status === "attested" && no >= progress.quorum)
      return {
        kind: "panel-negative",
        title: "Panel answered false · checking final outcome",
        tone: "negative",
      };
    if (yes >= progress.quorum)
      return {
        kind: "quorum",
        title: "Quorum reached · awaiting panel approval",
        tone: "pending",
      };
  }
  if (!progress && !requestConfirmed)
    return {
      kind: "unconfirmed",
      title: "Checking saved request",
      tone: "pending",
    };
  return {
    kind: "checking",
    title: progress
      ? "Agents are checking your fact"
      : "Request confirmed · waiting for agents",
    tone: "pending",
  };
}
