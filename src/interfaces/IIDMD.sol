// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The two ERC-721 views the registry reads from the IdentityMD collection.
interface IIDMD {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
}
