// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation} from "../src/Types.sol";
import {MockIMD, MockIntake, MockCurator} from "./mocks/Mocks.sol";

/// @dev The model records successful user actions and the verdicts the harness sends, never infers
/// whether a fact ought to exist from hasTrait. All expected failures are checked; unexpected ones
/// reach the invariant runner with fail_on_revert enabled.
contract LifecycleHandler is Test {
    struct RequestModel {
        bytes32 id;
        address claimant;
        uint16 traitId;
        uint64 at;
        uint64 from;
        uint64 to;
        bytes32 questionHash;
        bool closed;
        bool completed;
        bool accepted;
    }

    Registry internal registry;
    MockIMD internal token;
    MockIntake internal intake;
    MockCurator internal curator;
    address internal executor;
    uint256 internal signerKey;
    address[3] internal actors;
    uint16[] internal personalIds;
    uint16[] internal sharedIds;
    uint16[] internal communityIds;
    mapping(uint16 => Spec) internal specs;
    mapping(uint16 => bytes32) internal specHashes;
    RequestModel[] internal history;
    mapping(address => mapping(uint16 => uint256)) internal latest;
    mapping(address => mapping(uint16 => uint256)) internal evidence;
    mapping(uint16 => uint256) internal storedFact;
    mapping(address => uint16[]) internal verificationOrder;
    mapping(address => uint256) internal spent;
    mapping(address => uint256) internal originalCard;
    mapping(uint256 => address) internal holders;
    mapping(uint256 => uint32) internal snapshots;
    mapping(uint256 => uint64) internal mintBlocks;
    uint256 internal initialExecutorBalance;
    uint256 internal initialIntakeBalance;
    uint256 internal forwardedFees;
    uint256 internal oraclePayments;
    uint256 internal minted;
    uint256 internal registrations;
    uint256 public acceptedVerdicts;
    uint256 public failedDeliveries;
    uint256 public rejectedCalls;

    constructor(Registry r, MockIMD t, MockIntake i, MockCurator c, address e, address[3] memory people, uint256 key) {
        registry = r;
        token = t;
        intake = i;
        curator = c;
        executor = e;
        actors = people;
        signerKey = key;
        initialExecutorBalance = t.balanceOf(e);
        initialIntakeBalance = t.balanceOf(address(i));
        _remember(701);
        _remember(1301);
        _remember(601);
        _remember(1201);
        for (uint16 id = 10001; id <= 10005; ++id) {
            _remember(id);
        }
    }

    function _remember(uint16 id) private {
        Spec memory s = registry.specOf(id);
        specs[id] = s;
        if (s.kind == 3) sharedIds.push(id);
        else personalIds.push(id);
        if (id >= 10001) {
            communityIds.push(id);
            specHashes[id] = keccak256(abi.encode(s));
        }
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _ids(uint16 id) private pure returns (uint16[] memory ids) {
        ids = new uint16[](1);
        ids[0] = id;
    }

    function mint(uint8 actorSeed) external {
        address who = _actor(actorSeed);
        vm.prank(who);
        if (originalCard[who] != 0) {
            vm.expectRevert(abi.encodeWithSelector(Registry.AlreadyMinted.selector, who));
            registry.mintCard();
            ++rejectedCalls;
            return;
        }
        uint256 id = registry.mintCard();
        assertEq(id, ++minted);
        originalCard[who] = id;
        holders[id] = who;
        snapshots[id] = registry.frozenDirect(id);
        mintBlocks[id] = uint64(block.number);
        spent[who] += 0.1 ether;
        forwardedFees += 0.1 ether;
    }

    function transfer(uint8 tokenSeed, uint8 recipientSeed, bool approved) external {
        if (minted == 0) return;
        uint256 id = 1 + uint256(tokenSeed) % minted;
        address from = holders[id];
        address to = _actor(recipientSeed);
        if (approved) {
            vm.prank(from);
            registry.approve(address(this), id);
            registry.transferFrom(from, to, id);
        } else {
            vm.prank(from);
            registry.transferFrom(from, to, id);
        }
        holders[id] = to;
        assertEq(registry.getApproved(id), address(0));
    }

    function changeLiveCurator(uint8 actorSeed, bool member, uint8 tier) external {
        address who = _actor(actorSeed);
        uint256 level = tier % 4;
        curator.set(who, member, level, level * 5, level * 400 ether, level * 5000);
    }

    function register(uint8 actorSeed, uint8 kindSeed, uint96 thresholdSeed) external {
        // Keep per-step invariant work bounded while still interleaving registration and callbacks.
        if (registrations >= 8) return;
        address who = _actor(actorSeed);
        uint8 kind = uint8(bound(kindSeed, 1, 5));
        Spec memory s = specs[uint16(10000 + kind)];
        s.threshold = kind == 3 ? bound(thresholdSeed, 1, 32) : bound(thresholdSeed, 1, type(uint96).max);
        uint16 expectedId = uint16(10006 + registrations);
        vm.prank(who);
        uint16 id = registry.registerSpec(s, expectedId);
        assertEq(id, expectedId);
        assertEq(keccak256(abi.encode(registry.specOf(id))), keccak256(abi.encode(s)));
        _remember(id);
        ++registrations;
        spent[who] += 6.4 ether;
        forwardedFees += 6.4 ether;
    }

    function ask(uint8 actorSeed, uint8 traitSeed, uint96 priceSeed, bool shared, bool capTooLow) external {
        address payer = _actor(actorSeed);
        address claimant = shared ? address(0) : payer;
        uint16 id = shared ? sharedIds[traitSeed % sharedIds.length] : personalIds[traitSeed % personalIds.length];
        uint256 price = bound(priceSeed, 1, 2 ether);
        intake.setPrice(price);
        uint256 previous = latest[claimant][id];
        bytes memory expectedError;
        if (shared && storedFact[id] != 0) {
            expectedError = abi.encodeWithSelector(Registry.FactAlreadyStored.selector, id);
        } else if (!shared && evidence[payer][id] != 0) {
            expectedError = abi.encodeWithSelector(Registry.AlreadyVerified.selector, payer, id);
        } else if (previous != 0 && !history[previous - 1].closed) {
            expectedError = abi.encodeWithSelector(Registry.AlreadyPending.selector, claimant, id);
        } else if (capTooLow) {
            expectedError = abi.encodeWithSelector(Registry.PriceAboveMax.selector, price, price - 1);
        }
        if (expectedError.length != 0) {
            vm.expectRevert(expectedError);
            vm.prank(payer);
            if (shared) registry.requestSharedFact(id, capTooLow ? price - 1 : price);
            else registry.upgrade(_ids(id), capTooLow ? price - 1 : price);
            ++rejectedCalls;
            return;
        }
        (, bytes32 hash) = registry.composeBody(id, claimant);
        vm.prank(payer);
        if (shared) registry.requestSharedFact(id, price);
        else registry.upgrade(_ids(id), price);
        bytes32 r = shared ? registry.sharedPending(id) : registry.pendingOf(payer, id);
        assertTrue(r != bytes32(0));
        history.push(
            RequestModel({
                id: r,
                claimant: claimant,
                traitId: id,
                at: uint64(block.timestamp),
                from: specs[id].fromBlock,
                to: specs[id].kind == 6 ? uint64(block.number - 64) : specs[id].toBlock,
                questionHash: hash,
                closed: false,
                completed: false,
                accepted: false
            })
        );
        latest[claimant][id] = history.length;
        spent[payer] += price;
        oraclePayments += price;
    }

    function _list(uint16 id) private view returns (address[] memory list) {
        uint256 length = specs[id].threshold;
        list = new address[](length);
        // The same valid public answer is used for delivery and application, including head=1.
        for (uint256 j; j < length; ++j) {
            list[j] = j < actors.length ? actors[j] : address(uint160(2 ** 100 + j));
        }
    }

    function _att(RequestModel storage r, bool yes) private view returns (OracleAttestation memory a) {
        Spec storage s = specs[r.traitId];
        a.requestId = keccak256(abi.encode("lifecycle evidence", r.id));
        a.chainId = 1;
        a.questionHash = r.questionHash;
        a.answerType = s.kind <= 2 ? 3 : s.kind == 3 ? 4 : 0;
        if (s.kind == 3) a.answer = yes ? abi.encode(_list(r.traitId)) : abi.encode(new address[](0));
        else a.answer = abi.encode(yes ? (s.kind <= 2 ? s.threshold : 1) : 0);
        a.fromBlock = r.from;
        a.toBlock = r.to;
        a.panelSize = s.kind == 3 || s.kind >= 5 ? 11 : 5;
        a.quorum = a.panelSize == 11 ? 7 : 3;
        a.agreed = a.quorum;
        a.issuedAt = r.at;
        a.expiresAt = r.at + 30 days;
    }

    function _sign(OracleAttestation memory a) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, registry.attestationDigest(a));
        return abi.encodePacked(r, s, v);
    }

    function _earn(address who, uint16 id, uint256 requestIndex) private {
        assertEq(evidence[who][id], 0, "a credential can be earned only once");
        evidence[who][id] = requestIndex + 1;
        if (id >= 10001) verificationOrder[who].push(id);
    }

    function _accept(uint256 index) private {
        RequestModel storage r = history[index];
        r.accepted = true;
        if (r.claimant == address(0)) storedFact[r.traitId] = index + 1;
        else _earn(r.claimant, r.traitId, index);
        ++acceptedVerdicts;
    }

    function deliver(uint256 requestSeed, uint8 outcomeSeed) external {
        if (history.length == 0) return;
        uint256 index = requestSeed % history.length;
        RequestModel storage r = history[index];
        if (r.completed) return;
        uint256 outcome = outcomeSeed % 5;
        OracleAttestation memory a = _att(r, outcome != 1);
        bytes memory args;
        if (outcome == 2) {
            args = abi.encode(r.id, uint8(2), bytes32("disagreed"), uint16(1), uint16(5), bytes(""));
        } else if (outcome == 4) {
            // ABI decoding fails before entering Registry. Intake still marks completion.
            args = hex"00";
        } else {
            bytes memory signature = outcome == 3 ? new bytes(65) : _sign(a);
            args = abi.encode(r.id, a, signature);
        }
        vm.cool(address(registry));
        vm.startStateDiffRecording();
        bool delivered = intake.complete(r.id, outcome == 2 ? 2 : 0, args);
        _checkCallbackWrites(vm.stopAndReturnStateDiff());
        r.completed = true;
        assertEq(delivered, outcome != 4);
        if (!delivered) {
            ++failedDeliveries;
            return;
        }
        assertLt(intake.lastGas(), 175000);
        if (!r.closed) {
            r.closed = true;
            if (outcome == 0 && block.timestamp <= a.expiresAt) _accept(index);
        }
    }

    function _checkCallbackWrites(Vm.AccountAccess[] memory accesses) private view {
        uint256 writes;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory s = accesses[i].storageAccesses[j];
                if (s.account == address(registry) && s.isWrite && !s.reverted) {
                    assertTrue(s.previousValue != bytes32(0), "callback encountered an unprepared slot");
                    ++writes;
                }
            }
        }
        assertLe(intake.lastGas() + 7200 * writes, 175000, "callback must keep its modeled gas margin");
    }

    function settle(uint256 requestSeed, bool yes) external {
        if (history.length == 0) return;
        uint256 index = requestSeed % history.length;
        RequestModel storage r = history[index];
        OracleAttestation memory a = _att(r, yes);
        bytes memory signature = _sign(a);
        uint8 reason =
            !r.completed ? 11 : block.timestamp > a.expiresAt ? 7 : !yes ? (r.claimant == address(0) ? 9 : 8) : 0;
        if (r.closed) vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, r.id));
        else if (reason != 0) vm.expectRevert(abi.encodeWithSelector(Registry.NotSettleable.selector, r.id, reason));
        registry.settle(r.id, a, signature);
        if (r.closed || reason != 0) {
            ++rejectedCalls;
            return;
        }
        r.closed = true;
        _accept(index);
    }

    function abandon(uint256 requestSeed, uint8 actorSeed) external {
        if (history.length == 0) return;
        RequestModel storage r = history[requestSeed % history.length];
        address caller = _actor(actorSeed);
        bool wrongCaller = r.claimant != address(0) && caller != r.claimant;
        bool early = block.timestamp <= uint256(r.at) + 31 days && (r.claimant == address(0) || !r.completed);
        if (r.closed) vm.expectRevert(abi.encodeWithSelector(Registry.NotPending.selector, r.id));
        else if (wrongCaller) vm.expectRevert(Registry.NotClaimant.selector);
        else if (early) vm.expectRevert(Registry.TooEarly.selector);
        vm.prank(caller);
        registry.abandon(r.id);
        if (r.closed || wrongCaller || early) ++rejectedCalls;
        else r.closed = true;
    }

    function applyFact(uint8 actorSeed, uint8 traitSeed, bool wrongList) external {
        address who = _actor(actorSeed);
        uint16 id = sharedIds[traitSeed % sharedIds.length];
        address[] memory list = _list(id);
        bool included;
        for (uint256 j; j < list.length; ++j) {
            if (list[j] == who) included = true;
        }
        if (wrongList) list[0] = address(uint160(2 ** 100 + 500));
        bytes memory failure;
        if (storedFact[id] == 0) failure = abi.encodeWithSelector(Registry.FactNotStored.selector, id);
        else if (wrongList) failure = abi.encodeWithSelector(Registry.ListMismatch.selector);
        else if (!included) failure = abi.encodeWithSelector(Registry.NotInList.selector);
        else if (evidence[who][id] != 0) failure = abi.encodeWithSelector(Registry.AlreadyVerified.selector, who, id);
        if (failure.length != 0) vm.expectRevert(failure);
        vm.prank(who);
        registry.applySharedFact(id, list);
        if (failure.length != 0) ++rejectedCalls;
        else _earn(who, id, storedFact[id] - 1);
    }

    function elapse(uint32 secondsSeed, uint16 blocksSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 33 days));
        vm.roll(block.number + bound(blocksSeed, 1, 50000));
    }

    function assertAccounting() external view {
        assertEq(registry.totalSupply(), minted);
        assertEq(registry.nextSpecId(), 10006 + registrations);
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        assertEq(token.balanceOf(executor), initialExecutorBalance + forwardedFees);
        assertEq(token.balanceOf(address(intake)), initialIntakeBalance + oraclePayments);
        uint256 totalSpent;
        uint256 totalCards;
        for (uint256 i; i < actors.length; ++i) {
            address who = actors[i];
            totalSpent += spent[who];
            assertEq(token.balanceOf(who) + spent[who], 100000 ether);
            assertEq(registry.tokenOf(who), originalCard[who]);
            uint256 owned;
            for (uint256 id = 1; id <= minted; ++id) {
                if (holders[id] == who) ++owned;
            }
            assertEq(registry.balanceOf(who), owned);
            totalCards += owned;
            uint256 card = originalCard[who];
            if (card != 0) {
                assertEq(registry.claimantOf(card), who);
                assertEq(registry.ownerOf(card), holders[card]);
                assertEq(registry.frozenDirect(card), snapshots[card]);
                assertEq(registry.mintedAtBlock(card), mintBlocks[card]);
            }
        }
        assertEq(totalCards, minted);
        assertEq(totalSpent, forwardedFees + oraclePayments);
    }

    function _assertEvidence(address who, uint16 id) private view {
        uint256 index = evidence[who][id];
        assertEq(registry.hasTrait(who, id), index != 0);
        (bytes32 requestId, bytes32 oracleId, uint64 from, uint64 to) = registry.verified(who, id);
        if (index == 0) {
            assertEq(requestId, bytes32(0));
            assertEq(oracleId, bytes32(0));
            assertEq(from, 0);
            assertEq(to, 0);
        } else {
            RequestModel storage r = history[index - 1];
            assertEq(requestId, r.id);
            assertEq(oracleId, keccak256(abi.encode("lifecycle evidence", r.id)));
            assertEq(from, r.from);
            assertEq(to, r.to);
        }
    }

    function assertLifecycle() external view {
        for (uint256 i; i < actors.length; ++i) {
            address who = actors[i];
            for (uint256 j; j < personalIds.length; ++j) {
                uint16 id = personalIds[j];
                _assertEvidence(who, id);
                uint256 index = latest[who][id];
                bytes32 pending = index != 0 && !history[index - 1].closed ? history[index - 1].id : bytes32(0);
                assertEq(registry.pendingOf(who, id), pending);
            }
            for (uint256 j; j < sharedIds.length; ++j) {
                _assertEvidence(who, sharedIds[j]);
            }
            uint16[] memory got = registry.verifiedSpecsOf(who);
            assertEq(got.length, verificationOrder[who].length);
            for (uint256 j; j < got.length; ++j) {
                assertEq(got[j], verificationOrder[who][j]);
            }
        }
        for (uint256 j; j < sharedIds.length; ++j) {
            uint16 id = sharedIds[j];
            uint256 index = latest[address(0)][id];
            bytes32 pending = index != 0 && !history[index - 1].closed ? history[index - 1].id : bytes32(0);
            assertEq(registry.sharedPending(id), pending);
            (bytes32 r, bytes32 hash, uint16 length) = registry.sharedFact(id);
            index = storedFact[id];
            assertEq(r, index == 0 ? bytes32(0) : history[index - 1].id);
            assertEq(hash, index == 0 ? bytes32(0) : keccak256(abi.encode(_list(id))));
            assertEq(length, index == 0 ? 0 : specs[id].threshold);
        }
        for (uint256 j; j < history.length; ++j) {
            RequestModel storage r = history[j];
            (address who, uint16 id, uint64 at, bytes32 hash) = registry.pendingRequest(r.id);
            assertEq(who, r.closed ? address(0) : r.claimant);
            assertEq(id, r.closed ? 0 : r.traitId);
            assertEq(at, r.closed ? 0 : r.at);
            assertEq(hash, r.closed ? bytes32(0) : r.questionHash);
            (,,, bool done) = intake.requests(r.id);
            assertEq(done, r.completed);
        }
        for (uint256 j; j < communityIds.length; ++j) {
            uint16 id = communityIds[j];
            assertEq(keccak256(abi.encode(registry.specOf(id))), specHashes[id]);
        }
    }
}

