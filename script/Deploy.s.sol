// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Script} from "forge-std/Script.sol";
import {Renderer} from "../src/Renderer.sol";
import {Composer} from "../src/Composer.sol";
import {Registry} from "../src/Registry.sol";

/// @notice Local deployment rehearsal; publishing and deployment belong to the launch service.
/// No environment, private key, broadcaster, or caller-dependent configuration is used.
contract Deploy is Script {
    function run() external returns (Renderer, Composer, Registry) {
        return deployForChain();
    }

    function deployForChain() public returns (Renderer r, Composer c, Registry registry) {
        bool sepolia = block.chainid == 11155111;
        r = new Renderer();
        c = new Composer();
        registry = new Registry(
            sepolia ? 0x0919ba50b206C3F31D516De818b1fBc7dA21653D : 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91,
            sepolia ? 0x56bcf2a5F47710649A4091219Ef0b56e2d1B58BF : 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7,
            0xa43e6F75ee006411F79Ac1C84120606C2330DE82,
            0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982,
            address(r),
            address(c),
            sepolia ? 0x097A19e0f021BBA5072701132625ad2401043A2E : 0xe29386719C155B6847aD5a4E97C6674f10ffc750
        );
    }
}
