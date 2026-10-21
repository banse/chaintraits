// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {OracleAttestation} from "../src/Types.sol";
import {AttestationHash} from "../src/AttestationHash.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract HashHarness {
    function digest(OracleAttestation calldata a, uint256 chain, address consumer) external pure returns (bytes32) {
        return AttestationHash.digest(a, chain, consumer);
    }
}

contract AttestationsTest is SwornTest {
    function _type(string memory name) private pure returns (uint8) {
        bytes32 h = keccak256(bytes(name));
        if (h == keccak256("bool")) return 0;
        if (h == keccak256("address")) return 1;
        if (h == keccak256("bytes32")) return 2;
        if (h == keccak256("uint256")) return 3;
        if (h == keccak256("address[]")) return 4;
        if (h == keccak256("bytes32[]")) return 5;
        revert("unknown answer type");
    }

    function test_fiveServedAttestationsRecoverPublishedSigner() public {
        HashHarness h = new HashHarness();
        string[5] memory files = [
            "2026-10-10-link-pilot",
            "2026-10-10-meatbag-consumer",
            "2026-10-11-feed-consumer-v2",
            "2026-10-11-nonce-false",
            "2026-10-11-nonce-true"
        ];
        for (uint256 i; i < 5; ++i) {
            string memory j = vm.readFile(string.concat("reference/attestations/", files[i], ".json"));
            OracleAttestation memory a;
            a.requestId = vm.parseJsonBytes32(j, ".message.requestId");
            a.chainId = vm.parseJsonUint(j, ".message.chainId");
            a.questionHash = vm.parseJsonBytes32(j, ".message.questionHash");
            a.answerType = _type(vm.parseJsonString(j, ".message.answerType"));
            a.answer = vm.parseJsonBytes(j, ".message.answer");
            a.figure = vm.parseUint(vm.parseJsonString(j, ".message.figure"));
            a.fromBlock = uint64(vm.parseJsonUint(j, ".message.fromBlock"));
            a.toBlock = uint64(vm.parseJsonUint(j, ".message.toBlock"));
            a.blockHash = vm.parseJsonBytes32(j, ".message.blockHash");
            a.panelJobId = vm.parseJsonBytes32(j, ".message.panelJobId");
            a.panelSize = uint16(vm.parseJsonUint(j, ".message.panelSize"));
            a.quorum = uint16(vm.parseJsonUint(j, ".message.quorum"));
            a.agreed = uint16(vm.parseJsonUint(j, ".message.agreed"));
            a.issuedAt = uint64(vm.parseJsonUint(j, ".message.issuedAt"));
            a.expiresAt = uint64(vm.parseJsonUint(j, ".message.expiresAt"));
            bytes32 digest = h.digest(
                a, vm.parseJsonUint(j, ".domain.chainId"), vm.parseJsonAddress(j, ".domain.verifyingContract")
            );
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, vm.parseJsonBytes(j, ".signature"));
            assertEq(uint256(err), 0);
            assertEq(signer, vm.parseJsonAddress(j, ".signer"));
        }
    }

    function vector() internal pure returns (OracleAttestation memory a) {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = bytes32(uint256(1));
        a = OracleAttestation({
            requestId: 0x0000000000004000800000000000000100000000000000000000000000000000,
            chainId: 1,
            questionHash: 0x2117f4362ebfa37aa8a8c0fed548604fe09ac46faf8ae7559cd64780f26a46fb,
            answerType: 5,
            answer: abi.encode(ids),
            figure: 12345,
            fromBlock: 100,
            toBlock: 200,
            blockHash: bytes32(uint256(7)),
            panelJobId: 0x0000000000004000800000000000000200000000000000000000000000000000,
            panelSize: 5,
            quorum: 4,
            agreed: 5,
            issuedAt: 1800000000,
            expiresAt: 1800003600
        });
    }

    function test_protocolDigestSignatureAndCallbackSelector() public {
        vm.chainId(11155111);
        vm.warp(1800000000);
        address target = address(0x2748);
        vm.cloneAccount(address(registry), target);
        bytes32 digest = Registry(target).attestationDigest(vector());
        assertEq(digest, 0x95fefa8b7c529852f4e2b6aec888930eb2bf5078e6443a85808e36df19e1325c);
        bytes memory sig =
            hex"a26b14918607eb565af126beb54d3c5d19e923c41506def500b3521a4f9aa6d603ab44fd22f15dd2191732961a7131e4641244add8b0f09f20e6ae64381be8481b";
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        assertEq(uint256(err), 0);
        assertEq(signer, 0x70997970C51812dc3A010C7d01b50e0d17dc79C8);
        assertEq(
            Registry.onResult.selector,
            bytes4(
                keccak256(
                    "onResult(bytes32,(bytes32,uint256,bytes32,uint8,bytes,uint256,uint64,uint64,bytes32,bytes32,uint16,uint16,uint16,uint64,uint64),bytes)"
                )
            )
        );
        assertEq(Registry.onFailure.selector, bytes4(keccak256("onFailure(bytes32,uint8,bytes32,uint16,uint16,bytes)")));
    }
}
