// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Spec, OracleAttestation} from "./interfaces/Types.sol";
import {ICurator} from "./interfaces/ICurator.sol";
import {IIntake} from "./interfaces/IIntake.sol";
import {IComposer, IRenderer} from "./interfaces/ISworn.sol";
import {Catalog} from "./lib/Catalog.sol";
import {AttestationHash} from "./lib/AttestationHash.sol";

/// @notice Permanent wallet facts. A card's claimant is independent of its holder.
contract Registry is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant ACTION = bytes32("oracle.request@oracle-1");
    uint256 public constant MINT_FEE = 0.1 ether;
    uint256 public constant SPEC_FEE = 6.4 ether;
    uint256 public constant ISSUE_WINDOW = 1 days;
    uint256 public constant VALID_FOR_SECONDS = 30 days;
    uint256 public constant ABANDON_AFTER = 31 days;
    address public curator;
    address public imd;
    address public intake;
    address public attester;
    address public renderer;
    address public composer;
    address public burnExecutor;
    mapping(address => uint256) public tokenOf;
    mapping(uint256 => address) public claimantOf;
    mapping(uint256 => uint64) public mintedAtBlock;
    mapping(uint256 => uint32) public frozenDirect;
    uint256 public totalSupply;
    uint16 public nextSpecId = 10001;
    mapping(uint16 => Spec) private _specs;

    // State 0 unused, 1 pending, 2 verified, 3 closed without a verdict.
    // Tombstones prohibit reusing an Intake id. Public pending views hide closed records.
    struct Request {
        address claimant;
        uint16 traitId;
        uint64 requestedAt;
        uint8 kind;
        uint8 state;
        bytes32 questionHash;
        uint64 fromBlock;
        uint64 toBlock;
        uint256 threshold;
        bytes32 oracleId;
        bytes32 answerHash;
    }
    mapping(bytes32 => Request) private _requests;
    mapping(address => mapping(uint16 => bytes32)) private _pairs;

    struct SpecList {
        uint16 tail;
        uint32 count;
        bool prepared;
    }
    mapping(address => SpecList) private _lists;
    mapping(address => mapping(uint16 => uint16)) private _previous;

    event CardMinted(address indexed claimant, uint256 indexed tokenId);
    event TraitRequested(address indexed claimant, uint16 indexed traitId, bytes32 requestId, bytes32 questionHash);
    event Verified(address indexed claimant, uint16 indexed traitId, bytes32 requestId, bytes32 oracleRequestId);
    event Missed(bytes32 requestId, uint16 traitId, uint8 reason);
    event NoVerdict(bytes32 requestId, uint16 traitId, uint8 status, bytes32 reason, uint16 agreed, uint16 answered);
    event Abandoned(bytes32 requestId);
    event SpecRegistered(uint16 indexed traitId, address indexed registrant);
    event SharedFactStored(uint16 indexed factId, bytes32 requestId, uint16 length);
    event MetadataUpdate(uint256 tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    error AlreadyMinted(address wallet);
    error AlreadyPending(address claimant, uint16 traitId);
    error AlreadyVerified(address claimant, uint16 traitId);
    error DependencyHasNoCode();
    error FactAlreadyStored(uint16 factId);
    error FactNotStored(uint16 factId);
    error ListMismatch();
    error NoCard(uint256 tokenId);
    error NoTraits();
    error NotASharedFact(uint16 traitId);
    error NotAnOracleTrait(uint16 traitId);
    error NotClaimant();
    error NotInList();
    error NotIntake();
    error NotPending(bytes32 requestId);
    error NotSettleable(bytes32 requestId, uint8 reason);
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error RequestIdTaken(bytes32 requestId);
    error TooEarly();
    error TooManyTraits(uint256 count);
    error UnexpectedSpecId(uint256 expected, uint256 next);
    error ZeroAddress();
    error ZeroPrice();

    constructor(
        address curator_,
        address imd_,
        address intake_,
        address attester_,
        address renderer_,
        address composer_,
        address burnExecutor_
    ) ERC721("Sworn", "SWORN") {
        if (
            curator_ == address(0) || imd_ == address(0) || intake_ == address(0) || attester_ == address(0)
                || renderer_ == address(0) || composer_ == address(0) || burnExecutor_ == address(0)
        ) revert ZeroAddress();
        if (renderer_.code.length == 0 || composer_.code.length == 0) revert DependencyHasNoCode();
        if (curator_.code.length != 0 || imd_.code.length != 0 || intake_.code.length != 0) {
            if (burnExecutor_.code.length == 0) revert DependencyHasNoCode();
            require(IERC20Metadata(imd_).decimals() == 18, "decimals");
            require(ICurator(curator_).isSettled(), "settled");
            if (IIntake(intake_).priceOf(ACTION, imd_) == 0) revert ZeroPrice();
        }
        curator = curator_;
        imd = imd_;
        intake = intake_;
        attester = attester_;
        renderer = renderer_;
        composer = composer_;
        burnExecutor = burnExecutor_;
    }

    function mintCard() external nonReentrant returns (uint256 id) {
        if (tokenOf[msg.sender] != 0) revert AlreadyMinted(msg.sender);
        _fee(MINT_FEE);
        uint32 snapshot = IComposer(composer).directSnapshot(msg.sender, curator);
        id = ++totalSupply;
        tokenOf[msg.sender] = id;
        claimantOf[id] = msg.sender;
        mintedAtBlock[id] = uint64(block.number);
        frozenDirect[id] = snapshot;
        _mint(msg.sender, id);
        emit CardMinted(msg.sender, id);
    }

    function _fee(uint256 amount) private {
        IERC20(imd).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(imd).safeTransfer(burnExecutor, amount);
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == 0x49064906 || super.supportsInterface(id);
    }

    function _update(address to, uint256 id, address auth) internal override returns (address from) {
        from = super._update(to, id, auth);
        if (from != address(0)) emit MetadataUpdate(id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        if (claimantOf[id] == address(0)) revert NoCard(id);
        return IRenderer(renderer).tokenURIOf(address(this), id);
    }

    function hasDirectTrait(address wallet, uint16 id) public view returns (bool) {
        if (wallet == address(0) || !Catalog.direct(id)) return false;
        uint32 bits;
        uint256 token = tokenOf[wallet];
        if (token != 0) {
            bits = frozenDirect[token];
        } else {
            try IComposer(composer).directSnapshot(wallet, curator) returns (uint32 live) {
                bits = live;
            } catch {
                return false;
            }
        }
        return bits & (uint32(1) << ((id / 100 - 1) * 4 + id % 100 - 1)) != 0;
    }

    function hasTrait(address wallet, uint16 id) public view returns (bool) {
        if (wallet == address(0)) return false;
        if (Catalog.direct(id)) return hasDirectTrait(wallet, id);
        return _requests[_pairs[wallet][id]].state == 2;
    }

    function traitsOf(address wallet) external view returns (uint16[] memory) {
        return IComposer(composer).traitsOf(address(this), wallet);
    }

    function verifiedSpecsOf(address wallet) external view returns (uint16[] memory ids) {
        SpecList memory l = _lists[wallet];
        ids = new uint16[](l.count);
        uint16 id = l.tail;
        for (uint256 i = l.count; i != 0;) {
            ids[--i] = id;
            id = _previous[wallet][id];
        }
    }

    function traitName(uint16 id) external view returns (string memory) {
        if (id >= 10001 && id < nextSpecId) return _specs[id].name;
        return IRenderer(renderer).traitName(id);
    }

    function specOf(uint16 id) public view returns (Spec memory) {
        if (id >= 10001 && id < nextSpecId) return _specs[id];
        return IComposer(composer).catalogSpec(id, curator);
    }

    /// @notice The fields used by metadata, without loading a community recipe's long strings.
    function renderSpec(uint16 id) external view returns (uint8 kind, address target, string memory name) {
        if (id >= 10001 && id < nextSpecId) {
            Spec storage stored = _specs[id];
            return (stored.kind, stored.target, stored.name);
        }
        Spec memory s = specOf(id);
        return (s.kind, s.target, s.name);
    }

    function registerSpec(Spec calldata s, uint256 expectedId) external nonReentrant returns (uint16 id) {
        IComposer(composer).validateSpec(s, block.number);
        id = nextSpecId;
        if ((expectedId != 0 && expectedId != id) || id == type(uint16).max) revert UnexpectedSpecId(expectedId, id);
        _fee(SPEC_FEE);
        _specs[id] = s;
        nextSpecId = id + 1;
        emit SpecRegistered(id, msg.sender);
    }

    function composeBody(uint16 id, address claimant) external view returns (bytes memory, bytes32) {
        return IComposer(composer).compose(id, specOf(id), claimant, address(this), curator);
    }

    function _oracleSpec(uint16 id) private view returns (Spec memory) {
        if (!Catalog.oracle(id) && !(id >= 10001 && id < nextSpecId)) revert NotAnOracleTrait(id);
        return specOf(id);
    }

    function upgrade(uint16[] calldata ids, uint256 maxPrice) external nonReentrant {
        if (ids.length == 0) revert NoTraits();
        if (ids.length != 1) revert TooManyTraits(ids.length);
        uint16 id = ids[0];
        Spec memory s = _oracleSpec(id);
        if (s.kind == 3) revert NotASharedFact(id);
        if (hasTrait(msg.sender, id)) revert AlreadyVerified(msg.sender, id);
        _ask(id, s, msg.sender, maxPrice);
    }

    function requestSharedFact(uint16 id, uint256 maxPrice) external nonReentrant {
        if (!Catalog.oracle(id) && !(id >= 10001 && id < nextSpecId)) revert NotASharedFact(id);
        Spec memory s = specOf(id);
        if (s.kind != 3) revert NotASharedFact(id);
        if (_requests[_pairs[address(0)][id]].state == 2) revert FactAlreadyStored(id);
        _ask(id, s, address(0), maxPrice);
    }

    function _ask(uint16 id, Spec memory s, address claimant, uint256 maxPrice) private {
        if (pendingOf(claimant, id) != bytes32(0)) revert AlreadyPending(claimant, id);
        uint256 price = IIntake(intake).priceOf(ACTION, imd);
        if (price == 0) revert ZeroPrice();
        if (price > maxPrice) revert PriceAboveMax(price, maxPrice);
        (bytes memory body, bytes32 questionHash) = IComposer(composer).compose(id, s, claimant, address(this), curator);
        if (s.kind == 6) {
            uint256 h = block.chainid == 1 ? block.number : IComposer(composer).mainnetHeightBound();
            s.toBlock = uint64(h > uint256(s.fromBlock) + 64 ? h - 64 : s.fromBlock);
        }
        IERC20(imd).safeTransferFrom(msg.sender, address(this), price);
        IERC20(imd).forceApprove(intake, price);
        bytes32 rid = IIntake(intake)
            .requestWithFailure(
                ACTION,
                body,
                IIntake.Callback(address(this), this.onResult.selector),
                this.onFailure.selector,
                imd,
                price
            );
        if (rid == bytes32(0) || _requests[rid].state != 0) revert RequestIdTaken(rid);
        _requests[rid] = Request(
            claimant,
            id,
            uint64(block.timestamp),
            s.kind,
            1,
            questionHash,
            s.fromBlock,
            s.toBlock,
            s.threshold,
            bytes32(uint256(1)),
            s.kind == 3 ? bytes32(uint256(1)) : bytes32(0)
        );
        _pairs[claimant][id] = rid;
        if (id >= 10001 && claimant != address(0)) _prepareList(claimant, id);
        emit TraitRequested(claimant, id, rid, questionHash);
    }

    function _prepareList(address wallet, uint16 id) private {
        _lists[wallet].prepared = true;
        _previous[wallet][id] = type(uint16).max;
    }

    function pendingOf(address claimant, uint16 id) public view returns (bytes32) {
        bytes32 rid = _pairs[claimant][id];
        return _requests[rid].state == 1 ? rid : bytes32(0);
    }

    function sharedPending(uint16 id) external view returns (bytes32) {
        return pendingOf(address(0), id);
    }

    function pendingRequest(bytes32 rid) external view returns (address, uint16, uint64, bytes32) {
        Request storage p = _requests[rid];
        if (p.state != 1) return (address(0), 0, 0, bytes32(0));
        return (p.claimant, p.traitId, p.requestedAt, p.questionHash);
    }

    function verified(address wallet, uint16 id) external view returns (bytes32, bytes32, uint64, uint64) {
        bytes32 rid = _pairs[wallet][id];
        Request storage p = _requests[rid];
        if (wallet == address(0) || p.state != 2) return (bytes32(0), bytes32(0), 0, 0);
        return (rid, p.oracleId, p.fromBlock, p.toBlock);
    }

    function sharedFact(uint16 id) external view returns (bytes32, bytes32, uint16) {
        bytes32 rid = _pairs[address(0)][id];
        Request storage p = _requests[rid];
        if (p.state != 2) return (bytes32(0), bytes32(0), 0);
        return (rid, p.answerHash, uint16(p.threshold));
    }

    function abandon(bytes32 rid) external {
        Request storage p = _requests[rid];
        if (p.state != 1) revert NotPending(rid);
        if (block.timestamp <= uint256(p.requestedAt) + ABANDON_AFTER) revert TooEarly();
        if (p.claimant != address(0) && msg.sender != p.claimant) revert NotClaimant();
        p.state = 3;
        emit Abandoned(rid);
    }

    function attestationDigest(OracleAttestation calldata a) public view returns (bytes32) {
        return AttestationHash.digest(a, address(this));
    }

    function onResult(bytes32 rid, OracleAttestation calldata a, bytes calldata sig) external {
        if (msg.sender != intake) revert NotIntake();
        Request storage p = _requests[rid];
        if (p.state != 1) {
            emit Missed(rid, 0, 1);
            return;
        }
        p.state = 3;
        uint8 reason = _check(p, a, sig);
        if (reason != 0) {
            emit Missed(rid, p.traitId, reason);
            return;
        }
        _store(rid, p, a);
    }

    function settle(bytes32 rid, OracleAttestation calldata a, bytes calldata sig) external {
        Request storage p = _requests[rid];
        if (p.state != 1) revert NotPending(rid);
        uint8 reason = _check(p, a, sig);
        if (reason != 0) revert NotSettleable(rid, reason);
        p.state = 3;
        _store(rid, p, a);
    }

    function onFailure(bytes32 rid, uint8 status, bytes32 reason, uint16 agreed, uint16 answered, bytes calldata)
        external
    {
        if (msg.sender != intake) revert NotIntake();
        Request storage p = _requests[rid];
        if (p.state != 1) {
            emit Missed(rid, 0, 1);
            return;
        }
        p.state = 3;
        emit NoVerdict(rid, p.traitId, status, reason, agreed, answered);
    }

    function _check(Request storage p, OracleAttestation calldata a, bytes calldata sig) private view returns (uint8) {
        if (sig.length != 65) return 2;
        uint8 kind = p.kind;
        if (a.answer.length > 2112 || (kind != 3 && a.answer.length != 32)) return 9;
        if (a.chainId != 1) return 3;
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(attestationDigest(a), sig);
        if (err != ECDSA.RecoverError.NoError || signer == address(0) || signer != attester) return 2;
        if (a.answerType != (kind <= 2 ? 3 : kind == 3 ? 4 : 0)) return 4;
        (uint16 panel, uint16 quorum) = Catalog.panel(kind);
        if (a.agreed < a.quorum || a.quorum < quorum || a.panelSize < panel) return 5;
        if (a.fromBlock != p.fromBlock || a.toBlock != p.toBlock) return 6;
        if (
            block.timestamp > a.expiresAt || uint256(a.issuedAt) > block.timestamp + 1 hours
                || a.issuedAt < p.requestedAt || uint256(a.issuedAt) > uint256(p.requestedAt) + ISSUE_WINDOW
                || uint256(a.expiresAt) > uint256(a.issuedAt) + VALID_FOR_SECONDS
        ) return 7;
        if (a.questionHash != p.questionHash) return 10;
        bytes calldata answer = a.answer;
        uint256 value;
        assembly { value := calldataload(answer.offset) }
        if (kind <= 2) return value >= p.threshold ? 0 : 8;
        if (kind != 3) return value > 1 ? 9 : value == 1 ? 0 : 8;
        uint256 n = p.threshold;
        if (answer.length != 64 + 32 * n || value != 32) return 9;
        assembly { value := calldataload(add(answer.offset, 32)) }
        if (value != n) return 9;
        for (uint256 i; i < n; ++i) {
            assembly { value := calldataload(add(answer.offset, add(64, mul(i, 32)))) }
            if (value >> 160 != 0) return 9;
        }
        return 0;
    }

    function _store(bytes32 rid, Request storage p, OracleAttestation calldata a) private {
        p.state = 2;
        p.oracleId = a.requestId;
        if (p.kind == 3) {
            p.answerHash = keccak256(a.answer);
            emit SharedFactStored(p.traitId, rid, uint16(p.threshold));
        } else {
            _mark(p.claimant, p.traitId, rid, a.requestId);
        }
    }

    function _mark(address wallet, uint16 id, bytes32 rid, bytes32 oid) private {
        if (id >= 10001) {
            SpecList storage l = _lists[wallet];
            _previous[wallet][id] = l.tail == 0 ? type(uint16).max : l.tail;
            l.tail = id;
            ++l.count;
        }
        emit Verified(wallet, id, rid, oid);
        uint256 token = tokenOf[wallet];
        if (token != 0) emit MetadataUpdate(token);
    }

    function applySharedFact(uint16 id, address[] calldata list) external {
        bytes32 rid = _pairs[address(0)][id];
        Request storage p = _requests[rid];
        if (p.state != 2) revert FactNotStored(id);
        if (keccak256(abi.encode(list)) != p.answerHash) revert ListMismatch();
        bool included;
        for (uint256 i; i < p.threshold; ++i) {
            if (list[i] == msg.sender) included = true;
        }
        if (!included) revert NotInList();
        if (hasTrait(msg.sender, id)) revert AlreadyVerified(msg.sender, id);
        _pairs[msg.sender][id] = rid;
        if (id >= 10001) _prepareList(msg.sender, id);
        _mark(msg.sender, id, rid, p.oracleId);
    }
}
