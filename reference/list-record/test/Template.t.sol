// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ListRecordRenderer} from "../src/ListRecordRenderer.sol";
import {CardData} from "../src/interfaces/IListRecordRenderer.sol";

/// @notice Locks the artifacts produced by tools/gen_template.py.
contract TemplateTest is Test {
    uint256 internal constant SLICES = 22;
    uint256 internal constant SLOTS = 21;
    uint256 internal constant BLOB_LEN = 2_264;
    uint256 internal constant RAW_SVG_LEN = 1_179;
    uint256 internal constant ENCODED_SVG_LEN = 1_477;

    string internal constant EXACT_OFFSETS =
        "0,19,19,810,829,128,957,101,1058,278,1336,27,1363,126,1489,28,1517,12,1529,83,1612,269,1881,39,1920,39,1959,35,1994,32,2026,35,2061,38,2099,42,2141,38,2179,36,2215,45,2260,4";

    bytes internal blob;
    uint256[] internal offs;

    function setUp() public {
        blob = vm.parseBytes(vm.readFile("template/blob.hex"));
        string[] memory parts = vm.split(vm.readFile("template/offsets.txt"), ",");
        for (uint256 i; i < parts.length; ++i) {
            offs.push(vm.parseUint(parts[i]));
        }
    }

    function test_exactArtifactLengthsAndHashes() public view {
        bytes memory blobFile = bytes(vm.readFile("template/blob.hex"));
        bytes memory offsetFile = bytes(vm.readFile("template/offsets.txt"));

        assertEq(blob.length, BLOB_LEN, "raw blob length");
        assertEq(keccak256(blob), 0x084304a65f55159ceff6e9d9a7d17683ca506b5d842cc94eb1014356f37bc5ef, "blob hash");
        assertEq(blobFile.length, 4_530, "blob.hex length");
        assertEq(
            keccak256(blobFile), 0xe05d01c268ec5d0e0586f4963d0f84ebfcc5a5f9f55403887e1b87bcd1c4a577, "blob.hex hash"
        );
        assertEq(offsetFile.length, 173, "offset file length");
        assertEq(
            keccak256(offsetFile),
            0x70aa181f917fd631b8caa549648608779466f7aa4d29743b0db3251e97a27b6b,
            "offset file hash"
        );
        assertEq(string(offsetFile), EXACT_OFFSETS, "exact offsets");
    }

    function test_rawAndPercentEncodedSvgLengthsAreExact() public view {
        bytes memory source = bytes(vm.readFile("template/card.svg"));
        if (source.length != 0 && source[source.length - 1] == 0x0a) {
            assembly {
                mstore(source, sub(mload(source), 1))
            }
        }
        assertEq(source.length, RAW_SVG_LEN, "raw SVG length");
        for (uint256 i; i < source.length; ++i) {
            assertTrue(source[i] != 0x0a && source[i] != 0x0d, "SVG contains a newline");
        }
        assertEq(_pctEncode(source).length, ENCODED_SVG_LEN, "percent-encoded SVG length");
    }

    function test_twentyOneSlotsProduceTwentyTwoSlicesAndFortyFourOffsets() public view {
        assertEq(offs.length, SLICES * 2, "offset count");
        assertEq(SLICES, SLOTS + 1, "slice relation");
    }

    function test_slicesTileBlobWithNoGapOrOverlap() public view {
        uint256 cursor;
        for (uint256 i; i < SLICES; ++i) {
            assertEq(offs[i * 2], cursor, "noncontiguous slice");
            cursor += offs[i * 2 + 1];
        }
        assertEq(cursor, blob.length, "incomplete blob coverage");
    }

    function test_blobIsASCIIAndImageFieldIsURIAndJsonSafe() public view {
        string memory s = string(blob);
        uint256 start = vm.indexOf(s, "data:image/svg+xml,");
        uint256 end = vm.indexOf(s, '","attributes":[');
        assertLt(start, end, "image field missing");

        for (uint256 i; i < blob.length; ++i) {
            assertLt(uint8(blob[i]), 0x80, "non-ASCII template byte");
            if (i < start || i >= end) continue;
            assertTrue(blob[i] != "#" && blob[i] != '"' && blob[i] != " ", "unsafe image byte");
        }
    }

    function test_resplicingTwentyOneValuesReproducesSyntheticHeldGolden() public view {
        bytes[SLOTS] memory v = _syntheticHeldValues();
        bytes memory out;
        for (uint256 i; i < SLICES; ++i) {
            out = abi.encodePacked(out, _slice(i));
            if (i < SLOTS) out = abi.encodePacked(out, v[i]);
        }
        assertEq(string(out), vm.readFile("test/fixtures/golden_synthetic_held_preimage.txt"));
    }

    function _slice(uint256 i) internal view returns (bytes memory s) {
        uint256 start = offs[i * 2];
        uint256 len = offs[i * 2 + 1];
        s = new bytes(len);
        for (uint256 j; j < len; ++j) {
            s[j] = blob[start + j];
        }
    }

    function _syntheticHeldValues() internal pure returns (bytes[SLOTS] memory v) {
        v[0] = "7";
        v[1] = "7";
        v[2] = "0x0000000000000000000000000000000000000921";
        v[3] = "921";
        v[4] = "0.6900";
        v[5] = "0.8497";
        v[6] = "7";
        v[7] = "0";
        v[8] = "grace";
        v[9] = "held%20by%20claimant";
        v[10] = "921";
        v[11] = "0.8497";
        v[12] = "0.6900";
        v[13] = "7";
        v[14] = "hour 0";
        v[15] = "grace";
        v[16] = "47";
        v[17] = "41";
        v[18] = "7";
        v[19] = "0x0000000000000000000000000000000000000921";
        v[20] = "yes";
    }

    function _pctEncode(bytes memory raw) internal pure returns (bytes memory out) {
        out = new bytes(raw.length * 3);
        bytes memory hexChars = "0123456789ABCDEF";
        uint256 o;
        for (uint256 i; i < raw.length; ++i) {
            uint8 b = uint8(raw[i]);
            if (_encoded(b)) {
                out[o++] = "%";
                out[o++] = hexChars[b >> 4];
                out[o++] = hexChars[b & 0x0f];
            } else {
                out[o++] = raw[i];
            }
        }
        assembly {
            mstore(out, o)
        }
    }

    function _encoded(uint8 b) internal pure returns (bool) {
        return b == 0x25 || b == 0x23 || b == 0x22 || b == 0x26 || b == 0x20 || b == 0x3c || b == 0x3e || b == 0x3f
            || b >= 0x80;
    }
}

