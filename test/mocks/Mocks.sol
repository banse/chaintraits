// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IIntake, OracleAttestation} from "../../src/Types.sol";
import {Registry} from "../../src/Registry.sol";

contract MockIMD is ERC20 {
    uint8 public decimalsValue = 18;
    bool public fail;
    bool public failOutbound;
    address public reenter;
    bytes public reenterData;
    bool public reentered;
    constructor() ERC20("Fixture IMD", "IMD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setDecimals(uint8 n) external {
        decimalsValue = n;
    }

    function decimals() public view override returns (uint8) {
        return decimalsValue;
    }

    function setFail(bool value) external {
        fail = value;
    }

    function setFailOutbound(bool value) external {
        failOutbound = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failOutbound) return false;
        return super.transfer(to, amount);
    }

    function hook(address target, bytes calldata data) external {
        reenter = target;
        reenterData = data;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (fail) return false;
        if (reenter != address(0)) {
            (bool ok,) = reenter.call(reenterData);
            reentered = ok;
        }
        return super.transferFrom(from, to, value);
    }
}

contract MockCurator {
    struct Member {
        bool joined;
        uint256 hour;
        uint256 count;
        uint256 capital;
        uint256 points;
    }
    mapping(address => Member) public members;
    bool public settled = true;

    function set(address a, bool j, uint256 h, uint256 n, uint256 capital, uint256 points) external {
        members[a] = Member(j, h, n, capital, points);
    }

    function setSettled(bool value) external {
        settled = value;
    }

    function isSettled() external view returns (bool) {
        return settled;
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

contract MockExecutor {}

contract MockIntake is IIntake {
    struct Ask {
        address payer;
        address callbackTarget;
        bytes4 callbackSelector;
        bool completed;
    }
    mapping(bytes32 => Ask) public requests;
    mapping(bytes32 => bytes4) public failures;
    uint256 public price = 0.5 ether;
    uint256 public nonce;
    uint256 public stipend = 200000;
    bytes32 public forceId;
    uint256 public lastGas;
    bool public lastDelivered;
    event Asked(bytes32 indexed id, bytes body);

    function setPrice(uint256 value) external {
        price = value;
    }

    function setStipend(uint256 value) external {
        stipend = value;
    }

    function setId(bytes32 value) external {
        forceId = value;
    }

    function priceOf(bytes32, address) external view returns (uint256) {
        return price;
    }

    function requestWithFailure(
        bytes32 action,
        bytes calldata body,
        Callback calldata cb,
        bytes4 failure,
        address asset,
        uint256 amount
    ) external returns (bytes32 id) {
        require(action == bytes32("oracle.request@oracle-1") && amount == price, "request");
        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "payment");
        id = forceId == 0 ? keccak256(abi.encode(++nonce)) : forceId;
        requests[id] = Ask(msg.sender, cb.target, cb.selector, false);
        failures[id] = failure;
        emit Asked(id, body);
    }

    function complete(bytes32 id, uint8 status, bytes calldata args) external returns (bool) {
        Ask storage a = requests[id];
        require(a.callbackTarget != address(0) && !a.completed, "once");
        a.completed = true;
        bytes4 selector = status == 0 ? a.callbackSelector : failures[id];
        return _call(a.callbackTarget, bytes.concat(selector, args));
    }

    function raw(address target, bytes calldata input) external returns (bool) {
        return _call(target, input);
    }

    function _call(address target, bytes memory input) private returns (bool ok) {
        uint256 limit = stipend;
        uint256 gasBefore = gasleft();
        assembly ("memory-safe") { ok := call(limit, target, 0, add(input, 32), mload(input), 0, 0) }
        lastGas = gasBefore - gasleft();
        lastDelivered = ok;
    }
}
