// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Stand-ins for the dependencies of the Sworn Registry on a local chain. They are placed with
// anvil_setCode at the mainnet addresses the Registry reads, so no constructor runs: every value
// starts at zero and is set through the setters below by the local server.

/// WhitelistCurator stand-in: the five reads the Registry and Composer make, with sample values.
contract MockCurator {
    struct Row {
        uint256 hour;
        bool joined;
        uint256 txs;
        uint256 contributed;
        uint256 points;
    }

    mapping(address => Row) private _rows;

    function set(address wallet, uint256 hour, bool joined, uint256 txs, uint256 contributed, uint256 points) external {
        _rows[wallet] = Row(hour, joined, txs, contributed, points);
    }

    function isSettled() external pure returns (bool) {
        return true;
    }

    function firstHourOf(address wallet) external view returns (uint256, bool) {
        Row storage r = _rows[wallet];
        return (r.hour, r.joined);
    }

    function txCountOf(address wallet) external view returns (uint256) {
        return _rows[wallet].txs;
    }

    function contributedBy(address wallet) external view returns (uint256) {
        return _rows[wallet].contributed;
    }

    function pointsOf(address wallet) external view returns (uint256) {
        return _rows[wallet].points;
    }
}

/// IMD stand-in: a plain 18-decimal ERC20 with an open mint for sample balances.
contract MockIMD {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function name() external pure returns (string memory) {
        return "Identity.md";
    }

    function symbol() external pure returns (string memory) {
        return "IMD";
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "ERC20InsufficientAllowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "ERC20InsufficientBalance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// Intake v2 stand-in with the same request, complete and requests signatures and events as the
/// mainnet Intake, so the site's completion decoding reads it unchanged. Anyone may complete here.
contract MockIntake {
    struct Callback {
        address target;
        bytes4 selector;
    }

    struct Req {
        address payer;
        address target;
        bytes4 selector;
        bytes4 failure;
        bool completed;
    }

    event Requested(
        bytes32 indexed requestId,
        address indexed payer,
        bytes32 indexed action,
        bytes body,
        address callbackTarget,
        bytes4 callbackSelector,
        address asset,
        uint256 amount
    );
    event FailureHookSet(bytes32 indexed requestId, bytes4 selector);
    event Completed(bytes32 indexed requestId, uint8 status, bytes32 resultHash, string uri, bool delivered);

    mapping(bytes32 => Req) private _reqs;
    mapping(bytes32 => mapping(address => uint256)) private _prices;
    uint256 public nonce;
    // 0 = forward all gas. A small value starves the callback, so Completed reports delivered=false
    // and the verdict can only be stored through Registry.settle, as after a failed mainnet delivery.
    uint64 public callbackGas;

    function setCallbackGas(uint64 gas) external {
        callbackGas = gas;
    }

    function setPrice(bytes32 action, address asset, uint256 amount) external {
        _prices[action][asset] = amount;
    }

    function priceOf(bytes32 action, address asset) external view returns (uint256) {
        return _prices[action][asset];
    }

    function request(bytes32 action, bytes calldata body, Callback calldata cb, address asset, uint256 amount)
        external
        payable
        returns (bytes32)
    {
        return _open(action, body, cb, bytes4(0), asset, amount);
    }

    function requestWithFailure(
        bytes32 action,
        bytes calldata body,
        Callback calldata cb,
        bytes4 onFailure,
        address asset,
        uint256 amount
    ) external payable returns (bytes32 id) {
        id = _open(action, body, cb, onFailure, asset, amount);
        emit FailureHookSet(id, onFailure);
    }

    function _open(bytes32 action, bytes calldata body, Callback calldata cb, bytes4 onFailure, address asset, uint256 amount)
        private
        returns (bytes32 id)
    {
        require(amount >= _prices[action][asset] && amount != 0, "price");
        require(MockIMD(asset).transferFrom(msg.sender, address(this), amount), "payment");
        id = keccak256(abi.encode(address(this), ++nonce, msg.sender, keccak256(body)));
        _reqs[id] = Req(msg.sender, cb.target, cb.selector, onFailure, false);
        emit Requested(id, msg.sender, action, body, cb.target, cb.selector, asset, amount);
    }

    function requests(bytes32 id) external view returns (address payer, address callbackTarget, bytes4 callbackSelector, bool completed) {
        Req storage r = _reqs[id];
        return (r.payer, r.target, r.selector, r.completed);
    }

    function failureSelectorOf(bytes32 id) external view returns (bytes4) {
        return _reqs[id].failure;
    }

    function complete(bytes32 id, uint8 status, bytes32 resultHash, string calldata uri, bytes calldata args) external {
        Req storage r = _reqs[id];
        require(r.payer != address(0) && !r.completed, "not open");
        r.completed = true;
        bytes4 sel = status == 0 ? r.selector : r.failure;
        bool delivered;
        if (sel != bytes4(0)) {
            (delivered,) = callbackGas == 0
                ? r.target.call(abi.encodePacked(sel, args))
                : r.target.call{gas: callbackGas}(abi.encodePacked(sel, args));
        }
        emit Completed(id, status, resultHash, uri, delivered);
    }
}

/// Uniswap v4 quoter stand-in: a fixed ETH price per IMD.
contract MockQuoter {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct QuoteExactSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    uint256 public weiPerImd;

    function setPrice(uint256 wei_) external {
        weiPerImd = wei_;
    }

    function quoteExactOutputSingle(QuoteExactSingleParams calldata p) external view returns (uint256 amountIn, uint256 gasEstimate) {
        amountIn = (uint256(p.exactAmount) * weiPerImd) / 1e18;
        gasEstimate = 150000;
    }
}

/// Universal Router stand-in for the site's one swap: reads TAKE_ALL's amount and mints that IMD.
contract MockRouter {
    MockIMD public immutable imd;
    MockQuoter public immutable quoter;

    constructor(MockIMD imd_, MockQuoter quoter_) {
        imd = imd_;
        quoter = quoter_;
    }

    function execute(bytes calldata, bytes[] calldata inputs, uint256 deadline) external payable {
        require(block.timestamp <= deadline, "deadline");
        (, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));
        (, uint256 amount) = abi.decode(params[2], (address, uint256));
        uint256 cost = (amount * quoter.weiPerImd()) / 1e18;
        require(msg.value >= cost, "too little ETH");
        imd.mint(msg.sender, amount);
        if (msg.value > cost) payable(msg.sender).transfer(msg.value - cost);
    }
}
