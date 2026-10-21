// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Tables {
    function at(bytes memory data, bytes memory offsets, uint256 index) internal pure returns (string memory) {
        uint256 a = offset(offsets, index);
        uint256 z = offset(offsets, index + 1);
        return slice(data, a, z - a);
    }

    function offset(bytes memory t, uint256 index) internal pure returns (uint256 n) {
        assembly {
            let p := add(add(t, 32), mul(index, 4))
            for { let i := 0 } lt(i, 4) { i := add(i, 1) } {
                let c := byte(0, mload(add(p, i)))
                let d := sub(c, 48)
                if gt(c, 57) { d := sub(c, 87) }
                n := add(mul(n, 16), d)
            }
        }
    }

    function slice(bytes memory data, uint256 start, uint256 len) internal pure returns (string memory s) {
        require(start <= data.length && len <= data.length - start, "table");
        s = new string(len);
        assembly {
            let src := add(add(data, 32), start)
            let dst := add(s, 32)
            for { let i := 0 } lt(i, len) { i := add(i, 32) } { mstore(add(dst, i), mload(add(src, i))) }
        }
    }
}
