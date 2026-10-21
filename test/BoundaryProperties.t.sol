// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SwornTest} from "./Base.t.sol";
import {Composer} from "../src/Composer.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation} from "../src/Types.sol";

contract BoundaryPropertiesTest is SwornTest {
    function test_everyDirectTierAtItsExactThresholdAndOneBelow() public {
        // Literal expected words come from the thirteen bit positions in REBUILD 3.2.
        uint256[3] memory counts = [uint256(3), 5, 10];
        uint32[4] memory countBits = [uint32(0), 0x100, 0x300, 0x700];
        for (uint256 i; i < counts.length; ++i) {
            curator.set(alice, true, 2, counts[i] - 1, 0, 0);
            assertEq(composer.directSnapshot(alice, address(curator)), 1 | countBits[i]);
            curator.set(alice, true, 2, counts[i], 0, 0);
            assertEq(composer.directSnapshot(alice, address(curator)), 1 | countBits[i + 1]);
        }
        uint256[4] memory capital = [uint256(1 ether), 10 ether, 100 ether, 800 ether];
        uint32[5] memory capitalBits = [uint32(0), 0x1000, 0x3000, 0x7000, 0xf000];
        for (uint256 i; i < capital.length; ++i) {
            curator.set(alice, true, 2, 0, capital[i] - 1, 0);
            assertEq(composer.directSnapshot(alice, address(curator)), 1 | capitalBits[i]);
            curator.set(alice, true, 2, 0, capital[i], 0);
            assertEq(composer.directSnapshot(alice, address(curator)), 1 | capitalBits[i + 1]);
        }
        uint256[3] memory points = [uint256(1000), 3162, 10000];
        uint32[4] memory pointBits = [uint32(0), 0x10000, 0x30000, 0x70000];
        for (uint256 i; i < points.length; ++i) {
            curator.set(alice, true, 2, 0, 0, points[i] - 1);
            assertEq(composer.directSnapshot(alice, address(curator)), 1 | pointBits[i]);
            curator.set(alice, true, 2, 0, 0, points[i]);
            assertEq(composer.directSnapshot(alice, address(curator)), 1 | pointBits[i + 1]);
        }
        curator.set(alice, true, 0, 0, 0, 0);
        assertEq(composer.directSnapshot(alice, address(curator)), 0x31);
        curator.set(alice, true, 1, 0, 0, 0);
        assertEq(composer.directSnapshot(alice, address(curator)), 0x11);
        curator.set(alice, true, 2, 0, 0, 0);
        assertEq(composer.directSnapshot(alice, address(curator)), 1);
    }

    function test_directMaximumValuesAndNonmembershipNeverSetReservedBits() public {
        curator.set(alice, true, 0, type(uint256).max, type(uint256).max, type(uint256).max);
        assertEq(composer.directSnapshot(alice, address(curator)), 0x7f731);
        curator.set(alice, false, 0, type(uint256).max, type(uint256).max, type(uint256).max);
        assertEq(composer.directSnapshot(alice, address(curator)), 0);
        curator.set(address(0), true, 0, type(uint256).max, type(uint256).max, type(uint256).max);
        assertEq(composer.directSnapshot(address(0), address(curator)), 0);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_onlyTheThirteenDirectIdsCanReadTheFrozenWord(uint16 id) public {
        uint16[13] memory direct = [uint16(101), 201, 202, 301, 302, 303, 401, 402, 403, 404, 501, 502, 503];
        bool listed;
        for (uint256 i; i < direct.length; ++i) {
            if (direct[i] == id) listed = true;
        }
        curator.set(alice, true, 0, 10, 800 ether, 10000);
        assertEq(registry.hasDirectTrait(alice, id), listed);
        vm.prank(alice);
        registry.mintCard();
        curator.set(alice, false, 0, 0, 0, 0);
        assertEq(registry.hasDirectTrait(alice, id), listed);
        assertEq(registry.hasTrait(alice, id), listed);
        assertFalse(registry.hasDirectTrait(address(0), id));
        assertFalse(registry.hasTrait(address(0), id));
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_communityWindowUsesInclusiveLengthAndExactly64Confirmations(uint64 head, uint8 kind) public {
        uint256 h = bound(head, 7263, type(uint64).max);
        vm.roll(h);
        Spec memory s = _spec(uint8(bound(kind, 1, 4)));
        s.toBlock = uint64(h - 64);
        s.fromBlock = s.toBlock - 7199;
        composer.validateSpec(s, 0);
        ++s.fromBlock;
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        composer.validateSpec(s, type(uint256).max);
        --s.fromBlock;
        ++s.toBlock;
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        composer.validateSpec(s, type(uint256).max);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_panelWindowRequiresExactlyOneBlockAnd7200BlockAge(uint64 head) public {
        uint256 h = bound(head, 7201, type(uint64).max);
        vm.roll(h);
        Spec memory s = _spec(5);
        s.toBlock = uint64(h - 7200);
        s.fromBlock = s.toBlock;
        composer.validateSpec(s, 0);
        --s.fromBlock;
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        composer.validateSpec(s, h);
        s.fromBlock = ++s.toBlock;
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        composer.validateSpec(s, type(uint256).max);
    }

    function test_duplicateNamesAndBoundaryInvalidTypesFailBeforeRegistrationFee() public {
        string[12] memory bad = [
            "event E(address indexed to, uint256 to)",
            "event E(address indexed to, uint0 value)",
            "event E(address indexed to, uint7 value)",
            "event E(address indexed to, uint264 value)",
            "event E(address indexed to, uint08 value)",
            "event E(address indexed to, bytes0 value)",
            "event E(address indexed to, bytes33 value)",
            "event E(address indexed to, uint256[2] value)",
            "event E(address indexed to, uint256[][] value)",
            "event E(address indexed to, uint value)",
            "event E(address indexed to, int value)",
            "event E(address indexed to, bool payable value)"
        ];
        for (uint256 i; i < bad.length; ++i) {
            Spec memory s = _spec(2);
            s.item = bad[i];
            vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "item"));
            vm.prank(alice);
            registry.registerSpec(s, 0);
            assertEq(registry.nextSpecId(), 10001);
            assertEq(token.balanceOf(alice), 100000 ether);
            assertEq(token.balanceOf(address(executor)), 0);
        }
    }

    function test_sameWalletDifferentLivingWindowsCannotExchangeEvidence() public {
        bytes32 first = _ask(alice, 601);
        OracleAttestation memory a = _att(first, abi.encode(true));
        assertFalse(intake.complete(first, 0, hex"00"));
        vm.prank(alice);
        registry.abandon(first);
        vm.roll(block.number + 1);
        bytes32 second = _ask(alice, 601);
        _miss(second, a, 6);
        assertFalse(registry.hasTrait(alice, 601));
        assertEq(registry.pendingOf(alice, 601), bytes32(0));
        bytes32 third = _ask(alice, 601);
        a = _att(third, abi.encode(true));
        vm.roll(block.number + 10000);
        assertTrue(_deliver(third, a));
        (bytes32 requestId,, uint64 from, uint64 to) = registry.verified(alice, 601);
        assertEq(requestId, third);
        assertEq(from, a.fromBlock);
        assertEq(to, a.toBlock);
    }

    function test_sharedLateFailureAndLateResultCannotClearReplacement() public {
        bytes32 first = _shared(1201);
        OracleAttestation memory stale = _att(first, abi.encode(_list(32)));
        vm.warp(block.timestamp + 31 days + 1);
        registry.abandon(first);
        bytes32 second = _shared(1201);
        assertTrue(
            intake.raw(
                address(registry), abi.encodeCall(Registry.onFailure, (first, 2, bytes32("disagreed"), 1, 5, bytes("")))
            )
        );
        assertTrue(intake.complete(first, 0, abi.encode(first, stale, _sign(stale))));
        assertEq(registry.sharedPending(1201), second);
        (bytes32 stored,,) = registry.sharedFact(1201);
        assertEq(stored, bytes32(0));
        OracleAttestation memory current = _att(second, abi.encode(_list(32)));
        assertTrue(_deliver(second, current));
        (stored,,) = registry.sharedFact(1201);
        assertEq(stored, second);
    }
}
