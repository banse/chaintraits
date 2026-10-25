// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISworn {
    function hasTrait(address wallet, uint16 id) external view returns (bool);
}

contract ExampleWalletGate {
    ISworn public constant REGISTRY =
        ISworn(0x0da2679000Ea5380d1361cc3Cca7D4e8c881F766);
    mapping(address => bool) public admitted;

    error WrongChain();
    error AlreadyAdmitted();
    error NotEligible();
    event AccessGranted(address indexed wallet);

    function claimAccess() external {
        if (block.chainid != 1) revert WrongChain();
        if (admitted[msg.sender]) revert AlreadyAdmitted();
        if (!REGISTRY.hasTrait(msg.sender, 101)
            || !REGISTRY.hasTrait(msg.sender, 701)) revert NotEligible();
        admitted[msg.sender] = true;
        emit AccessGranted(msg.sender);
    }
}
