// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {IBurnExecutor} from "../src/interfaces/IBurnExecutor.sol";
import {IIntake} from "../src/interfaces/IIntake.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockBurnExecutor, NonpayableBurnClaimant, ReentrantBurnClaimant} from "./mocks/MockBurnExecutor.sol";

contract BurnRuleTest is Base {
    address internal alice = address(0xA11CE);
    MockBurnExecutor internal executor;
    uint256 internal constant FEE = 0.001 ether;

    function setUp() public override {
        super.setUp();
        executor = new MockBurnExecutor();
        _useExecutor(address(executor));
        curator.set(alice, 1, true, 1, 1, 1);
        idmd.setOwner(7, alice);
        vm.deal(alice, 10 ether);
    }

    function _useExecutor(address executor_) internal {
        registry = new Registry(
            CURATOR_ADDR,
            address(idmd),
            address(imd),
            address(intake),
            attester,
            address(renderer),
            address(composer),
            executor_
        );
        imd.mint(address(registry), 10 ether);
        // ETH already present is never a precondition and must never be spent or refunded.
        vm.deal(address(registry), 3 ether);
    }

    function _claim(bool throughIdmd, uint16 traitId, uint256 value) internal {
        vm.prank(alice);
        if (throughIdmd) {
            uint16[] memory ids = new uint16[](1);
            ids[0] = traitId;
            registry.upgradeSponsored{value: value}(7, ids);
        } else {
            registry.claimSponsored{value: value}(traitId);
        }
    }

    function _pending(bool throughIdmd, uint16 traitId) internal view {
        assertTrue(registry.pendingOf(alice, traitId) != 0, "oracle request remains pending");
        assertTrue(registry.poolUsed(alice, traitId));
        assertEq(registry.lastPoolDay(alice), T0 / 1 days);
        assertEq(registry.idmdSponsored(7), throughIdmd ? 1 : 0);
        assertEq(registry.pool(), 10 ether - PRICE);
        assertEq(imd.balanceOf(address(intake)), PRICE);
        assertEq(address(registry).balance, 3 ether, "ETH balance is conserved");
    }

    function _rolledBack() internal view {
        assertEq(registry.pendingOf(alice, 701), bytes32(0));
        assertFalse(registry.poolUsed(alice, 701));
        assertEq(registry.lastPoolDay(alice), 0);
        assertEq(registry.idmdSponsored(7), 0);
        assertEq(registry.pool(), 10 ether);
        assertEq(intake.nonce(), 0);
        assertEq(imd.balanceOf(address(intake)), 0);
        assertEq(imd.allowance(address(registry), address(intake)), 0);
        assertEq(address(registry).balance, 3 ether);
        assertEq(alice.balance, 10 ether);
        assertEq(executor.calls(), 0);
    }

    function test_constantsAndStorage() public view {
        assertEq(registry.BURN_MIN(), 69 ether);
        assertEq(registry.BURN_FEE_CAP(), 0.005 ether);
        assertEq(address(registry.burnExecutor()), address(executor));
    }

    function testFuzz_belowThresholdRefundsWithoutFee(bool throughIdmd, uint96 amount, uint96 value) public {
        uint256 quotedAmount = bound(amount, 0, 69 ether - 1);
        uint256 attached = bound(value, 0, 1 ether);
        executor.configure(quotedAmount, FEE, 0);
        _claim(throughIdmd, 701, attached);
        _pending(throughIdmd, 701);
        assertEq(executor.calls(), 0);
        assertEq(alice.balance, 10 ether);
    }

    function testFuzz_unsetExecutorDisablesBurnAndRefunds(bool throughIdmd, uint96 value) public {
        _useExecutor(address(0));
        uint256 attached = bound(value, 0, 1 ether);
        _claim(throughIdmd, 701, attached);
        _pending(throughIdmd, 701);
        assertEq(alice.balance, 10 ether);
        assertEq(executor.calls(), 0);
    }

    function testFuzz_dueWithoutEnoughFeeRevertsAtomically(bool throughIdmd, uint96 amount, uint96 value) public {
        executor.configure(bound(amount, 69 ether, type(uint96).max), FEE, 0);
        uint256 attached = bound(value, 0, FEE - 1);
        vm.expectRevert(abi.encodeWithSelector(Registry.BurnFeeRequired.selector, FEE));
        _claim(throughIdmd, 701, attached);
        _rolledBack();
        // The same daily/lifetime allowance remains available on retry with the required fee.
        _claim(throughIdmd, 701, FEE);
        _pending(throughIdmd, 701);
    }

    function test_noFeeAtExactThresholdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Registry.BurnFeeRequired.selector, FEE));
        _claim(false, 701, 0);
        _rolledBack();
    }

    function testFuzz_dueForwardsWholeValueAndExecutorForceRefunds(bool throughIdmd, uint96 amount, uint96 surplus)
        public
    {
        uint256 quotedAmount = bound(amount, 69 ether, type(uint96).max);
        uint256 attached = FEE + bound(surplus, 0, 1 ether);
        executor.configure(quotedAmount, FEE, 0);
        executor.observe(registry, alice, 701);
        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.BurnTriggered(alice, quotedAmount, FEE);
        _claim(throughIdmd, 701, attached);
        _pending(throughIdmd, 701);
        assertEq(executor.calls(), 1);
        assertEq(executor.lastRequested(), quotedAmount);
        assertEq(executor.lastValue(), attached);
        assertEq(executor.lastCaller(), address(registry));
        assertEq(executor.lastRefundTo(), alice);
        assertEq(address(executor).balance, FEE);
        assertEq(alice.balance, 10 ether - FEE);
    }

    function test_exactFeeAndCapAreInclusive() public {
        executor.configure(69 ether, 0.005 ether, 0);
        _claim(true, 701, 0.005 ether);
        _pending(true, 701);
        assertEq(executor.calls(), 1);
        assertEq(alice.balance, 10 ether - 0.005 ether);
    }

    function test_zeroQuoteStillTriggersWhenDue() public {
        executor.configure(69 ether, 0, 0);
        _claim(false, 701, 0);
        _pending(false, 701);
        assertEq(executor.calls(), 1);
        assertEq(executor.lastValue(), 0);
    }

    function testFuzz_quoteAboveCapSkipsWithCodeThree(bool throughIdmd, uint96 fee, uint96 value) public {
        executor.configure(69 ether, bound(fee, 0.005 ether + 1, type(uint96).max), 0);
        uint256 attached = bound(value, 0, 1 ether);
        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.BurnSkipped(alice, 3);
        _claim(throughIdmd, 701, attached);
        _pending(throughIdmd, 701);
        assertEq(executor.calls(), 0);
        assertEq(alice.balance, 10 ether);
    }

    function testFuzz_failedPreviewOrBridgeSkipsAndRefunds(bool throughIdmd, uint8 mode, uint96 surplus) public {
        uint8 failure = uint8(bound(mode, 1, 6));
        uint256 attached = FEE + bound(surplus, 0, 1 ether);
        executor.configure(69 ether, FEE, failure);
        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.BurnSkipped(alice, failure % 2 == 1 ? 1 : 2);
        _claim(throughIdmd, 701, attached);
        _pending(throughIdmd, 701);
        assertEq(executor.calls(), 0);
        assertEq(address(executor).balance, 0);
        assertEq(alice.balance, 10 ether);
    }

    function test_gasArgumentsIncludeOnlyTheValueStipend() public {
        executor.requirePreviewGasCap();
        _claim(false, 701, FEE);
        _pending(false, 701);
        assertGt(executor.lastGas(), 800_000, "nonzero value adds the stipend to the CALL gas argument");
        assertLe(executor.lastGas(), 802_300);
    }

    function test_zeroValueHasNoStipend() public {
        executor.configure(69 ether, 0, 0);
        _claim(false, 701, 0);
        assertGt(executor.lastGas(), 795_000);
        assertLe(executor.lastGas(), 800_000);
    }

    function testFuzz_nonpayableContractWorksWithNoValueExactFeeAndSurplus(bool throughIdmd, uint8 which) public {
        uint256 scenario = bound(which, 0, 2);
        NonpayableBurnClaimant wallet = new NonpayableBurnClaimant();
        curator.set(address(wallet), 1, true, 1, 1, 1);
        idmd.setOwner(7, address(wallet));
        vm.deal(address(wallet), 1 ether);
        executor.configure(scenario == 0 ? 69 ether - 1 : 69 ether, FEE, 0);
        uint256 attached = scenario == 0 ? 0 : scenario == 1 ? FEE : 2 * FEE;
        wallet.claim(registry, throughIdmd, 701, attached);
        assertTrue(registry.pendingOf(address(wallet), 701) != 0);
        assertEq(address(wallet).balance, scenario == 0 ? 1 ether : 1 ether - FEE);
        assertEq(address(registry).balance, 3 ether);
    }

    function test_nonpayableContractAcceptsZeroRefundOnPreviewFailure() public {
        NonpayableBurnClaimant wallet = new NonpayableBurnClaimant();
        curator.set(address(wallet), 1, true, 1, 1, 1);
        executor.configure(69 ether, FEE, 1);
        wallet.claim(registry, false, 701, 0);
        assertTrue(registry.pendingOf(address(wallet), 701) != 0);
    }

    function test_rejectedNonzeroRegistryRefundRevertsAllEffects() public {
        NonpayableBurnClaimant wallet = new NonpayableBurnClaimant();
        curator.set(address(wallet), 1, true, 1, 1, 1);
        idmd.setOwner(7, address(wallet));
        vm.deal(address(wallet), 1 ether);
        executor.configure(69 ether, FEE, 2);
        vm.expectRevert(Registry.BurnRefundFailed.selector);
        wallet.claim(registry, true, 701, FEE);
        assertEq(registry.pendingOf(address(wallet), 701), bytes32(0));
        assertFalse(registry.poolUsed(address(wallet), 701));
        assertEq(registry.idmdSponsored(7), 0);
        assertEq(intake.nonce(), 0);
        assertEq(address(wallet).balance, 1 ether);
        assertEq(address(registry).balance, 3 ether);
    }

    function test_executorReentryIsGuarded() public {
        executor.armReentry(abi.encodeCall(Registry.claimSponsored, (801)));
        _claim(false, 701, FEE);
        _pending(false, 701);
        assertFalse(executor.reentrySucceeded());
        assertEq(executor.reentryError(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
    }

    function test_registryRefundReentryIsGuarded() public {
        ReentrantBurnClaimant wallet = new ReentrantBurnClaimant();
        wallet.arm(registry);
        curator.set(address(wallet), 1, true, 1, 1, 1);
        vm.deal(address(wallet), 1 ether);
        executor.configure(0, FEE, 0);
        wallet.claim(registry, false, 701, FEE);
        assertTrue(registry.pendingOf(address(wallet), 701) != 0);
        assertEq(wallet.refunds(), 1);
        assertFalse(wallet.reentrySucceeded());
        assertEq(wallet.reentryError(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(address(wallet).balance, 1 ether);
        assertEq(address(registry).balance, 3 ether);
    }

    function test_existingChecksAndIntakeFailurePrecedeBurnFeeCheck() public {
        // A due burn with no ETH must not mask any earlier rejection.
        curator.set(alice, 1, false, 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotMember.selector, alice));
        _claim(false, 701, 0);
        curator.set(alice, 1, true, 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(Registry.NotACatalogChainTrait.selector, uint16(1301)));
        _claim(false, 1301, 0);
        vm.mockCallRevert(address(intake), abi.encodeWithSelector(IIntake.requestWithFailure.selector), "unavailable");
        vm.expectRevert(bytes("unavailable"));
        _claim(true, 701, 0);
        _rolledBack();
    }

    function test_paidFunctionsRemainNonpayableAndNeverTriggerBurn() public {
        ask(alice, 701);
        fund(alice, PRICE);
        vm.prank(alice);
        registry.requestSharedFact(1201, PRICE);
        assertEq(executor.calls(), 0);
        assertEq(registry.lastPoolDay(alice), 0);
        assertEq(address(registry).balance, 3 ether);
        uint16[] memory ids = new uint16[](1);
        ids[0] = 801;
        bytes[] memory payloads = new bytes[](5);
        payloads[0] = abi.encodeCall(Registry.upgrade, (ids, PRICE));
        payloads[1] = abi.encodeCall(Registry.requestSharedFact, (1201, PRICE));
        payloads[2] = abi.encodeCall(Registry.sponsor, (1));
        payloads[3] = abi.encodeCall(Registry.mintCard, ());
        payloads[4] = abi.encodeCall(Registry.registerSpec, (t1Spec(CURATOR_ADDR, "Nonpayable")));
        for (uint256 i; i < payloads.length; ++i) {
            vm.prank(alice);
            (bool ok,) = address(registry).call{value: 1}(payloads[i]);
            assertFalse(ok, "paid IMD path must reject ETH");
        }
        vm.prank(alice);
        (bool accepted,) = address(registry).call{value: 1}("");
        assertFalse(accepted, "no receive or fallback");
    }
}
