"""Rebuild the offline analyzer bundle from the checksum-pinned upstream wheels.

Usage: python3 tools/pack_slither.py PATH_TO_ORIGINAL_WHEELS
Only Python's standard library and GNU strip are needed. Normal analysis uses
the committed bundle directly; neither wheels nor strip are needed to run it.
"""

import argparse
import base64
import csv
import hashlib
import io
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "tools/slither-toolchain"
BUILD_SUFFIXES = {".c", ".h", ".pyx", ".pxd", ".pxi"}
TEST_DIRECTORIES = {"tests", "SelfTest", "module_testing", "contract_sources"}


def omitted(path):
    # Preserve every analyzer module, including all detectors and printers.
    if path.parts[0] == "slither" or any(p.endswith(".dist-info") for p in path.parts):
        return False
    if path.parts[0] == "docs":
        return True
    if path.suffix in BUILD_SUFFIXES or TEST_DIRECTORIES.intersection(path.parts):
        return True
    if path.parts[0] == "bitarray" and path.name.startswith("test_"):
        return True
    # Both packages ship their own Python implementations alongside optional
    # compiled accelerators. Keep those implementations; no import is patched.
    return path.parts[0] in {"wcwidth", "charset_normalizer"} and path.suffix == ".so"


def pack(wheel_directory):
    checksums = [line.split() for line in (DEST / "upstream-wheels.sha256").read_text().splitlines()]
    scratch = ROOT / "test/scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="slither-pack-", dir=scratch) as temporary:
        target = Path(temporary)
        for expected, name in checksums:
            wheel = wheel_directory / name
            if hashlib.sha256(wheel.read_bytes()).hexdigest() != expected:
                raise SystemExit("Upstream wheel checksum mismatch: " + name)
            with zipfile.ZipFile(wheel) as archive:
                for member in archive.infolist():
                    path = PurePosixPath(member.filename)
                    if path.is_absolute() or ".." in path.parts or not path.parts:
                        raise SystemExit("Invalid wheel path: " + member.filename)
                    if member.is_dir() or omitted(path):
                        continue
                    output = target.joinpath(*path.parts)
                    if output.exists():
                        raise SystemExit("Overlapping wheel file: " + member.filename)
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(archive.read(member))
        for native in sorted(target.rglob("*.so")):
            # Remove only symbols/debug information not needed for relocation;
            # executable code and dynamic symbols are retained.
            subprocess.run(["strip", "--strip-unneeded", str(native)], check=True)
        for record in sorted(target.glob("*.dist-info/RECORD")):
            rows = list(csv.reader(io.StringIO(record.read_text())))
            with record.open("w", newline="") as stream:
                writer = csv.writer(stream, lineterminator="\n")
                for name, _, _ in rows:
                    path = target / name
                    if path == record:
                        writer.writerow([name, "", ""])
                    elif path.is_file():
                        data = path.read_bytes()
                        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
                        writer.writerow([name, "sha256=" + digest, len(data)])
        bundle = DEST / "python.tar.xz"
        with tarfile.open(bundle, "w:xz", preset=9, format=tarfile.USTAR_FORMAT) as archive:
            for path in sorted(target.rglob("*")):
                if not path.is_file():
                    continue
                member = tarfile.TarInfo(path.relative_to(target).as_posix())
                member.size = path.stat().st_size
                member.mode = 0o755 if path.suffix == ".so" else 0o644
                # TarInfo defaults normalize uid, gid, names and mtime; the
                # archive carries no workstation paths or account information.
                with path.open("rb") as stream:
                    archive.addfile(member, stream)
    digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
    (DEST / "SHA256SUMS").write_text(f"{digest}  {bundle.name}\n")
    print(f"Packed {len(checksums)} distributions into {bundle.stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel_directory", type=Path)
    pack(parser.parse_args().wheel_directory)
