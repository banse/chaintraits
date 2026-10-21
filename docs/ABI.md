# Application ABI handoff

The generated files `docs/abi/Renderer.json`, `docs/abi/Composer.json` and `docs/abi/Registry.json` contain the full compiler ABI, including inherited ERC-721 operations, events and custom errors. Run `python3 tools/export_abi.py --check` against a fresh pinned build to detect drift.

Deployment order and the seven Registry constructor values are in the README. All constructors are nonpayable. There is no initialization call, proxy, external library link or privileged account. Only the manifest contribution writes `launch.json`.

`Spec` field order is: `uint8 kind`, `address target`, `string item`, `string arg`, `string fixedArg`, `uint256 fixedVal`, `string sumArg`, `uint8 op`, `uint256 threshold`, `uint64 fromBlock`, `uint64 toBlock`, `string name`. Kinds 1–5 are registrable; kind 6 is reserved for catalog trait 601.

`OracleAttestation` field order is: `bytes32 requestId`, `uint256 chainId`, `bytes32 questionHash`, `uint8 answerType`, `bytes answer`, `uint256 figure`, `uint64 fromBlock`, `uint64 toBlock`, `bytes32 blockHash`, `bytes32 panelJobId`, `uint16 panelSize`, `uint16 quorum`, `uint16 agreed`, `uint64 issuedAt`, `uint64 expiresAt`.

Callbacks use `onResult(bytes32,OracleAttestation,bytes)` and `onFailure(bytes32,uint8,bytes32,uint16,uint16,bytes)`. The first argument is the Intake id. The attestation's request id is the independently assigned oracle UUID. Its EIP-712 domain is `IdentityMD Oracle`, version `2`, the deployment chain id and this Registry address. The signed question chain remains 1.

`verified` returns `(requestId, oracleRequestId, fromBlock, toBlock)` and returns all zeroes before verification. `pendingRequest` returns `(claimant, traitId, requestedAt, questionHash)` only while pending. `sharedFact` returns `(requestId, answerHash, length)` only after successful shared settlement. Zeroes in these views mean absence; they are not launch configuration values.

Every user transaction is nonpayable. Approve the fixed IMD token before minting, registration or a request; the token has no permit. Use one id per `upgrade`, a current price cap, and `expectedId` for registration when an id matters. Parse the emitted event or return value to learn a newly registered id. The full public surface is in `docs/REBUILD.md` section 2 and the ABI exports.
