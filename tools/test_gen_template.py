from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

try:
    from tools import gen_template as gen
except ModuleNotFoundError:  # Allows `python3 tools/test_gen_template.py` too.
    import gen_template as gen


class GeneratorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.template = gen.build_template((gen.ROOT / gen.TEMPLATE_PATH).read_bytes())

    def test_template_structure(self) -> None:
        self.assertEqual(len(self.template.parts), gen.SLICES)
        self.assertEqual(len(self.template.offsets), gen.SLICES * 2)
        self.assertEqual(gen.marker_names(self.template.svg.decode("utf-8")), gen.SVG_SLOT_ORDER)
        cursor = 0
        for i in range(gen.SLICES):
            self.assertEqual(self.template.offsets[2 * i], cursor)
            cursor += self.template.offsets[2 * i + 1]
        self.assertEqual(cursor, len(self.template.blob))
        self.assertIn(b"bytes internal constant TEMPLATE", self.template.solidity)

    def test_percent_encoding_and_source_hygiene_are_exact(self) -> None:
        raw = b'%#"& <>?AZ\x7f\xc2\xb7'
        encoded = "%25%23%22%26%20%3C%3E%3FAZ\x7f%C2%B7"
        self.assertEqual(gen.percent_encode(raw), encoded)
        self.assertEqual(gen.percent_decode(encoded), raw)
        self.assertEqual(gen.normalize_svg_source(b"<svg/>"), b"<svg/>")
        self.assertEqual(gen.normalize_svg_source(b"<svg/>\n"), b"<svg/>")
        for invalid in (b"\xef\xbb\xbf<svg/>", b"<svg/>\n\n", b"<svg/>\r\n", b" <svg/>"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                gen.normalize_svg_source(invalid)

    def test_escape_json_neutralises_markup(self) -> None:
        self.assertEqual(gen.escape_json('a"b\\c<d>&e\x01'), 'a\\"b\\\\c\\u003cd\\u003e\\u0026e\\u0001')
        self.assertEqual(gen.escape_json("plain Name 1.0-x"), "plain Name 1.0-x")

    def test_synthetic_goldens_are_valid_json_and_svg(self) -> None:
        for name, data in gen.CASES.items():
            with self.subTest(case=name):
                preimage, svg, uri = gen.render_case(self.template, data)
                metadata = json.loads(preimage)
                self.assertEqual(metadata["name"], f"Sworn #{data.tokenId}")
                self.assertEqual(metadata["attributes"][0]["value"], data.claimant)
                self.assertEqual(metadata["traits"], list(data.traits))
                self.assertEqual(metadata["community"], list(data.community))
                self.assertEqual(len(metadata["oracle"]), len(data.oracle))
                self.assertEqual(len(metadata["attributes"]), 15 + len(data.community))
                self.assertEqual(metadata["attributes"][14], {"trait_type": "community_count", "value": data.communityCount})
                for index, trait_id in enumerate(data.community):
                    name = next(m.spec.name for m in data.oracle if m.traitId == trait_id)
                    self.assertEqual(metadata["attributes"][15 + index], {"trait_type": f"Community {trait_id}", "value": name})
                for meta in metadata["oracle"]:
                    self.assertEqual(meta["minPanelSize"], 11 if meta["template"] == "T5" else 5)
                    self.assertEqual(meta["minQuorum"], 7 if meta["template"] == "T5" else 3)
                    self.assertNotIn("panelSize", meta)
                    self.assertNotIn("quorum", meta)
                self.assertTrue(svg.startswith(b"<svg ") and svg.endswith(b"</svg>"))
                self.assertIn(data.claimant.encode(), svg)
                self.assertEqual(uri, b"data:application/json;base64," + gen.base64.b64encode(preimage))
        width = json.loads(gen.render_case(self.template, gen.CASES["synthetic_width"])[0])
        self.assertEqual(width["oracle"][0]["name"], 'a"b\\c<d>&e')
        self.assertNotIn(b"<script>", gen.render_case(self.template, gen.CASES["synthetic_width"])[0])

    def test_goldens_are_synthetic_only(self) -> None:
        for data in gen.CASES.values():
            self.assertTrue(data.claimant.endswith("c1a1"))

    def test_check_mode_detects_drift_without_rewriting(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sworn-generator-") as directory:
            root = Path(directory)
            template_path = root / gen.TEMPLATE_PATH
            template_path.parent.mkdir(parents=True)
            template_path.write_bytes((gen.ROOT / gen.TEMPLATE_PATH).read_bytes())
            outputs = gen.build_outputs(root)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(gen.check_outputs(outputs, root), 1)
                gen.write_outputs(outputs, root)
                self.assertEqual(gen.check_outputs(outputs, root), 0)
            changed = root / gen.BLOB_PATH
            changed.write_bytes(b"changed")
            with redirect_stdout(io.StringIO()):
                self.assertEqual(gen.check_outputs(outputs, root), 1)
            self.assertEqual(changed.read_bytes(), b"changed")

    def test_generated_file_set_is_complete_and_newline_free(self) -> None:
        outputs = gen.build_outputs()
        expected = {gen.BLOB_PATH, gen.OFFSETS_PATH, gen.SOLIDITY_PATH, *gen.GENERATED_PATHS}
        self.assertEqual(set(outputs), expected)
        for path, data in outputs.items():
            # the Solidity file is forge-fmt shaped (one trailing LF); every other artifact is newline-free
            self.assertEqual(data.endswith(b"\n"), path == gen.SOLIDITY_PATH, str(path))


if __name__ == "__main__":
    unittest.main()
