# CATALOG.md: the v1 trait catalog, frozen 2026-10-11

This file binds the code. Ids, rules, windows and acceptance rules do not change; the display names in section 8 do
(the product has no name yet). Read `README.md` first, `TEMPLATES.md` for the question bodies and `INTEGRATION.md`
for the Intake and the attestation.

**Words.** *The registry* is the ERC-721 contract, *the card* is a wallet's token, a *trait* is one per-wallet fact
(`traitId`, `hasTrait`). *Claimant* is the wallet that minted the card and that every trait is about; *holder* is
`ownerOf`.

## 1. Measured anchors (Ethereum mainnet, read 2026-10-11)

The Curator computes `hour = (block.timestamp - launchTime) / hourDuration` with `launchTime` 1,786,910,327 and
`hourDuration` 3,600; `firstJudgedHour` is 24. The first block of hour h is the first block whose timestamp is at
least `launchTime + h * 3600`.

| anchor | block | hex | note |
|---|---|---|---|
| Curator deploy block (`B_DEPLOY`) | 25,769,870 | `0x189378e` | block hash `0x43ac0aadac9b134a5e4555d28323431664fd77d74cd6a28cb4ca65e34ba72256`; also the launch block |
| first `Deposited` | 25,769,888 | `0x18937a0` | `FirstDeposit` index 1 |
| `FirstDeposit` index 999 | 25,770,891 | `0x1893b8b` | |
| `FirstDeposit` index 1000 (`B_FIRST1000`) | 25,770,897 | `0x1893b91` | indices are 1-based: 1 to 19,522 |
| `FirstDeposit` index 10000 | 25,774,866 | `0x1894b12` | |
| hour 24 first block (`B_H24`) | 25,777,045 | `0x1895395` | first judged hour; first hour-24 deposit at 25,777,046 |
| hour 64 first block | 25,789,008 | `0x1898250` | |
| `FirstDeposit` index 19522 | 25,789,040 | `0x1898270` | the last new contributor |
| hour 65 first block | 25,789,306 | `0x189837a` | |
| last `Deposited` (the hour-65 deposit) | 25,789,576 | `0x1898488` | |
| hour 65 last block (`B_END`) | 25,789,604 | `0x18984a4` | hour 66 starts at 25,789,605 (`0x18984a5`); `isSettled()` is true from there |
| `Settled` event | 25,789,721 | | hour 66; not a window bound |

Populations measured today: hours 24 to 65 hold 5,958 deposits by 3,936 distinct contributors (no hour below 24 in
that window); hour 24 alone 131 deposits by 51 contributors; hour 64 8 deposits by 7; hour 65 1 by 1; `HourSaved`
41 events by 33 distinct saviors, one or more per hour from 24 to 64; 28,353 deposits in all. The IDMD collection
answers `balanceOf(address)` (pawai.eth: 1).

### Canonical windows (constants in the registry; the claimant chooses nothing)

| window | fromBlock | toBlock | blocks | used by |
|---|---|---|---|---|
| `W_LIFE` | `0x189378e` | `0x18984a4` | 19,735 | 801, 901, 1001, 1101 to 1104, 1201 |
| `W_JUDGED` | `0x1895395` | `0x18984a4` | 12,560 | 701 |
| `W_FIRST1000` | `0x189378e` | `0x1893b91` | 1,028 | 1105 |
| `W_DEPLOY` | `0x189378e` | `0x189378e` | 1 | 1301 (single block, panel) |

`W_LIFE` ends at the last block of hour 65, not at the `Settled` block. Free RPCs that served `eth_getLogs` for this
range on 2026-10-11: `rpc.mevblocker.io` in chunks of at most 1,500 blocks, `1.rpc.thirdweb.com` in chunks of 1,000;
drpc's free plan refuses `eth_getLogs`, publicnode calls it an archive request.

## 2. Ids and tiers

- `traitId` is a `uint16`: **id = family x 100 + tier**. 101 is family 1, tier 1. Community specs (section 7) take ids
  from **10001** upward in registration order.
- **Tiers are monotone.** `hasTrait(A, id)` is true for every tier at or below the wallet's level (a wallet with ten
  deposits has 301, 302 and 303). The card shows only the highest tier per family. Allowlists may gate on any tier.
- Direct-read families (1 to 6) are evaluated live in `tokenURI` and `hasTrait`; they are fixed at launch.
- Oracle families (7 to 13) are stored per `(claimant, traitId)` after a verified attestation.

## 3. Trait table v1 (25 slots, working names)

