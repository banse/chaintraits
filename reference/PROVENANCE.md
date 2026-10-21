# reference/: what is vendored here and why

Nothing under `reference/` is compiled or deployed. It is the evidence the brief rests on, so that the
agents who build the registry do not have to fetch or guess it. The last section says what is **not** vendored and
is only measured, so that nobody mistakes an assertion for a record.

| path | origin | use |
|---|---|---|
| `IntakeV2.sol`, `abi/IntakeV2.json` | verified source and ABI of the IMD Intake **v2** `0xa43e6f75ee006411f79ac1c84120606c2330de82` (Ethereum mainnet; CREATE2, the same address on every chain), Blockscout, fetched 2026-10-12 | the contract the registry pays and that calls `onResult` / `onFailure`; read `requestWithFailure` and `complete` |
| `Intake.sol`, `abi/Intake.json` | verified source and ABI of the IMD Intake **v1** `0x1397434cd35e8a9c8ac312a61d3a285eb31dea56`, fetched 2026-10-11; listed by the plane as a legacy Intake since 2026-10-11 | the contract behind four of the five decoded completions; same `request` and `complete` as v2 |
| `abi/WhitelistCurator.json` | verified ABI of `WhitelistCurator` `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` | the direct-read views and the three events |
| `abi/IdentityMD.json` | verified ABI of the IDMD collection `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` | the collection the Swarmed recipe (`docs/REBUILD.md` 4.2) reads by address; not a constructor argument |
| `abi/IMD.json` | verified ABI of the IMD token `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` (a LayerZero OFT; no `permit`) | the asset of every fee |
| `attestations/*.json` | five attestations served by `GET /oracle/requests/:id/attestation`: three for requests without a consumer (zero domain), two for third-party consumers (their own domain); each with the Intake context (request and complete transactions, ids, delivery) where it exists | the signature tests; the measured facts of `INTEGRATION.md` section 4 (signed id = the plane's UUID; domain = the body's `consumer`) |
| `intake/completions.json` | the five status-0 `complete` transactions on Ethereum mainnet up to 2026-10-12 (four on v1, the first read on v2), decoded with `cast` | wire shape (15 fields on every one), id namespace, `delivered`, selectors |
| `anchors/headers.json` | `eth_getBlockByNumber` for the six boundary blocks of `CATALOG.md` section 1 (`rpc.mevblocker.io`, 2026-10-11) | the window bounds and their hour arithmetic are reproducible from these headers |
| `plane/checks/*.json` | `POST /requests/check` response for each of the ten fixture bodies, 2026-10-12 | no blockers on any; the two T5 suggestions are recorded |
| `plane/quotes/*.json` | `POST /requests/quote` record for each fixture (unpaid orders; they expired after 600 s): order id, status, pinned window and `toBlockHash`, the plane's `questionHash`, and whether the recomputed hash matched | admission and pinning of every body; the `questionHash` rule |
| `plane/questionHashes.json` | per fixture: the plane's `questionHash`, the pinned window and the canonical document whose keccak it is | the golden for the registry's onchain `questionHashOf` |
| `list-record/` | the THE LIST record NFT, commit `722a8c9`, MIT | the card model this registry mirrors: `tokenOf`/claimant/holder, live `tokenURI` reads, ERC-4906, the renderer's splice loop and the golden tests. Its template mechanism (blob as a constructor argument, SSTORE2 pointer in an immutable) is NOT to be copied; see CONCEPT.md section 5. Its `Renderer.t.sol`, `Template.t.sol` and `RendererMechanism.t.sol` show how goldens are proved byte-exact. Its wallet fixture list is not vendored (it names real wallets); goldens here use only synthetic addresses. **One edit to the vendored copy:** `test/Renderer.t.sol` line 110's upstream address vector was replaced by the synthetic `0x…AbCdC1a1`, so this repository names no address outside the documented protocol contracts |

No generator and no template are vendored: the builder writes its own generator of the hive card
(`docs/REBUILD.md` 5.2 and 6.1); list-record's `Renderer.t.sol`, `Template.t.sol` and `RendererMechanism.t.sol` show
how goldens are proved byte-exact.

| `census/hours.json`, `census/curator-source.json`, `census/census.py` | the Curator's 66 hours as the earlier site measured them (deposits, new contributors and ETH per hour; `rpc.mevblocker.io`, cross-checked on thirdweb), the verified source's lines 4 to 62 with its SHA-256, and the census script | the WhitelistCurator page of `docs/SITE.md` |

## Measured, not vendored

These are assertions the entrant measured on 2026-10-11 against Ethereum mainnet; the repository carries the method,
not the raw records, because they are large or because they can be re-measured by anyone with the same calls.

- **Populations and eligible counts** (`CATALOG.md` sections 1 and 3): an `eth_getLogs` census of `Deposited`,
  `FirstDeposit` and `HourSaved` over `W_LIFE` from `rpc.mevblocker.io` in chunks of at most 1,500 blocks (the free
  endpoint caps a response at 10,000 logs), decoded with the ABI above. 28,353 deposits, 19,522 contributors, 41
  `HourSaved`. The block numbers of `FirstDeposit` indices 1, 999, 1000, 10000 and 19522 come from the same census.
- **The Curator's semantics** (`firstHourOf` sentinel, `contributedBy` = `highWater`, the hour formula): read from
  the verified source on Blockscout, not vendored here; the ABI is.
- **The IMD token's internals** ("no transfer hooks"): the verified source was read, the ABI is vendored; the tests
  treat a hostile token as a robustness case, not as a statement about the real one.
- **The plane's behaviour** beyond the vendored responses (admission times, panel sizes it accepts, the `/health`
  Intake table, the x402 pilot whose quote hash equalled its attested hash): the entrant's dated API record, cited in
  the brief, not vendored.
- **The sybil census behind 1301's eligible count** (4,765 contributors with nonce >= 20 at the launch block): an
  earlier project's measurement, not vendored.
