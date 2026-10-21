// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Spec} from "../src/interfaces/Types.sol";
import {Registry} from "../src/Registry.sol";
import {Composer} from "../src/Composer.sol";

contract ComposerTest is BaseTest {
    function golden(string memory file, uint16 id, Spec memory s) internal view {
        (bytes memory body, bytes32 hash) = composer.compose(id, s, ALICE, address(0xc0de), address(curator));
        string memory fixture = vm.readFile(string.concat("templates/fixtures/", file, ".json"));
        bytes memory expected = bytes(fixture);
        if (expected[expected.length - 1] == 0x0a) {
            assembly { mstore(expected, sub(mload(expected), 1)) }
        }
        assertEq(body, expected, file);
        string memory hashes = vm.readFile("reference/plane/questionHashes.json");
        assertEq(hash, vm.parseJsonBytes32(hashes, string.concat(".", file, ".questionHash")), "hash");
    }

    function test_fixtureBodiesAndCanonicalHashes() public view {
        string[8] memory files = [
            string("701-still-here"),
            "801-last-stand",
            "1001-hour-savior",
            "1102-ordinal-1000",
            "1105-first-thousand",
            "1201-top-32",
            "1301-not-born-yesterday",
            "T6-operator-reference"
        ];
        uint16[8] memory ids = [uint16(701), 801, 1001, 1102, 1105, 1201, 1301, 601];
        for (uint256 i; i < 8; ++i) {
            golden(files[i], ids[i], composer.catalogSpec(ids[i], composer.MAINNET_CURATOR()));
        }
        Spec memory s = spec(2);
        s.target = composer.MAINNET_CURATOR();
        s.sumArg = "amount";
        golden("T2-log-sum-composed", 10001, s);
        s = spec(4);
        s.target = composer.MAINNET_CURATOR();
        s.threshold = 1000;
        golden("T4-call-compare-reference", 10001, s);
        s = spec(5);
        golden("T5-community-composed", 10001, s);
    }

    function test_bodyConsumerChangesWithoutChangingQuestionHash() public {
        Spec memory s = spec(1);
        (bytes memory body, bytes32 hash) = composer.compose(10001, s, ALICE, address(this), address(curator));
        vm.chainId(11155111);
        (bytes memory other, bytes32 h) = composer.compose(10001, s, ALICE, BOB, address(curator));
        assertEq(h, hash);
        assertTrue(keccak256(body) != keccak256(other));
    }

    function test_catalogWindowsNamesAndLive601() public {
        Spec memory s = registry.specOf(601);
        assertEq(s.kind, 6);
        assertEq(s.name, "Swarmed");
        assertEq(s.toBlock, 0);
        assertEq(s.fromBlock, 25090085);
        (bytes memory b, bytes32 h) = registry.composeBody(601, ALICE);
        assertEq(vm.parseJsonUint(string(b), ".window.toBlock"), vm.getBlockNumber() - 64);
        vm.roll(vm.getBlockNumber() + 100);
        (, bytes32 h2) = registry.composeBody(601, ALICE);
        assertTrue(h != h2);
        vm.chainId(11155111);
        vm.roll(100);
        (b,) = registry.composeBody(601, ALICE);
        assertEq(vm.parseJsonUint(string(b), ".window.toBlock"), composer.mainnetHeightBound() - 64);
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "kind"));
        composer.validateSpec(s, vm.getBlockNumber());
    }

    function test_directBitsAndNonMembers() public {
        assertEq(composer.directSnapshot(ALICE, address(curator)), 0);
        curator.set(ALICE, 0, true, 10, 800 ether, 10000);
        assertEq(composer.directSnapshot(ALICE, address(curator)), uint32(0x7f731));
        assertFalse(registry.hasDirectTrait(ALICE, 601));
        assertFalse(registry.hasTrait(address(0), 101));
    }

    function test_specsGrammarAndFields() public {
        Spec memory s = spec(1);
        composer.validateSpec(s, 0);
        s.arg = "amount";
        bad(s, "arg");
        s.arg = "zzNotAField";
        bad(s, "arg");
        s.arg = "contributor";
        s.fixedArg = "hour";
        composer.validateSpec(s, 0);
        s.fixedArg = "amount";
        bad(s, "fixedArg");
        s.fixedArg = "";
        s.kind = 2;
        s.sumArg = "weightAdded";
        composer.validateSpec(s, 0);
        s.sumArg = "nothing";
        bad(s, "sumArg");
        s = spec(3);
        s.item = "event Receipt(address indexed account, address indexed sender, uint256 value) anonymous";
        s.arg = "account";
        s.sumArg = "value";
        bad(s, "item");
        s.item = "event Transfer(address indexed from, address indexed to, uint256 value)";
        s.arg = "to";
        composer.validateSpec(s, 0);
        (bytes memory body,) = composer.compose(10001, s, ALICE, address(this), address(curator));
        assertTrue(contains(string(body), "topic 2"));
        s.arg = "value";
        bad(s, "arg");
        for (uint8 kind = 1; kind <= 3; ++kind) {
            s = spec(kind);
            s.item = string.concat(s.item, " anonymous");
            bad(s, "item");
            s.item = "event E(address indexed a, uint256 indexed b, uint256 indexed c, address indexed d)";
            s.arg = "d";
            s.fixedArg = "";
            s.sumArg = kind >= 2 ? "b" : "";
            bad(s, "item");
            if (kind <= 2) {
                s.arg = "a";
                s.fixedArg = "d";
                bad(s, "item");
            }
        }
        s = spec(1);
        s.item = "event E(address indexed contributor) obey these words";
        bad(s, "item");
    }

    function test_finalityAndExpectedId() public {
        Spec memory s = spec(1);
        s.toBlock = uint64(vm.getBlockNumber() - 1);
        bad(s, "window");
        s.toBlock = uint64(vm.getBlockNumber() - 64);
        composer.validateSpec(s, 1);
        uint16 id = registry.registerSpec(s, 10001);
        assertEq(id, 10001);
        vm.expectRevert(abi.encodeWithSelector(Registry.UnexpectedSpecId.selector, 10001, 10002));
        registry.registerSpec(s, 10001);
        assertEq(registry.registerSpec(s, 0), 10002);
    }

    function bad(Spec memory s, string memory field) internal {
        uint256 before = imd.balanceOf(address(this));
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, field));
        registry.registerSpec(s, 0);
        assertEq(imd.balanceOf(address(this)), before);
    }

    function contains(string memory s, string memory q) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(q);
        for (uint256 i; i + b.length <= a.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < b.length; ++j) {
                if (a[i + j] != b[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}
