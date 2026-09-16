import json
import os
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
EXTENSION_DIR = ROOT_DIR / 'ykn_eklenti'
DOWNLOADS_DIR = ROOT_DIR / 'public' / 'downloads'

def package_extension():
    if not EXTENSION_DIR.exists():
        print(f"HATA: Eklenti klasörü bulunamadı: {EXTENSION_DIR}")
        return False

    manifest_path = EXTENSION_DIR / 'manifest.json'
    if not manifest_path.exists():
        print(f"HATA: manifest.json bulunamadı: {manifest_path}")
        return False

    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    version = manifest.get('version', '1.0.0')
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

    versioned_zip_name = f"ykn-eklentisi-v{version}.zip"
    versioned_zip_path = DOWNLOADS_DIR / versioned_zip_name
    latest_zip_path = DOWNLOADS_DIR / "ykn-eklentisi-latest.zip"

    with zipfile.ZipFile(latest_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(EXTENSION_DIR):
            for file in files:
                file_path = Path(root) / file
                arcname = Path('ykn_eklenti') / file_path.relative_to(EXTENSION_DIR)
                zf.write(file_path, arcname)

    shutil.copyfile(latest_zip_path, versioned_zip_path)

    metadata = {
        "version": version,
        "fileName": versioned_zip_name,
        "url": f"/downloads/{versioned_zip_name}",
        "downloadUrl": f"/downloads/{versioned_zip_name}",
        "latestUrl": "/downloads/ykn-eklentisi-latest.zip",
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }

    metadata_path = DOWNLOADS_DIR / "ykn-eklentisi.json"
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    print(f"Paketleme başarılı: {versioned_zip_name} (v{version})")
    return True

if __name__ == '__main__':
    package_extension()
