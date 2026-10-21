// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

struct Spec {
    uint8 kind;
    address target;
    string item;
    string arg;
    string fixedArg;
    uint256 fixedVal;
    string sumArg;
    uint8 op;
    uint256 threshold;
    uint64 fromBlock;
    uint64 toBlock;
    string name;
}

// Protocol field order and type string: supplied INTEGRATION.md section 4.
struct OracleAttestation {
    bytes32 requestId;
    uint256 chainId;
    bytes32 questionHash;
    uint8 answerType;
    bytes answer;
    uint256 figure;
    uint64 fromBlock;
    uint64 toBlock;
    bytes32 blockHash;
    bytes32 panelJobId;
    uint16 panelSize;
    uint16 quorum;
    uint16 agreed;
    uint64 issuedAt;
    uint64 expiresAt;
}

interface ICurator {
    function isSettled() external view returns (bool);
    function firstHourOf(address) external view returns (uint256, bool);
    function txCountOf(address) external view returns (uint256);
    function contributedBy(address) external view returns (uint256);
    function pointsOf(address) external view returns (uint256);
}

interface IIntake {
    struct Callback {
        address target;
        bytes4 selector;
    }
    function priceOf(bytes32, address) external view returns (uint256);
    function requestWithFailure(bytes32, bytes calldata, Callback calldata, bytes4, address, uint256)
        external
        returns (bytes32);
    function requests(bytes32) external view returns (address, address, bytes4, bool);
}

interface IComposer {
    function compose(uint16, Spec calldata, address, address, address) external view returns (bytes memory, bytes32);
    function catalogSpec(uint16, address) external pure returns (Spec memory);
    function validateSpec(Spec calldata, uint256) external view;
    function directSnapshot(address, address) external view returns (uint32);
    function traitsOf(address, address) external view returns (uint16[] memory);
    function mainnetHeightBound() external view returns (uint256);
}

interface IRenderer {
    function tokenURIOf(address, uint256) external view returns (string memory);
    function traitName(uint16) external pure returns (string memory);
}

interface IRegistryView {
    function claimantOf(uint256) external view returns (address);
    function tokenOf(address) external view returns (uint256);
    function hasTrait(address, uint16) external view returns (bool);
    function traitsOf(address) external view returns (uint16[] memory);
    function verifiedSpecsOf(address) external view returns (uint16[] memory);
    function specOf(uint16) external view returns (Spec memory);
    function verified(address, uint16) external view returns (bytes32, bytes32, uint64, uint64);
}