| id | working name | class | source and rule (A = claimant) | window | eligible |
|---|---|---|---|---|---|
| 101 | Contributor | direct | `firstHourOf(A).hasJoined` | live | 19,522 |
| 201 | Early bird, hour 0 | direct | `hasJoined && hour == 0` | live | 96 |
| 202 | Early bird, hour <= 1 | direct | `hasJoined && hour <= 1` | live | 516 |
| 301 / 302 / 303 | Climber >= 3 / 5 / 10 | direct | `txCountOf(A) >= 3 / 5 / 10` | live | from the view; at most 2,037 wallets made more than one deposit |
| 401 / 402 / 403 / 404 | Capital >= 1 / 10 / 100 / 800 ETH | direct | `contributedBy(A) >= 1e18 / 1e19 / 1e20 / 8e20` (the view returns `contributors(A).highWater`, the largest single send in wei) | live | snapshot of 15,576 wallets: median 0.45 ETH, p90 14, p99 98.8, max 1,000 (the cap) |
| 501 / 502 / 503 | Scoreboard >= 1,000 / 3,162 / 10,000 | direct | `pointsOf(A) >= 1000 / 3162 / 10000` (points = 1000 x sqrt(weight in ETH)) | live | from the view |
| 601 | Operator | direct | IDMD `balanceOf(A) >= 1` (`0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D`) | live | at most 2,000 |
| 701 | Still here | chain, T1 log-count >= 1 | `Deposited` with `contributor` = A | `W_JUDGED` | 3,936 |
| 801 | Last stand | chain, T1 log-count >= 1 | `Deposited` with `contributor` = A and `hour` = 64 | `W_LIFE` | 7 |
| 901 | The last one in | chain, T1 log-count >= 1 | `Deposited` with `contributor` = A and `hour` = 65 | `W_LIFE` | 1 |
| 1001 | Hour savior | chain, T1 log-count >= 1 | `HourSaved` with `savior` = A | `W_LIFE` | 33 |
| 1101 / 1102 / 1103 / 1104 | Ordinal #1 / #1000 / #10000 / #19522 | chain, T1 log-count >= 1 | `FirstDeposit` with `contributor` = A and `index` = 1 / 1000 / 10000 / 19522 | `W_LIFE` | 1 each |
| 1105 | First thousand | chain, T1 log-count >= 1 | `FirstDeposit` with `contributor` = A | `W_FIRST1000` | 1,000 |
| 1201 | Top 32 | shared, T3 log-rank head 32 | top 32 `contributor`s by summed `weightAdded` in `Deposited`; one attestation serves all 32 | `W_LIFE` | 32 |
| 1301 | Not born yesterday | panel, T5 bool | `eth_getTransactionCount(A, 0x189378e) >= 20` | `W_DEPLOY` | 4,765 contributors had nonce >= 20 at the launch block (sybil census) |

The ordinal family is not monotone (each id is a different wallet); 1105 is a window fact, not a tier of 1101 to
1104. Not in the catalog by decision: the wallet that called `settle()` (it belongs to the entrant; no back door).

Event signatures as the recipes need them (human-readable ABI items, exactly these strings):

- `event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)`
- `event FirstDeposit(address indexed contributor, uint256 indexed index, uint256 timestamp)`
- `event HourSaved(address indexed savior, uint256 indexed hour, uint256 hourTotal)`

Curator: `0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91` (lowercase in every question; the plane compares strings).

