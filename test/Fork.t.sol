// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Composer} from "../src/Composer.sol";
import {OracleAttestation} from "../src/interfaces/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILiveIntake {
    function priceOf(bytes32, address) external view returns (uint256);
    function callbackGas() external view returns (uint64);
    function writer() external view returns (address);
    function complete(bytes32, uint8, bytes32, string calldata, bytes calldata) external;
}

interface IBurnPreview {
    function previewBridge() external view returns (uint256, uint256, uint256);
}

contract ForkTest is Test {
    address constant CURATOR = 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address constant INTAKE = 0xa43e6F75ee006411F79Ac1C84120606C2330DE82;
    address constant EXECUTOR = 0xe29386719C155B6847aD5a4E97C6674f10ffc750;
    uint256 constant PINNED_BLOCK = 26237654;

    function testFork_realDependenciesFeeBridgePreviewAndComplete() public {
        // Section 7.15 explicitly makes this optional URL the sole environment read in the suite.
        string memory rpc = vm.envOr("SWORN_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, PINNED_BLOCK);
        assertEq(block.chainid, 1);
        Renderer renderer = new Renderer();
        Composer composer = new Composer();
        uint256 key = 0x123456;
        Registry registry =
            new Registry(CURATOR, IMD, INTAKE, vm.addr(key), address(renderer), address(composer), EXECUTOR);
        address claimant = address(0xc1a1);
        deal(IMD, claimant, 10 ether);
        vm.prank(claimant);
        IERC20(IMD).approve(address(registry), 10 ether);
        uint256 beforeBalance = IERC20(IMD).balanceOf(EXECUTOR);
        (uint256 sendBefore,,) = IBurnPreview(EXECUTOR).previewBridge();
        vm.prank(claimant);
        registry.mintCard();
        assertEq(IERC20(IMD).balanceOf(EXECUTOR), beforeBalance + 0.1 ether);
        assertEq(IERC20(IMD).balanceOf(address(registry)), 0);
        (uint256 sendAfter,,) = IBurnPreview(EXECUTOR).previewBridge();
        assertGe(sendAfter, sendBefore);
        assertLe(sendAfter, beforeBalance + 0.1 ether);
        assertGt(sendAfter, 0);
        uint16[] memory ids = new uint16[](1);
        ids[0] = 701;
        uint256 price = ILiveIntake(INTAKE).priceOf(registry.ACTION(), IMD);
        vm.prank(claimant);
        registry.upgrade(ids, price);
        bytes32 rid = registry.pendingOf(claimant, 701);
        _deliver(registry, rid);
        assertTrue(registry.hasTrait(claimant, 701));
        assertEq(IERC20(IMD).balanceOf(address(registry)), 0);
    }

    function _deliver(Registry registry, bytes32 rid) internal {
        (,, uint64 requested, bytes32 hash) = registry.pendingRequest(rid);
        OracleAttestation memory a;
        a.requestId = keccak256("fork test verdict");
        a.chainId = 1;
        a.questionHash = hash;
        a.answerType = 3;
        a.answer = abi.encode(uint256(1));
        a.fromBlock = 25777045;
        a.toBlock = 25789604;
        a.panelSize = 5;
        a.quorum = 3;
        a.agreed = 3;
        a.issuedAt = requested;
        a.expiresAt = requested + 30 days;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0x123456, registry.attestationDigest(a));
        assertEq(ILiveIntake(INTAKE).callbackGas(), 200000);
        address writer = ILiveIntake(INTAKE).writer();
        vm.cool(address(registry));
        vm.prank(writer);
        ILiveIntake(INTAKE).complete(rid, 0, 0, "", abi.encode(rid, a, abi.encodePacked(r, s, v)));
    }
}
