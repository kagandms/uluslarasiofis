import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
    TEBLIGAT_PAGE_STYLES,
    buildTebligatFilename,
    canPrintTebligat,
    createTebligatPage,
    formatEIkametNumber,
    formatTebligatDate,
    toIstanbulIsoDate
} from '../src/shared/tebligatPage.js';
import { openTebligatDialog } from '../src/ui/tebligatDialog.js';
import { readRegistrationNumberFromForm } from '../src/staff/gocnet-transfer.js';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';
import { renderPhysicalIntakes } from '../src/staff/physical-intake-view.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

function installDocument(context, document) {
    const previousDocument = globalThis.document;
    globalThis.document = document;
    context.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        document.defaultView.close();
    });
}

function installWindow(context, win) {
    const previousWindow = globalThis.window;
    globalThis.window = win;
    context.after(() => {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    });
}

test('formatEIkametNumber formats typing progression, full 13 digits, truncation, stripping, and empty input', () => {
    assert.equal(formatEIkametNumber('2'), '2');
    assert.equal(formatEIkametNumber('2026'), '2026');
    assert.equal(formatEIkametNumber('20265'), '2026-5');
    assert.equal(formatEIkametNumber('202651'), '2026-51');
    assert.equal(formatEIkametNumber('2026511'), '2026-51-1');
    assert.equal(formatEIkametNumber('2026511211318'), '2026-51-1211318');
    assert.equal(formatEIkametNumber('202651121131899'), '2026-51-1211318');
    assert.equal(formatEIkametNumber('2026-51-1211318'), '2026-51-1211318');
    assert.equal(formatEIkametNumber('202651 1211318'), '2026-51-1211318');
    assert.equal(formatEIkametNumber('ab2026-cd51 ef1211318!'), '2026-51-1211318');
    assert.equal(formatEIkametNumber('abc---   '), '');
    assert.equal(formatEIkametNumber(''), '');
    assert.equal(formatEIkametNumber(null), '');
    assert.equal(formatEIkametNumber(undefined), '');
});

test('canPrintTebligat returns true only for sent_to_migration', () => {
    assert.equal(canPrintTebligat('sent_to_migration'), true);
    for (const status of [
        'draft', 'submitted', 'under_review', 'resubmission_required',
        'approved_for_processing', 'migration_approved', 'completed',
        'cancelled', 'rejected', '', null, undefined, 'SENT_TO_MIGRATION'
    ]) {
        assert.equal(canPrintTebligat(status), false);
    }
});

test('createTebligatPage renders required header, field order, dates, status box, and no Sayfa or table', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    try {
        const page = createTebligatPage(dom.window.document, {
            firstName: 'İbrahim',
            lastName: 'ışıl',
            passportNumber: 'P987654',
            birthDate: '2004-05-09',
            eIkametNo: '2026-11-123456',
            basvuruKayitNo: '1234567890',
            islemKayitNo: '987654321',
            migrationGoDate: '2026-11-20',
            printedAt: new Date('2026-11-24T10:00:00Z')
        }, {
            migration: 'data:image/png;base64,mig',
            university: 'data:image/jpeg;base64,uni'
        });

        assert.ok(page.textContent.includes('TOPKAPI ÜNİVERSİTESİ'));
        assert.ok(page.textContent.includes('TEBLİĞ / TEBLİGAT SAYFASI'));
        assert.ok(page.textContent.includes('Göç İdaresine iletildi'));
        assert.ok(page.textContent.includes('GÖÇ İDARESİNE GİDİŞ TARİHİ'));
        assert.ok(page.textContent.includes('Çıktı tarihi: 24.11.2026'));
        assert.equal(page.textContent.includes('Sayfa'), false);
        assert.equal(page.textContent.includes('YÖKSİS ID'), false);
        assert.equal(page.querySelector('table'), null);

        const name = page.querySelector('.tebligat-student-name');
        assert.equal(name.textContent, 'İBRAHIM IŞIL');

        const foreignPage = createTebligatPage(dom.window.document, { firstName: 'Al-Rashid' });
        assert.equal(foreignPage.querySelector('.tebligat-student-name').textContent, 'AL-RASHID');

        const labels = [...page.querySelectorAll('.tebligat-grid dt')].map((node) => node.textContent);
        const values = [...page.querySelectorAll('.tebligat-grid dd')].map((node) => node.textContent);
        assert.deepEqual(labels, [
            'E-İKAMET BAŞVURU NO',
            'PASAPORT NO',
            'YÖKSİS BAŞVURU KAYIT NO',
            'YÖKSİS İŞLEM KAYIT NO',
            'DOĞUM TARİHİ'
        ]);
        assert.deepEqual(values, ['2026-11-123456', 'P987654', '1234567890', '987654321', '09.05.2004']);
        assert.equal(page.querySelector('.tebligat-date-section .tebligat-value').textContent, '20.11.2026');

        const withoutIslemPage = createTebligatPage(dom.window.document, {
            firstName: 'Ayşe',
            lastName: 'Yılmaz',
            passportNumber: 'P123',
            birthDate: '2004-05-09',
            eIkametNo: '2026-11-123456',
            basvuruKayitNo: '1234567890',
            islemKayitNo: ''
        });
        const withoutIslemValues = [...withoutIslemPage.querySelectorAll('.tebligat-grid dd')].map((node) => node.textContent);
        assert.deepEqual(withoutIslemValues, ['2026-11-123456', 'P123', '1234567890', '—', '09.05.2004']);
        assert.equal(withoutIslemPage.textContent.includes('YÖKSİS ID'), false);

        const logos = [...page.querySelectorAll('header img')];
        assert.equal(logos.length, 2);
        assert.equal(logos[0].dataset.documentLogo, 'migration');
        assert.equal(logos[1].dataset.documentLogo, 'university');
    } finally {
        dom.window.close();
    }
});

