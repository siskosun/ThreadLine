"""Build a deterministic, installable ThreadLine ZIP and SHA256SUMS.

No network credentials or untracked folders are included in the ZIP.
GitHub Actions runs this only after source and extension tests pass.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
from hashlib import sha256
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'threadline-extension'
VERSION = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))['version']
OUT = ROOT / 'dist' / f'ThreadLine-v{VERSION}.zip'
OUT.parent.mkdir(parents=True, exist_ok=True)
EXCLUDED_DIRS = {'.git', '__pycache__', 'node_modules', '.pytest_cache', '.venv'}
EXCLUDED_EXTENSIONS = {'.pyc', '.log', '.tmp', '.bak', '.old'}

def include(path):
    rel = path.relative_to(SOURCE)
    return (path.is_file() and not any(part in EXCLUDED_DIRS for part in rel.parts)
            and path.suffix not in EXCLUDED_EXTENSIONS and not path.name.startswith('.DS_Store'))

def add(zf, name, data):
    info = ZipInfo(name, date_time=(2026, 10, 20, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.external_attr = (0o644 << 16)
    zf.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)

with ZipFile(OUT, 'w') as zf:
    for path in sorted(filter(include, SOURCE.rglob('*'))):
        add(zf, 'threadline-extension/' + path.relative_to(SOURCE).as_posix(), path.read_bytes())
    for path in ('LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'):
        add(zf, path, (ROOT / path).read_bytes())

with ZipFile(OUT) as zf:
    assert zf.testzip() is None, 'corrupt ZIP entry'
    names = set(zf.namelist())
    assert 'threadline-extension/manifest.json' in names
    assert 'threadline-extension/background.js' in names
    assert 'threadline-extension/backup-core.js' in names
    built_version = json.loads(zf.read('threadline-extension/manifest.json'))['version']
    assert built_version == VERSION
    assert b'isTrustedPanelSender' in zf.read('threadline-extension/background.js')

checksum = sha256(OUT.read_bytes()).hexdigest()
(ROOT / 'dist' / 'SHA256SUMS.txt').write_text(f'{checksum}  {OUT.name}\n', encoding='utf-8')
print(f'{OUT.name}: {OUT.stat().st_size} bytes, sha256={checksum}')
