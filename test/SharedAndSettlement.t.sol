// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {OracleAttestation} from "../src/Types.sol";

contract SharedAndSettlementTest is SwornTest {
    function test_sharedListStoresOnlyHashAndAppliesOnce() public {
        bytes32 r = _shared(1201);
        address[] memory list = _list(32);
        list[0] = alice;
        OracleAttestation memory a = _att(r, abi.encode(list));
        assertTrue(_deliver(r, a));
        (bytes32 rid, bytes32 hash, uint16 n) = registry.sharedFact(1201);
        assertEq(rid, r);
        assertEq(hash, keccak256(abi.encode(list)));
        assertEq(n, 32);
        assertFalse(registry.hasTrait(alice, 1201));
        vm.prank(alice);
        registry.applySharedFact(1201, list);
        assertTrue(registry.hasTrait(alice, 1201));
        (, bytes32 oid,,) = registry.verified(alice, 1201);
        assertEq(oid, a.requestId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyVerified.selector, alice, 1201));
        registry.applySharedFact(1201, list);
        vm.prank(bob);
        vm.expectRevert(Registry.NotInList.selector);
        registry.applySharedFact(1201, list);
        list[1] = bob;
        vm.prank(bob);
        vm.expectRevert(Registry.ListMismatch.selector);
        registry.applySharedFact(1201, list);
        vm.expectRevert(abi.encodeWithSelector(Registry.FactAlreadyStored.selector, 1201));
        registry.requestSharedFact(1201, 1 ether);
    }

    function test_sharedCommunityAndCardRefresh() public {
        uint16 id = _register(3);
        vm.prank(alice);
        registry.mintCard();
        bytes32 r = _shared(id);
        address[] memory list = _list(32);
        list[0] = alice;
        assertTrue(_deliver(r, _att(r, abi.encode(list))));
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        vm.prank(alice);
        registry.applySharedFact(id, list);
        assertEq(registry.verifiedSpecsOf(alice)[0], id);
        assertTrue(registry.hasTrait(alice, id));
    }

    function test_shortLongLowAddressDirtyAndMalformedListMiss() public {
        for (uint256 i; i < 5; ++i) {
            bytes32 r = _shared(1201);
            address[] memory list = _list(i == 0 ? 31 : i == 1 ? 33 : 32);
            bytes memory answer;
            if (i == 2) list[0] = address(uint160(0x016345785d8a0000));
            answer = abi.encode(list);
            if (i == 3) {
                assembly ("memory-safe") { mstore(add(answer, 96), not(0)) }
            }
            if (i == 4) {
                assembly ("memory-safe") { mstore(add(answer, 32), 64) }
            }
            _miss(r, _att(r, answer), 9);
            (bytes32 got, bytes32 hash, uint16 n) = registry.sharedFact(1201);
            assertEq(got, 0);
            assertEq(hash, 0);
            assertEq(n, 0);
        }
    }

    function test_negativeMeasuredAmountsFixtureRejected() public {
        string memory fixture = vm.readFile("templates/fixtures/negative/1201-grouped-by-data-field.json");
        address[] memory list = vm.parseJsonAddressArray(fixture, ".wrongAnswer");
        assertEq(list.length, 32);
        bytes32 r = _shared(1201);
        _miss(r, _att(r, abi.encode(list)), 9);
    }

    function test_sharedExactPanelAndStrict31DayBoundary() public {
        bytes32 r = _shared(1201);
        OracleAttestation memory a = _att(r, abi.encode(_list(32)));
        a.panelSize = 100;
        _miss(r, a, 5);
        r = _shared(1201);
        a = _att(r, abi.encode(_list(32)));
        a.issuedAt += 1 days;
        a.expiresAt = a.issuedAt + 30 days;
        vm.warp(block.timestamp + 31 days);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(r);
        assertTrue(_deliver(r, a));
    }

    function test_sharedExpiredMissAndAbandonOrderings() public {
        uint16 id = _register(3);
        bytes32 r = _shared(id);
        OracleAttestation memory a = _att(r, abi.encode(_list(32)));
        a.issuedAt += 1 days;
        a.expiresAt = a.issuedAt + 30 days;
        vm.warp(block.timestamp + 31 days + 1);
        _miss(r, a, 7);
        r = _shared(id);
        a = _att(r, abi.encode(_list(32)));
        vm.warp(block.timestamp + 31 days + 1);
        registry.abandon(r);
        assertTrue(intake.raw(address(registry), abi.encodeCall(Registry.onResult, (r, a, _sign(a)))));
        (bytes32 got,,) = registry.sharedFact(id);
        assertEq(got, 0);
    }

    function test_settleRequiresCompletionBeforeAnyOtherCheck() public {
        bytes32 r = _ask(alice, 1301);
        OracleAttestation memory a = _att(r, abi.encode(true));
        bytes memory sig = _sign(a);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, r, 11));
        registry.settle(r, a, sig);
        a.requestId = keccak256("different oracle panel");
        sig = _sign(a);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, r, 11));
        registry.settle(r, a, sig);
        a.panelSize = 100;
        sig = _sign(a);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, r, 11));
        registry.settle(r, a, sig);
    }

    function test_settleTrueUndeliveredByStrangerAndReplayRefused() public {
        uint16 id = _register(1);
        vm.prank(alice);
        registry.mintCard();
        bytes32 r = _ask(alice, id);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        bytes memory sig = _sign(a);
        intake.setStipend(10000);
        assertFalse(intake.complete(r, 0, abi.encode(r, a, sig)));
        assertEq(registry.pendingOf(alice, id), r);
        assertFalse(registry.hasTrait(alice, id));
        vm.prank(bob);
        registry.settle(r, a, sig);
        assertTrue(registry.hasTrait(alice, id));
        assertEq(registry.verifiedSpecsOf(alice)[0], id);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, r));
        registry.settle(r, a, sig);
    }

    function test_settleInvalidVerdictsLeavePending() public {
        bytes32 r = _ask(alice, 1301);
        OracleAttestation memory a = _att(r, abi.encode(true));
        intake.setStipend(10000);
        assertFalse(_deliver(r, a));
        a.answer = abi.encode(false);
        _settleMiss(r, a, 8);
        a.answer = abi.encode(true);
        a.panelSize = 100;
        _settleMiss(r, a, 5);
        a.panelSize = 11;
        a.toBlock += 1;
        _settleMiss(r, a, 6);
        a.toBlock -= 1;
        a.issuedAt -= 1;
        _settleMiss(r, a, 7);
        a.issuedAt += 1;
        bytes memory sig = new bytes(65);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, r, 2));
        registry.settle(r, a, sig);
        assertEq(registry.pendingOf(alice, 1301), r);
    }

    function _settleMiss(bytes32 r, OracleAttestation memory a, uint8 reason) private {
        bytes memory sig = _sign(a);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, r, reason));
        registry.settle(r, a, sig);
        assertEq(registry.pendingOf(alice, 1301), r);
    }

    function test_settleSharedThenApplyAndNoSettleAfterNormalDeliveryOrAbandon() public {
        bytes32 r = _shared(1201);
        address[] memory list = _list(32);
        list[0] = alice;
        OracleAttestation memory a = _att(r, abi.encode(list));
        intake.setStipend(10000);
        assertFalse(_deliver(r, a));
        registry.settle(r, a, _sign(a));
        vm.prank(alice);
        registry.applySharedFact(1201, list);
        assertTrue(registry.hasTrait(alice, 1201));
        intake.setStipend(200000);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        assertTrue(_deliver(r, a));
        bytes memory sig = _sign(a);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, r));
        registry.settle(r, a, sig);
        r = _ask(alice, 801);
        a = _att(r, abi.encode(uint256(1)));
        sig = _sign(a);
        vm.warp(block.timestamp + 32 days);
        vm.prank(alice);
        registry.abandon(r);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, r));
        registry.settle(r, a, sig);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, bytes32(uint256(1))));
        registry.settle(bytes32(uint256(1)), a, sig);
    }
}
