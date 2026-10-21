// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Composer} from "../src/Composer.sol";
import {Spec} from "../src/interfaces/Types.sol";

contract SpecValidationTest is BaseTest {
    function rejected(Spec memory s, string memory field) internal {
        uint256 balance = imd.balanceOf(address(this));
        uint16 next = registry.nextSpecId();
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, field));
        registry.registerSpec(s, 0);
        assertEq(imd.balanceOf(address(this)), balance);
        assertEq(registry.nextSpecId(), next);
        assertEq(imd.balanceOf(address(sink)), 0);
    }

    function test_allFieldGuardsRunBeforeFee() public {
        Spec memory s = spec(1);
        s.kind = 0;
        rejected(s, "kind");
        s.kind = 6;
        rejected(s, "kind");
        for (uint8 kind = 1; kind <= 5; ++kind) {
            s = spec(kind);
            s.target = kind == 5 ? ALICE : address(0);
            rejected(s, "target");
            s = spec(kind);
            s.threshold = 0;
            rejected(s, "threshold");
            s = spec(kind);
            s.name = "";
            rejected(s, "name");
            s.name = "abcdefghijklmnopqrstuvwxyz1234567";
            rejected(s, "name");
            s.name = "Text \"quoted\"";
            rejected(s, "name");
            s = spec(kind);
            s.fromBlock = s.toBlock + 1;
            rejected(s, "window");
            s = spec(kind);
            s.fixedVal = 1;
            rejected(s, "fixedVal");
            s = spec(kind);
            s.op = kind == 4 ? 6 : 1;
            rejected(s, "op");
        }
        s = spec(3);
        s.threshold = 33;
        rejected(s, "threshold");
        s = spec(4);
        s.op = 0;
        rejected(s, "op");
        for (uint8 kind = 4; kind <= 5; ++kind) {
            s = spec(kind);
            s.arg = "contributor";
            rejected(s, "arg");
            s = spec(kind);
            s.fixedArg = "hour";
            rejected(s, "fixedArg");
            s = spec(kind);
            s.sumArg = "amount";
            rejected(s, "sumArg");
        }
        s = spec(5);
        s.item = "function f(address) view returns (uint256)";
        rejected(s, "item");
    }

    function test_windowBoundariesAndOffMainnetHeight() public {
        Spec memory s = spec(1);
        s.toBlock = uint64(vm.getBlockNumber() - 64);
        s.fromBlock = s.toBlock - 7198;
        rejected(s, "window");
        --s.fromBlock;
        composer.validateSpec(s, type(uint256).max);
        s = spec(5);
        s.fromBlock = uint64(vm.getBlockNumber() - 7200);
        s.toBlock = s.fromBlock;
        composer.validateSpec(s, 0);
        ++s.fromBlock;
        ++s.toBlock;
        rejected(s, "window");
        s = spec(4);
        for (uint8 op = 1; op <= 5; ++op) {
            s.op = op;
            composer.validateSpec(s, 0);
            (bytes memory body,) = composer.compose(10001, s, ALICE, address(registry), address(curator));
            assertGt(body.length, 0);
        }
        vm.chainId(11155111);
        vm.roll(100);
        uint256 h = composer.mainnetHeightBound();
        s = spec(1);
        s.toBlock = uint64(h - 64);
        s.fromBlock = s.toBlock - 7199;
        composer.validateSpec(s, 0);
        ++s.toBlock;
        vm.expectRevert(abi.encodeWithSelector(Composer.BadSpec.selector, "window"));
        composer.validateSpec(s, type(uint256).max);
        vm.warp(1663224190);
        assertEq(composer.mainnetHeightBound(), 15537395);
        vm.warp(1663224191 + 120);
        assertEq(composer.mainnetHeightBound(), 15537405);
        (bytes memory body,) = registry.composeBody(601, ALICE);
        assertEq(vm.parseJsonUint(string(body), ".window.toBlock"), 25090085);
        assertEq(vm.parseJsonUint(string(body), ".window.fromBlock"), 25090085);
    }

    function test_closedTypeGrammarRejectsNearMisses() public {
        string[10] memory types_ = [
            string("uint"),
            "int",
            "uint7",
            "uint264",
            "uint08",
            "bytes0",
            "bytes33",
            "address payable",
            "uint256[2]",
            "uint256[][]"
        ];
        for (uint256 i; i < types_.length; ++i) {
            Spec memory s = spec(1);
            s.item = string.concat("event E(address indexed contributor, ", types_[i], " value)");
            rejected(s, "item");
        }
    }
}
