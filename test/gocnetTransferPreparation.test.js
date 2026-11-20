import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readApplicationDocumentFiles } from '../src/staff/application-document-files.js';
import { describeGocnetPreparationError, normalizeGocnetPhone, normalizeTurkishMobilePhone, resolveRegistrationNumber, resolveTurkishMobilePhone } from '../src/staff/gocnet-transfer.js';

function createApi({ documents = [], files = [] } = {}) {
    return {
        async readApplicationDetail() {
            return { application: { id: 'app-1', status: 'submitted', submitted_at: '2026-11-05' }, documents };
        },
        async createArchiveManifest() { return { files }; },
        async readArchiveFile(_applicationId, file) {
            const bytes = new Uint8Array(file.byte_size);
            return { ok: true, body: {}, async blob() { return new Blob([bytes], { type: file.media_type }); } };
        }
    };
}

test('reads the manifest-pinned current documents in order and rejects a missing required document', async () => {
    const files = [
        { code: 'residence_application_form', expected_revision_number: 2, object_identity: 'a'.repeat(64), media_type: 'application/pdf', byte_size: 5, entry_name: '01-form.pdf' },
        { code: 'passport', expected_revision_number: 1, object_identity: 'b'.repeat(64), media_type: 'image/jpeg', byte_size: 5, entry_name: '02-passport.jpg' }
    ];
    const docs = files.map((file) => ({ code: file.code, required: true, revision_number: file.expected_revision_number, scan_status: 'clean', access_available: true }));
    const result = await readApplicationDocumentFiles({ applicationId: 'app-1', api: createApi({ documents: docs, files }) });
    assert.deepEqual(result.files.map((file) => file.name), ['01-form.pdf', '02-passport.jpg']);
    assert.equal(result.files[0].size, 5);

    await assert.rejects(
        readApplicationDocumentFiles({ applicationId: 'app-1', api: createApi({ documents: docs, files: files.slice(1) }) }),
        /zorunlu belge/i
    );
});

test('requires one labeled registration candidate unless a staff correction is supplied', () => {
    assert.equal(resolveRegistrationNumber(['2026-04-0644400']), '2026-04-0644400');
    assert.equal(resolveRegistrationNumber(['2026-04-0644400', '2026-04-0644401']), null);
    assert.equal(resolveRegistrationNumber(['2026-04-0644400', '2026-04-0644401'], '2026-04-0000001'), '2026-04-0000001');
    assert.equal(resolveRegistrationNumber(['2026-04-0644400', '2026-04-0644401'], '2027-04-0000001'), null);
    assert.equal(resolveRegistrationNumber(['2026-04-0644400'], '2026/04/0000001'), null);
});

test('accepts valid Turkish mobile input and returns the ten-digit national number', () => {
    assert.equal(normalizeTurkishMobilePhone('+90 532 123 45 67'), '5321234567');
    assert.equal(normalizeTurkishMobilePhone('0532 123 45 67'), '5321234567');
    assert.equal(normalizeTurkishMobilePhone('5321234567'), '5321234567');
    assert.equal(normalizeTurkishMobilePhone('+7 912 345 67 89'), null);
    assert.equal(normalizeTurkishMobilePhone('2121234567'), null);
});

test('normalizes Turkish mobile and valid international phones to 7..10 digits for GöçNet', () => {
    assert.equal(normalizeGocnetPhone('+90 500 000 00 01'), '5000000001');
    assert.equal(normalizeGocnetPhone('0500 000 00 01'), '5000000001');
    assert.equal(normalizeGocnetPhone('5000000001'), '5000000001');
    assert.equal(normalizeGocnetPhone('+7 701 000 00 01'), '7010000001');
    assert.equal(normalizeGocnetPhone('8 (701) 000-00-01'), '7010000001');
    assert.equal(normalizeGocnetPhone('87000000000'), '7000000000');
    assert.equal(normalizeGocnetPhone('007 700 000 00 00'), '7000000000');
    assert.equal(normalizeGocnetPhone('7000000000'), '7000000000');
    assert.equal(normalizeGocnetPhone('7000001'), '7000001');
    assert.equal(normalizeGocnetPhone('123'), null);
    assert.equal(normalizeGocnetPhone('700000'), null);
    assert.equal(normalizeGocnetPhone('00123456'), null);
    assert.equal(normalizeGocnetPhone(''), null);
    assert.equal(normalizeGocnetPhone('   '), null);
    assert.equal(normalizeGocnetPhone('letters-only'), null);
    assert.equal(normalizeGocnetPhone('0000000000'), null);
    assert.equal(normalizeGocnetPhone('7777777777'), null);
    assert.equal(normalizeGocnetPhone(null), null);
});

