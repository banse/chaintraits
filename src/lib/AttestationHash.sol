// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {OracleAttestation} from "../interfaces/Types.sol";

library AttestationHash {
    bytes32 internal constant TYPEHASH = keccak256(
        "OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,uint8 answerType,bytes answer,uint256 figure,uint64 fromBlock,uint64 toBlock,bytes32 blockHash,bytes32 panelJobId,uint16 panelSize,uint16 quorum,uint16 agreed,uint64 issuedAt,uint64 expiresAt)"
    );

    function digest(OracleAttestation calldata a, address consumer) internal view returns (bytes32) {
        bytes32 ds = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("IdentityMD Oracle"),
                keccak256("2"),
                block.chainid,
                consumer
            )
        );
        bytes32[16] memory w;
        w[0] = TYPEHASH;
        w[1] = a.requestId;
        w[2] = bytes32(a.chainId);
        w[3] = a.questionHash;
        w[4] = bytes32(uint256(a.answerType));
        w[5] = keccak256(a.answer);
        w[6] = bytes32(a.figure);
        w[7] = bytes32(uint256(a.fromBlock));
        w[8] = bytes32(uint256(a.toBlock));
        w[9] = a.blockHash;
        w[10] = a.panelJobId;
        w[11] = bytes32(uint256(a.panelSize));
        w[12] = bytes32(uint256(a.quorum));
        w[13] = bytes32(uint256(a.agreed));
        w[14] = bytes32(uint256(a.issuedAt));
        w[15] = bytes32(uint256(a.expiresAt));
        return keccak256(abi.encodePacked(hex"1901", ds, keccak256(abi.encodePacked(w))));
    }
}
