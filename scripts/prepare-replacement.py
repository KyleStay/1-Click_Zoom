"""Prepare an identity-checked unpacked candidate from an existing runtime ZIP.

The public key must come from the existing Chrome Web Store item's Package tab.
This tool never generates keys, changes a browser profile, or disables extensions.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def public_identity(text):
    encoded = ''.join(text.split())
    try:
        der = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise ValueError('Expected the existing item\'s base64 DER public key') from error
    if not der or len(der) > 8192:
        raise ValueError('Invalid public key size')
    checked = subprocess.run(['openssl', 'pkey', '-pubin', '-inform', 'DER', '-noout'],
                             input=der, capture_output=True)
    if checked.returncode:
        raise ValueError('Expected a DER public key, never a private key or certificate')
    digest = hashlib.sha256(der).hexdigest()[:32]
    extension_id = ''.join(chr(ord('a') + int(value, 16)) for value in digest)
    return encoded, extension_id


def prepare(package, key_file, expected_id, output, mode="replacement"):
    if mode not in {"replacement", "separate"}:
        raise ValueError("Unknown development mode")
    if mode == "separate":
        if key_file is not None or expected_id is not None:
            raise ValueError("Separate development mode cannot use production identity input")
        key = None
        digest = hashlib.sha256(str(output.resolve()).encode()).hexdigest()[:32]
        actual_id = "".join(chr(ord("a") + int(value, 16)) for value in digest)
    elif not isinstance(expected_id, str) or not re.fullmatch('[a-p]{32}', expected_id):
        raise ValueError('Expected an exact 32-character Chrome Web Store item ID')
    if mode == 'replacement':
        if key_file is None:
            raise ValueError('Replacement requires the existing item public key')
        key, actual_id = public_identity(key_file.read_text())
    if mode == 'replacement' and actual_id != expected_id:
        raise ValueError('Public key does not match the expected existing item ID; no output written')
    if output.exists():
        raise ValueError('Output must be a new directory; existing candidates are never overwritten')
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(
                Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name for name in names):
            raise ValueError('Unsafe or duplicate package entry')
        manifest = json.loads(archive.read('manifest.json'))
        if manifest.get('manifest_version') != 3 or 'management' in manifest.get('permissions', []):
            raise ValueError('Expected the reviewed Manifest V3 package without management permission')
        if archive.testzip() is not None:
            raise ValueError('Corrupt runtime package')
        if key:
            manifest['key'] = key
        else:
            manifest.pop('key', None)
            manifest['name'] += ' Development'
        manifest['version_name'] = manifest['version'] + ' replacement candidate'
        output.parent.mkdir(parents=True, exist_ok=True)
        scratch = Path(tempfile.mkdtemp(prefix='.zoom-dev-', dir=output.parent))
        try:
            archive.extractall(scratch)
            (scratch / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            scratch.rename(output)
        finally:
            if scratch.exists():
                shutil.rmtree(scratch)
    return {'extension_id': actual_id, 'version': manifest['version'], 'directory': str(output.resolve()),
            'mode': mode, 'production_modified': False}


def main():
    version = json.loads((ROOT / 'manifest.json').read_text())['version']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, default=ROOT / 'dist' / f'one-click-zoom-production-{version}.zip')
    parser.add_argument('--mode', choices=['replacement'], default='replacement')
    parser.add_argument('--public-key-file', type=Path)
    parser.add_argument('--expected-id')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.package, args.public_key_file, args.expected_id, args.output, args.mode), indent=2))
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
