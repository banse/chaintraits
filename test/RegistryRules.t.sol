// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {IIntake} from "../src/interfaces/IIntake.sol";
import {Spec} from "../src/Types.sol";
import {MockIMD} from "./mocks/Mocks.sol";

/// @dev This deliberately non-view implementation proves the constructor uses STATICCALL.
contract WritingPriceIntake {
    uint256 public reads;

    function priceOf(bytes32, address) external returns (uint256) {
        reads++;
        return 0.5 ether;
    }
}

/// @notice Registry step 2: fees, deployment checks, membership and shared pool limits.
contract RegistryRulesTest is Base {
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function _deploy(address asset, address intake_) internal returns (Registry) {
        return new Registry(CURATOR_ADDR, address(idmd), asset, intake_, attester, address(renderer), address(composer));
    }

    function _member(address wallet) internal {
        curator.set(wallet, 1, true, 1, 1, 1);
    }

    function _one(uint16 id) internal pure returns (uint16[] memory ids) {
        ids = new uint16[](1);
        ids[0] = id;
    }

    function _poolRequest(address wallet, bool throughIdmd, uint16 id) internal {
        vm.prank(wallet);
        if (throughIdmd) registry.upgradeSponsored(7, _one(id));
        else registry.claimSponsored(id);
    }

    function test_constructorRejectsZeroIntakePrice() public {
        intake.setPrice(0);
        vm.expectRevert("Intake price");
        _deploy(address(imd), address(intake));
    }

    function test_constructorRejectsWrongAsset() public {
        MockIMD wrongAsset = new MockIMD();
        vm.expectRevert("Intake price");
        _deploy(address(wrongAsset), address(intake));
    }

    function test_constructorRejectsUnavailableIntake() public {
        vm.mockCallRevert(
            address(intake), abi.encodeCall(IIntake.priceOf, (registry.ACTION(), address(imd))), "unavailable"
        );
        vm.expectRevert(bytes("unavailable"));
        _deploy(address(imd), address(intake));
        vm.clearMockedCalls();
        vm.expectRevert();
        _deploy(address(imd), makeAddr("no Intake code"));
    }

    function test_constructorPriceCheckIsPassiveAndAcceptsAnyNonzeroPrice() public {
        WritingPriceIntake writing = new WritingPriceIntake();
        vm.expectRevert();
        _deploy(address(imd), address(writing));
        assertEq(writing.reads(), 0);
        intake.setPrice(1);
        Registry r = _deploy(address(imd), address(intake));
        assertEq(address(r.intake()), address(intake));
        assertEq(imd.balanceOf(address(r)), 0);
        assertEq(intake.nonce(), 0, "deployment must not create a request");
    }

    function test_specAndFirstClaimCostSixPointNineIMD() public {
        assertEq(registry.SPEC_FEE(), 6.4 ether);
        fund(alice, 6.9 ether);
        vm.prank(alice);
        imd.approve(address(registry), 6.4 ether);
        Spec memory s = t1Spec(CURATOR_ADDR, "Community");
        vm.prank(alice);
        uint16 id = registry.registerSpec(s);
        assertEq(registry.pool(), 6.4 ether);
        assertEq(imd.balanceOf(alice), 0.5 ether);
        assertEq(imd.allowance(alice, address(registry)), 0);
        vm.prank(alice);
        imd.approve(address(registry), PRICE);
        vm.prank(alice);
        registry.upgrade(_one(id), PRICE);
        assertEq(imd.balanceOf(alice), 0);
        assertEq(imd.balanceOf(address(intake)), PRICE);
        assertEq(registry.pool(), 6.4 ether, "only the registration fee stays in the pool");
        assertTrue(registry.pendingOf(alice, id) != 0);
        assertEq(registry.lastPoolDay(alice), 0, "paid requests do not use the daily allowance");
    }

    function test_specRequiresFullFeeAndAllowance() public {
        fund(alice, 6.4 ether - 1);
        Spec memory s = t1Spec(CURATOR_ADDR, "Community");
        vm.prank(alice);
        vm.expectRevert();
        registry.registerSpec(s);
        assertEq(registry.pool(), 0);
        assertEq(registry.nextSpecId(), 10001);
        imd.mint(alice, 1);
        vm.prank(alice);
        imd.approve(address(registry), 6.4 ether - 1);
        vm.prank(alice);
        vm.expectRevert();
        registry.registerSpec(s);
        assertEq(registry.pool(), 0);
        assertEq(registry.nextSpecId(), 10001);
        vm.prank(alice);
        imd.approve(address(registry), 6.4 ether);
        vm.prank(alice);
        assertEq(registry.registerSpec(s), 10001);
    }

    function test_memberClaimsOnDeploymentDayWithoutCardOrIdmd() public {
        _member(alice);
        imd.mint(address(registry), PRICE);
        assertEq(vm.getBlockTimestamp(), registry.deployedAt());
        assertEq(registry.tokenOf(alice), 0);
        assertEq(idmd.balanceOf(alice), 0);
        assertEq(registry.lastPoolDay(alice), 0);
        vm.prank(alice);
        registry.claimSponsored(701);
        assertTrue(registry.pendingOf(alice, 701) != 0);
        assertEq(registry.lastPoolDay(alice), T0 / 1 days);
        assertEq(registry.pool(), 0);
    }

    function test_idmdHolderMustAlsoBeAListMember() public {
        imd.mint(address(registry), PRICE);
        idmd.setOwner(7, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotMember.selector, alice));
        registry.upgradeSponsored(7, _one(701));
        assertEq(registry.idmdSponsored(7), 0);
        assertEq(registry.lastPoolDay(alice), 0);
        assertFalse(registry.poolUsed(alice, 701));
        _member(alice);
        vm.prank(alice);
        registry.upgradeSponsored(7, _one(701));
        assertEq(registry.idmdSponsored(7), 1);
    }

    function test_sponsoredUpgradeRequiresExactlyOneTrait() public {
        _member(alice);
        idmd.setOwner(7, alice);
        imd.mint(address(registry), 5 ether);
        vm.prank(alice);
        vm.expectRevert(Registry.NoTraits.selector);
        registry.upgradeSponsored(7, new uint16[](0));
        uint16[] memory two = new uint16[](2);
        two[0] = 701;
        two[1] = 801;
        vm.prank(alice);
        vm.expectRevert(Registry.TooManyTraits.selector);
        registry.upgradeSponsored(7, two);
        assertEq(registry.idmdSponsored(7), 0);
        assertEq(registry.lastPoolDay(alice), 0);
        assertEq(registry.pool(), 5 ether);
        vm.prank(alice);
        registry.upgradeSponsored(7, _one(701));
        assertEq(registry.idmdSponsored(7), 1);
    }

    function test_fuzz_bothPoolPathsShareOneAllowancePerUtcDay(bool firstIdmd, bool secondIdmd, uint32 offset) public {
        uint256 start = (T0 / 1 days + 1) * 1 days;
        uint256 elapsed = bound(offset, 0, 1 days - 1);
        vm.warp(start + elapsed);
        _member(alice);
        idmd.setOwner(7, alice);
        imd.mint(address(registry), 2 ether);
        _poolRequest(alice, firstIdmd, 701);
        assertEq(registry.lastPoolDay(alice), start / 1 days);
        vm.expectRevert(abi.encodeWithSelector(Registry.PoolDailyLimit.selector, alice));
        _poolRequest(alice, secondIdmd, 801);
        assertFalse(registry.poolUsed(alice, 801));
        assertEq(registry.idmdSponsored(7), firstIdmd ? 1 : 0);
        assertEq(registry.pool(), 1.5 ether);
        vm.warp(start + 1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(Registry.PoolDailyLimit.selector, alice));
        _poolRequest(alice, secondIdmd, 801);
        vm.warp(start + 1 days);
        _poolRequest(alice, secondIdmd, 801);
        assertEq(registry.lastPoolDay(alice), start / 1 days + 1);
        assertEq(registry.idmdSponsored(7), (firstIdmd ? 1 : 0) + (secondIdmd ? 1 : 0));
        assertEq(registry.pool(), 1 ether);
        assertEq(imd.balanceOf(address(intake)), 2 * PRICE);
    }

    function test_paidUpgradeAndSharedFactDoNotUseOrObeyPoolDailyLimit() public {
        _member(alice);
        imd.mint(address(registry), 2 ether);
        ask(alice, 701);
        fund(alice, PRICE);
        vm.prank(alice);
        registry.requestSharedFact(1201, PRICE);
        assertEq(registry.lastPoolDay(alice), 0);
        vm.prank(alice);
        registry.claimSponsored(801);
        uint16[] memory paid = new uint16[](2);
        paid[0] = 901;
        paid[1] = 1001;
        fund(alice, 2 * PRICE);
        vm.prank(alice);
        registry.upgrade(paid, PRICE);
        assertTrue(registry.pendingOf(alice, 901) != 0);
        assertTrue(registry.pendingOf(alice, 1001) != 0);
        assertTrue(fail(registry.sharedPending(1201), 2, "no verdict"));
        fund(alice, PRICE);
        vm.prank(alice);
        registry.requestSharedFact(1201, PRICE);
        assertEq(registry.lastPoolDay(alice), T0 / 1 days);
        assertEq(registry.pool(), 1.5 ether, "only the single sponsored request spends pool funds");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.PoolDailyLimit.selector, alice));
        registry.claimSponsored(1101);
    }

    function test_idmdCounterFollowsTransfersAndStopsAtNine() public {
        imd.mint(address(registry), 5 ether);
        for (uint256 i; i < 9; ++i) {
            address holder = makeAddr(string.concat("member ", vm.toString(i)));
            _member(holder);
            idmd.setOwner(7, holder);
            vm.prank(holder);
            registry.upgradeSponsored(7, _one(701));
            assertEq(registry.idmdSponsored(7), i + 1);
        }
        _member(bob);
        idmd.setOwner(7, bob);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Registry.IdmdSponsorExhausted.selector, 7));
        registry.upgradeSponsored(7, _one(701));
        assertEq(registry.idmdSponsored(7), 9);
        assertEq(registry.lastPoolDay(bob), 0);
        assertEq(registry.pool(), PRICE);
        // Exhaustion is per IDMD token; Bob's own member allowance is still available.
        vm.prank(bob);
        registry.claimSponsored(701);
        assertEq(registry.idmdSponsored(7), 9);
        assertEq(registry.pool(), 0);
    }

    function test_switchingIdmdDoesNotBypassDailyLimit() public {
        _member(alice);
        idmd.setOwner(7, alice);
        idmd.setOwner(8, alice);
        imd.mint(address(registry), 2 ether);
        vm.prank(alice);
        registry.upgradeSponsored(7, _one(701));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.PoolDailyLimit.selector, alice));
        registry.upgradeSponsored(8, _one(801));
        assertEq(registry.idmdSponsored(8), 0);
        vm.warp(T0 + 1 days);
        vm.prank(alice);
        registry.upgradeSponsored(8, _one(801));
        assertEq(registry.idmdSponsored(8), 1);
    }

    function test_revertingIntakeDoesNotConsumePoolAllowances() public {
        _member(alice);
        idmd.setOwner(7, alice);
        imd.mint(address(registry), PRICE);
        vm.mockCallRevert(address(intake), abi.encodeWithSelector(IIntake.requestWithFailure.selector), "unavailable");
        vm.prank(alice);
        vm.expectRevert(bytes("unavailable"));
        registry.upgradeSponsored(7, _one(701));
        assertEq(registry.idmdSponsored(7), 0);
        assertEq(registry.lastPoolDay(alice), 0);
        assertFalse(registry.poolUsed(alice, 701));
        assertEq(registry.pendingOf(alice, 701), bytes32(0));
        assertEq(registry.pool(), PRICE);
        assertEq(imd.allowance(address(registry), address(intake)), 0);
        vm.clearMockedCalls();
        vm.prank(alice);
        registry.upgradeSponsored(7, _one(701));
        assertEq(registry.pool(), 0);
    }

    function test_noVerdictConsumesTheDayAndLifetimePair() public {
        _member(alice);
        idmd.setOwner(7, alice);
        imd.mint(address(registry), 2 ether);
        vm.prank(alice);
        registry.upgradeSponsored(7, _one(701));
        assertTrue(fail(registry.pendingOf(alice, 701), 2, "no verdict"));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.PoolDailyLimit.selector, alice));
        registry.claimSponsored(801);
        vm.warp(T0 + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Registry.PoolAlreadyUsed.selector, alice, 701));
        registry.upgradeSponsored(7, _one(701));
        assertEq(registry.idmdSponsored(7), 1);
        vm.prank(alice);
        registry.claimSponsored(801);
        assertEq(registry.pool(), 1 ether);
    }
}
