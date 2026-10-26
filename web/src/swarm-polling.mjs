/** Resume after the last successful scan, retaining the normal overlap.
 * A sleeping/offline browser may have missed a terminal event outside the
 * current head's window, so only the previous scan may bound this read.
 */
export function pendingOutcomeRead(pending, window = 600n) {
  const overlapFrom = pending.outcomesThrough === undefined
    ? pending.blockNumber
    : pending.outcomesThrough - window + 1n;
  return { fromBlock: overlapFrom > pending.blockNumber ? overlapFrom : pending.blockNumber };
}
