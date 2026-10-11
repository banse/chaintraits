#!/usr/bin/env python3
"""Generate THE LIST renderer template artifacts and synthetic conformance goldens.

The SVG is percent-encoded first, inserted into the exact JSON envelope, and then
split around the 21 dynamic markers. Generated files are byte-exact and carry no
terminal newline. Run from the repository root:

    python3 tools/gen_template.py
    python3 tools/gen_template.py --check
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = Path("template/card.svg")
BLOB_PATH = Path("template/blob.hex")
OFFSETS_PATH = Path("template/offsets.txt")

DESCRIPTION = (
    "A permanent onchain record of what the claimant wallet did in THE LIST. "
    "Objective participation facts are read directly from WhitelistCurator.sol; eligibility is "
    "bound to the published filter commitment. Ownership may transfer while Claimant remains "
    "historical provenance. Marketplaces cache metadata and may temporarily show an older "
    "ownership-derived value."
)

ENVELOPE = (
    '{"name":"THE LIST #{ID}",'
    '"description":"' + DESCRIPTION + '",'
    '"image":"data:image/svg+xml,{IMAGE}",'
    '"attributes":['
    '{"trait_type":"Points","value":{POINTS}},'
    '{"trait_type":"Weight (ETH)","value":{WEIGHT}},'
    '{"trait_type":"Credit (ETH)","value":{CREDIT}},'
    '{"trait_type":"Deposits","value":{DEPOSITS}},'
    '{"trait_type":"Hour","value":"{HOUR_J}"},'
    '{"trait_type":"Window","value":"{WINDOW}"},'
    '{"trait_type":"Join Index","value":{JOIN_INDEX}},'
    '{"trait_type":"Claimed At Hour","value":{CLAIMED_AT_HOUR}},'
    '{"trait_type":"Claim Order","value":{ID}},'
    '{"trait_type":"Claimant","value":"{CLAIMANT}"},'
    '{"trait_type":"Held by claimant","value":"{HELD_YN}"}]}'
)

SLOT_ORDER = (
    "ID",
    "ID",
    "CLAIMANT",
    "POINTS",
    "CREDIT",
    "WEIGHT",
    "DEPOSITS",
    "HOUR",
    "WINDOW",
    "HELD",
    "POINTS",
    "WEIGHT",
    "CREDIT",
    "DEPOSITS",
    "HOUR_J",
    "WINDOW",
    "JOIN_INDEX",
    "CLAIMED_AT_HOUR",
    "ID",
    "CLAIMANT",
    "HELD_YN",
)

SVG_SLOT_ORDER = (
    "ID",
    "CLAIMANT",
    "POINTS",
    "CREDIT",
    "WEIGHT",
    "DEPOSITS",
    "HOUR",
    "WINDOW",
    "HELD",
)

EXPECTED_OFFSETS = (
    0,
    19,
    19,
    810,
    829,
    128,
    957,
    101,
    1058,
    278,
    1336,
    27,
    1363,
    126,
    1489,
    28,
    1517,
    12,
    1529,
    83,
    1612,
    269,
    1881,
    39,
    1920,
    39,
    1959,
    35,
    1994,
    32,
    2026,
    35,
    2061,
    38,
    2099,
    42,
    2141,
    38,
    2179,
    36,
    2215,
    45,
    2260,
    4,
)

EXPECTED_LENGTHS = {
    "description": 359,
    "svg": 1179,
    "encoded_svg": 1477,
    "blob": 2264,
    "blob_hex": 4530,
    "offsets": 173,
    "runtime": 2265,
}

EXPECTED_KECCAK = {
    "blob": "084304a65f55159ceff6e9d9a7d17683ca506b5d842cc94eb1014356f37bc5ef",
    "blob_hex": "e05d01c268ec5d0e0586f4963d0f84ebfcc5a5f9f55403887e1b87bcd1c4a577",
    "offsets": "70aa181f917fd631b8caa549648608779466f7aa4d29743b0db3251e97a27b6b",
    "runtime": "7dd6d40bd56ace74468675e14b88bdf7ae401843be2978258e34832f13a35abe",
}

FORBIDDEN_WORDS = (
    "clean",
    "review",
    "flagged",
    "cluster",
    "component",
    "linkage",
    "representative",
    "confidence",
    "analysis",
    "solo",
    "independent",
    "farmer",
    "sybil",
    "human",
    "tier",
    "cohort",
    "rank",
    "rarity",
    "reputation",
)

MARKER = re.compile(r"[{][A-Z0-9_]+[}]")
ADDRESS = re.compile(r"0x[0-9a-f]{40}")
ENCODE = set(b'%#"& <>?') | set(range(0x80, 0x100))


@dataclass(frozen=True)
class CardData:
    id: int
    claimant: str
    owner: str
    points: int
    weightWei: int
    creditWei: int
    deposits: int
    hour: int
    joinIndex: int
    claimedAtHour: int
    grace: bool


SHARED = dict(
    id=7,
    claimant="0x0000000000000000000000000000000000000921",
    points=921,
    weightWei=849_700_000_000_000_000,
    creditWei=690_000_000_000_000_000,
    deposits=7,
    hour=0,
    joinIndex=47,
    claimedAtHour=41,
    grace=True,
)

CASES = {
    "synthetic_held": CardData(owner=SHARED["claimant"], **SHARED),
    "synthetic_transferred": CardData(
        owner="0x0000000000000000000000000000000000000b0b", **SHARED
    ),
    # T11 replaces this explicit placeholder with the finalized eligibleCount.
    "synthetic_width": CardData(
        id=4_294_967_295,
        claimant="0xffffffffffffffffffffffffffffffffffffffff",
        owner="0xffffffffffffffffffffffffffffffffffffffff",
        points=44_721,
        weightWei=2_000 * 10**18,
        creditWei=1_000 * 10**18,
        deposits=4_294_967_295,
        hour=4_294_967_294,
        joinIndex=4_294_967_295,
        claimedAtHour=4_294_967_295,
        grace=False,
    ),
}

GENERATED_PATHS = tuple(
    Path(f"test/fixtures/golden_{case}_{kind}.txt")
    for case in CASES
    for kind in ("preimage", "svg", "uri")
)

OBSOLETE_PATHS = tuple(
    Path(f"test/fixtures/golden_{case}_{kind}.txt")
    for case in ("apex_sealed", "floor_live")
    for kind in ("json", "svg", "uri")
)


def _rot(value: int, amount: int) -> int:
    return ((value << amount) | (value >> (64 - amount))) & ((1 << 64) - 1) if amount else value


def _keccak_f1600(state: list[int]) -> None:
    rotations = (
        0,
        1,
        62,
        28,
        27,
        36,
        44,
        6,
        55,
        20,
        3,
        10,
        43,
        25,
        39,
        41,
        45,
        15,
        21,
        8,
        18,
        2,
        61,
        56,
        14,
    )
    round_constants = (
        0x0000000000000001,
        0x0000000000008082,
        0x800000000000808A,
        0x8000000080008000,
        0x000000000000808B,
        0x0000000080000001,
        0x8000000080008081,
        0x8000000000008009,
        0x000000000000008A,
        0x0000000000000088,
        0x0000000080008009,
        0x000000008000000A,
        0x000000008000808B,
        0x800000000000008B,
        0x8000000000008089,
        0x8000000000008003,
        0x8000000000008002,
        0x8000000000000080,
        0x000000000000800A,
        0x800000008000000A,
        0x8000000080008081,
        0x8000000000008080,
        0x0000000080000001,
        0x8000000080008008,
    )
    mask = (1 << 64) - 1
    for rc in round_constants:
        columns = [state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20] for x in range(5)]
        delta = [columns[(x - 1) % 5] ^ _rot(columns[(x + 1) % 5], 1) for x in range(5)]
        for y in range(5):
            for x in range(5):
                state[x + 5 * y] ^= delta[x]

        moved = [0] * 25
        for y in range(5):
            for x in range(5):
                moved[y + 5 * ((2 * x + 3 * y) % 5)] = _rot(state[x + 5 * y], rotations[x + 5 * y])

        for y in range(5):
            for x in range(5):
                state[x + 5 * y] = moved[x + 5 * y] ^ (
                    (~moved[(x + 1) % 5 + 5 * y]) & moved[(x + 2) % 5 + 5 * y]
                )
                state[x + 5 * y] &= mask
        state[0] ^= rc


def keccak256(data: bytes) -> bytes:
    """Return Ethereum Keccak-256 using the legacy Keccak domain suffix."""
    rate = 136
    padded = bytearray(data)
    padded.append(0x01)
    padded.extend(b"\x00" * ((rate - len(padded) % rate) % rate))
    padded[-1] ^= 0x80

    state = [0] * 25
    for block_start in range(0, len(padded), rate):
        block = padded[block_start : block_start + rate]
        for lane in range(rate // 8):
            state[lane] ^= int.from_bytes(block[lane * 8 : lane * 8 + 8], "little")
        _keccak_f1600(state)
    return b"".join(lane.to_bytes(8, "little") for lane in state)[:32]


def percent_encode(raw: bytes) -> str:
    return "".join(f"%{byte:02X}" if byte in ENCODE else chr(byte) for byte in raw)


def percent_decode(encoded: str) -> bytes:
    raw = encoded.encode("ascii")
    out = bytearray()
    index = 0
    while index < len(raw):
        if raw[index] == ord("%"):
            if index + 2 >= len(raw):
                raise ValueError("truncated percent escape")
            pair = raw[index + 1 : index + 3]
            if not re.fullmatch(rb"[0-9A-F]{2}", pair):
                raise ValueError("percent escapes must use uppercase hexadecimal")
            out.append(int(pair, 16))
            index += 3
        else:
            out.append(raw[index])
            index += 1
    return bytes(out)


def normalize_svg_source(raw: bytes) -> bytes:
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError("template/card.svg must not contain a UTF-8 BOM")
    logical = raw[:-1] if raw.endswith(b"\n") else raw
    if b"\n" in logical or b"\r" in logical:
        raise ValueError("template/card.svg may contain only one optional terminal LF")
    if logical.strip() != logical:
        raise ValueError("template/card.svg has surrounding whitespace")
    logical.decode("utf-8")
    return logical


def marker_names(text: str) -> tuple[str, ...]:
    return tuple(match.group()[1:-1] for match in MARKER.finditer(text))


def _expect_length(name: str, data: bytes | str) -> None:
    actual = len(data.encode("ascii") if isinstance(data, str) else data)
    if actual != EXPECTED_LENGTHS[name]:
        raise ValueError(f"{name} length changed: got {actual}, expected {EXPECTED_LENGTHS[name]}")


def _expect_keccak(name: str, data: bytes) -> None:
    actual = keccak256(data).hex()
    if actual != EXPECTED_KECCAK[name]:
        raise ValueError(f"{name} keccak changed: got 0x{actual}, expected 0x{EXPECTED_KECCAK[name]}")


@dataclass(frozen=True)
class TemplateArtifacts:
    svg: bytes
    encoded_svg: str
    parts: tuple[str, ...]
    blob: bytes
    blob_hex: bytes
    offsets: tuple[int, ...]
    offsets_text: bytes
    runtime: bytes


def build_template(raw_svg: bytes) -> TemplateArtifacts:
    svg = normalize_svg_source(raw_svg)
    svg_text = svg.decode("utf-8")
    if marker_names(svg_text) != SVG_SLOT_ORDER:
        raise ValueError(f"SVG marker order changed: got {marker_names(svg_text)}, expected {SVG_SLOT_ORDER}")
    if ENVELOPE.count("{IMAGE}") != 1:
        raise ValueError("JSON envelope must contain exactly one IMAGE marker")
    if len(DESCRIPTION.encode("ascii")) != EXPECTED_LENGTHS["description"]:
        raise ValueError("approved description is not 359 bytes")

    encoded_svg = percent_encode(svg)
    full = ENVELOPE.replace("{IMAGE}", encoded_svg)
    names = marker_names(full)
    if names != SLOT_ORDER:
        raise ValueError(f"slot order changed: got {names}, expected {SLOT_ORDER}")

    parts = tuple(MARKER.split(full))
    if len(parts) != 22:
        raise ValueError(f"expected 22 fixed slices, got {len(parts)}")
    blob = "".join(parts).encode("ascii")
    offsets: list[int] = []
    cursor = 0
    for part in parts:
        size = len(part.encode("ascii"))
        offsets.extend((cursor, size))
        cursor += size
    if cursor != len(blob) or len(blob) > 24_575:
        raise ValueError("template offsets do not cover a deployable blob")
    if any(value > 0xFFFF for value in offsets):
        raise ValueError("template offset does not fit uint16")

    offsets_tuple = tuple(offsets)
    offsets_text = ",".join(str(value) for value in offsets_tuple).encode("ascii")
    blob_hex = b"0x" + blob.hex().encode("ascii")
    runtime = b"\x00" + blob

    _expect_length("svg", svg)
    _expect_length("encoded_svg", encoded_svg)
    _expect_length("blob", blob)
    _expect_length("blob_hex", blob_hex)
    _expect_length("offsets", offsets_text)
    _expect_length("runtime", runtime)
    if offsets_tuple != EXPECTED_OFFSETS:
        raise ValueError(f"offset lock changed: got {offsets_tuple}, expected {EXPECTED_OFFSETS}")
    _expect_keccak("blob", blob)
    _expect_keccak("blob_hex", blob_hex)
    _expect_keccak("offsets", offsets_text)
    _expect_keccak("runtime", runtime)

    return TemplateArtifacts(svg, encoded_svg, parts, blob, blob_hex, offsets_tuple, offsets_text, runtime)


def unsigned(value: int) -> str:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"expected unsigned integer, got {value!r}")
    return str(value)


def eth4(wei_amount: int) -> str:
    unsigned(wei_amount)
    return f"{wei_amount // 10**18}.{(wei_amount % 10**18) // 10**14:04d}"


def card_values(data: CardData) -> tuple[str, ...]:
    if ADDRESS.fullmatch(data.claimant) is None or ADDRESS.fullmatch(data.owner) is None:
        raise ValueError("claimant and owner must be full lowercase hexadecimal addresses")
    claimant = data.claimant
    held = data.owner == claimant
    values = {
        "ID": unsigned(data.id),
        "CLAIMANT": claimant,
        "POINTS": unsigned(data.points),
        "CREDIT": eth4(data.creditWei),
        "WEIGHT": eth4(data.weightWei),
        "DEPOSITS": unsigned(data.deposits),
        "HOUR": unsigned(data.hour),
        "HOUR_J": f"hour {unsigned(data.hour)}",
        "WINDOW": "grace" if data.grace else "judged",
        "JOIN_INDEX": unsigned(data.joinIndex),
        "CLAIMED_AT_HOUR": unsigned(data.claimedAtHour),
        "HELD": "held%20by%20claimant" if held else "held%20by%20another",
        "HELD_YN": "yes" if held else "no",
    }
    return tuple(values[name] for name in SLOT_ORDER)


def _reject_forbidden(label: str, raw: bytes) -> None:
    folded = raw.decode("utf-8").lower()
    for word in FORBIDDEN_WORDS:
        if word in folded:
            raise ValueError(f"{label} contains forbidden word: {word}")


def render_case(template: TemplateArtifacts, data: CardData) -> tuple[bytes, bytes, bytes]:
    values = card_values(data)
    preimage = "".join(
        template.parts[index] + (values[index] if index < len(values) else "")
        for index in range(len(template.parts))
    ).encode("ascii")
    if b"\n" in preimage or b"\r" in preimage or b"\\" in preimage:
        raise ValueError("rendered preimage contains forbidden whitespace or JSON escaping")

    metadata = json.loads(preimage)
    if list(metadata) != ["name", "description", "image", "attributes"]:
        raise ValueError("top-level JSON keys changed")
    if metadata["description"] != DESCRIPTION:
        raise ValueError("approved description changed")
    if len(metadata["attributes"]) != 11:
        raise ValueError("metadata must contain exactly eleven attributes")

    image_prefix = "data:image/svg+xml,"
    image = metadata["image"]
    if not image.startswith(image_prefix):
        raise ValueError("image data URI prefix changed")
    svg = percent_decode(image[len(image_prefix) :])
    _reject_forbidden("decoded JSON", preimage)
    _reject_forbidden("decoded SVG", svg)
    uri = b"data:application/json;base64," + base64.b64encode(preimage)
    return preimage, svg, uri


def build_outputs(root: Path = ROOT) -> dict[Path, bytes]:
    template = build_template((root / TEMPLATE_PATH).read_bytes())
    outputs = {BLOB_PATH: template.blob_hex, OFFSETS_PATH: template.offsets_text}
    for case, data in CASES.items():
        preimage, svg, uri = render_case(template, data)
        outputs[Path(f"test/fixtures/golden_{case}_preimage.txt")] = preimage
        outputs[Path(f"test/fixtures/golden_{case}_svg.txt")] = svg
        outputs[Path(f"test/fixtures/golden_{case}_uri.txt")] = uri
    return outputs


def check_outputs(outputs: dict[Path, bytes], root: Path = ROOT) -> int:
    failures: list[str] = []
    for relative, expected in outputs.items():
        path = root / relative
        if not path.is_file():
            failures.append(f"missing {relative}")
        elif path.read_bytes() != expected:
            failures.append(f"differs {relative}")
    for relative in OBSOLETE_PATHS:
        if (root / relative).exists():
            failures.append(f"obsolete {relative}")
    if failures:
        print("\n".join(failures))
        return 1
    print(f"checked {len(outputs)} generated artifacts")
    return 0


def write_outputs(outputs: dict[Path, bytes], root: Path = ROOT) -> None:
    for relative, data in outputs.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    for relative in OBSOLETE_PATHS:
        path = root / relative
        if path.exists():
            path.unlink()
    print(f"generated {len(outputs)} artifacts")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="compare generated bytes without writing")
    args = parser.parse_args()
    try:
        outputs = build_outputs()
        if args.check:
            return check_outputs(outputs)
        write_outputs(outputs)
        return 0
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        print(f"generation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
