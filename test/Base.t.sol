// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Registry} from "../src/Registry.sol";
import {Composer} from "../src/Composer.sol";
import {Renderer} from "../src/Renderer.sol";
import {Spec, OracleAttestation} from "../src/Types.sol";
import {MockIMD, MockIntake, MockCurator, MockExecutor} from "./mocks/Mocks.sol";

abstract contract SwornTest is Test {
    Registry internal registry;
    Composer internal composer;
    Renderer internal renderer;
    MockIMD internal token;
    MockIntake internal intake;
    MockCurator internal curator;
    MockExecutor internal executor;
    address internal alice = address(uint160(2 ** 120 + 1));
    address internal bob = address(uint160(2 ** 120 + 2));
    uint256 internal constant SIGNER_KEY = 123456789;

    function setUp() public virtual {
        vm.chainId(1);
        vm.roll(26237718);
        vm.warp(1792550000);
        renderer = new Renderer();
        composer = new Composer();
        token = new MockIMD();
        intake = new MockIntake();
        curator = new MockCurator();
        executor = new MockExecutor();
        registry = new Registry(
            address(curator),
            address(token),
            address(intake),
            vm.addr(SIGNER_KEY),
            address(renderer),
            address(composer),
            address(executor)
        );
        _fund(alice);
        _fund(bob);
        _fund(address(this));
    }

    function _fund(address who) internal {
        token.mint(who, 100000 ether);
        vm.prank(who);
        token.approve(address(registry), type(uint256).max);
    }

    function _ask(address who, uint16 id) internal returns (bytes32 r) {
        uint16[] memory ids = new uint16[](1);
        ids[0] = id;
        vm.prank(who);
        registry.upgrade(ids, type(uint256).max);
        return registry.pendingOf(who, id);
    }

    function _shared(uint16 id) internal returns (bytes32 r) {
        registry.requestSharedFact(id, type(uint256).max);
        return registry.sharedPending(id);
    }

    function _spec(uint8 kind) internal view returns (Spec memory s) {
        s.kind = kind;
        s.target = address(curator);
        s.item = "event Transfer(address indexed from, address indexed to, uint256 value)";
        s.arg = "to";
        s.threshold = 1;
        s.fromBlock = 25769870;
        s.toBlock = 25789604;
        s.name = "Community";
        if (kind == 2 || kind == 3) s.sumArg = "value";
        if (kind == 3) s.threshold = 32;
        if (kind == 4) {
            s.item = "function pointsOf(address) view returns (uint256)";
            s.arg = "";
            s.op = 1;
        }
        if (kind == 5) {
            s.target = address(0);
            s.item = "";
            s.arg = "";
            s.fromBlock = s.toBlock;
            s.threshold = 20;
        }
    }

    function _maxSpec() internal view returns (Spec memory s) {
        s = _spec(2);
        s.name = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
        s.item =
            "event ABCDEFGHIJKLMNOPQRSTUVWXYZ012345(address indexed abcdefghijklmnopqrstuvwxyz012345, uint256 indexed ABCDEFGHIJKLMNOPQRSTUVWXYZ012345, uint256 abcdefghijklmnopqrstuvwxyz987654, bytes32 ffffffffffffffffffffffffffffffff, bool ggggggggggggggggggggggggggg)";
        s.arg = "abcdefghijklmnopqrstuvwxyz012345";
        s.fixedArg = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
        s.fixedVal = type(uint256).max;
        s.sumArg = "abcdefghijklmnopqrstuvwxyz987654";
        s.threshold = type(uint256).max;
    }

    function _register(uint8 kind) internal returns (uint16) {
        return registry.registerSpec(_spec(kind), 0);
    }

    function _att(bytes32 r, bytes memory answer) internal view returns (OracleAttestation memory a) {
        (, uint16 id, uint64 requestedAt, bytes32 hash) = registry.pendingRequest(r);
        Spec memory s = registry.specOf(id);
        a.requestId = keccak256(abi.encode("oracle", r));
        a.chainId = 1;
        a.questionHash = hash;
        a.answerType = s.kind <= 2 ? 3 : s.kind == 3 ? 4 : 0;
        a.answer = answer;
        a.fromBlock = s.fromBlock;
        a.toBlock = s.kind == 6 ? uint64(block.number - 64) : s.toBlock;
        a.panelSize = s.kind == 3 || s.kind >= 5 ? 11 : 5;
        a.quorum = a.panelSize == 11 ? 7 : 3;
        a.agreed = a.quorum;
        a.issuedAt = requestedAt;
        a.expiresAt = requestedAt + 30 days;
    }

    function _sign(OracleAttestation memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, registry.attestationDigest(a));
        return abi.encodePacked(r, s, v);
    }

    function _deliver(bytes32 r, OracleAttestation memory a) internal returns (bool) {
        return intake.complete(r, 0, abi.encode(r, a, _sign(a)));
    }

    function _pass(address who, uint16 id) internal returns (bytes32 r) {
        r = _ask(who, id);
        assertTrue(_deliver(r, _att(r, abi.encode(uint256(1)))));
        assertTrue(registry.hasTrait(who, id));
    }

    function _list(uint256 n) internal pure returns (address[] memory list) {
        list = new address[](n);
        for (uint256 i; i < n; ++i) {
            list[i] = address(uint160(2 ** 100 + i));
        }
    }

    function _miss(bytes32 r, OracleAttestation memory a, uint8 reason) internal {
        vm.recordLogs();
        assertTrue(_deliver(r, a));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(registry) && logs[i].topics[0] == keccak256("Missed(bytes32,uint16,uint8)"))
            {
                (bytes32 got,, uint8 code) = abi.decode(logs[i].data, (bytes32, uint16, uint8));
                assertEq(got, r);
                assertEq(code, reason);
                found = true;
            }
        }
        assertTrue(found, "miss event");
        (,, uint64 at,) = registry.pendingRequest(r);
        assertEq(at, 0);
    }
}
