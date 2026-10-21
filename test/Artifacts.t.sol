// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {BaseTest} from "./Base.t.sol";
import {Registry} from "../src/Registry.sol";
import {Renderer} from "../src/Renderer.sol";
import {Composer} from "../src/Composer.sol";

contract ArtifactsTest is BaseTest {
    function test_runtimeSizesAndSumPinned() public {
        uint256 r = address(registry).code.length;
        uint256 c = address(composer).code.length;
        uint256 d = address(renderer).code.length;
        emit log_named_uint("Registry runtime", r);
        emit log_named_uint("Composer runtime", c);
        emit log_named_uint("Renderer runtime", d);
        emit log_named_uint("Combined runtime", r + c + d);
        assertLt(r, 24576);
        assertLt(c, 24576);
        assertLt(d, 24576);
        assertLe(r + c + d, 69800);
        assertEq(r, 20912, "Registry size changed; review the budget");
        assertEq(c, 22277, "Composer size changed; review the budget");
        assertEq(d, 17066, "Renderer size changed; review the budget");
        assertEq(r + c + d, 60255, "combined runtime pin");
    }

    function test_runtimeIdenticalAndImmutableReferencesEmpty() public {
        Renderer r = new Renderer();
        Composer c = new Composer();
        Registry reg =
            new Registry(address(curator), address(imd), address(intake), BOB, address(r), address(c), address(sink));
        assertEq(address(r).code, address(renderer).code);
        assertEq(address(c).code, address(composer).code);
        assertEq(address(reg).code, address(registry).code);
        string[3] memory names = [string("Registry"), "Composer", "Renderer"];
        for (uint256 i; i < 3; ++i) {
            string memory j = vm.readFile(string.concat("out/", names[i], ".sol/", names[i], ".json"));
            if (vm.keyExistsJson(j, ".deployedBytecode.immutableReferences")) {
                assertEq(vm.parseJsonKeys(j, ".deployedBytecode.immutableReferences").length, 0);
            }
        }
    }

    function test_noForbiddenRuntimeOperations() public view {
        _scan(address(registry).code);
        _scan(address(composer).code);
        _scan(address(renderer).code);
    }

    function _scan(bytes memory code) private pure {
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            assertTrue(op != 0xf0 && op != 0xf2 && op != 0xf4 && op != 0xf5 && op != 0xff, "forbidden operation");
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
        }
    }
}
