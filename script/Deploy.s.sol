// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Composer} from "../src/Composer.sol";

/// @notice Deploys the renderer, the composer (both without arguments) and the registry with the five
///         static mainnet addresses, the burn executor and two helpers: the same shape as the launch-pipeline
///         input (three contracts, static constructor arguments, the helpers referenced backward).
/// @dev    No environment variable is read and nothing depends on the broadcaster: `deploy()` is the
///         function the tests call directly.
contract Deploy is Script {
    address public constant CURATOR = 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91;
    address public constant IDMD = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
    address public constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address public constant INTAKE_V2 = 0xa43e6F75ee006411F79Ac1C84120606C2330DE82;
    address public constant ATTESTER = 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982;
    address public constant BURN_EXECUTOR = 0xe29386719C155B6847aD5a4E97C6674f10ffc750;

    function run() external returns (Registry registry) {
        vm.startBroadcast();
        registry =
            deploy(CURATOR, IDMD, IMD, INTAKE_V2, ATTESTER, block.chainid == 11155111 ? address(0) : BURN_EXECUTOR);
        vm.stopBroadcast();
    }

    function deploy(address curator, address idmd, address imd, address intake, address attester, address burnExecutor)
        public
        returns (Registry registry)
    {
        Renderer renderer = new Renderer();
        Composer composer = new Composer();
        registry =
            new Registry(curator, idmd, imd, intake, attester, address(renderer), address(composer), burnExecutor);
    }
}
