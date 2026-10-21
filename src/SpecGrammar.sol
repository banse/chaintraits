// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Spec} from "./Types.sol";

library SpecGrammar {
    error BadSpec(string field);

    struct Param {
        bytes32 name;
        uint8 category;
        uint8 topic;
    }

    function ident(bytes memory b, uint256 start, uint256 end) internal pure returns (bool) {
        if (end <= start || end - start > 32) return false;
        for (uint256 i = start; i < end; ++i) {
            uint8 c = uint8(b[i]);
            if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95 || (i > start && c >= 48 && c <= 57))) {
                return false;
            }
        }
        return true;
    }

    function part(bytes memory b, uint256 start, uint256 end) internal pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i; i < out.length; ++i) {
            out[i] = b[start + i];
        }
    }

    function equal(bytes memory b, uint256 start, string memory text) internal pure returns (bool) {
        bytes memory t = bytes(text);
        if (start > b.length || t.length > b.length - start) return false;
        for (uint256 i; i < t.length; ++i) {
            if (b[start + i] != t[i]) return false;
        }
        return true;
    }

    function category(bytes memory t) internal pure returns (uint8) {
        uint256 n = t.length;
        bool array = n >= 2 && t[n - 2] == "[" && t[n - 1] == "]";
        if (array) {
            n -= 2;
            assembly ("memory-safe") { mstore(t, n) }
        }
        bytes32 h = keccak256(t);
        uint8 c;
        if (h == keccak256("address")) {
            c = 1;
        } else if (h == keccak256("bool")) {
            c = 3;
        } else if (h == keccak256("string") || h == keccak256("bytes")) {
            c = 4;
        } else {
            uint256 p;
            uint256 limit;
            uint256 step;
            if (equal(t, 0, "uint")) {
                p = 4;
                limit = 256;
                step = 8;
                c = 2;
            } else if (equal(t, 0, "int")) {
                p = 3;
                limit = 256;
                step = 8;
                c = 3;
            } else if (equal(t, 0, "bytes")) {
                p = 5;
                limit = 32;
                step = 1;
                c = 3;
            } else {
                revert BadSpec("item");
            }
            if (p >= n || t[p] == "0") revert BadSpec("item");
            uint256 val;
            for (uint256 i = p; i < n; ++i) {
                uint8 x = uint8(t[i]);
                if (x < 48 || x > 57) revert BadSpec("item");
                val = val * 10 + x - 48;
                if (val > limit) revert BadSpec("item");
            }
            if (val == 0 || val > limit || val % step != 0) revert BadSpec("item");
        }
        return array ? 4 : c;
    }

    function parse(string memory item) internal pure returns (Param[32] memory ps, uint256 count) {
        bytes memory b = bytes(item);
        uint256 n = b.length;
        if (n > 256 || !equal(b, 0, "event ")) revert BadSpec("item");
        uint256 i = 6;
        uint256 start = i;
        while (i < n && b[i] != "(") ++i;
        if (i == n || !ident(b, start, i)) revert BadSpec("item");
        ++i;
        uint8 topic = 0;
        if (i < n && b[i] == ")") {
            if (i + 1 != n) revert BadSpec("item");
            return (ps, 0);
        }
        while (i < n) {
            start = i;
            while (i < n && b[i] != " ") ++i;
            if (i == n) revert BadSpec("item");
            uint8 cat = category(part(b, start, i));
            ++i;
            uint8 indexedTopic = 0;
            if (equal(b, i, "indexed ")) {
                i += 8;
                indexedTopic = ++topic;
                if (topic > 3) revert BadSpec("item");
            }
            start = i;
            while (i < n && b[i] != "," && b[i] != ")") ++i;
            if (i == n || !ident(b, start, i)) revert BadSpec("item");
            bytes32 name = keccak256(part(b, start, i));
            if (name == keccak256("indexed") || count == 32) revert BadSpec("item");
            for (uint256 j; j < count; ++j) {
                if (ps[j].name == name) revert BadSpec("item");
            }
            ps[count++] = Param(name, cat, indexedTopic);
            if (b[i] == ")") {
                if (i + 1 != n) revert BadSpec("item");
                return (ps, count);
            }
            if (!equal(b, i, ", ")) revert BadSpec("item");
            i += 2;
        }
        revert BadSpec("item");
    }

    function fields(Spec memory s) internal pure returns (uint8 topic) {
        if (s.kind <= 3) {
            (Param[32] memory ps, uint256 n) = parse(s.item);
            bool argOk = false;
            bool fixedOk = bytes(s.fixedArg).length == 0;
            bool sumOk = bytes(s.sumArg).length == 0;
            for (uint256 i; i < n; ++i) {
                Param memory p = ps[i];
                if (p.name == keccak256(bytes(s.arg)) && p.category == 1 && p.topic > 0) {
                    argOk = true;
                    topic = p.topic;
                }
                if (p.name == keccak256(bytes(s.fixedArg)) && p.topic > 0 && p.category < 4) fixedOk = true;
                if (p.name == keccak256(bytes(s.sumArg)) && p.category == 2) sumOk = true;
            }
            if (!argOk) revert BadSpec("arg");
            if (!fixedOk) revert BadSpec("fixedArg");
            if (!sumOk) revert BadSpec("sumArg");
        } else if (s.kind == 4) {
            bytes memory b = bytes(s.item);
            uint256 i = 9;
            if (b.length > 256 || !equal(b, 0, "function ")) revert BadSpec("item");
            while (i < b.length && b[i] != "(") ++i;
            if (!ident(b, 9, i) || !equal(b, i, "(address) view returns (uint256)") || i + 32 != b.length) {
                revert BadSpec("item");
            }
        } else if (bytes(s.item).length != 0) {
            revert BadSpec("item");
        }
    }

    function validate(Spec memory s, uint256 height) internal pure {
        if (s.kind < 1 || s.kind > 5) revert BadSpec("kind");
        if ((s.kind == 5) != (s.target == address(0))) revert BadSpec("target");
        if (s.threshold == 0 || (s.kind == 3 && s.threshold > 32)) revert BadSpec("threshold");
        if (s.kind == 4) {
            if (s.op < 1 || s.op > 5) revert BadSpec("op");
        } else if (s.op != 0) {
            revert BadSpec("op");
        }
        if (s.kind >= 4 && bytes(s.arg).length != 0) revert BadSpec("arg");
        if (s.kind != 2 && s.kind != 3 && bytes(s.sumArg).length != 0) revert BadSpec("sumArg");
        if ((s.kind == 2 || s.kind == 3) && bytes(s.sumArg).length == 0) revert BadSpec("sumArg");
        if (s.kind >= 3 && bytes(s.fixedArg).length != 0) revert BadSpec("fixedArg");
        if (bytes(s.fixedArg).length == 0 && s.fixedVal != 0) revert BadSpec("fixedVal");
        bytes memory name = bytes(s.name);
        if (name.length == 0 || name.length > 32) revert BadSpec("name");
        for (uint256 i; i < name.length; ++i) {
            uint8 c = uint8(name[i]);
            if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 32 || c == 46
                        || c == 45)) revert BadSpec("name");
        }
        if (s.fromBlock > s.toBlock) revert BadSpec("window");
        if (s.kind == 5) {
            if (s.fromBlock != s.toBlock || uint256(s.toBlock) + 7200 > height) revert BadSpec("window");
        } else if (uint256(s.toBlock) - s.fromBlock + 1 < 7200 || height < 64 || s.toBlock > height - 64) {
            revert BadSpec("window");
        }
        fields(s);
    }
}
