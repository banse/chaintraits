# Deployments

## v1 on Ethereum mainnet (chainId 1), 2026-10-18

| Contract | Address | Runtime bytes | Runtime keccak256 |
|---|---|---|---|
| Registry (`Sworn`, `SWORN`) | `0x39bec7648259d5a128c29b24951eabcd4d1f95a6` | 24,561 | `0x9c88410fb6463610043b3adeea1ab857096e83ca8e0aea4f73f63433fbfb42d2` |
| Composer | `0x06bf2168dd115fa37bd1637fa1f50adb29a3029d` | 23,655 | `0x79359a04f91e52693816feb7a9d90b4c75e44abb838f9061e8eee209f6ca417e` |
| Renderer | `0xea9185cc6dffe42a8c059b099c50cb21021439ad` | 21,570 | `0x1fb854135321f70bb61cefbd688f8375179cdb7c4fb2af2009583786f7d47efb` |

- **Source:** commit `59e9bf04b359e523d5d3ba784d017dafc5ef32e1`, tag `v1-mainnet`, built by the IMD swarm on the
  `swarm/job-6` lineage and fast-forwarded onto `main` on 2026-10-19.
- **Launch:** IMD swarm launch #2147 (`evm_contracts`). All three contracts were created in one transaction,
  `0xe647fe252afa7fac3fbbf56e1c3ad64de2093337c29d199a2280c25dc4704c24`, block 26,217,644, from the plane's launch
  wallet `0xfF03410d0Fe5fa8f7F59F743de35E333D9857120`. `Registry.deployedAt()` = 1792304771 (2026-10-18 06:26:11 UTC).
- **Compiler:** solc 0.8.24+commit.e11b9ed9, optimizer on, 200 runs, EVM `cancun`, `bytecode_hash = "none"`,
  `cbor_metadata = false`; none of the three has immutables, so the runtime code equals the build byte for byte.
- **Gate:** aidude `sworn-verify` record `20261018T062734Z-1`, verdict `GATE: PASS`: the runtime code of the three
  contracts and the creation code in the transaction equal a clean build of the commit; the Registry's eight getters,
  name and symbol equal the expected mainnet values below.
- **Wiring (Registry getters):** `curator` `0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91` (the settled WhitelistCurator),
  `idmd` `0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`, `imd` `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`,
  `intake` `0xa43e6f75ee006411f79ac1c84120606c2330de82` (Intake v2), `attester` `0x5598aa9146215bc13eb26f2c692ad1461fd32982`,
  `burnExecutor` `0xe29386719c155b6847ad5a4e97c6674f10ffc750`, `renderer` and `composer` as in the table.
  Constants: `SPEC_FEE` 6.4 IMD, `MINT_FEE` 0.1 IMD, `BURN_MIN` 69 IMD, `BURN_FEE_CAP` 0.005 ETH, `nextSpecId` 10001 at launch.
- **Explorer verification (checked 2026-10-19 12:30 UTC):** the Registry is verified on Sourcify (full match,
  2026-10-18 16:32 UTC, https://sourcify.dev/server/v2/contract/1/0x39bec7648259d5a128c29b24951eabcd4d1f95a6) and on
  Blockscout (https://eth.blockscout.com/address/0x39bec7648259d5a128c29b24951eabcd4d1f95a6). The Registry is also
  verified on Etherscan (the One Dollar Audit of 2026-10-19 read its source from Etherscan's verified-source API).
  Composer and Renderer are **not** verified on Sourcify or Blockscout yet (Etherscan not queried for them). Until they are submitted,
  the gate record above is the proof that their bytecode is this commit's.
- **Name:** this repository was `banse/chaintraits` until 2026-10-19; the launch record cites that name and the commit
  above. The old URL redirects here.
- **Known issues of v1:** see `DISCLOSURE.md` and the repository's issues (the One Dollar Audit of 2026-10-19 and its
  disposition are published with issue #4). No contract has an owner, setter or upgrade path, so every fix is a v2 redeploy.