test('createTebligatPage writes untrusted student strings via textContent without creating DOM elements', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    try {
        const rawFirstName = '<img src=x onerror=alert(1)>';
        const rawLastName = '<script>alert(2)</script>';
        const page = createTebligatPage(dom.window.document, {
            firstName: rawFirstName,
            lastName: rawLastName,
            passportNumber: '<b>AB12</b>',
            birthDate: '2001-01-02',
            eIkametNo: '2026-11-0001',
            basvuruKayitNo: '123456',
            islemKayitNo: '654321',
            migrationGoDate: '2026-11-24'
        }, {
            migration: 'data:image/png;base64,mig',
            university: 'data:image/jpeg;base64,uni'
        });

        assert.equal(page.querySelectorAll('img').length, 2);
        assert.equal(page.querySelector('script'), null);
        assert.equal(page.querySelector('b'), null);
        assert.ok(page.textContent.includes('<IMG SRC=X ONERROR=ALERT(1)>'));
        assert.ok(page.textContent.includes('<SCRIPT>ALERT(2)</SCRIPT>'));
        assert.ok(page.textContent.includes('<b>AB12</b>'));
    } finally {
        dom.window.close();
    }
});

test('buildTebligatFilename folds Turkish letters, converts spaces to hyphens, and caps at 60 chars', () => {
    assert.equal(buildTebligatFilename('Ayşe Çağrı', 'Yılmaz Öğüt'), 'Ayse-Cagri-Yilmaz-Ogut-tebligat.pdf');
    assert.equal(buildTebligatFilename('İbrahim Şahin', 'Ünal'), 'Ibrahim-Sahin-Unal-tebligat.pdf');
    assert.equal(buildTebligatFilename('', ''), 'ogrenci-tebligat.pdf');
    const longName = buildTebligatFilename('Abcdefghijklmnopqrstuvwxyz', 'Abcdefghijklmnopqrstuvwxyz1234567890');
    assert.ok(longName.length <= 60);
    assert.ok(longName.endsWith('-tebligat.pdf'));
    assert.equal(longName.includes('--tebligat.pdf'), false);
    assert.equal(formatTebligatDate('2026-03-09'), '09.03.2026');
});

test('openTebligatDialog validates YÖKSİS Başvuru Kayıt No inline, keeps dialog open on invalid input, and restores focus on Escape', () => {
    const dom = new JSDOM('<!doctype html><html><body><button type="button" id="opener">Aç</button></body></html>');
    try {
        const document = dom.window.document;
        const opener = document.getElementById('opener');
        opener.focus();

        const dialog = openTebligatDialog(document, {
            firstName: 'Ayşe',
            lastName: 'Yılmaz',
            passportNumber: 'P123',
            date_of_birth: '2002-04-15'
        }, opener);

        assert.equal(dialog.getAttribute('role'), 'dialog');
        assert.equal(dialog.getAttribute('aria-modal'), 'true');
        assert.equal(document.activeElement, dialog.querySelector('[name="e_ikamet_no"]'));
        assert.equal(dialog.querySelector('[name="birth_date"]').value, '2002-04-15');

        dialog.querySelector('[name="e_ikamet_no"]').value = '2026-11-9988770';
        dialog.querySelector('[name="basvuru_kayit_no"]').value = '2024-05-12';
        dialog.querySelector('[name="migration_go_date"]').value = '2026-11-24';
        dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

        assert.equal(dialog.isConnected, true);
        const alert = dialog.querySelector('[role="alert"]');
        assert.equal(alert.hidden, false);
        assert.match(alert.textContent, /YÖKSİS Başvuru Kayıt No/);

        dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(dialog.isConnected, false);
        assert.equal(document.activeElement, opener);
    } finally {
        dom.window.close();
    }
});

