// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {SwornTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {OracleAttestation} from "../src/Types.sol";
import {MockIntake} from "./mocks/Mocks.sol";

contract RegistryHandler is Test {
    Registry internal registry;
    MockIntake internal intake;
    address[2] internal actors;
    uint256 internal key;
    mapping(address => bool) public earned;
    mapping(address => bytes32) public asks;
    uint256 public minted;

    constructor(Registry r, MockIntake i, address a, address b, uint256 k) {
        registry = r;
        intake = i;
        actors = [a, b];
        key = k;
    }

    function mint(uint8 actor) external {
        address who = actors[actor % 2];
        if (registry.tokenOf(who) != 0) return;
        vm.prank(who);
        registry.mintCard();
        ++minted;
    }

    function transfer(uint8 actor) external {
        address who = actors[actor % 2];
        uint256 token = registry.tokenOf(who);
        if (token == 0) return;
        address owner = registry.ownerOf(token);
        address to = actors[(actor + uint256(1)) % 2];
        vm.prank(owner);
        registry.transferFrom(owner, to, token);
    }

    function ask(uint8 actor) external {
        address who = actors[actor % 2];
        if (registry.hasTrait(who, 701) || registry.pendingOf(who, 701) != 0) return;
        uint16[] memory ids = new uint16[](1);
        ids[0] = 701;
        vm.prank(who);
        registry.upgrade(ids, 0.5 ether);
        asks[who] = registry.pendingOf(who, 701);
    }

    function answer(uint8 actor, bool yes, bool failure) external {
        address who = actors[actor % 2];
        bytes32 r = registry.pendingOf(who, 701);
        if (r == 0) return;
        (,,, bool completed) = intake.requests(r);
        if (completed) return;
        if (failure) {
            require(
                intake.complete(r, 2, abi.encode(r, uint8(2), bytes32("disagreed"), uint16(1), uint16(5), bytes("")))
            );
            return;
        }
        (,, uint64 requested, bytes32 hash) = registry.pendingRequest(r);
        OracleAttestation memory a;
        a.requestId = keccak256(abi.encode(r));
        a.chainId = 1;
        a.questionHash = hash;
        a.answerType = 3;
        a.answer = abi.encode(yes ? uint256(1) : uint256(0));
        a.fromBlock = 25777045;
        a.toBlock = 25789604;
        a.panelSize = 5;
        a.quorum = 3;
        a.agreed = 3;
        a.issuedAt = requested;
        a.expiresAt = requested + 30 days;
        (uint8 v, bytes32 sr, bytes32 ss) = vm.sign(key, registry.attestationDigest(a));
        require(intake.complete(r, 0, abi.encode(r, a, abi.encodePacked(sr, ss, v))));
        if (yes && block.timestamp <= a.expiresAt) earned[who] = true;
    }

    function abandon(uint8 actor) external {
        address who = actors[actor % 2];
        bytes32 r = registry.pendingOf(who, 701);
        if (r == 0) return;
        (,, uint64 requested,) = registry.pendingRequest(r);
        if (block.timestamp <= uint256(requested) + 31 days) vm.warp(uint256(requested) + 31 days + 1);
        vm.prank(who);
        registry.abandon(r);
    }
}

contract InvariantsTest is SwornTest {
    RegistryHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new RegistryHandler(registry, intake, alice, bob, SIGNER_KEY);
        targetContract(address(handler));
    }

    function invariant_cardsStayWithOriginalClaimantsAndSupplyConserved() public view {
        assertEq(registry.totalSupply(), handler.minted());
        address[2] memory actors = [alice, bob];
        uint256 count;
        for (uint256 i; i < 2; ++i) {
            uint256 tokenId = registry.tokenOf(actors[i]);
            if (tokenId != 0) {
                assertEq(registry.claimantOf(tokenId), actors[i]);
                ++count;
            }
        }
        assertEq(count, registry.totalSupply());
        assertEq(registry.balanceOf(alice) + registry.balanceOf(bob), count);
    }

    function invariant_onlyVerifiedEvidenceCreatesFactsAndFeesLeaveRegistry() public view {
        assertEq(registry.hasTrait(alice, 701), handler.earned(alice));
        assertEq(registry.hasTrait(bob, 701), handler.earned(bob));
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(token.allowance(address(registry), address(intake)), 0);
        assertEq(token.balanceOf(address(executor)), handler.minted() * registry.MINT_FEE());
    }
}
