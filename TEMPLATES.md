# TEMPLATES.md: the five question templates

Community specs and the v1 oracle traits (`CATALOG.md` section 3) compose their question bodies from exactly these five templates, one per
recipe kind, so the stored parameters and the text can never disagree. The v4 pool recipes (`v4-volume-rank`,
`univ4-spot`) are not wallet facts and are not offered; a fees-paid panel text was considered, never ran end to end, and is not offered. T2 shares T1's shape with a sum instead of a
count. **Checked and quoted 2026-10-12, 00:00 UTC (round 2):** all ten fixture bodies passed `POST /requests/check`
with no blockers (the two T5 bodies carry the plane's usual "reads as chain evidence" suggestion, ignored by design)
and were admitted by a free `POST /requests/quote`, each with its canonical window pinned unchanged and the hash of its
last block as `toBlockHash`. The ten check responses and the ten quote records are vendored under
`reference/plane/checks/` and `reference/plane/quotes/`; the plane's `questionHash` for each body is in
`reference/plane/questionHashes.json` with the canonical document it hashes (`INTEGRATION.md` section 4, check 7).
T5's wording changed in round 2 (account nonce only, see below); the previous wording was attested twice on mainnet on
2026-10-11 (true 7/11, false 7/11) and the new one has not been attested yet. The exact bodies are in
`templates/fixtures/*.json` (sorted keys, two-space indent); the registry's golden tests must reproduce them byte for
byte from the stored parameters, with the fixture's synthetic claimant `0x…c1a1` and the fixture's synthetic consumer
`0x000000000000000000000000000000000000c0de` (the test deploys the registry at that address with forge-std's
`deployCodeTo`; in production the consumer is `address(this)`). A template that fails a later check is fixed in this
file first.

**Byte-exact rule.** The text below, with every placeholder replaced, must equal the fixture files under
`templates/fixtures/` byte for byte (minus the file's trailing newline, which is not part of the body). In the
texts, backticks around a placeholder are markdown and are NOT emitted, with ONE exception: the event or function
item (`<EVENT>`, `<FN>`) is wrapped in literal backticks in the body, exactly as the fixtures show
(`` count the `event HourSaved(...)` events ``). Nothing else carries backticks. The composer emits the fixture's
`definitions` keys exactly (T1: `method`, `window`; T2: `method`, `units`, `window`; T3: `method`; T4: `method`;
T5: `method`, `true`, `false`, `window`), and every body carries the `consumer` key of the request-body table.

Placeholders: `<A>` claimant address (lowercase hex), `<C>` target contract (lowercase), `<EVENT>` the human-readable
event item, `<ARG>` the indexed argument that must equal `<A>`, `<FARG>`/`<FVAL>` an optional second indexed
argument and its decimal value, `<SUMARG>` the argument to sum, `<N>` the threshold (decimal), `<NH>` the same threshold as lowercase `0x` hex (`20` -> `0x14`), `<FROM>`/`<TO>` the
window in hex, `<FN>` a `function name(address) view returns (uint256)` item, `<OP>` one of `>=`, `>`, `<=`, `<`,
`==`. Every text is ASCII; names from specs are restricted to `[A-Za-z0-9 .-]`.

### T1 log-count, personal (`evidence: chain`, `answerType: uint256`)

> question: "Within the request's pinned block window (fromBlock `<FROM>` to toBlock `<TO>`, both inclusive) on
> Ethereum mainnet, count the `<EVENT>` events emitted by the contract `<C>` whose indexed `<ARG>` argument equals
> `<A>`[ and whose indexed `<FARG>` argument equals `<FVAL>`]. Answer the count as one integer; answer 0 if no such
> event exists."
>
> definitions.method: "eth_getLogs on the contract with topic0 = the event's signature hash and the indexed argument(s)
> as topics, over exactly the pinned window; or the equivalent explorer log query. Count matching logs; do not
> deduplicate by transaction. Block numbers are hex."
> definitions.window: "The pinned window is the whole evidence; events outside it do not count."

Spec fields: `<C>`, `<EVENT>`, `<ARG>`, optional `<FARG>`+`<FVAL>`, `<N>`, window. v1 traits 701, 801, 901, 1001,
1101 to 1105 use it with the Curator's events above and `<N>` = 1.

### T2 log-sum, personal (`evidence: chain`, `answerType: uint256`)

> question: "Within the request's pinned block window (fromBlock `<FROM>` to toBlock `<TO>`, both inclusive) on
> Ethereum mainnet, sum the `<SUMARG>` argument of the `<EVENT>` events emitted by the contract `<C>` whose indexed
> `<ARG>` argument equals `<A>`[ and whose indexed `<FARG>` argument equals `<FVAL>`]. Answer the sum as one integer
> in the argument's raw units (no decimals applied); answer 0 if no such event exists."
>
> definitions.method: "eth_getLogs on the contract with topic0 = the event's signature hash and the indexed argument(s)
> as topics, over exactly the pinned window; or the equivalent explorer log query. Sum the named argument of matching
> logs; do not deduplicate by transaction. Block numbers are hex."
> definitions.units: "Raw integer units of the argument as emitted, e.g. wei for an ETH amount."
> definitions.window: as T1.
>
> Fixture: `templates/fixtures/T2-log-sum-composed.json` (composed from this template; checked and quoted 2026-10-12).

Spec fields: as T1 plus `<SUMARG>`. No v1 trait uses it; wave-two families (degen volume, whale receiver by sum) do.

### T3 log-rank, shared fact (`evidence: chain`, `answerType: address[]`, `head <= 32`)

> question: "Within the request's pinned block window (fromBlock `<FROM>` to toBlock `<TO>`, both inclusive) on
> Ethereum mainnet, sum the `<SUMARG>` argument of the `<EVENT>` events emitted by the contract `<C>` grouped by the
> indexed `<ARG>` argument. Return the `<N>` keys with the largest sums, descending by sum, ties by address ascending
> (lowercase hex)."
>
> definitions.method: "eth_getLogs over exactly the pinned window, group by the indexed argument, sum in raw units,
> sort as stated; include a few positions beyond `<N>`; agreement is on the first `<N>`."

Spec fields: `<C>`, `<EVENT>`, `<ARG>` (groupBy), `<SUMARG>`, `<N>` (head, at most 32), window. v1 trait 1201 uses it:
`Deposited`, groupBy `contributor`, sum `weightAdded`, head 32, `W_LIFE`.

### T4 call-compare (`evidence: chain`, `answerType: bool`)

> question: "At the last block of the request's pinned window (toBlock `<TO>`) on Ethereum mainnet, does the view
> function `<FN>` of the contract `<C>` return a value `<OP>` `<N>` for the address `<A>`? Answer true or false."
>
> definitions.method: "One eth_call of the function with `<A>` as the argument at block `<TO>` (hex, not 'latest') on an
> endpoint with historical state; compare the raw integer return value with `<N>` using `<OP>`. A null, pruned or
> 'latest' read is no evidence."
>
> Fixture: `templates/fixtures/T4-call-compare-reference.json` (`pointsOf`, `>=`, 1000, `W_LIFE`).

Spec fields: `<C>`, `<FN>` (one address argument, one uint256 return), `<OP>`, `<N>`, window (its last block is the
state read). No v1 trait uses it (the registry reads the Curator's views directly); wave-two bagholder and
diamond-hands facts do.

### T5 panel nonce (`evidence: panel`, `answerType: bool`, panel 11 / quorum 7)

A question about the **account nonce** in the chain state at one block, read with `eth_getTransactionCount`; the
parameters are `<A>`, the block `<B>` (decimal), its hex `<BH>`, its hash `<HASH>`, `<N>` and `<NH>`; the window is
the single block `<B>`. Round 2 removed the explorer transaction-list alternative and the "sent at least N
transactions" paraphrase: a contract's nonce counts its own `CREATE`s, so the two methods can answer differently for
the same claimant, and a panel that mixes them disagrees. The predicate is the nonce, nothing else.

> question: "At Ethereum mainnet block `<B>` (hex `<BH>`, block hash `<HASH>`; the block in which the WhitelistCurator
> contract 0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91 was deployed), was the account nonce of address `<A>`, as
> returned by eth_getTransactionCount at that block, at least `<N>`? This asks about the account's nonce in the chain
> state at that block, not about its transaction history."
>
> definitions.method: "Call eth_getTransactionCount(`<A>`, `<BH>`) (hex block, not 'latest') on an endpoint with
> historical state, e.g. https://rpc.mevblocker.io or https://eth.drpc.org; cite endpoint and call. Pruned or
> unavailable state, errors or null (flashbots, 1rpc, cloudflare, publicnode) are no evidence: use another endpoint
> with historical state. Explorer transaction lists are not the nonce and are not evidence."
> definitions.true: "true only if an endpoint with historical state returns a transaction count at block `<BH>` of at
> least `<N>` (`<NH>`)."
> definitions.false: "false only if an endpoint with historical state returns a count at block `<BH>` below `<N>`
> (`<NH>`). If you could not read the historical count, write no answer; never answer false from a pruned, null or
> 'latest' read."
> definitions.window: "The window is the single block `<B>`; it fixes which chain state to read. It is not a time
> range, and the current (latest) nonce is not the answer."

v1 trait 1301: `<B>` 25769870, `<BH>` 0x189378e, `<HASH>` as in `CATALOG.md` section 1, `<N>` 20, `<NH>` 0x14; fixture
`templates/fixtures/1301-not-born-yesterday.json`. **Community T5 specs** use the same text with one verbatim change in
the question's parenthesis: `(hex <BH>, block hash <HASH>; the block in which the WhitelistCurator contract
0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91 was deployed)` becomes `(hex <BH>; the last block of the spec's window)`;
`<B>` is the spec's `toBlock` (equal to its `fromBlock`); the definitions are unchanged. Fixture:
`templates/fixtures/T5-community-composed.json`. A contract cannot read the hash of a block older than 256 blocks; the
plane pins `toBlockHash` itself. Panel specs are never paid by the sponsor pool.

## The request body

Every question is one JSON object, UTF-8, sent as the `body` of `Intake.request` (`INTEGRATION.md`). Keys and
their fixed values:

| key | value |
|---|---|
| `v` | 1 |
| `question` | the composed text, at most 1,000 characters |
| `chainId` | 1 |
| `window` | `{"fromBlock": <int>, "toBlock": <int>}` (decimal integers in JSON; hex in the text) |
| `answerType` | `uint256`, `address[]` or `bool` as the template says |
| `evidence` | `chain` (T1 to T4) or `panel` (T5) |
| `panelSize`, `quorum` | 5, 3 for chain; 11, 7 for panel |
| `validForSeconds` | 2592000 |
| `head` | T3 only: the list length the registry reads, at most 32 |
| `definitions` | an object of ASCII strings, each at most 512 characters, keys as each template lists |
| `consumer` | `{"chainId": 1, "verifyingContract": "<the registry's address, lowercase hex>"}`: the EIP-712 domain the attester signs for (`INTEGRATION.md` section 4); the fixtures use `0x000000000000000000000000000000000000c0de` |

The plane pins `toBlockHash` itself when it admits the request; the registry never puts a block hash in a body
except the constant one in trait 1301. Serialisation for the golden tests: keys sorted, two-space indent, as in
the fixtures. (The Intake accepts any byte-exact JSON; the sorted form only makes the goldens comparable.)

**The plane's `questionHash`** of a body is `keccak256` of the body reduced to `v`, `chainId`, `question`,
`definitions`, `answerType`, `window` (`fromBlock` and `toBlock` only), plus `head` when present and `evidence` only
when it is `panel`, serialised as RFC 8785 canonical JSON (sorted keys, no whitespace). The registry computes it when
it composes a body and the callback compares it with the attestation (`INTEGRATION.md` section 4, check 7);
`reference/plane/questionHashes.json` holds the plane's value and the canonical document for every fixture.
