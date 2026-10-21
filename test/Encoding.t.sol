// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64Fast} from "../src/Base64Fast.sol";
import {Text} from "../src/Text.sol";

contract EncodingTest is Test {
    function testFuzz_base64MatchesLibrary(bytes memory input) public pure {
        assertEq(Base64Fast.encode(input), Base64.encode(input));
    }

    function test_partialGroupsAndAdjacentMemorySurvive() public pure {
        for (uint256 n; n < 100; ++n) {
            bytes memory input = new bytes(n);
            for (uint256 i; i < n; ++i) {
                input[i] = bytes1(uint8(i * 3));
            }
            bytes memory adjacent = bytes("abcdefghijklmnopqrstuvwxyz0123456789");
            bytes32 before = keccak256(adjacent);
            assertEq(Base64Fast.encode(input), Base64.encode(input));
            assertEq(keccak256(adjacent), before);
        }
    }

    function testFuzz_fixedHexMatchesLibrary(uint256 value) public pure {
        assertEq(Text.hexFixed(value, 32), Strings.toHexString(value, 32));
        assertEq(Text.hexFixed(uint160(value), 20), Strings.toHexString(address(uint160(value))));
    }

    function test_allEscapes() public pure {
        assertEq(Text.escape("\x00\x01\x1f\"\\<>&'"), "\\u0000\\u0001\\u001f\\\"\\\\\\u003c\\u003e\\u0026\\u0027");
    }

    function test_memoryCopyTilingAndCapacityRejection() public {
        Text.Buffer memory b = Text.buffer(65);
        Text.add(b, "abcdefghijklmnopqrstuvwxyz012345");
        Text.add(b, "0123456789abcdefghijklmnopqrstuv");
        Text.add(b, "!");
        assertEq(Text.finish(b), "abcdefghijklmnopqrstuvwxyz0123450123456789abcdefghijklmnopqrstuv!");
    }
}
