import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { createApplicationQueueTable } from '../src/staff/application-queue-table.js';

const INDEX_CSS = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

function createQueueDom(context) {
    const dom = new JSDOM('<!DOCTYPE html><html lang="tr"><body></body></html>', { url: 'https://portal.test/yetkili/' });
    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;
    context.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        dom.window.close();
    });
    return dom.window.document;
}

test('createApplicationQueueTable marks online columns and wrapping action cells', (context) => {
    const document = createQueueDom(context);
    const table = createApplicationQueueTable(document, [{
        id: 'app-layout-1',
        student_number: '20260001',
        first_name: 'Deniz',
        last_name: 'Karahanlıoğlu',
        application_type: 'initial',
        status: 'approved_for_processing',
        submitted_at: '2026-10-10T09:30:00.000Z',
        updated_at: '2026-10-11T12:15:00.000Z'
    }], {
        noteKind: 'online',
        skipNoteLoad: true,
        statusLabel: () => 'İşleme alınmak üzere onaylandı',
        actions: () => [
            { label: 'GöçNet’e aktar', action: 'gocnet-transfer', run: () => {} },
            { label: 'Detay', action: 'open-detail', run: () => {} },
            { label: 'İndir', action: 'download-application-archive', run: () => {} }
        ]
    });

    assert.ok(table.classList.contains('staff-applications-table'));
    assert.ok(table.querySelector('th.staff-record-note-col'));
    assert.ok(table.querySelector('td.staff-record-note-cell'));

    const nameHeader = table.querySelector('th.staff-queue-col-name');
    const nameCell = table.querySelector('td.staff-queue-col-name');
    assert.equal(nameHeader?.textContent, 'Ad Soyad');
    assert.equal(nameCell?.dataset.label, 'Ad Soyad');

    const statusHeader = table.querySelector('th.staff-queue-col-status');
    const statusCell = table.querySelector('td.staff-queue-col-status');
    assert.equal(statusHeader?.textContent, 'Durum');
    assert.equal(statusCell?.dataset.label, 'Durum');

    const nowrapCells = [...table.querySelectorAll('td.staff-queue-col-nowrap')].map((cell) => cell.dataset.label);
    assert.deepEqual(nowrapCells, ['Öğrenci No', 'Gönderim Tarihi', 'Son Güncelleme']);

    assert.ok(table.querySelector('th.staff-queue-col-actions'));
    const actionsCell = table.querySelector('td.staff-queue-actions-cell');
    assert.ok(actionsCell);
    assert.equal(actionsCell.dataset.label, 'Detay');
    assert.equal(actionsCell.querySelectorAll('button.staff-queue-action-btn').length, 3);
});

test('createApplicationQueueTable marks physical intake columns including Ofis Durumu and Sıra', (context) => {
    const document = createQueueDom(context);
    const table = createApplicationQueueTable(document, [{
        id: 'phy-layout-1',
        tracking_reference: 'ITU-26-0000001',
        first_name: 'Mert',
        last_name: 'Özdemir',
        status: 'under_review'
    }], {
        headers: ['', 'Sıra', 'Takip No', 'Ad Soyad', 'Teslim Tarihi', 'Ofis Durumu', 'PDF', 'A4', ''],
        noteKind: 'physical',
        skipNoteLoad: true,
        rowNumber: () => '1',
        values: (item) => [
            item.tracking_reference,
            `${item.first_name} ${item.last_name}`,
            '11.10.2026',
            'İncelemede',
            'PDF var',
            'Hazır'
        ],
        statusLabel: (status) => status,
        actions: () => [
            { label: 'Detay', action: 'open-detail', run: () => {} },
            { label: 'İndir', action: 'download-physical-pdf', run: () => {} },
            { label: 'Sil', action: 'delete', run: () => {} }
        ]
    });

    assert.equal(table.querySelector('td.staff-queue-col-name')?.dataset.label, 'Ad Soyad');
    assert.equal(table.querySelector('td.staff-queue-col-status')?.dataset.label, 'Ofis Durumu');
    assert.deepEqual(
        [...table.querySelectorAll('td.staff-queue-col-nowrap')].map((cell) => cell.dataset.label),
        ['Sıra', 'Takip No', 'Teslim Tarihi']
    );
    assert.ok(table.querySelector('td.staff-queue-actions-cell'));
});

test('queue table CSS enforces column widths, whole-word wrapping, action wrapping, horizontal scroll, and mobile cards', () => {
    assert.match(INDEX_CSS, /\.staff-applications-queue\s*\{[^}]*overflow-x:\s*auto;/s);
    assert.match(INDEX_CSS, /\.staff-applications-table\s+th,\s*\.staff-applications-table\s+td\s*\{[^}]*overflow-wrap:\s*break-word;[^}]*word-break:\s*normal;/s);
    assert.doesNotMatch(INDEX_CSS, /\.staff-applications-table\s+th,\s*\.staff-applications-table\s+td\s*\{[^}]*(overflow-wrap:\s*anywhere|word-break:\s*break-all)/s);
    assert.match(INDEX_CSS, /\.staff-applications-table\s+td\[data-label="Ad Soyad"\]\s*\{[^}]*min-width:\s*11rem;/s);
    assert.match(INDEX_CSS, /\.staff-applications-table\s+td\[data-label="Durum"\][^{]*\{[^}]*min-width:\s*9rem;/s);
    assert.match(INDEX_CSS, /\.staff-applications-table\s+td\[data-label="Ofis Durumu"\][^{]*\{[^}]*min-width:\s*9rem;/s);
    assert.match(INDEX_CSS, /\.staff-applications-table\s+td\[data-label="Öğrenci No"\][^{]*\{[^}]*white-space:\s*nowrap;/s);
    assert.match(INDEX_CSS, /\.staff-applications-table\s+td\.staff-record-note-cell\s*\{[^}]*width:\s*3rem;/s);
    assert.match(INDEX_CSS, /\.staff-applications-table\s+td\.staff-queue-actions-cell,\s*\.staff-applications-table\s+td\[data-label="Detay"\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^;]+;[^}]*gap:[^;]+;[^}]*max-width:\s*26rem;/s);
    assert.match(INDEX_CSS, /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*\.staff-applications-table\s+td::before\s*\{[^}]*content:\s*attr\(data-label\);/s);
    assert.match(INDEX_CSS, /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*\.staff-applications-table\s+td\.staff-queue-actions-cell,\s*\.staff-applications-table\s+td\[data-label="Detay"\]\s*\{[^}]*max-width:\s*none;/s);
});