test('online detail renames cover button and shows Tebliğ/Tebligat Yazdır only for sent_to_migration', async (context) => {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    installDocument(context, dom.window.document);
    const document = dom.window.document;
    const root = document.getElementById('staff-applications-manager');
    let currentStatus = 'under_review';
    const api = {
        async queryApplications() {
            return {
                items: [{
                    id: 'app-1', student_number: 'S1', passport_number: 'P1',
                    first_name: 'Ayşe', last_name: 'Yılmaz', application_type: 'initial',
                    status: currentStatus, submitted_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z'
                }],
                pagination: { page: 1, page_size: 25, total_items: 1, total_pages: 1 }
            };
        },
        async readApplicationDetail() {
            return {
                application: {
                    id: 'app-1', student_number: 'S1', passport_number: 'P1',
                    first_name: 'Ayşe', last_name: 'Yılmaz', date_of_birth: '2003-07-11',
                    application_type: 'initial', status: currentStatus, submitted_at: '2026-11-01T10:00:00Z'
                },
                documents: [],
                allowed_status_transitions: []
            };
        }
    };

    initializeStaffApplicationsManager(root, api);
    document.dispatchEvent(new dom.window.CustomEvent('workspace:view-changed', { detail: { viewName: 'applications' } }));
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(root.querySelector('[data-action="download-application-pdf"]')?.textContent, 'Dosya Kapağı Yazdır');
    assert.equal(root.querySelector('[data-action="print-tebligat"]'), null);

    currentStatus = 'sent_to_migration';
    root.querySelector('[data-action="back-to-queue"]').click();
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    const tebligatButton = root.querySelector('[data-action="print-tebligat"]');
    assert.ok(tebligatButton);
    assert.equal(tebligatButton.textContent, 'Tebliğ/Tebligat Yazdır');
});

test('physical detail renames cover button and shows Tebliğ/Tebligat Yazdır only for sent_to_migration', () => {
    const dom = new JSDOM('<main></main>');
    try {
        const root = dom.window.document.querySelector('main');
        const baseIntake = {
            id: 'phys-1',
            first_name: 'Ali',
            last_name: 'Kaya',
            passport_number: 'P555',
            tracking_reference: 'ITU-26-ABCDEFG',
            application_date: '2026-11-20',
            metadata_version: 1
        };

        renderPhysicalIntakes(root, {
            view: 'detail',
            detail: { intake: { ...baseIntake, status: 'under_review' }, files: [], receipts: [], allowed_transitions: [] }
        }, {});
        assert.equal(root.querySelector('button.physical-receipt-download')?.textContent, 'Dosya Kapağı Yazdır');
        assert.equal(root.querySelector('[data-action="print-tebligat"]'), null);

        renderPhysicalIntakes(root, {
            view: 'detail',
            detail: { intake: { ...baseIntake, status: 'sent_to_migration' }, files: [], receipts: [], allowed_transitions: [] }
        }, {});
        const tebligatButton = root.querySelector('[data-action="print-tebligat"]');
        assert.ok(tebligatButton);
        assert.equal(tebligatButton.textContent, 'Tebliğ/Tebligat Yazdır');
        tebligatButton.click();

        const dialog = dom.window.document.querySelector('dialog.tebligat-dialog');
        assert.ok(dialog);
        assert.equal(dialog.querySelector('[name="birth_date"]').value, '');
    } finally {
        dom.window.close();
    }
});

test('toIstanbulIsoDate converts UTC instants to Europe/Istanbul calendar dates and rejects invalid values', () => {
    assert.equal(toIstanbulIsoDate('2026-11-24T21:30:00Z'), '2026-11-25');
    assert.equal(toIstanbulIsoDate('2026-11-24T20:59:59Z'), '2026-11-24');
    assert.equal(toIstanbulIsoDate('2026-11-24 21:30:00'), '2026-11-25');
    assert.equal(toIstanbulIsoDate('2026-11-24'), '2026-11-24');
    assert.equal(toIstanbulIsoDate(new Date('2026-11-24T21:30:00Z')), '2026-11-25');
    for (const invalid of ['', '   ', null, undefined, 'not-a-date', '2026-02-30', '123', 123, new Date('invalid')]) {
        assert.equal(toIstanbulIsoDate(invalid), '');
    }
});

