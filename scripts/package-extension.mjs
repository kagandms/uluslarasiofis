import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const EXTENSION_DIR = resolve(ROOT_DIR, 'ykn_eklenti');
const DOWNLOADS_DIR = resolve(ROOT_DIR, 'public', 'downloads');

// Python scriptini çalıştır veya doğrudan python çağır
try {
    execSync('python scripts/package-extension.py', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch (e) {
    console.error('Python ile paketleme yapılamadı:', e.message);
}
