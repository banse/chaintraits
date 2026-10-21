// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Vm} from "forge-std/Vm.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation} from "../src/Types.sol";

contract GasTest is SwornTest {
    function _cold() private {
        vm.cool(address(registry));
        vm.cool(address(composer));
        vm.cool(address(curator));
        vm.cool(address(token));
        vm.cool(address(intake));
        vm.cool(address(executor));
    }

    function _gasDeliver(bytes32 r, OracleAttestation memory a, bytes memory sig, string memory label) internal {
        bytes memory args = abi.encode(r, a, sig);
        vm.cool(address(registry));
        vm.startStateDiffRecording();
        assertTrue(intake.complete(r, 0, args));
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        uint256 writes;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory s = accesses[i].storageAccesses[j];
                if (s.account == address(registry) && s.isWrite && !s.reverted) {
                    assertTrue(s.previousValue != bytes32(0), "callback wrote a previously zero slot");
                    ++writes;
                }
            }
        }
        uint256 gas = intake.lastGas();
        emit log_named_uint(string.concat(label, " current"), gas);
        emit log_named_uint(string.concat(label, " modeled"), gas + 7200 * writes);
        assertLe(gas + 7200 * writes, 175000);
    }

    function test_coldCatalog601CommunitySharedCallbackBudgets() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        _gasDeliver(r, a, _sign(a), "catalog");
        r = _ask(alice, 601);
        a = _att(r, abi.encode(true));
        _gasDeliver(r, a, _sign(a), "601");
        vm.prank(alice);
        registry.mintCard();
        uint16 id = _register(1);
        r = _ask(alice, id);
        a = _att(r, abi.encode(uint256(1)));
        _gasDeliver(r, a, _sign(a), "first community with card");
        r = _shared(1201);
        a = _att(r, abi.encode(_list(32)));
        _gasDeliver(r, a, _sign(a), "shared 32");
    }

    function test_coldMissReasonsAndOversizeBudgets() public {
        for (uint8 reason = 2; reason <= 10; ++reason) {
            bytes32 r = _ask(alice, 1301);
            OracleAttestation memory a = _att(r, abi.encode(true));
            if (reason == 3) a.chainId = 2;
            else if (reason == 4) a.answerType = 3;
            else if (reason == 5) a.agreed = 1;
            else if (reason == 6) ++a.toBlock;
            else if (reason == 7) --a.issuedAt;
            else if (reason == 8) a.answer = abi.encode(false);
            else if (reason == 9) a.answer = abi.encode(uint256(2));
            else if (reason == 10) a.questionHash = bytes32(uint256(100));
            bytes memory sig = reason == 2 ? new bytes(65) : _sign(a);
            _gasDeliver(r, a, sig, "miss");
            assertFalse(registry.hasTrait(alice, 1301));
        }
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        _gasDeliver(r, a, new bytes(262144), "huge signature");
        r = _ask(alice, 701);
        a = _att(r, new bytes(262144));
        _gasDeliver(r, a, new bytes(65), "huge answer");
    }

    function test_failureNoZeroWritesAndBudget() public {
        uint16 id = _register(1);
        bytes32 r = _ask(alice, id);
        bytes memory args = abi.encode(r, uint8(2), bytes32("disagreed"), uint16(0), uint16(5), new bytes(262144));
        vm.cool(address(registry));
        vm.startStateDiffRecording();
        assertTrue(intake.complete(r, 2, args));
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
        emit log_named_uint("failure modeled", intake.lastGas() + 7200 * writes);
        assertLe(intake.lastGas() + 7200 * writes, 175000);
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
    }

    function _modeled(Vm.AccountAccess[] memory accesses, uint256 gas) internal returns (uint256) {
        uint256 zeros;
        uint256 other;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory s = accesses[i].storageAccesses[j];
                if (s.isWrite && !s.reverted) {
                    if (s.previousValue == 0 && s.newValue != 0) ++zeros;
                    else ++other;
                }
            }
        }
        uint256 result = gas + zeros * 89000 + other * 7200;
        emit log_named_uint("modeled external call", result);
        assertLt(result, 15000000);
        return result;
    }

    function test_costliestMutationsUnderTransactionBudget() public {
        _cold();
        vm.startStateDiffRecording();
        uint256 start = gasleft();
        vm.prank(alice);
        registry.mintCard();
        uint256 spent = start - gasleft();
        _modeled(vm.stopAndReturnStateDiff(), spent);
        _cold();
        vm.startStateDiffRecording();
        start = gasleft();
        _ask(alice, 601);
        spent = start - gasleft();
        _modeled(vm.stopAndReturnStateDiff(), spent);
        Spec memory s = _maxSpec();
        assertEq(bytes(s.item).length, 256);
        _cold();
        vm.startStateDiffRecording();
        start = gasleft();
        uint16 id = registry.registerSpec(s, 0);
        spent = start - gasleft();
        _modeled(vm.stopAndReturnStateDiff(), spent);
        _cold();
        vm.startStateDiffRecording();
        start = gasleft();
        _ask(alice, id);
        spent = start - gasleft();
        _modeled(vm.stopAndReturnStateDiff(), spent);
        bytes32 r = _shared(1201);
        address[] memory list = _list(32);
        list[31] = alice;
        assertTrue(_deliver(r, _att(r, abi.encode(list))));
        _cold();
        vm.startStateDiffRecording();
        start = gasleft();
        vm.prank(alice);
        registry.applySharedFact(1201, list);
        spent = start - gasleft();
        _modeled(vm.stopAndReturnStateDiff(), spent);
    }

    function test_otherExternalMutationsUnderTransactionBudget() public {
        vm.prank(alice);
        registry.mintCard();
        _cold();
        vm.startStateDiffRecording();
        uint256 start = gasleft();
        vm.prank(alice);
        registry.transferFrom(alice, bob, 1);
        _modeled(vm.stopAndReturnStateDiff(), start - gasleft());

        _cold();
        vm.startStateDiffRecording();
        start = gasleft();
        bytes32 r = _shared(1201);
        _modeled(vm.stopAndReturnStateDiff(), start - gasleft());
        vm.warp(block.timestamp + 32 days);
        _cold();
        vm.startStateDiffRecording();
        start = gasleft();
        registry.abandon(r);
        _modeled(vm.stopAndReturnStateDiff(), start - gasleft());

        uint16 id = _register(1);
        r = _ask(alice, id);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        bytes memory sig = _sign(a);
        intake.setStipend(10000);
        assertFalse(intake.complete(r, 0, abi.encode(r, a, sig)));
        _cold();
        vm.startStateDiffRecording();
        start = gasleft();
        registry.settle(r, a, sig);
        _modeled(vm.stopAndReturnStateDiff(), start - gasleft());
    }

    function test_unknownAndReplayedCallbacksTouchNoStorage() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        bytes memory sig = _sign(a);
        assertTrue(_deliver(r, a));
        for (uint256 k; k < 2; ++k) {
            bytes32 id = k == 0 ? r : bytes32(uint256(4321));
            bytes memory input = abi.encodeCall(Registry.onResult, (id, a, sig));
            vm.cool(address(registry));
            vm.startStateDiffRecording();
            assertTrue(intake.raw(address(registry), input));
            Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
            for (uint256 i; i < accesses.length; ++i) {
                for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                    if (accesses[i].storageAccesses[j].account == address(registry)) {
                        assertFalse(accesses[i].storageAccesses[j].isWrite);
                    }
                }
            }
            assertLt(intake.lastGas(), 175000);
        }
    }
}
