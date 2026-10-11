// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IIntake} from "../../src/interfaces/IIntake.sol";

/// @notice The settled Curator's views, settable per wallet.
contract MockCurator {
    struct Entry {
        uint256 hour;
        bool joined;
        uint256 txCount;
        uint256 contributed;
        uint256 points;
    }

    mapping(address => Entry) public entries;

    function set(address a, uint256 hour, bool joined, uint256 txCount, uint256 contributed, uint256 points) external {
        entries[a] = Entry(hour, joined, txCount, contributed, points);
    }

    function firstHourOf(address a) external view returns (uint256, bool) {
        return (entries[a].hour, entries[a].joined);
    }

    function txCountOf(address a) external view returns (uint256) {
        return entries[a].txCount;
    }

    function contributedBy(address a) external view returns (uint256) {
        return entries[a].contributed;
    }

    function pointsOf(address a) external view returns (uint256) {
        return entries[a].points;
    }

    function weightOf(address) external pure returns (uint256) {
        return 0;
    }

    function isSettled() external pure returns (bool) {
        return true;
    }
}

/// @notice IDMD: `balanceOf` and `ownerOf`, settable.
contract MockIDMD {
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) internal _owner;

    function setBalance(address a, uint256 b) external {
        balanceOf[a] = b;
    }

    function setOwner(uint256 id, address a) external {
        _owner[id] = a;
    }

    function ownerOf(uint256 id) external view returns (address) {
        require(_owner[id] != address(0), "ERC721NonexistentToken");
        return _owner[id];
    }
}

/// @notice IMD: a plain ERC-20 with open mint, 18 decimals.
contract MockIMD is ERC20 {
    constructor() ERC20("IMD", "IMD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice An ERC-20 whose `transferFrom` re-enters the caller with arbitrary calldata once.
contract ReentrantIMD is ERC20 {
    bytes public payload;
    bool internal armed;
    bool public reentryReverted;

    constructor() ERC20("EVIL", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(bytes calldata data) external {
        payload = data;
        armed = true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            (bool ok,) = msg.sender.call(payload);
            reentryReverted = !ok;
        }
        return super.transferFrom(from, to, amount);
    }
}

/// @notice Intake v2 as the registry sees it: `priceOf`, `requestWithFailure` pulling the price, and a
///         `complete` that forwards to the stored callback with the real 200,000-gas stipend and records
///         `delivered` exactly as `reference/IntakeV2.sol` does. The next request id can be forced.
contract MockIntake {
    struct Req {
        address payer;
        address target;
        bytes4 selector;
        bytes4 onFailure;
        bytes body;
        bool completed;
    }

    bytes32 public constant ACTION = bytes32("oracle.request@oracle-1");
    uint64 public callbackGas = 200_000;
    address public imd;
    uint256 public price = 0.5 ether;
    uint256 public nonce;
    bytes32 public forcedId;
    mapping(bytes32 => Req) public requests;
    bytes32[] public ids;

    event Requested(bytes32 indexed requestId, address indexed payer, bytes body);
    event Completed(bytes32 indexed requestId, uint8 status, bool delivered);

    constructor(address imd_) {
        imd = imd_;
    }

    function setPrice(uint256 p) external {
        price = p;
    }

    function setCallbackGas(uint64 g) external {
        callbackGas = g;
    }

    function forceNextId(bytes32 id) external {
        forcedId = id;
    }

    function priceOf(bytes32 action, address asset) external view returns (uint256) {
        return (action == ACTION && asset == imd) ? price : 0;
    }

    function bodyOf(bytes32 id) external view returns (bytes memory) {
        return requests[id].body;
    }

    function lastId() external view returns (bytes32) {
        return ids[ids.length - 1];
    }

    function request(bytes32 action, bytes calldata body, IIntake.Callback calldata cb, address asset, uint256 amount)
        external
        payable
        returns (bytes32)
    {
        return _request(action, body, cb, bytes4(0), asset, amount);
    }

    function requestWithFailure(
        bytes32 action,
        bytes calldata body,
        IIntake.Callback calldata cb,
        bytes4 onFailure,
        address asset,
        uint256 amount
    ) external payable returns (bytes32) {
        return _request(action, body, cb, onFailure, asset, amount);
    }

    function _request(
        bytes32 action,
        bytes calldata body,
        IIntake.Callback calldata cb,
        bytes4 onFailure,
        address asset,
        uint256 amount
    ) internal returns (bytes32 id) {
        require(action == ACTION && asset == imd && price != 0, "ActionNotSold");
        require(amount >= price, "PriceNotMet");
        require(body.length > 0 && body.length <= 16_384, "body");
        id = forcedId != 0 ? forcedId : keccak256(abi.encode(block.chainid, address(this), ++nonce));
        forcedId = 0;
        requests[id] = Req(msg.sender, cb.target, cb.selector, onFailure, body, false);
        ids.push(id);
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        emit Requested(id, msg.sender, body);
    }

    /// @notice Mirrors `Intake.complete`: status 0 reaches the result selector, 1 and 2 the failure hook.
    function complete(bytes32 id, uint8 status, bytes calldata args) external returns (bool delivered) {
        Req storage r = requests[id];
        require(r.payer != address(0), "UnknownRequest");
        require(!r.completed, "AlreadyCompleted");
        r.completed = true;
        bytes4 selector = r.selector;
        if (status != 0) {
            selector = r.onFailure;
            if (selector != bytes4(0) && args.length != 0) {
                require(
                    args.length >= 64 && bytes32(args[0:32]) == id && uint256(bytes32(args[32:64])) == status,
                    "FailureArgsMismatch"
                );
            } else {
                selector = bytes4(0);
            }
        }
        if ((status == 0 || selector != bytes4(0)) && r.target != address(0)) {
            uint256 stipend = callbackGas;
            bytes memory data = bytes.concat(selector, args);
            address target = r.target;
            if (target.code.length > 0) {
                assembly ("memory-safe") {
                    delivered := call(stipend, target, 0, add(data, 0x20), mload(data), 0, 0)
                }
            }
        }
        emit Completed(id, status, delivered);
    }
}
