// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

struct Spec {
    uint8 kind;
    address target;
    string item;
    string arg;
    string fixedArg;
    uint256 fixedVal;
    string sumArg;
    uint8 op;
    uint256 threshold;
    uint64 fromBlock;
    uint64 toBlock;
    string name;
}

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
