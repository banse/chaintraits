// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Tables} from "../src/lib/Tables.sol";
import {Spec, OracleAttestation} from "../src/interfaces/Types.sol";

contract MetadataTest is BaseTest {
    function document() internal view returns (string memory) {
        string memory uri = registry.tokenURI(1);
        return string(Base64.decode(Tables.slice(bytes(uri), 29, bytes(uri).length - 29)));
    }

    function test_metadataWindowsPanelMinimaAndCommunityOrder() public {
        curator.set(ALICE, 0, true, 10, 800 ether, 10000);
        vm.prank(ALICE);
        registry.mintCard();
        bytes32 operator = ask(ALICE, 601);
        OracleAttestation memory a = attestation(operator, abi.encode(true));
        uint64 close = a.toBlock;
        assertTrue(deliver(operator, a));
        uint16[5] memory community;
        for (uint8 kind = 1; kind <= 5; ++kind) {
            uint16 id = register(kind);
            community[kind - 1] = id;
            if (kind == 3) {
                bytes32 rid = shared(id);
                address[] memory list = new address[](32);
                list[0] = ALICE;
                assertTrue(deliver(rid, attestation(rid, abi.encode(list))));
                vm.prank(ALICE);
                registry.applySharedFact(id, list);
            } else {
                bytes32 rid = ask(ALICE, id);
                assertTrue(deliver(rid, attestation(rid, abi.encode(uint256(1)))));
            }
        }
        vm.roll(vm.getBlockNumber() + 10000);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        string memory doc = document();
        assertEq(vm.parseJsonString(doc, ".name"), "Sworn #1");
        assertEq(vm.parseJsonString(doc, ".attributes[0].value"), "0x000000000000000000000000000000000000c1a1");
        assertEq(vm.parseJsonUint(doc, ".oracle[0].toBlock"), close);
        assertEq(vm.parseJsonString(doc, ".oracle[0].template"), "T6");
        for (uint256 i; i < 6; ++i) {
            uint256 kind = i == 0 ? 6 : i;
            uint256 p = kind == 3 || kind >= 5 ? composer.PANEL_SIZE() : composer.CHAIN_PANEL();
            uint256 q = kind == 3 || kind >= 5 ? composer.PANEL_QUORUM() : composer.CHAIN_QUORUM();
            string memory path = string.concat(".oracle[", vm.toString(i), "]");
            assertEq(vm.parseJsonUint(doc, string.concat(path, ".minPanelSize")), p);
            assertEq(vm.parseJsonUint(doc, string.concat(path, ".minQuorum")), q);
        }
        for (uint256 i; i < 5; ++i) {
            assertEq(vm.parseJsonUint(doc, string.concat(".community[", vm.toString(i), "]")), community[i]);
        }
        vm.prank(ALICE);
        registry.transferFrom(ALICE, BOB, 1);
        assertEq(document(), doc);
    }

    function test_noCardAndCollectionInterfaces() public {
        assertEq(registry.totalSupply(), 0);
        assertEq(registry.name(), "Sworn");
        assertEq(registry.symbol(), "SWORN");
        assertTrue(registry.supportsInterface(0x80ac58cd));
        assertTrue(registry.supportsInterface(0x5b5e139f));
        assertTrue(registry.supportsInterface(0x49064906));
        assertFalse(registry.supportsInterface(0x2a55205a));
        vm.expectRevert(abi.encodeWithSelector(Registry.NoCard.selector, 1));
        registry.tokenURI(1);
        vm.expectRevert(abi.encodeWithSelector(Renderer.NoCard.selector, 1));
        renderer.tokenURIOf(address(registry), 1);
        vm.expectRevert(abi.encodeWithSelector(Renderer.UnknownTrait.selector, 100));
        renderer.traitName(100);
    }
}
