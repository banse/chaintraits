# Renderer previews and ABI provenance

The attested source commit is `832cc45f59acdda805b51799647be24c0cae9741`. Its tree contained no `docs/abi/` directory. The delivered ABIs in this directory were extracted from a local build of that exact, unchanged source using solc 0.8.24, optimizer 200, Cancun, `bytecode_hash = none`, and CBOR metadata disabled. The three canonical Keccak ABI hashes equal the handoff. The three rebuilt deployed runtimes also match mainnet byte for byte. See [deployment-verification.json](deployment-verification.json).

The compilation used scratch output/cache paths, without editing root build configuration or the deployed contracts:

```sh
forge build --use /path/to/solc-0.8.24 \
  --out test/scratch/solidity-out --cache-path test/scratch/solidity-cache \
  --skip test --skip script --offline
```

`web/scripts/check-abi.mjs` checks canonical ABI hashes and the recorded runtime fixtures. The build checks `docs/abi/`, `web/src/abi/` and the handoff, then copies those verified ABIs into the export. The browser fetches **only** the ABI paths in `imd-deployment.json`; it does not import the source ABI copies or the compatibility address downloads.

## A wallet without a card

The deployed Renderer exposes `tokenURIOf(address registry,uint256 tokenId)`. Its former public `tokenURI(Card)` entry point is internal in the attested implementation. Calling the former selector cannot produce a preview.

`web/src/chain.ts:83` calls the real deployed `Renderer.tokenURIOf` at the lookup block. For that `eth_call` alone, a storage override sets `Registry.claimantOf(totalSupply() + 1)` to the wallet being inspected. `claimantOf` is the mapping at slot **15**, derived from the compiler's `storageLayout` output for the attested Registry. The exact key is `keccak256(abi.encode(nextTokenId, uint256(15)))` and the value is the left-padded wallet address.

No other code or state is changed. In particular, `tokenOf(wallet)` stays zero, Curator direct reads stay live, Armed stays false, and verified oracle facts/community specs are the wallet's actual facts. The deployed Renderer reads them itself. No helper is deployed, no mint occurs, no request is sent to the attestation API, and no transaction or signature is needed. The result is labelled **“preview, no card minted”**. Metadata's generated name is a rendering input, not evidence of a minted token. A minted wallet takes the normal `Registry.tokenURI(tokenOf(wallet))` path without overrides.

Public RPC support for standard `eth_call` state overrides is required for unminted previews. Both configured RPC URLs remain available in the footer. Failure shows an unavailable state and retry; no fabricated fallback image is presented as a live result. The operator read and local mainnet-fork checks exercised this preview and decoded its actual metadata, before and after minting.

## Bundled synthetic cards

`web/scripts/render-assets.mjs` regenerates the sample card and all 26 trait/empty previews by calling the deployed Renderer. Since these are explicitly synthetic illustrations, the call uses an ephemeral `ICardSource` code override at the Registry address. A small selector dispatcher returns the declared synthetic traits; catalog specs come from the live Registry's `specOf`. Zero verification request ids denote that the illustration proves no oracle claim. They are not recipients, owners or made-up deployments.

The Renderer runs unchanged. The script saves only its SVG image, rejects token-number text, and records the block, inputs, adapter code hashes and SHA-256 output hashes in [renderer-assets.json](renderer-assets.json). The pre-existing text-free logo and share image preserve the reviewed branding. No code override is included in a transaction path.
