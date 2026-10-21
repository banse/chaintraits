import { decodeFunctionData, decodeAbiParameters } from "viem";
/** Decode the public Intake completion calldata. Authentication happens in Registry.settle simulation. */
export function decodeCompletion(intakeAbi, registryAbi, requestId, input) {
  const decoded = decodeFunctionData({ abi: intakeAbi, data: input });
  if (
    decoded.functionName !== "complete" ||
    decoded.args[0] !== requestId ||
    decoded.args[1] !== 0
  )
    throw Error(
      "Completion calldata does not match this successful oracle request.",
    );
  const onResult = registryAbi.find(
    (e) => e.name === "onResult" && e.type === "function",
  );
  if (!onResult)
    throw Error("Runtime Registry ABI has no onResult definition.");
  const result = decodeAbiParameters(onResult.inputs, decoded.args[4]);
  if (result[0] !== requestId) throw Error("Completion request mismatch.");
  return { attestation: result[1], signature: result[2] };
}
