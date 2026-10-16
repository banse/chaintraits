// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Registry} from "../../src/Registry.sol";
import {Renderer} from "../../src/Renderer.sol";
import {Composer} from "../../src/Composer.sol";
import {IBurnExecutor} from "../../src/interfaces/IBurnExecutor.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWhitelistCurator} from "../../src/interfaces/IWhitelistCurator.sol";
import {NonpayableBurnClaimant} from "../mocks/MockBurnExecutor.sol";

interface BurnExecutorConfig {
    function token() external view returns (address);
    function oft() external view returns (address);
    function dstEid() external view returns (uint32);
    function baseBurnReceiver() external view returns (address);
}

/// @notice Opt-in with forge test --match-contract BurnRuleForkTest --fork-url <RPC> --fork-block-number 26202203.
/// No environment reads and no RPC calls in the default offline suite. Real executor, IMD/OFT and Intake code.
/// @dev In every sponsored-claim test the claim is the first call of the test that touches the executor, the
///      OFT, the endpoint or the message libraries: a quote read before it would warm the state the registry's
///      preview must pay for cold (the 200,000 cap only ever passed warm), and one after it would see a drained
///      executor. The expected values are the pinned constants below (test/NOTES.md).
contract BurnRuleForkTest is Test {
    uint256 internal constant FORK_BLOCK = 26_202_203;
    bytes32 internal constant PARENT_HASH = 0x1c99cd7e58e1ce4aa357f48944d6d15c0e4a499cec2c6d3c5a0a0ccbdec0aca8;
    address internal constant EXECUTOR = 0xe29386719C155B6847aD5a4E97C6674f10ffc750;
    address internal constant CURATOR = 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91;
    address internal constant IDMD = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
    address internal constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address internal constant INTAKE = 0xa43e6F75ee006411F79Ac1C84120606C2330DE82;
    address internal constant ATTESTER = 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982;
    address internal constant MEMBER = 0x200E710aCAA6A93bbc77146026328C40F1d60fB1;
    // Pinned at FORK_BLOCK: the executor's uncapped quote and its IMD balance before any claim.
    uint256 internal constant PINNED_AMOUNT = 454939975000000000000;
    uint256 internal constant PINNED_FEE = 219261761563315;
    uint256 internal constant PINNED_EXECUTOR_BALANCE = 454939975535748811691;
    IBurnExecutor internal executor = IBurnExecutor(EXECUTOR);
    Registry internal registry;
    bool internal forked;
    uint256 internal executorEthAtSetUp;

    function setUp() public {
        try vm.activeFork() returns (uint256) {
            forked = true;
        } catch {
            return;
        }
        assertEq(block.chainid, 1);
        assertEq(block.number, FORK_BLOCK, "use the documented pinned block");
        assertEq(blockhash(FORK_BLOCK - 1), PARENT_HASH);
        assertGt(EXECUTOR.code.length, 0);
        registry = new Registry(
            CURATOR, IDMD, IMD, INTAKE, ATTESTER, address(new Renderer()), address(new Composer()), EXECUTOR
        );
        // Test-only funding, on an isolated local fork. No live transaction is broadcast.
        deal(IMD, address(registry), 2 ether);
        vm.deal(address(registry), 1 ether);
        // Read here, in setUp's own transaction, so the claim tests touch the executor cold.
        executorEthAtSetUp = EXECUTOR.balance;
    }

    modifier onFork() {
        if (!forked) {
            vm.skip(true);
            return;
        }
        _;
    }

    function test_fork_executorConfigurationAndPinnedQuote() public onFork {
        assertEq(BurnExecutorConfig(EXECUTOR).token(), IMD);
        assertEq(BurnExecutorConfig(EXECUTOR).oft(), IMD, "exercise the real OFT");
        assertEq(BurnExecutorConfig(EXECUTOR).dstEid(), 30184);
        assertTrue(BurnExecutorConfig(EXECUTOR).baseBurnReceiver() != address(0));
        assertEq(executor.tokenBalance(), PINNED_EXECUTOR_BALANCE);
        (uint256 amount,, uint256 fee) = executor.previewBridge();
        assertEq(amount, PINNED_AMOUNT);
        assertEq(fee, PINNED_FEE);
        assertGe(amount, registry.BURN_MIN());
        assertLe(fee, registry.BURN_FEE_CAP());
    }

    // (f) A member's cold free claim with the pinned fee plus a surplus burns through the real executor.
    function test_fork_coldFreeClaimWithSurplusBurnsAndExecutorReturnsTheSurplus() public onFork {
        uint256 attached = PINNED_FEE + 0.001 ether;
        vm.deal(MEMBER, 1 ether);
        vm.recordLogs();
        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.BurnTriggered(MEMBER, PINNED_AMOUNT, PINNED_FEE);
        vm.prank(MEMBER);
        registry.claimSponsored{value: attached}(701);
        _assertBridged(PINNED_AMOUNT);
        assertTrue(registry.pendingOf(MEMBER, 701) != 0, "the oracle request is pending");
        assertEq(executor.tokenBalance(), PINNED_EXECUTOR_BALANCE - PINNED_AMOUNT, "only shared-decimal dust remains");
        assertEq(address(registry).balance, 1 ether, "the registry's ETH balance is conserved");
        assertEq(EXECUTOR.balance, executorEthAtSetUp, "the executor kept nothing");
        assertEq(MEMBER.balance, 1 ether - PINNED_FEE, "the surplus came back to the claimant from the executor");
        assertEq(IERC20(IMD).allowance(EXECUTOR, IMD), 0);
    }

    // (g) The same cold claim with the exact fee from a contract claimant without receive() or fallback().
    function test_fork_coldFreeClaimExactFeeFromNonpayableContractClaimant() public onFork {
        NonpayableBurnClaimant wallet = new NonpayableBurnClaimant();
        // Only membership is mocked; executor, OFT, endpoint and Intake remain real.
        vm.mockCall(
            CURATOR, abi.encodeCall(IWhitelistCurator.firstHourOf, (address(wallet))), abi.encode(uint256(1), true)
        );
        vm.deal(address(wallet), PINNED_FEE);
        vm.recordLogs();
        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.BurnTriggered(address(wallet), PINNED_AMOUNT, PINNED_FEE);
        wallet.claim(registry, false, 701, PINNED_FEE);
        _assertBridged(PINNED_AMOUNT);
        assertTrue(registry.pendingOf(address(wallet), 701) != 0);
        assertEq(executor.tokenBalance(), PINNED_EXECUTOR_BALANCE - PINNED_AMOUNT);
        assertEq(address(wallet).balance, 0, "exactly the fee was spent");
        assertEq(address(registry).balance, 1 ether);
        assertEq(EXECUTOR.balance, executorEthAtSetUp);
    }

    // (h) The same cold claim without the fee reverts with the pinned quote and leaves no oracle request.
    function test_fork_coldFreeClaimWithoutTheFeeReverts() public onFork {
        vm.expectRevert(abi.encodeWithSelector(Registry.BurnFeeRequired.selector, PINNED_FEE));
        vm.prank(MEMBER);
        registry.claimSponsored(701);
        assertEq(registry.pendingOf(MEMBER, 701), bytes32(0), "no oracle request");
        assertFalse(registry.poolUsed(MEMBER, 701));
        assertEq(registry.lastPoolDay(MEMBER), 0);
        assertEq(registry.pool(), 2 ether, "no pool IMD left the registry");
        assertEq(address(registry).balance, 1 ether);
    }

    // (i) The two direct-executor tests, unchanged: the registry is bypassed, so the warm quote read is fine.
    function test_fork_realExecutorAndOFTForceRefundSurplusToNonpayableRecipient() public onFork {
        NonpayableBurnClaimant wallet = new NonpayableBurnClaimant();
        (uint256 amount,, uint256 fee) = executor.previewBridge();
        assertGe(amount, registry.BURN_MIN());
        assertGt(fee, 0);
        uint256 attached = registry.BURN_FEE_CAP();
        assertLt(fee, attached, "force refund path exercised");
        vm.deal(address(wallet), 1 ether);
        uint256 executorEth = EXECUTOR.balance;
        vm.recordLogs();
        vm.prank(address(wallet));
        executor.bridgeToBaseBurnReceiver{value: attached, gas: 800_000}(amount, address(wallet));
        _assertBridged(amount);
        assertEq(address(wallet).balance, 1 ether - fee);
        assertEq(EXECUTOR.balance, executorEth, "executor retains no fee or surplus");
        assertEq(address(registry).balance, 1 ether);
        assertLt(executor.tokenBalance(), 1e12, "only OFT shared-decimal dust remains");
        assertEq(IERC20(IMD).allowance(EXECUTOR, IMD), 0);
    }

    function test_fork_realExecutorExactFeeForNonpayableRecipient() public onFork {
        NonpayableBurnClaimant wallet = new NonpayableBurnClaimant();
        (uint256 amount,, uint256 fee) = executor.previewBridge();
        assertGe(amount, registry.BURN_MIN());
        vm.deal(address(wallet), fee);
        // Direct call isolates the executor's exact-fee behavior from Intake deposits before preview.
        vm.prank(address(wallet));
        executor.bridgeToBaseBurnReceiver{value: fee, gas: 800_000}(amount, address(wallet));
        assertEq(address(wallet).balance, 0);
        assertLt(executor.tokenBalance(), 1e12);
    }

    function _assertBridged(uint256 amount) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool bridged;
        bool oftSent;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == EXECUTOR
                    && logs[i].topics[0]
                        == keccak256("TokensBridgedForBurn(address,uint32,bytes32,uint256,uint256,bytes32)")
            ) {
                (uint256 sent,, bytes32 guid) = abi.decode(logs[i].data, (uint256, uint256, bytes32));
                assertEq(sent, amount);
                assertTrue(guid != 0);
                bridged = true;
            }
            if (
                logs[i].emitter == IMD
                    && logs[i].topics[0] == keccak256("OFTSent(bytes32,uint32,address,uint256,uint256)")
            ) oftSent = true;
        }
        assertTrue(bridged, "real executor submitted the bridge");
        assertTrue(oftSent, "real OFT emitted its message receipt");
    }
}
