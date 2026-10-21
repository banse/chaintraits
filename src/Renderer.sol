// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Spec} from "./interfaces/Types.sol";
import {IRegistryView} from "./interfaces/ISworn.sol";
import {Buffer} from "./lib/Buffer.sol";
import {Text} from "./lib/Text.sol";
import {Catalog} from "./lib/Catalog.sol";
import {Hive} from "./lib/Hive.sol";
import {HiveTables} from "./lib/HiveTables.sol";
import {Tables} from "./lib/Tables.sol";

/// @notice Renders the supplied registry. A rendering is not a credential: read hasTrait on the canonical Registry.
contract Renderer {
    using Buffer for Buffer.B;
    error NoCard(uint256 tokenId);
    error UnknownTrait(uint16 traitId);
    error BadRegistry();

    struct Card {
        address claimant;
        uint16[] ids;
        uint16[] community;
        uint16[13] tops;
    }

    function traitName(uint16 id) external pure returns (string memory) {
        if (!Catalog.direct(id) && !Catalog.oracle(id)) revert UnknownTrait(id);
        return Catalog.name(id);
    }

    function tokenURIOf(address registry, uint256 tokenId) external view returns (string memory) {
        Card memory card;
        card.claimant = IRegistryView(registry).claimantOf(tokenId);
        if (card.claimant == address(0)) revert NoCard(tokenId);
        card.ids = _traits(registry, card.claimant);
        card.community = IRegistryView(registry).verifiedSpecsOf(card.claimant);
        for (uint256 i; i < card.ids.length; ++i) {
            uint16 id = card.ids[i];
            uint16 f = id / 100;
            if (f < 1 || f > 13) continue;
            uint16 prev = card.tops[f - 1];
            if (f == 11 ? (prev == 0 || id < prev) : id > prev) card.tops[f - 1] = id;
        }
        Buffer.B memory b = Buffer.alloc(120000);
        b.add(HiveTables.envelope(0));
        b.add(Text.quote(string.concat(HiveTables.envelope(1), Text.dec(tokenId)), true));
        b.add(HiveTables.envelope(2));
        b.add('"data:image/svg+xml,');
        b.add(_percent(Hive.draw(card.tops, card.community.length)));
        b.add('"');
        _attributes(b, registry, card);
        b.add(HiveTables.envelope(4));
        _ids(b, card.ids, 25);
        b.add(HiveTables.envelope(5));
        _ids(b, card.community, 32);
        b.add(HiveTables.envelope(6));
        _oracle(b, registry, card);
        b.add(HiveTables.envelope(7));
        return string.concat("data:application/json;base64,", Base64.encode(bytes(b.finish())));
    }

    function _traits(address registry, address claimant) private view returns (uint16[] memory ids) {
        bytes memory input = abi.encodeCall(IRegistryView.traitsOf, (claimant));
        bool ok;
        uint256 size;
        uint256 offset;
        uint256 n;
        assembly {
            ok := staticcall(1000000, registry, add(input, 32), mload(input), 0, 0)
            size := returndatasize()
        }
        if (!ok || size < 64) revert BadRegistry();
        assembly {
            returndatacopy(0, 0, 32)
            offset := mload(0)
        }
        if (offset < 32 || offset > size - 32) revert BadRegistry();
        assembly {
            returndatacopy(0, offset, 32)
            n := mload(0)
        }
        if (n > (size - offset - 32) / 32) revert BadRegistry();
        if (n > 25) n = 25;
        ids = new uint16[](n);
        assembly { returndatacopy(add(ids, 32), add(offset, 32), mul(n, 32)) }
        for (uint256 i; i < n; ++i) {
            uint256 value;
            assembly { value := mload(add(add(ids, 32), mul(i, 32))) }
            if (value > 65535) revert BadRegistry();
        }
    }

    function _attributes(Buffer.B memory b, address registry, Card memory c) private view {
        b.add(HiveTables.envelope(3));
        b.add(string.concat('[{"trait_type":"Claimant","value":"', Text.addr(c.claimant), '"}'));
        for (uint256 f = 1; f <= 13; ++f) {
            b.add(
                string.concat(
                    ',{"trait_type":"',
                    Catalog.family(f),
                    '","value":"',
                    c.tops[f - 1] == 0 ? "none" : Text.dec(c.tops[f - 1]),
                    '"}'
                )
            );
        }
        b.add(string.concat(',{"trait_type":"community_count","value":', Text.dec(c.community.length), "}"));
        uint256 n = c.community.length < 32 ? c.community.length : 32;
        for (uint256 i; i < n; ++i) {
            (,, string memory name) = _spec(registry, c.community[i]);
            b.add(
                string.concat(
                    ',{"trait_type":"Community ', Text.dec(c.community[i]), '","value":', Text.quote(name, true), "}"
                )
            );
        }
        b.add("]");
    }

    function _ids(Buffer.B memory b, uint16[] memory ids, uint256 cap) private pure {
        b.add("[");
        uint256 n = ids.length < cap ? ids.length : cap;
        for (uint256 i; i < n; ++i) {
            if (i != 0) b.add(",");
            b.add(Text.dec(ids[i]));
        }
        b.add("]");
    }

    function _oracle(Buffer.B memory b, address registry, Card memory c) private view {
        b.add("[");
        bool comma;
        for (uint256 i; i < c.ids.length; ++i) {
            if (!Catalog.oracle(c.ids[i])) continue;
            if (_record(b, registry, c.claimant, c.ids[i], comma)) comma = true;
        }
        uint256 n = c.community.length < 32 ? c.community.length : 32;
        for (uint256 i; i < n; ++i) {
            if (_record(b, registry, c.claimant, c.community[i], comma)) comma = true;
        }
        b.add("]");
    }

    struct Record {
        bytes32 rid;
        bytes32 oid;
        uint64 from;
        uint64 to;
        uint8 kind;
        address target;
        string name;
    }

    function _record(Buffer.B memory b, address registry, address claimant, uint16 id, bool comma)
        private
        view
        returns (bool)
    {
        Record memory r;
        (r.rid, r.oid, r.from, r.to) = IRegistryView(registry).verified(claimant, id);
        if (r.rid == bytes32(0)) return false;
        (r.kind, r.target, r.name) = _spec(registry, id);
        if (r.kind < 1 || r.kind > 6) revert BadRegistry();
        if (comma) b.add(",");
        b.add(
            string.concat(
                '{"traitId":',
                Text.dec(id),
                ',"template":"T',
                Text.dec(r.kind),
                '","evidence":"',
                r.kind >= 5 ? "panel" : "chain",
                '"'
            )
        );
        b.add(string.concat(',"fromBlock":', Text.dec(r.from), ',"toBlock":', Text.dec(r.to)));
        (uint16 panel, uint16 quorum) = Catalog.panel(r.kind);
        b.add(string.concat(',"minPanelSize":', Text.dec(panel), ',"minQuorum":', Text.dec(quorum)));
        b.add(string.concat(',"requestId":"', Text.word(r.rid), '","oracleRequestId":"', Text.word(r.oid), '"'));
        b.add(string.concat(',"target":"', Text.addr(r.target), '","name":', Text.quote(r.name, true), "}"));
        return true;
    }

    /// @dev Bound the entire reply before the typed ABI decoder reads any of its dynamic fields.
    function _spec(address registry, uint16 id) private view returns (uint8 kind, address target, string memory name) {
        bytes memory fast = abi.encodeWithSignature("renderSpec(uint16)", id);
        bool available;
        uint256 returned;
        assembly {
            available := staticcall(300000, registry, add(fast, 32), mload(fast), 0, 0)
            returned := returndatasize()
        }
        if (available && returned >= 128 && returned <= 512) {
            bytes memory fastReply = new bytes(returned);
            assembly { returndatacopy(add(fastReply, 32), 0, returned) }
            (kind, target, name) = abi.decode(fastReply, (uint8, address, string));
            if (bytes(name).length > 256) revert BadRegistry();
            return (kind, target, name);
        }
        bytes memory callData = abi.encodeCall(IRegistryView.specOf, (id));
        bool ok;
        uint256 size;
        assembly {
            ok := staticcall(300000, registry, add(callData, 32), mload(callData), 0, 0)
            size := returndatasize()
        }
        if (!ok || size < 416 || size > 4096) revert BadRegistry();
        bytes memory reply = new bytes(size);
        assembly { returndatacopy(add(reply, 32), 0, size) }
        Spec memory s = abi.decode(reply, (Spec));
        if (bytes(s.name).length > 256) revert BadRegistry();
        return (s.kind, s.target, s.name);
    }

    function _percent(string memory input) private pure returns (string memory) {
        bytes memory b = new bytes(bytes(input).length * 3);
        assembly {
            let dst := add(b, 32)
            let src := add(input, 32)
            let end := add(src, mload(input))
            let hexchars := "0123456789ABCDEF"
            for {} lt(src, end) { src := add(src, 1) } {
                let c := byte(0, mload(src))
                switch or(
                    or(
                        or(or(eq(c, 37), eq(c, 35)), or(eq(c, 34), eq(c, 38))),
                        or(or(eq(c, 32), eq(c, 60)), or(eq(c, 62), eq(c, 63)))
                    ),
                    gt(c, 127)
                )
                case 1 {
                    mstore8(dst, 37)
                    mstore8(add(dst, 1), byte(shr(4, c), hexchars))
                    mstore8(add(dst, 2), byte(and(c, 15), hexchars))
                    dst := add(dst, 3)
                }
                default {
                    mstore8(dst, c)
                    dst := add(dst, 1)
                }
            }
            mstore(b, sub(dst, add(b, 32)))
        }
        return string(b);
    }
}
