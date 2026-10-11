// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Card, OracleMeta, Spec} from "../src/Types.sol";
import {OracleAttestation} from "../src/interfaces/IOracleConsumer.sol";

/// @notice Invariant 8: `tokenURI` bytes equal the generator's goldens (`tools/gen_template.py`),
///         the template artifacts match the compiled constants, and hostile spec strings are escaped.
contract GoldensTest is Base {
    bytes32 internal constant REQUEST_1 = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 internal constant REQUEST_2 = 0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 internal constant ORACLE_1 = 0x0123456789abcdef0123456789abcdef00000000000000000000000000000000;
    bytes32 internal constant ORACLE_2 = 0xfedcba9876543210fedcba987654321000000000000000000000000000000000;

    function test_templateArtifactsMatchTheCompiledConstants() public view {
        bytes memory blob = vm.parseBytes(vm.trim(vm.readFile("template/blob.hex")));
        assertEq(renderer.template(), blob, "blob.hex");
        string[] memory parts = vm.split(vm.trim(vm.readFile("template/offsets.txt")), ",");
        assertEq(parts.length, 70, "35 slices");
        bytes memory offs = renderer.offsets();
        assertEq(offs.length, 140);
        uint256 cursor;
        for (uint256 i; i < 70; ++i) {
            uint256 v = vm.parseUint(parts[i]);
            assertEq((uint256(uint8(offs[2 * i])) << 8) | uint256(uint8(offs[2 * i + 1])), v, "offset");
            if (i % 2 == 0) assertEq(v, cursor, "contiguous");
            else cursor += v;
        }
        assertEq(cursor, blob.length, "slices tile the blob");
    }

    function test_goldenSyntheticDirect() public {
        curator.set(C1A1, 0, true, 5, 1 ether, 1000);
        uint256 id = mint(C1A1);
        assertEq(id, 1);
        _assertGolden("synthetic_direct", registry.tokenURI(1), registry.cardOf(1));
    }

    function test_goldenSyntheticOracle() public {
        mint(address(0xF1));
        idmd.setBalance(AC1A1, 1);
        uint256 id = mint(AC1A1);
        assertEq(id, 2);
        intake.forceNextId(REQUEST_1);
        bytes32 rid = ask(AC1A1, 801);
        assertEq(rid, REQUEST_1);
        OracleAttestation memory a = attestationFor(rid, word(1));
        a.requestId = ORACLE_1;
        assertTrue(deliver(rid, a));
        uint16 specId = register(address(0xBEEF), t1Spec(REGISTRY_ADDR, "Received a token"));
        assertEq(specId, 10001);
        intake.forceNextId(REQUEST_2);
        rid = ask(AC1A1, specId);
        a = attestationFor(rid, word(1));
        a.requestId = ORACLE_2;
        assertTrue(deliver(rid, a));
        _assertGolden("synthetic_oracle", registry.tokenURI(2), registry.cardOf(2));
    }

    function test_goldenSyntheticWidthThroughTheRenderer() public view {
        Card memory c;
        c.tokenId = type(uint256).max;
        c.claimant = 0xffffFFFFFfffFFFFFFfFFFFfFFFFFFFFfFFFC1a1;
        uint16[13] memory top = [101, 202, 303, 404, 503, 601, 701, 801, 901, 1001, 1105, 1201, 1301];
        c.top = top;
        c.traits = new uint16[](25);
        uint16[25] memory all = [
            101,
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
        for (uint256 i; i < 25; ++i) {
            c.traits[i] = all[i];
        }
        c.community = new uint16[](32);
        for (uint256 i; i < 32; ++i) {
            c.community[i] = uint16(10001 + i);
        }
        c.communityCount = 40;
        c.oracle = new OracleMeta[](1);
        Spec memory s;
        s.kind = 4;
        s.target = REGISTRY_ADDR;
        s.item = 'function f(address) view returns (uint256)"</text><script>&\x01\\';
        s.op = 1;
        s.threshold = 1000;
        s.fromBlock = B_DEPLOY;
        s.toBlock = B_END;
        s.name = 'a"b\\c<d>&e';
        c.oracle[0] = OracleMeta(10001, 5, 3, REQUEST_1, ORACLE_1, s);
        _assertGolden("synthetic_width", renderer.tokenURI(c), c);
    }

    function test_escapeJsonNeutralisesMarkup() public view {
        assertEq(string(renderer.escapeJson('a"b\\c<d>&e\x01')), 'a\\"b\\\\c\\u003cd\\u003e\\u0026e\\u0001');
        assertEq(string(renderer.escapeJson("plain Name 1.0-x")), "plain Name 1.0-x");
    }

    function _assertGolden(string memory name_, string memory uri, Card memory c) internal view {
        string memory base = string.concat("test/fixtures/golden_", name_);
        assertEq(uri, vm.readFile(string.concat(base, "_uri.txt")), "uri");
        bytes memory preimage = renderer.preimage(c);
        assertEq(string(preimage), vm.readFile(string.concat(base, "_preimage.txt")), "preimage");
        string memory image = vm.parseJsonString(string(preimage), ".image");
        string memory encoded = vm.replace(image, "data:image/svg+xml,", "");
        assertEq(string(_pctDecode(bytes(encoded))), vm.readFile(string.concat(base, "_svg.txt")), "svg");
    }

    function _pctDecode(bytes memory input) internal pure returns (bytes memory out) {
        out = new bytes(input.length);
        uint256 o;
        uint256 i;
        while (i < input.length) {
            if (input[i] == "%") {
                out[o++] = bytes1(_nibble(input[i + 1]) * 16 + _nibble(input[i + 2]));
                i += 3;
            } else {
                out[o++] = input[i++];
            }
        }
        assembly {
            mstore(out, o)
        }
    }

    function _nibble(bytes1 c) internal pure returns (uint8) {
        uint8 b = uint8(c);
        if (b >= 48 && b <= 57) return b - 48;
        if (b >= 65 && b <= 70) return b - 55;
        return b - 87;
    }
}
