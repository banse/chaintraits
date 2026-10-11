// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The oracle's EIP-712 attestation, exactly as the plane signs it (15 fields, this order,
///         these names; INTEGRATION.md section 4). `requestId` is the plane's UUID right-padded to
///         32 bytes, never the Intake's id.
struct OracleAttestation {
    bytes32 requestId;
    uint256 chainId;
    bytes32 questionHash;
    uint8 answerType;
    bytes answer;
    uint256 figure;
    uint64 fromBlock;
    uint64 toBlock;
    bytes32 blockHash;
    bytes32 panelJobId;
    uint16 panelSize;
    uint16 quorum;
    uint16 agreed;
    uint64 issuedAt;
    uint64 expiresAt;
}

/// @notice The two callbacks Intake v2 `complete` reaches: the result on status 0 and the failure
///         hook on status 1 (refused) or 2 (ended without a result).
interface IOracleConsumer {
    function onResult(bytes32 requestId, OracleAttestation calldata a, bytes calldata signature) external;

    function onFailure(
        bytes32 requestId,
        uint8 status,
        bytes32 reason,
        uint16 agreed,
        uint16 answered,
        bytes calldata signature
    ) external;
}
