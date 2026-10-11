#!/usr/bin/env python3
"""Validate and rasterize the provisional T07 SVG goldens without network access."""

from __future__ import annotations

import os
import argparse
import base64
import hashlib
import json
import shutil
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote_to_bytes


ROOT = Path(__file__).resolve().parents[1]
CASES = ("held", "transferred", "width")
SIZES = (1000, 320)
SOURCE_COMMIT = "2b10de2"
MANIFEST_PATH = Path("test/fixtures/raster/manifest.json")
# The pinned font is the macOS Menlo face; another machine points CHAINTRAITS_FONT at a file with the same SHA-256.
FONT_PATH = Path(os.environ.get("CHAINTRAITS_FONT", "/System/Library/Fonts/Menlo.ttc"))
EXPECTED_FONT_SHA256 = "dc256e0b39c2a6fec947129d421fef41b8b429f58f9b6e5d1b148c87f775c1f6"
EXPECTED_RENDERER = """rsvg-convert version 2.62.0

libraries used:
  cairo 1.18.4
  pango 1.58.2
  harfbuzz 14.3.1
  fontconfig 2.18.3"""
RENDER_COMMAND = (
    "rsvg-convert",
    "--format=png",
    "--dpi-x=96",
    "--dpi-y=96",
    "--width={size}",
    "--height={size}",
    "-",
)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
EXPECTED_RASTERS = {
    ("held", 1000): (53_266, "5d2aa3c7bd02b9f8a7294465f7121626284c933295353923fe6fe2f8830603dc"),
    ("held", 320): (13_430, "2ff374518dd146b981b848b3d08bd49dc2aee8ab4fe125f593158bd82a31a7be"),
    ("transferred", 1000): (53_198, "7da5966df72658547a31754cc4ccad199519b29b8bf75321ccc59e0c9f8a5bd1"),
    ("transferred", 320): (13_371, "c2ad7640f95c32c129c3ce3cd24f6e3c92a7ce262802b523d299d652e0fa6353"),
    ("width", 1000): (55_524, "9193b8b33e0ea547da8ed5262569fe90e2fa23c48b049737639c4aa648fda35e"),
    ("width", 320): (15_223, "61fb33d6788653af898a9e7db20f209f31589ee2b7887086a197a45048ad27df"),
}


