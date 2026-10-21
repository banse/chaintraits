// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Spec} from "./Types.sol";

interface IComposer {
    function compose(uint16 id, Spec calldata s, address claimant, address consumer, address curator)
        external
        view
        returns (bytes memory, bytes32);
    function catalogSpec(uint16 id, address curator) external pure returns (Spec memory);
    function validateSpec(Spec calldata s, uint256 blockNumber) external view;
    function directSnapshot(address wallet, address curator) external view returns (uint32);
    function traitsOf(address registry, address wallet) external view returns (uint16[] memory);
    function mainnetHeightBound() external view returns (uint256);
}

interface IRenderer {
    function tokenURIOf(address registry, uint256 tokenId) external view returns (string memory);
    function traitName(uint16 id) external pure returns (string memory);
}

interface IRegistryView {
    function claimantOf(uint256 tokenId) external view returns (address);
    function tokenOf(address wallet) external view returns (uint256);
    function hasTrait(address wallet, uint16 id) external view returns (bool);
    function traitsOf(address wallet) external view returns (uint16[] memory);
    function verifiedSpecsOf(address wallet) external view returns (uint16[] memory);
    function specOf(uint16 id) external view returns (Spec memory);
    function verified(address wallet, uint16 id) external view returns (bytes32, bytes32, uint64, uint64);
}
