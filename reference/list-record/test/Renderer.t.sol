// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ListRecordRenderer} from "../src/ListRecordRenderer.sol";
import {CardData} from "../src/interfaces/IListRecordRenderer.sol";
import {Str} from "../src/lib/Str.sol";

contract RendererTest is Test {
    ListRecordRenderer internal renderer;

    address internal constant SYNTHETIC_CLAIMANT = 0x0000000000000000000000000000000000000921;
    address internal constant SYNTHETIC_OWNER = 0x0000000000000000000000000000000000000B0b;

    function setUp() public {
        renderer = new ListRecordRenderer(_blob(), _offsets());
    }

    function _blob() internal view returns (bytes memory) {
        return vm.parseBytes(vm.trim(vm.readFile("template/blob.hex")));
    }

    function _offsets() internal view returns (uint16[44] memory offs) {
        string[] memory parts = vm.split(vm.trim(vm.readFile("template/offsets.txt")), ",");
        require(parts.length == 44, "offsets: expected 44 integers");
        for (uint256 i; i < parts.length; ++i) {
            offs[i] = uint16(vm.parseUint(parts[i]));
        }
    }

    function _syntheticHeld() internal pure returns (CardData memory) {
        return CardData({
            id: 7,
            claimant: SYNTHETIC_CLAIMANT,
            owner: SYNTHETIC_CLAIMANT,
            points: 921,
            weightWei: 0.8497 ether,
            creditWei: 0.69 ether,
            deposits: 7,
            hour: 0,
            joinIndex: 47,
            claimedAtHour: 41,
            grace: true
        });
    }

    function _syntheticTransferred() internal pure returns (CardData memory d) {
        d = _syntheticHeld();
        d.owner = SYNTHETIC_OWNER;
    }

    function _syntheticWidth() internal pure returns (CardData memory) {
        return CardData({
            id: type(uint32).max,
            claimant: address(type(uint160).max),
            owner: address(type(uint160).max),
            points: 44_721,
            weightWei: 2_000 ether,
            creditWei: 1_000 ether,
            deposits: type(uint32).max,
            hour: uint256(type(uint32).max) - 1,
            joinIndex: type(uint32).max,
            claimedAtHour: type(uint32).max,
            grace: false
        });
    }

    function test_syntheticHeldPreimageSvgAndURIReproduceExactly() public view {
        _assertGolden("synthetic_held", _syntheticHeld());
    }

    function test_syntheticTransferredPreimageSvgAndURIReproduceExactly() public view {
        _assertGolden("synthetic_transferred", _syntheticTransferred());
    }

    function test_syntheticWidthPreimageSvgAndURIReproduceExactly() public view {
        _assertGolden("synthetic_width", _syntheticWidth());
    }

    function test_finalPresentationUsesFullAddressCreditFirstAndPermanentFrame() public {
        string memory preimage = string(renderer.preimage(_syntheticHeld()));
        assertTrue(vm.contains(preimage, "0x0000000000000000000000000000000000000921"), "full claimant address missing");
        assertFalse(vm.contains(preimage, "%E2%80%A6"), "claimant address was shortened");
        assertTrue(vm.contains(preimage, "0.6900%20ETH%20credit%20%C2%B7%200.8497%20ETH%20weight"), "fact order");
        assertTrue(vm.contains(preimage, "fill='%2300dd33'%20font-size='180'"), "points colour");
        assertTrue(vm.contains(preimage, "stroke='%2300dd33'%20stroke-width='4'"), "permanent frame");
        assertTrue(vm.contains(preimage, "WhitelistCurator.sol"), "provenance footer");
        assertFalse(vm.contains(preimage, "Status"), "status trait returned");
        assertFalse(vm.contains(preimage, "sealed"), "sealed state returned");
        assertFalse(vm.contains(preimage, "settled"), "settled state returned");
        assertFalse(vm.contains(preimage, "%2300ff41"), "legacy dynamic green returned");
    }

    function test_eth4TruncatesAndNeverRounds() public {
        StrHarness s = new StrHarness();
        assertEq(s.eth4(1.00005 ether), "1.0000", "rounded up across fourth decimal");
        assertEq(s.eth4(0.99999 ether), "0.9999", "rounded up across whole number");
        assertEq(s.eth4(0), "0.0000");
        assertEq(s.eth4(1 wei), "0.0000");
        assertEq(s.eth4(0.0001 ether), "0.0001");
        assertEq(s.eth4(0.001 ether), "0.0010");
        assertEq(s.eth4(902107370000000000000), "902.1073");
    }

    function test_addressAndIntegerHelpersRenderLowercaseASCII() public {
        StrHarness s = new StrHarness();
        assertEq(s.u(0), "0");
        assertEq(s.u(44_721), "44721");
        // Vendored copy: the upstream address vector was replaced by a synthetic one (see reference/PROVENANCE.md).
        assertEq(s.hexAddr(0x00000000000000000000000000000000AbCdC1a1), "0x00000000000000000000000000000000abcdc1a1");
    }

    function _assertGolden(string memory name_, CardData memory d) internal view {
        string memory base = string.concat("test/fixtures/golden_", name_);
        string memory wantPreimage = vm.readFile(string.concat(base, "_preimage.txt"));
        string memory wantURI = vm.readFile(string.concat(base, "_uri.txt"));
        string memory wantSvg = vm.readFile(string.concat(base, "_svg.txt"));

        bytes memory preimage = renderer.preimage(d);
        assertEq(string(preimage), wantPreimage, "preimage");
        assertEq(renderer.tokenURI(d), wantURI, "uri");

        string memory image = vm.parseJsonString(string(preimage), ".image");
        string memory encoded = vm.replace(image, "data:image/svg+xml,", "");
        assertEq(string(_pctDecode(bytes(encoded))), wantSvg, "svg");
    }

    function _pctDecode(bytes memory input) internal pure returns (bytes memory out) {
        out = new bytes(input.length);
        uint256 o;
        uint256 i;
        while (i < input.length) {
            if (input[i] == "%") {
                out[o++] = bytes1(_nibble(input[i + 1]) * 16 + _nibble(input[i + 2]));
                i += 3;
            } else {
                out[o++] = input[i++];
            }
        }
        assembly {
            mstore(out, o)
        }
    }

    function _nibble(bytes1 c) internal pure returns (uint8) {
        uint8 b = uint8(c);
        if (b >= 48 && b <= 57) return b - 48;
        if (b >= 65 && b <= 70) return b - 55;
        return b - 87;
    }
}

contract StrHarness {
    function u(uint256 v) external pure returns (string memory) {
        return string(Str.u(v));
    }

    function eth4(uint256 w) external pure returns (string memory) {
        return string(Str.eth4(w));
    }

    function hexAddr(address a) external pure returns (string memory) {
        return string(Str.hexAddr(a));
    }
}
