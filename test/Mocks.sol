// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IIntake} from "../src/interfaces/IIntake.sol";
import {Spec} from "../src/interfaces/Types.sol";

contract MockIMD is ERC20 {
    bool public fail;
    bool public failForward;
    uint8 public precision = 18;
    address public attack;
    bytes public attackData;
    bool public attackSucceeded;
    constructor() ERC20("Test asset", "TEST") {}

    function mint(address a, uint256 n) external {
        _mint(a, n);
    }

    function setFail(bool v) external {
        fail = v;
    }

    function setFailForward(bool v) external {
        failForward = v;
    }

    function setPrecision(uint8 v) external {
        precision = v;
    }

    function decimals() public view override returns (uint8) {
        return precision;
    }

    function setAttack(address target, bytes calldata data) external {
        attack = target;
        attackData = data;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (fail) return false;
        if (attack != address(0)) (attackSucceeded,) = attack.call(attackData);
        return super.transferFrom(from, to, value);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (fail || failForward) return false;
        return super.transfer(to, value);
    }
}

contract MockCurator {
    struct Member {
        uint256 hour;
        bool joined;
        uint256 count;
        uint256 capital;
        uint256 points;
    }
    mapping(address => Member) public members;
    bool public isSettled = true;

    function set(address a, uint256 h, bool j, uint256 c, uint256 cap, uint256 pts) external {
        members[a] = Member(h, j, c, cap, pts);
    }

    function setSettled(bool s) external {
        isSettled = s;
    }

    function firstHourOf(address a) external view returns (uint256, bool) {
        return (members[a].hour, members[a].joined);
    }

    function txCountOf(address a) external view returns (uint256) {
        return members[a].count;
    }

    function contributedBy(address a) external view returns (uint256) {
        return members[a].capital;
    }

    function pointsOf(address a) external view returns (uint256) {
        return members[a].points;
    }
}

contract FeeSink {}

contract MockIntake {
    uint256 public price = 0.5 ether;
    uint64 public callbackGas = 200000;
    uint256 public nonce;
    bytes32 public forcedId;
    bytes public lastBody;
    uint256 public callbackUsed;
    mapping(bytes32 => IIntake.Callback) public callbacks;
    mapping(bytes32 => bytes4) public failures;
    mapping(bytes32 => bool) public completed;

    function setPrice(uint256 p) external {
        price = p;
    }

    function setGas(uint64 g) external {
        callbackGas = g;
    }

    function forceId(bytes32 id) external {
        forcedId = id;
    }

    function priceOf(bytes32, address) external view returns (uint256) {
        return price;
    }

    function requestWithFailure(
        bytes32 action,
        bytes calldata body,
        IIntake.Callback calldata cb,
        bytes4 failure,
        address asset,
        uint256 amount
    ) external returns (bytes32 id) {
        require(action == bytes32("oracle.request@oracle-1") && amount == price && amount != 0, "price");
        require(MockIMD(asset).transferFrom(msg.sender, address(this), amount), "payment");
        id = forcedId == bytes32(0) ? keccak256(abi.encode(++nonce)) : forcedId;
        callbacks[id] = cb;
        failures[id] = failure;
        body;
    }

    function complete(bytes32 id, uint8 status, bytes32, string calldata, bytes calldata args)
        external
        returns (bool delivered)
    {
        require(!completed[id], "completed");
        completed[id] = true;
        IIntake.Callback memory cb = callbacks[id];
        bytes memory data = bytes.concat(status == 0 ? cb.selector : failures[id], args);
        uint256 stipend = callbackGas;
        address target = cb.target;
        uint256 used;
        assembly {
            let g := gas()
            delivered := call(stipend, target, 0, add(data, 32), mload(data), 0, 0)
            used := sub(g, gas())
        }
        callbackUsed = used;
    }

    function raw(address target, bytes calldata data) external returns (bool ok) {
        bytes memory input = data;
        uint256 stipend = callbackGas;
        uint256 used;
        assembly {
            let g := gas()
            ok := call(stipend, target, 0, add(input, 32), mload(input), 0, 0)
            used := sub(g, gas())
        }
        callbackUsed = used;
    }
}

contract GoldenRegistry {
    uint16[] private _ids;
    uint256 private _count;
    bool private _hostile;

    function configure(uint16[] memory ids, uint256 count, bool hostile) external {
        _ids = ids;
        _count = count;
        _hostile = hostile;
    }

    function claimantOf(uint256) external pure returns (address) {
        return address(0xc1a1);
    }

    function traitsOf(address) external view returns (uint16[] memory) {
        return _ids;
    }

    function verifiedSpecsOf(address) external view returns (uint16[] memory ids) {
        ids = new uint16[](_count);
        for (uint256 i; i < _count; ++i) {
            ids[i] = uint16(10001 + i);
        }
    }

    function specOf(uint16) external view returns (Spec memory s) {
        s.kind = 2;
        s.target = address(0xc0de);
        s.name = _hostile ? "Hostile '\"<>&\\\nXXXXXXXXXXXXXXXXX" : "Synthetic fact";
        s.item = new string(256);
    }

    function verified(address, uint16 id) external pure returns (bytes32, bytes32, uint64, uint64) {
        if (id < 10001) return (bytes32(0), bytes32(0), 0, 0);
        return (
            bytes32(uint256(type(uint256).max / 15)),
            bytes32(uint256(type(uint256).max / 15 * 2)),
            type(uint64).max,
            type(uint64).max
        );
    }
}
