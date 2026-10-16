// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBurnExecutor} from "../../src/interfaces/IBurnExecutor.sol";
import {Registry} from "../../src/Registry.sol";

/// @dev Created and destroyed in the same transaction, so even a rejecting recipient gets its ETH.
contract ForceBurnRefund {
    constructor(address to) payable {
        selfdestruct(payable(to));
    }
}

/// @notice Configurable executor with observable forwarding, bounded-gas failures and forced surplus refunds.
contract MockBurnExecutor is IBurnExecutor {
    uint256 public amount = 69 ether;
    uint256 public fee = 0.001 ether;
    // 0 success, 1 preview revert, 2 bridge revert, 3 preview OOG, 4 bridge OOG,
    // 5 large preview revert data, 6 large bridge revert data.
    uint8 public mode;
    uint256 public calls;
    uint256 public lastRequested;
    uint256 public lastValue;
    uint256 public lastGas;
    address public lastCaller;
    address public lastRefundTo;
    Registry public observedRegistry;
    address public observedClaimant;
    uint16 public observedTrait;
    bytes public reentry;
    bytes public reentryError;
    bool public reentrySucceeded;
    bool public checkPreviewGas;

    function configure(uint256 amount_, uint256 fee_, uint8 mode_) external {
        amount = amount_;
        fee = fee_;
        mode = mode_;
    }

    function observe(Registry registry_, address claimant_, uint16 trait_) external {
        observedRegistry = registry_;
        observedClaimant = claimant_;
        observedTrait = trait_;
    }

    function armReentry(bytes calldata payload) external {
        reentry = payload;
    }

    function requirePreviewGasCap() external {
        checkPreviewGas = true;
    }

    function tokenBalance() external view returns (uint256) {
        return amount;
    }

    function previewBridge() external view returns (uint256, uint256, uint256) {
        uint256 entryGas = gasleft();
        if (checkPreviewGas) require(entryGas <= 200_000 && entryGas > 195_000, "preview gas cap");
        if (mode == 1) revert("preview unavailable");
        if (mode == 3) {
            assembly ("memory-safe") {
                invalid()
            }
        }
        if (mode == 5) _largeRevert();
        if (address(observedRegistry) != address(0)) {
            require(observedRegistry.pendingOf(observedClaimant, observedTrait) != 0, "oracle request first");
            require(observedRegistry.poolUsed(observedClaimant, observedTrait), "pool effects first");
        }
        return (amount, amount, fee);
    }

    function bridgeToBaseBurnReceiver(uint256 requested, address refundTo) external payable {
        uint256 entryGas = gasleft();
        if (mode == 2) revert("bridge unavailable");
        if (mode == 4) {
            assembly ("memory-safe") {
                invalid()
            }
        }
        if (mode == 6) _largeRevert();
        require(msg.value >= fee, "fee");
        ++calls;
        lastGas = entryGas;
        lastRequested = requested;
        lastValue = msg.value;
        lastCaller = msg.sender;
        lastRefundTo = refundTo;
        if (reentry.length != 0) {
            (reentrySucceeded, reentryError) = msg.sender.call(reentry);
        }
        if (msg.value > fee) new ForceBurnRefund{value: msg.value - fee}(refundTo);
    }

    function _largeRevert() internal pure {
        bytes memory data = new bytes(32_768);
        assembly ("memory-safe") {
            revert(add(data, 32), mload(data))
        }
    }
}

/// @notice A contract claimant with no payable receiver or fallback; funds are provisioned by the tests.
contract NonpayableBurnClaimant {
    function claim(Registry registry, bool throughIdmd, uint16 traitId, uint256 value) external {
        if (throughIdmd) {
            uint16[] memory ids = new uint16[](1);
            ids[0] = traitId;
            registry.upgradeSponsored{value: value}(7, ids);
        } else {
            registry.claimSponsored{value: value}(traitId);
        }
    }
}

/// @notice A payable claimant that attempts a nested free claim when the registry refunds it.
contract ReentrantBurnClaimant is NonpayableBurnClaimant {
    Registry public target;
    bytes public reentryError;
    bool public reentrySucceeded;
    uint256 public refunds;

    function arm(Registry registry) external {
        target = registry;
    }

    receive() external payable {
        refunds++;
        (reentrySucceeded, reentryError) = address(target).call(abi.encodeCall(Registry.claimSponsored, (801)));
    }
}
