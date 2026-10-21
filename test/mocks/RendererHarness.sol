// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Renderer} from "../../src/Renderer.sol";
import {Card} from "../../src/Types.sol";

/// @notice Test-only: exposes the renderer's internal entry points (`tokenURI(Card)`, `preimage`, `image`,
///         `escapeJson`), which the production Renderer keeps internal for the launch size budget.
contract RendererHarness is Renderer {
    function tokenURIOfCard(Card memory c) external pure returns (string memory) {
        return tokenURI(c);
    }

    function preimageOf(Card memory c) external pure returns (bytes memory) {
        return preimage(c);
    }

    function imageOf(Card memory c) external pure returns (bytes memory) {
        return image(c);
    }

    function cardOfOn(address registry, uint256 tokenId) external view returns (Card memory) {
        return cardOf(registry, tokenId);
    }

    function escape(bytes memory s) external pure returns (bytes memory) {
        return escapeJson(s);
    }
}
