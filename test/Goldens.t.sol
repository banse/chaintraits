// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {Renderer} from "../src/Renderer.sol";
import {GoldenRegistry} from "./Mocks.sol";
import {Hive} from "../src/lib/Hive.sol";
import {HiveTables} from "../src/lib/HiveTables.sol";
import {Catalog} from "../src/lib/Catalog.sol";
import {Text} from "../src/lib/Text.sol";
import {Spec} from "../src/interfaces/Types.sol";

contract DrawingHarness {
    function svg(uint16[13] memory tops, uint256 count) external pure returns (string memory) {
        return Hive.draw(tops, count);
    }

    function step(uint256 count) external pure returns (uint256) {
        return Hive.steps(count);
    }

    function rings(uint256 count, uint256 slot) external pure returns (uint256) {
        return Hive.rings(count, slot);
    }

    function rare(uint16 id) external pure returns (bool) {
        return Hive.rare(id);
    }

    function quote(string memory s) external pure returns (string memory) {
        return Text.quote(s, true);
    }
}

contract HostileRegistry {
    uint256 public mode;

    function setMode(uint256 m) external {
        mode = m;
    }

    function claimantOf(uint256) external pure returns (address) {
        return address(0xc1a1);
    }

    function traitsOf(address) external pure returns (uint16[] memory ids) {
        ids = new uint16[](2);
        ids[0] = 50;
        ids[1] = 1400;
    }

    function verifiedSpecsOf(address) external view returns (uint16[] memory ids) {
        ids = new uint16[](mode == 0 ? 0 : 1);
        if (mode != 0) ids[0] = 10001;
    }

    function specOf(uint16) external view returns (Spec memory) {
        uint256 m = mode;
        assembly {
            switch m
            case 1 {
                mstore(0, not(0))
                return(0, 416)
            }
            case 2 {
                mstore(0, 32)
                mstore(384, not(0))
                return(0, 416)
            }
            default { return(0, 1048576) }
        }
    }
}

contract GoldensTest is Test {
    Renderer internal renderer;
    GoldenRegistry internal mock;
    DrawingHarness internal drawing;

    function setUp() public {
        renderer = new Renderer();
        mock = new GoldenRegistry();
        drawing = new DrawingHarness();
    }

    function test_allSyntheticGoldensByteForByte() public {
        string memory cases = vm.readFile("test/fixtures/cases.json");
        for (uint256 i; i < 14; ++i) {
            string memory root = string.concat(".[", vm.toString(i), "]");
            string memory name = vm.parseJsonString(cases, string.concat(root, ".name"));
            uint256[] memory source = vm.parseJsonUintArray(cases, string.concat(root, ".ids"));
            uint16[] memory ids = new uint16[](source.length);
            uint16[13] memory tops;
            for (uint256 j; j < ids.length; ++j) {
                ids[j] = uint16(source[j]);
                uint16 f = ids[j] / 100;
                uint16 prev = tops[f - 1];
                if (f == 11 ? (prev == 0 || ids[j] < prev) : ids[j] > prev) tops[f - 1] = ids[j];
            }
            uint256 count = vm.parseJsonUint(cases, string.concat(root, ".count"));
            uint256 token = vm.parseUint(vm.parseJsonString(cases, string.concat(root, ".token")));
            bool hostile = vm.parseJsonBool(cases, string.concat(root, ".hostile"));
            mock.configure(ids, count, hostile);
            assertEq(drawing.svg(tops, count), vm.readFile(string.concat("test/fixtures/", name, ".svg")), name);
            assertEq(
                keccak256(bytes(renderer.tokenURIOf(address(mock), token))),
                keccak256(bytes(vm.readFile(string.concat("test/fixtures/", name, ".uri")))),
                name
            );
        }
    }

    function test_rareDotsRingsAndStepTable() public view {
        assertEq(drawing.step(39), 0);
        assertEq(drawing.step(40), 2);
        assertEq(drawing.step(70), 9);
        assertEq(drawing.step(5000), 58);
        assertEq(drawing.step(8192), 64);
        assertEq(drawing.step(type(uint256).max), 64);
        for (uint256 n; n <= 40; ++n) {
            uint256 sum;
            for (uint256 s; s < 13; ++s) {
                uint256 k = drawing.rings(n, s);
                assertLe(k, 3);
                sum += k;
            }
            assertEq(sum, n > 39 ? 39 : n);
        }
        uint16[9] memory rare = [uint16(202), 801, 901, 1001, 1101, 1102, 1103, 1104, 1201];
        for (uint256 i; i < rare.length; ++i) {
            assertTrue(drawing.rare(rare[i]));
        }
        assertFalse(drawing.rare(1105));
        assertFalse(drawing.rare(601));
    }

    function test_hostileRepliesFailCleanlyAndForeignFamiliesSkip() public {
        HostileRegistry h = new HostileRegistry();
        assertGt(bytes(renderer.tokenURIOf(address(h), 1)).length, 0);
        for (uint256 m = 1; m <= 3; ++m) {
            h.setMode(m);
            uint256 beforeGas = gasleft();
            (bool ok, bytes memory result) =
                address(renderer).staticcall{gas: 5000000}(abi.encodeCall(renderer.tokenURIOf, (address(h), 1)));
            uint256 used = beforeGas - gasleft();
            assertFalse(ok);
            assertLt(used, 4900000);
            if (result.length >= 4) assertTrue(bytes4(result) != bytes4(0x4e487b71), "panic");
        }
    }

    function test_singleQuoteEscapedAndNoCardPreview() public {
        assertEq(drawing.quote("'"), '"\\u0027"');
        mock.configure(new uint16[](0), 0, false);
        assertGt(
            bytes(renderer.tokenURIOf(address(mock), 0)).length, 0, "synthetic preview registry needs no minted token"
        );
    }
}
