// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {OracleAttestation} from "../src/interfaces/Types.sol";
import {Vm} from "forge-std/Vm.sol";

contract ColdCallbacksTest is BaseTest {
    bytes32 private catalogId;
    bytes32 private communityId;
    bytes32 private operatorId;
    bytes32 private sharedId;

    function setUp() public override {
        super.setUp();
        vm.prank(ALICE);
        registry.mintCard();
        catalogId = ask(ALICE, 701);
        communityId = ask(ALICE, register(1));
        operatorId = ask(ALICE, 601);
        sharedId = shared(1201);
    }

    function measure(bytes32 rid, bytes memory answer, string memory label) internal {
        OracleAttestation memory a = attestation(rid, answer);
        bytes memory sig = sign(a);
        bytes memory args = abi.encode(rid, a, sig);
        vm.cool(address(registry));
        vm.startStateDiffRecording();
        assertTrue(intake.complete(rid, 0, 0, "", args));
        Vm.AccountAccess[] memory changes = vm.stopAndReturnStateDiff();
        uint256 writes;
        for (uint256 i; i < changes.length; ++i) {
            for (uint256 j; j < changes[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory s = changes[i].storageAccesses[j];
                if (s.account == address(registry) && s.isWrite && !s.reverted) {
                    assertTrue(s.previousValue != 0);
                    ++writes;
                }
            }
        }
        uint256 current = intake.callbackUsed();
        emit log_named_uint(string.concat(label, " cold current"), current);
        emit log_named_uint(string.concat(label, " cold Glamsterdam"), current + 7200 * writes);
        assertLe(current + 7200 * writes, 175000);
    }

    function test_coldCleanCatalog() public {
        measure(catalogId, abi.encode(uint256(1)), "catalog");
    }

    function test_coldCleanFirstCommunityWithCard() public {
        measure(communityId, abi.encode(uint256(1)), "community");
    }

    function test_coldClean601() public {
        measure(operatorId, abi.encode(true), "601");
    }

    function test_coldCleanShared32() public {
        measure(sharedId, abi.encode(new address[](32)), "shared");
    }

    function test_sixtyThousandStipendAlreadySuffices() public {
        intake.setGas(60000);
        measure(communityId, abi.encode(uint256(1)), "60k community");
    }
}
