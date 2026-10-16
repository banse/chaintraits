// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Composer} from "../src/Composer.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Spec} from "../src/Types.sol";
import {OracleAttestation} from "../src/interfaces/IOracleConsumer.sol";
import {MockCurator, MockIDMD, MockIMD, MockIntake} from "./mocks/Mocks.sol";

/// @notice Mainnet evidence remains mainnet evidence when the consumer and direct reads are on Sepolia.
contract SepoliaRehearsalTest is Base {
    address internal constant SEPOLIA_CURATOR = 0x0919ba50b206C3F31D516De818b1fBc7dA21653D;

    function setUp() public override {
        vm.chainId(11155111);
        vm.roll(9_500_000);
        vm.warp(1_792_143_071);
        attester = vm.addr(ATTESTER_KEY);
        deployCodeTo("Mocks.sol:MockCurator", SEPOLIA_CURATOR);
        curator = MockCurator(SEPOLIA_CURATOR);
        idmd = new MockIDMD();
        imd = new MockIMD();
        intake = new MockIntake(address(imd));
        renderer = new Renderer();
        composer = new Composer();
        deployCodeTo(
            "Registry.sol:Registry",
            abi.encode(
                SEPOLIA_CURATOR,
                address(idmd),
                address(imd),
                address(intake),
                attester,
                address(renderer),
                address(composer),
                address(0)
            ),
            REGISTRY_ADDR
        );
        registry = Registry(REGISTRY_ADDR);
    }

    function test_gameWindowAndDeployBlockNonceRegisterOnSepolia() public {
        Spec memory game = t1Spec(CURATOR_ADDR, "Game window");
        Spec memory nonce = _nonceSpec(B_DEPLOY);
        assertGt(game.toBlock, vm.getBlockNumber(), "evidence height exceeds the deployment chain height");
        assertGt(nonce.toBlock, vm.getBlockNumber());
        uint256 fee = registry.SPEC_FEE();
        fund(C1A1, 2 * fee);
        vm.startPrank(C1A1);
        assertEq(registry.registerSpec(game), 10001);
        assertEq(registry.registerSpec(nonce), 10002);
        vm.stopPrank();
        assertEq(registry.nextSpecId(), 10003);
        assertEq(imd.balanceOf(C1A1), 0);
        assertEq(imd.balanceOf(address(registry)), 2 * fee, "both registration fees pulled");
        assertEq(abi.encode(registry.specOf(10001)), abi.encode(game));
        assertEq(abi.encode(registry.specOf(10002)), abi.encode(nonce));
    }

    function test_sepoliaStillRejectsInvalidWindows() public {
        uint64 height = uint64(composer.mainnetHeightBound());
        Spec memory s = t1Spec(CURATOR_ADDR, "Window guard");
        fund(C1A1, registry.SPEC_FEE());
        s.toBlock = height;
        _badWindow(s);
        s.toBlock = height + 1;
        _badWindow(s);
        s.toBlock = s.fromBlock + 7198;
        _badWindow(s);
        s.toBlock = s.fromBlock - 1;
        _badWindow(s);
        s = _nonceSpec(height - 7199);
        _badWindow(s);
        s = _nonceSpec(height);
        _badWindow(s);
        s = _nonceSpec(B_DEPLOY);
        s.fromBlock -= 1;
        _badWindow(s);
        assertEq(registry.nextSpecId(), 10001);
        assertEq(imd.balanceOf(address(registry)), 0, "rejected windows charge no registration fee");
        assertEq(imd.balanceOf(C1A1), registry.SPEC_FEE());

        s = t1Spec(CURATOR_ADDR, "Last admissible block");
        s.toBlock = height - 1;
        s.fromBlock = s.toBlock - 7199;
        vm.prank(C1A1);
        assertEq(registry.registerSpec(s), 10001);
        assertEq(register(C1A1, _nonceSpec(height - 7200)), 10002);
    }

    function test_mainnetUsesTheExactDeploymentHeightGuards() public {
        vm.chainId(1);
        vm.roll(26_200_000);
        uint64 height = uint64(vm.getBlockNumber());
        assertGt(composer.mainnetHeightBound(), height, "timestamp bound must differ in this test");
        fund(C1A1, 2 * registry.SPEC_FEE());
        Spec memory s = t1Spec(CURATOR_ADDR, "Mainnet window");
        s.toBlock = height;
        _badWindow(s);
        s.toBlock = height + 1;
        _badWindow(s);
        s.toBlock = height - 1;
        s.fromBlock = s.toBlock - 7199;
        vm.prank(C1A1);
        assertEq(registry.registerSpec(s), 10001);
        _badWindow(_nonceSpec(height - 7199));
        vm.prank(C1A1);
        assertEq(registry.registerSpec(_nonceSpec(height - 7200)), 10002);
        assertEq(imd.balanceOf(C1A1), 0);
        assertEq(imd.balanceOf(address(registry)), 2 * registry.SPEC_FEE());
    }

    function test_heightBoundCoversMeasuredMainnetHeadsAndAnchor() public {
        uint256[5] memory timestamps =
            [uint256(1_663_224_191), 1_786_910_327, 1_791_731_219, 1_792_092_371, 1_792_143_071];
        uint256[5] memory heights = [uint256(15_537_395), 25_769_870, 26_170_000, 26_200_000, 26_204_211];
        for (uint256 i; i < timestamps.length; ++i) {
            vm.warp(timestamps[i]);
            uint256 upper = composer.mainnetHeightBound();
            assertGe(upper, heights[i], "upper bound cannot exclude a mined mainnet block");
            assertLe(upper - heights[i], 100_000, "measured slack exceeds 100,000 blocks");
        }
        // 15,537,395 is the second proof-of-stake block, slot 4,700,014.
        vm.warp(0);
        assertEq(composer.mainnetHeightBound(), 15_537_395);
        vm.warp(1_663_224_190);
        assertEq(composer.mainnetHeightBound(), 15_537_395);
        vm.warp(1_663_224_191);
        assertEq(composer.mainnetHeightBound(), 15_537_395);
        vm.warp(1_663_224_202);
        assertEq(composer.mainnetHeightBound(), 15_537_395);
        vm.warp(1_663_224_203);
        assertEq(composer.mainnetHeightBound(), 15_537_396);
    }

    function testFuzz_heightBoundIsMonotone(uint64 a, uint64 b) public {
        (uint64 earlier, uint64 later) = a <= b ? (a, b) : (b, a);
        vm.warp(earlier);
        uint256 first = composer.mainnetHeightBound();
        vm.warp(later);
        uint256 second = composer.mainnetHeightBound();
        assertGe(first, 15_537_395);
        assertGe(second, first);
        if (earlier <= 1_663_224_191) assertEq(first, 15_537_395);
        if (later <= 1_663_224_191) assertEq(second, 15_537_395);
    }

    function test_catalogBodiesAndHashesStayMainnetAndIgnoreCuratorArgument() public {
        uint16[7] memory ids = [uint16(701), 801, 1001, 1102, 1105, 1201, 1301];
        string[7] memory names = [
            "701-still-here",
            "801-last-stand",
            "1001-hour-savior",
            "1102-ordinal-1000",
            "1105-first-thousand",
            "1201-top-32",
            "1301-not-born-yesterday"
        ];
        string memory hashes = vm.readFile("reference/plane/questionHashes.json");
        assertEq(composer.MAINNET_CURATOR(), CURATOR_ADDR);
        for (uint256 i; i < ids.length; ++i) {
            Spec memory s = registry.specOf(ids[i]);
            assertEq(s.target, ids[i] == 1301 ? address(0) : CURATOR_ADDR);
            (bytes memory body, bytes32 questionHash) = registry.composeBody(ids[i], C1A1);
            bytes memory fixture = bytes(vm.readFile(string.concat("templates/fixtures/", names[i], ".json")));
            if (fixture[fixture.length - 1] == 0x0a) {
                assembly ("memory-safe") {
                    mstore(fixture, sub(mload(fixture), 1))
                }
            }
            assertEq(
                string(body),
                vm.replace(
                    string(fixture), '"consumer": {\n    "chainId": 1,', '"consumer": {\n    "chainId": 11155111,'
                ),
                names[i]
            );
            assertEq(questionHash, vm.parseJsonBytes32(hashes, string.concat(".", names[i], ".questionHash")));
            assertFalse(vm.contains(string(body), "0x0919ba50b206c3f31d516de818b1fbc7da21653d"));
            (bytes memory otherBody, bytes32 otherHash) =
                composer.compose(s, C1A1, address(registry), ids[i] == 1301, CURATOR_ADDR);
            assertEq(otherBody, body, "compose ignores its fifth argument");
            assertEq(otherHash, questionHash);
            assertEq(abi.encode(composer.catalogSpec(ids[i], CURATOR_ADDR)), abi.encode(s));
        }
        uint16[4] memory remaining = [uint16(901), 1101, 1103, 1104];
        for (uint256 i; i < remaining.length; ++i) {
            assertEq(registry.specOf(remaining[i]).target, CURATOR_ADDR);
            (bytes memory body,) = registry.composeBody(remaining[i], C1A1);
            assertFalse(vm.contains(string(body), "0x0919ba50b206c3f31d516de818b1fbc7da21653d"));
        }
    }

    function test_directReadsStillUseTheSepoliaCuratorAndIDMD() public {
        assertEq(address(registry.curator()), SEPOLIA_CURATOR);
        deployCodeTo("Mocks.sol:MockCurator", CURATOR_ADDR);
        MockCurator mainnetCurator = MockCurator(CURATOR_ADDR);
        uint16[13] memory ids = [uint16(101), 201, 202, 301, 302, 303, 401, 402, 403, 404, 501, 502, 503];
        mainnetCurator.set(C1A1, 0, true, 10, 800 ether, 10000);
        for (uint256 i; i < ids.length; ++i) {
            assertFalse(registry.hasTrait(C1A1, ids[i]), "mainnet direct state must not leak into Sepolia");
        }
        mainnetCurator.set(C1A1, 0, false, 0, 0, 0);
        curator.set(C1A1, 0, true, 10, 800 ether, 10000);
        for (uint256 i; i < ids.length; ++i) {
            assertTrue(registry.hasTrait(C1A1, ids[i]), "direct trait must read the deployment Curator");
        }
        assertFalse(registry.hasTrait(C1A1, 601));
        idmd.setBalance(C1A1, 1);
        assertTrue(registry.hasTrait(C1A1, 601));
    }

    function test_sepoliaClaimantVerifies701ThroughMockIntake() public {
        mint(C1A1);
        bytes32 requestId = ask(C1A1, 701);
        assertEq(imd.balanceOf(address(intake)), PRICE);
        assertEq(vm.parseJsonUint(string(intake.bodyOf(requestId)), ".consumer.chainId"), 11155111);
        assertEq(vm.parseJsonUint(string(intake.bodyOf(requestId)), ".chainId"), 1);
        OracleAttestation memory a = attestationFor(requestId, word(1));
        bytes memory signature = sign(a);
        vm.cool(address(registry));
        assertEq(intake.callbackGas(), 200_000, "exercise the stricter mainnet stipend");
        assertTrue(deliver(requestId, a, signature));
        assertTrue(registry.hasTrait(C1A1, 701));
        assertEq(registry.pendingOf(C1A1, 701), bytes32(0));
        (bytes32 intakeId, bytes32 oracleId, uint64 fromBlock, uint64 toBlock) = registry.verified(C1A1, 701);
        assertEq(intakeId, requestId);
        assertEq(oracleId, a.requestId);
        assertEq(fromBlock, B_H24);
        assertEq(toBlock, B_END);
    }

    function _nonceSpec(uint64 height) internal pure returns (Spec memory s) {
        s.kind = 5;
        s.threshold = 20;
        s.fromBlock = height;
        s.toBlock = height;
        s.name = "Nonce at deployment";
    }

    function _badWindow(Spec memory s) internal {
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        vm.prank(C1A1);
        registry.registerSpec(s);
    }
}
