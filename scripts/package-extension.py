import hashlib
import json
import os
import shutil
import zipfile

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

def read_manifest():
    manifest_path = os.path.join(extension_root, 'manifest.json')
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    return manifest

def calculate_fingerprint():
    hasher = hashlib.sha256()
    for fname in extension_files:
        fpath = os.path.join(extension_root, fname)
        with open(fpath, 'rb') as f:
            hasher.update(f.read())
    return hasher.hexdigest()[:12]

def remove_old_archives():
    if not os.path.exists(downloads_root):
        os.makedirs(downloads_root, exist_ok=True)
        return
    for fname in os.listdir(downloads_root):
        if fname.startswith('ykn-eklentisi-') and fname.endswith('.zip'):
            try:
                os.remove(os.path.join(downloads_root, fname))
            except Exception:
                pass

def package():
    manifest = read_manifest()
    version = manifest.get('version')
    if not version:
        raise ValueError('Manifest version missing')
    
    os.makedirs(downloads_root, exist_ok=True)
    remove_old_archives()
    
    fingerprint = calculate_fingerprint()
    archive_name = f"ykn-eklentisi-v{version}-{fingerprint}.zip"
    archive_path = os.path.join(downloads_root, archive_name)
    
    folder_prefix = 'ykn_eklenti/'
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for fname in extension_files:
            fpath = os.path.join(extension_root, fname)
            arcname = f"{folder_prefix}{fname}"
            zf.write(fpath, arcname)
            
    latest_path = os.path.join(downloads_root, 'ykn-eklentisi-latest.zip')
    shutil.copyfile(archive_path, latest_path)
    
    metadata = {
        "version": version,
        "fingerprint": fingerprint,
        "fileName": archive_name,
        "downloadUrl": f"/downloads/{archive_name}"
    }
    with open(os.path.join(downloads_root, 'ykn-eklentisi.json'), 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)
        f.write('\n')
        
    print(f"YKN eklentisi paketlendi: {archive_name}")

if __name__ == '__main__':
    package()
