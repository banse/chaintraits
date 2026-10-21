// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract ContractClaimant {
    function mint(Registry r) external {
        IERC20(r.imd()).approve(address(r), r.MINT_FEE());
        r.mintCard();
    }
}

contract MintingReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        Registry r = Registry(msg.sender);
        IERC20(r.imd()).approve(address(r), r.MINT_FEE());
        r.mintCard();
        return this.onERC721Received.selector;
    }
}

contract TransfersTest is SwornTest {
    function test_contractMintNeedsNoERC721Receiver() public {
        ContractClaimant c = new ContractClaimant();
        token.mint(address(c), 0.1 ether);
        c.mint(registry);
        assertEq(registry.claimantOf(1), address(c));
        assertEq(registry.ownerOf(1), address(c));
    }

    function test_incomingSafeTransferDoesNotChangeRecipientsEligibility() public {
        vm.prank(alice);
        registry.mintCard();
        MintingReceiver receiver = new MintingReceiver();
        token.mint(address(receiver), 0.1 ether);
        vm.prank(alice);
        registry.safeTransferFrom(alice, address(receiver), 1);
        assertEq(registry.tokenOf(alice), 1);
        assertEq(registry.claimantOf(1), alice);
        assertEq(registry.tokenOf(address(receiver)), 2);
        assertEq(registry.claimantOf(2), address(receiver));
        assertEq(registry.balanceOf(address(receiver)), 2);
        assertEq(token.balanceOf(address(registry)), 0);
    }
}
