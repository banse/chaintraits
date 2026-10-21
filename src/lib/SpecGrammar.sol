// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Spec} from "../interfaces/Types.sol";

library SpecGrammar {
    error BadSpec(string field);

    function identifier(bytes memory b) internal pure returns (bool) {
        if (b.length == 0 || b.length > 32 || !initial(b[0])) return false;
        for (uint256 i = 1; i < b.length; ++i) {
            if (!initial(b[i]) && (b[i] < "0" || b[i] > "9")) return false;
        }
        return true;
    }

    function initial(bytes1 c) private pure returns (bool) {
        return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c == "_";
    }

    function slice(bytes memory b, uint256 a, uint256 z) private pure returns (bytes memory r) {
        if (z > b.length || z < a) revert BadSpec("item");
        r = new bytes(z - a);
        for (uint256 i; i < r.length; ++i) {
            r[i] = b[a + i];
        }
    }

    function eq(bytes memory a, string memory b) private pure returns (bool) {
        return keccak256(a) == keccak256(bytes(b));
    }

    function typeOK(bytes memory t) private pure returns (bool) {
        uint256 n = t.length;
        if (n >= 2 && t[n - 2] == "[" && t[n - 1] == "]") t = slice(t, 0, n - 2);
        if (eq(t, "address") || eq(t, "bool") || eq(t, "string") || eq(t, "bytes")) return true;
        uint256 start;
        bool fixedBytes;
        if (t.length >= 5 && eq(slice(t, 0, 5), "bytes")) {
            start = 5;
            fixedBytes = true;
        } else if (t.length >= 4 && eq(slice(t, 0, 4), "uint")) {
            start = 4;
        } else if (t.length >= 3 && eq(slice(t, 0, 3), "int")) {
            start = 3;
        } else {
            return false;
        }
        if (t.length <= start || t[start] == "0") return false;
        uint256 value;
        for (uint256 i = start; i < t.length; ++i) {
            if (t[i] < "0" || t[i] > "9") return false;
            value = value * 10 + uint8(t[i]) - 48;
            if (value > 256) return false;
        }
        return fixedBytes ? value >= 1 && value <= 32 : value >= 8 && value <= 256 && value % 8 == 0;
    }

    struct Fields {
        bool arg;
        bool fixedArg;
        bool sumArg;
        uint256 topic;
        uint256 indexedCount;
    }

    function eventFields(Spec memory s) internal pure returns (uint256 topic) {
        bytes memory b = bytes(s.item);
        uint256 n = b.length;
        if (n < 9 || n > 256 || !eq(slice(b, 0, 6), "event ") || b[n - 1] != ")") revert BadSpec("item");
        uint256 p = 6;
        while (p < n && b[p] != "(") ++p;
        if (!identifier(slice(b, 6, p)) || p >= n - 1) revert BadSpec("item");
        ++p;
        Fields memory f;
        while (p < n - 1) {
            uint256 z = p;
            while (z < n && b[z] != " ") ++z;
            bytes memory typ = slice(b, p, z);
            if (!typeOK(typ)) revert BadSpec("item");
            p = z + 1;
            bool indexed_;
            if (p + 8 <= n && eq(slice(b, p, p + 8), "indexed ")) {
                indexed_ = true;
                p += 8;
                if (++f.indexedCount > 3) revert BadSpec("item");
            }
            z = p;
            while (z < n && b[z] != "," && b[z] != ")") ++z;
            bytes memory name = slice(b, p, z);
            if (!identifier(name)) revert BadSpec("item");
            if (eq(name, s.arg) && indexed_ && eq(typ, "address")) {
                f.arg = true;
                f.topic = f.indexedCount;
            }
            if (eq(name, s.fixedArg) && indexed_) f.fixedArg = true;
            if (eq(name, s.sumArg)) f.sumArg = true;
            if (z == n - 1 && b[z] == ")") {
                p = n - 1;
                break;
            }
            if (z + 2 >= n - 1 || b[z] != "," || b[z + 1] != " ") revert BadSpec("item");
            p = z + 2;
        }
        if (!f.arg) revert BadSpec("arg");
        if (bytes(s.fixedArg).length != 0 && !f.fixedArg) revert BadSpec("fixedArg");
        if ((s.kind == 2 || s.kind == 3) && !f.sumArg) revert BadSpec("sumArg");
        return f.topic;
    }

    function validate(Spec memory s, uint256 h) internal pure {
        if (s.kind < 1 || s.kind > 5) revert BadSpec("kind");
        if ((s.kind == 5) != (s.target == address(0))) revert BadSpec("target");
        bytes memory name = bytes(s.name);
        if (name.length == 0 || name.length > 32) revert BadSpec("name");
        for (uint256 i; i < name.length; ++i) {
            bytes1 c = name[i];
            if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == " " || c == "."
                        || c == "-")) revert BadSpec("name");
        }
        if (s.threshold == 0 || (s.kind == 3 && s.threshold > 32)) revert BadSpec("threshold");
        if (s.fromBlock > s.toBlock) revert BadSpec("window");
        if (s.kind == 5) {
            if (s.fromBlock != s.toBlock || uint256(s.toBlock) + 7200 > h) revert BadSpec("window");
        } else if (uint256(s.toBlock) - s.fromBlock + 1 < 7200 || h < 64 || s.toBlock > h - 64) {
            revert BadSpec("window");
        }
        if (s.kind <= 3) {
            if (!identifier(bytes(s.arg))) revert BadSpec("arg");
            if (bytes(s.fixedArg).length > 0 && !identifier(bytes(s.fixedArg))) revert BadSpec("fixedArg");
            if (bytes(s.sumArg).length > 0 && !identifier(bytes(s.sumArg))) revert BadSpec("sumArg");
            eventFields(s);
        } else {
            if (bytes(s.arg).length != 0) revert BadSpec("arg");
            if (s.kind == 4) {
                bytes memory b = bytes(s.item);
                if (b.length < 42 || b.length > 73 || !eq(slice(b, 0, 9), "function ")) revert BadSpec("item");
                uint256 p = 9;
                while (p < b.length && b[p] != "(") ++p;
                if (!identifier(slice(b, 9, p)) || !eq(slice(b, p, b.length), "(address) view returns (uint256)")) {
                    revert BadSpec("item");
                }
            } else if (bytes(s.item).length != 0) {
                revert BadSpec("item");
            }
        }
        if ((s.kind != 1 && s.kind != 2) && bytes(s.fixedArg).length != 0) revert BadSpec("fixedArg");
        if (bytes(s.fixedArg).length == 0 && s.fixedVal != 0) revert BadSpec("fixedVal");
        if (s.kind != 2 && s.kind != 3 && bytes(s.sumArg).length != 0) revert BadSpec("sumArg");
        if (s.kind == 4 ? (s.op < 1 || s.op > 5) : s.op != 0) revert BadSpec("op");
    }
}