test('openTebligatDialog pre-fills migration_go_date and manages async E-İKAMET auto-fill lifecycle', async () => {
    const dom = new JSDOM('<!doctype html><html><body><button type="button" id="opener">Aç</button></body></html>');
    try {
        const document = dom.window.document;
        const opener = document.getElementById('opener');

        let resolveRead;
        let receivedSignal;
        const dialog = openTebligatDialog(document, {
            firstName: 'Ayşe',
            lastName: 'Yılmaz',
            passportNumber: 'P123',
            birthDate: '2002-04-15',
            migrationGoDate: '2026-11-24T21:30:00Z'
        }, opener, {
            readEIkametNo: (signal) => {
                receivedSignal = signal;
                return new Promise((resolve) => { resolveRead = resolve; });
            }
        });

        const migrationInput = dialog.querySelector('[name="migration_go_date"]');
        const eIkametInput = dialog.querySelector('[name="e_ikamet_no"]');
        const status = dialog.querySelector('.tebligat-eikamet-status');
        const submitButton = dialog.querySelector('[data-action="submit-tebligat"]');
        assert.equal(migrationInput.value, '2026-11-25');
        migrationInput.value = '2026-11-26';
        assert.equal(migrationInput.value, '2026-11-26');
        assert.equal(status.getAttribute('role'), 'status');
        assert.equal(status.getAttribute('aria-live'), 'polite');
        assert.equal(status.textContent, 'Belgeden okunuyor…');
        assert.equal(submitButton.disabled, false);

        resolveRead('2026-51-1211318');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(eIkametInput.value, '2026-51-1211318');
        assert.equal(status.textContent, 'Belgeden okundu. Lütfen kontrol edin.');

        // Never overwrite what staff already typed while reading.
        let resolveOverwriteCheck;
        const dialog2 = openTebligatDialog(document, { migrationGoDate: '2026-11-24T10:00:00Z' }, opener, {
            readEIkametNo: () => new Promise((resolve) => { resolveOverwriteCheck = resolve; })
        });
        const eIkametInput2 = dialog2.querySelector('[name="e_ikamet_no"]');
        eIkametInput2.value = '2026-51-0000001';
        resolveOverwriteCheck('2026-51-1211318');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(eIkametInput2.value, '2026-51-0000001');

        // Null and rejected reads show fallback guidance without blocking the dialog.
        const dialog3 = openTebligatDialog(document, {}, opener, { readEIkametNo: async () => null });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(dialog3.querySelector('.tebligat-eikamet-status').textContent, 'Otomatik okunamadı; numarayı elle yazın.');
        assert.equal(dialog3.querySelector('[name="e_ikamet_no"]').value, '');

        const dialog4 = openTebligatDialog(document, {}, opener, { readEIkametNo: async () => { throw new Error('network'); } });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(dialog4.querySelector('.tebligat-eikamet-status').textContent, 'Otomatik okunamadı; numarayı elle yazın.');

        // Closing the dialog aborts the in-flight read request.
        let abortedSignal;
        const dialog5 = openTebligatDialog(document, {}, opener, {
            readEIkametNo: (signal) => {
                abortedSignal = signal;
                return new Promise(() => {});
            }
        });
        assert.equal(abortedSignal.aborted, false);
        dialog5.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(abortedSignal.aborted, true);
        assert.equal(receivedSignal.aborted, false);
    } finally {
        dom.window.close();
    }
});

