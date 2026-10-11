// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The only four value formats the card and the metadata use.
/// @dev    Numbers carry NO thousands separators.  `Points`, `Weight (ETH)`,
///         `Credit (ETH)` and `Deposits` are JSON *number* traits, and a JSON
///         number may not contain a comma - so a grouped card would have to
///         disagree with its own trait list, or the contract would have to
///         format every number twice.  Plain digits let each number be
///         formatted once and spliced into both places.
library Str {
    /// @notice Unsigned integer to decimal ASCII.
    function u(uint256 v) internal pure returns (bytes memory) {
        if (v == 0) return "0";
        uint256 n;
        for (uint256 t = v; t != 0; t /= 10) {
            n++;
        }
        bytes memory b = new bytes(n);
        while (v != 0) {
            b[--n] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return b;
    }

    /// @notice wei -> "902.1073": four decimals, truncated, never rounded.
    /// @dev    Truncation is deliberate: rounding a value UP across a boundary
    ///         would print a number the chain never held.
    function eth4(uint256 weiAmount) internal pure returns (bytes memory) {
        uint256 whole = weiAmount / 1e18;
        uint256 frac = (weiAmount % 1e18) / 1e14; // 18 - 4 decimals
        bytes memory f = u(frac);
        bytes memory pad = new bytes(4 - f.length);
        for (uint256 i; i < pad.length; ++i) {
            pad[i] = "0";
        }
        return abi.encodePacked(u(whole), ".", pad, f);
    }

    /// @notice Full lowercase 42-character address, reused by the card and Claimant trait.
    function hexAddr(address a) internal pure returns (bytes memory) {
        bytes memory b = new bytes(42);
        b[0] = "0";
        b[1] = "x";
        uint160 v = uint160(a);
        for (uint256 i = 41; i > 1; --i) {
            uint8 d = uint8(v & 0xf);
            b[i] = bytes1(d < 10 ? 48 + d : 87 + d);
            v >>= 4;
        }
        return b;
    }
}
