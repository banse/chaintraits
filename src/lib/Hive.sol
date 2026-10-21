// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Buffer} from "./Buffer.sol";
import {Text} from "./Text.sol";
import {Tables} from "./Tables.sol";
import {HiveTables} from "./HiveTables.sol";

library Hive {
    using Buffer for Buffer.B;

    struct Geometry {
        bytes data;
        bytes offsets;
    }

    function point(Geometry memory g, uint256 i) private pure returns (string memory) {
        return Tables.at(g.data, g.offsets, i);
    }

    function rings(uint256 count, uint256 slot) internal pure returns (uint256 k) {
        if (count > 39) count = 39;
        for (uint256 d; d < 3; ++d) {
            if (13 * d + slot < count) ++k;
        }
    }

    function steps(uint256 count) internal pure returns (uint256) {
        if (count < 40) return 0;
        if (count >= 8192) return 64;
        uint256 n = count ** 8;
        uint256 bits;
        while (n != 0) {
            ++bits;
            n >>= 1;
        }
        return bits - 41;
    }

    function rare(uint16 id) internal pure returns (bool) {
        return id == 202 || id == 801 || id == 901 || id == 1001 || (id >= 1101 && id <= 1104) || id == 1201;
    }

    function color(uint256 f) private pure returns (string memory) {
        return f <= 5 ? "#00cc33" : f == 6 || f == 13 ? "#8ff0a4" : f == 12 ? "#dbfee6" : "#00ff41";
    }

    function tiers(uint256 f) private pure returns (uint256) {
        return f == 2 ? 2 : f == 3 || f == 5 ? 3 : f == 4 ? 4 : 1;
    }

    function draw(uint16[13] memory tops, uint256 count) internal pure returns (string memory) {
        Buffer.B memory b = Buffer.alloc(24000);
        Geometry memory g = Geometry(HiveTables.POINTS, HiveTables.POINTS_OFFSETS);
        b.add(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace"><rect width="1000" height="1000" fill="#0a0a0a"/>'
        );
        b.add(string.concat('<polygon points="', point(g, 30), '" fill="none" stroke="#0c0c0c" stroke-width="3"/>'));
        uint8[13] memory order = [uint8(6), 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13];
        for (uint256 slot; slot < 13; ++slot) {
            _cell(b, g, slot, order[slot], tops[order[slot] - 1], rings(count, slot));
        }
        uint256 step = steps(count);
        if (step != 0) {
            b.add(string.concat('<path d="M', point(g, 31)));
            uint256 full = step * 6 / 64;
            for (uint256 i = 1; i <= full; ++i) {
                b.add(string.concat(" L", point(g, 31 + i)));
            }
            if (step * 6 % 64 != 0) b.add(string.concat(" L", point(g, 38 + step)));
            b.add('" fill="none" stroke="#05751f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>');
        }
        b.add("</svg>");
        return b.finish();
    }

    function _cell(Buffer.B memory b, Geometry memory g, uint256 slot, uint256 f, uint16 top, uint256 k) private pure {
        uint256 n = tiers(f);
        uint256 lv = top == 0 ? 0 : f == 11 ? 1 : top % 100;
        if (lv > n) lv = n;
        string memory c = color(f);
        b.add(string.concat('<g transform="translate(', point(g, 5 + slot), ')"><polygon points="', point(g, 0)));
        b.add(
            string.concat(
                '" fill="none" stroke="', lv == 0 ? "#151515" : c, '" stroke-width="4" stroke-linejoin="round"/>'
            )
        );
        bool part = lv > 0 && lv < n;
        string memory sid = Text.dec(slot);
        if (part) {
            uint256 ix = 18 + (n == 2 ? 0 : n == 3 ? 2 : 6) + 2 * (lv - 1);
            b.add(string.concat('<defs><clipPath id="h', sid, '"><polygon points="', point(g, ix), '"/></clipPath>'));
            b.add(
                string.concat('<clipPath id="a', sid, '"><polygon points="', point(g, ix + 1), '"/></clipPath></defs>')
            );
        }
        if (lv != 0) {
            if (part) b.add(string.concat('<g clip-path="url(#h', sid, ')">'));
            for (uint256 z; z <= k; ++z) {
                b.add(
                    string.concat(
                        '<polygon points="', point(g, z + 1), '" fill="', c, '" fill-opacity="', _opacity(k, z), '"/>'
                    )
                );
            }
            if (part) b.add("</g>");
        }
        if (lv == 0 || part) {
            if (part) b.add(string.concat('<g clip-path="url(#a', sid, ')">'));
            for (uint256 z; z < k; ++z) {
                b.add(
                    string.concat(
                        '<polygon points="',
                        point(g, z + 2),
                        '" fill="none" stroke="#05751f" stroke-width="',
                        part ? "2" : "3",
                        '"/>'
                    )
                );
            }
            if (part) b.add("</g>");
        }
        if (rare(top)) b.add('<circle cx="0.0" cy="0.0" r="11.0" fill="#ffffff"/>');
        b.add("</g>");
    }

    function _opacity(uint256 k, uint256 z) private pure returns (string memory) {
        if (z == k) return "1.00";
        if (z == 0) return "0.35";
        if (k == 2) return "0.68";
        return z == 1 ? "0.57" : "0.78";
    }
}
