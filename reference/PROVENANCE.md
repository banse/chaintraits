# reference/: what is vendored here and why

Nothing under `reference/` is compiled or deployed. It is the evidence the brief rests on, so that the
agents who build the registry do not have to fetch or guess it.

| path | origin | use |
|---|---|---|
| `Intake.sol` | verified source of the IMD Intake `0x1397434cd35e8a9c8ac312a61d3a285eb31dea56` (Ethereum mainnet), Blockscout, fetched 2026-10-11 | the contract the registry pays and that calls `onResult`; read `request` and `complete` |
| `abi/Intake.json` | same contract, ABI | |
| `abi/WhitelistCurator.json` | verified ABI of `WhitelistCurator` `0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91` | the direct-read views and the three events |
| `abi/IdentityMD.json` | verified ABI of the IDMD collection `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` | `balanceOf` for the Operator trait, `ownerOf` for sponsored upgrades |
| `abi/IMD.json` | verified ABI of the IMD token `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` (a LayerZero OFT; no `permit`) | the asset of every fee |
| `list-record/` | the THE LIST record NFT, commit `722a8c9`, MIT | the card model this registry mirrors: `tokenOf`/claimant/holder, live `tokenURI` reads, ERC-4906, the renderer with a compile-time template read with `codecopy`, the splice, and the golden tests. Its `Renderer.t.sol`, `Template.t.sol` and `RendererMechanism.t.sol` show how goldens are proved byte-exact. Its wallet fixture list is not vendored (it names real wallets); goldens here use only synthetic addresses |

The generator in `tools/` (`gen_template.py`, `rasterize_goldens.py` and their tests) and the starting
template in `template/` are also from list-record `722a8c9`. They are to be adapted, not kept as they are:
the card of this registry is a grid of trait slots, not THE LIST's single record.
