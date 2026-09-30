import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PDFJS_VERSION } from '../src/config/pdfjs-version.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const staffHtml = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');
const pdfBootstrap = readFileSync(new URL('../src/staff/pdfjs-bootstrap.js', import.meta.url), 'utf8');
const yknManager = readFileSync(new URL('../src/managers/yknManager.js', import.meta.url), 'utf8');

test('PDF.js stays pinned to the patched package and same-origin support assets', () => {
    assert.equal(packageJson.devDependencies['pdfjs-dist'], PDFJS_VERSION);
    assert.match(pdfBootstrap, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
    assert.match(pdfBootstrap, /pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url/);
    assert.doesNotMatch(staffHtml, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js/);
    assert.doesNotMatch(yknManager, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js/);
    assert.equal((yknManager.match(/isEvalSupported: false/g) || []).length, 3);
});
