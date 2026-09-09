import os
import glob
import json
import hashlib
import zipfile
import shutil

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
extension_root = os.path.join(project_root, 'ykn_eklenti-main')
downloads_root = os.path.join(project_root, 'public', 'downloads')

extension_files = [
    'manifest.json',
    'background.js',
    'bridge.js',
    'content.js',
    'popup.html',
    'popup.js'
]

def main():
    manifest_path = os.path.join(extension_root, 'manifest.json')
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    version = manifest.get('version')
    if not version:
        raise ValueError('Geçersiz manifest sürümü')

    os.makedirs(downloads_root, exist_ok=True)

    # Remove old zips
    for old_zip in glob.glob(os.path.join(downloads_root, 'ykn-eklentisi-*.zip')):
        try:
            os.remove(old_zip)
        except OSError:
            pass

    # Calculate fingerprint
    h = hashlib.sha256()
    for fname in extension_files:
        fpath = os.path.join(extension_root, fname)
        with open(fpath, 'rb') as f:
            h.update(f.read())
    fingerprint = h.hexdigest()[:12]

    archive_name = f"ykn-eklentisi-v{version}-{fingerprint}.zip"
    archive_path = os.path.join(downloads_root, archive_name)

    # Create zip archive with ykn_eklenti/ prefix
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Include directory entry
        zf.writestr('ykn_eklenti/', '')
        for fname in extension_files:
            fpath = os.path.join(extension_root, fname)
            zf.write(fpath, arcname=f"ykn_eklenti/{fname}")

    latest_path = os.path.join(downloads_root, 'ykn-eklentisi-latest.zip')
    shutil.copyfile(archive_path, latest_path)

    meta_path = os.path.join(downloads_root, 'ykn-eklentisi.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump({
            "version": version,
            "fingerprint": fingerprint,
            "fileName": archive_name,
            "downloadUrl": f"/downloads/{archive_name}"
        }, f, indent=2)
        f.write('\n')

    print(f"YKN eklentisi paketlendi: {archive_name}")

if __name__ == '__main__':
    main()
