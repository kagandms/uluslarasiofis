import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const staffHtml = await readFile(new URL('../yetkili/index.html', import.meta.url), 'utf8');
const staffMain = await readFile(new URL('../src/staff/main.js', import.meta.url), 'utf8');
const physicalIntakeManager = await readFile(new URL('../src/staff/physical-intake-manager.js', import.meta.url), 'utf8');

test('staff header hides only the PDF merger action and keeps the other controls', () => {
    assert.doesNotMatch(staffHtml, /btn-staff-pdf-merger/);
    assert.match(staffHtml, /btn-staff-guide/);
    assert.match(staffHtml, /Sistemi Güncelle/);
    assert.match(staffHtml, /btn-dark-mode/);
    assert.doesNotMatch(staffMain, /openPdfMergerModal/);
    assert.match(staffMain, /openStaffGuideModal/);
    assert.match(physicalIntakeManager, /openPdfMergerModal/);
});
