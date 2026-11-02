import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const staffHtml = await readFile(new URL('../yetkili/index.html', import.meta.url), 'utf8');
const staffMain = await readFile(new URL('../src/staff/main.js', import.meta.url), 'utf8');
const physicalIntakeManager = await readFile(new URL('../src/staff/physical-intake-manager.js', import.meta.url), 'utf8');

test('staff header hides the PDF merger and guide while keeping the other controls', () => {
    assert.doesNotMatch(staffHtml, /btn-staff-pdf-merger/);
    assert.doesNotMatch(staffHtml, /btn-staff-guide/);
    assert.match(staffHtml, /Sistemi Güncelle/);
    assert.match(staffHtml, /btn-dark-mode/);
    assert.doesNotMatch(staffMain, /openPdfMergerModal/);
    assert.doesNotMatch(staffMain, /openStaffGuideModal/);
    assert.match(physicalIntakeManager, /openPdfMergerModal/);
});
