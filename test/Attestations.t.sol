// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {OracleAttestation} from "../src/interfaces/Types.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract AttestationsTest is BaseTest {
    bytes32 constant VECTOR_DIGEST = 0x95fefa8b7c529852f4e2b6aec888930eb2bf5078e6443a85808e36df19e1325c;
    bytes constant VECTOR_SIGNATURE =
        hex"a26b14918607eb565af126beb54d3c5d19e923c41506def500b3521a4f9aa6d603ab44fd22f15dd2191732961a7131e4641244add8b0f09f20e6ae64381be8481b";

    function answerCode(string memory name) public pure returns (uint8) {
        bytes32 h = keccak256(bytes(name));
        if (h == keccak256("bool")) return 0;
        if (h == keccak256("address")) return 1;
        if (h == keccak256("bytes32")) return 2;
        if (h == keccak256("uint256")) return 3;
        if (h == keccak256("address[]")) return 4;
        if (h == keccak256("bytes32[]")) return 5;
        revert("unknown answerType");
    }

    function load(string memory file)
        internal
        view
        returns (OracleAttestation memory a, address domain, bytes memory sig, address signer, uint256 chain)
    {
        string memory j = vm.readFile(string.concat("reference/attestations/", file, ".json"));
        domain = vm.parseJsonAddress(j, ".domain.verifyingContract");
        chain = vm.parseJsonUint(j, ".domain.chainId");
        sig = vm.parseJsonBytes(j, ".signature");
        signer = vm.parseJsonAddress(j, ".signer");
        a.requestId = vm.parseJsonBytes32(j, ".message.requestId");
        a.chainId = vm.parseJsonUint(j, ".message.chainId");
        a.questionHash = vm.parseJsonBytes32(j, ".message.questionHash");
        a.answerType = answerCode(vm.parseJsonString(j, ".message.answerType"));
        a.answer = vm.parseJsonBytes(j, ".message.answer");
        a.figure = vm.parseJsonUint(j, ".message.figure");
        a.fromBlock = uint64(vm.parseJsonUint(j, ".message.fromBlock"));
        a.toBlock = uint64(vm.parseJsonUint(j, ".message.toBlock"));
        a.blockHash = vm.parseJsonBytes32(j, ".message.blockHash");
        a.panelJobId = vm.parseJsonBytes32(j, ".message.panelJobId");
        a.panelSize = uint16(vm.parseJsonUint(j, ".message.panelSize"));
        a.quorum = uint16(vm.parseJsonUint(j, ".message.quorum"));
        a.agreed = uint16(vm.parseJsonUint(j, ".message.agreed"));
        a.issuedAt = uint64(vm.parseJsonUint(j, ".message.issuedAt"));
        a.expiresAt = uint64(vm.parseJsonUint(j, ".message.expiresAt"));
    }

    function test_fiveServedProtocolSignaturesAndWrongDomain() public {
        string[5] memory files = [
            string("2026-10-10-link-pilot"),
            "2026-10-10-meatbag-consumer",
            "2026-10-11-nonce-true",
            "2026-10-11-nonce-false",
            "2026-10-11-feed-consumer-v2"
        ];
        for (uint256 i; i < files.length; ++i) {
            (OracleAttestation memory a, address domain, bytes memory sig, address signer, uint256 chain) =
                load(files[i]);
            vm.chainId(chain);
            vm.etch(domain, address(registry).code);
            bytes32 digest = Registry(domain).attestationDigest(a);
            assertEq(ECDSA.recover(digest, sig), signer, files[i]);
            assertTrue(ECDSA.recover(registry.attestationDigest(a), sig) != signer, "domain binding");
        }
        vm.expectRevert(bytes("unknown answerType"));
        this.answerCode("boolean");
    }

    function vector() internal pure returns (OracleAttestation memory a) {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = bytes32(uint256(1));
        a.requestId = 0x0000000000004000800000000000000100000000000000000000000000000000;
        a.chainId = 1;
        a.questionHash = 0x2117f4362ebfa37aa8a8c0fed548604fe09ac46faf8ae7559cd64780f26a46fb;
        a.answerType = 5;
        a.answer = abi.encode(ids);
        a.figure = 12345;
        a.fromBlock = 100;
        a.toBlock = 200;
        a.blockHash = bytes32(uint256(7));
        a.panelJobId = 0x0000000000004000800000000000000200000000000000000000000000000000;
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 5;
        a.issuedAt = 1800000000;
        a.expiresAt = 1800003600;
    }

    function test_protocolVectorDigestRecoveryAndCanonicalSelector() public {
        vm.chainId(11155111);
        address consumer = address(0x2748);
        vm.etch(consumer, address(registry).code);
        assertEq(Registry(consumer).attestationDigest(vector()), VECTOR_DIGEST);
        assertEq(ECDSA.recover(VECTOR_DIGEST, VECTOR_SIGNATURE), 0x70997970C51812dc3A010C7d01b50e0d17dc79C8);
        assertEq(
            Registry.onResult.selector,
            bytes4(
                keccak256(
                    "onResult(bytes32,(bytes32,uint256,bytes32,uint8,bytes,uint256,uint64,uint64,bytes32,bytes32,uint16,uint16,uint16,uint64,uint64),bytes)"
                )
            )
        );
    }

    function test_protocolCanonicalDocumentVector() public pure {
        bytes memory document =
            hex"7b22616e7377657254797065223a22627974657333325b5d222c22636861696e4964223a312c22646566696e6974696f6e73223a7b2264656e6f6d696e6174696f6e223a22574554482c2073756d6d656420617320746865206162736f6c757465207377617070656420616d6f756e74206f6e2074686520574554482073696465227d2c2268656164223a312c227175657374696f6e223a22576869636820556e697377617020763420706f6f6c2064696420746865206d6f7374205745544820766f6c756d6520696e20746865206c617374206461793f222c2276223a312c2277696e646f77223a7b2266726f6d426c6f636b223a3130302c22746f426c6f636b223a3230307d7d";
        assertEq(keccak256(document), 0x2117f4362ebfa37aa8a8c0fed548604fe09ac46faf8ae7559cd64780f26a46fb);
    }
}
