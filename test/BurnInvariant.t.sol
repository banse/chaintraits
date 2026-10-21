// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {MockCurator, MockIDMD, MockIMD} from "./mocks/Mocks.sol";
import {MockBurnExecutor} from "./mocks/MockBurnExecutor.sol";

contract BurnHandler is Test {
    struct Scenario {
        uint256 amount;
        uint256 fee;
        uint256 value;
        uint8 mode;
        bool throughIdmd;
    }
    Registry internal registry;
    MockBurnExecutor internal executor;
    MockCurator internal curator;
    MockIDMD internal idmd;
    uint256 public attempts;
    uint256 public accepted;
    uint256 public feesSpent;
    uint256 public poolSpent;

    constructor(Registry registry_, MockBurnExecutor executor_, MockCurator curator_, MockIDMD idmd_) {
        registry = registry_;
        executor = executor_;
        curator = curator_;
        idmd = idmd_;
    }

    function claim(uint96 amount, uint96 fee, uint96 value, uint8 mode, bool throughIdmd) external {
        _claim(
            Scenario(
                bound(amount, 0, 140 ether),
                bound(fee, 0, 0.01 ether),
                bound(value, 0, 0.02 ether),
                mode % 7,
                throughIdmd
            )
        );
    }

    function _claim(Scenario memory s) internal {
        executor.configure(s.amount, s.fee, s.mode);
        address claimant = address(uint160(0x100000 + ++attempts));
        curator.set(claimant, 1, true, 1, 1, 1);
        vm.deal(claimant, 1 ether);
        uint256 beforeEth = address(registry).balance;
        uint256 beforePool = registry.pool();
        vm.prank(claimant);
        (bool ok,) =
            address(registry).call{value: s.value}(abi.encodeCall(Registry.claimSponsored, (701, type(uint256).max)));
        bool due = s.mode % 2 == 0 && s.amount >= 69 ether && s.fee <= 0.005 ether && s.value >= s.fee;
        assertTrue(ok, "a short attachment skips the burn instead of reverting the claim");
        assertEq(address(registry).balance, beforeEth, "each claim preserves the prior ETH balance");
        accepted++;
        poolSpent += 0.5 ether;
        uint256 spent = due && s.mode == 0 ? s.fee : 0;
        feesSpent += spent;
        assertEq(registry.pool(), beforePool - 0.5 ether);
        assertTrue(registry.pendingOf(claimant, 701) != 0);
        assertTrue(registry.poolUsed(claimant, 701));
        assertEq(claimant.balance, 1 ether - spent);
    }
}

contract BurnInvariantTest is Base {
    MockBurnExecutor internal executor;
    BurnHandler internal handler;

    function setUp() public override {
        super.setUp();
        executor = new MockBurnExecutor();
        registry = new Registry(
            CURATOR_ADDR,
            address(idmd),
            address(imd),
            address(intake),
            attester,
            address(renderer),
            address(composer),
            address(executor)
        );
        imd.mint(address(registry), 1000 ether);
        vm.deal(address(registry), 4 ether);
        handler = new BurnHandler(registry, executor, curator, idmd);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = handler.claim.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_registryRetainsNoClaimETHAndPoolOnlyFundsOracleRequests() public view {
        assertEq(address(registry).balance, 4 ether);
        assertEq(address(executor).balance, handler.feesSpent());
        assertEq(registry.pool(), 1000 ether - handler.poolSpent());
        assertEq(imd.balanceOf(address(intake)), handler.poolSpent());
        assertEq(intake.nonce(), handler.accepted());
    }
}
