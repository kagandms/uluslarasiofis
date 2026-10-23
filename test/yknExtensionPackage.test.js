import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(testDirectory, '../ykn_eklenti-main');

test('distributed YKN package supports only staging, production, Apply, and YÖKSİS origins', async () => {
    const manifest = JSON.parse(await readFile(resolve(extensionRoot, 'manifest.json'), 'utf8'));
    const content = await readFile(resolve(extensionRoot, 'content.js'), 'utf8');
    const fieldTargets = await readFile(resolve(extensionRoot, 'yoksis-field-targets.js'), 'utf8');
    const zkControls = await readFile(resolve(extensionRoot, 'zk-form-controls.js'), 'utf8');
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
    const targetScript = manifest.content_scripts.find(({ matches }) => matches.includes('https://yoksis.yok.gov.tr/*'));
    assert.ok(targetScript.js.indexOf('yoksis-field-targets.js') < targetScript.js.indexOf('content.js'));
    assert.ok(targetScript.js.includes('yoksis-field-targets.js'));
    assert.ok(targetScript.js.indexOf('yoksis-student-identity.js') < targetScript.js.indexOf('content.js'));
    assert.match(content, new RegExp(`CONTENT_SCRIPT_VERSION = '${manifest.version}'`));
    assert.match(fieldTargets, new RegExp(`const VERSION = '${manifest.version}'`));
    assert.match(zkControls, new RegExp(`version: '${manifest.version}'`));
    for (const file of ['pdf.min.js', 'pdf.worker.min.js', 'document-parser.js', 'cropper.js', 'cropper.html', 'cropper-selection.js', 'yoksis-field-targets.js', 'yoksis-student-identity.js']) {
        await readFile(resolve(extensionRoot, file));
    }
});