@dataclass(frozen=True)
class GoldenSource:
    name: str
    preimage_path: Path
    preimage: bytes
    svg_path: Path
    svg: bytes
    uri_path: Path
    uri: bytes


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def renderer_fingerprint() -> str:
    binary = shutil.which("rsvg-convert")
    if binary is None:
        raise RuntimeError("rsvg-convert is not installed")
    result = subprocess.run([binary, "--version"], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def require_render_environment() -> None:
    actual_renderer = renderer_fingerprint()
    if actual_renderer != EXPECTED_RENDERER:
        raise RuntimeError(
            "rsvg-convert fingerprint differs from the pinned T07 review stack\n"
            f"expected:\n{EXPECTED_RENDERER}\nactual:\n{actual_renderer}"
        )
    if not FONT_PATH.is_file():
        raise RuntimeError(f"missing pinned font: {FONT_PATH}")
    actual_font = sha256(FONT_PATH.read_bytes())
    if actual_font != EXPECTED_FONT_SHA256:
        raise RuntimeError(f"Menlo font hash differs: {actual_font}")


def load_source(name: str, root: Path = ROOT) -> GoldenSource:
    if name not in CASES:
        raise ValueError(f"unknown golden case: {name}")
    stem = Path(f"test/fixtures/golden_synthetic_{name}")
    preimage_path = Path(f"{stem}_preimage.txt")
    svg_path = Path(f"{stem}_svg.txt")
    uri_path = Path(f"{stem}_uri.txt")
    source = GoldenSource(
        name=name,
        preimage_path=preimage_path,
        preimage=(root / preimage_path).read_bytes(),
        svg_path=svg_path,
        svg=(root / svg_path).read_bytes(),
        uri_path=uri_path,
        uri=(root / uri_path).read_bytes(),
    )
    if preimage_from_uri(source.uri) != source.preimage:
        raise RuntimeError(f"{name}: token URI does not decode to the committed preimage")
    if svg_from_preimage(source.preimage) != source.svg:
        raise RuntimeError(f"{name}: JSON image does not decode to the committed SVG")
    return source


def preimage_from_uri(uri: bytes) -> bytes:
    prefix = b"data:application/json;base64,"
    if not uri.startswith(prefix):
        raise ValueError("wrong token URI prefix")
    return base64.b64decode(uri[len(prefix) :], validate=True)


def svg_from_preimage(preimage: bytes) -> bytes:
    document = json.loads(preimage)
    image = document.get("image")
    prefix = "data:image/svg+xml,"
    if not isinstance(image, str) or not image.startswith(prefix):
        raise ValueError("wrong JSON image URI")
    return unquote_to_bytes(image[len(prefix) :])


def rasterize(svg: bytes, size: int) -> bytes:
    command = [part.format(size=size) for part in RENDER_COMMAND]
    result = subprocess.run(command, input=svg, check=True, capture_output=True)
    png = result.stdout
    if png_dimensions(png) != (size, size):
        raise RuntimeError(f"renderer returned the wrong dimensions for {size}px")
    return png


def png_dimensions(png: bytes) -> tuple[int, int]:
    if len(png) < 24 or png[:8] != PNG_SIGNATURE:
        raise ValueError("invalid PNG signature")
    if png[12:16] != b"IHDR" or struct.unpack(">I", png[8:12])[0] != 13:
        raise ValueError("invalid PNG IHDR")
    return struct.unpack(">II", png[16:24])


def _file_record(path: Path, data: bytes) -> dict[str, object]:
    return {"path": str(path), "bytes": len(data), "sha256": sha256(data)}


def build_outputs(root: Path = ROOT) -> tuple[dict[Path, bytes], bytes]:
    require_render_environment()
    outputs: dict[Path, bytes] = {}
    sources: list[dict[str, object]] = []
    rasters: list[dict[str, object]] = []

    for name in CASES:
        source = load_source(name, root)
        sources.append(
            {
                "id": f"synthetic_{name}",
                "preimage": _file_record(source.preimage_path, source.preimage),
                "svg": _file_record(source.svg_path, source.svg),
                "tokenURI": _file_record(source.uri_path, source.uri),
            }
        )
        for size in SIZES:
            path = Path(f"test/fixtures/raster/golden_synthetic_{name}_{size}.png")
            png = rasterize(source.svg, size)
            expected_bytes, expected_hash = EXPECTED_RASTERS[(name, size)]
            actual_hash = sha256(png)
            if len(png) != expected_bytes or actual_hash != expected_hash:
                raise RuntimeError(
                    f"{name} {size}px differs from the pinned raster: "
                    f"{len(png)} bytes, sha256 {actual_hash}"
                )
            outputs[path] = png
            rasters.append(
                {
                    "id": f"synthetic_{name}_{size}",
                    "source": f"synthetic_{name}",
                    "width": size,
                    "height": size,
                    **_file_record(path, png),
                }
            )

    manifest = {
        "schema": "the-list-record-raster-review-v1",
        "provisional": True,
        "sourceCommit": SOURCE_COMMIT,
        "renderer": {
            "fingerprint": EXPECTED_RENDERER,
            "command": list(RENDER_COMMAND),
            "font": {
                "name": "Menlo.ttc",
                "sha256": EXPECTED_FONT_SHA256,
            },
        },
        "sources": sources,
        "rasters": rasters,
    }
    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    return outputs, manifest_bytes


def check_outputs(outputs: dict[Path, bytes], manifest: bytes, root: Path = ROOT) -> int:
    failures: list[str] = []
    for path, expected in outputs.items():
        target = root / path
        if not target.is_file():
            failures.append(f"missing {path}")
        elif target.read_bytes() != expected:
            failures.append(f"differs {path}")

    target_manifest = root / MANIFEST_PATH
    if not target_manifest.is_file():
        failures.append(f"missing {MANIFEST_PATH}")
    elif target_manifest.read_bytes() != manifest:
        failures.append(f"differs {MANIFEST_PATH}")

    if failures:
        print("\n".join(failures))
        return 1
    print(f"checked {len(outputs)} raster artifacts and {MANIFEST_PATH}")
    return 0


def write_outputs(outputs: dict[Path, bytes], manifest: bytes, root: Path = ROOT) -> None:
    for path, data in outputs.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    target_manifest = root / MANIFEST_PATH
    target_manifest.parent.mkdir(parents=True, exist_ok=True)
    target_manifest.write_bytes(manifest)
    print(f"generated {len(outputs)} raster artifacts and {MANIFEST_PATH}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs, manifest = build_outputs()
    if args.check:
        return check_outputs(outputs, manifest)
    write_outputs(outputs, manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
