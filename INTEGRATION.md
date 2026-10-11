# INTEGRATION.md: the Intake, the attestation, the external contracts

Everything the registry talks to, as measured on Ethereum mainnet on 2026-10-10/11. Sources are vendored under
`reference/` (see `reference/PROVENANCE.md`). Where this file and a skill disagree, re-read the verified source
in `reference/Intake.sol`; it is the contract that runs.

## 1. Addresses (Ethereum mainnet, chainId 1)

| what | address |
|---|---|
| WhitelistCurator (THE LIST) | `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` |
| IdentityMD collection (IDMD, ERC-721, 2,000 tokens) | `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` |
| IMD token (ERC-20, 18 decimals, a LayerZero OFT, **no `permit`**) | `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` |
| IMD Intake (pay and ask in one transaction) | `0x1397434cd35e8a9c8ac312a61d3a285eb31dea56` |
| oracle attester (signs attestations) | `0x5598aa9146215bc13eb26f2c692ad1461fd32982` |
| Intake writer (calls `complete`) | `0x3d3c0df7c1a17d384545e9d7c8228897bd9625cb` |

The registry takes Curator, IDMD, IMD, Intake and attester as constructor arguments (static addresses; the launch
pipeline allows only static address, uint, bool and bytes32 arguments, at most 16, and passive constructors). The
writer is not a constructor argument: the registry trusts the Intake as `msg.sender` of the callback and the
attester as the signer, never the writer.

## 2. Asking: `Intake.request`

```solidity
struct Callback { address target; bytes4 selector; }
function request(bytes32 action, bytes calldata body, Callback calldata callback, address asset, uint256 amount)
    external payable returns (bytes32 requestId);
function priceOf(bytes32 action, address asset) external view returns (uint256);
function callbackGas() external view returns (uint64);
```

- `action` is the action name, an at sign and the version, as a right-padded `bytes32`:
  **`oracle.request@oracle-1`** = `0x6f7261636c652e72657175657374406f7261636c652d31000000000000000000`.
  `priceOf(action, IMD)` returned `500000000000000000` (0.5 IMD) on 2026-10-11; the other spellings return 0 and
  `request` reverts `ActionNotSold`. Read `priceOf` at call time and pay exactly that: the registry must never
  hard-code 0.5 IMD, and the claimant's `upgrade` charges `k * priceOf(...)`.
- `body` is the UTF-8 JSON of `TEMPLATES.md`, at most `MAX_BODY_BYTES` = 16,384 bytes.
- `asset` is the IMD token; the Intake pulls `amount` with `transferFrom`, so the registry approves the Intake for
  the amount (or holds an allowance) before calling. The claimant approves the registry; the registry pulls, then
  forwards.
- `requestId = keccak256(abi.encode(block.chainid, address(intake), ++nonce))` is returned and emitted in
  `Requested(requestId, payer, action, body, callbackTarget, callbackSelector, asset, amount)`.
- The plane reads `Requested`, admits or refuses the body, runs the panel, and the writer calls `complete`.

## 3. Answering: what reaches `onResult`

```solidity
function complete(bytes32 requestId, uint8 status, bytes32 resultHash, string calldata uri, bytes calldata args)
```

`status` 0 = a result, 1 = refused, 2 = ended without a result (a panel that disagreed, `not_answerable`). **Only
status 0 calls the callback.** The Intake sends `bytes.concat(callback.selector, args)` to `callback.target` with a
fixed gas stipend of **`callbackGas()` = 200,000** (read it; it is settable by the Intake's owner), no value, and
records `delivered` without reverting the writer's transaction. A callback that reverts or runs out of gas is
simply `delivered == false`: the request is still `completed` and will never be retried. Hence:

- `onResult` must finish well inside 200,000 gas: one `ecrecover` (3,000), a few `sload`s, one or two `sstore`s, one
  event. No loops over unbounded data except the `head`-bounded list of T3 (32 addresses, stored as a fixed array
  or a mapping, measured).
- `onResult` never reverts on bad input; it records a miss (`Missed(requestId, traitId, reason)`) and returns.
- For status 1 and 2 nothing arrives; the pending record stays until `abandon(requestId)` after 14 days.

For `oracle.request` the `args` are `abi.encode(bytes32 requestId, OracleAttestation a, bytes signature)`, so the
consumer's function is:

```solidity
function onResult(bytes32 requestId, OracleAttestation calldata a, bytes calldata signature) external;
```

and the registry checks `msg.sender == intake` first.

## 4. The attestation

EIP-712, domain `{ name: "IdentityMD Oracle", version: "2", chainId: 1, verifyingContract: <the consumer> }`.
`verifyingContract` is the registry's own address for requests the registry sends (it was the zero address in the
two pilots, which had no callback). Primary type and field order, from two attestations served on mainnet:

