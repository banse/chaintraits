// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {IWhitelistCurator} from "./interfaces/IWhitelistCurator.sol";
import {IIDMD} from "./interfaces/IIDMD.sol";
import {IIntake} from "./interfaces/IIntake.sol";
import {IBurnExecutor} from "./interfaces/IBurnExecutor.sol";
import {IOracleConsumer, OracleAttestation} from "./interfaces/IOracleConsumer.sol";
import {Spec} from "./Types.sol";
import {Composer} from "./Composer.sol";
import {Renderer} from "./Renderer.sol";

/// @title Sworn registry
/// @notice Ownerless, non-upgradeable ERC-721: one card per wallet, traits as facts about the wallet
///         that minted it. Direct-read traits are evaluated from the settled WhitelistCurator and IDMD
///         `balanceOf`: live for a wallet without a card, frozen at mint for a wallet with one. Oracle
///         traits are stored per (claimant, traitId) after an attestation signed by the IMD oracle passes
///         every check of INTEGRATION.md section 4 inside `onResult`.
/// @dev    No owner, pause, upgrade, fee switch, `receive`, `fallback`, `immutable` or `tx.origin`.
///         All eight dependency addresses are ordinary storage so a clean rebuild equals the deployed
///         runtime code byte for byte (`bytecode_hash = "none"`). Except on the empty dependency floor,
///         the constructor checks IDMD, renderer and composer code, IMD decimals, Curator settlement,
///         the Intake price and nonzero executor code.
///         Holding a card gives no power over it and takes none away from the holder: every mutating
///         entry point acts on `msg.sender`'s own wallet facts, nothing is keyed by the token.
contract Registry is ERC721, IERC4906, ReentrancyGuard, IOracleConsumer {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    struct Pending {
        address claimant; // zero for a shared fact
        uint16 traitId; // or the fact id
        uint64 requestedAt;
        bool sponsored; // drawn from the pool: its `poolUsed` reservation is released on failure
        bytes32 questionHash;
        address payer; // the wallet that paid a shared fact; the only one that may abandon it
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
    /// @notice The most one pool draw may cost, in IMD units: four times the 0.5 IMD launch price.
    uint256 public constant POOL_DRAW_CAP = 2 ether;
    uint256 internal constant BURN_GAS = 800_000;
    /// @dev BurnExecutor V2 catches its inner OFT quote running out of gas and returns (0,0,0) below about
    ///      272,000 gas at the CALL (cold mainnet trace at block 26,202,203: 264,408); 600,000 is 2.2x that.
    uint256 internal constant PREVIEW_GAS = 600_000;
    /// @dev `Composer.VALID_FOR_SECONDS` (30 days) plus one day: an attestation is dead before a pending
    ///      pair can be abandoned, so a late valid answer can never collide with an abandoned request.
    uint256 internal constant ABANDON_AFTER = 31 days;
    uint256 internal constant QUESTION_CHAIN_ID = 1;
    uint256 internal constant MAX_SPONSORED_VERIFIED = 9;
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

    uint256 internal _nextTokenId;
    mapping(address => uint256) public tokenOf;
    mapping(uint256 => address) public claimantOf;
    mapping(uint256 => uint64) public mintedAtBlock;
    /// @notice The direct traits true at mint, one bit per direct trait: bit `(family - 1) * 4 + tier - 1`
    ///         (101 is bit 0, 303 bit 10, 601 "Armed" bit 20). A card's direct traits never change afterwards.
    mapping(uint256 => uint32) public frozenDirect;

    mapping(bytes32 => Pending) internal _pending;
    mapping(address => mapping(uint16 => bytes32)) public pendingOf;
    mapping(uint16 => bytes32) public sharedPending;
    mapping(address => mapping(uint16 => VerifiedEntry)) internal _verified;
    mapping(address => uint16[]) internal _specsOf;
    mapping(uint16 => SharedFact) internal _shared;

    mapping(uint16 => Spec) internal _specs;
    uint16 public nextSpecId;

    mapping(address => mapping(uint16 => bool)) public poolUsed;
    /// @notice Verified sponsored traits per wallet, at most nine for ever.
    mapping(address => uint8) public sponsoredVerified;
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
    /// @notice The burn was skipped: 1 preview unavailable or reverted (or no executor), 2 amount below
    ///         `BURN_MIN`, 3 fee above `BURN_FEE_CAP`, 4 `msg.value` below the fee (attachment refunded,
    ///         the request stands), 5 bridge reverted. `tokenId` is 0 for a claimant without a card.
    event BurnSkipped(uint256 indexed tokenId, uint8 reason);

    // ------------------------------------------------------------------ errors

    error ZeroAddress();
    error AlreadyMinted(address claimant);
    error NotIntake();
    error NoTraits();
    error NotAnOracleTrait(uint16 traitId);
    error NotASharedFact(uint16 traitId);
    error NotACatalogChainTrait(uint16 traitId);
    error AlreadyVerified(address claimant, uint16 traitId);
    error AlreadyPending(address claimant, uint16 traitId);
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error ZeroPrice();
    error PoolDrawTooLarge();
    error NotPending(bytes32 requestId);
    error TooEarly();
    error NotClaimant();
    error FactAlreadyStored(uint16 factId);
    error FactNotStored(uint16 factId);
    error ListMismatch();
    error NotInList();
    error PoolAlreadyUsed(address claimant, uint16 traitId);
    error PoolLifetimeLimit(address wallet);
    error PoolDailyLimit(address wallet);
    error NotMember(address wallet);
    error NoCard(uint256 tokenId);
    error UnexpectedSpecId(uint256 expected, uint256 next);
    error InsufficientGas();
    error BurnRefundFailed();
    error ExecutorHasNoCode();
    error DependencyHasNoCode();

    // ------------------------------------------------------------------ constructor

    /// @param curator_ WhitelistCurator 0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91
    /// @param idmd_ IdentityMD collection 0x0000ec93127baa929e58e97dd0095a2bfb38ec1d
    /// @param imd_ IMD token 0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7
    /// @param intake_ IMD Intake v2 0xa43e6f75ee006411f79ac1c84120606c2330de82
    /// @param attester_ oracle attester 0x5598aa9146215bc13eb26f2c692ad1461fd32982
    /// @param renderer_ the `Renderer` (no constructor arguments, no storage), deployed first
    /// @param composer_ the `Composer` (no constructor arguments, no storage), deployed first
    /// @param burnExecutor_ IMD BurnExecutor; zero disables the burn rule. Outside the empty floor, a
    ///        nonzero address must have code: the preview's three return words are decoded outside the
    ///        try/catch, so an executor without code would revert every sponsored claim for ever.
    /// @dev The renderer and the composer are taken as addresses, not deployed here: with both creation
    ///      codes embedded, the registry's init code exceeded EIP-3860's 49,152 bytes. Three deployments
    ///      (renderer, composer, registry) use static arguments stored in ordinary storage. The only
    ///      external constructor calls are passive Curator settlement, IMD decimals and Intake price reads;
    ///      IDMD, the renderer, the composer and a nonzero executor are checked for code. These checks are
    ///      skipped only when Curator, IDMD, IMD and Intake all lack code, for the launch pipeline's
    ///      empty-chain floor.
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
        bool floor =
            curator_.code.length == 0 && idmd_.code.length == 0 && imd_.code.length == 0 && intake_.code.length == 0;
        if (!floor) {
            if (idmd_.code.length == 0 || renderer_.code.length == 0 || composer_.code.length == 0) {
                revert DependencyHasNoCode();
            }
            require(curator.isSettled(), "Curator not settled");
            require(IERC20Metadata(imd_).decimals() == 18, "IMD decimals");
            require(IIntake(intake_).priceOf(ACTION, imd_) != 0, "Intake price");
            if (burnExecutor_ != address(0) && burnExecutor_.code.length == 0) revert ExecutorHasNoCode();
        }
        idmd = IIDMD(idmd_);
        imd = IERC20(imd_);
        intake = IIntake(intake_);
        attester = attester_;
        renderer = Renderer(renderer_);
        composer = Composer(composer_);
        burnExecutor = IBurnExecutor(burnExecutor_);
        nextSpecId = FIRST_SPEC_ID;
    }

    // ------------------------------------------------------------------ cards

    /// @notice Mints the caller's card: 0.1 IMD into the registry, once per wallet. Every direct trait
    ///         (the Curator-read kinds and 601 "Armed", an IDMD seat held now) is evaluated once here and
    ///         frozen on the card.
    function mintCard() external nonReentrant returns (uint256 tokenId) {
        if (tokenOf[msg.sender] != 0) revert AlreadyMinted(msg.sender);
        imd.safeTransferFrom(msg.sender, address(this), MINT_FEE);
        tokenId = ++_nextTokenId;
        tokenOf[msg.sender] = tokenId;
        claimantOf[tokenId] = msg.sender;
        mintedAtBlock[tokenId] = uint64(block.number);
        frozenDirect[tokenId] = composer.directSnapshot(msg.sender, curator, idmd);
        _mint(msg.sender, tokenId);
        emit CardMinted(msg.sender, tokenId);
    }

    /// @notice Cards minted so far; none is ever burned.
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice The card's metadata, drawn by the renderer from this registry's public reads
    ///         (`claimantOf`, `traitsOf`, `verifiedSpecsOf`, `verified` and `specOf`).
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (claimantOf[tokenId] == address(0)) revert NoCard(tokenId);
        return renderer.tokenURIOf(address(this), tokenId);
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

    /// @notice The credential: for a direct-read trait the card's snapshot when the wallet minted one,
    ///         else the live rule (601 needs a card); the `verified` entry otherwise. Needs no card.
    ///         Unknown ids and the zero address are false, never a revert.
    function hasTrait(address wallet, uint16 traitId) public view returns (bool) {
        if (wallet == address(0)) return false;
        if (_isDirect(traitId)) return hasDirectTrait(wallet, traitId);
        return _verified[wallet][traitId].requestId != 0;
    }

    /// @notice A direct trait: frozen at mint for a wallet with a card, live for one without
    ///         (601 "Armed" is a snapshot only: false without a card). False for a non-direct id.
    function hasDirectTrait(address wallet, uint16 traitId) public view returns (bool) {
        if (!_isDirect(traitId)) return false;
        uint256 tokenId = tokenOf[wallet];
        if (tokenId != 0) return frozenDirect[tokenId] & (1 << ((traitId / 100 - 1) * 4 + traitId % 100 - 1)) != 0;
        if (traitId == 601) return false;
        return
            composer.directSnapshot(wallet, curator, idmd) & (1 << ((traitId / 100 - 1) * 4 + traitId % 100 - 1)) != 0;
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

    /// @notice The name table (CATALOG.md section 7); a spec's name for community ids.
    function traitName(uint16 traitId) external view returns (string memory) {
        if (traitId >= FIRST_SPEC_ID) {
            if (_specs[traitId].kind == 0) revert NotAnOracleTrait(traitId);
            return _specs[traitId].name;
        }
        return renderer.traitName(traitId);
    }

    function _answerTypeOf(uint8 kind) internal pure returns (uint8) {
        if (kind == 1 || kind == 2) return 3;
        if (kind == 3) return 4;
        return 0;
    }

    /// @dev Kinds 1, 2 and 4 ask a 5 / 3 panel; kind 3 (a ranked list) and kind 5 (panel evidence) 11 / 7.
    function _panelOf(uint8 kind) internal pure returns (uint16, uint16) {
        return kind == 3 || kind == 5 ? (PANEL_PANEL, PANEL_QUORUM) : (CHAIN_PANEL, CHAIN_QUORUM);
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
    /// @dev A catalog id's spec is the Composer's answer returned as it came (no decode and re-encode here).
    function specOf(uint16 traitId) external view returns (Spec memory s) {
        if (traitId >= FIRST_SPEC_ID) return _spec(traitId);
        bytes memory ret = _catalogSpecRaw(traitId);
        assembly ("memory-safe") {
            return(add(ret, 0x20), mload(ret))
        }
    }

    /// @notice The exact body and the plane's `questionHash` for a trait and a claimant; free to call.
    function composeBody(uint16 traitId, address claimant)
        public
        view
        returns (bytes memory body, bytes32 questionHash)
    {
        Spec memory s;
        if (traitId >= FIRST_SPEC_ID) s = _spec(traitId);
        else _checkCatalogOracle(traitId);
        return composer.compose(traitId, s, claimant, address(this), address(curator));
    }

    function _spec(uint16 traitId) internal view returns (Spec memory s) {
        s = _specs[traitId];
        if (s.kind == 0) revert NotAnOracleTrait(traitId);
    }

    function _checkCatalogOracle(uint16 traitId) internal pure {
        if (!_isCatalogChain(traitId) && traitId != 1201 && traitId != 1301) revert NotAnOracleTrait(traitId);
    }

    /// @dev The ABI-encoded `Spec` of a catalog oracle trait, straight from the Composer.
    function _catalogSpecRaw(uint16 traitId) internal view returns (bytes memory ret) {
        _checkCatalogOracle(traitId);
        bool ok;
        (ok, ret) = address(composer).staticcall(abi.encodeCall(composer.catalogSpec, (traitId, address(curator))));
        if (!ok) revert NotAnOracleTrait(traitId);
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
            _request(msg.sender, id, price, false);
        }
    }

    /// @notice Releases a pending pair the plane never completed, 31 days after the request (one day
    ///         after any attestation for it has expired). Only its claimant may abandon a personal pair;
    ///         only its payer may abandon a shared fact. A sponsored pair's trait reservation is released.
    function abandon(bytes32 requestId) external {
        Pending memory p = _pending[requestId];
        if (p.requestedAt == 0) revert NotPending(requestId);
        if (block.timestamp < uint256(p.requestedAt) + ABANDON_AFTER) revert TooEarly();
        if (msg.sender != (p.claimant != address(0) ? p.claimant : p.payer)) revert NotClaimant();
        _clear(requestId, p);
        _release(p);
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
        if (price == 0) revert ZeroPrice();
        if (price > maxPrice) revert PriceAboveMax(price, maxPrice);
    }

    /// @dev Composes, pays the Intake from the registry's balance (already pulled or pool money) and
    ///      records the pending pair. `claimant == address(0)` is a shared fact paid by `msg.sender`.
    ///      Intake v2 pulls the fee inside `request` (`_collect`, `safeTransferFrom` in the same call), so
    ///      each call's `forceApprove` is consumed before the next one is set.
    function _request(address claimant, uint16 traitId, uint256 price, bool sponsored)
        internal
        returns (bytes32 requestId)
    {
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
        _pending[requestId] = Pending(
            claimant, traitId, uint64(block.timestamp), sponsored, qh, claimant == address(0) ? msg.sender : address(0)
        );
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

    /// @dev A pool-drawn request that ends without a verified trait gives its (wallet, trait) reservation
    ///      back; the UTC day stays consumed.
    function _release(Pending memory p) internal {
        if (p.sponsored) delete poolUsed[p.claimant][p.traitId];
    }

    // ------------------------------------------------------------------ Intake callbacks

    /// @notice Intake v2 `complete`, status 0. Never reverts on an envelope that decodes: every failed
    ///         check is a `Missed(requestId, traitId, reason)` and clears the pair.
    /// @dev    Clears first, then checks: the Intake completes a request exactly once and records a
    ///         callback revert as not delivered, so a retained record could only lock the pair until
    ///         `abandon`. A `Missed` request is over; its claimant may request again at once, and a
    ///         replay of a consumed attestation misses with reason 1.
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
            _release(p);
            emit Missed(requestId, p.traitId, reason);
            return;
        }
        if (p.claimant == address(0)) {
            uint16 n = uint16(uint256(bytes32(a.answer[32:64])));
            _shared[p.traitId] = SharedFact(requestId, keccak256(a.answer), a.requestId, n);
            emit SharedFactStored(p.traitId, requestId, n);
            return;
        }
        if (p.sponsored) sponsoredVerified[p.claimant]++;
        _mark(p.claimant, p.traitId, requestId, a.requestId);
    }

    /// @notice Intake v2 `complete`, status 1 (refused) or 2 (no verdict). Unsigned and Intake-attributed:
    ///         the plane documents no failure signature, so none is verified; the call clears the pair
    ///         (and a sponsored reservation) and stores nothing, on a call from the Intake only.
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
        _release(p);
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
        if (a.chainId != QUESTION_CHAIN_ID) return 3;
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

    /// @dev Check 8: decode defensively, then the rule. Returns 9 (decode), 8 (rule false) or 0. A kind-3
    ///      answer is a complete list of exactly `threshold` (the head) addresses or it is a decode miss.
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
            // V2 item 8: exactly `head` addresses (32 for 1201, the spec's threshold for a community T3).
            uint256 n = uint256(bytes32(ans[32:64]));
            if (n != threshold || ans.length != 64 + 32 * n) return 9;
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
    /// @param expectedId the id the caller expects (what `nextSpecId` read); 0 to take whatever is next.
    function registerSpec(Spec calldata spec, uint256 expectedId) external nonReentrant returns (uint16 traitId) {
        traitId = nextSpecId;
        if (expectedId != 0 && expectedId != traitId) revert UnexpectedSpecId(expectedId, traitId);
        composer.validateSpec(spec, block.number);
        imd.safeTransferFrom(msg.sender, address(this), SPEC_FEE);
        nextSpecId = traitId + 1;
        _specs[traitId] = spec;
        emit SpecRegistered(traitId, msg.sender);
    }

    // ------------------------------------------------------------------ shared facts

    /// @notice One chain-proven question for a T3 id, paid once by the caller; no claimant.
    function requestSharedFact(uint16 factId, uint256 maxPrice) external nonReentrant {
        if (_kindOf(factId) != 3) revert NotASharedFact(factId);
        uint256 price = _price(maxPrice);
        imd.safeTransferFrom(msg.sender, address(this), price);
        _request(address(0), factId, price, false);
    }

    /// @notice Marks `msg.sender` for a stored fact if the supplied list hashes to the stored answer and
    ///         contains the caller (the list is exactly `head` long). Gas only; once per claimant and fact.
    function applySharedFact(uint16 factId, address[] calldata list) external {
        SharedFact storage f = _shared[factId];
        if (f.requestId == 0) revert FactNotStored(factId);
        if (keccak256(abi.encode(list)) != f.answerHash) revert ListMismatch();
        if (_verified[msg.sender][factId].requestId != 0) revert AlreadyVerified(msg.sender, factId);
        // a stored list is exactly `head` long (V2 item 8), so the whole of it counts
        bool found;
        for (uint256 i; i < f.length; ++i) {
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

    /// @notice Any Curator member draws one catalog chain request for their own wallet per UTC calendar
    ///         day, once per trait, nine verified sponsored traits per wallet for ever; the price must be
    ///         at most `maxPrice`, an eighth of the pool and `POOL_DRAW_CAP`. The burn rule runs after.
    function claimSponsored(uint16 traitId, uint256 maxPrice) external payable nonReentrant {
        (, bool joined) = curator.firstHourOf(msg.sender);
        if (!joined) revert NotMember(msg.sender);
        uint256 price = _price(maxPrice);
        if (price > pool() / 8 || price > POOL_DRAW_CAP) revert PoolDrawTooLarge();
        if (!_isCatalogChain(traitId)) revert NotACatalogChainTrait(traitId);
        if (poolUsed[msg.sender][traitId]) revert PoolAlreadyUsed(msg.sender, traitId);
        if (sponsoredVerified[msg.sender] >= MAX_SPONSORED_VERIFIED) revert PoolLifetimeLimit(msg.sender);
        uint64 day = uint64(block.timestamp / 1 days);
        if (lastPoolDay[msg.sender] == day) revert PoolDailyLimit(msg.sender);
        lastPoolDay[msg.sender] = day;
        poolUsed[msg.sender][traitId] = true;
        bytes32 requestId = _request(msg.sender, traitId, price, true);
        _burnOrRefund();
        emit PoolSpent(msg.sender, traitId, requestId);
    }

    /// @dev Best effort after the oracle request; never undoes it. Forwards exactly the quoted fee and
    ///      refunds the rest of `msg.value` first; every skipped path emits `BurnSkipped` and returns the
    ///      attachment. A successful executor force-refunds its own surplus to the claimant. Only this
    ///      call's `msg.value` is ever returned, never a pre-existing ETH balance.
    function _burnOrRefund() internal {
        uint256 tokenId = tokenOf[msg.sender];
        uint8 reason = 1;
        if (address(burnExecutor) != address(0)) {
            if (gasleft() < (PREVIEW_GAS + BURN_GAS) * 64 / 63 + 50_000) revert InsufficientGas();
            try burnExecutor.previewBridge{gas: PREVIEW_GAS}() returns (uint256 amount, uint256, uint256 fee) {
                if (amount < BURN_MIN) {
                    reason = 2;
                } else if (fee > BURN_FEE_CAP) {
                    reason = 3;
                } else if (msg.value < fee) {
                    reason = 4;
                } else {
                    if (msg.value > fee) _refund(msg.value - fee);
                    // BURN_GAS is the CALL argument; nonzero value adds the EVM's 2,300 stipend.
                    try burnExecutor.bridgeToBaseBurnReceiver{value: fee, gas: BURN_GAS}(amount, msg.sender) {
                        emit BurnTriggered(msg.sender, amount, fee);
                        return;
                    } catch {
                        emit BurnSkipped(tokenId, 5);
                        if (fee != 0) _refund(fee);
                        return;
                    }
                }
            } catch {}
        }
        emit BurnSkipped(tokenId, reason);
        if (msg.value != 0) _refund(msg.value);
    }

    function _refund(uint256 amount) internal {
        (bool refunded,) = msg.sender.call{value: amount}("");
        if (!refunded) revert BurnRefundFailed();
    }
}
