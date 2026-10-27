import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { buildApplicationDocumentSections, createApplicationDocumentPages } from '../src/shared/applicationDocumentPdf.js';

test('application document sections include online application identity and answered fields without internal session data', () => {
    const sections = buildApplicationDocumentSections({
        reference_number: 'ITU-7K9M-4X2P',
        id: 'internal-application-id',
        student_number: 'STU-1',
        first_name: 'Leyli',
        last_name: 'Dovladova',
        student_email: 'student@example.edu',
        student_phone: '+905550000000',
        passport_number: 'A1905164',
        nationality: 'Türkmenistan',
        date_of_birth: '2004-05-09',
        application_type: 'renewal',
        status: 'submitted',
        submitted_at: '2026-10-23T10:00:00.000Z',
        contact_acknowledgement: { accepted_current: true, accepted_at: '2026-10-22T10:00:00.000Z' },
        declaration: { accepted_at: '2026-10-23T10:00:00.000Z' },
        access_credentials: { reference_number: 'secret' },
        owner_session_id: 'secret-session'
    });

    const fields = sections.flatMap(section => section.fields);
    assert.ok(sections.length > 0);
    assert.ok(fields.some(field => field.label === 'Başvuru Referansı' && field.value === 'ITU-7K9M-4X2P'));
    assert.ok(fields.some(field => field.label === 'Pasaport No' && field.value === 'A1905164'));
    assert.ok(fields.some(field => field.label === 'Başvuru Durumu' && field.value === 'Gönderildi'));
    assert.ok(fields.some(field => field.label === 'E-posta' && field.value === 'student@example.edu'));
    assert.ok(fields.some(field => field.label === 'İletişim teyidi' && field.value === 'Evet'));
    assert.ok(fields.every(field => !/internal|session|secret/iu.test(`${field.label} ${field.value}`)));
});

test('application PDF pages render student content as text and keep internal fields out of the document', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const pages = createApplicationDocumentPages(dom.window.document, {
        reference_number: 'ITU-7K9M-4X2P', student_number: 'STU-1', first_name: '<script>alert(1)</script>'
    });
    assert.match(pages[0].querySelector('dd').textContent, /ITU-7K9M-4X2P/u);
    assert.ok(pages.some(page => page.textContent.includes('<script>alert(1)</script>')));
    assert.ok(pages.every(page => page.querySelector('script') === null));
    dom.window.close();
});

test('application document builder preserves applicant text as data and omits empty values', () => {
    const sections = buildApplicationDocumentSections({
        reference_number: 'ITU-7K9M-4X2P',
        first_name: '<img src=x onerror=alert(1)>',
        last_name: '',
        student_number: 'STU-1'
    });
    const fields = sections.flatMap(section => section.fields);
    assert.ok(fields.some(field => field.value === '<img src=x onerror=alert(1)>'));
    assert.ok(fields.every(field => field.value !== ''));
});
