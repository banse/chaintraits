// Receipt identity is independent of wallet/UI reason strings ("repriced", etc.).
const lower = (value) => String(value || "").toLowerCase();
const data = (tx) => lower(tx.input ?? tx.data ?? "0x");
export function sameIntent(original, candidate) {
  return Boolean(
    original &&
    candidate &&
    original.from &&
    candidate.from &&
    original.nonce !== undefined &&
    candidate.nonce !== undefined &&
    lower(original.from) === lower(candidate.from) &&
    BigInt(original.nonce) === BigInt(candidate.nonce) &&
    lower(original.to) === lower(candidate.to) &&
    data(original) === data(candidate) &&
    BigInt(original.value ?? 0) === BigInt(candidate.value ?? 0),
  );
}

export function replacementOutcome(original, candidate, receipt) {
  if (
    !original?.from ||
    original.nonce === undefined ||
    !candidate?.from ||
    candidate.nonce === undefined ||
    lower(original.from) !== lower(candidate.from) ||
    BigInt(original.nonce) !== BigInt(candidate.nonce)
  )
    throw Error("Cannot match this receipt to the preparing sender and nonce.");
  if (receipt.status !== "success")
    return {
      state: "failed",
      error:
        "Transaction reverted. No action success was recorded; prepare again to retry.",
    };
  if (sameIntent(original, candidate))
    return { state: "confirmed", error: undefined };
  if (
    lower(candidate.to) === lower(candidate.from) &&
    data(candidate) === "0x" &&
    BigInt(candidate.value ?? 0) === 0n
  )
    return {
      state: "cancelled",
      error:
        "The wallet cancellation settled. This action was not completed; prepare again when ready.",
    };
  return {
    state: "replaced",
    error:
      "A different transaction settled with this nonce. This action was not completed; prepare again when ready.",
  };
}

export async function resolveReceipt(
  client,
  step,
  receipt,
  candidateHash = receipt.transactionHash,
) {
  const original =
    step.intent || (await client.getTransaction({ hash: step.hash }));
  const candidate = await client.getTransaction({ hash: candidateHash });
  if (!step.hash && !sameIntent(original, candidate))
    throw Error(
      "This hash does not match the saved wallet request. Check sender, nonce, target, calldata and value.",
    );
  return {
    ...replacementOutcome(original, candidate, receipt),
    intent: original,
  };
}
