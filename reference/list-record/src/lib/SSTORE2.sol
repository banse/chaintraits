// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Store a byte blob as contract code and read slices of it back.
/// @dev    Contract code is ~200 gas/byte to write once and 3 gas/word to copy,
///         which is why the generated card template lives here and not in
///         storage.  The blob is deployed behind a leading STOP (0x00) byte so
///         that a call to the pointer halts instead of executing the template.
library SSTORE2 {
    error DeployFailed();

    /// @dev Runtime of the deployer: PUSH2 <len> then the standard "copy my own
    ///      tail into memory and return it" stub, then STOP, then the payload.
    ///      `len` counts the STOP byte, hence `data.length + 1`.
    function write(bytes memory data) internal returns (address ptr) {
        bytes memory code = abi.encodePacked(hex"61", uint16(data.length + 1), hex"80600a3d393df300", data);
        assembly {
            ptr := create(0, add(code, 0x20), mload(code))
        }
        if (ptr == address(0)) revert DeployFailed();
    }

    /// @notice Copy `len` bytes of the payload starting at payload offset
    ///         `start` into `out` at byte offset `off`.
    /// @dev    `+ 1` skips the STOP byte.  extcodecopy zero-fills past the end
    ///         rather than reverting, so the caller owns the bounds.
    function readInto(address ptr, uint256 start, uint256 len, bytes memory out, uint256 off) internal view {
        assembly {
            extcodecopy(ptr, add(add(out, 0x20), off), add(start, 1), len)
        }
    }

    /// @notice Payload length, excluding the STOP byte.
    function size(address ptr) internal view returns (uint256 s) {
        assembly {
            s := sub(extcodesize(ptr), 1)
        }
    }
}
