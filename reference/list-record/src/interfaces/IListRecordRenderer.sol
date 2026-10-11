// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Everything the renderer needs to draw one card. `ListRecord` fills it in and
///         passes it by value; the renderer NEVER calls back into `ListRecord`, so the two
///         have no circular constructor dependency and the renderer is deployed first.
///
/// @dev    Declared at file level rather than inside the interface so that consumers can
///         `import {IListRecordRenderer, CardData} from "..."` and use `CardData` unqualified.
///
///         `grace` is `hour < graceHours`, computed by ListRecord from the game's own
///         gracePeriod/hourDuration rather than from a hardcoded 24.
struct CardData {
    uint256 id;
    address claimant;
    address owner;
    uint256 points;
    uint256 weightWei;
    uint256 creditWei;
    uint256 deposits;
    uint256 hour;
    uint32 joinIndex;
    uint32 claimedAtHour;
    bool grace;
}

interface IListRecordRenderer {
    function tokenURI(CardData calldata d) external view returns (string memory);
}