test('readRegistrationNumberFromForm downloads only residence_application_form and resolves registration number', async (context) => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    installDocument(context, dom.window.document);
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
    let currentText = 'Kayıt Numarası: 2026-51-1211318';
    dom.window.pdfjsLib = {
        getDocument: () => ({
            promise: Promise.resolve({
                numPages: 1,
                getPage: async () => ({
                    getTextContent: async () => ({ items: [{ str: currentText }] }),
                    getViewport: () => ({ width: 600, height: 800 }),
                    render: () => ({ promise: Promise.resolve() })
                })
            }),
            destroy: async () => {}
        })
    };
    installWindow(context, dom.window);

    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    const downloadedCodes = [];
    const api = {
        async createArchiveManifest() {
            return {
                files: [
                    { code: 'passport', entry_name: 'passport.pdf', media_type: 'application/pdf', byte_size: 4 },
                    { code: 'residence_application_form', entry_name: 'form.pdf', media_type: 'application/pdf', byte_size: pdfBytes.byteLength }
                ]
            };
        },
        async readArchiveFile(_applicationId, file) {
            downloadedCodes.push(file.code);
            return new Response(new Blob([pdfBytes], { type: file.media_type }), { status: 200 });
        }
    };

    const found = await readRegistrationNumberFromForm({ applicationId: 'app-1', api });
    assert.equal(found, '2026-51-1211318');
    assert.deepEqual(downloadedCodes, ['residence_application_form']);

    // Missing form in manifest returns null instead of throwing.
    const missing = await readRegistrationNumberFromForm({
        applicationId: 'app-1',
        api: { createArchiveManifest: async () => ({ files: [{ code: 'passport' }] }), readArchiveFile: api.readArchiveFile }
    });
    assert.equal(missing, null);

    // Byte size mismatch throws.
    await assert.rejects(() => readRegistrationNumberFromForm({
        applicationId: 'app-1',
        api: {
            createArchiveManifest: async () => ({
                files: [{ code: 'residence_application_form', entry_name: 'form.pdf', media_type: 'application/pdf', byte_size: 999 }]
            }),
            readArchiveFile: api.readArchiveFile
        }
    }));

    // Aborted signal throws AbortError.
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        () => readRegistrationNumberFromForm({ applicationId: 'app-1', api, signal: controller.signal }),
        (error) => error?.name === 'AbortError'
    );
});

test('online and physical screens pre-fill migration_go_date from updated_at and wire online auto-fill', async (context) => {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    installDocument(context, dom.window.document);
    const document = dom.window.document;
    const root = document.getElementById('staff-applications-manager');
    let manifestCalled = false;
    const api = {
        async queryApplications() {
            return {
                items: [{
                    id: 'app-1', student_number: 'S1', passport_number: 'P1',
                    first_name: 'Ayşe', last_name: 'Yılmaz', application_type: 'initial',
                    status: 'sent_to_migration', submitted_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-24T21:30:00Z'
                }],
                pagination: { page: 1, page_size: 25, total_items: 1, total_pages: 1 }
            };
        },
        async readApplicationDetail() {
            return {
                application: {
                    id: 'app-1', student_number: 'S1', passport_number: 'P1',
                    first_name: 'Ayşe', last_name: 'Yılmaz', date_of_birth: '2003-07-11',
                    application_type: 'initial', status: 'sent_to_migration',
                    submitted_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-24T21:30:00Z'
                },
                documents: [],
                allowed_status_transitions: []
            };
        },
        async createArchiveManifest() {
            manifestCalled = true;
            return { files: [] };
        },
        async readArchiveFile() {
            throw new Error('should not download when form is absent');
        }
    };

    initializeStaffApplicationsManager(root, api);
    document.dispatchEvent(new dom.window.CustomEvent('workspace:view-changed', { detail: { viewName: 'applications' } }));
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="print-tebligat"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    const onlineDialog = document.querySelector('dialog.tebligat-dialog');
    assert.ok(onlineDialog);
    assert.equal(onlineDialog.querySelector('[name="migration_go_date"]').value, '2026-11-25');
    assert.equal(manifestCalled, true);
    assert.equal(onlineDialog.querySelector('.tebligat-eikamet-status')?.textContent, 'Otomatik okunamadı; numarayı elle yazın.');
    onlineDialog.querySelector('[data-action="cancel-tebligat"]').click();

    const physicalRoot = document.createElement('main');
    document.body.append(physicalRoot);
    renderPhysicalIntakes(physicalRoot, {
        view: 'detail',
        detail: {
            intake: {
                id: 'phys-1', first_name: 'Ali', last_name: 'Kaya', passport_number: 'P555',
                tracking_reference: 'ITU-26-ABCDEFG', application_date: '2026-11-20',
                updated_at: '2026-11-24T21:30:00Z', status: 'sent_to_migration', metadata_version: 1
            },
            files: [], receipts: [], allowed_transitions: []
        }
    }, {});
    physicalRoot.querySelector('[data-action="print-tebligat"]').click();
    const physicalDialog = document.querySelector('dialog.tebligat-dialog');
    assert.ok(physicalDialog);
    assert.equal(physicalDialog.querySelector('[name="migration_go_date"]').value, '2026-11-25');
    assert.equal(physicalDialog.querySelector('.tebligat-eikamet-status'), null);
});

test('TEBLIGAT_PAGE_STYLES enforces the serif font across the page and all descendants', () => {
    assert.match(
        TEBLIGAT_PAGE_STYLES,
        /\.tebligat-page\s*,\s*\.tebligat-page\s*\*\s*\{font-family:'Times New Roman',Times,'Liberation Serif',serif !important\}/u
    );
});
