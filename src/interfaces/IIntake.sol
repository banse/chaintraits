// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The IMD Intake (version 2) as the registry calls it. Copied from `reference/IntakeV2.sol`:
///         only the functions a payer needs. `requestWithFailure` is version 2 only.
interface IIntake {
    struct Callback {
        address target;
        bytes4 selector;
    }

    function priceOf(bytes32 action, address asset) external view returns (uint256);
    function callbackGas() external view returns (uint64);
    function failureSelectorOf(bytes32 requestId) external view returns (bytes4);

    function request(bytes32 action, bytes calldata body, Callback calldata callback, address asset, uint256 amount)
        external
        payable
        returns (bytes32 requestId);

    function requestWithFailure(
        bytes32 action,
        bytes calldata body,
        Callback calldata callback,
        bytes4 onFailure,
        address asset,
        uint256 amount
    ) external payable returns (bytes32 requestId);
}
