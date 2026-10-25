// Read-only preflight. An unavailable gas estimate must not unlock submission.
export async function checkSubmission(client, request) {
  const simulated = await client.simulateContract(request);
  const gas = BigInt(await client.estimateContractGas(request));
  if (gas <= 0n) throw Error('A positive gas estimate is required. Retry the check.');
  let cost;
  try { cost = gas * BigInt(await client.getGasPrice()); }
  catch { /* A missing price stays unavailable; no fiat or zero is invented. */ }
  return { request: simulated.request, gas, cost };
}
