// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {Registry} from "../src/Registry.sol";
import {Composer} from "../src/Composer.sol";
import {Renderer} from "../src/Renderer.sol";
import {Spec, OracleAttestation} from "../src/interfaces/Types.sol";
import {MockIMD, MockCurator, MockIntake, FeeSink} from "./Mocks.sol";

abstract contract BaseTest is Test {
    Registry internal registry;
    Composer internal composer;
    Renderer internal renderer;
    MockIMD internal imd;
    MockCurator internal curator;
    MockIntake internal intake;
    FeeSink internal sink;
    address internal constant ALICE = address(0xc1a1);
    address internal constant BOB = address(0xc1a2);
    uint256 internal constant SIGNING_KEY = 0x123456;

    function setUp() public virtual {
        vm.chainId(1);
        vm.roll(26237718);
        vm.warp(1792584000);
        composer = new Composer();
        renderer = new Renderer();
        curator = new MockCurator();
        imd = new MockIMD();
        intake = new MockIntake();
        sink = new FeeSink();
        registry = new Registry(
            address(curator),
            address(imd),
            address(intake),
            vm.addr(SIGNING_KEY),
            address(renderer),
            address(composer),
            address(sink)
        );
        fund(ALICE);
        fund(BOB);
        fund(address(this));
    }

    function fund(address a) internal {
        imd.mint(a, 10000 ether);
        vm.prank(a);
        imd.approve(address(registry), type(uint256).max);
    }

    function one(uint16 id) internal pure returns (uint16[] memory a) {
        a = new uint16[](1);
        a[0] = id;
    }

    function ask(address a, uint16 id) internal returns (bytes32 rid) {
        vm.prank(a);
        registry.upgrade(one(id), 0.5 ether);
        return registry.pendingOf(a, id);
    }

    function shared(uint16 id) internal returns (bytes32 rid) {
        registry.requestSharedFact(id, 0.5 ether);
        return registry.sharedPending(id);
    }

    function attestation(bytes32 rid, bytes memory answer) internal view returns (OracleAttestation memory a) {
        (address claimant, uint16 id, uint64 requested, bytes32 hash) = registry.pendingRequest(rid);
        Spec memory s = registry.specOf(id);
        a.requestId = keccak256(abi.encode(rid, "oracle"));
        a.chainId = 1;
        a.questionHash = hash;
        a.answerType = s.kind <= 2 ? 3 : s.kind == 3 ? 4 : 0;
        a.answer = answer;
        a.fromBlock = s.fromBlock;
        a.toBlock = s.kind == 6 ? uint64(vm.getBlockNumber() - 64) : s.toBlock;
        a.panelSize = s.kind == 3 || s.kind >= 5 ? 11 : 5;
        a.quorum = s.kind == 3 || s.kind >= 5 ? 7 : 3;
        a.agreed = a.quorum;
        a.issuedAt = requested;
        a.expiresAt = requested + 30 days;
        claimant;
    }

    function sign(OracleAttestation memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNING_KEY, registry.attestationDigest(a));
        return abi.encodePacked(r, s, v);
    }

    function deliver(bytes32 rid, OracleAttestation memory a) internal returns (bool) {
        return deliverSig(rid, a, sign(a));
    }

    function deliverSig(bytes32 rid, OracleAttestation memory a, bytes memory sig) internal returns (bool) {
        return intake.complete(rid, 0, bytes32(0), "", abi.encode(rid, a, sig));
    }

    function spec(uint8 kind) internal view returns (Spec memory s) {
        s.kind = kind;
        s.target = kind == 5 ? address(0) : address(curator);
        s.name = "Community fact";
        s.item = composer.DEPOSITED();
        s.arg = "contributor";
        s.threshold = 1;
        s.fromBlock = 25769870;
        s.toBlock = 25789604;
        if (kind == 2 || kind == 3) s.sumArg = "weightAdded";
        if (kind == 3) s.threshold = 32;
        if (kind >= 4) {
            s.arg = "";
            s.item = kind == 4 ? "function pointsOf(address) view returns (uint256)" : "";
        }
        if (kind == 4) s.op = 1;
        if (kind == 5) {
            s.fromBlock = s.toBlock;
            s.threshold = 20;
        }
    }

    function register(uint8 kind) internal returns (uint16) {
        return registry.registerSpec(spec(kind), 0);
    }

    function miss(bytes32 rid, OracleAttestation memory a, bytes memory sig, uint8 reason) internal {
        (, uint16 id,,) = registry.pendingRequest(rid);
        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.Missed(rid, id, reason);
        assertTrue(deliverSig(rid, a, sig));
    }
}
