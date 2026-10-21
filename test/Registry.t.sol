// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Composer} from "../src/Composer.sol";
import {Spec, OracleAttestation} from "../src/Types.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Vm} from "forge-std/Vm.sol";

contract RegistryTest is SwornTest {
    function test_mintAndRegistrationFeesForwardExactly() public {
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        uint256 id = registry.mintCard();
        assertEq(id, 1);
        assertEq(registry.totalSupply(), 1);
        assertEq(token.balanceOf(alice), before - 0.1 ether);
        assertEq(token.balanceOf(address(executor)), 0.1 ether);
        assertEq(token.balanceOf(address(registry)), 0);
        _register(1);
        assertEq(token.balanceOf(address(executor)), 6.5 ether);
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(registry.nextSpecId(), 10002);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyMinted.selector, alice));
        registry.mintCard();
    }

    function test_failedFeeRevertsWholeCallAndGuardRejectsReentry() public {
        token.setFail(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        registry.mintCard();
        assertEq(registry.totalSupply(), 0);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        registry.registerSpec(_spec(1), 0);
        assertEq(registry.nextSpecId(), 10001);
        token.setFail(false);
        token.hook(address(registry), abi.encodeCall(Registry.mintCard, ()));
        vm.prank(alice);
        registry.mintCard();
        assertFalse(token.reentered());
        assertEq(registry.totalSupply(), 1);
    }

    function test_directTraitsFreezeAndTransfersNeverMoveFacts() public {
        curator.set(alice, true, 0, 10, 800 ether, 10000);
        vm.prank(alice);
        uint256 id = registry.mintCard();
        uint32 snapshot = registry.frozenDirect(id);
        curator.set(alice, false, 0, 0, 0, 0);
        assertTrue(registry.hasTrait(alice, 101));
        assertTrue(registry.hasTrait(alice, 202));
        assertTrue(registry.hasTrait(alice, 303));
        assertTrue(registry.hasTrait(alice, 404));
        assertTrue(registry.hasTrait(alice, 503));
        vm.prank(alice);
        registry.transferFrom(alice, bob, id);
        assertEq(registry.ownerOf(id), bob);
        assertEq(registry.claimantOf(id), alice);
        assertEq(registry.tokenOf(alice), id);
        assertEq(registry.tokenOf(bob), 0);
        _pass(alice, 701);
        assertTrue(registry.hasTrait(alice, 701));
        assertFalse(registry.hasTrait(bob, 701));
        _pass(bob, 801);
        assertFalse(registry.hasTrait(alice, 801));
        vm.prank(bob);
        uint256 second = registry.mintCard();
        assertEq(second, 2);
        assertEq(registry.claimantOf(id), alice);
        assertEq(registry.frozenDirect(id), snapshot);
        _pass(bob, 701);
        assertEq(registry.tokenOf(bob), 2);
        assertEq(registry.balanceOf(bob), 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyMinted.selector, alice));
        registry.mintCard();
    }

    function test_nonMemberAndZeroUnknownAnd601NeverDirect() public view {
        assertFalse(registry.hasTrait(alice, 101));
        assertFalse(registry.hasTrait(alice, 202));
        assertFalse(registry.hasTrait(address(0), 101));
        assertFalse(registry.hasTrait(address(0), 701));
        assertFalse(registry.hasTrait(alice, 65535));
        assertFalse(registry.hasDirectTrait(alice, 601));
    }

    function testFuzz_directMonotone(uint64 count, uint96 capital, uint32 points, uint8 hour) public {
        curator.set(alice, true, hour, count, capital, points);
        if (registry.hasTrait(alice, 303)) {
            assertTrue(registry.hasTrait(alice, 302));
            assertTrue(registry.hasTrait(alice, 301));
        }
        if (registry.hasTrait(alice, 404)) assertTrue(registry.hasTrait(alice, 403));
        if (registry.hasTrait(alice, 403)) assertTrue(registry.hasTrait(alice, 402));
        if (registry.hasTrait(alice, 402)) assertTrue(registry.hasTrait(alice, 401));
        if (registry.hasTrait(alice, 503)) assertTrue(registry.hasTrait(alice, 502));
        if (registry.hasTrait(alice, 502)) assertTrue(registry.hasTrait(alice, 501));
        if (registry.hasTrait(alice, 202)) assertTrue(registry.hasTrait(alice, 201));
    }

    function test_priceCapsSingleIdAndInvalidKinds() public {
        uint256 before = token.balanceOf(alice);
        uint16[] memory ids = new uint16[](0);
        vm.prank(alice);
        vm.expectRevert(Registry.NoTraits.selector);
        registry.upgrade(ids, 1 ether);
        ids = new uint16[](2);
        ids[0] = 701;
        ids[1] = 801;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.TooManyTraits.selector, 2));
        registry.upgrade(ids, 1 ether);
        ids = new uint16[](1);
        ids[0] = 701;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.PriceAboveMax.selector, 0.5 ether, 1));
        registry.upgrade(ids, 1);
        intake.setPrice(0);
        vm.prank(alice);
        vm.expectRevert(Registry.ZeroPrice.selector);
        registry.upgrade(ids, 1 ether);
        intake.setPrice(0.5 ether);
        ids[0] = 101;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotAnOracleTrait.selector, 101));
        registry.upgrade(ids, 1 ether);
        ids[0] = 1201;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotASharedFact.selector, 1201));
        registry.upgrade(ids, 1 ether);
        assertEq(token.balanceOf(alice), before);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotASharedFact.selector, 701));
        registry.requestSharedFact(701, 1 ether);
    }

    function test_successPendingVerifiedAndRefreshEvents() public {
        vm.prank(alice);
        registry.mintCard();
        bytes32 r = _ask(alice, 701);
        assertFalse(registry.hasTrait(alice, 701));
        (bytes32 rid,,,) = registry.verified(alice, 701);
        assertEq(rid, 0);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyPending.selector, alice, 701));
        _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.Verified(alice, 701, r, a.requestId);
        assertTrue(_deliver(r, a));
        assertTrue(registry.hasTrait(alice, 701));
        assertEq(registry.pendingOf(alice, 701), 0);
        (bytes32 rid2, bytes32 oid, uint64 from, uint64 to) = registry.verified(alice, 701);
        assertEq(rid2, r);
        assertEq(oid, a.requestId);
        assertEq(from, a.fromBlock);
        assertEq(to, a.toBlock);
        vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyVerified.selector, alice, 701));
        _ask(alice, 701);
    }

    function test_requestIdCollisionRollsBackFeeAndLateOldCallbackKeepsSuccessor() public {
        bytes32 r = _ask(alice, 701);
        intake.setId(r);
        uint256 before = token.balanceOf(bob);
        vm.expectRevert(abi.encodeWithSelector(Registry.RequestIdTaken.selector, r));
        _ask(bob, 801);
        assertEq(token.balanceOf(bob), before);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        assertEq(registry.pendingOf(alice, 701), r);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        vm.warp(block.timestamp + 32 days);
        vm.prank(alice);
        registry.abandon(r);
        intake.setId(0);
        bytes32 next = _ask(alice, 701);
        assertTrue(intake.raw(address(registry), abi.encodeCall(Registry.onResult, (r, a, _sign(a)))));
        assertEq(registry.pendingOf(alice, 701), next);
        assertFalse(registry.hasTrait(alice, 701));
    }

    function test_abandonAuthorizationAndStrictBoundary() public {
        bytes32 r = _ask(alice, 701);
        bytes32 shared = _shared(1201);
        uint256 t = block.timestamp;
        vm.warp(t + 15 days);
        vm.prank(bob);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(shared);
        vm.prank(alice);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(r);
        vm.warp(t + 31 days);
        vm.prank(alice);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(r);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(shared);
        vm.warp(t + 31 days + 1);
        vm.prank(bob);
        vm.expectRevert(Registry.NotClaimant.selector);
        registry.abandon(r);
        vm.prank(alice);
        registry.abandon(r);
        vm.prank(bob);
        registry.abandon(shared);
        assertEq(registry.pendingOf(alice, 701), 0);
        assertEq(registry.sharedPending(1201), 0);
    }

    function test_earlyAbandonOnlyCompletedPersonal() public {
        bytes32 r = _ask(alice, 701);
        assertFalse(intake.complete(r, 1, bytes("")));
        vm.prank(bob);
        vm.expectRevert(Registry.NotClaimant.selector);
        registry.abandon(r);
        vm.prank(alice);
        registry.abandon(r);
        r = _ask(alice, 701);
        intake.setStipend(10000);
        assertFalse(_deliver(r, _att(r, abi.encode(uint256(0)))));
        vm.prank(alice);
        registry.abandon(r);
        bytes32 shared = _shared(1201);
        assertFalse(intake.complete(shared, 1, bytes("")));
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(shared);
    }

    function test_failureClearsPairAndPreparedCommunitySlotsStayInvisible() public {
        uint16 id = _register(1);
        bytes32 r = _ask(alice, id);
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        assertFalse(registry.hasTrait(alice, id));
        assertTrue(
            intake.complete(r, 2, abi.encode(r, uint8(2), bytes32("disagreed"), uint16(2), uint16(5), bytes("")))
        );
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        assertEq(registry.pendingOf(alice, id), 0);
        r = _ask(alice, id);
        _miss(r, _att(r, abi.encode(uint256(0))), 8);
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        r = _ask(alice, id);
        vm.warp(block.timestamp + 32 days);
        vm.prank(alice);
        registry.abandon(r);
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        _pass(alice, id);
        uint16[] memory ids = registry.verifiedSpecsOf(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], id);
    }

    function test_communityVerificationOrderWithConcurrentRequests() public {
        uint16 first = _register(1);
        uint16 second = _register(2);
        bytes32 a = _ask(alice, first);
        bytes32 b = _ask(alice, second);
        assertTrue(_deliver(b, _att(b, abi.encode(uint256(1)))));
        assertTrue(_deliver(a, _att(a, abi.encode(uint256(1)))));
        uint16[] memory ids = registry.verifiedSpecsOf(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], second);
        assertEq(ids[1], first);
    }

    function test_601StoresRequestWindowAfterHeadAdvances() public {
        vm.prank(alice);
        registry.mintCard();
        bytes32 r = _ask(alice, 601);
        OracleAttestation memory a = _att(r, abi.encode(true));
        uint64 to = a.toBlock;
        vm.roll(block.number + 1000);
        assertTrue(_deliver(r, a));
        (,, uint64 from, uint64 got) = registry.verified(alice, 601);
        assertEq(from, 25090085);
        assertEq(got, to);
        assertTrue(registry.hasTrait(alice, 601));
        assertFalse(registry.hasDirectTrait(alice, 601));
        assertEq(registry.traitsOf(alice)[0], 601);
        bytes32 b = _ask(bob, 601);
        a = _att(b, abi.encode(true));
        a.toBlock -= 1;
        _miss(b, a, 6);
    }

    function test_registrationExpectedIdAndValidationBeforeFee() public {
        Spec memory s = _spec(1);
        uint16 id = registry.registerSpec(s, 10001);
        assertEq(id, 10001);
        uint256 before = token.balanceOf(address(this));
        vm.expectRevert(abi.encodeWithSelector(Registry.UnexpectedSpecId.selector, 10001, 10002));
        registry.registerSpec(s, 10001);
        assertEq(token.balanceOf(address(this)), before);
        assertEq(registry.registerSpec(s, 0), 10002);
        s.arg = "missing";
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "arg"));
        registry.registerSpec(s, 0);
        assertEq(token.balanceOf(address(registry)), 0);
    }

    function test_wrongCallbackSendersUnknownReplayAndOneCompletion() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        bytes memory sig = _sign(a);
        vm.expectRevert(Registry.NotIntake.selector);
        registry.onResult(r, a, sig);
        vm.expectRevert(Registry.NotIntake.selector);
        registry.onFailure(r, 1, 0, 0, 0, "");
        assertTrue(intake.raw(address(registry), abi.encodeCall(Registry.onResult, (bytes32(uint256(900)), a, sig))));
        assertEq(registry.pendingOf(alice, 701), r);
        assertTrue(_deliver(r, a));
        assertTrue(intake.raw(address(registry), abi.encodeCall(Registry.onResult, (r, a, sig))));
        vm.expectRevert(bytes("once"));
        intake.complete(r, 0, abi.encode(r, a, sig));
    }

    function test_envelopeReasonPrecedenceAndMalformedBool() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        a.chainId = 2;
        a.answer = new bytes(64);
        _miss(r, a, 9);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        a.chainId = 2;
        _miss(r, a, 3);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        a.answerType = 0;
        _miss(r, a, 4);
        r = _ask(alice, 1301);
        a = _att(r, abi.encode(uint256(2)));
        _miss(r, a, 9);
        r = _ask(alice, 1301);
        _miss(r, _att(r, abi.encode(false)), 8);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        a.questionHash = bytes32(uint256(5));
        _miss(r, a, 10);
    }

    function test_tamperedSignatureAndWrongDomainClearPair() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        bytes memory sig = _sign(a);
        a.figure = 2;
        assertTrue(intake.complete(r, 0, abi.encode(r, a, sig)));
        assertFalse(registry.hasTrait(alice, 701));
        assertEq(registry.pendingOf(alice, 701), 0);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        vm.chainId(2);
        sig = _sign(a);
        vm.chainId(1);
        assertTrue(intake.complete(r, 0, abi.encode(r, a, sig)));
        assertFalse(registry.hasTrait(alice, 701));
    }

    function test_exactPanelAndQuorumForEveryClass() public {
        uint16[6] memory ids = [uint16(701), 1301, 601, 10001, 10002, 10003];
        _register(2);
        _register(4);
        _register(5);
        for (uint256 j; j < ids.length; ++j) {
            uint16 id = ids[j];
            for (uint256 i; i < 3; ++i) {
                bytes32 r = _ask(alice, id);
                OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
                a.panelSize = i == 0 ? a.panelSize + 1 : i == 1 ? 100 : 1000;
                _miss(r, a, 5);
            }
            bytes32 r = _ask(alice, id);
            OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
            a.quorum += 1;
            a.agreed = a.quorum;
            _miss(r, a, 5);
            r = _ask(alice, id);
            a = _att(r, abi.encode(uint256(1)));
            a.agreed = a.panelSize + 1;
            _miss(r, a, 5);
        }
    }

    function test_datesAndLatestValidBoundary() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        a.issuedAt -= 1;
        _miss(r, a, 7);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        a.issuedAt += 2 days;
        vm.warp(block.timestamp + 2 days);
        a.expiresAt = a.issuedAt + 30 days;
        _miss(r, a, 7);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        a.expiresAt = a.issuedAt + 31 days;
        _miss(r, a, 7);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        a.issuedAt += 23 hours;
        vm.warp(block.timestamp + 23 hours);
        a.expiresAt = a.issuedAt + 30 days;
        assertTrue(_deliver(r, a));
        assertTrue(registry.hasTrait(alice, 701));
        r = _ask(bob, 701);
        a = _att(r, abi.encode(uint256(1)));
        uint256 requested = block.timestamp;
        a.issuedAt += 1 days;
        a.expiresAt = a.issuedAt + 30 days;
        vm.warp(requested + 31 days);
        vm.prank(bob);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(r);
        assertTrue(_deliver(r, a));
        assertTrue(registry.hasTrait(bob, 701));
    }

    function test_expiredAt31DaysPlusOneMissesAndCanAbandon() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        a.issuedAt += 1 days;
        a.expiresAt = a.issuedAt + 30 days;
        vm.warp(block.timestamp + 31 days + 1);
        _miss(r, a, 7);
        r = _ask(alice, 701);
        a = _att(r, abi.encode(uint256(1)));
        vm.warp(block.timestamp + 31 days + 1);
        vm.prank(alice);
        registry.abandon(r);
        assertTrue(intake.raw(address(registry), abi.encodeCall(Registry.onResult, (r, a, _sign(a)))));
        assertFalse(registry.hasTrait(alice, 701));
    }

    function test_oversizedDynamicFieldsNeverCopyBeforeRejecting() public {
        bytes32 r = _ask(alice, 701);
        OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
        bytes memory huge = new bytes(262144);
        assertTrue(intake.complete(r, 0, abi.encode(r, a, huge)));
        assertLt(intake.lastGas(), 175000);
        assertFalse(registry.hasTrait(alice, 701));
        r = _ask(alice, 701);
        a = _att(r, huge);
        _miss(r, a, 9);
        assertLt(intake.lastGas(), 175000);
    }

    function test_wrongPendingQuestionCannotBePairedWithAnotherAnswer() public {
        bytes32 aId = _ask(alice, 801);
        bytes32 bId = _ask(alice, 901);
        OracleAttestation memory a = _att(aId, abi.encode(uint256(1)));
        _miss(bId, a, 10);
        assertEq(registry.pendingOf(alice, 801), aId);
        assertFalse(registry.hasTrait(alice, 901));
        assertTrue(_deliver(aId, a));
    }

    function testFuzz_boolDecoderIsTotal(uint256 word) public {
        bytes32 r = _ask(alice, 1301);
        OracleAttestation memory a = _att(r, abi.encode(word));
        assertTrue(_deliver(r, a));
        assertEq(registry.hasTrait(alice, 1301), word == 1);
        assertEq(registry.pendingOf(alice, 1301), 0);
    }

    function test_hasTraitNeverRevertsWhenDirectDependencyCannotAnswer() public {
        vm.etch(address(curator), hex"00");
        assertFalse(registry.hasTrait(alice, 101));
        assertFalse(registry.hasTrait(alice, 202));
    }

    function test_outboundFeeFailureRollsBackMintAndSpec() public {
        token.setFailOutbound(true);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        registry.mintCard();
        assertEq(token.balanceOf(alice), before);
        assertEq(registry.totalSupply(), 0);
        Spec memory s = _spec(1);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        registry.registerSpec(s, 0);
        assertEq(registry.nextSpecId(), 10001);
        assertEq(token.balanceOf(address(registry)), 0);
    }

    function test_nonexistentCardRevertsAndNoCardMetadataEventIsEmitted() public {
        vm.expectRevert(abi.encodeWithSelector(Registry.NoCard.selector, 0));
        registry.tokenURI(0);
        vm.recordLogs();
        _pass(alice, 701);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != keccak256("MetadataUpdate(uint256)"));
        }
    }
}
