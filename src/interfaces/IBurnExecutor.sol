// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice IMD BurnExecutor V2: quotes its whole IMD balance and bridges to the Base burn receiver.
interface IBurnExecutor {
    function tokenBalance() external view returns (uint256);

    function previewBridge() external view returns (uint256 amountToSend, uint256 minAmountToReceive, uint256 nativeFee);

    /// @dev The executor force-refunds surplus native value to refundTo, even if it rejects ETH calls.
    function bridgeToBaseBurnReceiver(uint256 requested, address refundTo) external payable;
}
