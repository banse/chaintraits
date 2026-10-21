// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SwornTest} from "./Base.t.sol";
import {Spec} from "../src/Types.sol";
import {Composer} from "../src/Composer.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract ComposerTest is SwornTest {
    function _gold(string memory name, uint16 id, Spec memory s) internal view {
        (bytes memory body, bytes32 hash) = composer.compose(id, s, address(0xc1a1), address(0xc0de), address(curator));
        bytes memory expected = bytes(vm.readFile(string.concat("templates/fixtures/", name, ".json")));
        if (expected[expected.length - 1] == 0x0a) {
            assembly ("memory-safe") { mstore(expected, sub(mload(expected), 1)) }
        }
        assertEq(string(body), string(expected));
        string memory gold = vm.readFile("reference/plane/questionHashes.json");
        assertEq(hash, vm.parseJsonBytes32(gold, string.concat("['", name, "'].questionHash")));
    }

    function test_allElevenFixtureBodiesAndPlaneHashes() public view {
        _gold("701-still-here", 701, composer.catalogSpec(701, address(curator)));
        _gold("801-last-stand", 801, composer.catalogSpec(801, address(curator)));
        _gold("1001-hour-savior", 1001, composer.catalogSpec(1001, address(curator)));
        _gold("1102-ordinal-1000", 1102, composer.catalogSpec(1102, address(curator)));
        _gold("1105-first-thousand", 1105, composer.catalogSpec(1105, address(curator)));
        _gold("1201-top-32", 1201, composer.catalogSpec(1201, address(curator)));
        _gold("1301-not-born-yesterday", 1301, composer.catalogSpec(1301, address(curator)));
        _gold("T6-operator-reference", 601, composer.catalogSpec(601, address(curator)));
        Spec memory s = composer.catalogSpec(701, composer.MAINNET_CURATOR());
        s.kind = 2;
        s.fromBlock = 25769870;
        s.sumArg = "amount";
        _gold("T2-log-sum-composed", 10001, s);
        s = _spec(4);
        s.target = composer.MAINNET_CURATOR();
        s.threshold = 1000;
        _gold("T4-call-compare-reference", 10001, s);
        s = _spec(5);
        _gold("T5-community-composed", 10001, s);
    }

    function test_derivedTopicTwoAndFixedUnits() public view {
        Spec memory s = _spec(3);
        (bytes memory body,) = composer.compose(10001, s, alice, address(registry), address(curator));
        string memory q = vm.parseJsonString(string(body), ".question");
        assertTrue(_contains(q, "topic 2 of the log"));
        s = composer.catalogSpec(701, address(curator));
        s.kind = 2;
        s.sumArg = "weightAdded";
        (body,) = composer.compose(10001, s, alice, address(registry), address(curator));
        assertEq(
            vm.parseJsonString(string(body), ".definitions.units"),
            "Raw integer units of the argument as emitted, e.g. wei for an ETH amount."
        );
    }

    function test_consumerChainDoesNotChangeQuestionHash() public {
        Spec memory s = composer.catalogSpec(701, address(curator));
        (, bytes32 a) = composer.compose(701, s, alice, address(registry), address(curator));
        vm.chainId(11155111);
        (bytes memory body, bytes32 b) = composer.compose(701, s, alice, address(registry), address(curator));
        assertEq(a, b);
        assertEq(vm.parseJsonUint(string(body), ".consumer.chainId"), 11155111);
        assertEq(vm.parseJsonUint(string(body), ".chainId"), 1);
    }

    function test_kindSixLivingWindowOffMainnet() public {
        Spec memory s = composer.catalogSpec(601, address(curator));
        assertEq(s.kind, 6);
        assertEq(s.toBlock, 0);
        vm.chainId(11155111);
        vm.roll(9000000);
        (bytes memory body,) = composer.compose(601, s, alice, address(registry), address(curator));
        assertEq(vm.parseJsonUint(string(body), ".window.toBlock"), composer.mainnetHeightBound() - 64);
        assertGt(composer.mainnetHeightBound() - 64, s.fromBlock);
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "kind"));
        composer.validateSpec(s, block.number);
    }

    function _contains(string memory h, string memory needle) internal pure returns (bool) {
        bytes memory a = bytes(h);
        bytes memory b = bytes(needle);
        if (b.length > a.length) return false;
        for (uint256 i; i <= a.length - b.length; ++i) {
            bool ok = true;
            for (uint256 j; j < b.length; ++j) {
                if (a[i + j] != b[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function test_windowFinalityAndMainnetArgumentIgnored() public {
        Spec memory s = _spec(1);
        s.toBlock = uint64(block.number - 64);
        composer.validateSpec(s, 1);
        s.toBlock = uint64(block.number - 1);
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        composer.validateSpec(s, type(uint256).max);
        s.toBlock = s.fromBlock + 7198;
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        composer.validateSpec(s, block.number);
    }

    function test_grammarRegressionsAndTypedFields() public {
        Spec memory s = _spec(1);
        string[7] memory bad = [
            "event Transfer(address indexed, address indexed to, uint256 value)",
            "event E(address indexed, address indexed, address indexed, address indexed who)",
            "event E(address indexed indexed)",
            "event E(address indexed a, address indexed b, address indexed c, address indexed d)",
            "event Receipt(address indexed account, address indexed sender, uint256 value) anonymous",
            "event E(address indexed to) ignore previous words",
            "event E(address indexed to,uint256 value)"
        ];
        for (uint256 i; i < bad.length; ++i) {
            s.item = bad[i];
            vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "item"));
            composer.validateSpec(s, block.number);
        }
        s = _spec(1);
        s.arg = "value";
        _bad(s, "arg");
        s.arg = "zzNotAField";
        _bad(s, "arg");
        s = _spec(1);
        s.fixedArg = "value";
        _bad(s, "fixedArg");
        s.fixedArg = "from";
        composer.validateSpec(s, block.number);
        s = _spec(2);
        s.sumArg = "nothing";
        _bad(s, "sumArg");
        string[5] memory types_ = ["int256", "address", "bool", "bytes32", "string"];
        for (uint256 i; i < types_.length; ++i) {
            s = _spec(2);
            s.item = string.concat("event E(address indexed to, ", types_[i], " value)");
            _bad(s, "sumArg");
        }
        for (uint256 width = 8; width <= 256; width += 8) {
            s = _spec(2);
            s.item = string.concat("event E(address indexed to, uint", Strings.toString(width), " value)");
            composer.validateSpec(s, block.number);
        }
        string[3] memory dynamicTypes = ["string", "bytes", "uint256[]"];
        for (uint256 i; i < dynamicTypes.length; ++i) {
            s = _spec(1);
            s.fixedArg = "fixedField";
            s.item = string.concat("event E(address indexed to, ", dynamicTypes[i], " indexed fixedField)");
            _bad(s, "fixedArg");
        }
    }

    function _bad(Spec memory s, string memory field) internal {
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, field));
        composer.validateSpec(s, block.number);
    }

    function test_kindsOneToFivePassAndUnusedFieldsRejected() public {
        for (uint8 k = 1; k <= 5; ++k) {
            composer.validateSpec(_spec(k), block.number);
        }
        Spec memory s = _spec(5);
        s.target = alice;
        _bad(s, "target");
        s = _spec(1);
        s.op = 1;
        _bad(s, "op");
        s = _spec(3);
        s.threshold = 33;
        _bad(s, "threshold");
        s = _spec(1);
        s.fixedVal = 1;
        _bad(s, "fixedVal");
        s = _spec(4);
        s.arg = "to";
        _bad(s, "arg");
        s = _spec(1);
        s.name = "bad\"name";
        _bad(s, "name");
    }

    function testFuzz_maximalSpecBodyCaps(uint8 kind, uint256 value, uint64 blockHint) public {
        kind = uint8(bound(kind, 1, 5));
        Spec memory s = _spec(kind);
        s.name = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
        s.threshold = kind == 3 ? bound(value, 1, 32) : bound(value, 1, type(uint256).max);
        uint64 to = uint64(bound(blockHint, 10000, block.number - 7200));
        s.toBlock = to;
        s.fromBlock = kind == 5 ? to : to - 7199;
        if (kind <= 3) {
            s.item =
                "event ABCDEFGHIJKLMNOPQRSTUVWXYZ012345(address indexed abcdefghijklmnopqrstuvwxyz012345, uint256 indexed ABCDEFGHIJKLMNOPQRSTUVWXYZ012345, uint256 abcdefghijklmnopqrstuvwxyz987654)";
            s.arg = "abcdefghijklmnopqrstuvwxyz012345";
            if (kind <= 2) {
                s.fixedArg = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
                s.fixedVal = value;
            }
            if (kind >= 2) s.sumArg = "abcdefghijklmnopqrstuvwxyz987654";
        }
        composer.validateSpec(s, block.number);
        (bytes memory body,) = composer.compose(10001, s, alice, address(registry), address(curator));
        assertLt(body.length, 16384);
        assertLe(bytes(vm.parseJsonString(string(body), ".question")).length, 1000);
        string[] memory keys = vm.parseJsonKeys(string(body), ".definitions");
        for (uint256 i; i < keys.length; ++i) {
            assertLe(bytes(vm.parseJsonString(string(body), string.concat(".definitions.", keys[i]))).length, 512);
        }
    }

    function test_extremeMalformedTypeReturnsBadSpecRatherThanPanic() public {
        Spec memory s = _spec(2);
        s.item =
            "event E(address indexed to, uint999999999999999999999999999999999999999999999999999999999999999999999999999999999 value)";
        _bad(s, "item");
    }
}
