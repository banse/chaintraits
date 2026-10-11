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

    def test_keccak_matches_ethereum_vectors(self) -> None:
        self.assertEqual(
            gen.keccak256(b"").hex(),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
        )
        self.assertEqual(
            gen.keccak256(b"abc").hex(),
            "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
        )

    def test_template_matches_every_exact_lock(self) -> None:
        self.assertEqual(len(self.template.svg), gen.EXPECTED_LENGTHS["svg"])
        self.assertEqual(len(self.template.encoded_svg), gen.EXPECTED_LENGTHS["encoded_svg"])
        self.assertEqual(len(self.template.blob), gen.EXPECTED_LENGTHS["blob"])
        self.assertEqual(len(self.template.blob_hex), gen.EXPECTED_LENGTHS["blob_hex"])
        self.assertEqual(len(self.template.offsets_text), gen.EXPECTED_LENGTHS["offsets"])
        self.assertEqual(len(self.template.runtime), gen.EXPECTED_LENGTHS["runtime"])
        self.assertEqual(self.template.offsets, gen.EXPECTED_OFFSETS)
        for name, data in (
            ("blob", self.template.blob),
            ("blob_hex", self.template.blob_hex),
            ("offsets", self.template.offsets_text),
            ("runtime", self.template.runtime),
        ):
            self.assertEqual(gen.keccak256(data).hex(), gen.EXPECTED_KECCAK[name], name)
        self.assertEqual(len(self.template.parts), 22)
        self.assertEqual(gen.marker_names(self.template.svg.decode("utf-8")), gen.SVG_SLOT_ORDER)

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
        with self.assertRaises(ValueError):
            gen.percent_decode("%c2%B7")

    def test_eth4_truncates_instead_of_rounding(self) -> None:
        self.assertEqual(gen.eth4(1_000_050_000_000_000_000), "1.0000")
        self.assertEqual(gen.eth4(999_990_000_000_000_000), "0.9999")
        self.assertEqual(gen.eth4(99_999_999_999_999), "0.0000")
        self.assertEqual(gen.eth4(100_000_000_000_000), "0.0001")

    def test_synthetic_goldens_have_exact_semantics_and_types(self) -> None:
        held, held_svg, held_uri = gen.render_case(self.template, gen.CASES["synthetic_held"])
        transferred, transferred_svg, _ = gen.render_case(
            self.template, gen.CASES["synthetic_transferred"]
        )
        width, width_svg, _ = gen.render_case(self.template, gen.CASES["synthetic_width"])

        held_json = json.loads(held)
        attributes = held_json["attributes"]
        self.assertEqual(
            [item["trait_type"] for item in attributes],
            [
                "Points",
                "Weight (ETH)",
                "Credit (ETH)",
                "Deposits",
                "Hour",
                "Window",
                "Join Index",
                "Claimed At Hour",
                "Claim Order",
                "Claimant",
                "Held by claimant",
            ],
        )
        self.assertIsInstance(attributes[0]["value"], int)
        self.assertIsInstance(attributes[1]["value"], float)
        self.assertIsInstance(attributes[2]["value"], float)
        self.assertIsInstance(attributes[3]["value"], int)
        self.assertEqual(attributes[6]["value"], 47)
        self.assertEqual(attributes[7]["value"], 41)
        self.assertEqual(attributes[8]["value"], 7)
        self.assertEqual(attributes[-1]["value"], "yes")
        self.assertIn(b"0.6900%20ETH%20credit%20%C2%B7%200.8497%20ETH%20weight", held)
        self.assertIn(b"0x0000000000000000000000000000000000000921", held_svg)
        self.assertNotIn(b'"trait_type":"Status"', held)
        self.assertEqual(
            held_uri,
            b"data:application/json;base64," + gen.base64.b64encode(held),
        )

        normalized_held = held.replace(b"held%20by%20claimant", b"held%20by%20another").replace(
            b'"value":"yes"', b'"value":"no"'
        )
        self.assertEqual(normalized_held, transferred)
        self.assertIn(b"held by claimant", held_svg)
        self.assertIn(b"held by another", transferred_svg)

        width_json = json.loads(width)
        width_attributes = width_json["attributes"]
        self.assertEqual(width_json["name"], "THE LIST #4294967295")
        self.assertEqual(width_attributes[0]["value"], 44_721)
        self.assertEqual(width_attributes[1]["value"], 2_000.0)
        self.assertEqual(width_attributes[2]["value"], 1_000.0)
        self.assertEqual(width_attributes[3]["value"], 4_294_967_295)
        self.assertEqual(width_attributes[6]["value"], 4_294_967_295)
        self.assertEqual(width_attributes[7]["value"], 4_294_967_295)
        self.assertIn(b"deposits 4294967295", width_svg)
        self.assertIn(b"joined hour 4294967294", width_svg)

    def test_check_mode_detects_drift_without_rewriting(self) -> None:
        with tempfile.TemporaryDirectory(prefix="list-record-generator-") as directory:
            root = Path(directory)
            template_path = root / gen.TEMPLATE_PATH
            template_path.parent.mkdir(parents=True)
            template_path.write_bytes((gen.ROOT / gen.TEMPLATE_PATH).read_bytes())
            outputs = gen.build_outputs(root)

            with redirect_stdout(io.StringIO()):
                self.assertEqual(gen.check_outputs(outputs, root), 1)
            obsolete = root / gen.OBSOLETE_PATHS[0]
            obsolete.parent.mkdir(parents=True, exist_ok=True)
            obsolete.write_bytes(b"obsolete")
            with redirect_stdout(io.StringIO()):
                gen.write_outputs(outputs, root)
                self.assertEqual(gen.check_outputs(outputs, root), 0)
            self.assertFalse(obsolete.exists())

            changed = root / gen.BLOB_PATH
            changed.write_bytes(b"changed")
            with redirect_stdout(io.StringIO()):
                self.assertEqual(gen.check_outputs(outputs, root), 1)
            self.assertEqual(changed.read_bytes(), b"changed")

    def test_generated_file_set_is_complete_and_newline_free(self) -> None:
        outputs = gen.build_outputs()
        expected = {gen.BLOB_PATH, gen.OFFSETS_PATH, *gen.GENERATED_PATHS}
        self.assertEqual(set(outputs), expected)
        for path, data in outputs.items():
            self.assertFalse(data.endswith(b"\n"), str(path))


if __name__ == "__main__":
    unittest.main()
