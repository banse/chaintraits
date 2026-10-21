// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Spec} from "../../src/Types.sol";
import {Catalog} from "../../src/Catalog.sol";

/// @dev Synthetic read adapter also demonstrates the site's unminted-wallet preview mechanism.
contract RenderRegistry {
    uint16[] internal _traits;
    uint256 internal _count;
    bool internal _hostile;
    uint8 internal _bad;

    function configure(uint16[] memory ids, uint256 count, bool hostile, uint8 bad) external {
        _traits = ids;
        _count = count;
        _hostile = hostile;
        _bad = bad;
    }

    function claimantOf(uint256) external pure returns (address) {
        return address(0xc1a1);
    }

    function tokenOf(address) external pure returns (uint256) {
        return 0;
    }

    function traitsOf(address) external view returns (uint16[] memory) {
        return _traits;
    }

    function verifiedSpecsOf(address) external view returns (uint16[] memory ids) {
        ids = new uint16[](_count);
        for (uint256 i; i < _count; ++i) {
            ids[i] = uint16(10001 + i);
        }
    }

    function specOf(uint16 id) external view returns (Spec memory s) {
        if (_bad == 1) {
            bytes memory b = new bytes(416);
            assembly ("memory-safe") {
                mstore(add(b, 32), not(0))
                return(add(b, 32), 416)
            }
        }
        if (_bad == 2) {
            bytes memory b = new bytes(416);
            assembly ("memory-safe") {
                mstore(add(b, 32), 32)
                mstore(add(b, 416), not(0))
                return(add(b, 32), 416)
            }
        }
        if (_bad == 3) {
            bytes memory b = new bytes(1048576);
            assembly ("memory-safe") { return(add(b, 32), 1048576) }
        }
        if (id < 10001) {
            s = Catalog.spec(id, Catalog.MAINNET_CURATOR);
            if (id == 601) s.toBlock = 26237654;
            return s;
        }
        s.kind = 1;
        s.target = address(0xc1a2);
        s.name = _hostile ? "A'\"\\<>&\x01A'\"\\<>&\x01A'\"\\<>&\x01A'\"\\<>&\x01" : "Community";
        s.item = new string(256);
        s.fromBlock = _hostile ? type(uint64).max - 7199 : 25769870;
        s.toBlock = _hostile ? type(uint64).max : 25789604;
    }

    function verified(address, uint16 id) external view returns (bytes32, bytes32, uint64, uint64) {
        if (id < 10001 && !Catalog.oracle(id)) return (0, 0, 0, 0);
        uint64 from;
        uint64 to;
        if (id < 10001) {
            Spec memory s = Catalog.spec(id, Catalog.MAINNET_CURATOR);
            from = s.fromBlock;
            to = id == 601 ? 26237654 : s.toBlock;
        } else {
            from = _hostile ? type(uint64).max - 7199 : 25769870;
            to = _hostile ? type(uint64).max : 25789604;
        }
        return (bytes32(uint256(id)), bytes32(uint256(id) + 100000), from, to);
    }
}
