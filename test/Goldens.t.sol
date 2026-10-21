// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Renderer} from "../src/Renderer.sol";
import {Catalog} from "../src/Catalog.sol";
import {RenderRegistry} from "./mocks/RenderRegistry.sol";
import {Spec, OracleAttestation} from "../src/Types.sol";

contract GoldensTest is SwornTest {
    RenderRegistry internal preview;

    function setUp() public override {
        super.setUp();
        preview = new RenderRegistry();
    }

    function _value(uint8 c) private pure returns (uint256) {
        return
            c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 71 : c >= 48 && c <= 57 ? c + 4 : c == 43 ? 62 : 63;
    }

    function _json(string memory uri) internal pure returns (string memory) {
        bytes memory text = bytes(uri);
        uint256 n = text.length - 29;
        uint256 len = n / 4 * 3;
        if (text[text.length - 1] == "=") --len;
        if (text[text.length - 2] == "=") --len;
        bytes memory out = new bytes(len);
        uint256 pos;
        for (uint256 i = 29; i < text.length; i += 4) {
            uint256 word = (_value(uint8(text[i])) << 18) | (_value(uint8(text[i + 1])) << 12)
                | (_value(uint8(text[i + 2])) << 6) | _value(uint8(text[i + 3]));
            if (pos < len) out[pos++] = bytes1(uint8(word >> 16));
            if (pos < len) out[pos++] = bytes1(uint8(word >> 8));
            if (pos < len) out[pos++] = bytes1(uint8(word));
        }
        return string(out);
    }

    struct GoldenCase {
        uint256 count;
        uint256[] ids;
        string name;
    }

    function test_allSyntheticGoldensByteForByte() public {
        GoldenCase[] memory cases =
            abi.decode(vm.parseJson(vm.readFile("test/fixtures/hive-cases.json")), (GoldenCase[]));
        for (uint256 i; i < cases.length; ++i) {
            GoldenCase memory c = cases[i];
            uint16[] memory ids = new uint16[](c.ids.length);
            for (uint256 j; j < c.ids.length; ++j) {
                ids[j] = uint16(c.ids[j]);
            }
            preview.configure(ids, c.count, false, 0);
            string memory got = _json(renderer.tokenURIOf(address(preview), 1));
            assertEq(got, vm.readFile(string.concat("test/fixtures/", c.name, ".json")), c.name);
        }
    }

    function test_widestValuesHostileEscapingAndNoTextInSvg() public {
        uint16[25] memory all = Catalog.ids();
        uint16[] memory ids = new uint16[](25);
        for (uint256 i; i < 25; ++i) {
            ids[i] = all[i];
        }
        preview.configure(ids, 32, true, 0);
        string memory json = _json(renderer.tokenURIOf(address(preview), type(uint256).max));
        assertEq(json, vm.readFile("test/fixtures/widest.json"));
        assertEq(
            vm.parseJsonString(json, ".attributes[15].value"), "A'\"\\<>&\x01A'\"\\<>&\x01A'\"\\<>&\x01A'\"\\<>&\x01"
        );
        assertEq(vm.parseJsonUint(json, ".oracle[12].toBlock"), type(uint64).max);
    }

    function test_previewUnmintedWalletAndInvalidFamiliesRender() public {
        assertEq(preview.tokenOf(address(0xc1a1)), 0);
        uint16[] memory ids = new uint16[](2);
        ids[0] = 50;
        ids[1] = 1400;
        preview.configure(ids, 0, false, 0);
        string memory json = _json(renderer.tokenURIOf(address(preview), 1));
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "none");
        assertEq(vm.parseJsonString(json, ".attributes[0].value"), "0x000000000000000000000000000000000000c1a1");
    }

    function _assertPreparedInvisible(uint16 id, string memory original) private view {
        assertFalse(registry.hasTrait(alice, id));
        (bytes32 r, bytes32 oracleId, uint64 from, uint64 to) = registry.verified(alice, id);
        assertEq(r, 0);
        assertEq(oracleId, 0);
        assertEq(from, 0);
        assertEq(to, 0);
        assertEq(registry.verifiedSpecsOf(alice).length, 0);
        assertEq(registry.traitsOf(alice).length, 0);
        uint16 length;
        (r, oracleId, length) = registry.sharedFact(id);
        assertEq(r, 0);
        assertEq(oracleId, 0);
        assertEq(length, 0);
        assertEq(registry.tokenURI(1), original);
    }

    function test_preparedStorageInvisibleInEveryViewAfterEveryUnsuccessfulOutcome() public {
        vm.prank(alice);
        registry.mintCard();
        string memory original = registry.tokenURI(1);
        for (uint8 kind = 1; kind <= 3; kind += 2) {
            uint16 id = _register(kind);
            for (uint8 outcome; outcome < 3; ++outcome) {
                bytes32 r = kind == 3 ? _shared(id) : _ask(alice, id);
                _assertPreparedInvisible(id, original);
                if (outcome == 0) {
                    assertTrue(
                        intake.complete(
                            r, 2, abi.encode(r, uint8(2), bytes32("disagreed"), uint16(1), uint16(5), bytes(""))
                        )
                    );
                } else if (outcome == 1) {
                    OracleAttestation memory a = _att(r, kind == 3 ? abi.encode(_list(31)) : abi.encode(uint256(0)));
                    _miss(r, a, kind == 3 ? 9 : 8);
                } else {
                    vm.warp(block.timestamp + 32 days);
                    vm.prank(alice);
                    registry.abandon(r);
                }
                _assertPreparedInvisible(id, original);
                assertEq(registry.pendingOf(alice, id), 0);
                assertEq(registry.sharedPending(id), 0);
            }
        }
    }

    function test_hostileRegistryRepliesFailCleanlyWithinFiveMillionGas() public {
        uint16[] memory ids = new uint16[](0);
        for (uint8 bad = 1; bad <= 3; ++bad) {
            preview.configure(ids, 1, false, bad);
            uint256 start = gasleft();
            (bool ok, bytes memory why) =
                address(renderer).staticcall{gas: 5000000}(abi.encodeCall(Renderer.tokenURIOf, (address(preview), 1)));
            uint256 spent = start - gasleft();
            assertFalse(ok);
            assertEq(why, abi.encodeWithSelector(Renderer.BadRegistry.selector));
            assertLt(spent, 5000000);
        }
    }

    function test_stepTableRareDotRingCountsAndMetadataMinima() public {
        assertEq(renderer.communityStep(39), 0);
        assertEq(renderer.communityStep(40), 2);
        assertEq(renderer.communityStep(70), 9);
        assertEq(renderer.communityStep(5000), 58);
        assertEq(renderer.communityStep(8192), 64);
        uint16[] memory ids = new uint16[](3);
        ids[0] = 601;
        ids[1] = 701;
        ids[2] = 1201;
        preview.configure(ids, 0, false, 0);
        string memory json = _json(renderer.tokenURIOf(address(preview), 1));
        assertEq(vm.parseJsonUint(json, ".oracle[0].minPanelSize"), composer.PANEL_SIZE());
        assertEq(vm.parseJsonUint(json, ".oracle[0].minQuorum"), composer.PANEL_QUORUM());
        assertEq(vm.parseJsonUint(json, ".oracle[1].minPanelSize"), composer.CHAIN_PANEL());
        assertEq(vm.parseJsonUint(json, ".oracle[1].minQuorum"), composer.CHAIN_QUORUM());
        assertEq(vm.parseJsonUint(json, ".oracle[2].minPanelSize"), composer.PANEL_SIZE());
    }

    function _occurrences(string memory text, string memory needle) private pure returns (uint256 count) {
        bytes memory a = bytes(text);
        bytes memory b = bytes(needle);
        for (uint256 i; i + b.length <= a.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < b.length; ++j) {
                if (a[i + j] != b[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) ++count;
        }
    }

    function test_rareDotsAndRingCountsAgainstIndependentRules() public {
        uint16[10] memory ids = [uint16(202), 801, 901, 1001, 1101, 1102, 1103, 1104, 1201, 1105];
        uint16[] memory one = new uint16[](1);
        for (uint256 i; i < ids.length; ++i) {
            one[0] = ids[i];
            preview.configure(one, 0, false, 0);
            string memory json = _json(renderer.tokenURIOf(address(preview), 1));
            string memory image = vm.parseJsonString(json, ".image");
            assertEq(_occurrences(image, "%3Ccircle"), i == 9 ? 0 : 1);
        }
        one = new uint16[](0);
        for (uint256 rings; rings <= 3; ++rings) {
            preview.configure(one, rings * 13, false, 0);
            string memory json = _json(renderer.tokenURIOf(address(preview), 1));
            string memory image = vm.parseJsonString(json, ".image");
            assertEq(_occurrences(image, "stroke=%22%2305751f%22%20stroke-width=%223%22"), rings * 13);
        }
    }

    function test_maximumRealStateTokenURIGasAndStored601Window() public {
        curator.set(alice, true, 0, 10, 800 ether, 10000);
        vm.prank(alice);
        registry.mintCard();
        uint16[25] memory all = Catalog.ids();
        for (uint256 i = 13; i < 25; ++i) {
            uint16 id = all[i];
            if (id == 1201) {
                bytes32 r = _shared(id);
                address[] memory list = _list(32);
                list[0] = alice;
                assertTrue(_deliver(r, _att(r, abi.encode(list))));
                vm.prank(alice);
                registry.applySharedFact(id, list);
            } else {
                _pass(alice, id);
            }
        }
        Spec memory s = _maxSpec();
        assertEq(bytes(s.item).length, 256);
        vm.roll(type(uint64).max);
        s.toBlock = type(uint64).max - 64;
        s.fromBlock = s.toBlock - 7199;
        for (uint256 i; i < 32; ++i) {
            uint16 id = registry.registerSpec(s, 0);
            bytes32 r = _ask(alice, id);
            assertTrue(_deliver(r, _att(r, abi.encode(type(uint256).max))));
        }
        assertEq(registry.traitsOf(alice).length, 25);
        assertEq(registry.verifiedSpecsOf(alice).length, 32);
        vm.roll(block.number + 7200);
        vm.warp(block.timestamp + 1 days);
        vm.cool(address(registry));
        vm.cool(address(renderer));
        uint256 start = gasleft();
        string memory uri = registry.tokenURI(1);
        uint256 spent = start - gasleft();
        emit log_named_uint("maximum tokenURI cold gas", spent);
        emit log_named_uint("maximum URI bytes", bytes(uri).length);
        assertLe(spent, 10317448);
        string memory json = _json(uri);
        assertEq(vm.parseJsonUint(json, ".oracle[0].toBlock"), 26237654);
        assertEq(vm.parseJsonUint(json, ".attributes[14].value"), 32);
    }
}
