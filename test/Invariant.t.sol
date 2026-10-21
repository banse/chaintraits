// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {MockIMD, MockCurator, MockIntake} from "./Mocks.sol";
import {OracleAttestation} from "../src/interfaces/Types.sol";

contract WalletHandler is Test {
    Registry public registry;
    MockIMD public imd;
    MockCurator public curator;
    MockIntake public intake;
    address[3] public actors = [address(0xc1a1), address(0xc1a2), address(0xc1a3)];
    uint256 public minted;
    uint256 public requests;
    uint256 public key;

    constructor(Registry r, MockIMD t, MockCurator c, MockIntake i, uint256 signingKey) {
        registry = r;
        imd = t;
        curator = c;
        intake = i;
        key = signingKey;
        for (uint256 j; j < 3; ++j) {
            t.mint(actors[j], 100000 ether);
            vm.prank(actors[j]);
            t.approve(address(r), type(uint256).max);
            c.set(actors[j], 0, true, 10, 800 ether, 10000);
        }
    }

    function mint(uint256 seed) external {
        address a = actors[seed % 3];
        if (registry.tokenOf(a) != 0) return;
        vm.prank(a);
        registry.mintCard();
        ++minted;
    }

    function transfer(uint256 seed, uint256 buyer) external {
        address a = actors[seed % 3];
        uint256 id = registry.tokenOf(a);
        if (id == 0) return;
        address holder = registry.ownerOf(id);
        vm.prank(holder);
        registry.transferFrom(holder, actors[buyer % 3], id);
    }

    function ask(uint256 seed) external {
        address a = actors[seed % 3];
        if (registry.hasTrait(a, 701) || registry.pendingOf(a, 701) != 0) return;
        uint16[] memory ids = new uint16[](1);
        ids[0] = 701;
        vm.prank(a);
        registry.upgrade(ids, 0.5 ether);
        ++requests;
    }

    function answer(uint256 seed, bool truth) external {
        address a = actors[seed % 3];
        bytes32 rid = registry.pendingOf(a, 701);
        if (rid == 0) return;
        (,, uint64 requested, bytes32 qh) = registry.pendingRequest(rid);
        OracleAttestation memory att;
        att.requestId = keccak256(abi.encode(rid));
        att.chainId = 1;
        att.questionHash = qh;
        att.answerType = 3;
        att.answer = abi.encode(truth ? uint256(1) : uint256(0));
        att.fromBlock = 25777045;
        att.toBlock = 25789604;
        att.panelSize = 5;
        att.quorum = 3;
        att.agreed = 3;
        att.issuedAt = requested;
        att.expiresAt = requested + 30 days;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.attestationDigest(att));
        require(intake.complete(rid, 0, 0, "", abi.encode(rid, att, abi.encodePacked(r, s, v))), "delivery");
    }

    function failure(uint256 seed) external {
        bytes32 rid = registry.pendingOf(actors[seed % 3], 701);
        if (rid == 0) return;
        require(
            intake.complete(
                rid, 1, 0, "", abi.encode(rid, uint8(1), bytes32("body_invalid"), uint16(0), uint16(0), "")
            ),
            "failure"
        );
    }
}

contract InvariantsTest is BaseTest {
    WalletHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new WalletHandler(registry, imd, curator, intake, SIGNING_KEY);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.mint.selector;
        selectors[1] = handler.transfer.selector;
        selectors[2] = handler.ask.selector;
        selectors[3] = handler.answer.selector;
        selectors[4] = handler.failure.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_feesAndRequestPricesConservedWithoutRegistryBalance() public view {
        assertEq(imd.balanceOf(address(registry)), 0);
        assertEq(imd.balanceOf(address(sink)), handler.minted() * 0.1 ether);
        assertEq(imd.balanceOf(address(intake)), handler.requests() * 0.5 ether);
        assertEq(imd.allowance(address(registry), address(intake)), 0);
    }

    function invariant_claimantSnapshotAndSupply() public view {
        uint256 count;
        for (uint256 i; i < 3; ++i) {
            address a = handler.actors(i);
            uint256 id = registry.tokenOf(a);
            if (id != 0) {
                ++count;
                assertEq(registry.claimantOf(id), a);
                assertEq(registry.frozenDirect(id), 0x7f731);
                assertTrue(registry.hasTrait(a, 202));
            }
            assertFalse(registry.hasTrait(address(0), 101));
            if (registry.hasTrait(a, 701)) assertEq(registry.pendingOf(a, 701), bytes32(0));
        }
        assertEq(registry.totalSupply(), count);
        assertEq(address(registry).balance, 0);
    }
}
