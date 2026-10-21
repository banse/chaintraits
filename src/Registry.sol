// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Spec, OracleAttestation, ICurator, IIntake, IComposer, IRenderer} from "./Types.sol";
import {Catalog} from "./Catalog.sol";
import {AttestationHash} from "./AttestationHash.sol";

/// @notice Ownerless wallet facts. A transferable card always describes its original claimant.
contract Registry is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant ACTION = bytes32("oracle.request@oracle-1");
    uint256 public constant MINT_FEE = 0.1 ether;
    uint256 public constant SPEC_FEE = 6.4 ether;
    uint256 public constant ABANDON_AFTER = 31 days;
    uint256 public constant ISSUE_WINDOW = 1 days;
    uint256 public constant VALID_FOR_SECONDS = 30 days;
    address public curator;
    address public imd;
    address public intake;
    address public attester;
    address public renderer;
    address public composer;
    address public burnExecutor;
    uint256 public totalSupply;
    mapping(address => uint256) public tokenOf;
    mapping(uint256 => address) public claimantOf;
    mapping(uint256 => uint64) public mintedAtBlock;
    mapping(uint256 => uint32) public frozenDirect;
    uint16 public nextSpecId = 10001;
    mapping(uint16 => Spec) private _specs;

    // One status word gates all views: 1 pending, 2 verified, 3 cleared. Other words are archival.
    struct Request {
        address claimant;
        uint64 requestedAt;
        uint16 traitId;
        uint8 state;
        uint8 kind;
        bytes32 questionHash;
        uint64 fromBlock;
        uint64 toBlock;
        uint16 head;
        uint256 threshold;
        bytes32 oracleRequestId;
        bytes32 answerHash;
    }
    mapping(bytes32 => Request) private _requests;
    mapping(address => mapping(uint16 => bytes32)) private _pairs;
    mapping(uint16 => bytes32) private _shared;
    mapping(address => mapping(uint16 => bool)) private _applied;
    // Reserved nonzero words are paid for at request time. Only the verified prefix is visible.
    mapping(address => uint256[]) private _communitySlots;
    mapping(address => uint256) private _communityCountPlusOne;
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
    error FactAlreadyStored(uint16 id);
    error FactNotStored(uint16 id);
    error ListMismatch();
    error NoCard(uint256 id);
    error NoTraits();
    error NotASharedFact(uint16 id);
    error NotAnOracleTrait(uint16 id);
    error NotClaimant();
    error NotInList();
    error NotIntake();
    error NotPending(bytes32 id);
    error NotSettleable(bytes32 requestId, uint8 reason);
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error RequestIdTaken(bytes32 id);
    error TooEarly();
    error TooManyTraits(uint256 count);
    error UnexpectedSpecId(uint256 expected, uint256 next);
    error ZeroAddress();
    error ZeroPrice();
    error BadDependency();
    error SpecsExhausted();

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
        curator = curator_;
        imd = imd_;
        intake = intake_;
        attester = attester_;
        renderer = renderer_;
        composer = composer_;
        burnExecutor = burnExecutor_;
        if (curator_.code.length != 0 || imd_.code.length != 0 || intake_.code.length != 0) {
            if (burnExecutor_.code.length == 0) revert DependencyHasNoCode();
            if (IERC20Metadata(imd_).decimals() != 18 || !ICurator(curator_).isSettled()) revert BadDependency();
            if (IIntake(intake_).priceOf(ACTION, imd_) == 0) revert ZeroPrice();
        }
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == 0x49064906 || super.supportsInterface(id);
    }

    function _update(address to, uint256 id, address auth) internal override returns (address from) {
        from = super._update(to, id, auth);
        if (from != address(0)) emit MetadataUpdate(id);
    }

    function mintCard() external nonReentrant returns (uint256 tokenId) {
        if (tokenOf[msg.sender] != 0) revert AlreadyMinted(msg.sender);
        _fee(MINT_FEE);
        uint32 snapshot = IComposer(composer).directSnapshot(msg.sender, curator);
        tokenId = ++totalSupply;
        claimantOf[tokenId] = msg.sender;
        tokenOf[msg.sender] = tokenId;
        mintedAtBlock[tokenId] = uint64(block.number);
        frozenDirect[tokenId] = snapshot;
        _mint(msg.sender, tokenId);
        emit CardMinted(msg.sender, tokenId);
    }

    function _fee(uint256 amount) private {
        IERC20(imd).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(imd).safeTransfer(burnExecutor, amount);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        if (claimantOf[id] == address(0)) revert NoCard(id);
        return IRenderer(renderer).tokenURIOf(address(this), id);
    }

    function hasDirectTrait(address wallet, uint16 id) public view returns (bool) {
        if (wallet == address(0) || !Catalog.direct(id)) return false;
        uint32 snapshot = 0;
        uint256 token = tokenOf[wallet];
        if (token != 0) {
            snapshot = frozenDirect[token];
        } else {
            try IComposer(composer).directSnapshot(wallet, curator) returns (uint32 v) {
                snapshot = v;
            } catch {
                return false;
            }
        }
        return (snapshot & (uint32(1) << ((id / 100 - 1) * 4 + id % 100 - 1))) != 0;
    }

    function hasTrait(address wallet, uint16 id) public view returns (bool) {
        if (wallet == address(0)) return false;
        if (Catalog.direct(id)) return hasDirectTrait(wallet, id);
        return _requests[_pairs[wallet][id]].state == 2 || _applied[wallet][id];
    }

    function traitsOf(address wallet) external view returns (uint16[] memory) {
        return IComposer(composer).traitsOf(address(this), wallet);
    }

    function verifiedSpecsOf(address wallet) external view returns (uint16[] memory ids) {
        uint256 n = _communityCountPlusOne[wallet];
        if (n > 0) --n;
        ids = new uint16[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = uint16(_communitySlots[wallet][i]);
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

    function _isOracle(uint16 id) private view returns (bool) {
        return Catalog.oracle(id) || (id >= 10001 && id < nextSpecId);
    }

    function _spec(uint16 id) private view returns (Spec memory) {
        if (!_isOracle(id)) revert NotAnOracleTrait(id);
        return specOf(id);
    }

    function pendingOf(address wallet, uint16 id) public view returns (bytes32) {
        bytes32 r = _pairs[wallet][id];
        return _requests[r].state == 1 ? r : bytes32(0);
    }

    function pendingRequest(bytes32 id)
        external
        view
        returns (address claimant, uint16 traitId, uint64 requestedAt, bytes32 questionHash)
    {
        Request storage p = _requests[id];
        if (p.state != 1) return (address(0), 0, 0, bytes32(0));
        return (p.claimant, p.traitId, p.requestedAt, p.questionHash);
    }

    function verified(address wallet, uint16 id)
        external
        view
        returns (bytes32 requestId, bytes32 oracleRequestId, uint64 fromBlock, uint64 toBlock)
    {
        bytes32 r = _applied[wallet][id] ? _shared[id] : _pairs[wallet][id];
        Request storage p = _requests[r];
        if (p.state != 2) return (bytes32(0), bytes32(0), 0, 0);
        return (r, p.oracleRequestId, p.fromBlock, p.toBlock);
    }

    function composeBody(uint16 id, address claimant) external view returns (bytes memory body, bytes32 questionHash) {
        return IComposer(composer).compose(id, _spec(id), claimant, address(this), curator);
    }

    function registerSpec(Spec calldata s, uint256 expectedId) external nonReentrant returns (uint16 traitId) {
        IComposer(composer).validateSpec(s, block.number);
        traitId = nextSpecId;
        if (traitId == type(uint16).max) revert SpecsExhausted();
        if (expectedId != 0 && expectedId != traitId) revert UnexpectedSpecId(expectedId, traitId);
        _fee(SPEC_FEE);
        _specs[traitId] = s;
        nextSpecId = traitId + 1;
        emit SpecRegistered(traitId, msg.sender);
    }

    function upgrade(uint16[] calldata ids, uint256 maxPrice) external nonReentrant {
        if (ids.length == 0) revert NoTraits();
        if (ids.length > 1) revert TooManyTraits(ids.length);
        uint16 id = ids[0];
        Spec memory s = _spec(id);
        if (s.kind == 3) revert NotASharedFact(id);
        if (hasTrait(msg.sender, id)) revert AlreadyVerified(msg.sender, id);
        if (pendingOf(msg.sender, id) != 0) revert AlreadyPending(msg.sender, id);
        _request(id, s, msg.sender, maxPrice);
    }

    function requestSharedFact(uint16 id, uint256 maxPrice) external nonReentrant {
        if (!_isOracle(id)) revert NotASharedFact(id);
        Spec memory s = specOf(id);
        if (s.kind != 3) revert NotASharedFact(id);
        uint8 state = _requests[_shared[id]].state;
        if (state == 2) revert FactAlreadyStored(id);
        if (state == 1) revert AlreadyPending(address(0), id);
        _request(id, s, address(0), maxPrice);
    }

    function _request(uint16 id, Spec memory s, address claimant, uint256 maxPrice) private {
        uint256 price = IIntake(intake).priceOf(ACTION, imd);
        if (price == 0) revert ZeroPrice();
        if (price > maxPrice) revert PriceAboveMax(price, maxPrice);
        if (s.kind == 6) {
            uint256 h = block.chainid == 1 ? block.number : IComposer(composer).mainnetHeightBound();
            s.toBlock = uint64(h - 64);
        }
        (bytes memory body, bytes32 hash) = IComposer(composer).compose(id, s, claimant, address(this), curator);
        IERC20(imd).safeTransferFrom(msg.sender, address(this), price);
        IERC20(imd).forceApprove(intake, price);
        bytes32 r = IIntake(intake)
            .requestWithFailure(
                ACTION,
                body,
                IIntake.Callback(address(this), this.onResult.selector),
                this.onFailure.selector,
                imd,
                price
            );
        if (r == 0 || _requests[r].state != 0) revert RequestIdTaken(r);
        // Real Intake consumes its allowance. Clear any residue to keep authority exact for an alternative implementation.
        IERC20(imd).forceApprove(intake, 0);
        _requests[r] = Request(
            claimant,
            uint64(block.timestamp),
            id,
            1,
            s.kind,
            hash,
            s.fromBlock,
            s.toBlock,
            uint16(s.kind == 3 ? s.threshold : 0),
            s.threshold,
            bytes32(uint256(1)),
            bytes32(uint256(1))
        );
        if (claimant == address(0)) {
            _shared[id] = r;
        } else {
            _pairs[claimant][id] = r;
            if (id >= 10001) _prepareCommunity(claimant);
        }
        emit TraitRequested(claimant, id, r, hash);
    }

    function _prepareCommunity(address wallet) private {
        if (_communityCountPlusOne[wallet] == 0) _communityCountPlusOne[wallet] = 1;
        _communitySlots[wallet].push(1);
    }

    function sharedPending(uint16 id) external view returns (bytes32) {
        bytes32 r = _shared[id];
        return _requests[r].state == 1 ? r : bytes32(0);
    }

    function sharedFact(uint16 id) external view returns (bytes32 requestId, bytes32 answerHash, uint16 length) {
        bytes32 r = _shared[id];
        Request storage p = _requests[r];
        if (p.state != 2) return (bytes32(0), bytes32(0), 0);
        return (r, p.answerHash, p.head);
    }

    function applySharedFact(uint16 id, address[] calldata list) external nonReentrant {
        bytes32 r = _shared[id];
        Request storage p = _requests[r];
        if (p.state != 2) revert FactNotStored(id);
        if (keccak256(abi.encode(list)) != p.answerHash) revert ListMismatch();
        bool found = false;
        for (uint256 i; i < p.head; ++i) {
            if (list[i] == msg.sender) {
                found = true;
                break;
            }
        }
        if (!found) revert NotInList();
        if (_applied[msg.sender][id]) revert AlreadyVerified(msg.sender, id);
        _applied[msg.sender][id] = true;
        if (id >= 10001) {
            _prepareCommunity(msg.sender);
            _appendCommunity(msg.sender, id);
        }
        _emitVerified(msg.sender, id, r, p.oracleRequestId);
    }

    function abandon(bytes32 id) external nonReentrant {
        Request storage p = _requests[id];
        if (p.state != 1) revert NotPending(id);
        if (p.claimant != address(0) && p.claimant != msg.sender) revert NotClaimant();
        if (block.timestamp <= uint256(p.requestedAt) + ABANDON_AFTER) {
            if (p.claimant == address(0) || !_completed(id)) revert TooEarly();
        }
        p.state = 3;
        emit Abandoned(id);
    }

    function _completed(bytes32 id) private view returns (bool done) {
        (,,, done) = IIntake(intake).requests(id);
    }

    function attestationDigest(OracleAttestation calldata a) public view returns (bytes32) {
        return AttestationHash.digest(a, block.chainid, address(this));
    }

    function onResult(bytes32 id, OracleAttestation calldata a, bytes calldata signature) external {
        if (msg.sender != intake) revert NotIntake();
        Request storage p = _requests[id];
        if (p.state != 1) {
            emit Missed(id, 0, 1);
            return;
        }
        p.state = 3;
        uint8 reason = _check(p, a, signature);
        if (reason != 0) {
            emit Missed(id, p.traitId, reason);
            return;
        }
        _accept(id, p, a);
    }

    function onFailure(bytes32 id, uint8 status, bytes32 reason, uint16 agreed, uint16 answered, bytes calldata)
        external
    {
        if (msg.sender != intake) revert NotIntake();
        Request storage p = _requests[id];
        if (p.state != 1) {
            emit Missed(id, 0, 1);
            return;
        }
        p.state = 3;
        emit NoVerdict(id, p.traitId, status, reason, agreed, answered);
    }

    function settle(bytes32 id, OracleAttestation calldata a, bytes calldata signature) external nonReentrant {
        Request storage p = _requests[id];
        if (p.state != 1) revert NotPending(id);
        if (!_completed(id)) revert NotSettleable(id, 11);
        uint8 reason = _check(p, a, signature);
        if (reason != 0) revert NotSettleable(id, reason);
        p.state = 3;
        _accept(id, p, a);
    }

    function _check(Request storage p, OracleAttestation calldata a, bytes calldata signature)
        private
        view
        returns (uint8)
    {
        if (signature.length != 65) return 2;
        uint8 kind = p.kind;
        if (a.answer.length > 2112 || (kind != 3 && a.answer.length != 32)) return 9;
        if (a.chainId != 1) return 3;
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(attestationDigest(a), signature);
        if (err != ECDSA.RecoverError.NoError || signer == address(0) || signer != attester) return 2;
        if (a.answerType != (kind <= 2 ? 3 : kind == 3 ? 4 : 0)) return 4;
        bool panel = kind == 3 || kind >= 5;
        if (
            a.panelSize != (panel ? 11 : 5) || a.quorum != (panel ? 7 : 3) || a.agreed < a.quorum
                || a.agreed > a.panelSize
        ) return 5;
        if (a.fromBlock != p.fromBlock || a.toBlock != p.toBlock) return 6;
        if (
            block.timestamp > a.expiresAt || a.issuedAt > block.timestamp + 1 hours || a.issuedAt < p.requestedAt
                || uint256(a.issuedAt) > uint256(p.requestedAt) + ISSUE_WINDOW
                || uint256(a.expiresAt) > uint256(a.issuedAt) + VALID_FOR_SECONDS
        ) return 7;
        if (a.questionHash != p.questionHash) return 10;
        if (kind == 3) return _list(a.answer, p.head);
        uint256 word = _word(a.answer, 0);
        if (kind <= 2) return word >= p.threshold ? 0 : 8;
        if (word > 1) return 9;
        return word == 1 ? 0 : 8;
    }

    function _word(bytes calldata data, uint256 offset) private pure returns (uint256 value) {
        assembly ("memory-safe") { value := calldataload(add(data.offset, offset)) }
    }

    function _list(bytes calldata answer, uint16 head) private pure returns (uint8) {
        if (answer.length != 64 + 32 * uint256(head) || _word(answer, 0) != 32 || _word(answer, 32) != head) return 9;
        for (uint256 i; i < head; ++i) {
            uint256 word = _word(answer, 64 + 32 * i);
            if (word < 2 ** 80 || word > type(uint160).max) return 9;
        }
        return 0;
    }

    function _accept(bytes32 id, Request storage p, OracleAttestation calldata a) private {
        p.oracleRequestId = a.requestId;
        p.state = 2;
        if (p.kind == 3) {
            p.answerHash = keccak256(a.answer);
            emit SharedFactStored(p.traitId, id, p.head);
        } else {
            if (p.traitId >= 10001) _appendCommunity(p.claimant, p.traitId);
            _emitVerified(p.claimant, p.traitId, id, a.requestId);
        }
    }

    function _appendCommunity(address wallet, uint16 id) private {
        uint256 n = _communityCountPlusOne[wallet];
        _communitySlots[wallet][n - 1] = id;
        _communityCountPlusOne[wallet] = n + 1;
    }

    function _emitVerified(address wallet, uint16 id, bytes32 r, bytes32 oracleId) private {
        emit Verified(wallet, id, r, oracleId);
        uint256 token = tokenOf[wallet];
        if (token != 0) emit MetadataUpdate(token);
    }
}
