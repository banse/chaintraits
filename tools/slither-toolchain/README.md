# Offline Slither toolchain

`python.tar.xz` contains Slither 0.11.3 and its runtime dependencies for CPython
3.12 on Linux x86_64. Run `python3 tools/run_slither.py` from the repository root.
The runner checks `SHA256SUMS`, extracts a fresh copy into disposable
`test/scratch/`, runs all default detectors, rejects High-impact findings, and
writes `test/scratch/slither.json`. It needs no pip, package download or compiler
download. Forge and the project's pinned compiler must already be installed.

This replaces the oversized collection of wheels with one compressed runtime
tree. Package versions are unchanged. All Slither modules, dependency runtime
data, distribution metadata and upstream licenses are retained. Only dependency
tests, documentation build trees, build-only C/Cython source files, native debug/unneeded symbol sections,
and the optional `wcwidth`/`charset_normalizer` native accelerators are omitted.
Those two packages use their included Python implementations without patches.
No detector is removed or disabled. The project contracts, ABI exports, goldens
and protected Foundry dependencies are unaffected.

`upstream-wheels.sha256` records the exact original PyPI wheels and versions.
To reproduce the bundle, provide those wheels in a local directory and run:

```sh
python3 tools/pack_slither.py PATH_TO_ORIGINAL_WHEELS
```

The packer verifies each original checksum, strips unneeded native symbols with
GNU `strip`, refreshes installed-file `RECORD` hashes, and writes a sorted XZ tar
with normalized metadata and its SHA-256 checksum. It preserves every upstream
license. Original wheels, expanded packages, Python bytecode caches and analyzer
reports are not shipped redundantly. Repacking is optional maintenance; the
committed archive is sufficient for offline analysis from a clean checkout.
