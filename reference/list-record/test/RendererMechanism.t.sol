// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {ListRecordRenderer} from "../src/ListRecordRenderer.sol";
import {CardData} from "../src/interfaces/IListRecordRenderer.sol";

contract RendererMechanismTest is Test {
    uint256 internal constant SLICES = 22;
    uint256 internal constant OFFSET_WORDS = SLICES * 2;
    uint256 internal constant MAX_BLOB_LENGTH = 24_575;

    bytes32 internal constant EXPECTED_BLOB_HASH = 0x084304a65f55159ceff6e9d9a7d17683ca506b5d842cc94eb1014356f37bc5ef;
    bytes32 internal constant EXPECTED_RUNTIME_HASH =
        0x7dd6d40bd56ace74468675e14b88bdf7ae401843be2978258e34832f13a35abe;

    function test_constructorAcceptsContiguousOffsetsWithFullCoverage() public {
        bytes memory blob = hex"010203";
        ListRecordRenderer renderer = new ListRecordRenderer(blob, _offsetsCovering(blob.length));

        assertEq(renderer.template().code, bytes.concat(hex"00", blob), "valid offsets must deploy the full blob");
    }

    function test_constructorRejectsNoncontiguousOffsets() public {
        bytes memory blob = hex"010203";
        uint16[OFFSET_WORDS] memory offs = _offsetsCovering(blob.length);
        offs[2] = 2;

        vm.expectRevert(ListRecordRenderer.BadOffsets.selector);
        new ListRecordRenderer(blob, offs);
    }

    function test_constructorRejectsIncompleteBlobCoverage() public {
        bytes memory blob = hex"010203";
        uint16[OFFSET_WORDS] memory offs = _offsetsCovering(blob.length - 1);

        vm.expectRevert(ListRecordRenderer.BadOffsets.selector);
        new ListRecordRenderer(blob, offs);
    }

    function test_constructorAccepts24575ByteBlob() public {
        bytes memory blob = new bytes(MAX_BLOB_LENGTH);
        ListRecordRenderer renderer = new ListRecordRenderer(blob, _offsetsCovering(blob.length));

        assertEq(renderer.template().code.length, MAX_BLOB_LENGTH + 1, "EIP-170 boundary runtime length");
    }

    function test_constructorRejects24576ByteBlobWithBadOffsets() public {
        bytes memory blob = new bytes(MAX_BLOB_LENGTH + 1);
        uint16[OFFSET_WORDS] memory offs = _offsetsCovering(blob.length);

        vm.expectRevert(ListRecordRenderer.BadOffsets.selector);
        new ListRecordRenderer(blob, offs);
    }

    function test_templateChildRuntimeIsStopFollowedByExactArtifactBlob() public {
        bytes memory blob = _artifactBlob();
        ListRecordRenderer renderer = new ListRecordRenderer(blob, _artifactOffsets());
        bytes memory runtime = renderer.template().code;

        assertEq(blob.length, 2_264, "artifact blob length");
        assertEq(keccak256(blob), EXPECTED_BLOB_HASH, "artifact blob hash");
        assertEq(runtime.length, 2_265, "child runtime length");
        assertEq(keccak256(runtime), EXPECTED_RUNTIME_HASH, "child runtime hash");
        assertEq(runtime, bytes.concat(hex"00", blob), "child runtime must be STOP || blob");
        assertEq(uint8(runtime[0]), 0, "child runtime must start with STOP");
        assertEq(_withoutFirstByte(runtime), blob, "payload must begin at child-code offset one");
    }

    function test_preimageSliceReadSkipsTheLeadingStopByte() public {
        bytes memory blob = bytes("A");
        ListRecordRenderer renderer = new ListRecordRenderer(blob, _offsetsCovering(blob.length));

        bytes memory out = renderer.preimage(_card());
        assertGt(out.length, 1, "renderer returned no preimage");
        assertEq(uint8(out[0]), 0x41, "first slice copied STOP instead of payload byte");
    }

    function test_rendererRendersBeforeAnyListRecordExists() public {
        ListRecordRenderer renderer = new ListRecordRenderer(_artifactBlob(), _artifactOffsets());

        bytes memory preimage = renderer.preimage(_card());
        bytes memory uri = bytes(renderer.tokenURI(_card()));
        bytes memory prefix = bytes("data:application/json;base64,");

        assertGt(preimage.length, 2_000, "direct renderer preimage");
        assertGt(uri.length, prefix.length, "direct renderer URI");
        for (uint256 i; i < prefix.length; ++i) {
            assertEq(uri[i], prefix[i], "URI prefix");
        }
    }

    function test_concreteRendererHasExactPublicABI() public {
        string memory artifact = vm.readFile("out/ListRecordRenderer.sol/ListRecordRenderer.json");

        // Read only the top-level ABI. AST output legitimately repeats names and node kinds.
        assertEq(vm.parseJsonString(artifact, ".abi[0].type"), "constructor");
        assertEq(vm.parseJsonString(artifact, ".abi[0].stateMutability"), "nonpayable");
        assertEq(vm.parseJsonString(artifact, ".abi[0].inputs[0].type"), "bytes", "constructor blob");
        assertEq(vm.parseJsonString(artifact, ".abi[0].inputs[1].type"), "uint16[44]", "constructor offsets");
        assertEq(vm.parseJsonString(artifact, ".abi[1].type"), "function");
        assertEq(vm.parseJsonString(artifact, ".abi[1].name"), "preimage");
        assertEq(vm.parseJsonString(artifact, ".abi[2].type"), "function");
        assertEq(vm.parseJsonString(artifact, ".abi[2].name"), "template");
        assertEq(vm.parseJsonString(artifact, ".abi[3].type"), "function");
        assertEq(vm.parseJsonString(artifact, ".abi[3].name"), "tokenURI");
        assertEq(vm.parseJsonString(artifact, ".abi[4].type"), "error");
        assertEq(vm.parseJsonString(artifact, ".abi[4].name"), "BadOffsets");
        assertFalse(vm.keyExistsJson(artifact, ".abi[4].inputs[0]"), "BadOffsets() has no arguments");
        assertEq(vm.parseJsonString(artifact, ".abi[5].type"), "error");
        assertEq(vm.parseJsonString(artifact, ".abi[5].name"), "DeployFailed");
        assertFalse(vm.keyExistsJson(artifact, ".abi[5].inputs[0]"), "DeployFailed() has no arguments");
        assertTrue(vm.keyExistsJson(artifact, ".abi[5]"), "six ABI entries");
        assertFalse(vm.keyExistsJson(artifact, ".abi[6]"), "no seventh ABI entry");
        assertTrue(vm.contains(artifact, '"template()":"6f2ddd93"'), "template selector");
        assertTrue(
            vm.contains(
                artifact,
                '"preimage((uint256,address,address,uint256,uint256,uint256,uint256,uint256,uint32,uint32,bool))":"641ebf7f"'
            ),
            "preimage selector"
        );
        assertTrue(
            vm.contains(
                artifact,
                '"tokenURI((uint256,address,address,uint256,uint256,uint256,uint256,uint256,uint32,uint32,bool))":"f49414cc"'
            ),
            "tokenURI selector"
        );
    }

    function test_rendererAstHasNoExternalCallOrCallbackPrimitive() public {
        string memory artifact = vm.readFile("out/ListRecordRenderer.sol/ListRecordRenderer.json");
        string[12] memory forbidden = [
            '"memberName":"sender"',
            '"memberName":"origin"',
            '"memberName":"call"',
            '"memberName":"staticcall"',
            '"memberName":"delegatecall"',
            '"memberName":"callcode"',
            '"name":"call"',
            '"name":"staticcall"',
            '"name":"delegatecall"',
            '"name":"callcode"',
            " view external ",
            " pure external "
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            assertFalse(vm.contains(artifact, forbidden[i]), string.concat("callback primitive: ", forbidden[i]));
        }
    }

    function _offsetsCovering(uint256 coveredLength) internal pure returns (uint16[OFFSET_WORDS] memory offs) {
        require(coveredLength <= type(uint16).max, "test offset exceeds uint16");
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 end = uint16(coveredLength);
        offs[1] = end;
        for (uint256 i = 1; i < SLICES; ++i) {
            offs[i * 2] = end;
        }
    }

    function _artifactBlob() internal view returns (bytes memory) {
        return vm.parseBytes(vm.trim(vm.readFile("template/blob.hex")));
    }

    function _artifactOffsets() internal view returns (uint16[OFFSET_WORDS] memory offs) {
        string[] memory parts = vm.split(vm.trim(vm.readFile("template/offsets.txt")), ",");
        require(parts.length == OFFSET_WORDS, "artifact must contain 44 offset integers");
        for (uint256 i; i < OFFSET_WORDS; ++i) {
            uint256 parsed = vm.parseUint(vm.trim(parts[i]));
            require(parsed <= type(uint16).max, "artifact offset exceeds uint16");
            // forge-lint: disable-next-line(unsafe-typecast)
            offs[i] = uint16(parsed);
        }
    }

    function _withoutFirstByte(bytes memory input) internal pure returns (bytes memory output) {
        output = new bytes(input.length - 1);
        for (uint256 i; i < output.length; ++i) {
            output[i] = input[i + 1];
        }
    }

    /// @dev SYNTHETIC and labelled: the address is invented and every fact is a layout input for
    ///      the renderer mechanism, not any wallet's record.
    function _card() internal pure returns (CardData memory) {
        return CardData({
            id: 7,
            claimant: address(0xC1A1),
            owner: address(0xC1A1),
            points: 921,
            weightWei: 0.8497 ether,
            creditWei: 0.69 ether,
            deposits: 7,
            hour: 0,
            joinIndex: 2_101,
            claimedAtHour: 77,
            grace: true
        });
    }
}
