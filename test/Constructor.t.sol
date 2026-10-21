// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Composer} from "../src/Composer.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract ConstructorTest is BaseTest {
    function construct(address render, address compose, address executor) external returns (Registry) {
        return
            new Registry(
                address(curator), address(imd), address(intake), vm.addr(SIGNING_KEY), render, compose, executor
            );
    }

    function test_allCodeCombinationsFloorOnlyWhenAllThreeEmpty() public {
        bytes memory cc = address(curator).code;
        bytes memory tc = address(imd).code;
        bytes memory ic = address(intake).code;
        bytes memory ec = address(sink).code;
        for (uint256 mask; mask < 8; ++mask) {
            for (uint256 e; e < 2; ++e) {
                vm.etch(address(curator), mask & 1 != 0 ? cc : new bytes(0));
                vm.etch(address(imd), mask & 2 != 0 ? tc : new bytes(0));
                vm.etch(address(intake), mask & 4 != 0 ? ic : new bytes(0));
                vm.etch(address(sink), e == 1 ? ec : new bytes(0));
                bool valid = mask == 0 || (mask == 7 && e == 1);
                if (!valid) vm.expectRevert();
                Registry candidate = this.construct(address(renderer), address(composer), address(sink));
                if (valid) assertEq(candidate.curator(), address(curator));
            }
        }
    }

    function test_helpersAlwaysCodeExecutorOnlyOffFloorAndDecimals() public {
        vm.expectRevert(Registry.DependencyHasNoCode.selector);
        this.construct(ALICE, address(composer), address(sink));
        vm.expectRevert(Registry.DependencyHasNoCode.selector);
        this.construct(address(renderer), ALICE, address(sink));
        vm.expectRevert(Registry.DependencyHasNoCode.selector);
        this.construct(address(renderer), address(composer), ALICE);
        imd.setPrecision(6);
        vm.expectRevert(bytes("decimals"));
        this.construct(address(renderer), address(composer), address(sink));
        imd.setPrecision(18);
        curator.setSettled(false);
        vm.expectRevert(bytes("settled"));
        this.construct(address(renderer), address(composer), address(sink));
        curator.setSettled(true);
        intake.setPrice(0);
        vm.expectRevert(Registry.ZeroPrice.selector);
        this.construct(address(renderer), address(composer), address(sink));
        vm.etch(address(curator), hex"");
        vm.etch(address(imd), hex"");
        vm.etch(address(intake), hex"");
        vm.expectRevert(Registry.DependencyHasNoCode.selector);
        this.construct(ALICE, address(composer), ALICE);
        vm.expectRevert(Registry.DependencyHasNoCode.selector);
        this.construct(address(renderer), ALICE, ALICE);
        Registry candidate = this.construct(address(renderer), address(composer), ALICE);
        assertEq(candidate.burnExecutor(), ALICE);
    }

    function constructArgs(address[7] calldata args) external returns (address) {
        return address(new Registry(args[0], args[1], args[2], args[3], args[4], args[5], args[6]));
    }

    function test_allSevenZeroArgumentsRevert() public {
        address[7] memory args = [
            address(curator),
            address(imd),
            address(intake),
            vm.addr(SIGNING_KEY),
            address(renderer),
            address(composer),
            address(sink)
        ];
        for (uint256 i; i < 7; ++i) {
            address saved = args[i];
            args[i] = address(0);
            vm.expectRevert(Registry.ZeroAddress.selector);
            this.constructArgs(args);
            args[i] = saved;
        }
    }

    function test_deployScriptEmptyChainMainnetAndSepolia() public {
        Deploy deployer = new Deploy();
        (Renderer r, Composer c, Registry reg) = deployer.deployForChain();
        assertEq(reg.renderer(), address(r));
        assertEq(reg.composer(), address(c));
        assertEq(reg.curator(), 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91);
        assertEq(reg.imd(), 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7);
        assertEq(reg.burnExecutor(), 0xe29386719C155B6847aD5a4E97C6674f10ffc750);
        assertEq(reg.name(), "Sworn");
        assertEq(reg.symbol(), "SWORN");
        assertEq(reg.totalSupply(), 0);
        vm.chainId(11155111);
        (,, reg) = deployer.deployForChain();
        assertEq(reg.curator(), 0x0919ba50b206C3F31D516De818b1fBc7dA21653D);
    }
}
