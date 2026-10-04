import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(testDirectory, '../ykn_eklenti-main');

test('distributed YKN package supports only staging, production, Apply, and YÖKSİS origins', async () => {
    const manifest = JSON.parse(await readFile(resolve(extensionRoot, 'manifest.json'), 'utf8'));
    const portalOrigins = [
        'https://goc-staging.topkapiuni.workers.dev/*',
        'https://goc.topkapiuni.workers.dev/*',
        'https://topkapiikamet.vercel.app/*'
    ];
    const bridge = manifest.content_scripts.find(({ js }) => js.includes('bridge.js'));

    assert.ok(portalOrigins.every((origin) => manifest.host_permissions.includes(origin)));
    assert.ok(portalOrigins.every((origin) => bridge.matches.includes(origin)));
    assert.ok(manifest.host_permissions.includes('https://apply.topkapi.edu.tr/*'));
    assert.ok(manifest.host_permissions.includes('https://yoksis.yok.gov.tr/*'));
    assert.doesNotMatch(JSON.stringify(manifest), /\*\.vercel\.app|\*\.topkapi\.edu\.tr|\*\.yok\.gov\.tr/);
    for (const file of ['pdf.min.js', 'pdf.worker.min.js', 'document-parser.js', 'cropper.js', 'cropper.html', 'cropper-selection.js']) {
        await readFile(resolve(extensionRoot, file));
    }
});
