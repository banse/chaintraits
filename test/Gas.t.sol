// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation} from "../src/interfaces/Types.sol";
import {Vm} from "forge-std/Vm.sol";

contract GasTest is BaseTest {
    function measured(bytes32 rid, OracleAttestation memory a, bytes memory sig, string memory label) internal {
        bytes memory args = abi.encode(rid, a, sig);
        vm.cool(address(registry));
        vm.startStateDiffRecording();
        assertTrue(intake.complete(rid, 0, bytes32(0), "", args), "delivered");
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        uint256 writes;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory s = accesses[i].storageAccesses[j];
                if (s.account == address(registry) && s.isWrite && !s.reverted) {
                    assertTrue(s.previousValue != bytes32(0), "callback creates state");
                    ++writes;
                }
            }
        }
        uint256 current = intake.callbackUsed();
        uint256 future = current + 7200 * writes;
        emit log_named_uint(string.concat(label, " current"), current);
        emit log_named_uint(string.concat(label, " Glamsterdam"), future);
        assertLe(future, 175000, label);
    }

    function test_callbackGasCatalogCommunityOperatorSharedAndFailure() public {
        bytes32 rid = ask(ALICE, 701);
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
        measured(rid, a, sign(a), "catalog");
        vm.prank(ALICE);
        registry.mintCard();
        uint16 id = register(1);
        rid = ask(ALICE, id);
        a = attestation(rid, abi.encode(uint256(1)));
        measured(rid, a, sign(a), "first community with card");
        rid = ask(ALICE, 601);
        a = attestation(rid, abi.encode(true));
        measured(rid, a, sign(a), "601");
        rid = shared(1201);
        address[] memory list = new address[](32);
        a = attestation(rid, abi.encode(list));
        measured(rid, a, sign(a), "32 addresses");
        rid = ask(ALICE, 801);
        bytes memory args = abi.encode(rid, uint8(2), bytes32("disagreed"), uint16(0), uint16(0), new bytes(262144));
        vm.cool(address(registry));
        vm.startStateDiffRecording();
        assertTrue(intake.complete(rid, 2, bytes32(0), "", args));
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        uint256 writes;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory s = accesses[i].storageAccesses[j];
                if (s.account == address(registry) && s.isWrite && !s.reverted) {
                    assertTrue(s.previousValue != 0);
                    ++writes;
                }
            }
        }
        emit log_named_uint("failure current", intake.callbackUsed());
        emit log_named_uint("failure Glamsterdam", intake.callbackUsed() + 7200 * writes);
        assertLe(intake.callbackUsed() + 7200 * writes, 175000);
    }

    function test_callbackGasEveryMissAndHugeFields() public {
        for (uint8 reason = 2; reason <= 10; ++reason) {
            bytes32 rid = ask(ALICE, 701);
            OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
            if (reason == 3) a.chainId = 2;
            if (reason == 4) a.answerType = 0;
            if (reason == 5) a.agreed = 1;
            if (reason == 6) --a.toBlock;
            if (reason == 7) --a.issuedAt;
            if (reason == 8) a.answer = abi.encode(uint256(0));
            if (reason == 9) a.answer = hex"01";
            if (reason == 10) a.questionHash = 0;
            bytes memory sig = reason == 2 ? new bytes(65) : sign(a);
            measured(rid, a, sig, string.concat("miss ", vm.toString(reason)));
            assertEq(registry.pendingOf(ALICE, 701), bytes32(0));
        }
        bytes32 rid = ask(ALICE, 701);
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
        measured(rid, a, new bytes(262144), "huge signature");
        rid = ask(ALICE, 701);
        a = attestation(rid, new bytes(262144));
        measured(rid, a, new bytes(65), "huge answer");
        // An unknown id returns before looking at either dynamic field.
        vm.cool(address(registry));
        vm.startStateDiffRecording();
        assertTrue(intake.raw(address(registry), abi.encodeCall(registry.onResult, (rid, a, new bytes(262144)))));
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                if (accesses[i].storageAccesses[j].account == address(registry)) {
                    assertFalse(accesses[i].storageAccesses[j].isWrite);
                }
            }
        }
        emit log_named_uint("miss 1 current", intake.callbackUsed());
        emit log_named_uint("miss 1 Glamsterdam", intake.callbackUsed());
        assertLe(intake.callbackUsed(), 175000);
    }

    function test_preparedStorageInvisibleAfterMissFailureAbandon() public {
        vm.prank(ALICE);
        registry.mintCard();
        string memory before = registry.tokenURI(1);
        for (uint256 mode; mode < 3; ++mode) {
            uint16 id = register(1);
            bytes32 rid = ask(ALICE, id);
            if (mode == 0) {
                OracleAttestation memory a = attestation(rid, abi.encode(uint256(0)));
                assertTrue(deliver(rid, a));
            } else if (mode == 1) {
                assertTrue(
                    intake.complete(
                        rid, 1, 0, "", abi.encode(rid, uint8(1), bytes32("body_invalid"), uint16(0), uint16(0), "")
                    )
                );
            } else {
                vm.warp(vm.getBlockTimestamp() + 32 days);
                vm.prank(ALICE);
                registry.abandon(rid);
            }
            assertFalse(registry.hasTrait(ALICE, id));
            assertEq(registry.verifiedSpecsOf(ALICE).length, 0);
            assertEq(registry.traitsOf(ALICE).length, 0);
            (bytes32 r, bytes32 o, uint64 f, uint64 t) = registry.verified(ALICE, id);
            assertEq(r, 0);
            assertEq(o, 0);
            assertEq(f, 0);
            assertEq(t, 0);
            assertEq(registry.tokenURI(1), before);
            rid = shared(1201);
            if (mode == 0) {
                OracleAttestation memory a = attestation(rid, new bytes(0));
                assertTrue(deliver(rid, a));
            } else if (mode == 1) {
                assertTrue(
                    intake.complete(
                        rid, 1, 0, "", abi.encode(rid, uint8(1), bytes32("body_invalid"), uint16(0), uint16(0), "")
                    )
                );
            } else {
                vm.warp(vm.getBlockTimestamp() + 32 days);
                vm.prank(BOB);
                registry.abandon(rid);
            }
            (r, o,) = registry.sharedFact(1201);
            assertEq(r, 0);
            assertEq(o, 0);
            assertEq(registry.sharedPending(1201), 0);
        }
    }
}
