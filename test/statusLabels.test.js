import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import { PHYSICAL_RECEIPT_MESSAGES } from '../src/public/i18n/physical-receipt-messages.js';
import { APPLICATION_STATUS_LABELS, renderStatusSummary } from '../src/server/domain/chatbotStatusText.js';
import { PHYSICAL_STATUS_LABELS } from '../src/config/physical-statuses.js';
import { buildApplicationDocumentSections } from '../src/shared/applicationDocumentPdf.js';

const EXPECTED_PUBLIC = Object.freeze({
    tr: {
        sent_to_migration: 'Göç İdaresi dosyanızı inceliyor',
        migration_approved: 'Göç İdaresi tarafından onaylandı'
    },
    en: {
        sent_to_migration: 'The Migration Authority is reviewing your file',
        migration_approved: 'Approved by Migration Authority'
    },
    ru: {
        sent_to_migration: 'Миграционное управление рассматривает ваше дело',
        migration_approved: 'Одобрено Миграционным управлением'
    },
    tk: {
        sent_to_migration: 'Migrasiýa edarasy faýlyňyzy gözden geçirýär',
        migration_approved: 'Migrasiýa edarasy tarapyndan tassyklandy'
    },
    ar: {
        sent_to_migration: 'تقوم إدارة الهجرة بمراجعة ملفك',
        migration_approved: 'تمت الموافقة من قِبل إدارة الهجرة'
    }
});

const EXPECTED_PHYSICAL_RECEIPT = Object.freeze({
    tr: {
        sent_to_migration: 'Göç İdaresi dosyanızı inceliyor.',
        migration_approved: 'Göç İdaresi tarafından onaylandı.'
    },
    en: {
        sent_to_migration: 'The Migration Authority is reviewing your file.',
        migration_approved: 'Approved by the Migration Authority.'
    },
    ru: {
        sent_to_migration: 'Миграционное управление рассматривает ваше дело.',
        migration_approved: 'Одобрено миграционной службой.'
    },
    tk: {
        sent_to_migration: 'Migrasiýa gullugy faýlyňyzy barlaýar.',
        migration_approved: 'Migrasiýa gullugy tarapyndan tassyklandy.'
    },
    ar: {
        sent_to_migration: 'تقوم إدارة الهجرة بمراجعة ملفك.',
        migration_approved: 'تمت الموافقة من قِبل إدارة الهجرة.'
    }
});

test('public messages and chatbot status labels expose clear migration status wording in all five languages', () => {
    for (const locale of SUPPORTED_LOCALES) {
        assert.equal(PUBLIC_MESSAGES[locale].applicationStatus_sent_to_migration, EXPECTED_PUBLIC[locale].sent_to_migration);
        assert.equal(PUBLIC_MESSAGES[locale].applicationStatus_migration_approved, EXPECTED_PUBLIC[locale].migration_approved);
        assert.equal(APPLICATION_STATUS_LABELS[locale].sent_to_migration, EXPECTED_PUBLIC[locale].sent_to_migration);
        assert.equal(APPLICATION_STATUS_LABELS[locale].migration_approved, EXPECTED_PUBLIC[locale].migration_approved);
        assert.equal(PHYSICAL_RECEIPT_MESSAGES[locale].sent_to_migration, EXPECTED_PHYSICAL_RECEIPT[locale].sent_to_migration);
        assert.equal(PHYSICAL_RECEIPT_MESSAGES[locale].migration_approved, EXPECTED_PHYSICAL_RECEIPT[locale].migration_approved);

        const summary = renderStatusSummary({
            found: true,
            application: { status: 'sent_to_migration' },
            documents: []
        }, locale);
        assert.ok(summary.includes(EXPECTED_PUBLIC[locale].sent_to_migration));
    }
});

test('staff physical status labels and PDF status labels use the updated Turkish migration wording', () => {
    assert.equal(PHYSICAL_STATUS_LABELS.sent_to_migration, 'Göç İdaresi inceliyor');
    assert.equal(PHYSICAL_STATUS_LABELS.migration_approved, 'Göç İdaresi tarafından onaylandı');

    const sectionsSent = buildApplicationDocumentSections({ reference_number: 'ITU-1111-2222', status: 'sent_to_migration' });
    const fieldsSent = sectionsSent.flatMap((section) => section.fields);
    assert.ok(fieldsSent.some((field) => field.label === 'Başvuru Durumu' && field.value === 'Göç İdaresi inceliyor'));

    const sectionsApproved = buildApplicationDocumentSections({ reference_number: 'ITU-1111-2222', status: 'migration_approved' });
    const fieldsApproved = sectionsApproved.flatMap((section) => section.fields);
    assert.ok(fieldsApproved.some((field) => field.label === 'Başvuru Durumu' && field.value === 'Göç İdaresi tarafından onaylandı'));
});

test('staff ratings panel renders updated migration status labels', async () => {
    const { initializeStaffApplicationRatings } = await import('../src/staff/application-ratings.js');
    const dom = new JSDOM(`
        <details open>
            <span data-ratings-count></span>
            <span data-ratings-status></span>
            <button data-ratings-refresh type="button"></button>
            <div data-ratings-list></div>
        </details>
    `);
    const root = dom.window.document.querySelector('details');
    initializeStaffApplicationRatings(root, {
        async readRatings() {
            return {
                summary: { count: 2, average: 5 },
                items: [
                    { rating: 5, status: 'sent_to_migration', updated_at: '2026-11-27T08:00:00.000Z' },
                    { rating: 5, status: 'migration_approved', updated_at: '2026-11-27T08:00:00.000Z' }
                ]
            };
        }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(root.textContent, /Göç İdaresi inceliyor/);
    assert.match(root.textContent, /Göç İdaresi tarafından onaylandı/);
    dom.window.close();
});
