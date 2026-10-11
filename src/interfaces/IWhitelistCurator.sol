// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Read-only view of the deployed game, `WhitelistCurator` at
///         0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91 on Ethereum mainnet.
///
/// @dev    Only the ten views this collection needs. Deliberately absent:
///         `contributors(address)` (selector 0x1f6d4942), the raw struct getter. Its fourth
///         word is `firstHour + 1`, where 0 means "never deposited" — read naively, every
///         non-member renders as an hour-0 founder, the rarest cohort in the game.
///
///         That getter IS present in the vendored ABI (all 32 functions are), so its absence
///         here is discipline, not an accident of what was available. The thing that keeps
///         the discipline is Task 2's test that a non-member does not read as hour 0, not
///         this comment.
///
///         `deposit()`, `settle()` and `rescue()` are state-changing and are not declared
///         here: this repository never writes to the game.
interface IWhitelistCurator {
    /// @notice Hour index of an address's first deposit. `hasJoined == false` means the
    ///         address never deposited, and `hour` is then a meaningless 0.
    function firstHourOf(address account) external view returns (uint256 hour, bool hasJoined);

    /// @notice Points under the current curve: isqrt(weight) * POINTS_PER_ETH / 1e9.
    function pointsOf(address account) external view returns (uint256);

    /// @notice Sum of (credited delta x early-bird multiplier), in wei-equivalents.
    function weightOf(address account) external view returns (uint256);

    /// @notice The LARGEST SINGLE SEND in wei (`highWater`), uncapped. Not a lifetime sum
    ///         and not the credited amount, which is capped at creditCap. Do not confuse it
    ///         with the `credit_wei` figure in the maxpane sweep, which is the capped one.
    function contributedBy(address account) external view returns (uint256);

    /// @notice Maximum lifetime principal credited by the game, in wei.
    function creditCap() external view returns (uint256);

    /// @notice Recorded deposits by this address.
    function txCountOf(address account) external view returns (uint256);

    /// @notice True once any completed, judged hour came up short. Monotonic: never false
    ///         again, and once true every per-address view above is frozen for ever.
    function isSettled() external view returns (bool);

    /// @notice Current hour index, counted from launch.
    function currentHour() external view returns (uint256);

    /// @notice Length of the grace period in seconds (86400 on this deployment).
    function gracePeriod() external view returns (uint256);

    /// @notice Length of one hour bucket in seconds (3600 on this deployment).
    function hourDuration() external view returns (uint256);
}
