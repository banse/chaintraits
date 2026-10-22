import { MISS_REASONS } from "./pure.mjs";

export const NO_FACT =
  "No fact was added. The request price is spent; you can request this fact again.";
export function registryOutcome(event) {
  if (event?.eventName === "Verified")
    return "Stored by the Registry; your card shows the fact.";
  if (event?.eventName === "Missed")
    return `Not stored by the Registry: ${MISS_REASONS[Number(event.args.reason)] ?? event.args.reason}. The request price is spent; you can request this fact again.`;
  if (event?.eventName === "NoVerdict" || event?.eventName === "Abandoned")
    return NO_FACT;
  return null;
}
export function lastPersonalRequests(events, wallet) {
  const requests = new Map(),
    last = new Map();
  for (const event of events) {
    if (
      event.eventName !== "TraitRequested" ||
      event.args.claimant.toLowerCase() !== wallet.toLowerCase()
    )
      continue;
    requests.set(event.args.requestId.toLowerCase(), event);
    last.set(Number(event.args.traitId), { request: event });
  }
  // A request ends once (Abandoned, Verified, Missed or NoVerdict). A later
  // event for the same request id, such as Missed(id, 0, 1), never replaces it.
  for (const event of events) {
    if (event.eventName === "TraitRequested") continue;
    const request = requests.get(event.args.requestId?.toLowerCase());
    const entry = request && last.get(Number(request.args.traitId));
    if (entry?.request === request && !entry.outcome)
      last.set(Number(request.args.traitId), { request, outcome: event });
  }
  return [...last].filter(([, { outcome }]) =>
    ["Missed", "NoVerdict", "Abandoned"].includes(outcome?.eventName),
  );
}
export function lastRequestText(event, timestamp) {
  const time =
    new Date(Number(timestamp) * 1000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ") + " UTC";
  const result =
    event.eventName === "Missed"
      ? Number(event.args.reason) === 8
        ? "answer false"
        : `not stored, ${MISS_REASONS[Number(event.args.reason)] ?? event.args.reason}`
      : event.eventName === "NoVerdict"
        ? "no verdict"
        : "abandoned";
  return `Last request ${time}: ${result}`;
}