**Trap in the Curator's raw getter:** `contributors(address)` returns `(uint96 highWater, uint96 weight, uint32 txCount,
uint32 firstHour)` where `firstHour` is stored **plus one** (0 = never deposited). Read hours only through
`firstHourOf(address) returns (uint256 hour, bool hasJoined)` and check `hasJoined`; a non-member read naively looks
like an hour-0 founder. Capital reads `contributedBy(A)`, never the struct.

## 4. What the callback accepts, per class

The registry stores `pending[requestId] = (claimant, traitId)` when it sends a question and, in
`onResult(requestId, attestation, signature)`, verifies: signer == attester (`0x5598aa9146215bc13eb26f2c692ad1461fd32982`,
constructor argument), `verifyingContract` == the registry, `chainId` == 1, `requestId` pending and unconsumed,
`answerType` (uint8) == the template's type, `agreeing >= quorum`, window == the trait's canonical window, and the
answer against the rule below. A miss is recorded (`Missed(requestId, traitId, reason)`) and never reverts the
writer's transaction.

| template | answerType | rule that marks the trait |
|---|---|---|
| T1 log-count | `uint256` | `value >= threshold` (1 for every v1 trait) |
| T2 log-sum | `uint256` | `value >= threshold` |
| T3 log-rank (shared fact) | `address[]` | the list is stored under the fact id; `applySharedFact` marks `msg.sender` if the first `head` entries contain it |
| T4 call-compare | `bool` | `value == true` |
| T5 panel nonce | `bool` | `value == true` |

Oracle defaults: chain evidence `panelSize` 5, `quorum` 3 (the deployer reruns the recipe before signing, so the
panel only has to agree on a recipe); panel evidence `panelSize` 11, `quorum` 7 (as in both pilots);
`validForSeconds` 2,592,000 (30 days); `chainId` 1; blocks in hex in every text; `head` 32 for T3. A `disagreed`,
`not_answerable` or unanswered request is "no verdict", never false; `abandon(requestId)` after 14 days releases
the pending slot and the 0.5 IMD is spent either way.


## Templates

The five question templates, their placeholders and the checked example bodies are in `TEMPLATES.md`; every oracle
trait in section 3 names its template there (T1, T3, T5).

## 5. Spec registration (community traits)

`registerSpec(Spec)` by anyone, 1 IMD into the sponsor pool, returns the new id (10001 upward), emits
`SpecRegistered(id)`. The spec is immutable. Fields:

| field | type | guard |
|---|---|---|
| `kind` | uint8: 1 T1, 2 T2, 3 T3, 4 T4, 5 T5 | one of the five |
| `target` | address | nonzero for T1 to T4; unused for T5 |
| `item` | string | the event item (T1 to T3) or function item (T4); ASCII, at most 256 bytes, must start with `event ` or `function ` as the kind requires |
| `arg` | string | indexed argument that equals the claimant (T1, T2) or the groupBy key (T3); ASCII `[A-Za-z0-9_]`, at most 32 |
| `fixedArg`, `fixedVal` | string, uint256 | optional second indexed filter (T1, T2); empty string = none |
| `sumArg` | string | T2 and T3 only |
| `op` | uint8 | T4 only: 1 `>=`, 2 `>`, 3 `<=`, 4 `<`, 5 `==` |
| `threshold` | uint256 | T1, T2, T4, T5: `>= 1`; T3: head, 1 to 32 |
| `fromBlock`, `toBlock` | uint64 | `toBlock - fromBlock + 1 >= 7200` and `toBlock < block.number` at registration (T5: `fromBlock == toBlock`, and `toBlock + 7200 <= block.number`) |
| `name` | string | ASCII `[A-Za-z0-9 .-]`, 1 to 32 bytes; escaped by the renderer |
| `evidence` | derived | chain for kinds 1 to 4, panel for 5 |

The composed body is a deterministic function of the spec (golden tests per kind); the registry asserts every
`definitions` entry is at most 512 characters and the question at most 1,000 before sending. A spec whose body is
refused by the plane keeps its fee: junk specs burden only whoever pays for junk.

## 6. Sharing, pool, fees (unchanged from the concept, listed for the brief)

`mintCard()` 0.1 IMD into the pool, once per wallet; `upgrade(traitIds[])` k x 0.5 IMD; `requestSharedFact(1201)` 0.5
IMD by anyone, `applySharedFact(1201)` gas only; `sponsor()`; `upgradeSponsored(tokenId, traitIds[])` by the IDMD
holder, one per IDMD token id, chain traits only; `payForward(wallet, traitId)` from day 30, chain traits only;
`abandon(requestId)` after 14 days. No owner, no upgrade, no pause, no token.

## 7. Name table (filled by the entrant on 2026-10-16)

| id | working name | final name |
|---|---|---|
| 101 | Contributor | |
| 201, 202 | Early bird | |
| 301 to 303 | Climber | |
| 401 to 404 | Capital | |
| 501 to 503 | Scoreboard | |
| 601 | Operator | |
| 701 | Still here | |
| 801 | Last stand | |
| 901 | The last one in | |
| 1001 | Hour savior | |
| 1101 to 1105 | Ordinal | |
| 1201 | Top 32 | |
| 1301 | Not born yesterday | |
| product, symbol, X handle | the registry | |

A rename replaces this table and the collection strings; it touches no rule, id or window.

## 8. Not frozen (open)

- Panel 5 / quorum 3 for chain questions is a default, not a measurement; if the first job's requests stall, 7 / 4.
- Whether the launch pipeline accepts a registry that deploys its renderer in its constructor (fallback: two
  launches, renderer first, then the registry with the renderer as a static argument).
- The attestation struct and the callback shape are in `INTEGRATION.md`, read from the Intake's verified source and
  two attestations served on mainnet.
