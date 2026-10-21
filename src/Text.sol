// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Fixed-capacity, checked memory writer. Every copy stays inside allocated memory.
library Text {
    struct Buffer {
        bytes data;
        uint256 used;
    }
    error TextTooLong();

    function buffer(uint256 size) internal pure returns (Buffer memory b) {
        b.data = new bytes(size);
    }

    function add(Buffer memory b, string memory s) internal pure {
        addBytes(b, bytes(s));
    }

    function addBytes(Buffer memory b, bytes memory s) internal pure {
        slice(b, s, 0, s.length);
    }

    function slice(Buffer memory b, bytes memory s, uint256 start, uint256 len) internal pure {
        if (start > s.length || len > s.length - start || len > b.data.length - b.used) revert TextTooLong();
        bytes memory dst = b.data;
        uint256 pos = b.used;
        assembly ("memory-safe") {
            mcopy(add(add(dst, 32), pos), add(add(s, 32), start), len)
        }
        b.used = pos + len;
    }

    function finish(Buffer memory b) internal pure returns (string memory) {
        bytes memory d = b.data;
        uint256 n = b.used;
        assembly ("memory-safe") { mstore(d, n) }
        return string(d);
    }

    function expand(string memory pattern, string[16] memory args) internal pure returns (string memory) {
        bytes memory p = bytes(pattern);
        Buffer memory b = buffer(p.length + 4096);
        uint256 start = 0;
        for (uint256 i; i < p.length; ++i) {
            if (p[i] == "~") {
                slice(b, p, start, i - start);
                ++i;
                add(b, args[uint8(p[i]) - 65]);
                start = i + 1;
            }
        }
        slice(b, p, start, p.length - start);
        return finish(b);
    }

    function escape(string memory value) internal pure returns (string memory) {
        bytes memory p = bytes(value);
        bytes memory out = new bytes(p.length * 6);
        bytes memory digits = "0123456789abcdef";
        assembly ("memory-safe") {
            let dst := add(out, 32)
            let pos := dst
            let hexs := mload(add(digits, 32))
            for { let i := 0 } lt(i, mload(p)) { i := add(i, 1) } {
                let c := byte(0, mload(add(add(p, 32), i)))
                switch or(eq(c, 34), eq(c, 92))
                case 1 {
                    mstore8(pos, 92)
                    mstore8(add(pos, 1), c)
                    pos := add(pos, 2)
                }
                default {
                    switch or(lt(c, 32), or(or(eq(c, 60), eq(c, 62)), or(eq(c, 38), eq(c, 39))))
                    case 1 {
                        mstore8(pos, 92)
                        mstore8(add(pos, 1), 117)
                        mstore8(add(pos, 2), 48)
                        mstore8(add(pos, 3), 48)
                        mstore8(add(pos, 4), byte(shr(4, c), hexs))
                        mstore8(add(pos, 5), byte(and(c, 15), hexs))
                        pos := add(pos, 6)
                    }
                    default {
                        mstore8(pos, c)
                        pos := add(pos, 1)
                    }
                }
            }
            mstore(out, sub(pos, dst))
        }
        return string(out);
    }

    function hexFixed(uint256 value, uint256 width) internal pure returns (string memory) {
        bytes memory out = new bytes(2 + width * 2);
        bytes memory digits = "0123456789abcdef";
        assembly ("memory-safe") {
            let dst := add(out, 32)
            mstore8(dst, 48)
            mstore8(add(dst, 1), 120)
            let hexs := mload(add(digits, 32))
            for { let i := add(dst, mload(out)) } gt(i, add(dst, 2)) {} {
                i := sub(i, 1)
                mstore8(i, byte(and(value, 15), hexs))
                value := shr(4, value)
            }
        }
        if (value != 0) revert TextTooLong();
        return string(out);
    }

    // Minimal-width lowercase hex, unlike Strings.toHexString's whole-byte width.
    function hexNumber(uint256 n) internal pure returns (string memory) {
        uint256 len = 1;
        uint256 v = n;
        while (v >= 16) {
            v /= 16;
            ++len;
        }
        bytes memory s = new bytes(len + 2);
        s[0] = "0";
        s[1] = "x";
        bytes memory digits = "0123456789abcdef";
        while (len > 0) {
            s[len + 1] = digits[n % 16];
            n /= 16;
            --len;
        }
        return string(s);
    }
}