contract LanguageGate is Test {
    using stdJson for string;

    string internal constant DESCRIPTION =
        "A permanent onchain record of what the claimant wallet did in THE LIST. Objective participation facts are read directly from WhitelistCurator.sol; eligibility is bound to the published filter commitment. Ownership may transfer while Claimant remains historical provenance. Marketplaces cache metadata and may temporarily show an older ownership-derived value.";

    ListRecordRenderer internal renderer;

    function setUp() public {
        bytes memory blob = vm.parseBytes(vm.readFile("template/blob.hex"));
        string[] memory parts = vm.split(vm.readFile("template/offsets.txt"), ",");
        uint16[44] memory offs;
        for (uint256 i; i < parts.length; ++i) {
            offs[i] = uint16(vm.parseUint(parts[i]));
        }
        renderer = new ListRecordRenderer(blob, offs);
    }

    function test_exactDescriptionAndLength() public view {
        string memory description = _preimage().readString(".description");
        assertEq(bytes(description).length, 359, "description length");
        assertEq(description, DESCRIPTION, "description");
    }

    function test_decodedJsonAndSvgContainNoForbiddenLanguage() public view {
        bytes memory json = _lower(bytes(_preimage()));
        string memory image = _preimage().readString(".image");
        bytes memory svg = _lower(_pctDecode(bytes(vm.replace(image, "data:image/svg+xml,", ""))));
        string[19] memory words = _forbidden();

        for (uint256 i; i < words.length; ++i) {
            bytes memory word = bytes(words[i]);
            assertFalse(_contains(json, word), string.concat("json: ", words[i]));
            assertFalse(_contains(svg, word), string.concat("svg: ", words[i]));
        }
    }

    function test_runtimeEnumsCannotSmuggleForbiddenLanguage() public pure {
        string[7] memory closed = ["grace", "judged", "hour ", "held by claimant", "held by another", "yes", "no"];
        string[19] memory words = _forbidden();
        for (uint256 i; i < closed.length; ++i) {
            for (uint256 j; j < words.length; ++j) {
                assertFalse(_contains(_lower(bytes(closed[i])), bytes(words[j])), closed[i]);
            }
        }
    }

    function _preimage() internal view returns (string memory) {
        CardData memory d = CardData({
            id: 7,
            claimant: 0x0000000000000000000000000000000000000921,
            owner: 0x0000000000000000000000000000000000000921,
            points: 921,
            weightWei: 0.8497 ether,
            creditWei: 0.69 ether,
            deposits: 7,
            hour: 0,
            joinIndex: 47,
            claimedAtHour: 41,
            grace: true
        });
        return string(renderer.preimage(d));
    }

    function _forbidden() internal pure returns (string[19] memory w) {
        w = [
            "clean",
            "review",
            "flagged",
            "cluster",
            "component",
            "linkage",
            "representative",
            "confidence",
            "analysis",
            "solo",
            "independent",
            "farmer",
            "sybil",
            "human",
            "tier",
            "cohort",
            "rank",
            "rarity",
            "reputation"
        ];
    }

    function _lower(bytes memory input) internal pure returns (bytes memory out) {
        out = new bytes(input.length);
        for (uint256 i; i < input.length; ++i) {
            uint8 c = uint8(input[i]);
            out[i] = bytes1(c >= 0x41 && c <= 0x5a ? c + 32 : c);
        }
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) return false;
        for (uint256 i; i + needle.length <= haystack.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
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
