"""Record exact delivered generator inputs and outputs, without relying on Git metadata."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import gen_base64
import gen_questions
import gen_template

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / "docs/generation-record.json"


def sha256(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()


def record():
    outputs = sorted([*gen_template.generated(), "src/Questions.sol", "src/Base64Fast.sol"])
    inputs = sorted([
        "tools/gen_template.py", "tools/gen_questions.py", "tools/gen_base64.py",
        "tools/compress_questions.py", "tools/test_generator.py",
        "tools/operator_recipe.py", "tools/test_operator_recipe.py", "tools/record_generation.py",
        *[str(p.relative_to(ROOT)) for p in (ROOT / "templates/fixtures").glob("*.json")],
    ])
    return {
        "specificationBaseCommit": "60b0ec0b54780399eabfbfeafe1fd72835b85e57",
        "submissionCommit": "Assigned by the contribution service after these files are submitted; the exact file hashes below identify this generation.",
        "generatorCommand": "python3 tools/gen_template.py",
        "checkCommand": "python3 tools/gen_template.py --check",
        "unitTestCommand": "python3 -m unittest discover -s tools",
        "unitTestResult": "PASS: 10 tests, including geometry, clipping, all ASCII offset table tiling and the operator attribution model.",
        "hashAlgorithm": "SHA-256",
        "inputs": {name: sha256(name) for name in inputs},
        "outputs": {name: sha256(name) for name in outputs},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    subprocess.run([sys.executable, "tools/gen_template.py", "--check"], cwd=ROOT, check=True)
    subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tools"], cwd=ROOT, check=True)
    data = json.dumps(record(), indent=2) + "\n"
    if args.check:
        if not RECORD.exists() or RECORD.read_text() != data:
            raise SystemExit("Generation record drift")
    else:
        RECORD.write_text(data)
    print("Generation record " + ("checked" if args.check else "written"))


if __name__ == "__main__":
    main()
