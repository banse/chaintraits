// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {OracleAttestation} from "../src/interfaces/IOracleConsumer.sol";
import {Spec} from "../src/Types.sol";
import {MockCurator, MockIMD, MockIntake} from "./mocks/Mocks.sol";

/// @notice Drives the sponsor pool under a moving Intake price (docs/V2.md items 1, 3, 4, 5, 7): donations,
///         sponsored draws with random `maxPrice`, paid upgrades, verified / missed / failed deliveries through
///         the Intake, abandons and time. Every call that the registry refuses is caught, so the ghosts only
///         record what happened.
contract PoolHandler is Test {
    Registry public registry;
    MockIMD internal imd;
    MockIntake internal intake;
    uint256 internal key;

    address[] internal actors;
    uint16[9] internal chain = [701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105];

    uint256 public ghostDonated;
    uint256 public ghostDrawn;
    uint256 public ghostFees;
    /// @dev A draw the registry accepted although it broke one of item 1's caps.
    uint256 public capViolations;
    /// @dev A draw refused although every documented limit allowed it.
    uint256 public wrongRefusals;
    mapping(address => uint256) public ghostSponsoredVerified;
    mapping(address => mapping(uint16 => bool)) public ghostSponsoredLit;
    mapping(address => mapping(uint64 => uint256)) public drawsOnDay;
    uint256 public maxDrawsOnADay;

    bytes32[] internal open;
    /// @dev Request ids drawn from the pool (the registry keeps that flag internal).
    mapping(bytes32 => bool) public sponsoredId;

    constructor(Registry registry_, MockIMD imd_, MockIntake intake_, MockCurator curator_, uint256 key_) {
        registry = registry_;
        imd = imd_;
        intake = intake_;
        key = key_;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            curator_.set(a, 1, true, 1, 1, 1);
            vm.prank(a);
            imd.approve(address(registry), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _drop(uint256 i) internal {
        open[i] = open[open.length - 1];
        open.pop();
    }

    function setPrice(uint256 p) external {
        intake.setPrice(bound(p, 1, 3 ether));
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 0, 20 ether);
        imd.mint(address(this), amount);
        imd.approve(address(registry), amount);
        registry.sponsor(amount);
        ghostDonated += amount;
    }

    function mintCard(uint256 seed) external {
        address a = _actor(seed);
        if (registry.tokenOf(a) != 0) return;
        imd.mint(a, 0.1 ether);
        vm.prank(a);
        registry.mintCard();
        ghostFees += 0.1 ether;
    }

    function claim(uint256 seed, uint256 which, uint256 maxPrice) external {
        address a = _actor(seed);
        uint16 t = chain[which % 9];
        maxPrice = bound(maxPrice, 0, 3 ether);
        uint256 price = intake.price();
        uint256 poolBefore = registry.pool();
        uint64 day = uint64(block.timestamp / 1 days);
        bool allowed = price <= maxPrice && price <= poolBefore / 8 && price <= 2 ether && !registry.poolUsed(a, t)
            && registry.sponsoredVerified(a) < 9 && registry.lastPoolDay(a) != day && registry.pendingOf(a, t) == 0
            && !registry.hasTrait(a, t);
        vm.prank(a);
        try registry.claimSponsored(t, maxPrice) {
            if (price > maxPrice || price > poolBefore / 8 || price > 2 ether) capViolations++;
            ghostDrawn += price;
            uint256 n = ++drawsOnDay[a][day];
            if (n > maxDrawsOnADay) maxDrawsOnADay = n;
            bytes32 rid = registry.pendingOf(a, t);
            sponsoredId[rid] = true;
            open.push(rid);
        } catch {
            if (allowed) wrongRefusals++;
        }
    }

    function upgradePaid(uint256 seed, uint256 which) external {
        address a = _actor(seed);
        uint16 t = chain[which % 9];
        uint256 price = intake.price();
        imd.mint(a, price);
        uint16[] memory ids = new uint16[](1);
        ids[0] = t;
        vm.prank(a);
        try registry.upgrade(ids, price) {
            open.push(registry.pendingOf(a, t));
        } catch {
            // already pending or verified: return the unspent funding so balances stay comparable
            vm.prank(a);
            imd.transfer(address(0xdead), price);
        }
    }

    function _attestation(bytes32 rid, bool truthful) internal view returns (OracleAttestation memory a) {
        (, uint16 t,, bytes32 qh) = registry.pendingRequest(rid);
        Spec memory s = registry.specOf(t);
        a.requestId = keccak256(abi.encode("uuid", rid));
        a.chainId = 1;
        a.questionHash = qh;
        a.answerType = 3;
        a.answer = abi.encode(truthful ? uint256(1) : uint256(0));
        a.fromBlock = s.fromBlock;
        a.toBlock = s.toBlock;
        a.panelSize = 5;
        a.quorum = 3;
        a.agreed = 3;
        a.issuedAt = uint64(block.timestamp);
        a.expiresAt = uint64(block.timestamp + 30 days);
    }

    /// @param outcome 0 verified, 1 rule false (Missed 8), 2 forged signature (Missed 2), 3 onFailure
    function settle(uint256 seed, uint8 outcome) external {
        if (open.length == 0) return;
        uint256 i = seed % open.length;
        bytes32 rid = open[i];
        _drop(i);
        (address c, uint16 t,,) = registry.pendingRequest(rid);
        if (c == address(0)) return; // abandoned meanwhile
        bool sponsored = sponsoredId[rid];
        outcome %= 4;
        if (outcome == 3) {
            intake.complete(rid, 2, abi.encode(rid, uint8(2), bytes32("disagreed"), uint16(0), uint16(0), bytes("")));
            return;
        }
        OracleAttestation memory a = _attestation(rid, outcome == 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(outcome == 2 ? key + 1 : key, registry.attestationDigest(a));
        intake.complete(rid, 0, abi.encode(rid, a, abi.encodePacked(r, s, v)));
        if (outcome == 0 && sponsored && registry.hasTrait(c, t)) {
            ghostSponsoredVerified[c]++;
            ghostSponsoredLit[c][t] = true;
        }
    }

    function abandon(uint256 seed) external {
        if (open.length == 0) return;
        uint256 i = seed % open.length;
        bytes32 rid = open[i];
        (address c,, uint64 at,) = registry.pendingRequest(rid);
        if (at == 0 || block.timestamp < uint256(at) + 31 days) return;
        _drop(i);
        vm.prank(c);
        registry.abandon(rid);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 40 days));
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    function chainAt(uint256 i) external view returns (uint16) {
        return chain[i];
    }

    function openCount() external view returns (uint256) {
        return open.length;
    }

    function openAt(uint256 i) external view returns (bytes32) {
        return open[i];
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 64
contract PoolInvariantsTest is Base {
    PoolHandler internal h;

    function setUp() public override {
        super.setUp();
        h = new PoolHandler(registry, imd, intake, curator, ATTESTER_KEY);
        bytes4[] memory sel = new bytes4[](8);
        sel[0] = PoolHandler.setPrice.selector;
        sel[1] = PoolHandler.donate.selector;
        sel[2] = PoolHandler.mintCard.selector;
        sel[3] = PoolHandler.claim.selector;
        sel[4] = PoolHandler.upgradePaid.selector;
        sel[5] = PoolHandler.settle.selector;
        sel[6] = PoolHandler.abandon.selector;
        sel[7] = PoolHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
        targetContract(address(h));
    }

    /// @notice The handler reaches the paths the invariants judge: a draw, a verification, a release.
    function test_handlerIsNotVacuous() public {
        h.donate(16 ether);
        h.claim(0, 0, 1 ether);
        assertEq(h.ghostDrawn(), PRICE);
        h.settle(0, 0);
        address a = h.actorAt(0);
        assertEq(registry.sponsoredVerified(a), 1);
        assertEq(h.ghostSponsoredVerified(a), 1);
        h.warp(1 days);
        h.claim(0, 1, 1 ether);
        h.settle(0, 3);
        assertFalse(registry.poolUsed(a, 801));
        assertTrue(registry.poolUsed(a, 701));
        h.setPrice(3 ether);
        h.warp(1 days);
        h.claim(0, 2, 3 ether);
        assertEq(h.ghostDrawn(), 2 * PRICE, "above POOL_DRAW_CAP: refused");
        assertEq(h.wrongRefusals() + h.capViolations(), 0);
        invariant_reservationHeldOnlyByPendingOrVerifiedDraws();
    }

    /// @notice What the registry holds is donations plus mint fees minus every accepted pool draw;
    ///         paid upgrades pass straight through to the Intake.
    function invariant_poolIsDonationsPlusFeesMinusDraws() public view {
        assertEq(imd.balanceOf(address(registry)), h.ghostDonated() + h.ghostFees() - h.ghostDrawn());
    }

    /// @notice Item 1: no accepted draw ever broke `maxPrice`, an eighth of the pool or `POOL_DRAW_CAP`;
    ///         and no draw every documented limit allowed was refused.
    function invariant_everyDrawWithinTheCaps() public view {
        assertEq(h.capViolations(), 0);
        assertEq(h.wrongRefusals(), 0);
    }

    /// @notice Items 3 and 4: one draw per wallet per UTC day; nine verified sponsored traits at most.
    function invariant_dailyAndLifetimeLimits() public view {
        assertLe(h.maxDrawsOnADay(), 1);
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actorAt(i);
            assertLe(registry.sponsoredVerified(a), 9);
            assertEq(registry.sponsoredVerified(a), h.ghostSponsoredVerified(a));
        }
    }

    /// @notice Item 3: a trait reservation is held exactly while a sponsored request for it is pending or
    ///         after a sponsored draw verified it; every other ending gives it back.
    function invariant_reservationHeldOnlyByPendingOrVerifiedDraws() public view {
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actorAt(i);
            for (uint256 j; j < 9; ++j) {
                uint16 t = h.chainAt(j);
                bytes32 rid = registry.pendingOf(a, t);
                bool expected = h.ghostSponsoredLit(a, t) || (rid != 0 && h.sponsoredId(rid));
                assertEq(registry.poolUsed(a, t), expected);
                if (rid != 0) assertFalse(registry.hasTrait(a, t), "pending and verified at once");
            }
        }
    }
}
