// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {OracleAttestation} from "../src/interfaces/Types.sol";

contract SettlementTest is BaseTest {
    bytes32 private preparedRequest;
    uint16 private preparedId;

    function setUp() public override {
        super.setUp();
        vm.prank(ALICE);
        registry.mintCard();
        preparedId = register(1);
        preparedRequest = ask(ALICE, preparedId);
    }

    function test_settleUndeliveredTrueByStrangerAndReplay() public {
        uint16 id = preparedId;
        bytes32 rid = preparedRequest;
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
        bytes memory sig = sign(a);
        intake.setGas(40000);
        vm.cool(address(registry));
        assertFalse(deliverSig(rid, a, sig));
        assertEq(registry.pendingOf(ALICE, id), rid);
        assertFalse(registry.hasTrait(ALICE, id));
        vm.expectEmit(true, true, false, true, address(registry));
        emit Registry.Verified(ALICE, id, rid, a.requestId);
        vm.prank(BOB);
        registry.settle(rid, a, sig);
        assertTrue(registry.hasTrait(ALICE, id));
        assertEq(registry.verifiedSpecsOf(ALICE).length, 1);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, rid));
        registry.settle(rid, a, sig);
    }

    function test_settleRejectsMissesWithoutClearing() public {
        uint8[4] memory reasons = [uint8(8), 2, 6, 7];
        for (uint256 i; i < 4; ++i) {
            uint16 id = register(5);
            bytes32 rid = ask(ALICE, id);
            OracleAttestation memory a = attestation(rid, abi.encode(true));
            if (i == 0) a.answer = abi.encode(false);
            if (i == 2) --a.toBlock;
            if (i == 3) --a.issuedAt;
            bytes memory sig = i == 1 ? new bytes(65) : sign(a);
            vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, rid, reasons[i]));
            vm.prank(BOB);
            registry.settle(rid, a, sig);
            assertEq(registry.pendingOf(ALICE, id), rid);
            assertFalse(registry.hasTrait(ALICE, id));
        }
    }

    function test_settleAfterDeliveryAbandonUnknownAndShared() public {
        bytes32 rid = ask(ALICE, 701);
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
        bytes memory sig = sign(a);
        assertTrue(deliverSig(rid, a, sig));
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, rid));
        registry.settle(rid, a, sig);
        rid = ask(ALICE, 801);
        a = attestation(rid, abi.encode(uint256(1)));
        sig = sign(a);
        vm.warp(vm.getBlockTimestamp() + 32 days);
        vm.prank(ALICE);
        registry.abandon(rid);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, rid));
        registry.settle(rid, a, sig);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, bytes32(uint256(42))));
        registry.settle(bytes32(uint256(42)), a, sig);
        rid = shared(1201);
        address[] memory list = new address[](32);
        list[0] = ALICE;
        a = attestation(rid, abi.encode(list));
        sig = sign(a);
        vm.prank(BOB);
        registry.settle(rid, a, sig);
        vm.prank(ALICE);
        registry.applySharedFact(1201, list);
        assertTrue(registry.hasTrait(ALICE, 1201));
    }
}
