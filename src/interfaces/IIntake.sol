// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Selectors and tuple shapes from reference/IntakeV2.sol. Sworn sends no native value.
interface IIntake {
    struct Callback {
        address target;
        bytes4 selector;
    }
    function priceOf(bytes32 action, address asset) external view returns (uint256);
    function requestWithFailure(
        bytes32 action,
        bytes calldata body,
        Callback calldata callback,
        bytes4 onFailure,
        address asset,
        uint256 amount
    ) external returns (bytes32);
    function callbackGas() external view returns (uint64);
    function complete(bytes32 requestId, uint8 status, bytes32 resultHash, string calldata uri, bytes calldata args)
        external;
}
