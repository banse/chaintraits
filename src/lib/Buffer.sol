// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Buffer {
    struct B {
        bytes data;
        uint256 length;
    }

    function alloc(uint256 capacity) internal pure returns (B memory b) {
        b.data = new bytes(capacity + 32);
        bytes memory data = b.data;
        assembly { mstore(data, capacity) }
    }

    function add(B memory b, string memory value) internal pure {
        bytes memory v = bytes(value);
        uint256 n = v.length;
        uint256 p = b.length;
        require(p + n <= b.data.length, "buffer");
        bytes memory dst = b.data;
        assembly {
            for { let i := 0 } lt(i, n) { i := add(i, 32) } {
                mstore(add(add(dst, 32), add(p, i)), mload(add(add(v, 32), i)))
            }
        }
        b.length = p + n;
    }

    function finish(B memory b) internal pure returns (string memory) {
        bytes memory d = b.data;
        uint256 n = b.length;
        assembly { mstore(d, n) }
        return string(d);
    }
}
