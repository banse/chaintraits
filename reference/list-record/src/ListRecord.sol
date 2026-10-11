// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IWhitelistCurator} from "./interfaces/IWhitelistCurator.sol";
import {CardData, IListRecordRenderer} from "./interfaces/IListRecordRenderer.sol";

/// @notice A permanent, permissionless record of one wallet's participation in THE LIST.
/// @dev No owner, no admin function, no pause, no mint price, no withdraw.
contract ListRecord is IERC4906, ERC721 {
    /// @dev ERC-4906 defines only events, so it has no conventional interface id. This is the
    ///      constant the standard itself names, and the same one OZ's ERC721URIStorage reports.
    bytes4 private constant ERC4906_INTERFACE_ID = bytes4(0x49064906);
    bytes32 internal constant FILTER_LEAF_V1 = keccak256(bytes("THE_LIST_RECORD_ELIGIBILITY_V1"));

    IWhitelistCurator public immutable LIST;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    IListRecordRenderer public immutable renderer;
    /// @dev = LIST.gracePeriod() / LIST.hourDuration(), read at construction. Never a remembered 24.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 public immutable graceHours;
    bytes32 public immutable eligibilityRoot;
    bytes32 public immutable filterBasisHash;
    uint32 public immutable eligibleCount;

    /// @notice Last minted id. Ids are sequential from 1, so an id IS its claim order.
    uint256 public totalClaimed;
    /// @notice 0 while unclaimed. Its non-zero value is also the double-claim guard.
    mapping(address => uint256) public tokenOf;
    /// @notice The wallet that claimed the token. Never changes, even when the token is sold.
    mapping(uint256 => address) public claimantOf;
    /// @notice The GAME hour at which the token was claimed. Not the claimant's join hour.
    mapping(uint256 => uint32) public claimedAtHour;
    /// @notice The proof-authenticated 1-based FirstDeposit event index.
    mapping(uint256 => uint32) public joinIndexOf;

    error InvalidList();
    error InvalidRenderer();
    error InvalidEligibilityRoot();
    error InvalidFilterBasisHash();
    error InvalidEligibleCount();
    error NotAMember();
    error InvalidEligibilityProof();
    error AlreadyClaimed();
    error NotSettled();
    error NonexistentToken();

    event Claimed(address indexed member, uint256 indexed tokenId, uint32 claimedAtHour, uint32 joinIndex);

    constructor(
        address list_,
        address renderer_,
        bytes32 eligibilityRoot_,
        bytes32 filterBasisHash_,
        uint32 eligibleCount_
    ) ERC721("THE LIST", "LIST") {
        if (list_ == address(0) || list_.code.length == 0) revert InvalidList();
        if (renderer_ == address(0) || renderer_.code.length == 0) revert InvalidRenderer();
        if (eligibilityRoot_ == bytes32(0)) revert InvalidEligibilityRoot();
        if (filterBasisHash_ == bytes32(0)) revert InvalidFilterBasisHash();
        if (eligibleCount_ == 0) revert InvalidEligibleCount();

        IWhitelistCurator list = IWhitelistCurator(list_);
        uint256 duration = list.hourDuration();
        if (duration == 0) revert InvalidList();
        if (!list.isSettled()) revert NotSettled();

        LIST = list;
        renderer = IListRecordRenderer(renderer_);
        graceHours = list.gracePeriod() / duration;
        eligibilityRoot = eligibilityRoot_;
        filterBasisHash = filterBasisHash_;
        eligibleCount = eligibleCount_;
    }

    function isEligible(address member, uint32 joinIndex, bytes32[] calldata proof) external view returns (bool) {
        (, bool hasJoined) = LIST.firstHourOf(member);
        return hasJoined && MerkleProof.verifyCalldata(proof, eligibilityRoot, _eligibilityLeaf(member, joinIndex));
    }

    function _eligibilityLeaf(address member, uint32 joinIndex) internal view returns (bytes32) {
        return _eligibilityLeafFor(block.chainid, address(LIST), filterBasisHash, member, joinIndex);
    }

    function _eligibilityLeafFor(uint256 chainId, address list, bytes32 basis, address member, uint32 joinIndex)
        internal
        pure
        returns (bytes32)
    {
        bytes32 inner = keccak256(abi.encode(FILTER_LEAF_V1, chainId, list, basis, member, joinIndex));
        return keccak256(bytes.concat(inner));
    }

    function claim(uint32 joinIndex, bytes32[] calldata proof) external returns (uint256 tokenId) {
        address member = msg.sender;
        (, bool hasJoined) = LIST.firstHourOf(member);
        if (!hasJoined) revert NotAMember();
        if (!MerkleProof.verifyCalldata(proof, eligibilityRoot, _eligibilityLeaf(member, joinIndex))) {
            revert InvalidEligibilityProof();
        }
        if (tokenOf[member] != 0) revert AlreadyClaimed();

        uint32 claimHour = SafeCast.toUint32(LIST.currentHour());
        unchecked {
            tokenId = ++totalClaimed;
        }

        tokenOf[member] = tokenId;
        claimantOf[tokenId] = member;
        claimedAtHour[tokenId] = claimHour;
        joinIndexOf[tokenId] = joinIndex;

        emit Claimed(member, tokenId, claimHour, joinIndex);
        _mint(member, tokenId);
    }

    /// @notice Metadata for one record.
    /// @dev Membership and the join hour come from firstHourOf(). The game's raw
    ///      contributors() getter returns firstHour + 1 with 0 meaning "never deposited", so
    ///      reading that instead renders every non-member as an hour-0 founder.  It is not on
    ///      IWhitelistCurator and must never be added.
    function tokenURI(uint256 id) public view override returns (string memory) {
        address holder = _ownerOf(id);
        if (holder == address(0)) revert NonexistentToken();

        address who = claimantOf[id];
        uint32 joinIndex = joinIndexOf[id];
        uint32 claimHour = claimedAtHour[id];

        uint256 points = LIST.pointsOf(who);
        uint256 weightWei = LIST.weightOf(who);
        uint256 rawContributed = LIST.contributedBy(who);
        uint256 cap = LIST.creditCap();
        uint256 deposits = LIST.txCountOf(who);
        (uint256 hour,) = LIST.firstHourOf(who);

        CardData memory d;
        d.id = id;
        d.claimant = who;
        d.owner = holder;
        d.points = points;
        d.weightWei = weightWei;
        d.creditWei = rawContributed < cap ? rawContributed : cap;
        d.deposits = deposits;
        d.hour = hour;
        d.joinIndex = joinIndex;
        d.claimedAtHour = claimHour;
        d.grace = hour < graceHours;

        return renderer.tokenURI(d);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, IERC165) returns (bool) {
        return interfaceId == ERC4906_INTERFACE_ID || super.supportsInterface(interfaceId);
    }

    /// @dev A sale changes `Held by claimant`, so the metadata really did change. Mints are skipped
    ///      (`from == address(0)`): there is no prior metadata for a marketplace to refresh.
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) emit MetadataUpdate(tokenId);
    }
}
