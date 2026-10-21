// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Registry} from "../src/Registry.sol";
import {Spec, OracleAttestation, IIntake} from "../src/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface LiveIntake is IIntake {
    function writer() external view returns (address);
    function callbackGas() external view returns (uint64);
    function complete(bytes32, uint8, bytes32, string calldata, bytes calldata) external;
}

interface BridgePreview {
    function previewBridge() external view returns (uint256, uint256, uint256);
}

/// @dev Opt in by passing --fork-url and --fork-block-number 26237654 to Forge. No test reads the environment.
contract MainnetForkTest is Test {
    Registry internal registry;
    IERC20 internal token;
    LiveIntake internal intake;
    uint256 internal constant PINNED_BLOCK = 26237654;

    function setUp() public {
        try vm.activeFork() returns (uint256) {}
        catch {
            vm.skip(true);
            return;
        }
        assertEq(block.chainid, 1);
        assertEq(block.number, PINNED_BLOCK);
        (,, registry) = (new Deploy()).deployForChain();
        token = IERC20(registry.imd());
        intake = LiveIntake(registry.intake());
        deal(address(token), address(this), 10 ether);
        token.approve(address(registry), 10 ether);
    }

    function testFork_realMintFeeAndExecutorPreview() public {
        uint256 before = token.balanceOf(registry.burnExecutor());
        (uint256 oldSend,,) = BridgePreview(registry.burnExecutor()).previewBridge();
        registry.mintCard();
        assertEq(token.balanceOf(registry.burnExecutor()), before + 0.1 ether);
        assertEq(token.balanceOf(address(registry)), 0);
        (uint256 sendable, uint256 minimum, uint256 nativeFee) = BridgePreview(registry.burnExecutor()).previewBridge();
        assertGe(sendable, oldSend);
        assertLe(sendable, before + 0.1 ether);
        assertLe(minimum, sendable);
        if (sendable > 0) assertGt(nativeFee, 0);
        emit log_named_uint("executor sendable after fee", sendable);
    }

    function testFork_realIntakeStipendAndCompletion() public {
        uint16[] memory ids = new uint16[](1);
        ids[0] = 701;
        uint256 price = intake.priceOf(registry.ACTION(), address(token));
        registry.upgrade(ids, price);
        bytes32 r = registry.pendingOf(address(this), 701);
        assertTrue(r != 0);
        assertEq(intake.callbackGas(), 200000);
        (,, uint64 at, bytes32 hash) = registry.pendingRequest(r);
        Spec memory s = registry.specOf(701);
        OracleAttestation memory a;
        a.requestId = keccak256("local fork attestation");
        a.chainId = 1;
        a.questionHash = hash;
        a.answerType = 3;
        a.answer = abi.encode(uint256(1));
        a.fromBlock = s.fromBlock;
        a.toBlock = s.toBlock;
        a.panelSize = 5;
        a.quorum = 3;
        a.agreed = 3;
        a.issuedAt = at;
        a.expiresAt = at + 30 days;
        // Fixed production signer cannot be signed locally. Its invalid-signature delivery still executes the real call path.
        vm.prank(intake.writer());
        intake.complete(r, 0, keccak256("fixture"), "", abi.encode(r, a, new bytes(65)));
        assertEq(registry.pendingOf(address(this), 701), 0);
        assertFalse(registry.hasTrait(address(this), 701));
        registry.upgrade(ids, price);
        r = registry.pendingOf(address(this), 701);
        vm.prank(intake.writer());
        intake.complete(r, 2, 0, "", abi.encode(r, uint8(2), bytes32("disagreed"), uint16(1), uint16(5), bytes("")));
        assertEq(registry.pendingOf(address(this), 701), 0);
    }

    function testFork_realIntakeTrueVerdictWithLocalTestSigner() public {
        uint256 key = 123456789;
        Registry local = new Registry(
            registry.curator(),
            registry.imd(),
            registry.intake(),
            vm.addr(key),
            registry.renderer(),
            registry.composer(),
            registry.burnExecutor()
        );
        token.approve(address(local), 1 ether);
        uint16[] memory ids = new uint16[](1);
        ids[0] = 701;
        local.upgrade(ids, 1 ether);
        bytes32 r = local.pendingOf(address(this), 701);
        (,, uint64 at, bytes32 hash) = local.pendingRequest(r);
        OracleAttestation memory a;
        a.requestId = keccak256("local true verdict");
        a.chainId = 1;
        a.questionHash = hash;
        a.answerType = 3;
        a.answer = abi.encode(uint256(1));
        a.fromBlock = 25777045;
        a.toBlock = 25789604;
        a.panelSize = 5;
        a.quorum = 3;
        a.agreed = 3;
        a.issuedAt = at;
        a.expiresAt = at + 30 days;
        (uint8 v, bytes32 sr, bytes32 ss) = vm.sign(key, local.attestationDigest(a));
        bytes memory args = abi.encode(r, a, abi.encodePacked(sr, ss, v));
        vm.cool(address(local));
        vm.prank(intake.writer());
        intake.complete(r, 0, keccak256(args), "", args);
        assertTrue(local.hasTrait(address(this), 701));
    }
}
