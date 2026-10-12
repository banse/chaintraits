#!/usr/bin/env python3
"""Generate the chaintraits renderer template artifacts and synthetic conformance goldens.

The SVG (`template/card.svg`) is percent-encoded, inserted into the exact JSON envelope, and split
around the 35 dynamic markers. The generator writes:

    template/blob.hex        the template blob, 0x-prefixed hex
    template/offsets.txt     start,length pairs of the 36 fixed slices, decimal, comma-separated
    src/TemplateData.sol     the same blob and offsets as `bytes constant` (read by `Renderer.sol`)
    test/fixtures/golden_<case>_{preimage,svg,uri}.txt   the goldens for the synthetic cards

Generated files are byte-exact and carry no terminal newline. Run from the repository root:

    python3 tools/gen_template.py
    python3 tools/gen_template.py --check

Goldens are for synthetic wallets only (the `0x...c1a1` convention); never a real wallet.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = Path("template/card.svg")
BLOB_PATH = Path("template/blob.hex")
OFFSETS_PATH = Path("template/offsets.txt")
SOLIDITY_PATH = Path("src/TemplateData.sol")

DESCRIPTION = (
    "An ownerless onchain registry of verifiable wallet feats. One card per wallet; every trait is a fact "
    "about the claimant wallet that minted the card, never about the holder. Direct-read traits are read "
    "live from the settled WhitelistCurator and the IdentityMD collection; chain-proven, panel-attested "
    "and shared-fact traits are attested by the IMD oracle through the Intake and verified in the "
    "registry. Allowlists read hasTrait, never ownerOf."
)

FAMILIES = (
    "Contributor",
    "Early bird",
    "Climber",
    "Capital",
    "Scoreboard",
    "Operator",
    "Still here",
    "Last stand",
    "The last one in",
    "Hour savior",
    "Ordinal",
    "Top 32",
    "Not born yesterday",
)

ENVELOPE = (
    '{"name":"chaintraits #{ID}",'
    '"description":"' + DESCRIPTION + '",'
    '"image":"data:image/svg+xml,{IMAGE}",'
    '"attributes":['
    '{"trait_type":"Claimant","value":"{CLAIMANT}"},'
    + "".join(
        '{"trait_type":"' + name + '","value":"{F' + str(index + 1) + '}"},' for index, name in enumerate(FAMILIES)
    )
    + '{"trait_type":"community_count","value":{CC}}{COMMUNITY_ATTRIBUTES}],'
    '"traits":[{TRAITS}],'
    '"community":[{COMMUNITY}],'
    '"oracle":[{ORACLE}]}'
)

SVG_SLOT_ORDER = ("ID", "CLAIMANT") + tuple(f"F{i}" for i in range(1, 14))
SLOT_ORDER = ("ID",) + SVG_SLOT_ORDER + ("CLAIMANT",) + tuple(f"F{i}" for i in range(1, 14)) + (
    "CC",
    "COMMUNITY_ATTRIBUTES",
    "TRAITS",
    "COMMUNITY",
    "ORACLE",
)
SLOTS = len(SLOT_ORDER)
SLICES = SLOTS + 1

MARKER = re.compile(r"[{][A-Z0-9_]+[}]")
ADDRESS = re.compile(r"0x[0-9a-f]{40}")
ENCODE = set(b'%#"& <>?') | set(range(0x80, 0x100))

CATALOG_IDS = (
    101, 201, 202, 301, 302, 303, 401, 402, 403, 404, 501, 502, 503, 601,
    701, 801, 901, 1001, 1101, 1102, 1103, 1104, 1105, 1201, 1301,
)

CURATOR = "0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91"
DEPOSITED = (
    "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, "
    "uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)"
)
B_DEPLOY = 25769870
B_END = 25789604


@dataclass(frozen=True)
class SpecData:
    kind: int
    target: str
    item: str
    arg: str
    fixedArg: str
    fixedVal: int
    sumArg: str
    op: int
    threshold: int
    fromBlock: int
    toBlock: int
    name: str


@dataclass(frozen=True)
class OracleMeta:
    traitId: int
    requestId: str
    oracleRequestId: str
    spec: SpecData


@dataclass(frozen=True)
class CardData:
    tokenId: int
    claimant: str
    top: tuple[int, ...]  # 13 entries, 0 = none
    traits: tuple[int, ...]
    community: tuple[int, ...]
    communityCount: int
    oracle: tuple[OracleMeta, ...] = field(default_factory=tuple)


SPEC_801 = SpecData(1, CURATOR, DEPOSITED, "contributor", "hour", 64, "", 0, 1, B_DEPLOY, B_END, "Last stand")
SPEC_10001 = SpecData(
    1,
    "0x000000000000000000000000000000000000c0de",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "to",
    "",
    0,
    "",
    0,
    1,
    B_DEPLOY,
    B_END,
    "Received a token",
)
# A renderer-only case: a name and an item the registry would refuse, to prove the escaping.
SPEC_HOSTILE = SpecData(
    4,
    "0x000000000000000000000000000000000000c0de",
    'function f(address) view returns (uint256)"</text><script>&\x01\\',
    "",
    "",
    0,
    "",
    1,
    1000,
    B_DEPLOY,
    B_END,
    'a"b\\c<d>&e',
)

REQUEST_1 = "0x1111111111111111111111111111111111111111111111111111111111111111"
REQUEST_2 = "0x2222222222222222222222222222222222222222222222222222222222222222"
ORACLE_1 = "0x0123456789abcdef0123456789abcdef00000000000000000000000000000000"
ORACLE_2 = "0xfedcba9876543210fedcba987654321000000000000000000000000000000000"

CASES = {
    # a member with direct-read traits only: hour 0, five deposits, 1 ETH high water, 1000 points
    "synthetic_direct": CardData(
        tokenId=1,
        claimant="0x000000000000000000000000000000000000c1a1",
        top=(101, 202, 302, 401, 501, 0, 0, 0, 0, 0, 0, 0, 0),
        traits=(101, 201, 202, 301, 302, 401, 501),
        community=(),
        communityCount=0,
    ),
    # a non-member IDMD holder with one verified catalog chain trait and one verified community spec
    "synthetic_oracle": CardData(
        tokenId=2,
        claimant="0x00000000000000000000000000000000000ac1a1",
        top=(0, 0, 0, 0, 0, 601, 0, 801, 0, 0, 0, 0, 0),
        traits=(601, 801),
        community=(10001,),
        communityCount=1,
        oracle=(OracleMeta(801, REQUEST_1, ORACLE_1, SPEC_801), OracleMeta(10001, REQUEST_2, ORACLE_2, SPEC_10001)),
    ),
    # the widest values the renderer can meet, through the renderer alone
    "synthetic_width": CardData(
        tokenId=2**256 - 1,
        claimant="0xffffffffffffffffffffffffffffffffffffc1a1",
        top=(101, 202, 303, 404, 503, 601, 701, 801, 901, 1001, 1101, 1201, 1301),
        traits=CATALOG_IDS,
        community=tuple(range(10001, 10033)),
        communityCount=40,
        oracle=tuple(OracleMeta(i, REQUEST_1, ORACLE_1, SPEC_HOSTILE) for i in range(10001, 10033)),
    ),
}

GENERATED_PATHS = tuple(
    Path(f"test/fixtures/golden_{case}_{kind}.txt") for case in CASES for kind in ("preimage", "svg", "uri")
)


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


@dataclass(frozen=True)
class TemplateArtifacts:
    svg: bytes
    encoded_svg: str
    parts: tuple[str, ...]
    blob: bytes
    blob_hex: bytes
    offsets: tuple[int, ...]
    offsets_text: bytes
    solidity: bytes


def build_template(raw_svg: bytes) -> TemplateArtifacts:
    svg = normalize_svg_source(raw_svg)
    svg_text = svg.decode("utf-8")
    if marker_names(svg_text) != SVG_SLOT_ORDER:
        raise ValueError(f"SVG marker order changed: got {marker_names(svg_text)}, expected {SVG_SLOT_ORDER}")
    if ENVELOPE.count("{IMAGE}") != 1:
        raise ValueError("JSON envelope must contain exactly one IMAGE marker")

    encoded_svg = percent_encode(svg)
    full = ENVELOPE.replace("{IMAGE}", encoded_svg)
    names = marker_names(full)
    if names != SLOT_ORDER:
        raise ValueError(f"slot order changed: got {names}, expected {SLOT_ORDER}")

    parts = tuple(MARKER.split(full))
    if len(parts) != SLICES:
        raise ValueError(f"expected {SLICES} fixed slices, got {len(parts)}")
    blob = "".join(parts).encode("ascii")
    offsets: list[int] = []
    cursor = 0
    for part in parts:
        size = len(part.encode("ascii"))
        offsets.extend((cursor, size))
        cursor += size
    if cursor != len(blob) or len(blob) > 20_000:
        raise ValueError("template offsets do not cover a deployable blob")
    if any(value > 0xFFFF for value in offsets):
        raise ValueError("template offset does not fit uint16")

    offsets_tuple = tuple(offsets)
    offsets_text = ",".join(str(value) for value in offsets_tuple).encode("ascii")
    blob_hex = b"0x" + blob.hex().encode("ascii")
    packed = b"".join(value.to_bytes(2, "big") for value in offsets_tuple)
    solidity = (
        "// SPDX-License-Identifier: MIT\n"
        "pragma solidity 0.8.24;\n\n"
        "/// @notice Generated by tools/gen_template.py from template/card.svg; do not edit by hand.\n"
        "/// @dev    The metadata template as a compile-time constant (solc emits a codecopy) and the\n"
        "///         start,length pairs of its fixed slices as big-endian uint16, written as ASCII hex so the\n"
        "///         code data carries no byte the launch's opcode scan forbids (0xf2, 0xf4, 0xff).\n"
        "library TemplateData {\n"
        f"    uint256 internal constant SLOTS = {SLOTS};\n"
        f"    uint256 internal constant SLICES = {SLICES};\n"
        "    bytes internal constant TEMPLATE =\n"
        f'        hex"{blob.hex()}";\n'
        "    bytes internal constant OFFSETS =\n"
        f'        "{packed.hex()}";\n'
        "}\n"
    ).encode("ascii")
    return TemplateArtifacts(svg, encoded_svg, parts, blob, blob_hex, offsets_tuple, offsets_text, solidity)


def unsigned(value: int) -> str:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"expected unsigned integer, got {value!r}")
    return str(value)


def hex32(value: str) -> str:
    if not re.fullmatch(r"0x[0-9a-f]{64}", value):
        raise ValueError(f"expected a 32-byte lowercase hex word, got {value!r}")
    return value


def escape_json(raw: str) -> str:
    """Mirror of Renderer.escapeJson: `"` and `\\` escaped; control bytes, `<`, `>`, `&` as \\u00xx."""
    out = []
    for byte in raw.encode("latin-1"):
        if byte in (0x22, 0x5C):
            out.append("\\" + chr(byte))
        elif byte < 0x20 or byte in (0x3C, 0x3E, 0x26):
            out.append(f"\\u00{byte:02x}")
        else:
            out.append(chr(byte))
    return "".join(out)


def oracle_entry(meta: OracleMeta) -> str:
    s = meta.spec
    return (
        '{"traitId":' + unsigned(meta.traitId)
        + ',"template":"T' + unsigned(s.kind)
        + '","evidence":"' + ("panel" if s.kind == 5 else "chain")
        + '","fromBlock":' + unsigned(s.fromBlock)
        + ',"toBlock":' + unsigned(s.toBlock)
        + ',"minPanelSize":' + ("11" if s.kind == 5 else "5")
        + ',"minQuorum":' + ("7" if s.kind == 5 else "3")
        + ',"requestId":"' + hex32(meta.requestId)
        + '","oracleRequestId":"' + hex32(meta.oracleRequestId)
        + '","target":"' + s.target
        + '","item":"' + escape_json(s.item)
        + '","arg":"' + escape_json(s.arg)
        + '","fixedArg":"' + escape_json(s.fixedArg)
        + '","fixedVal":' + unsigned(s.fixedVal)
        + ',"sumArg":"' + escape_json(s.sumArg)
        + '","op":' + unsigned(s.op)
        + ',"threshold":' + unsigned(s.threshold)
        + ',"name":"' + escape_json(s.name)
        + '"}'
    )


def card_values(data: CardData) -> tuple[str, ...]:
    if ADDRESS.fullmatch(data.claimant) is None:
        raise ValueError("claimant must be a full lowercase hexadecimal address")
    if not data.claimant.endswith("c1a1"):
        raise ValueError("goldens are for synthetic wallets only (0x...c1a1)")
    if len(data.top) != 13:
        raise ValueError("top must hold one entry per family")
    values = {
        "ID": unsigned(data.tokenId),
        "CLAIMANT": data.claimant,
        "CC": unsigned(data.communityCount),
        "TRAITS": ",".join(unsigned(v) for v in data.traits),
        "COMMUNITY": ",".join(unsigned(v) for v in data.community),
        "COMMUNITY_ATTRIBUTES": "".join(
            ',{"trait_type":"Community ' + unsigned(trait_id) + '","value":"'
            + escape_json(next((m.spec.name for m in data.oracle if m.traitId == trait_id), "")) + '"}'
            for trait_id in data.community
        ),
        "ORACLE": ",".join(oracle_entry(m) for m in data.oracle),
    }
    for index, top in enumerate(data.top):
        values[f"F{index + 1}"] = "none" if top == 0 else unsigned(top)
    return tuple(values[name] for name in SLOT_ORDER)


def render_case(template: TemplateArtifacts, data: CardData) -> tuple[bytes, bytes, bytes]:
    values = card_values(data)
    preimage = "".join(
        template.parts[index] + (values[index] if index < len(values) else "") for index in range(len(template.parts))
    ).encode("ascii")
    if b"\n" in preimage or b"\r" in preimage:
        raise ValueError("rendered preimage contains forbidden whitespace")

    metadata = json.loads(preimage)
    if list(metadata) != ["name", "description", "image", "attributes", "traits", "community", "oracle"]:
        raise ValueError("top-level JSON keys changed")
    if metadata["description"] != DESCRIPTION:
        raise ValueError("approved description changed")
    if len(metadata["attributes"]) != 15 + len(data.community):
        raise ValueError("metadata must contain fifteen base attributes plus the shown community traits")

    image_prefix = "data:image/svg+xml,"
    image = metadata["image"]
    if not image.startswith(image_prefix):
        raise ValueError("image data URI prefix changed")
    svg = percent_decode(image[len(image_prefix) :])
    uri = b"data:application/json;base64," + base64.b64encode(preimage)
    return preimage, svg, uri


def build_outputs(root: Path = ROOT) -> dict[Path, bytes]:
    template = build_template((root / TEMPLATE_PATH).read_bytes())
    outputs = {BLOB_PATH: template.blob_hex, OFFSETS_PATH: template.offsets_text, SOLIDITY_PATH: template.solidity}
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
