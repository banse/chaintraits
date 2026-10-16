// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Composer} from "../src/Composer.sol";
import {MockCurator, MockIntake} from "./mocks/Mocks.sol";
import {IWhitelistCurator} from "../src/interfaces/IWhitelistCurator.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @notice Launch discipline: no immutables (empty `immutableReferences` in every artifact), two
///         deployments with identical runtime code, EIP-170, the deploy script's constants.
contract ArtifactsTest is Test {
    function _immutableRefs(string memory artifact) internal view returns (string memory) {
        string memory j = vm.readFile(artifact);
        // solc omits `immutableReferences` when there is none; present, it must be an empty object
        if (!vm.keyExistsJson(j, ".deployedBytecode.immutableReferences")) return "";
        string[] memory keys = vm.parseJsonKeys(j, ".deployedBytecode.immutableReferences");
        return keys.length == 0 ? "" : keys[0];
    }

    function test_noImmutableReferencesInAnyArtifact() public view {
        assertEq(_immutableRefs("out/Registry.sol/Registry.json"), "", "Registry has immutables");
        assertEq(_immutableRefs("out/Renderer.sol/Renderer.json"), "", "Renderer has immutables");
        assertEq(_immutableRefs("out/Composer.sol/Composer.json"), "", "Composer has immutables");
    }

    function test_twoDeploymentsHaveIdenticalRuntimeCode() public {
        Renderer r1 = new Renderer();
        Renderer r2 = new Renderer();
        Composer c1 = new Composer();
        Composer c2 = new Composer();
        Registry a = new Registry(
            address(new MockCurator()),
            address(2),
            address(3),
            address(new MockIntake(address(3))),
            address(5),
            address(r1),
            address(c1),
            address(0)
        );
        Registry b = new Registry(
            address(new MockCurator()),
            address(7),
            address(8),
            address(new MockIntake(address(8))),
            address(10),
            address(r2),
            address(c2),
            address(0)
        );
        assertEq(address(a).code, address(b).code, "registry runtime differs");
        assertEq(address(r1).code, address(r2).code, "renderer runtime differs");
        assertEq(address(c1).code, address(c2).code, "composer runtime differs");
        assertLt(address(a).code.length, 24_576, "registry exceeds EIP-170");
        assertLe(address(r1).code.length, 24_576);
        assertLe(address(c1).code.length, 24_576);
        assertEq(address(a).code, vm.getDeployedCode("Registry.sol:Registry"), "runtime equals the artifact");
    }

    function test_constructorRejectsZeroAddressesAndStoresTheRest() public {
        Renderer r = new Renderer();
        Composer c = new Composer();
        vm.expectRevert(Registry.ZeroAddress.selector);
        new Registry(address(0), address(2), address(3), address(4), address(5), address(r), address(c), address(0));
        vm.expectRevert(Registry.ZeroAddress.selector);
        new Registry(address(1), address(2), address(3), address(4), address(5), address(0), address(c), address(0));
        vm.warp(1_791_700_000);
        MockCurator curator = new MockCurator();
        MockIntake intake = new MockIntake(address(3));
        Registry reg = new Registry(
            address(curator), address(2), address(3), address(intake), address(5), address(r), address(c), address(0)
        );
        assertEq(address(reg.curator()), address(curator));
        assertEq(address(reg.idmd()), address(2));
        assertEq(address(reg.imd()), address(3));
        assertEq(address(reg.intake()), address(intake));
        assertEq(reg.attester(), address(5));
        assertEq(address(reg.renderer()), address(r));
        assertEq(address(reg.composer()), address(c));
        assertEq(address(reg.burnExecutor()), address(0), "zero explicitly disables the burn rule");
        assertEq(reg.deployedAt(), 1_791_700_000);
        assertEq(reg.nextSpecId(), 10001);
        assertEq(reg.ACTION(), 0x6f7261636c652e72657175657374406f7261636c652d31000000000000000000);
    }

    function test_constructorRejectsUnsettledOrUnavailableCurator() public {
        Renderer r = new Renderer();
        Composer c = new Composer();
        MockCurator curator = new MockCurator();
        bytes memory settlementRead = abi.encodeCall(IWhitelistCurator.isSettled, ());
        vm.mockCall(address(curator), settlementRead, abi.encode(false));
        vm.expectRevert("Curator not settled");
        new Registry(
            address(curator), address(2), address(3), address(4), address(5), address(r), address(c), address(0)
        );
        vm.mockCallRevert(address(curator), settlementRead, "unavailable");
        vm.expectRevert(bytes("unavailable"));
        new Registry(
            address(curator), address(2), address(3), address(4), address(5), address(r), address(c), address(0)
        );
        vm.clearMockedCalls();
        vm.expectRevert();
        new Registry(
            makeAddr("no curator code"),
            address(2),
            address(3),
            address(4),
            address(5),
            address(r),
            address(c),
            address(0)
        );
    }

    function test_deployScriptUsesTheFiveStaticAddresses() public {
        Deploy d = new Deploy();
        assertEq(d.CURATOR(), 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91);
        assertEq(d.IDMD(), 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D);
        assertEq(d.IMD(), 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7);
        assertEq(d.INTAKE_V2(), 0xa43e6F75ee006411F79Ac1C84120606C2330DE82);
        assertEq(d.ATTESTER(), 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982);
        assertEq(d.BURN_EXECUTOR(), 0xe29386719C155B6847aD5a4E97C6674f10ffc750);
        deployCodeTo("Mocks.sol:MockCurator", d.CURATOR());
        deployCodeTo("Mocks.sol:MockIntake", abi.encode(d.IMD()), d.INTAKE_V2());
        Registry reg = d.deploy(d.CURATOR(), d.IDMD(), d.IMD(), d.INTAKE_V2(), d.ATTESTER(), d.BURN_EXECUTOR());
        assertEq(address(reg.curator()), d.CURATOR());
        assertEq(reg.attester(), d.ATTESTER());
        assertEq(address(reg.burnExecutor()), d.BURN_EXECUTOR());
        assertTrue(address(reg.renderer()).code.length > 0);
        assertTrue(address(reg.composer()).code.length > 0);
    }

    function test_sepoliaRehearsalPassesZeroBurnExecutor() public {
        vm.chainId(11155111);
        Deploy d = new Deploy();
        MockCurator curator = new MockCurator();
        MockIntake intake = new MockIntake(d.IMD());
        Registry reg = d.deploy(address(curator), d.IDMD(), d.IMD(), address(intake), d.ATTESTER(), address(0));
        assertEq(address(reg.burnExecutor()), address(0));
        assertEq(address(reg).code, vm.getDeployedCode("Registry.sol:Registry"));
    }

    function test_noForbiddenOpcodesInRuntime() public {
        Renderer r = new Renderer();
        Composer c = new Composer();
        Registry reg = new Registry(
            address(new MockCurator()),
            address(2),
            address(3),
            address(new MockIntake(address(3))),
            address(5),
            address(r),
            address(c),
            address(0)
        );
        address[3] memory targets = [address(reg), address(r), address(c)];
        for (uint256 t; t < 3; ++t) {
            bytes memory code = targets[t].code;
            for (uint256 j; j < code.length; ++j) {
                uint8 op = uint8(code[j]);
                if (op >= 0x60 && op <= 0x7f) {
                    j += op - 0x5f;
                    continue;
                }
                assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
            }
        }
    }
}
