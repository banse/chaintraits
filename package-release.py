#!/usr/bin/env python3
# desc: Package verified public static output and portable frontend sources; never publish.
"""Usage: python3 sworn-mainnet-site/package-release.py [--help]."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.parse_args()
root = Path(__file__).resolve().parent
subprocess.run(['npm', 'run', 'build'], cwd=root / 'web', check=True, timeout=180)
subprocess.run(['npm', 'run', 'verify:export'], cwd=root / 'web', check=True, timeout=30)
release = root / 'release'
release.mkdir(exist_ok=True)

def make_zip(name, files):
    target = release / name
    files = sorted(files)
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file, member in files:
            if file.is_symlink() or not file.is_file():
                raise ValueError(f'Only regular public files may be packaged: {member}')
            archive.write(file, member)
    return {'file': name, 'files': len(files), 'bytes': target.stat().st_size,
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}

static = [(p, str(p.relative_to(root / 'dist'))) for p in (root / 'dist').rglob('*') if p.is_file()]
source = []
for directory in ['web/src', 'web/scripts', 'web/public', 'web/tests', 'src', 'agents', 'docs']:
    source.extend((p, str(p.relative_to(root))) for p in (root / directory).rglob('*')
                  if p.is_file() and '__pycache__' not in p.parts and not any(part.startswith('.') for part in p.relative_to(root).parts))
for name in ['web/package.json', 'web/package-lock.json', 'web/tsconfig.json', 'web/vite.config.ts',
             'web/index.html', 'web/network.json', 'web/deployment-handoff.json', 'web/source-pin.json',
             'README.md', 'DEPLOYMENT.md', 'LICENSE', 'start.sh', 'package-release.py', 'provenance.json']:
    source.append((root / name, name))
records = [make_zip('sworn-mainnet-static.zip', static), make_zip('sworn-mainnet-source.zip', source)]
(release / 'SHA256.json').write_text(json.dumps(records, indent=2) + '\n')
print(json.dumps(records, indent=2))
