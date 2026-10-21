// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Read surface of the verified WhitelistCurator ABI under reference/abi/.
interface ICurator {
    function firstHourOf(address wallet) external view returns (uint256 hour, bool hasJoined);
    function txCountOf(address wallet) external view returns (uint256);
    function contributedBy(address wallet) external view returns (uint256);
    function pointsOf(address wallet) external view returns (uint256);
    function isSettled() external view returns (bool);
}
