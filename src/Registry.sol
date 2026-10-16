// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {IWhitelistCurator} from "./interfaces/IWhitelistCurator.sol";
import {IIDMD} from "./interfaces/IIDMD.sol";
import {IIntake} from "./interfaces/IIntake.sol";
import {IBurnExecutor} from "./interfaces/IBurnExecutor.sol";
import {IOracleConsumer, OracleAttestation} from "./interfaces/IOracleConsumer.sol";
import {Spec, OracleMeta, Card} from "./Types.sol";
import {Composer} from "./Composer.sol";
import {Renderer} from "./Renderer.sol";

/// @title Sworn registry
/// @notice Ownerless, non-upgradeable ERC-721: one card per wallet, traits as facts about the wallet
///         that minted it. Direct-read traits are evaluated live from the settled WhitelistCurator and
///         IDMD `balanceOf`; oracle traits are stored per (claimant, traitId) after an attestation
///         signed by the IMD oracle passes every check of INTEGRATION.md section 4 inside `onResult`.
/// @dev    No owner, pause, upgrade, fee switch, `receive`, `fallback`, `immutable` or `tx.origin`.
///         All eight dependency addresses are ordinary storage so a clean rebuild equals the deployed
///         runtime code byte for byte (`bytecode_hash = "none"`). The constructor passively checks that
///         the Curator is settled and the Intake quotes a nonzero IMD price for the oracle action.
contract Registry is ERC721, IERC4906, ReentrancyGuard, IOracleConsumer {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    struct Pending {
        address claimant; // zero for a shared fact
        uint16 traitId; // or the fact id
        uint64 requestedAt;
        bytes32 questionHash;
    }

    /// @dev The window is not stored: check 6 made it equal to the trait's canonical (or the spec's)
    ///      window, which `_rule` returns; two cold slots instead of three keep `onResult` in budget.
    struct VerifiedEntry {
        bytes32 requestId;
        bytes32 oracleRequestId;
    }

    struct SharedFact {
        bytes32 requestId;
        bytes32 answerHash;
        bytes32 oracleRequestId;
        uint16 length;
    }

    // ------------------------------------------------------------------ constants (CATALOG.md)

    bytes32 public constant ACTION = bytes32("oracle.request@oracle-1");
    uint256 public constant MINT_FEE = 0.1 ether;
    uint256 public constant SPEC_FEE = 6.4 ether;
    uint256 public constant BURN_MIN = 69 ether;
    uint256 public constant BURN_FEE_CAP = 0.005 ether;
    uint256 internal constant BURN_GAS = 800_000;
    uint256 internal constant ABANDON_AFTER = 14 days;
    uint256 internal constant MAX_SPONSORED = 9;
    uint256 internal constant MAX_COMMUNITY_IN_METADATA = 32;
    uint16 internal constant FIRST_SPEC_ID = 10001;

    uint64 internal constant B_DEPLOY = 0x189378e;
    uint64 internal constant B_FIRST1000 = 0x1893b91;
    uint64 internal constant B_H24 = 0x1895395;
    uint64 internal constant B_END = 0x18984a4;
    uint16 internal constant CHAIN_PANEL = 5;
    uint16 internal constant CHAIN_QUORUM = 3;
    uint16 internal constant PANEL_PANEL = 11;
    uint16 internal constant PANEL_QUORUM = 7;

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("IdentityMD Oracle");
    bytes32 internal constant VERSION_HASH = keccak256("2");
    bytes32 internal constant ATTESTATION_TYPEHASH = keccak256(
        "OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,uint8 answerType,bytes answer,uint256 figure,uint64 fromBlock,uint64 toBlock,bytes32 blockHash,bytes32 panelJobId,uint16 panelSize,uint16 quorum,uint16 agreed,uint64 issuedAt,uint64 expiresAt)"
    );
    uint64 internal constant ISSUED_AT_TOLERANCE = 1 hours;

    // ------------------------------------------------------------------ storage (no immutables)

    IWhitelistCurator public curator;
    IIDMD public idmd;
    IERC20 public imd;
    IIntake public intake;
    address public attester;
    Renderer public renderer;
    Composer public composer;
    uint64 public deployedAt;

    uint256 internal _nextTokenId;
    mapping(address => uint256) public tokenOf;
    mapping(uint256 => address) public claimantOf;
    mapping(uint256 => uint64) public mintedAtBlock;

    mapping(bytes32 => Pending) internal _pending;
    mapping(address => mapping(uint16 => bytes32)) public pendingOf;
    mapping(uint16 => bytes32) public sharedPending;
    mapping(address => mapping(uint16 => VerifiedEntry)) internal _verified;
    mapping(address => uint16[]) internal _specsOf;
    mapping(uint16 => SharedFact) internal _shared;

    mapping(uint16 => Spec) internal _specs;
    uint16 public nextSpecId;

    mapping(address => mapping(uint16 => bool)) public poolUsed;
    mapping(uint256 => uint8) public idmdSponsored;
    mapping(address => uint64) public lastPoolDay;
    IBurnExecutor public burnExecutor;

    // ------------------------------------------------------------------ events

    event CardMinted(address indexed claimant, uint256 indexed tokenId);
    event TraitRequested(address indexed claimant, uint16 indexed traitId, bytes32 requestId, bytes32 questionHash);
    event Verified(address indexed claimant, uint16 indexed traitId, bytes32 requestId, bytes32 oracleRequestId);
    event Missed(bytes32 requestId, uint16 traitId, uint8 reason);
    event NoVerdict(bytes32 requestId, uint16 traitId, uint8 status, bytes32 reason, uint16 agreed, uint16 answered);
    event Abandoned(bytes32 requestId);
    event SpecRegistered(uint16 indexed traitId, address indexed registrant);
    event SharedFactStored(uint16 indexed factId, bytes32 requestId, uint16 length);
    event Sponsored(address indexed from, uint256 amount);
    event PoolSpent(address indexed claimant, uint16 indexed traitId, bytes32 requestId);
    event BurnTriggered(address indexed claimant, uint256 amount, uint256 nativeFee);
    event BurnSkipped(address indexed claimant, uint8 code);

    // ------------------------------------------------------------------ errors

    error ZeroAddress();
    error AlreadyMinted(address claimant);
    error NotIntake();
    error NoTraits();
    error TooManyTraits();
    error NotAnOracleTrait(uint16 traitId);
    error NotASharedFact(uint16 traitId);
    error NotACatalogChainTrait(uint16 traitId);
    error AlreadyVerified(address claimant, uint16 traitId);
    error AlreadyPending(address claimant, uint16 traitId);
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error NotPending(bytes32 requestId);
    error TooEarly();
    error FactAlreadyStored(uint16 factId);
    error FactNotStored(uint16 factId);
    error ListMismatch();
    error NotInList();
    error PoolTooSmall(uint256 pool, uint256 needed);
    error PoolAlreadyUsed(address claimant, uint16 traitId);
    error IdmdSponsorExhausted(uint256 idmdTokenId);
    error PoolDailyLimit(address wallet);
    error NotIdmdHolder(uint256 idmdTokenId);
    error NotMember(address wallet);
    error NoCard(uint256 tokenId);
    error BurnFeeRequired(uint256 nativeFee);
    error BurnRefundFailed();

    // ------------------------------------------------------------------ constructor

    /// @param curator_ WhitelistCurator 0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91
    /// @param idmd_ IdentityMD collection 0x0000ec93127baa929e58e97dd0095a2bfb38ec1d
    /// @param imd_ IMD token 0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7
    /// @param intake_ IMD Intake v2 0xa43e6f75ee006411f79ac1c84120606c2330de82
    /// @param attester_ oracle attester 0x5598aa9146215bc13eb26f2c692ad1461fd32982
    /// @param renderer_ the `Renderer` (no constructor arguments, no storage), deployed first
    /// @param composer_ the `Composer` (no constructor arguments, no storage), deployed first
    /// @param burnExecutor_ IMD BurnExecutor V2; zero disables the burn rule (Sepolia rehearsal)
    /// @dev The renderer and the composer are taken as addresses, not deployed here: with both creation
    ///      codes embedded, the registry's init code exceeded EIP-3860's 49,152 bytes. Three deployments
    ///      (renderer, composer, registry) use static arguments stored in ordinary storage. The only
    ///      external constructor calls are passive Curator settlement and Intake price checks.
    constructor(
        address curator_,
        address idmd_,
        address imd_,
        address intake_,
        address attester_,
        address renderer_,
        address composer_,
        address burnExecutor_
    ) ERC721("Sworn", "SWORN") {
        if (
            curator_ == address(0) || idmd_ == address(0) || imd_ == address(0) || intake_ == address(0)
                || attester_ == address(0) || renderer_ == address(0) || composer_ == address(0)
        ) revert ZeroAddress();
        curator = IWhitelistCurator(curator_);
        require(curator.isSettled(), "Curator not settled");
        require(IIntake(intake_).priceOf(ACTION, imd_) != 0, "Intake price");
        idmd = IIDMD(idmd_);
        imd = IERC20(imd_);
        intake = IIntake(intake_);
        attester = attester_;
        renderer = Renderer(renderer_);
        composer = Composer(composer_);
        burnExecutor = IBurnExecutor(burnExecutor_);
        deployedAt = uint64(block.timestamp);
        nextSpecId = FIRST_SPEC_ID;
    }

    // ------------------------------------------------------------------ cards

    /// @notice Mints the caller's card: 0.1 IMD into the registry, once per wallet.
    function mintCard() external nonReentrant returns (uint256 tokenId) {
        if (tokenOf[msg.sender] != 0) revert AlreadyMinted(msg.sender);
        imd.safeTransferFrom(msg.sender, address(this), MINT_FEE);
        tokenId = ++_nextTokenId;
        tokenOf[msg.sender] = tokenId;
        claimantOf[tokenId] = msg.sender;
        mintedAtBlock[tokenId] = uint64(block.number);
        _mint(msg.sender, tokenId);
        emit CardMinted(msg.sender, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address claimant = claimantOf[tokenId];
        if (claimant == address(0)) revert NoCard(tokenId);
        return renderer.tokenURI(cardOf(tokenId));
    }

    /// @notice The renderer's input for a card, public so a reader can inspect the facts without decoding.
    function cardOf(uint256 tokenId) public view returns (Card memory c) {
        address claimant = claimantOf[tokenId];
        if (claimant == address(0)) revert NoCard(tokenId);
        c.tokenId = tokenId;
        c.claimant = claimant;
        c.traits = traitsOf(claimant);
        for (uint256 i; i < c.traits.length; ++i) {
            uint16 id = c.traits[i];
            uint256 fam = id / 100;
            // Ordinals are independent facts: retain the lowest verified id (the rarest).
            // Other families show their highest tier as the sorted ids are visited.
            if (fam != 11 || c.top[fam - 1] == 0) c.top[fam - 1] = id;
        }
        uint16[] storage specs = _specsOf[claimant];
        c.communityCount = specs.length;
        uint256 shown = specs.length < MAX_COMMUNITY_IN_METADATA ? specs.length : MAX_COMMUNITY_IN_METADATA;
        c.community = new uint16[](shown);
        for (uint256 i; i < shown; ++i) {
            c.community[i] = specs[i];
        }
        // oracle metadata: the true catalog oracle ids (every one is a verified entry), then the shown specs
        uint256 n;
        for (uint256 i; i < c.traits.length; ++i) {
            if (c.traits[i] >= 701) n++;
        }
        c.oracle = new OracleMeta[](n + shown);
        uint256 k;
        for (uint256 i; i < c.traits.length; ++i) {
            if (c.traits[i] >= 701) c.oracle[k++] = _meta(claimant, c.traits[i]);
        }
        for (uint256 i; i < shown; ++i) {
            c.oracle[k++] = _meta(claimant, specs[i]);
        }
    }

    function _meta(address claimant, uint16 traitId) internal view returns (OracleMeta memory m) {
        VerifiedEntry storage v = _verified[claimant][traitId];
        m.traitId = traitId;
        m.requestId = v.requestId;
        m.oracleRequestId = v.oracleRequestId;
        m.spec = specOf(traitId);
        (m.panelSize, m.quorum) = _panelOf(m.spec.kind);
    }

    /// @dev ERC-4906: marketplaces refresh the card on every transfer.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) emit MetadataUpdate(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------ traits

    /// @notice The credential: the live rule for a direct-read trait, the `verified` entry otherwise.
    ///         Needs no card. Unknown ids and the zero address are false, never a revert.
    function hasTrait(address wallet, uint16 traitId) public view returns (bool) {
        if (wallet == address(0)) return false;
        if (_isDirect(traitId)) return composer.hasDirectTrait(wallet, traitId, curator, idmd);
        return _verified[wallet][traitId].requestId != 0;
    }

    /// @notice The catalog ids (all tiers) that are true for a wallet, ascending; no community specs.
    function traitsOf(address wallet) public view returns (uint16[] memory ids) {
        return composer.traitsOf(address(this), wallet);
    }

    function verifiedSpecsOf(address wallet) external view returns (uint16[] memory) {
        return _specsOf[wallet];
    }

    function verified(address claimant, uint16 traitId)
        external
        view
        returns (bytes32 requestId, bytes32 oracleRequestId, uint64 fromBlock, uint64 toBlock)
    {
        VerifiedEntry storage v = _verified[claimant][traitId];
        if (v.requestId == 0) return (0, 0, 0, 0);
        (, fromBlock, toBlock,) = _rule(traitId);
        return (v.requestId, v.oracleRequestId, fromBlock, toBlock);
    }

    /// @notice 0 direct, 1 chain, 2 panel, 3 shared; reverts for an unknown id.
    function traitClass(uint16 traitId) public view returns (uint8) {
        if (_isDirect(traitId)) return 0;
        if (traitId == 1201) return 3;
        if (traitId == 1301) return 2;
        if (_isCatalogChain(traitId)) return 1;
        uint8 kind = _specs[traitId].kind;
        if (kind == 0) revert NotAnOracleTrait(traitId);
        if (kind == 3) return 3;
        if (kind == 5) return 2;
        return 1;
    }

    /// @notice The name table (CATALOG.md section 7); a spec's name for community ids.
    function traitName(uint16 traitId) external view returns (string memory) {
        if (traitId >= FIRST_SPEC_ID) {
            if (_specs[traitId].kind == 0) revert NotAnOracleTrait(traitId);
            return _specs[traitId].name;
        }
        return composer.traitName(traitId);
    }

    function _answerTypeOf(uint8 kind) internal pure returns (uint8) {
        if (kind == 1 || kind == 2) return 3;
        if (kind == 3) return 4;
        return 0;
    }

    function _panelOf(uint8 kind) internal pure returns (uint16, uint16) {
        return kind == 5 ? (PANEL_PANEL, PANEL_QUORUM) : (CHAIN_PANEL, CHAIN_QUORUM);
    }

    function _isDirect(uint16 id) internal pure returns (bool) {
        return id == 101 || id == 201 || id == 202 || (id >= 301 && id <= 303) || (id >= 401 && id <= 404)
            || (id >= 501 && id <= 503) || id == 601;
    }

    function _isCatalogChain(uint16 id) internal pure returns (bool) {
        return id == 701 || id == 801 || id == 901 || id == 1001 || (id >= 1101 && id <= 1105);
    }

    // ------------------------------------------------------------------ catalog as specs

    /// @notice The catalog oracle trait (701 to 1301) or the community spec behind an id, as a Spec.
    function specOf(uint16 traitId) public view returns (Spec memory s) {
        if (traitId >= FIRST_SPEC_ID) {
            s = _specs[traitId];
            if (s.kind == 0) revert NotAnOracleTrait(traitId);
            return s;
        }
        if (!_isCatalogChain(traitId) && traitId != 1201 && traitId != 1301) revert NotAnOracleTrait(traitId);
        return composer.catalogSpec(traitId, address(curator));
    }

    /// @notice The exact body and the plane's `questionHash` for a trait and a claimant; free to call.
    function composeBody(uint16 traitId, address claimant)
        public
        view
        returns (bytes memory body, bytes32 questionHash)
    {
        Spec memory s = specOf(traitId);
        return composer.compose(s, claimant, address(this), traitId == 1301, address(curator));
    }

    /// @notice The plane's `questionHash` of a composed question (the document, not the body).
    function questionHashOf(bytes memory canonicalDocument) external pure returns (bytes32) {
        return keccak256(canonicalDocument);
    }

    // ------------------------------------------------------------------ upgrades (claimant pays)

    /// @notice k oracle requests for the caller, k x `priceOf`, each at most `maxPrice`.
    function upgrade(uint16[] calldata traitIds, uint256 maxPrice) external nonReentrant {
        uint256 k = traitIds.length;
        if (k == 0) revert NoTraits();
        uint256 price = _price(maxPrice);
        imd.safeTransferFrom(msg.sender, address(this), price * k);
        for (uint256 i; i < k; ++i) {
            uint16 id = traitIds[i];
            if (_isDirect(id)) revert NotAnOracleTrait(id);
            if (id == 1201) revert NotASharedFact(id);
            if (id >= FIRST_SPEC_ID) {
                uint8 kind = _specs[id].kind;
                if (kind == 0) revert NotAnOracleTrait(id);
                if (kind == 3) revert NotASharedFact(id);
            } else if (!_isCatalogChain(id) && id != 1301) {
                revert NotAnOracleTrait(id);
            }
            _request(msg.sender, id, price);
        }
    }

    /// @notice Releases a pending pair the plane never completed, 14 days after the request.
    function abandon(bytes32 requestId) external {
        Pending memory p = _pending[requestId];
        if (p.requestedAt == 0) revert NotPending(requestId);
        if (block.timestamp < uint256(p.requestedAt) + ABANDON_AFTER) revert TooEarly();
        _clear(requestId, p);
        emit Abandoned(requestId);
    }

    function pendingRequest(bytes32 requestId)
        external
        view
        returns (address claimant, uint16 traitId, uint64 requestedAt, bytes32 questionHash)
    {
        Pending storage p = _pending[requestId];
        return (p.claimant, p.traitId, p.requestedAt, p.questionHash);
    }

    function _price(uint256 maxPrice) internal view returns (uint256 price) {
        price = intake.priceOf(ACTION, address(imd));
        if (price > maxPrice) revert PriceAboveMax(price, maxPrice);
    }

    /// @dev Composes, pays the Intake from the registry's balance (already pulled or pool money) and
    ///      records the pending pair. `claimant == address(0)` is a shared fact.
    function _request(address claimant, uint16 traitId, uint256 price) internal returns (bytes32 requestId) {
        if (claimant != address(0)) {
            if (_verified[claimant][traitId].requestId != 0) revert AlreadyVerified(claimant, traitId);
            if (pendingOf[claimant][traitId] != 0) revert AlreadyPending(claimant, traitId);
        } else {
            if (_shared[traitId].requestId != 0) revert FactAlreadyStored(traitId);
            if (sharedPending[traitId] != 0) revert AlreadyPending(claimant, traitId);
        }
        (bytes memory body, bytes32 qh) = composeBody(traitId, claimant);
        imd.forceApprove(address(intake), price);
        requestId = intake.requestWithFailure(
            ACTION,
            body,
            IIntake.Callback(address(this), this.onResult.selector),
            this.onFailure.selector,
            address(imd),
            price
        );
        _pending[requestId] = Pending(claimant, traitId, uint64(block.timestamp), qh);
        if (claimant != address(0)) pendingOf[claimant][traitId] = requestId;
        else sharedPending[traitId] = requestId;
        emit TraitRequested(claimant, traitId, requestId, qh);
    }

    /// @dev Clears a pending record and its reverse index only if the index still names this request.
    function _clear(bytes32 requestId, Pending memory p) internal {
        delete _pending[requestId];
        if (p.claimant != address(0)) {
            if (pendingOf[p.claimant][p.traitId] == requestId) delete pendingOf[p.claimant][p.traitId];
        } else if (sharedPending[p.traitId] == requestId) {
            delete sharedPending[p.traitId];
        }
    }

    // ------------------------------------------------------------------ Intake callbacks

    /// @notice Intake v2 `complete`, status 0. Never reverts on an envelope that decodes: every failed
    ///         check is a `Missed(requestId, traitId, reason)` and clears the pair.
    function onResult(bytes32 requestId, OracleAttestation calldata a, bytes calldata signature) external override {
        if (msg.sender != address(intake)) revert NotIntake();
        Pending memory p = _pending[requestId];
        if (p.requestedAt == 0) {
            emit Missed(requestId, 0, 1);
            return;
        }
        _clear(requestId, p);
        (uint8 kind, uint64 fromBlock, uint64 toBlock, uint256 threshold) = _rule(p.traitId);
        uint8 reason = _check(p, a, signature, kind, fromBlock, toBlock);
        if (reason == 0) reason = _decodeAndJudge(a, kind, threshold, p.claimant == address(0));
        if (reason != 0) {
            emit Missed(requestId, p.traitId, reason);
            return;
        }
        if (p.claimant == address(0)) {
            uint16 n = uint16(uint256(bytes32(a.answer[32:64])));
            _shared[p.traitId] = SharedFact(requestId, keccak256(a.answer), a.requestId, n);
            emit SharedFactStored(p.traitId, requestId, n);
            return;
        }
        _mark(p.claimant, p.traitId, requestId, a.requestId);
    }

    /// @notice Intake v2 `complete`, status 1 (refused) or 2 (no verdict). Unsigned: clears, stores nothing.
    function onFailure(bytes32 requestId, uint8 status, bytes32 reason, uint16 agreed, uint16 answered, bytes calldata)
        external
        override
    {
        if (msg.sender != address(intake)) revert NotIntake();
        Pending memory p = _pending[requestId];
        if (p.requestedAt == 0) {
            emit Missed(requestId, 0, 1);
            return;
        }
        _clear(requestId, p);
        emit NoVerdict(requestId, p.traitId, status, reason, agreed, answered);
    }

    /// @dev The template's kind, canonical window and threshold for a pending trait or fact id.
    function _rule(uint16 traitId)
        internal
        view
        returns (uint8 kind, uint64 fromBlock, uint64 toBlock, uint256 threshold)
    {
        if (traitId >= FIRST_SPEC_ID) {
            Spec storage s = _specs[traitId];
            return (s.kind, s.fromBlock, s.toBlock, s.threshold);
        }
        if (traitId == 701) return (1, B_H24, B_END, 1);
        if (traitId == 1105) return (1, B_DEPLOY, B_FIRST1000, 1);
        if (traitId == 1201) return (3, B_DEPLOY, B_END, 32);
        if (traitId == 1301) return (5, B_DEPLOY, B_DEPLOY, 20);
        return (1, B_DEPLOY, B_END, 1);
    }

    /// @dev Bound calldata before any dynamic copy or hash, then validate in INTEGRATION.md order.
    function _check(
        Pending memory p,
        OracleAttestation calldata a,
        bytes calldata signature,
        uint8 kind,
        uint64 fromBlock,
        uint64 toBlock
    ) internal view returns (uint8) {
        if (signature.length != 65) return 2;
        if (a.answer.length > 2112 || (kind != 3 && a.answer.length != 32)) return 9;
        if (a.chainId != block.chainid) return 3;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(attestationDigest(a), v, r, s);
        if (err != ECDSA.RecoverError.NoError || signer == address(0) || signer != attester) return 2;
        if (a.answerType != _answerTypeOf(kind)) return 4;
        (uint16 panelSize, uint16 quorum) = _panelOf(kind);
        if (a.agreed < a.quorum || a.quorum < quorum || a.panelSize < panelSize) return 5;
        if (a.fromBlock != fromBlock || a.toBlock != toBlock) return 6;
        if (block.timestamp > a.expiresAt || a.issuedAt > block.timestamp + ISSUED_AT_TOLERANCE) return 7;
        if (a.questionHash != p.questionHash) return 10;
        return 0;
    }

    /// @dev Check 8: decode defensively, then the rule. Returns 9 (decode), 8 (rule false) or 0.
    function _decodeAndJudge(OracleAttestation calldata a, uint8 kind, uint256 threshold, bool shared)
        internal
        pure
        returns (uint8)
    {
        bytes calldata ans = a.answer;
        if (kind == 3) {
            if (!shared) return 9; // a T3 id never reaches a personal pending record
            if (ans.length < 64) return 9;
            if (uint256(bytes32(ans[0:32])) != 0x20) return 9;
            uint256 n = uint256(bytes32(ans[32:64]));
            if (n < 1 || n > 64 || ans.length != 64 + 32 * n) return 9;
            for (uint256 i; i < n; ++i) {
                if (uint256(bytes32(ans[64 + 32 * i:96 + 32 * i])) >> 160 != 0) return 9;
            }
            return 0;
        }
        // _check already required exactly one word for bool and uint256 kinds.
        uint256 word = uint256(bytes32(ans[0:32]));
        if (kind == 1 || kind == 2) return word >= threshold ? 0 : 8;
        if (word > 1) return 9;
        return word == 1 ? 0 : 8;
    }

    function _mark(address claimant, uint16 traitId, bytes32 requestId, bytes32 oracleRequestId) internal {
        _verified[claimant][traitId] = VerifiedEntry(requestId, oracleRequestId);
        if (traitId >= FIRST_SPEC_ID) _specsOf[claimant].push(traitId);
        emit Verified(claimant, traitId, requestId, oracleRequestId);
        uint256 tokenId = tokenOf[claimant];
        if (tokenId != 0) emit MetadataUpdate(tokenId);
    }

    /// @notice The EIP-712 digest this registry verifies: domain name "IdentityMD Oracle", version "2",
    ///         this chain, this registry as `verifyingContract`. Computed every time; no immutables.
    function attestationDigest(OracleAttestation calldata a) public view returns (bytes32) {
        bytes32 domainSeparator =
            keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    ATTESTATION_TYPEHASH,
                    a.requestId,
                    a.chainId,
                    a.questionHash,
                    a.answerType,
                    keccak256(a.answer),
                    a.figure,
                    a.fromBlock
                ),
                abi.encode(
                    a.toBlock, a.blockHash, a.panelJobId, a.panelSize, a.quorum, a.agreed, a.issuedAt, a.expiresAt
                )
            )
        );
        return MessageHashUtils.toTypedDataHash(domainSeparator, structHash);
    }

    // ------------------------------------------------------------------ community specs

    /// @notice Registers an immutable community spec: 6.4 IMD into the registry, ids from 10001.
    function registerSpec(Spec calldata spec) external nonReentrant returns (uint16 traitId) {
        composer.validateSpec(spec, block.number);
        imd.safeTransferFrom(msg.sender, address(this), SPEC_FEE);
        traitId = nextSpecId++;
        _specs[traitId] = spec;
        emit SpecRegistered(traitId, msg.sender);
    }

    // ------------------------------------------------------------------ shared facts

    /// @notice One chain-proven question for a T3 id, paid once by the caller; no claimant.
    function requestSharedFact(uint16 factId, uint256 maxPrice) external nonReentrant {
        if (_kindOf(factId) != 3) revert NotASharedFact(factId);
        uint256 price = _price(maxPrice);
        imd.safeTransferFrom(msg.sender, address(this), price);
        _request(address(0), factId, price);
    }

    /// @notice Marks `msg.sender` for a stored fact if the supplied list hashes to the stored answer and
    ///         contains the caller within `head`. Gas only; once per claimant and fact.
    function applySharedFact(uint16 factId, address[] calldata list) external {
        SharedFact storage f = _shared[factId];
        if (f.requestId == 0) revert FactNotStored(factId);
        if (keccak256(abi.encode(list)) != f.answerHash) revert ListMismatch();
        if (_verified[msg.sender][factId].requestId != 0) revert AlreadyVerified(msg.sender, factId);
        (,,, uint256 head) = _rule(factId);
        uint256 n = f.length < head ? f.length : head;
        bool found;
        for (uint256 i; i < n; ++i) {
            if (list[i] == msg.sender) {
                found = true;
                break;
            }
        }
        if (!found) revert NotInList();
        _mark(msg.sender, factId, f.requestId, f.oracleRequestId);
    }

    function sharedFact(uint16 factId) external view returns (bytes32 requestId, bytes32 answerHash, uint16 length) {
        SharedFact storage f = _shared[factId];
        return (f.requestId, f.answerHash, f.length);
    }

    function _kindOf(uint16 id) internal view returns (uint8) {
        if (id == 1201) return 3;
        if (id >= FIRST_SPEC_ID) return _specs[id].kind;
        return 0;
    }

    // ------------------------------------------------------------------ sponsor pool

    /// @notice The pool is the registry's IMD balance.
    function pool() public view returns (uint256) {
        return imd.balanceOf(address(this));
    }

    function sponsor(uint256 amount) external nonReentrant {
        imd.safeTransferFrom(msg.sender, address(this), amount);
        emit Sponsored(msg.sender, amount);
    }

    /// @notice An IDMD holder who is a Curator member draws one catalog chain request for their own
    ///         wallet per UTC day across both pool paths; at most nine requests per IDMD token ever.
    function upgradeSponsored(uint256 idmdTokenId, uint16[] calldata traitIds) external payable nonReentrant {
        uint256 k = traitIds.length;
        if (k == 0) revert NoTraits();
        if (k != 1) revert TooManyTraits();
        if (idmdSponsored[idmdTokenId] >= MAX_SPONSORED) revert IdmdSponsorExhausted(idmdTokenId);
        if (idmd.ownerOf(idmdTokenId) != msg.sender) revert NotIdmdHolder(idmdTokenId);
        _requireMember();
        idmdSponsored[idmdTokenId]++;
        _fromPool(traitIds[0]);
    }

    /// @notice From launch, any Curator member draws one catalog chain request for their own wallet
    ///         per UTC day across both pool paths, once per (wallet, traitId) ever.
    function claimSponsored(uint16 traitId) external payable nonReentrant {
        _requireMember();
        _fromPool(traitId);
    }

    function _requireMember() internal view {
        (, bool joined) = curator.firstHourOf(msg.sender);
        if (!joined) revert NotMember(msg.sender);
    }

    function _fromPool(uint16 traitId) internal {
        uint256 price = intake.priceOf(ACTION, address(imd));
        uint256 balance = pool();
        if (balance < price) revert PoolTooSmall(balance, price);
        if (!_isCatalogChain(traitId)) revert NotACatalogChainTrait(traitId);
        if (poolUsed[msg.sender][traitId]) revert PoolAlreadyUsed(msg.sender, traitId);
        uint64 day = uint64(block.timestamp / 1 days);
        if (lastPoolDay[msg.sender] == day) revert PoolDailyLimit(msg.sender);
        lastPoolDay[msg.sender] = day;
        poolUsed[msg.sender][traitId] = true;
        bytes32 requestId = _request(msg.sender, traitId, price);
        _burnOrRefund();
        emit PoolSpent(msg.sender, traitId, requestId);
    }

    /// @dev Best effort after the oracle request. A successful executor force-refunds the claimant;
    ///      otherwise only this call's msg.value is returned, never a pre-existing ETH balance.
    function _burnOrRefund() internal {
        if (address(burnExecutor) != address(0)) {
            try burnExecutor.previewBridge{gas: 200_000}() returns (uint256 amount, uint256, uint256 fee) {
                if (amount >= BURN_MIN) {
                    if (fee > BURN_FEE_CAP) {
                        emit BurnSkipped(msg.sender, 3);
                    } else {
                        if (msg.value < fee) revert BurnFeeRequired(fee);
                        // BURN_GAS is the CALL argument; nonzero value adds the EVM's 2,300 stipend.
                        try burnExecutor.bridgeToBaseBurnReceiver{value: msg.value, gas: BURN_GAS}(amount, msg.sender) {
                            emit BurnTriggered(msg.sender, amount, fee);
                            return;
                        } catch {
                            emit BurnSkipped(msg.sender, 2);
                        }
                    }
                }
            } catch {
                emit BurnSkipped(msg.sender, 1);
            }
        }
        if (msg.value != 0) {
            (bool refunded,) = msg.sender.call{value: msg.value}("");
            if (!refunded) revert BurnRefundFailed();
        }
    }
}