contract LifecycleInvariantsTest is SwornTest {
    LifecycleHandler internal lifecycle;

    function setUp() public override {
        super.setUp();
        address third = makeAddr("lifecycle third claimant");
        _fund(third);
        for (uint8 kind = 1; kind <= 5; ++kind) {
            _register(kind);
        }
        lifecycle =
            new LifecycleHandler(registry, token, intake, curator, address(executor), [alice, bob, third], SIGNER_KEY);
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = LifecycleHandler.mint.selector;
        selectors[1] = LifecycleHandler.transfer.selector;
        selectors[2] = LifecycleHandler.changeLiveCurator.selector;
        selectors[3] = LifecycleHandler.register.selector;
        selectors[4] = LifecycleHandler.ask.selector;
        selectors[5] = LifecycleHandler.deliver.selector;
        selectors[6] = LifecycleHandler.settle.selector;
        selectors[7] = LifecycleHandler.abandon.selector;
        selectors[8] = LifecycleHandler.applyFact.selector;
        selectors[9] = LifecycleHandler.elapse.selector;
        selectors[10] = LifecycleHandler.ask.selector;
        targetContract(address(lifecycle));
        targetSelector(FuzzSelector(address(lifecycle), selectors));
        // Start from reachable, nonempty states: concurrent personal asks and a stored shared fact.
        lifecycle.mint(0);
        lifecycle.ask(0, 3, 0.5 ether, false, false);
        lifecycle.ask(0, 4, 0.5 ether, false, false);
        lifecycle.ask(1, 1, 0.5 ether, true, false);
        lifecycle.deliver(2, 0);
        lifecycle.applyFact(1, 1, false);
        lifecycle.deliver(0, 4);
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 96
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_paymentsAndCardSupplyAreConserved() public view {
        lifecycle.assertAccounting();
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 96
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_onlyAcceptedEvidenceIsPermanentAndPendingIndexesAgree() public view {
        lifecycle.assertLifecycle();
    }

    function test_handlerExercisesRecoveryConcurrentOrderAndFinancialFailures() public {
        lifecycle.assertAccounting();
        lifecycle.assertLifecycle();
        lifecycle.settle(0, false);
        lifecycle.settle(0, true);
        lifecycle.deliver(1, 1);
        lifecycle.ask(0, 4, 1, false, false);
        lifecycle.deliver(3, 0);
        lifecycle.transfer(0, 1, true);
        lifecycle.mint(1);
        lifecycle.mint(0);
        lifecycle.ask(0, 0, 1 ether, false, true);
        lifecycle.applyFact(1, 1, false);
        lifecycle.register(2, 2, 100);
        lifecycle.elapse(32 days, 1000);
        lifecycle.ask(2, 2, 1 ether, false, false);
        lifecycle.elapse(32 days, 1000);
        lifecycle.abandon(4, 2);
        lifecycle.deliver(4, 0);
        lifecycle.assertAccounting();
        lifecycle.assertLifecycle();
        assertGe(lifecycle.acceptedVerdicts(), 3);
        assertGe(lifecycle.failedDeliveries(), 1);
        assertGe(lifecycle.rejectedCalls(), 4);
    }
}
