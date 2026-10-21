// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation} from "../src/interfaces/Types.sol";

contract AdversarialTest is BaseTest {
    function test_validSignaturesCannotCrossDomainsOrAuthenticateTampering() public {
        for (uint256 mode; mode < 3; ++mode) {
            bytes32 rid = ask(ALICE, 701);
            OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
            bytes memory sig;
            if (mode == 0) {
                sig = sign(a);
                ++a.figure;
            } else if (mode == 1) {
                vm.chainId(11155111);
                sig = sign(a);
                vm.chainId(1);
            } else {
                vm.etch(BOB, address(registry).code);
                (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNING_KEY, Registry(BOB).attestationDigest(a));
                sig = abi.encodePacked(r, s, v);
            }
            miss(rid, a, sig, 2);
            assertFalse(registry.hasTrait(ALICE, 701));
        }
    }

    function test_everyPanelAndClockSkewCondition() public {
        for (uint256 mode; mode < 4; ++mode) {
            bytes32 rid = ask(ALICE, 701);
            OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
            if (mode == 0) a.panelSize = 4;
            if (mode == 1) {
                a.quorum = 2;
                a.agreed = 2;
            }
            if (mode == 2) a.agreed = 2;
            if (mode == 3) a.issuedAt = uint64(vm.getBlockTimestamp() + 1 hours + 1);
            miss(rid, a, sign(a), mode == 3 ? 7 : 5);
        }
    }

    function test_questionCannotMoveBetweenWalletsOrRequests() public {
        bytes32 first = ask(ALICE, 701);
        bytes32 second = ask(BOB, 701);
        OracleAttestation memory a = attestation(first, abi.encode(uint256(1)));
        miss(second, a, sign(a), 10);
        assertFalse(registry.hasTrait(BOB, 701));
        assertEq(registry.pendingOf(ALICE, 701), first);
        assertTrue(deliver(first, a));
    }

    function test_defensiveBoolAndArrayDecoding() public {
        bytes32 rid = ask(ALICE, 1301);
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(2)));
        miss(rid, a, sign(a), 9);
        for (uint256 mode; mode < 4; ++mode) {
            rid = shared(1201);
            bytes memory answer = abi.encode(new address[](32));
            if (mode == 0) {
                assembly { mstore(add(answer, 32), 64) }
            }
            if (mode == 1) {
                assembly { mstore(add(answer, 64), 31) }
            }
            if (mode == 2) {
                assembly { mstore(add(answer, 96), shl(160, 1)) }
            }
            if (mode == 3) answer = bytes.concat(answer, hex"00");
            a = attestation(rid, answer);
            miss(rid, a, sign(a), 9);
        }
        rid = ask(ALICE, 701);
        assertFalse(
            intake.raw(address(registry), abi.encodePacked(registry.onResult.selector, bytes32(0))),
            "invalid ABI must not decode"
        );
        assertEq(registry.pendingOf(ALICE, 701), rid);
    }

    function test_grammarEveryTypeAndFunctionIdentifierBounds() public {
        Spec memory s = spec(1);
        string[9] memory types_ =
            [string("address"), "bool", "string", "bytes", "bytes1", "bytes32", "uint8", "uint256", "int256[]"];
        for (uint256 i; i < types_.length; ++i) {
            s.item = string.concat("event E(address indexed contributor, ", types_[i], " value)");
            composer.validateSpec(s, 0);
        }
        s = spec(4);
        s.item = "function f(address) view returns (uint256)";
        composer.validateSpec(s, 0);
        s.item = "function ffffffffffffffffffffffffffffffff(address) view returns (uint256)";
        composer.validateSpec(s, 0);
        s.item = "function fffffffffffffffffffffffffffffffff(address) view returns (uint256)";
        vm.expectRevert();
        composer.validateSpec(s, 0);
    }

    function testFuzz_malformedItemsNeverPanic(bytes memory item) public {
        vm.assume(item.length <= 512);
        Spec memory s = spec(1);
        s.item = string(item);
        (bool ok, bytes memory result) =
            address(composer).staticcall(abi.encodeCall(composer.validateSpec, (s, vm.getBlockNumber())));
        if (!ok && result.length >= 4) assertTrue(bytes4(result) != 0x4e487b71, "grammar panic");
    }
}
