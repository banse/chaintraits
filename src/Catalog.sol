// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Spec} from "./Types.sol";

library Catalog {
    string internal constant DEPOSITED =
        "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)";
    address internal constant MAINNET_CURATOR = 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91;
    error UnknownTrait(uint16);
    error NotACatalogOracleTrait(uint16);

    function direct(uint16 id) internal pure returns (bool) {
        return id == 101 || (id >= 201 && id <= 202) || (id >= 301 && id <= 303) || (id >= 401 && id <= 404)
            || (id >= 501 && id <= 503);
    }

    function oracle(uint16 id) internal pure returns (bool) {
        return id == 601 || id == 701 || id == 801 || id == 901 || id == 1001 || (id >= 1101 && id <= 1105)
            || id == 1201 || id == 1301;
    }

    function ids() internal pure returns (uint16[25] memory) {
        return [
            uint16(101),
            201,
            202,
            301,
            302,
            303,
            401,
            402,
            403,
            404,
            501,
            502,
            503,
            601,
            701,
            801,
            901,
            1001,
            1101,
            1102,
            1103,
            1104,
            1105,
            1201,
            1301
        ];
    }

    function family(uint256 f) internal pure returns (string memory) {
        if (f == 1) return "Spawned";
        if (f == 2) return "Zero-Shot";
        if (f == 3) return "Hopper";
        if (f == 4) return "Bullfrog";
        if (f == 5) return "Benchmarked";
        if (f == 6) return "Swarmed";
        if (f == 7) return "Uptime";
        if (f == 8) return "Holdout";
        if (f == 9) return "Final Token";
        if (f == 10) return "Hotfix";
        if (f == 11) return "PID";
        if (f == 12) return "Top Weights";
        return "Pretrained";
    }

    function name(uint16 id) internal pure returns (string memory) {
        if (id == 201) return "Zero-Shot, hour <= 1";
        if (id == 202) return "Zero-Shot, hour 0";
        if (id == 301) return "Hopper >= 3";
        if (id == 302) return "Hopper >= 5";
        if (id == 303) return "Hopper >= 10";
        if (id == 401) return "Bullfrog >= 1 ETH";
        if (id == 402) return "Bullfrog >= 10 ETH";
        if (id == 403) return "Bullfrog >= 100 ETH";
        if (id == 404) return "Bullfrog >= 800 ETH";
        if (id == 501) return "Benchmarked >= 1000";
        if (id == 502) return "Benchmarked >= 3162";
        if (id == 503) return "Benchmarked >= 10000";
        if (oracle(id)) return oracleName(id);
        if (!direct(id)) revert UnknownTrait(id);
        return family(id / 100);
    }

    function oracleName(uint16 id) internal pure returns (string memory) {
        if (id == 1101) return "PID #1";
        if (id == 1102) return "PID #1000";
        if (id == 1103) return "PID #10000";
        if (id == 1104) return "PID #19522";
        if (id == 1105) return "First thousand";
        if (id == 601) return "Swarmed";
        if (id == 701) return "Uptime";
        if (id == 801) return "Holdout";
        if (id == 901) return "Final Token";
        if (id == 1001) return "Hotfix";
        if (id == 1201) return "Top Weights";
        return "Pretrained";
    }

    function spec(uint16 id, address curator) internal pure returns (Spec memory s) {
        if (!oracle(id)) revert NotACatalogOracleTrait(id);
        s.name = oracleName(id);
        s.target = curator;
        s.kind = 1;
        s.item = DEPOSITED;
        s.arg = "contributor";
        s.threshold = 1;
        s.fromBlock = 25769870;
        s.toBlock = 25789604;
        if (id == 601) {
            s.kind = 6;
            s.target = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
            s.item = "";
            s.arg = "";
            s.fromBlock = 25090085;
            s.toBlock = 0;
            s.threshold = 3;
        } else if (id == 701) {
            s.fromBlock = 25777045;
        } else if (id == 801 || id == 901) {
            s.fixedArg = "hour";
            s.fixedVal = id == 801 ? 64 : 65;
        } else if (id == 1001) {
            s.item = "event HourSaved(address indexed savior, uint256 indexed hour, uint256 hourTotal)";
            s.arg = "savior";
        } else if (id >= 1101 && id <= 1105) {
            s.item = "event FirstDeposit(address indexed contributor, uint256 indexed index, uint256 timestamp)";
            if (id == 1105) {
                s.toBlock = 25770897;
            } else {
                s.fixedArg = "index";
                s.fixedVal = id == 1101 ? 1 : id == 1102 ? 1000 : id == 1103 ? 10000 : 19522;
            }
        } else if (id == 1201) {
            s.kind = 3;
            s.sumArg = "weightAdded";
            s.threshold = 32;
        } else if (id == 1301) {
            s.kind = 5;
            s.target = address(0);
            s.item = "";
            s.arg = "";
            s.toBlock = s.fromBlock;
            s.threshold = 20;
        }
    }
}