test('resolves foreign application numbers and uses a valid per-attempt correction when invalid', () => {
    assert.equal(resolveTurkishMobilePhone('+7 701 000 00 01', ''), '7010000001');
    assert.equal(resolveTurkishMobilePhone('123', '+90 500 000 00 01'), '5000000001');
    assert.equal(resolveTurkishMobilePhone('123', '+7 700 000 00 01'), '7000000001');
    assert.equal(resolveTurkishMobilePhone('123', '456'), null);
    assert.equal(resolveTurkishMobilePhone('+90 555 111 22 33', ''), '5551112233');
});

test('rejects documents with blocked scans and files whose downloaded size differs from the manifest', async () => {
    const file = { code: 'passport', expected_revision_number: 1, object_identity: 'a'.repeat(64),
        media_type: 'application/pdf', byte_size: 5, entry_name: '01-passport.pdf' };
    await assert.rejects(readApplicationDocumentFiles({
        applicationId: 'app-1', api: createApi({ documents: [{ code: 'passport', revision_number: 1, scan_status: 'pending' }], files: [file] })
    }), /güvenlik taramasından geçmedi/i);

    const api = createApi({ files: [file] });
    api.readArchiveFile = async () => ({ ok: true, body: {}, async blob() { return new Blob([new Uint8Array(4)]); } });
    await assert.rejects(readApplicationDocumentFiles({ applicationId: 'app-1', api }), /boyutu doğrulanamadı/i);
});

test('auto-picks the registration number only when the barcode caption confirms exactly one candidate', () => {
    const text = 'GCGM03-92026331015530\nİKAMET İZNİ ÖĞRENCİ KAYIT FORMU';
    assert.equal(resolveRegistrationNumber(['2026-33-1015530', '2026-10-12313909'], '', text), '2026-33-1015530');
    assert.equal(resolveRegistrationNumber(['2026-10-12313909', '2026-33-1015530'], '', text), '2026-33-1015530');
    assert.equal(resolveRegistrationNumber(['2026-33-1015530', '2026-10-12313909'], '', ''), '2026-33-1015530');
    assert.equal(resolveRegistrationNumber(['2026-33-1015530', '2026-34-1015531'], '', ''), null);
    assert.equal(resolveRegistrationNumber(['2026-04-0644400', '2026-04-0644401'], '', text), null);
    assert.equal(resolveRegistrationNumber(['2026-33-1015530', '2026-10-12313909'], '', 'GCGM03-92026331015530 GCGM03-92026101231390'), '2026-33-1015530');
});

test('drops candidates that are not 2026-XX-XXXXXXX so look-alike dates never need a choice', () => {
    assert.equal(resolveRegistrationNumber(['2026-33-1015530', '2026-10-12313909']), '2026-33-1015530');
    assert.equal(resolveRegistrationNumber(['2026-10-12313909']), null);
    assert.equal(resolveRegistrationNumber(['2025-33-1015530']), null);
    assert.equal(resolveRegistrationNumber(['2026-33-101553']), null);
});

test('shows our own preparation error text but keeps API and abort failures generic', () => {
    const generic = 'GöçNet ön kontrolü yapılamadı. Belgeleri ve eklentiyi kontrol edip yeniden deneyin.';
    assert.equal(describeGocnetPreparationError(new Error('Zorunlu belge “photographs” güncel ve güvenli değil.')),
        'GöçNet ön kontrolü yapılamadı: Zorunlu belge “photographs” güncel ve güvenli değil.');
    assert.equal(describeGocnetPreparationError(Object.assign(new Error('Staff request failed.'), { status: 0 })), generic);
    assert.equal(describeGocnetPreparationError(new DOMException('Canceled', 'AbortError')), generic);
    assert.equal(describeGocnetPreparationError(new Error('x'.repeat(300))), generic);
    assert.equal(describeGocnetPreparationError('boom'), generic);
});
