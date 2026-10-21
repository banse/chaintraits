// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISworn {
    function hasTrait(address wallet, uint16 traitId)
        external view returns (bool);
    function tokenOf(address wallet)
        external view returns (uint256);
}

contract SwornGate {
    ISworn public constant SWORN =
        ISworn(0xDD0017e40F1A5Fe514D15D108CE01EB52F2a5edb);

    function canEnter(address wallet) external view returns (bool) {
        return SWORN.hasTrait(wallet, 701);
    }

    function cardOfWallet(address wallet) external view returns (uint256) {
        return SWORN.tokenOf(wallet);
    }
}
