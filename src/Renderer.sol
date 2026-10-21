// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64Fast} from "./Base64Fast.sol";
import {IRegistryView} from "./Types.sol";
import {Catalog} from "./Catalog.sol";
import {Text} from "./Text.sol";
import {HiveData} from "./HiveData.sol";

/// @notice A rendering is not a credential. This view renders whatever registry the caller supplies.
/// Verify facts with hasTrait on the authentic Registry, and use the original claimant, never ownerOf.
contract Renderer {
    using Strings for uint256;
    using Text for Text.Buffer;
    error NoCard(uint256 tokenId);
    error UnknownTrait(uint16 traitId);
    error BadRegistry();

    function traitName(uint16 id) external pure returns (string memory) {
        return Catalog.name(id);
    }

    struct DisplaySpec {
        uint8 kind;
        address target;
        string name;
    }

    struct State {
        address claimant;
        uint16[] traits;
        uint16[] community;
        uint16[13] top;
        uint256 count;
        DisplaySpec[] specs;
    }

    function tokenURIOf(address registry, uint256 tokenId) external view returns (string memory) {
        State memory s;
        IRegistryView r = IRegistryView(registry);
        s.claimant = r.claimantOf(tokenId);
        if (s.claimant == address(0)) revert NoCard(tokenId);
        s.traits = r.traitsOf(s.claimant);
        if (s.traits.length > 25) {
            uint16[] memory ids = s.traits;
            assembly ("memory-safe") { mstore(ids, 25) }
        }
        s.community = r.verifiedSpecsOf(s.claimant);
        s.count = s.community.length;
        if (s.community.length > 32) {
            uint16[] memory ids = s.community;
            assembly ("memory-safe") { mstore(ids, 32) }
        }
        s.specs = new DisplaySpec[](s.community.length);
        for (uint256 i; i < s.community.length; ++i) {
            s.specs[i] = _displaySpec(registry, s.community[i]);
        }
        s.top = _tops(s.traits);
        HiveData.Table memory table = HiveData.load();
        Text.Buffer memory b = Text.buffer(70000);
        b.add(HiveData.envelope(0));
        b.add(tokenId.toString());
        b.add(HiveData.envelope(1));
        b.add(_percent(_svg(table, s.top, s.count)));
        b.add(HiveData.envelope(2));
        b.add(_attributes(s));
        b.add(HiveData.envelope(3));
        b.add(_ids(s.traits));
        b.add(HiveData.envelope(4));
        b.add(_ids(s.community));
        b.add(HiveData.envelope(5));
        bool added;
        for (uint256 i; i < s.traits.length + s.community.length; ++i) {
            uint16 id = i < s.traits.length ? s.traits[i] : s.community[i - s.traits.length];
            if (id < 10001 && !Catalog.oracle(id)) continue;
            DisplaySpec memory info = i < s.traits.length ? _displaySpec(registry, id) : s.specs[i - s.traits.length];
            string memory entry = _oracle(registry, s.claimant, id, info);
            if (bytes(entry).length != 0) {
                if (added) b.add(",");
                b.add(entry);
                added = true;
            }
        }
        b.add(HiveData.envelope(6));
        return string.concat("data:application/json;base64,", Base64Fast.encode(bytes(b.finish())));
    }

    function _tops(uint16[] memory ids) private pure returns (uint16[13] memory top) {
        for (uint256 i; i < ids.length; ++i) {
            uint16 id = ids[i];
            uint256 f = id / 100;
            if (f < 1 || f > 13) continue;
            if (top[f - 1] == 0 || (f == 11 ? id < top[f - 1] : id > top[f - 1])) top[f - 1] = id;
        }
    }

    function _ids(uint16[] memory ids) private pure returns (string memory) {
        Text.Buffer memory b = Text.buffer(256);
        b.add("[");
        for (uint256 i; i < ids.length; ++i) {
            if (i > 0) b.add(",");
            b.add(uint256(ids[i]).toString());
        }
        b.add("]");
        return b.finish();
    }

    function _attributes(State memory s) private pure returns (string memory) {
        Text.Buffer memory b = Text.buffer(1024 + s.community.length * 256);
        b.add(string.concat('[{"trait_type":"Claimant","value":"', Text.hexFixed(uint160(s.claimant), 20), '"}'));
        for (uint256 f = 1; f <= 13; ++f) {
            b.add(
                string.concat(
                    ',{"trait_type":"',
                    Catalog.family(f),
                    '","value":"',
                    s.top[f - 1] == 0 ? "none" : uint256(s.top[f - 1]).toString(),
                    '"}'
                )
            );
        }
        b.add(string.concat(',{"trait_type":"community_count","value":', s.count.toString(), "}"));
        for (uint256 i; i < s.community.length; ++i) {
            string memory name = s.specs[i].name;
            b.add(
                string.concat(
                    ',{"trait_type":"Community ', uint256(s.community[i]).toString(), '","value":"', name, '"}'
                )
            );
        }
        b.add("]");
        return b.finish();
    }

    function _oracle(address registry, address wallet, uint16 id, DisplaySpec memory info)
        private
        view
        returns (string memory)
    {
        (bytes32 rid, bytes32 oid, uint64 from, uint64 to) = IRegistryView(registry).verified(wallet, id);
        if (rid == 0) return "";
        uint8 kind = info.kind;
        bool panel = kind == 3 || kind >= 5;
        Text.Buffer memory b = Text.buffer(512 + bytes(info.name).length);
        b.add(
            string.concat(
                '{"traitId":',
                uint256(id).toString(),
                ',"template":"T',
                uint256(kind).toString(),
                '","evidence":"',
                kind >= 5 ? "panel" : "chain",
                '","fromBlock":',
                uint256(from).toString(),
                ',"toBlock":',
                uint256(to).toString()
            )
        );
        b.add(
            string.concat(
                ',"minPanelSize":',
                panel ? "11" : "5",
                ',"minQuorum":',
                panel ? "7" : "3",
                ',"requestId":"',
                Text.hexFixed(uint256(rid), 32),
                '","oracleRequestId":"',
                Text.hexFixed(uint256(oid), 32),
                '","target":"',
                Text.hexFixed(uint160(info.target), 20),
                '","name":"',
                info.name,
                '"}'
            )
        );
        return b.finish();
    }

    function _displaySpec(address registry, uint16 id) private view returns (DisplaySpec memory info) {
        (info.kind, info.target, info.name) = _spec(registry, id);
        info.name = Text.escape(info.name);
    }

    /// @dev Limit returndata BEFORE copying; read only the static fields and name used in metadata.
    function _spec(address registry, uint16 id) private view returns (uint8 kind, address target, string memory name) {
        bytes memory input = abi.encodeCall(IRegistryView.specOf, (id));
        bool ok;
        uint256 size;
        assembly ("memory-safe") {
            ok := staticcall(300000, registry, add(input, 32), mload(input), 0, 0)
            size := returndatasize()
        }
        if (!ok || size < 416 || size > 8192) revert BadRegistry();
        bytes memory result = new bytes(size);
        assembly ("memory-safe") { returndatacopy(add(result, 32), 0, size) }
        uint256 base = _read(result, 0);
        if (base > size - 384 || base % 32 != 0) revert BadRegistry();
        uint256 k = _read(result, base);
        uint256 t = _read(result, base + 32);
        if (k > 255 || t > type(uint160).max) revert BadRegistry();
        kind = uint8(k);
        target = address(uint160(t));
        uint256 relative = _read(result, base + 352);
        if (relative < 384 || relative > size - base - 32) revert BadRegistry();
        uint256 pos = base + relative;
        uint256 len = _read(result, pos);
        if (len > 512 || len > size - pos - 32) revert BadRegistry();
        Text.Buffer memory b = Text.buffer(len);
        Text.slice(b, result, pos + 32, len);
        name = b.finish();
    }

    function _read(bytes memory b, uint256 p) private pure returns (uint256 v) {
        if (p > b.length || b.length - p < 32) revert BadRegistry();
        assembly ("memory-safe") { v := mload(add(add(b, 32), p)) }
    }

    function _rare(uint16 id) private pure returns (bool) {
        return id == 202 || id == 801 || id == 901 || id == 1001 || (id >= 1101 && id <= 1104) || id == 1201;
    }

    function _tiers(uint256 f) private pure returns (uint256) {
        return f == 2 ? 2 : f == 3 || f == 5 ? 3 : f == 4 ? 4 : 1;
    }

    function _color(uint256 f) private pure returns (string memory) {
        return f <= 5 ? "#00cc33" : f == 6 || f == 13 ? "#8ff0a4" : f == 12 ? "#dbfee6" : "#00ff41";
    }

    function _rings(uint256 count, uint256 slot) private pure returns (uint256 k) {
        for (uint256 d; d < 3; ++d) {
            if (13 * d + slot < count) ++k;
        }
    }

    function communityStep(uint256 count) public pure returns (uint256) {
        if (count < 40) return 0;
        if (count >= 8192) return 64;
        uint256 v = count ** 8;
        uint256 bits;
        while (v > 0) {
            ++bits;
            v >>= 1;
        }
        return bits - 41;
    }

    function _svg(HiveData.Table memory table, uint16[13] memory top, uint256 count)
        private
        pure
        returns (string memory)
    {
        Text.Buffer memory b = Text.buffer(24000);
        b.add(HiveData.get(table, 0));
        uint8[13] memory order = [uint8(6), 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13];
        for (uint256 slot; slot < 13; ++slot) {
            _cell(b, table, order[slot], slot, top[order[slot] - 1], _rings(count, slot));
        }
        b.add(
            string.concat(
                '<polygon points="', HiveData.get(table, 32), '" fill="none" stroke="#0c0c0c" stroke-width="3"/>'
            )
        );
        uint256 step = communityStep(count);
        if (step > 0) {
            b.add(
                string.concat(
                    '<path d="',
                    HiveData.get(table, 33 + step),
                    '" fill="none" stroke="#05751f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
                )
            );
        }
        b.add("</svg>");
        return b.finish();
    }

    function _cell(Text.Buffer memory b, HiveData.Table memory table, uint256 f, uint256 slot, uint16 top, uint256 k)
        private
        pure
    {
        uint256 n = _tiers(f);
        uint256 lv = top == 0 ? 0 : f == 11 ? 1 : top % 100;
        if (lv > n) lv = n;
        bool partFilled = lv > 0 && lv < n;
        string memory color = _color(f);
        b.add(
            string.concat(
                '<g transform="translate(',
                HiveData.get(table, 7 + slot),
                ')"><polygon points="',
                HiveData.get(table, 2),
                '" fill="none" stroke="',
                lv > 0 ? color : "#151515",
                '" stroke-width="4" stroke-linejoin="round"/>'
            )
        );
        if (partFilled) _clips(b, table, f, n, lv);
        if (lv > 0) {
            if (partFilled) b.add(string.concat('<g clip-path="url(#h', f.toString(), ')">'));
            for (uint256 zone; zone <= k; ++zone) {
                b.add(
                    string.concat(
                        '<polygon points="',
                        HiveData.get(table, 3 + zone),
                        '" fill="',
                        color,
                        '" fill-opacity="',
                        _opacity(k, zone),
                        '"/>'
                    )
                );
            }
            if (partFilled) b.add("</g>");
        }
        if (lv == 0 || partFilled) {
            if (partFilled) b.add(string.concat('<g clip-path="url(#a', f.toString(), ')">'));
            for (uint256 ring; ring < k; ++ring) {
                b.add(
                    string.concat(
                        '<polygon points="',
                        HiveData.get(table, 4 + ring),
                        '" fill="none" stroke="#05751f" stroke-width="',
                        partFilled ? "2" : "3",
                        '"/>'
                    )
                );
            }
            if (partFilled) b.add("</g>");
        }
        if (_rare(top)) b.add('<circle cx="0" cy="0" r="11.0" fill="#ffffff"/>');
        b.add("</g>");
    }

    function _clips(Text.Buffer memory b, HiveData.Table memory table, uint256 f, uint256 n, uint256 lv) private pure {
        uint256 ix = 20 + (n == 2 ? 0 : n == 3 ? 2 : 6) + 2 * (lv - 1);
        b.add(
            string.concat(
                '<defs><clipPath id="h',
                f.toString(),
                '"><polygon points="',
                HiveData.get(table, ix),
                '"/></clipPath><clipPath id="a',
                f.toString(),
                '"><polygon points="',
                HiveData.get(table, ix + 1),
                '"/></clipPath></defs>'
            )
        );
    }

    function _opacity(uint256 k, uint256 zone) private pure returns (string memory) {
        if (zone == k) return "1.00";
        if (zone == 0) return "0.35";
        if (k == 2) return "0.68";
        return zone == 1 ? "0.57" : "0.78";
    }

    function _percent(string memory text) private pure returns (string memory) {
        bytes memory lookup = bytes(
            "000000000000000000000000000000001011011000000000000000000000101100000000000000000000000000000000000000000000000000000000000000001111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
        );
        bytes memory src = bytes(text);
        bytes memory out = new bytes(src.length * 3);
        bytes memory hexs = "0123456789ABCDEF";
        uint256 len;
        assembly ("memory-safe") {
            let dst := add(out, 32)
            let ptr := dst
            let chars := mload(add(hexs, 32))
            for { let i := 0 } lt(i, mload(src)) { i := add(i, 1) } {
                let c := byte(0, mload(add(add(src, 32), i)))
                switch eq(byte(0, mload(add(add(lookup, 32), c))), 49)
                case 1 {
                    mstore8(ptr, 37)
                    mstore8(add(ptr, 1), byte(shr(4, c), chars))
                    mstore8(add(ptr, 2), byte(and(c, 15), chars))
                    ptr := add(ptr, 3)
                }
                default {
                    mstore8(ptr, c)
                    ptr := add(ptr, 1)
                }
            }
            len := sub(ptr, dst)
            mstore(out, len)
        }
        return string(out);
    }
}
