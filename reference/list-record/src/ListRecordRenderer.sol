// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {CardData, IListRecordRenderer} from "./interfaces/IListRecordRenderer.sol";
import {SSTORE2} from "./lib/SSTORE2.sol";
import {Str} from "./lib/Str.sol";

/// @notice Turns one CardData into a fully on-chain `data:application/json`
///         URI.  Immutable, ownerless, and it never calls back into
///         ListRecord.
/// @dev    The metadata JSON - envelope, traits and the percent-encoded SVG
///         alike - is one blob in contract code (SSTORE2), cut into 22 fixed
///         slices.  Rendering copies slice, value, slice, value ... straight
///         into one output buffer and Base64-encodes it once.  Because the
///         template is stored ALREADY percent-encoded, the contract does no
///         encoding at runtime; and because Base64 is not byte-aligned to its
///         plaintext, encoding once at the end is the only order that lets the
///         per-token values be spliced at all.
contract ListRecordRenderer is IListRecordRenderer {
    /// @notice Number of per-token values spliced into the template.
    uint256 internal constant SLOTS = 21;
    /// @notice Number of fixed slices; always SLOTS + 1.
    uint256 internal constant SLICES = 22;
    /// @dev EIP-170 permits 24,576 runtime bytes. SSTORE2 adds one leading STOP byte.
    uint256 internal constant MAX_BLOB_LENGTH = 24_575;

    /// @notice SSTORE2 pointer holding the whole percent-encoded template.
    address public immutable template;

    /// @dev offsets[2i] = start of slice i in the blob, offsets[2i+1] = length.
    uint16[SLICES * 2] internal offsets;

    error BadOffsets();

    constructor(bytes memory blob, uint16[SLICES * 2] memory offs) {
        if (blob.length > MAX_BLOB_LENGTH) revert BadOffsets();

        uint256 total;
        for (uint256 i; i < SLICES; ++i) {
            if (offs[i * 2] != total) revert BadOffsets();
            total += offs[i * 2 + 1];
        }
        if (total != blob.length) revert BadOffsets();
        template = SSTORE2.write(blob);
        offsets = offs;
    }

    /// @notice The 21 per-token values, in blob order.
    function _values(CardData calldata d) internal pure returns (bytes[SLOTS] memory v) {
        bytes memory id = Str.u(d.id);
        bytes memory claimant = Str.hexAddr(d.claimant);
        bytes memory points = Str.u(d.points);
        bytes memory weight = Str.eth4(d.weightWei);
        bytes memory credit = Str.eth4(d.creditWei);
        bytes memory deposits = Str.u(d.deposits);
        bytes memory hourN = Str.u(d.hour);
        bytes memory window_ = d.grace ? bytes("grace") : bytes("judged");
        bool own = d.owner == d.claimant;

        v[0] = id; // JSON  name
        v[1] = id; // card  #id
        v[2] = claimant; // card claimant
        v[3] = points; // card the mark
        v[4] = credit; // card detail line 1
        v[5] = weight;
        v[6] = deposits; // card  detail line 2
        v[7] = hourN;
        v[8] = window_;
        v[9] = own ? bytes("held%20by%20claimant") : bytes("held%20by%20another");
        v[10] = points; // trait Points
        v[11] = weight; // trait Weight (ETH)
        v[12] = credit; // trait Credit (ETH)
        v[13] = deposits; // trait Deposits
        v[14] = abi.encodePacked("hour ", hourN); // trait Hour
        v[15] = window_; // trait Window
        v[16] = Str.u(d.joinIndex); // trait Join Index
        v[17] = Str.u(d.claimedAtHour); // trait Claimed At Hour
        v[18] = id; // trait Claim Order
        v[19] = claimant; // trait Claimant
        v[20] = own ? bytes("yes") : bytes("no"); // trait Held by claimant
    }

    /// @notice The finished metadata JSON, before Base64.  Public so a test can
    ///         diff it against the golden without decoding anything.
    function preimage(CardData calldata d) public view returns (bytes memory out) {
        bytes[SLOTS] memory v = _values(d);
        uint256 total = SSTORE2.size(template);
        for (uint256 i; i < SLOTS; ++i) {
            total += v[i].length;
        }

        out = new bytes(total);
        // Reserve 32 bytes of scratch immediately after `out`.  The splice
        // below copies values a full word at a time, so the last value of the
        // last iteration may overshoot `out`'s end by up to 31 bytes; this
        // makes that overshoot land in memory this call owns.
        assembly {
            mstore(0x40, add(mload(0x40), 0x20))
        }
        address tpl = template;
        uint256 off;
        for (uint256 i; i < SLICES; ++i) {
            uint256 len = offsets[i * 2 + 1];
            SSTORE2.readInto(tpl, offsets[i * 2], len, out, off);
            off += len;
            if (i == SLOTS) break; // the last slice has no value after it
            bytes memory val = v[i];
            uint256 vl = val.length;
            assembly {
                let dst := add(add(out, 0x20), off)
                let src := add(val, 0x20)
                // Word-at-a-time; the overshoot of the final word is always
                // overwritten by the next slice or lies inside the 32-byte
                // slack reserved above, never past it.
                for { let j := 0 } lt(j, vl) { j := add(j, 0x20) } { mstore(add(dst, j), mload(add(src, j))) }
            }
            off += vl;
        }
    }

    /// @inheritdoc IListRecordRenderer
    function tokenURI(CardData calldata d) external view returns (string memory) {
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(preimage(d))));
    }
}
