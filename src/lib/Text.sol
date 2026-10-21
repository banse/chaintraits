// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

library Text {
    bytes16 internal constant HEX = "0123456789abcdef";

    function dec(uint256 n) internal pure returns (string memory) {
        return Strings.toString(n);
    }

    function addr(address a) internal pure returns (string memory) {
        return fixedHex(uint160(a), 20);
    }

    function word(bytes32 a) internal pure returns (string memory) {
        return fixedHex(uint256(a), 32);
    }

    function fixedHex(uint256 value, uint256 width) private pure returns (string memory out) {
        out = new string(width * 2 + 2);
        assembly {
            let p := add(out, 32)
            mstore8(p, 48)
            mstore8(add(p, 1), 120)
            let end := add(p, 2)
            p := add(end, mul(width, 2))
            let hexchars := "0123456789abcdef"
            for {} gt(p, end) {} {
                p := sub(p, 1)
                mstore8(p, byte(and(value, 15), hexchars))
                value := shr(4, value)
            }
        }
    }

    function hexnum(uint256 n) internal pure returns (string memory) {
        uint256 len = 1;
        uint256 v = n;
        while (v > 15) {
            v >>= 4;
            ++len;
        }
        bytes memory b = new bytes(len + 2);
        b[0] = "0";
        b[1] = "x";
        for (uint256 i = len + 1; i > 1; --i) {
            b[i] = HEX[n & 15];
            n >>= 4;
        }
        return string(b);
    }

    function quote(string memory s, bool safe) internal pure returns (string memory out) {
        bytes memory b = new bytes(bytes(s).length * 6 + 2);
        assembly {
            let dst := add(b, 32)
            mstore8(dst, 34)
            dst := add(dst, 1)
            let src := add(s, 32)
            let end := add(src, mload(s))
            let hexchars := "0123456789abcdef"
            for {} lt(src, end) { src := add(src, 1) } {
                let c := byte(0, mload(src))
                switch or(eq(c, 34), eq(c, 92))
                case 1 {
                    mstore8(dst, 92)
                    mstore8(add(dst, 1), c)
                    dst := add(dst, 2)
                }
                default {
                    switch or(lt(c, 32), and(safe, or(or(eq(c, 60), eq(c, 62)), or(eq(c, 38), eq(c, 39)))))
                    case 1 {
                        mstore(dst, shl(208, 0x5c7530300000))
                        mstore8(add(dst, 4), byte(shr(4, c), hexchars))
                        mstore8(add(dst, 5), byte(and(c, 15), hexchars))
                        dst := add(dst, 6)
                    }
                    default {
                        mstore8(dst, c)
                        dst := add(dst, 1)
                    }
                }
            }
            mstore8(dst, 34)
            mstore(b, sub(add(dst, 1), add(b, 32)))
        }
        return string(b);
    }
}
