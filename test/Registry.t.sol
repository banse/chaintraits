// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation} from "../src/interfaces/Types.sol";
import {Vm} from "forge-std/Vm.sol";

contract RegistryTest is BaseTest {
    function test_feesForwardedAndAtomicFailure() public {
        vm.prank(ALICE);
        assertEq(registry.mintCard(), 1);
        assertEq(imd.balanceOf(address(sink)), 0.1 ether);
        assertEq(imd.balanceOf(address(registry)), 0);
        register(1);
        assertEq(imd.balanceOf(address(sink)), 6.5 ether);
        assertEq(imd.balanceOf(address(registry)), 0);
        imd.setFail(true);
        vm.prank(BOB);
        vm.expectRevert();
        registry.mintCard();
        assertEq(registry.tokenOf(BOB), 0);
        assertEq(registry.totalSupply(), 1);
        Spec memory s = spec(1);
        vm.expectRevert();
        registry.registerSpec(s, 0);
        assertEq(registry.nextSpecId(), 10002);
    }

    function test_forwardFailureRollsBackPullAndNonReceiverCanMint() public {
        uint256 payerBefore = imd.balanceOf(BOB);
        imd.setFailForward(true);
        vm.prank(BOB);
        vm.expectRevert();
        registry.mintCard();
        assertEq(imd.balanceOf(BOB), payerBefore);
        assertEq(imd.balanceOf(address(registry)), 0);
        assertEq(imd.balanceOf(address(sink)), 0);
        assertEq(registry.totalSupply(), 0);
        imd.setFailForward(false);
        assertEq(registry.mintCard(), 1);
        assertEq(registry.claimantOf(1), address(this));
        vm.deal(address(this), 1);
        (bool ok,) = address(registry).call{value: 1}(abi.encodeCall(registry.mintCard, ()));
        assertFalse(ok);
    }

    function test_transferPreservesFactsAndBuyerIndependence() public {
        curator.set(ALICE, 0, true, 10, 800 ether, 10000);
        vm.prank(ALICE);
        uint256 id = registry.mintCard();
        uint32 frozen = registry.frozenDirect(id);
        curator.set(ALICE, 20, false, 0, 0, 0);
        assertTrue(registry.hasTrait(ALICE, 202));
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.MetadataUpdate(id);
        vm.prank(ALICE);
        registry.transferFrom(ALICE, BOB, id);
        assertEq(registry.claimantOf(id), ALICE);
        assertEq(registry.tokenOf(ALICE), id);
        assertEq(registry.frozenDirect(id), frozen);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyMinted.selector, ALICE));
        registry.mintCard();
        bytes32 a = ask(ALICE, 701);
        assertTrue(deliver(a, attestation(a, abi.encode(uint256(1)))));
        assertTrue(registry.hasTrait(ALICE, 701));
        assertFalse(registry.hasTrait(BOB, 701));
        bytes32 b = ask(BOB, 601);
        assertTrue(deliver(b, attestation(b, abi.encode(true))));
        assertTrue(registry.hasTrait(BOB, 601));
        assertFalse(registry.hasTrait(ALICE, 601));
        vm.prank(BOB);
        uint256 own = registry.mintCard();
        assertEq(own, 2);
        assertEq(registry.claimantOf(own), BOB);
        b = ask(BOB, 801);
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.MetadataUpdate(own);
        assertTrue(deliver(b, attestation(b, abi.encode(uint256(1)))));
        assertEq(registry.frozenDirect(id), frozen);
        assertEq(registry.claimantOf(id), ALICE);
    }

    function test_upgradeGuardsPriceAndAllowance() public {
        uint256 before = imd.balanceOf(ALICE);
        vm.prank(ALICE);
        vm.expectRevert(Registry.NoTraits.selector);
        registry.upgrade(new uint16[](0), 1 ether);
        uint16[] memory two = new uint16[](2);
        two[0] = 701;
        two[1] = 801;
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.TooManyTraits.selector, 2));
        registry.upgrade(two, 1 ether);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotAnOracleTrait.selector, 101));
        registry.upgrade(one(101), 1 ether);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotASharedFact.selector, 1201));
        registry.upgrade(one(1201), 1 ether);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.PriceAboveMax.selector, 0.5 ether, 0.4 ether));
        registry.upgrade(one(701), 0.4 ether);
        intake.setPrice(0);
        vm.prank(ALICE);
        vm.expectRevert(Registry.ZeroPrice.selector);
        registry.upgrade(one(701), 1 ether);
        assertEq(imd.balanceOf(ALICE), before);
        intake.setPrice(0.5 ether);
        vm.expectCall(
            address(intake),
            abi.encodeWithSignature("priceOf(bytes32,address)", registry.ACTION(), address(imd)),
            uint64(1)
        );
        bytes32 rid = ask(ALICE, 701);
        assertEq(imd.allowance(address(registry), address(intake)), 0);
        assertEq(imd.balanceOf(address(registry)), 0);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyPending.selector, ALICE, 701));
        registry.upgrade(one(701), 1 ether);
        assertTrue(deliver(rid, attestation(rid, abi.encode(uint256(1)))));
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyVerified.selector, ALICE, 701));
        registry.upgrade(one(701), 1 ether);
    }

    function test_reusedRequestIdRollsBackPaymentAndApproval() public {
        bytes32 rid = ask(ALICE, 701);
        intake.forceId(rid);
        uint256 before = imd.balanceOf(BOB);
        uint256 intakeBefore = imd.balanceOf(address(intake));
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(Registry.RequestIdTaken.selector, rid));
        registry.upgrade(one(801), 1 ether);
        assertEq(imd.balanceOf(BOB), before);
        assertEq(imd.balanceOf(address(intake)), intakeBefore);
        assertEq(imd.allowance(address(registry), address(intake)), 0);
        assertEq(registry.pendingOf(BOB, 801), bytes32(0));
        vm.warp(vm.getBlockTimestamp() + 32 days);
        vm.prank(ALICE);
        registry.abandon(rid);
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(Registry.RequestIdTaken.selector, rid));
        registry.upgrade(one(801), 1 ether);
    }

    function test_abandonSharedAndPersonalStrictBoundary() public {
        bytes32 a = ask(ALICE, 701);
        bytes32 b = shared(1201);
        uint256 start = vm.getBlockTimestamp();
        vm.warp(start + 15 days);
        vm.prank(BOB);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(b);
        vm.warp(start + 31 days);
        vm.prank(ALICE);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(a);
        vm.prank(BOB);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(b);
        vm.warp(start + 32 days);
        vm.prank(BOB);
        registry.abandon(b);
        assertEq(registry.sharedPending(1201), bytes32(0));
        vm.prank(BOB);
        vm.expectRevert(Registry.NotClaimant.selector);
        registry.abandon(a);
        vm.prank(ALICE);
        registry.abandon(a);
        assertEq(registry.pendingOf(ALICE, 701), bytes32(0));
        bytes32 successor = ask(ALICE, 701);
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.Missed(a, 0, 1);
        assertTrue(
            intake.raw(
                address(registry),
                abi.encodeCall(registry.onResult, (a, attestation(successor, abi.encode(uint256(1))), new bytes(65)))
            )
        );
        assertEq(registry.pendingOf(ALICE, 701), successor);
    }

    function test_datesRejectEarlyLateAndLongThenRetry() public {
        for (uint256 mode; mode < 3; ++mode) {
            bytes32 rid = ask(ALICE, 701);
            OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
            if (mode == 0) --a.issuedAt;
            if (mode == 1) {
                a.issuedAt += 2 days;
                vm.warp(a.issuedAt);
                a.expiresAt = a.issuedAt + 30 days;
            }
            if (mode == 2) a.expiresAt = a.issuedAt + 31 days;
            miss(rid, a, sign(a), 7);
            assertEq(registry.pendingOf(ALICE, 701), bytes32(0));
        }
        bytes32 rid = ask(ALICE, 701);
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
        a.issuedAt += 23 hours;
        a.expiresAt = a.issuedAt + 30 days;
        vm.warp(a.issuedAt);
        assertTrue(deliver(rid, a));
        assertTrue(registry.hasTrait(ALICE, 701));
    }

    function test_datesExactLastSecondBothKindsBothOrderings() public {
        for (uint256 mode; mode < 4; ++mode) {
            address user = address(uint160(0xc1b0 + mode));
            fund(user);
            uint16 id = mode % 2 == 0 ? uint16(701) : register(3);
            bytes32 rid = mode % 2 == 0 ? ask(user, id) : shared(id);
            address[] memory list = new address[](32);
            list[0] = user;
            OracleAttestation memory a = attestation(rid, mode % 2 == 0 ? abi.encode(uint256(1)) : abi.encode(list));
            uint256 start = vm.getBlockTimestamp();
            a.issuedAt = uint64(start + 1 days);
            a.expiresAt = uint64(start + 31 days);
            bytes memory sig = sign(a);
            vm.warp(start + 31 days);
            vm.prank(user);
            vm.expectRevert(Registry.TooEarly.selector);
            registry.abandon(rid);
            if (mode < 2) {
                assertTrue(deliverSig(rid, a, sig));
            } else {
                vm.warp(start + 31 days + 1);
                miss(rid, a, sig, 7);
                rid = mode % 2 == 0 ? ask(user, id) : shared(id);
                a = attestation(rid, mode % 2 == 0 ? abi.encode(uint256(1)) : abi.encode(list));
                sig = sign(a);
                vm.warp(vm.getBlockTimestamp() + 31 days + 1);
                vm.prank(user);
                registry.abandon(rid);
                vm.expectEmit(false, false, false, true, address(registry));
                emit Registry.Missed(rid, 0, 1);
                assertTrue(deliverSig(rid, a, sig));
            }
        }
    }

    function test_livingWindowStoredAfterHeadAdvances() public {
        bytes32 rid = ask(ALICE, 601);
        OracleAttestation memory a = attestation(rid, abi.encode(true));
        uint64 end = a.toBlock;
        vm.roll(vm.getBlockNumber() + 1000);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        assertTrue(deliver(rid, a));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        (,, uint64 from, uint64 to) = registry.verified(ALICE, 601);
        assertEq(from, 25090085);
        assertEq(to, end);
        assertTrue(registry.hasTrait(ALICE, 601));
        assertFalse(registry.hasDirectTrait(ALICE, 601));
        uint16[] memory ids = registry.traitsOf(ALICE);
        assertEq(ids.length, 1);
        assertEq(ids[0], 601);
        vm.prank(ALICE);
        registry.mintCard();
        string memory uri = registry.tokenURI(1);
        assertGt(bytes(uri).length, 0);
        rid = ask(BOB, 601);
        a = attestation(rid, abi.encode(true));
        --a.toBlock;
        miss(rid, a, sign(a), 6);
    }

    function test_missesAllReasonsAndPrecedence() public {
        for (uint8 reason = 2; reason <= 10; ++reason) {
            bytes32 rid = ask(ALICE, 701);
            OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
            if (reason == 2) a.figure = 123;
            if (reason == 3) a.chainId = 11155111;
            if (reason == 4) a.answerType = 0;
            if (reason == 5) a.agreed = 2;
            if (reason == 6) --a.toBlock;
            if (reason == 7) a.expiresAt = uint64(vm.getBlockTimestamp() - 1);
            if (reason == 8) a.answer = abi.encode(uint256(0));
            if (reason == 9) a.answer = hex"01";
            if (reason == 10) a.questionHash = bytes32(uint256(1));
            bytes memory sig = reason == 2 ? new bytes(65) : sign(a);
            miss(rid, a, sig, reason);
            assertFalse(registry.hasTrait(ALICE, 701));
            assertEq(registry.pendingOf(ALICE, 701), bytes32(0));
        }
        bytes32 rid = ask(ALICE, 701);
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
        a.chainId = 2;
        a.answer = new bytes(0);
        miss(rid, a, new bytes(0), 2);
        rid = ask(ALICE, 701);
        a = attestation(rid, new bytes(0));
        a.chainId = 2;
        miss(rid, a, new bytes(65), 9);
        rid = ask(ALICE, 701);
        a = attestation(rid, abi.encode(uint256(1)));
        a.chainId = 2;
        miss(rid, a, new bytes(65), 3);
    }

    function test_callbackOnlyIntakeUnknownReplayAndUnsignedFailure() public {
        bytes32 rid = ask(ALICE, 701);
        OracleAttestation memory a = attestation(rid, abi.encode(uint256(1)));
        bytes memory sig = sign(a);
        vm.expectRevert(Registry.NotIntake.selector);
        registry.onResult(rid, a, sig);
        vm.expectRevert(Registry.NotIntake.selector);
        registry.onFailure(rid, 1, bytes32(0), 0, 0, "");
        assertTrue(
            intake.complete(
                rid, 2, bytes32(0), "", abi.encode(rid, uint8(2), bytes32("disagreed"), uint16(2), uint16(5), hex"abcd")
            )
        );
        assertEq(registry.pendingOf(ALICE, 701), bytes32(0));
        assertFalse(registry.hasTrait(ALICE, 701));
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.Missed(rid, 0, 1);
        assertTrue(intake.raw(address(registry), abi.encodeCall(registry.onResult, (rid, a, sign(a)))));
        vm.expectRevert(bytes("completed"));
        intake.complete(rid, 0, bytes32(0), "", abi.encode(rid, a, sig));
        ask(ALICE, 701);
    }

    function test_sharedExactEnvelopeAndMembership() public {
        for (uint256 n = 31; n <= 33; n += 2) {
            bytes32 rid = shared(1201);
            address[] memory list = new address[](n);
            OracleAttestation memory a = attestation(rid, abi.encode(list));
            miss(rid, a, sign(a), 9);
            (bytes32 got,,) = registry.sharedFact(1201);
            assertEq(got, bytes32(0));
        }
        bytes32 rid = shared(1201);
        address[] memory list = new address[](32);
        list[0] = ALICE;
        assertTrue(deliver(rid, attestation(rid, abi.encode(list))));
        vm.prank(BOB);
        vm.expectRevert(Registry.NotInList.selector);
        registry.applySharedFact(1201, list);
        vm.prank(ALICE);
        registry.applySharedFact(1201, list);
        assertTrue(registry.hasTrait(ALICE, 1201));
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyVerified.selector, ALICE, 1201));
        registry.applySharedFact(1201, list);
        list[1] = BOB;
        vm.prank(BOB);
        vm.expectRevert(Registry.ListMismatch.selector);
        registry.applySharedFact(1201, list);
        vm.expectRevert(abi.encodeWithSelector(Registry.FactAlreadyStored.selector, 1201));
        registry.requestSharedFact(1201, 1 ether);
    }

    function test_communityVerificationOrderAndHiddenPreparation() public {
        uint16 a = register(1);
        uint16 b = register(1);
        bytes32 ra = ask(ALICE, a);
        bytes32 rb = ask(ALICE, b);
        assertEq(registry.verifiedSpecsOf(ALICE).length, 0);
        assertEq(registry.traitsOf(ALICE).length, 0);
        assertFalse(registry.hasTrait(ALICE, a));
        (bytes32 empty,,,) = registry.verified(ALICE, a);
        assertEq(empty, bytes32(0));
        assertTrue(deliver(rb, attestation(rb, abi.encode(uint256(1)))));
        assertTrue(deliver(ra, attestation(ra, abi.encode(uint256(1)))));
        uint16[] memory ids = registry.verifiedSpecsOf(ALICE);
        assertEq(ids.length, 2);
        assertEq(ids[0], b);
        assertEq(ids[1], a);
    }

    function test_reentrancyOnFeeAndRequestCannotMintTwice() public {
        imd.setAttack(address(registry), abi.encodeCall(registry.mintCard, ()));
        vm.prank(ALICE);
        registry.mintCard();
        assertFalse(imd.attackSucceeded());
        assertEq(registry.totalSupply(), 1);
        ask(ALICE, 701);
        assertFalse(imd.attackSucceeded());
        assertEq(imd.balanceOf(address(registry)), 0);
    }

    function testFuzz_directTierMonotonicity(uint64 capital, uint16 points, uint8 count, uint8 hour) public {
        curator.set(ALICE, hour, true, count, uint256(capital) * 100, points);
        uint16[4] memory ends = [uint16(202), 303, 404, 503];
        for (uint256 i; i < 4; ++i) {
            for (uint16 id = ends[i]; id % 100 > 1; --id) {
                if (registry.hasTrait(ALICE, id)) assertTrue(registry.hasTrait(ALICE, id - 1));
            }
        }
    }
}
