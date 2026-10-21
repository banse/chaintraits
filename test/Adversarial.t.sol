// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation, IIntake} from "../src/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract RejectingCardReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }
}

/// @notice Additional adversarial cases for REBUILD 3.1, 3.3--3.8 and the signed protocol envelope.
contract AdversarialTest is SwornTest {
    function _ids(uint16 id) private pure returns (uint16[] memory ids) {
        ids = new uint16[](1);
        ids[0] = id;
    }

    function _assertEmpty(bytes32 r, address who, uint16 id) private view {
        (address claimant, uint16 traitId, uint64 at, bytes32 hash) = registry.pendingRequest(r);
        assertEq(claimant, address(0));
        assertEq(traitId, 0);
        assertEq(at, 0);
        assertEq(hash, bytes32(0));
        assertEq(registry.pendingOf(who, id), bytes32(0));
        assertFalse(registry.hasTrait(who, id));
        (bytes32 intakeId, bytes32 oracleId, uint64 from, uint64 to) = registry.verified(who, id);
        assertEq(intakeId, bytes32(0));
        assertEq(oracleId, bytes32(0));
        assertEq(from, 0);
        assertEq(to, 0);
    }

    function _signedMiss(bytes32 r, OracleAttestation memory a, bytes memory signature, uint8 reason) private {
        (, uint16 id,,) = registry.pendingRequest(r);
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.Missed(r, id, reason);
        assertTrue(intake.complete(r, 0, abi.encode(r, a, signature)), "callback must finish inside stipend");
        assertLt(intake.lastGas(), 175000);
        _assertEmpty(r, alice, id);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_livePriceChargesExactlyOnceAndLeavesNoAuthority(uint96 rawPrice, bool shared) public {
        uint256 price = bound(rawPrice, 1, 100000 ether);
        intake.setPrice(price);
        vm.prank(alice);
        token.approve(address(registry), price + 17);
        vm.expectCall(address(intake), abi.encodeCall(IIntake.priceOf, (registry.ACTION(), address(token))), 1);
        vm.expectCall(address(token), abi.encodeCall(IERC20.transferFrom, (alice, address(registry), price)), 1);
        vm.expectCall(
            address(token), abi.encodeCall(IERC20.transferFrom, (address(registry), address(intake), price)), 1
        );
        vm.prank(alice);
        if (shared) registry.requestSharedFact(1201, price);
        else registry.upgrade(_ids(701), price);
        assertEq(token.balanceOf(alice), 100000 ether - price);
        assertEq(token.balanceOf(address(intake)), price);
        assertEq(token.balanceOf(address(executor)), 0);
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(token.allowance(alice, address(registry)), 17);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        assertEq(intake.nonce(), 1);
        bytes32 r = shared ? registry.sharedPending(1201) : registry.pendingOf(alice, 701);
        (address payer, address target, bytes4 selector, bool completed) = intake.requests(r);
        assertEq(payer, address(registry));
        assertEq(target, address(registry));
        assertEq(selector, Registry.onResult.selector);
        assertEq(intake.failures(r), Registry.onFailure.selector);
        assertFalse(completed);
    }

    function test_oneWeiAndWholeBalanceOraclePrices() public {
        intake.setPrice(1);
        _ask(alice, 701);
        assertEq(token.balanceOf(alice), 100000 ether - 1);
        intake.setPrice(100000 ether);
        _ask(bob, 701);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(address(intake)), 100000 ether + 1);
        assertEq(token.balanceOf(address(registry)), 0);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_priceCapFailureHasNoFinancialOrRequestEffects(uint96 rawPrice, bool shared) public {
        uint256 price = bound(rawPrice, 1, 100000 ether);
        intake.setPrice(price);
        vm.expectRevert(abi.encodeWithSelector(Registry.PriceAboveMax.selector, price, price - 1));
        vm.prank(alice);
        if (shared) registry.requestSharedFact(1201, price - 1);
        else registry.upgrade(_ids(701), price - 1);
        assertEq(token.balanceOf(alice), 100000 ether);
        assertEq(token.balanceOf(address(intake)), 0);
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        assertEq(intake.nonce(), 0);
        assertEq(registry.pendingOf(alice, 701), bytes32(0));
        assertEq(registry.sharedPending(1201), bytes32(0));
    }

    function test_requestRevertRollsBackPullApprovalAndCommunityReservation() public {
        uint16 id = _register(2);
        vm.prank(alice);
        token.approve(address(registry), 0.5 ether);
        bytes memory failure = abi.encodeWithSignature("IntakeUnavailable()");
        vm.mockCallRevert(address(intake), abi.encodePacked(IIntake.requestWithFailure.selector), failure);
        vm.expectRevert(failure);
        _ask(alice, id);
        vm.clearMockedCalls();
        assertEq(token.balanceOf(alice), 100000 ether);
        assertEq(token.allowance(alice, address(registry)), 0.5 ether);
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(token.balanceOf(address(intake)), 0);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        assertEq(registry.pendingOf(alice, id), bytes32(0));
        assertEq(intake.nonce(), 0);
        _pass(alice, id);
        uint16[] memory verifiedIds = registry.verifiedSpecsOf(alice);
        assertEq(verifiedIds.length, 1);
        assertEq(verifiedIds[0], id);
    }

    function test_zeroRequestIdRevertsWithoutSpending() public {
        vm.mockCall(address(intake), abi.encodePacked(IIntake.requestWithFailure.selector), abi.encode(bytes32(0)));
        vm.expectRevert(abi.encodeWithSelector(Registry.RequestIdTaken.selector, bytes32(0)));
        _ask(alice, 701);
        vm.clearMockedCalls();
        assertEq(token.balanceOf(alice), 100000 ether);
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        assertEq(registry.pendingOf(alice, 701), bytes32(0));
    }

    function test_insufficientApprovalIsAtomicForEveryPaymentEntry() public {
        for (uint256 action; action < 4; ++action) {
            uint256 fee = action == 0 ? 0.1 ether : action == 1 ? 6.4 ether : 0.5 ether;
            vm.prank(alice);
            token.approve(address(registry), fee - 1);
            Spec memory s = _spec(1);
            vm.expectRevert(
                abi.encodeWithSelector(
                    IERC20Errors.ERC20InsufficientAllowance.selector, address(registry), fee - 1, fee
                )
            );
            vm.prank(alice);
            if (action == 0) registry.mintCard();
            else if (action == 1) registry.registerSpec(s, 0);
            else if (action == 2) registry.upgrade(_ids(701), fee);
            else registry.requestSharedFact(1201, fee);
            assertEq(token.balanceOf(alice), 100000 ether);
            assertEq(token.balanceOf(address(executor)), 0);
            assertEq(token.balanceOf(address(intake)), 0);
            assertEq(token.balanceOf(address(registry)), 0);
            assertEq(token.allowance(alice, address(registry)), fee - 1);
            assertEq(token.allowance(address(registry), address(intake)), 0);
            assertEq(registry.totalSupply(), 0);
            assertEq(registry.nextSpecId(), 10001);
            assertEq(registry.pendingOf(alice, 701), bytes32(0));
            assertEq(registry.sharedPending(1201), bytes32(0));
        }
    }

    function test_intakeCannotReuseSuccessfulFailedOrAbandonedIds() public {
        for (uint256 outcome; outcome < 3; ++outcome) {
            bytes32 r = _ask(alice, uint16(701 + outcome * 100));
            if (outcome == 0) {
                assertTrue(_deliver(r, _att(r, abi.encode(uint256(1)))));
            } else if (outcome == 1) {
                assertTrue(
                    intake.complete(
                        r, 2, abi.encode(r, uint8(2), bytes32("disagreed"), uint16(1), uint16(5), bytes(""))
                    )
                );
            } else {
                vm.warp(block.timestamp + 31 days + 1);
                vm.prank(alice);
                registry.abandon(r);
            }
            intake.setId(r);
            uint256 balance = token.balanceOf(bob);
            uint256 intakeBalance = token.balanceOf(address(intake));
            vm.prank(bob);
            vm.expectRevert(abi.encodeWithSelector(Registry.RequestIdTaken.selector, r));
            registry.requestSharedFact(1201, 0.5 ether);
            assertEq(token.balanceOf(bob), balance);
            assertEq(token.balanceOf(address(intake)), intakeBalance);
            assertEq(token.allowance(address(registry), address(intake)), 0);
            assertEq(registry.sharedPending(1201), bytes32(0));
            assertEq(registry.hasTrait(alice, uint16(701 + outcome * 100)), outcome == 0);
            intake.setId(0);
        }
    }

    function test_allFifteenSignedFieldsAreAuthenticated() public {
        for (uint256 field; field < 15; ++field) {
            bytes32 r = _ask(alice, 701);
            OracleAttestation memory a = _att(r, abi.encode(uint256(1)));
            bytes memory signature = _sign(a);
            if (field == 0) a.requestId = bytes32(uint256(a.requestId) ^ 1);
            else if (field == 1) a.chainId = 2;
            else if (field == 2) a.questionHash = bytes32(uint256(a.questionHash) ^ 1);
            else if (field == 3) a.answerType = 0;
            else if (field == 4) a.answer = abi.encode(uint256(2));
            else if (field == 5) a.figure = 1;
            else if (field == 6) ++a.fromBlock;
            else if (field == 7) ++a.toBlock;
            else if (field == 8) a.blockHash = bytes32(uint256(1));
            else if (field == 9) a.panelJobId = bytes32(uint256(1));
            else if (field == 10) ++a.panelSize;
            else if (field == 11) ++a.quorum;
            else if (field == 12) ++a.agreed;
            else if (field == 13) ++a.issuedAt;
            else ++a.expiresAt;
            _signedMiss(r, a, signature, field == 1 ? 3 : 2);
        }
    }

    function test_malleableCompactAndInvalidRecoverySignaturesMissWithoutRevert() public {
        uint256 order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        for (uint256 variant; variant < 4; ++variant) {
            bytes32 id = _ask(alice, 701);
            OracleAttestation memory a = _att(id, abi.encode(uint256(1)));
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, registry.attestationDigest(a));
            bytes memory signature;
            if (variant == 0) {
                signature = abi.encodePacked(r, bytes32(order - uint256(s)), v == 27 ? uint8(28) : uint8(27));
            } else if (variant == 1) {
                signature = abi.encodePacked(r, bytes32(uint256(s) | (uint256(v - 27) << 255)));
            } else if (variant == 2) {
                signature = abi.encodePacked(r, s, uint8(0));
            } else {
                signature = new bytes(65);
            }
            _signedMiss(id, a, signature, 2);
        }
    }

    function test_signatureForAnotherConsumerCannotSettleIdenticalQuestion() public {
        Registry other = new Registry(
            address(curator),
            address(token),
            address(intake),
            vm.addr(SIGNER_KEY),
            address(renderer),
            address(composer),
            address(executor)
        );
        bytes32 id = _ask(alice, 701);
        OracleAttestation memory a = _att(id, abi.encode(uint256(1)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, other.attestationDigest(a));
        assertFalse(intake.complete(id, 0, hex"00"));
        vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, id, uint8(2)));
        registry.settle(id, a, abi.encodePacked(r, s, v));
        assertEq(registry.pendingOf(alice, 701), id);
        assertFalse(registry.hasTrait(alice, 701));
        registry.settle(id, a, _sign(a));
        assertTrue(registry.hasTrait(alice, 701));
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_uintThresholdAtBothSidesAndMaximum(uint256 rawThreshold, bool sum) public {
        uint256 threshold = bound(rawThreshold, 1, type(uint256).max);
        Spec memory s = _spec(sum ? 2 : 1);
        s.threshold = threshold;
        uint16 id = registry.registerSpec(s, 0);
        bytes32 r = _ask(alice, id);
        _miss(r, _att(r, abi.encode(threshold - 1)), 8);
        assertFalse(registry.hasTrait(alice, id));
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        r = _ask(alice, id);
        assertTrue(_deliver(r, _att(r, abi.encode(threshold))));
        assertTrue(registry.hasTrait(alice, id));
        r = _ask(bob, id);
        assertTrue(_deliver(r, _att(r, abi.encode(type(uint256).max))));
        assertTrue(registry.hasTrait(bob, id));
        assertEq(registry.verifiedSpecsOf(alice).length, 1);
        assertEq(registry.verifiedSpecsOf(bob).length, 1);
    }

    function test_thresholdOneIsInclusive() public {
        testFuzz_uintThresholdAtBothSidesAndMaximum(1, false);
    }

    function test_thresholdMaximumIsInclusive() public {
        testFuzz_uintThresholdAtBothSidesAndMaximum(type(uint256).max, true);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_sharedListAddressBoundaryAndEveryHead(uint8 rawHead, uint8 rawIndex, bool dirty) public {
        uint256 head = bound(rawHead, 1, 32);
        Spec memory s = _spec(3);
        s.threshold = head;
        uint16 id = registry.registerSpec(s, 0);
        address[] memory list = _list(head);
        uint256 index = bound(rawIndex, 0, head - 1);
        list[index] = address(uint160(2 ** 80));
        bytes memory malformed = abi.encode(list);
        uint256 badWord = dirty ? uint256(1) << 160 : 2 ** 80 - 1;
        assembly ("memory-safe") { mstore(add(add(malformed, 96), mul(index, 32)), badWord) }
        bytes32 r = _shared(id);
        _miss(r, _att(r, malformed), 9);
        (bytes32 storedId,,) = registry.sharedFact(id);
        assertEq(storedId, bytes32(0));
        r = _shared(id);
        assertTrue(_deliver(r, _att(r, abi.encode(list))));
        vm.prank(list[index]);
        registry.applySharedFact(id, list);
        assertTrue(registry.hasTrait(list[index], id));
        (bytes32 got, bytes32 hash, uint16 n) = registry.sharedFact(id);
        assertEq(got, r);
        assertEq(hash, keccak256(abi.encode(list)));
        assertEq(n, head);
    }

    function test_receiverRejectionAndUnauthorizedTransferPreserveCardState() public {
        vm.prank(alice);
        uint256 id = registry.mintCard();
        vm.prank(alice);
        registry.approve(bob, id);
        RejectingCardReceiver receiver = new RejectingCardReceiver();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(receiver)));
        registry.safeTransferFrom(alice, address(receiver), id);
        assertEq(registry.ownerOf(id), alice);
        assertEq(registry.getApproved(id), bob);
        assertEq(registry.balanceOf(alice), 1);
        assertEq(registry.balanceOf(address(receiver)), 0);
        vm.prank(bob);
        registry.transferFrom(alice, bob, id);
        assertEq(registry.getApproved(id), address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, alice, id));
        registry.transferFrom(bob, alice, id);
        assertEq(registry.ownerOf(id), bob);
        assertEq(registry.claimantOf(id), alice);
        assertEq(registry.tokenOf(alice), id);
        assertEq(registry.tokenOf(bob), 0);
    }
}
