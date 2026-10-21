"""Run the bundled Slither 0.11.3 toolchain without pip or network access."""

import hashlib
import json
import platform
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "tools/slither-toolchain/python.tar.xz"
CHECKSUMS = BUNDLE.parent / "SHA256SUMS"
SCRATCH = ROOT / "test/scratch"
REPORT = SCRATCH / "slither.json"


def unpack_toolchain(target):
    if (sys.implementation.name, sys.version_info[:2], sys.platform, platform.machine()) != (
        "cpython", (3, 12), "linux", "x86_64"
    ):
        raise SystemExit("The bundled analyzer requires CPython 3.12 on Linux x86_64")
    expected, name = CHECKSUMS.read_text().strip().split()
    if name != BUNDLE.name or hashlib.sha256(BUNDLE.read_bytes()).hexdigest() != expected:
        raise SystemExit("Slither toolchain checksum mismatch")
    with tarfile.open(BUNDLE, "r:xz") as archive:
        archive.extractall(target, filter="data")


def main():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    # Always extract a fresh copy: a previous pip install or partial run cannot
    # supply an undeclared dependency or shadow the delivered analyzer.
    with tempfile.TemporaryDirectory(prefix="slither-", dir=SCRATCH) as target:
        unpack_toolchain(target)
        sys.path.insert(0, target)
        from slither.__main__ import main as analyze

        REPORT.unlink(missing_ok=True)
        sys.argv = [
            "slither", str(ROOT), "--filter-paths", "lib/|test/|script/",
            "--fail-high", "--json", str(REPORT),
        ]
        try:
            analyze()
        except SystemExit as exc:
            if exc.code:
                raise
        data = json.loads(REPORT.read_text())
        high = [d for d in data.get("results", {}).get("detectors", []) if d["impact"] == "High"]
        if not data["success"] or high:
            raise SystemExit("Static analysis failed or reported High findings")
        print("Slither: no High-impact findings")


if __name__ == "__main__":
    main()
