from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from tools import rasterize_goldens as raster


class RasterizeGoldensTest(unittest.TestCase):
    def test_committed_uri_json_and_svg_round_trip_exactly(self) -> None:
        for name in raster.CASES:
            with self.subTest(name=name):
                source = raster.load_source(name)
                self.assertEqual(raster.preimage_from_uri(source.uri), source.preimage)
                self.assertEqual(raster.svg_from_preimage(source.preimage), source.svg)

    def test_renderer_and_font_fingerprints_are_exact(self) -> None:
        raster.require_render_environment()
        self.assertEqual(raster.renderer_fingerprint(), raster.EXPECTED_RENDERER)
        self.assertEqual(raster.sha256(raster.FONT_PATH.read_bytes()), raster.EXPECTED_FONT_SHA256)

    def test_build_outputs_has_six_valid_pngs_and_deterministic_manifest(self) -> None:
        outputs, manifest_bytes = raster.build_outputs()
        expected = {
            Path(f"test/fixtures/raster/golden_synthetic_{case}_{size}.png")
            for case in raster.CASES
            for size in raster.SIZES
        }
        self.assertEqual(set(outputs), expected)

        for path, png in outputs.items():
            size = int(path.stem.rsplit("_", 1)[1])
            name = path.stem.removeprefix("golden_synthetic_").rsplit("_", 1)[0]
            self.assertEqual(raster.png_dimensions(png), (size, size))
            expected_bytes, expected_hash = raster.EXPECTED_RASTERS[(name, size)]
            self.assertEqual(len(png), expected_bytes)
            self.assertEqual(raster.sha256(png), expected_hash)

        manifest = json.loads(manifest_bytes)
        self.assertEqual(manifest["schema"], "the-list-record-raster-review-v1")
        self.assertTrue(manifest["provisional"])
        self.assertEqual(manifest["sourceCommit"], raster.SOURCE_COMMIT)
        self.assertEqual(manifest["renderer"]["fingerprint"], raster.EXPECTED_RENDERER)
        self.assertEqual(manifest["renderer"]["font"]["sha256"], raster.EXPECTED_FONT_SHA256)
        self.assertEqual(len(manifest["rasters"]), 6)
        self.assertEqual(manifest_bytes, raster.build_outputs()[1])

    def test_check_detects_drift_without_rewriting(self) -> None:
        outputs, manifest = raster.build_outputs()
        with tempfile.TemporaryDirectory(prefix="list-record-raster-") as directory:
            root = Path(directory)
            with redirect_stdout(io.StringIO()):
                raster.write_outputs(outputs, manifest, root)
                self.assertEqual(raster.check_outputs(outputs, manifest, root), 0)

            changed = root / next(iter(outputs))
            changed.write_bytes(b"changed")
            with redirect_stdout(io.StringIO()):
                self.assertEqual(raster.check_outputs(outputs, manifest, root), 1)
            self.assertEqual(changed.read_bytes(), b"changed")


if __name__ == "__main__":
    unittest.main()