```solidity
struct OracleAttestation {
    bytes32 requestId;
    uint256 chainId;
    bytes32 questionHash;
    uint8   answerType;     // 0 bool, 1 address, 2 bytes32, 3 uint256, 4 address[], 5 bytes32[]
    bytes   answer;         // abi.encode of the value: bool -> 32 bytes 0/1; uint256 -> 32 bytes; address[] -> abi.encode(address[])
    uint256 figure;         // the number behind the answer (a sum, a count) where there is one
    uint64  fromBlock;
    uint64  toBlock;
    bytes32 blockHash;      // the hash of toBlock, pinned by the plane at admission
    bytes32 panelJobId;
    uint16  panelSize;
    uint16  quorum;
    uint16  agreed;
    uint64  issuedAt;
    uint64  expiresAt;
}
```

Type string for the struct hash:
`OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,uint8 answerType,bytes answer,uint256 figure,uint64 fromBlock,uint64 toBlock,bytes32 blockHash,bytes32 panelJobId,uint16 panelSize,uint16 quorum,uint16 agreed,uint64 issuedAt,uint64 expiresAt)`
(`bytes answer` hashes as `keccak256(answer)` per EIP-712). The signature is 65 bytes r, s, v; use
OpenZeppelin `ECDSA.recover` plus `EIP712._hashTypedDataV4` with the registry as the domain's verifying contract.

What the registry verifies before marking a trait (`CATALOG.md` section 4):

1. `msg.sender == intake`; `a.requestId == requestId`; `pending[requestId]` exists and is unconsumed.
2. `a.chainId == block.chainid`; the recovered signer == attester.
3. `a.answerType` equals the template's type; `a.agreed >= a.quorum` and `a.quorum >= the template's quorum`
   (3 for chain, 7 for panel); `a.panelSize >= the template's panel size`.
4. `a.fromBlock` and `a.toBlock` equal the trait's canonical window (or the spec's stored window).
5. `a.issuedAt <= block.timestamp <= a.expiresAt`.
6. The decoded answer passes the rule: `>= threshold`, `== true`, or the list contains the claimant within `head`.
7. `questionHash`: the plane's hash function over the body is not documented and is **not** `keccak256(body)`;
   the registry does not recompute it. The binding is `requestId`, which the registry itself received from
   `request` and stored with `(claimant, traitId)`.

Measured traps that shaped these rules: panel members mis-convert decimal block numbers (hence hex in every text);
`rpc.flashbots.net` and `cloudflare-eth.com` answer `null` for mined transactions (hence "null is not evidence" in
panel definitions); three of the first seven Ethereum requests never completed (hence `abandon`);
`completion.resultHash` in the plane's API is not the keccak of the served attestation.

## 5. Paying

- Card mint: 0.1 IMD from the claimant to the registry's sponsor pool (`transferFrom`; the claimant approves the
  registry first; IMD has no `permit`).
- Oracle trait: `priceOf` per request, pulled from the claimant, approved to the Intake, paid in `request`.
- `registerSpec`: 1 IMD to the pool. `sponsor()`: any amount to the pool.
- The registry holds IMD only as the pool plus amounts of requests not yet sent in the same transaction; no
  `receive`, no `fallback`, no ETH.

## 6. The Curator's views the registry reads (all `view`, all frozen since the Curator settled)

| view | returns | used by |
|---|---|---|
| `firstHourOf(address)` | `(uint256 hour, bool hasJoined)`; a non-member is `(0, false)` | 101, 201, 202 |
| `txCountOf(address)` | `uint256` deposits | 301 to 303 |
| `contributedBy(address)` | `uint256` wei, the largest single send (`highWater`) | 401 to 404 |
| `pointsOf(address)` | `uint256` points (1000 x sqrt(weight in ETH)) | 501 to 503 |
| `isSettled()` | `bool`, true since hour 66 | sanity check in the constructor, nothing else |

Never read `contributors(address)` for the hour: its fourth word is `firstHour + 1`. IDMD: `balanceOf(address)` for
the Operator trait, `ownerOf(uint256)` for `upgradeSponsored`.
