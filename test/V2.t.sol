// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Composer} from "../src/Composer.sol";
import {OracleAttestation} from "../src/interfaces/IOracleConsumer.sol";
import {Spec} from "../src/Types.sol";

/// @notice The docs/V2.md items, one test each (test/NOTES.md maps the items).
contract V2Test is Base {
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public override {
        super.setUp();
        curator.set(alice, 1, true, 1, 1, 1);
    }

    // item 1: every pool draw is capped by maxPrice, an eighth of the pool and POOL_DRAW_CAP
    function test_item1_poolDrawCaps() public {
        imd.mint(address(registry), 10 ether);
        intake.setPrice(10 ether);
        vm.prank(alice);
        vm.expectRevert(Registry.PoolDrawTooLarge.selector);
        registry.claimSponsored(701, 10 ether);
        intake.setPrice(1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.PriceAboveMax.selector, 1 ether, 0.5 ether));
        registry.claimSponsored(701, 0.5 ether);
        vm.prank(alice);
        registry.claimSponsored(701, 1 ether);
        assertTrue(registry.pendingOf(alice, 701) != 0);
        assertEq(registry.pool(), 9 ether);
        // above the absolute cap even with a deep pool
        imd.mint(address(registry), 100 ether);
        intake.setPrice(2 ether + 1);
        vm.warp(T0 + 1 days);
        vm.prank(alice);
        vm.expectRevert(Registry.PoolDrawTooLarge.selector);
        registry.claimSponsored(801, type(uint256).max);
        assertEq(registry.POOL_DRAW_CAP(), 2 ether);
    }

    // item 2: a zero price reverts on the paid and the pool path
    function test_item2_zeroPriceReverts() public {
        imd.mint(address(registry), 10 ether);
        intake.setPrice(0);
        uint16[] memory ids = new uint16[](1);
        ids[0] = 701;
        fund(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Registry.ZeroPrice.selector);
        registry.upgrade(ids, PRICE);
        vm.prank(alice);
        vm.expectRevert(Registry.ZeroPrice.selector);
        registry.claimSponsored(701, PRICE);
    }

    // items 3 and 4: a failed sponsored draw gives the trait back, the day stays consumed; nine verified for ever
    function test_item3_failureRestoresTheTraitReservationAndTenAttemptsPay() public {
        imd.mint(address(registry), 100 ether);
        for (uint256 i; i < 10; ++i) {
            vm.warp(T0 + i * 1 days);
            vm.prank(alice);
            registry.claimSponsored(701, PRICE);
            bytes32 rid = registry.pendingOf(alice, 701);
            assertTrue(registry.poolUsed(alice, 701));
            if (i % 2 == 0) assertTrue(fail(rid, 2, "disagreed"));
            else assertTrue(deliver(rid, attestationFor(rid, word(0)))); // Missed, reason 8
            assertFalse(registry.poolUsed(alice, 701), "the reservation is released");
            assertEq(registry.pendingOf(alice, 701), bytes32(0));
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(Registry.PoolDailyLimit.selector, alice));
            registry.claimSponsored(701, PRICE);
        }
        assertEq(registry.pool(), 100 ether - 10 * PRICE, "the pool paid ten prices");
        // after a miss a paid upgrade of the same trait succeeds at once
        bytes32 paid = ask(alice, 701);
        assertTrue(deliver(paid, attestationFor(paid, word(1))));
        assertTrue(registry.hasTrait(alice, 701));
        assertEq(registry.sponsoredVerified(alice), 0, "a paid verification is not a sponsored one");
    }

    function test_item4_nineVerifiedSponsoredTraitsPerWallet() public {
        imd.mint(address(registry), 100 ether);
        uint16[9] memory chain = [701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105];
        for (uint256 i; i < 9; ++i) {
            vm.warp(T0 + i * 1 days);
            vm.prank(alice);
            registry.claimSponsored(chain[i], PRICE);
            bytes32 rid = registry.pendingOf(alice, chain[i]);
            assertTrue(deliver(rid, attestationFor(rid, word(1))));
            assertTrue(registry.poolUsed(alice, chain[i]), "a verified draw keeps its reservation");
        }
        assertEq(registry.sponsoredVerified(alice), 9);
        vm.warp(T0 + 10 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.PoolAlreadyUsed.selector, alice, 701));
        registry.claimSponsored(701, PRICE);
    }

    // item 5: abandon after 31 days, by the payer for a shared fact
    function test_item5_abandonSharedFactOnlyByPayerAfter31Days() public {
        fund(bob, PRICE);
        vm.prank(bob);
        registry.requestSharedFact(1201, PRICE);
        bytes32 shared = intake.lastId();
        bytes32 personal = ask(alice, 701);
        vm.warp(T0 + 15 days);
        vm.prank(alice);
        vm.expectRevert(Registry.TooEarly.selector);
        registry.abandon(shared);
        vm.warp(T0 + 32 days);
        vm.prank(alice);
        vm.expectRevert(Registry.NotClaimant.selector);
        registry.abandon(shared);
        vm.prank(bob);
        registry.abandon(shared);
        assertEq(registry.sharedPending(1201), bytes32(0));
        vm.prank(alice);
        registry.abandon(personal);
        assertEq(registry.pendingOf(alice, 701), bytes32(0));
    }

    // item 8 is not changed (see NOTES); item 9: expectedId
    function test_item9_expectedIdRefusesAFrontRun() public {
        Spec memory s = t1Spec(CURATOR_ADDR, "First");
        fund(alice, 3 * registry.SPEC_FEE());
        vm.prank(alice);
        assertEq(registry.registerSpec(s, 10001), 10001);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.UnexpectedSpecId.selector, 10001, 10002));
        registry.registerSpec(s, 10001);
        vm.prank(alice);
        assertEq(registry.registerSpec(s, 0), 10002, "0 always registers");
    }

    // items 12, 13, 14: totalSupply; direct traits frozen at mint; the holder has no power
    function test_item13_directTraitsFrozenAtMintAndTransfersChangeNothing() public {
        curator.set(alice, 0, true, 10, 800 ether, 10_000);
        idmd.setBalance(alice, 1);
        uint256 id = mint(alice);
        assertEq(registry.totalSupply(), 1);
        assertTrue(registry.hasTrait(alice, 601) && registry.hasTrait(alice, 202));
        curator.set(alice, 5, true, 0, 0, 0);
        idmd.setBalance(alice, 0);
        assertTrue(registry.hasTrait(alice, 601), "Armed stays lit");
        assertTrue(registry.hasTrait(alice, 202), "frozen");
        string memory before = registry.tokenURI(id);
        vm.prank(alice);
        registry.transferFrom(alice, bob, id);
        assertEq(registry.claimantOf(id), alice);
        assertEq(registry.tokenOf(alice), id);
        assertEq(registry.tokenURI(id), before, "a sale changes nothing");
        // the minter still upgrades its card; the buyer collects its own facts without a card
        bytes32 rid = ask(alice, 701);
        assertTrue(deliver(rid, attestationFor(rid, word(1))));
        assertTrue(registry.hasTrait(alice, 701));
        idmd.setBalance(bob, 1);
        assertFalse(registry.hasTrait(bob, 601), "no card, no snapshot");
        bytes32 rb = ask(bob, 801);
        assertTrue(deliver(rb, attestationFor(rb, word(1))));
        assertTrue(registry.hasTrait(bob, 801));
        uint256 bid = mint(bob);
        assertEq(registry.totalSupply(), 2);
        assertTrue(registry.hasTrait(bob, 601), "snapshot at the buyer's own mint");
        assertEq(registry.frozenDirect(id) & (1 << 20), 1 << 20);
        assertTrue(bid != id);
    }

    // item 15: kind 3 asks 11 / 7
    function test_item15_kind3Panel() public {
        fund(bob, PRICE);
        vm.prank(bob);
        registry.requestSharedFact(1201, PRICE);
        bytes32 rid = intake.lastId();
        assertEq(vm.parseJsonUint(string(intake.bodyOf(rid)), ".panelSize"), 11);
        OracleAttestation memory a = attestationFor(rid, abi.encode(new address[](1)));
        a.panelSize = 5;
        a.quorum = 3;
        a.agreed = 3;
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.Missed(rid, 1201, 5);
        assertTrue(deliver(rid, a));
    }

    // item 16: the finality margin
    function test_item16_finalityMargin() public {
        Spec memory s = t1Spec(CURATOR_ADDR, "Recent");
        s.toBlock = uint64(block.number - 1);
        s.fromBlock = s.toBlock - 7199;
        fund(alice, 2 * registry.SPEC_FEE());
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        registry.registerSpec(s, 0);
        s.toBlock = uint64(block.number - 64);
        s.fromBlock = s.toBlock - 7199;
        vm.prank(alice);
        assertEq(registry.registerSpec(s, 0), 10001);
    }

    // item 21: the constructor checks decimals and helper code
    function test_item21_constructorChecks() public {
        vm.mockCall(address(imd), abi.encodeWithSignature("decimals()"), abi.encode(uint8(6)));
        vm.expectRevert("IMD decimals");
        new Registry(
            CURATOR_ADDR,
            address(idmd),
            address(imd),
            address(intake),
            attester,
            address(renderer),
            address(composer),
            address(0)
        );
        vm.clearMockedCalls();
        vm.expectRevert(Registry.DependencyHasNoCode.selector);
        new Registry(
            CURATOR_ADDR,
            address(idmd),
            address(imd),
            address(intake),
            attester,
            address(0xBEEF),
            address(composer),
            address(0)
        );
    }
}
