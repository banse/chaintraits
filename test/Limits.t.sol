// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation} from "../src/interfaces/Types.sol";
import {Vm} from "forge-std/Vm.sol";

contract LimitsTest is BaseTest {
    function maximalSpec() internal view returns (Spec memory s) {
        s = spec(2);
        s.name = "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN";
        s.arg = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        s.fixedArg = "ffffffffffffffffffffffffffffffff";
        s.sumArg = "ssssssssssssssssssssssssssssssss";
        s.item = string.concat(
            "event EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE(address indexed ",
            s.arg,
            ", uint256 indexed ",
            s.fixedArg,
            ", uint256 ",
            s.sumArg,
            ", bytes32 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx, bytes32 yyyyyyyyyyyyyyyyyyyyyyyy)"
        );
        s.fixedVal = type(uint256).max;
        s.threshold = type(uint256).max;
        s.toBlock = type(uint64).max;
        s.fromBlock = s.toBlock - 7199;
    }

    function accountCost(Vm.AccountAccess[] memory accesses, uint256 used) internal view returns (uint256 future) {
        future = used;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory s = accesses[i].storageAccesses[j];
                if (s.isWrite && !s.reverted) future += s.previousValue == 0 ? 89000 : 7200;
            }
        }
    }

    function test_largestUserCallsWithinGlamsterdamLimit() public {
        curator.set(ALICE, 0, true, 10, 800 ether, 10000);
        vm.cool(address(registry));
        vm.cool(address(curator));
        vm.cool(address(imd));
        vm.startStateDiffRecording();
        uint256 beforeGas = gasleft();
        vm.prank(ALICE);
        registry.mintCard();
        uint256 used = beforeGas - gasleft();
        uint256 future = accountCost(vm.stopAndReturnStateDiff(), used);
        emit log_named_uint("mint Glamsterdam", future);
        assertLe(future, 15000000);
        vm.startStateDiffRecording();
        beforeGas = gasleft();
        ask(ALICE, 601);
        used = beforeGas - gasleft();
        future = accountCost(vm.stopAndReturnStateDiff(), used);
        emit log_named_uint("601 request Glamsterdam", future);
        assertLe(future, 15000000);
        vm.roll(uint256(type(uint64).max) + 64);
        Spec memory s = maximalSpec();
        assertEq(bytes(s.item).length, 256);
        vm.startStateDiffRecording();
        beforeGas = gasleft();
        uint16 id = registry.registerSpec(s, 0);
        used = beforeGas - gasleft();
        future = accountCost(vm.stopAndReturnStateDiff(), used);
        emit log_named_uint("max registration Glamsterdam", future);
        assertLe(future, 15000000);
        vm.startStateDiffRecording();
        beforeGas = gasleft();
        bytes32 rid = ask(ALICE, id);
        used = beforeGas - gasleft();
        future = accountCost(vm.stopAndReturnStateDiff(), used);
        emit log_named_uint("max kind 2 request Glamsterdam", future);
        assertLe(future, 15000000);
        assertTrue(deliver(rid, attestation(rid, abi.encode(type(uint256).max))));
        rid = shared(1201);
        address[] memory list = new address[](32);
        list[31] = ALICE;
        assertTrue(deliver(rid, attestation(rid, abi.encode(list))));
        vm.startStateDiffRecording();
        beforeGas = gasleft();
        vm.prank(ALICE);
        registry.applySharedFact(1201, list);
        used = beforeGas - gasleft();
        future = accountCost(vm.stopAndReturnStateDiff(), used);
        emit log_named_uint("32 address apply Glamsterdam", future);
        assertLe(future, 15000000);
    }

    function test_maximumStateTokenURIGas() public {
        curator.set(ALICE, 0, true, 10, 800 ether, 10000);
        vm.prank(ALICE);
        registry.mintCard();
        uint16[11] memory oracleIds = [uint16(601), 701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1301];
        for (uint256 i; i < oracleIds.length; ++i) {
            bytes32 rid = ask(ALICE, oracleIds[i]);
            assertTrue(deliver(rid, attestation(rid, abi.encode(uint256(1)))));
        }
        bytes32 sharedId = shared(1201);
        address[] memory list = new address[](32);
        list[0] = ALICE;
        assertTrue(deliver(sharedId, attestation(sharedId, abi.encode(list))));
        vm.prank(ALICE);
        registry.applySharedFact(1201, list);
        vm.roll(uint256(type(uint64).max) + 64);
        Spec memory s = maximalSpec();
        for (uint256 i; i < 32; ++i) {
            uint16 id = registry.registerSpec(s, 0);
            bytes32 rid = ask(ALICE, id);
            assertTrue(deliver(rid, attestation(rid, abi.encode(type(uint256).max))));
        }
        assertEq(registry.traitsOf(ALICE).length, 25);
        assertEq(registry.verifiedSpecsOf(ALICE).length, 32);
        vm.cool(address(registry));
        vm.cool(address(composer));
        vm.cool(address(renderer));
        uint256 beforeGas = gasleft();
        string memory uri = registry.tokenURI(1);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("maximum state tokenURI gas", used);
        emit log_named_uint("maximum state URI bytes", bytes(uri).length);
        assertLe(used, 10317448);
        assertGt(bytes(uri).length, 30000);
    }

    function testFuzz_maximalSpecBodyCaps(uint256 threshold, uint256 fixedVal, uint64 end) public {
        end = uint64(bound(end, 100000, type(uint64).max));
        vm.roll(uint256(end) + 64);
        Spec memory s = maximalSpec();
        s.threshold = bound(threshold, 1, type(uint256).max);
        s.fixedVal = fixedVal;
        s.toBlock = end;
        s.fromBlock = end - 7199;
        composer.validateSpec(s, 0);
        uint16 id = registry.registerSpec(s, 0);
        (bytes memory body,) = registry.composeBody(id, ALICE);
        assertLt(body.length, 16384);
        assertLe(bytes(vm.parseJsonString(string(body), ".question")).length, 1000);
        assertLe(bytes(vm.parseJsonString(string(body), ".definitions.method")).length, 512);
    }

    function test_specIdsEndAt65534() public {
        // The counter is ordinary storage slot 18; this boundary would otherwise require 55,534 registrations.
        vm.store(address(registry), bytes32(uint256(18)), bytes32(uint256(65534)));
        Spec memory s = spec(1);
        assertEq(registry.registerSpec(s, 0), 65534);
        assertEq(registry.nextSpecId(), 65535);
        uint256 before = imd.balanceOf(address(this));
        vm.expectRevert(abi.encodeWithSelector(Registry.UnexpectedSpecId.selector, 0, 65535));
        registry.registerSpec(s, 0);
        assertEq(imd.balanceOf(address(this)), before);
    }
}
