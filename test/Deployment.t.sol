// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Composer} from "../src/Composer.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Spec} from "../src/Types.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";

contract DeploymentTest is SwornTest {
    using stdStorage for StdStorage;

    function _deploy(address c, address t, address i, address r, address co, address e) internal returns (Registry) {
        return new Registry(c, t, i, vm.addr(SIGNER_KEY), r, co, e);
    }

    function test_constructorAllSixteenDependencyCodeCombinations() public {
        for (uint256 mask; mask < 8; ++mask) {
            for (uint256 coded; coded < 2; ++coded) {
                address c = address(uint160(0x10000 + mask * 16 + coded));
                address t = address(uint160(0x20000 + mask * 16 + coded));
                address i = address(uint160(0x30000 + mask * 16 + coded));
                address e = address(uint160(0x40000 + mask * 16 + coded));
                if (mask & 1 != 0) vm.cloneAccount(address(curator), c);
                if (mask & 2 != 0) vm.cloneAccount(address(token), t);
                if (mask & 4 != 0) vm.cloneAccount(address(intake), i);
                if (coded == 1) vm.etch(e, address(executor).code);
                if (mask != 0 && (coded == 0 || mask != 7)) vm.expectRevert();
                Registry result = _deploy(c, t, i, address(renderer), address(composer), e);
                if (mask == 0 || (mask == 7 && coded == 1)) assertEq(result.burnExecutor(), e);
            }
        }
    }

    function test_helperChecksApplyOnAndOffFloor() public {
        for (uint256 floor; floor < 2; ++floor) {
            address c = floor == 0 ? address(curator) : address(100);
            address t = floor == 0 ? address(token) : address(101);
            address i = floor == 0 ? address(intake) : address(102);
            vm.expectRevert(Registry.DependencyHasNoCode.selector);
            _deploy(c, t, i, address(103), address(composer), address(executor));
            vm.expectRevert(Registry.DependencyHasNoCode.selector);
            _deploy(c, t, i, address(renderer), address(104), address(executor));
        }
    }

    function test_decimalsSettlementZeroPriceAndZeroAddressesRejected() public {
        token.setDecimals(6);
        vm.expectRevert(Registry.BadDependency.selector);
        _deploy(
            address(curator), address(token), address(intake), address(renderer), address(composer), address(executor)
        );
        token.setDecimals(18);
        curator.setSettled(false);
        vm.expectRevert(Registry.BadDependency.selector);
        _deploy(
            address(curator), address(token), address(intake), address(renderer), address(composer), address(executor)
        );
        curator.setSettled(true);
        intake.setPrice(0);
        vm.expectRevert(Registry.ZeroPrice.selector);
        _deploy(
            address(curator), address(token), address(intake), address(renderer), address(composer), address(executor)
        );
        vm.expectRevert(Registry.ZeroAddress.selector);
        _deploy(address(0), address(token), address(intake), address(renderer), address(composer), address(executor));
    }

    function test_mainnetEmptyChainRehearsalAndExplicitScriptArguments() public {
        Deploy d = new Deploy();
        (Renderer r, Composer c, Registry reg) = d.deployForChain();
        assertEq(reg.curator(), 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91);
        assertEq(reg.imd(), 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7);
        assertEq(reg.renderer(), address(r));
        assertEq(reg.composer(), address(c));
        assertEq(reg.burnExecutor(), 0xe29386719C155B6847aD5a4E97C6674f10ffc750);
        assertEq(reg.totalSupply(), 0);
        vm.chainId(11155111);
        (,, Registry sep) = d.deployForChain();
        assertEq(sep.curator(), 0x0919ba50b206C3F31D516De818b1fBc7dA21653D);
        assertEq(sep.burnExecutor(), 0x097A19e0f021BBA5072701132625ad2401043A2E);
    }

    function test_runtimeDeterminismSizesImmutableReferencesAndForbiddenOpcodes() public {
        assertLe(type(Registry).creationCode.length + 7 * 32, 49152);
        assertLe(type(Renderer).creationCode.length, 49152);
        assertLe(type(Composer).creationCode.length, 49152);
        Registry b = _deploy(
            address(curator), address(token), address(intake), address(renderer), address(composer), address(executor)
        );
        Renderer r = new Renderer();
        Composer c = new Composer();
        assertEq(address(b).code, address(registry).code);
        assertEq(address(r).code, address(renderer).code);
        assertEq(address(c).code, address(composer).code);
        address[3] memory addresses = [address(registry), address(renderer), address(composer)];
        string[3] memory names = ["Registry", "Renderer", "Composer"];
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            bytes memory code = addresses[i].code;
            assertLe(code.length, 24576);
            sum += code.length;
            string memory artifact = vm.readFile(string.concat("out/", names[i], ".sol/", names[i], ".json"));
            if (vm.keyExistsJson(artifact, ".deployedBytecode.immutableReferences")) {
                assertEq(vm.parseJsonKeys(artifact, ".deployedBytecode.immutableReferences").length, 0);
            }
            bool reachable = true;
            for (uint256 j; j < code.length; ++j) {
                uint8 op = uint8(code[j]);
                if (op == 0x5b) reachable = true;
                if (op >= 0x60 && op <= 0x7f) {
                    j += op - 0x5f;
                    continue;
                }
                if (reachable) assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "escape opcode");
                if (op == 0 || op == 0x56 || op == 0xf3 || op == 0xfd || op == 0xfe || op == 0xff) reachable = false;
            }
        }
        emit log_named_uint("combined runtime bytes", sum);
        assertLe(sum, 69800);
    }

    function test_registrationEndsAt65534() public {
        stdstore.target(address(registry)).sig("nextSpecId()").enable_packed_slots().checked_write(65534);
        Spec memory s = _spec(1);
        assertEq(registry.registerSpec(s, 65534), 65534);
        assertEq(registry.nextSpecId(), 65535);
        vm.expectRevert(Registry.SpecsExhausted.selector);
        registry.registerSpec(s, 0);
        assertEq(registry.specOf(65534).name, s.name);
    }

    function test_noAdminOrRoyaltyAndERC4906Interface() public {
        assertTrue(registry.supportsInterface(0x49064906));
        assertTrue(registry.supportsInterface(0x80ac58cd));
        assertFalse(registry.supportsInterface(0x2a55205a));
        (bool ok,) = address(registry).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
        (ok,) = address(registry).call(abi.encodeWithSignature("pause()"));
        assertFalse(ok);
        vm.deal(address(this), 1 ether);
        (ok,) = address(registry).call{value: 1}("");
        assertFalse(ok);
    }
}
