// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Tables} from "./Tables.sol";

library Catalog {
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

    function direct(uint16 id) internal pure returns (bool) {
        uint16 f = id / 100;
        uint16 t = id % 100;
        return t != 0
            && ((f == 1 && t == 1)
                || (f == 2 && t <= 2)
                || (f == 3 && t <= 3)
                || (f == 4 && t <= 4)
                || (f == 5 && t <= 3));
    }

    function oracle(uint16 id) internal pure returns (bool) {
        return (id >= 601 && id <= 1301 && id % 100 == 1) || (id >= 1102 && id <= 1105);
    }
    bytes internal constant NAMES =
        "SpawnedZero-ShotHopperBullfrogBenchmarkedSwarmedUptimeHoldoutFinal TokenHotfixPIDTop WeightsPretrainedZero-Shot, hour <= 1Zero-Shot, hour 0Hopper >= 3Hopper >= 5Hopper >= 10Bullfrog >= 1 ETHBullfrog >= 10 ETHBullfrog >= 100 ETHBullfrog >= 800 ETHBenchmarked >= 1000Benchmarked >= 3162Benchmarked >= 10000PID #1PID #1000PID #10000PID #19522First thousand";
    bytes internal constant OFFSETS =
        "0000000700100016001e002900300036003d0048004e0051005c0066007a008b009600a100ad00be00d000e300f60109011c01300136013f014901530161";

    function family(uint256 f) internal pure returns (string memory) {
        return Tables.at(NAMES, OFFSETS, f - 1);
    }

    function name(uint16 id) internal pure returns (string memory) {
        uint256 f = id / 100;
        uint256 tier = id % 100;
        uint256 index = f - 1;
        if (f >= 2 && f <= 5) index = (f == 2 ? 13 : f == 3 ? 15 : f == 4 ? 18 : 22) + tier - 1;
        if (f == 11) index = 25 + tier - 1;
        return Tables.at(NAMES, OFFSETS, index);
    }

    function panel(uint8 kind) internal pure returns (uint16 p, uint16 q) {
        return kind == 3 || kind >= 5 ? (uint16(11), uint16(7)) : (uint16(5), uint16(3));
    }
}
