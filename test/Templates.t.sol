// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Spec} from "../src/Types.sol";
import {Composer} from "../src/Composer.sol";

/// @notice Invariant 7: composed bodies equal `templates/fixtures/*.json` byte for byte and the
///         registry's question hash equals the plane's for all ten fixtures.
contract TemplatesTest is Base {
    string[10] internal NAMES = [
        "701-still-here",
        "801-last-stand",
        "1001-hour-savior",
        "1102-ordinal-1000",
        "1105-first-thousand",
        "1201-top-32",
        "1301-not-born-yesterday",
        "T2-log-sum-composed",
        "T4-call-compare-reference",
        "T5-community-composed"
    ];

    uint16 internal t2Id;
    uint16 internal t4Id;
    uint16 internal t5Id;

    function setUp() public override {
        super.setUp();
        Spec memory s2;
        s2.kind = 2;
        s2.target = CURATOR_ADDR;
        s2.item = Composer(composer).DEPOSITED();
        s2.arg = "contributor";
        s2.sumArg = "amount";
        s2.threshold = 1;
        s2.fromBlock = B_DEPLOY;
        s2.toBlock = B_END;
        s2.name = "Deposited sum";
        t2Id = register(address(0xBEEF), s2);

        Spec memory s4;
        s4.kind = 4;
        s4.target = CURATOR_ADDR;
        s4.item = "function pointsOf(address) view returns (uint256)";
        s4.op = 1;
        s4.threshold = 1000;
        s4.fromBlock = B_DEPLOY;
        s4.toBlock = B_END;
        s4.name = "Scoreboard at the end";
        t4Id = register(address(0xBEEF), s4);

        Spec memory s5;
        s5.kind = 5;
        s5.threshold = 20;
        s5.fromBlock = B_END;
        s5.toBlock = B_END;
        s5.name = "Nonce at the end";
        t5Id = register(address(0xBEEF), s5);
    }

    function _idOf(uint256 i) internal view returns (uint16) {
        if (i == 0) return 701;
        if (i == 1) return 801;
        if (i == 2) return 1001;
        if (i == 3) return 1102;
        if (i == 4) return 1105;
        if (i == 5) return 1201;
        if (i == 6) return 1301;
        if (i == 7) return t2Id;
        if (i == 8) return t4Id;
        return t5Id;
    }

    function _fixture(string memory name) internal view returns (bytes memory body) {
        body = bytes(vm.readFile(string.concat("templates/fixtures/", name, ".json")));
        // the file's trailing newline is not part of the body
        if (body[body.length - 1] == 0x0a) {
            assembly {
                mstore(body, sub(mload(body), 1))
            }
        }
    }

    function test_allTenBodiesAreByteExact() public view {
        for (uint256 i; i < 10; ++i) {
            (bytes memory body,) = registry.composeBody(_idOf(i), C1A1);
            assertEq(body, _fixture(NAMES[i]), NAMES[i]);
        }
    }

    function test_allTenQuestionHashesEqualThePlanes() public view {
        string memory j = vm.readFile("reference/plane/questionHashes.json");
        for (uint256 i; i < 10; ++i) {
            (, bytes32 qh) = registry.composeBody(_idOf(i), C1A1);
            string memory path = string.concat(".", NAMES[i]);
            bytes32 want = vm.parseJsonBytes32(j, string.concat(path, ".questionHash"));
            string memory doc = vm.parseJsonString(j, string.concat(path, ".canonicalDocument"));
            assertEq(qh, want, NAMES[i]);
            assertEq(registry.questionHashOf(bytes(doc)), want, NAMES[i]);
        }
    }

    function test_bodyIsDeterministicInClaimantAndDiffersAcrossClaimants() public view {
        (bytes memory b1, bytes32 h1) = registry.composeBody(701, C1A1);
        (bytes memory b2, bytes32 h2) = registry.composeBody(701, C1A1);
        (, bytes32 h3) = registry.composeBody(701, AC1A1);
        (, bytes32 h4) = registry.composeBody(801, C1A1);
        assertEq(b1, b2);
        assertEq(h1, h2);
        assertTrue(h1 != h3, "claimant bound");
        assertTrue(h1 != h4, "trait bound");
    }

    function test_hexMinAndCatalogWindows() public view {
        Spec memory s = registry.specOf(701);
        assertEq(s.fromBlock, B_H24);
        assertEq(s.toBlock, B_END);
        s = registry.specOf(1105);
        assertEq(s.toBlock, B_FIRST1000);
        s = registry.specOf(1301);
        assertEq(s.fromBlock, B_DEPLOY);
        assertEq(s.toBlock, B_DEPLOY);
        assertEq(s.threshold, 20);
        assertEq(registry.specOf(1201).threshold, 32);
        assertEq(registry.specOf(1104).fixedVal, 19522);
    }

    function test_directAndUnknownIdsHaveNoBody() public {
        vm.expectRevert();
        registry.composeBody(101, C1A1);
        vm.expectRevert();
        registry.composeBody(9999, C1A1);
        vm.expectRevert();
        registry.specOf(20000);
    }

    function test_traitNamesAndClasses() public view {
        assertEq(registry.traitName(101), "Contributor");
        assertEq(registry.traitName(1301), "Not born yesterday");
        assertEq(registry.traitName(t2Id), "Deposited sum");
        assertEq(registry.traitClass(101), 0);
        assertEq(registry.traitClass(701), 1);
        assertEq(registry.traitClass(1301), 2);
        assertEq(registry.traitClass(1201), 3);
        assertEq(registry.traitClass(t2Id), 1);
        assertEq(registry.traitClass(t5Id), 2);
    }
}
