import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationTracking } from '../src/public/applicationTracking.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import { PHYSICAL_RECEIPT_MESSAGES } from '../src/public/i18n/physical-receipt-messages.js';
import { createPhysicalTrackingPanel } from '../src/public/physical-application-tracking.js';
import {
    extractStatusFromSummaryReply,
    renderStatusSummary
} from '../src/server/domain/chatbotStatusText.js';
import { pickPhysicalMigrationMissingFields } from '../src/server/domain/physical-tracking-policy.js';
import { readPublicMigrationMissingDocuments } from '../src/server/repositories/d1/migrationOfficeStateReader.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { withTestApplicationPrivacyNotice, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATIONS_URL = new URL('../migrations/', import.meta.url);

function createEnvironment({ applyMigration0049 = true } = {}) {
    const database = new TestD1Database();
    if (applyMigration0049) {
        applyAllMigrations(database);
    } else {
        const migrationFiles = readdirSync(MIGRATIONS_URL)
            .filter((file) => file.endsWith('.sql') && !file.startsWith('0049_'))
            .sort();
        for (const migrationFile of migrationFiles) {
            database.exec(readFileSync(new URL(migrationFile, MIGRATIONS_URL), 'utf8'));
        }
    }
    return { database, environment: withTestApplicationPrivacyNotice({ DB: database }) };
}

async function createApplicant(environment, studentNumber) {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
        body: JSON.stringify(withTestApplicationPrivacyNoticeVersion({
            student_number: studentNumber,
            application_type: 'initial',
            email: `${studentNumber}@example.edu`,
            phone: '+905551112233'
        }))
    }), environment, {});
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    const row = environment.DB.prepare(`
        SELECT applications.id, applications.reference_number
        FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE students.student_number = ?
        ORDER BY applications.created_at DESC
        LIMIT 1
    `).bind(studentNumber).first();
    return { cookie, applicationId: row.id, referenceNumber: row.reference_number };
}

async function seedStaffUser(database, staffId = 'staff-secret-99') {
    await database.prepare(`
        INSERT OR IGNORE INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', 'Staff', 'reviewer')
    `).bind(staffId, staffId, staffId).run();
    return staffId;
}

async function seedMigrationOverlay(database, {
    recordKind,
    recordId,
    state = 'missing_documents',
    deadline = '2026-12-05',
    note = 'PRIVATE-EXCEL-NOTE-DO-NOT-EXPOSE',
    applicationNumber = '2026-11-9876543',
    importId = 'import-secret-id-42',
    staffId = 'staff-secret-99'
}) {
    await seedStaffUser(database, staffId);
    await database.prepare(`
        INSERT INTO migration_office_states (
            record_kind, record_id, application_number, state, note, deadline,
            import_id, updated_by_staff_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-11-27T08:00:00.000Z')
        ON CONFLICT(record_kind, record_id) DO UPDATE SET
            application_number = excluded.application_number,
            state = excluded.state,
            note = excluded.note,
            deadline = excluded.deadline,
            import_id = excluded.import_id,
            updated_by_staff_id = excluded.updated_by_staff_id,
            updated_at = excluded.updated_at
    `).bind(recordKind, recordId, applicationNumber, state, note, deadline, importId, staffId).run();
}

async function seedPhysicalRecord(database, {
    id = crypto.randomUUID(),
    trackingReference = 'ITU-26-2345678',
    status = 'sent_to_migration',
    processingClosedAt = null,
    staffId = 'staff-secret-99'
} = {}) {
    await seedStaffUser(database, staffId);
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, tracking_reference, student_number, first_name, last_name, passport_number,
            application_type, application_route, submitted_at, updated_at, created_by_staff_id,
            status, application_date, processing_closed_at
        ) VALUES (?, ?, '26000000999', 'Ada', 'Test', 'P1234567',
            'initial', 'standard', '2026-11-05T10:00:00.000Z', '2026-11-10T10:00:00.000Z', ?,
            ?, '2026-11-05', ?)
    `).bind(id, trackingReference, staffId, status, processingClosedAt).run();
    return { id, trackingReference };
}

function assertNoPrivateOverlayFields(serializedPayload) {
    assert.doesNotMatch(
        serializedPayload,
        /PRIVATE-EXCEL-NOTE|2026-11-9876543|import-secret-id-42|staff-secret-99|updated_by_staff_id|import_id|application_number/i
    );
}

test('reader and public tracking endpoints keep working without error when migration_office_states table does not exist', async () => {
    const { database, environment } = createEnvironment({ applyMigration0049: false });
    const { cookie, applicationId, referenceNumber } = await createApplicant(environment, 'NO-TABLE-1');
    await database.prepare(`UPDATE applications SET status = 'sent_to_migration' WHERE id = ?`).bind(applicationId).run();
    const physical = await seedPhysicalRecord(database, { trackingReference: 'ITU-26-3456789', status: 'sent_to_migration' });

    const directRead = await readPublicMigrationMissingDocuments(database, {
        recordKind: 'online',
        recordId: applicationId,
        status: 'sent_to_migration'
    });
    assert.equal(directRead, null);

    const ownerResponse = await worker.fetch(new Request('https://portal.test/api/public/applications/current/tracking', {
        headers: { Origin: 'https://portal.test', Cookie: cookie }
    }), environment, {});
    assert.equal(ownerResponse.status, 200);
    const ownerPayload = await ownerResponse.json();
    assert.equal(ownerPayload.application.status, 'sent_to_migration');
    assert.equal(ownerPayload.application.migration_missing_documents, undefined);

    const lookupResponse = await worker.fetch(new Request('https://portal.test/api/public/applications/tracking-lookup', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.10' },
        body: JSON.stringify({ reference_number: referenceNumber })
    }), environment, {});
    assert.equal(lookupResponse.status, 200);
    const lookupPayload = await lookupResponse.json();
    assert.equal(lookupPayload.application.status, 'sent_to_migration');
    assert.equal(lookupPayload.application.migration_missing_documents, undefined);

    const physicalResponse = await worker.fetch(new Request('https://portal.test/api/public/physical-intakes/tracking-lookup', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.11' },
        body: JSON.stringify({ tracking_reference: physical.trackingReference })
    }), environment, {});
    assert.equal(physicalResponse.status, 200);
    const physicalPayload = await physicalResponse.json();
    assert.equal(physicalPayload.office_status, 'sent_to_migration');
    assert.equal(physicalPayload.migration_missing_documents, undefined);
});

test('online owner and public tracking expose only flag and ISO deadline for sent_to_migration + missing_documents', async () => {
    const { database, environment } = createEnvironment();
    const { cookie, applicationId, referenceNumber } = await createApplicant(environment, 'ONLINE-MISSING-1');
    await database.prepare(`UPDATE applications SET status = 'sent_to_migration' WHERE id = ?`).bind(applicationId).run();
    await seedMigrationOverlay(database, { recordKind: 'online', recordId: applicationId, state: 'missing_documents', deadline: '2026-12-05' });

    const ownerResponse = await worker.fetch(new Request('https://portal.test/api/public/applications/current/tracking', {
        headers: { Origin: 'https://portal.test', Cookie: cookie }
    }), environment, {});
    assert.equal(ownerResponse.status, 200);
    const ownerText = await ownerResponse.text();
    assertNoPrivateOverlayFields(ownerText);
    const ownerPayload = JSON.parse(ownerText);
    assert.equal(ownerPayload.application.migration_missing_documents, true);
    assert.equal(ownerPayload.application.migration_missing_deadline, '2026-12-05');

    const lookupResponse = await worker.fetch(new Request('https://portal.test/api/public/applications/tracking-lookup', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.12' },
        body: JSON.stringify({ reference_number: referenceNumber })
    }), environment, {});
    assert.equal(lookupResponse.status, 200);
    const lookupText = await lookupResponse.text();
    assertNoPrivateOverlayFields(lookupText);
    const lookupPayload = JSON.parse(lookupText);
    assert.equal(lookupPayload.application.migration_missing_documents, true);
    assert.equal(lookupPayload.application.migration_missing_deadline, '2026-12-05');

    // Without deadline
    await seedMigrationOverlay(database, { recordKind: 'online', recordId: applicationId, state: 'missing_documents', deadline: null });
    const noDeadlineResponse = await worker.fetch(new Request('https://portal.test/api/public/applications/current/tracking', {
        headers: { Origin: 'https://portal.test', Cookie: cookie }
    }), environment, {});
    const noDeadlinePayload = await noDeadlineResponse.json();
    assert.equal(noDeadlinePayload.application.migration_missing_documents, true);
    assert.equal(noDeadlinePayload.application.migration_missing_deadline, undefined);
});

test('online tracking hides stale missing_documents overlay when record is reverted or overlay is approved/reviewing', async () => {
    const { database, environment } = createEnvironment();
    const { cookie, applicationId, referenceNumber } = await createApplicant(environment, 'ONLINE-STALE-1');

    // Reverted record with stale missing_documents overlay
    await database.prepare(`UPDATE applications SET status = 'under_review' WHERE id = ?`).bind(applicationId).run();
    await seedMigrationOverlay(database, { recordKind: 'online', recordId: applicationId, state: 'missing_documents', deadline: '2026-12-05' });

    const revertedOwner = await (await worker.fetch(new Request('https://portal.test/api/public/applications/current/tracking', {
        headers: { Origin: 'https://portal.test', Cookie: cookie }
    }), environment, {})).json();
    assert.equal(revertedOwner.application.migration_missing_documents, undefined);
    assert.equal(revertedOwner.application.migration_missing_deadline, undefined);

    const revertedLookup = await (await worker.fetch(new Request('https://portal.test/api/public/applications/tracking-lookup', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.13' },
        body: JSON.stringify({ reference_number: referenceNumber })
    }), environment, {})).json();
    assert.equal(revertedLookup.application.migration_missing_documents, undefined);

    // Approved overlay
    await database.prepare(`UPDATE applications SET status = 'sent_to_migration' WHERE id = ?`).bind(applicationId).run();
    await seedMigrationOverlay(database, { recordKind: 'online', recordId: applicationId, state: 'approved', deadline: '2026-12-05' });
    const approvedOverlay = await (await worker.fetch(new Request('https://portal.test/api/public/applications/current/tracking', {
        headers: { Origin: 'https://portal.test', Cookie: cookie }
    }), environment, {})).json();
    assert.equal(approvedOverlay.application.migration_missing_documents, undefined);

    // Reviewing overlay
    await seedMigrationOverlay(database, { recordKind: 'online', recordId: applicationId, state: 'reviewing', deadline: null });
    const reviewingOverlay = await (await worker.fetch(new Request('https://portal.test/api/public/applications/current/tracking', {
        headers: { Origin: 'https://portal.test', Cookie: cookie }
    }), environment, {})).json();
    assert.equal(reviewingOverlay.application.migration_missing_documents, undefined);
});

test('physical tracking exposes only flag and ISO deadline for sent_to_migration + missing_documents and hides stale/approved overlays', async () => {
    const { database, environment } = createEnvironment();
    const physical = await seedPhysicalRecord(database, { trackingReference: 'ITU-26-4567892', status: 'sent_to_migration' });
    await seedMigrationOverlay(database, { recordKind: 'physical', recordId: physical.id, state: 'missing_documents', deadline: '2026-12-18' });

    const response = await worker.fetch(new Request('https://portal.test/api/public/physical-intakes/tracking-lookup', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.14' },
        body: JSON.stringify({ tracking_reference: physical.trackingReference })
    }), environment, {});
    assert.equal(response.status, 200);
    const bodyText = await response.text();
    assertNoPrivateOverlayFields(bodyText);
    assert.equal(bodyText.includes(physical.id), false);
    const payload = JSON.parse(bodyText);
    assert.equal(payload.office_status, 'sent_to_migration');
    assert.equal(payload.migration_missing_documents, true);
    assert.equal(payload.migration_missing_deadline, '2026-12-18');

    // Reverted physical record with stale overlay
    await database.prepare(`UPDATE physical_intakes SET status = 'under_review' WHERE id = ?`).bind(physical.id).run();
    const revertedPayload = await (await worker.fetch(new Request('https://portal.test/api/public/physical-intakes/tracking-lookup', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.15' },
        body: JSON.stringify({ tracking_reference: physical.trackingReference })
    }), environment, {})).json();
    assert.equal(revertedPayload.office_status, 'under_review');
    assert.equal(revertedPayload.migration_missing_documents, undefined);

    // Approved overlay on sent_to_migration physical record
    await database.prepare(`UPDATE physical_intakes SET status = 'sent_to_migration' WHERE id = ?`).bind(physical.id).run();
    await seedMigrationOverlay(database, { recordKind: 'physical', recordId: physical.id, state: 'approved', deadline: '2026-12-18' });
    const approvedPayload = await (await worker.fetch(new Request('https://portal.test/api/public/physical-intakes/tracking-lookup', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.16' },
        body: JSON.stringify({ tracking_reference: physical.trackingReference })
    }), environment, {})).json();
    assert.equal(approvedPayload.migration_missing_documents, undefined);

    // Policy unit check
    assert.deepEqual(
        pickPhysicalMigrationMissingFields('closed', { migration_missing_documents: true, migration_missing_deadline: '2026-12-18' }),
        {}
    );
});

test('online and physical UI render missing-documents notice in all 5 locales with and without DD.MM.YYYY deadline', async () => {
    for (const locale of SUPPORTED_LOCALES) {
        const expectedWithDeadline = PUBLIC_MESSAGES[locale].trackingMigrationMissingDocumentsWithDeadline.replace('{deadline}', '05.12.2026');
        const expectedWithoutDeadline = PUBLIC_MESSAGES[locale].trackingMigrationMissingDocuments;
        assert.ok(expectedWithDeadline.includes('05.12.2026'));
        assert.equal(expectedWithoutDeadline.includes('05.12.2026'), false);
        assert.equal(PHYSICAL_RECEIPT_MESSAGES[locale].migrationMissingDocuments, expectedWithoutDeadline);
        assert.equal(
            PHYSICAL_RECEIPT_MESSAGES[locale].migrationMissingDocumentsWithDeadline.replace('{deadline}', '05.12.2026'),
            expectedWithDeadline
        );

        // Online UI with deadline
        const onlineDom = new JSDOM(`<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><body><div id="root"></div></body></html>`);
        const onlineRoot = onlineDom.window.document.querySelector('#root');
        await initializeApplicationTracking(onlineRoot, {
            async accessApplicationWithReference() { return {}; },
            async readCurrentApplicationTracking() {
                return {
                    application: {
                        student_number: '26000000001',
                        reference_number: 'ITU-7K9M-4X2P',
                        status: 'sent_to_migration',
                        application_type: 'initial',
                        migration_missing_documents: true,
                        migration_missing_deadline: '2026-12-05'
                    },
                    documents: []
                };
            }
        });
        onlineRoot.querySelector('input[name="reference_number"]').value = 'ITU-7K9M-4X2P';
        onlineRoot.querySelector('input[name="student_number"]').value = '26000000001';
        onlineRoot.querySelector('.tracking-lookup-form').dispatchEvent(new onlineDom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(onlineRoot.querySelector('.tracking-migration-missing-notice')?.textContent, expectedWithDeadline);
        onlineDom.window.close();

        // Physical UI without deadline
        const physDom = new JSDOM(`<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><body><main></main></body></html>`);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(JSON.stringify({
            found: true,
            tracking_reference: 'ITU-26-2345678',
            office_status: 'sent_to_migration',
            application_date: '2026-11-05',
            updated_at: '2026-11-10T10:00:00.000Z',
            migration_missing_documents: true
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        try {
            const panel = createPhysicalTrackingPanel(physDom.window.document);
            physDom.window.document.querySelector('main').append(panel);
            panel.querySelector('input[name="tracking_reference"]').value = 'ITU-26-2345678';
            panel.querySelector('form').dispatchEvent(new physDom.window.Event('submit', { bubbles: true, cancelable: true }));
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(panel.querySelector('.tracking-migration-missing-notice')?.textContent, expectedWithoutDeadline);
        } finally {
            globalThis.fetch = originalFetch;
            physDom.window.close();
        }
    }

    // Exact Turkish wording check
    assert.equal(
        PUBLIC_MESSAGES.tr.trackingMigrationMissingDocumentsWithDeadline.replace('{deadline}', '05.12.2026'),
        'Göç İdaresi dosyanız için eksik evrak istiyor. Son tarih: 05.12.2026. Lütfen Uluslararası Öğrenci Ofisi ile iletişime geçin.'
    );
    assert.equal(
        PUBLIC_MESSAGES.tr.trackingMigrationMissingDocuments,
        'Göç İdaresi dosyanız için eksik evrak istiyor. Lütfen Uluslararası Öğrenci Ofisi ile iletişime geçin.'
    );

    // Reverted status does not render missing-documents notice in UI
    const revertedDom = new JSDOM('<!doctype html><html lang="tr" dir="ltr"><body><div id="root"></div></body></html>');
    const revertedRoot = revertedDom.window.document.querySelector('#root');
    await initializeApplicationTracking(revertedRoot, {
        async accessApplicationWithReference() { return {}; },
        async readCurrentApplicationTracking() {
            return {
                application: {
                    student_number: '26000000001',
                    reference_number: 'ITU-7K9M-4X2P',
                    status: 'under_review',
                    application_type: 'initial',
                    migration_missing_documents: true,
                    migration_missing_deadline: '2026-12-05'
                },
                documents: []
            };
        }
    });
    revertedRoot.querySelector('input[name="reference_number"]').value = 'ITU-7K9M-4X2P';
    revertedRoot.querySelector('input[name="student_number"]').value = '26000000001';
    revertedRoot.querySelector('.tracking-lookup-form').dispatchEvent(new revertedDom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(revertedRoot.querySelector('.tracking-migration-missing-notice'), null);
    revertedDom.window.close();
});

test('chatbot status summary includes localized missing-documents notice only for sent_to_migration + missing_documents and leaks no private fields', async () => {
    for (const locale of SUPPORTED_LOCALES) {
        const withDeadline = renderStatusSummary({
            found: true,
            application: {
                status: 'sent_to_migration',
                migration_missing_documents: true,
                migration_missing_deadline: '2026-12-05'
            },
            documents: []
        }, locale);
        assert.ok(withDeadline.includes(PUBLIC_MESSAGES[locale].trackingMigrationMissingDocumentsWithDeadline.replace('{deadline}', '05.12.2026')));
        assert.equal(extractStatusFromSummaryReply(withDeadline, locale), 'sent_to_migration');

        const withoutDeadline = renderStatusSummary({
            found: true,
            application: {
                status: 'sent_to_migration',
                migration_missing_documents: true
            },
            documents: []
        }, locale);
        assert.ok(withoutDeadline.includes(PUBLIC_MESSAGES[locale].trackingMigrationMissingDocuments));
        assert.equal(extractStatusFromSummaryReply(withoutDeadline, locale), 'sent_to_migration');

        const reverted = renderStatusSummary({
            found: true,
            application: {
                status: 'under_review',
                migration_missing_documents: true,
                migration_missing_deadline: '2026-12-05'
            },
            documents: []
        }, locale);
        assert.equal(reverted.includes('05.12.2026'), false);
        assert.equal(reverted.includes(PUBLIC_MESSAGES[locale].trackingMigrationMissingDocuments), false);
    }

    // End-to-end POST /api/public/chat status lookup
    const { database, environment } = createEnvironment();
    const { applicationId, referenceNumber } = await createApplicant(environment, 'CHAT-MISSING-1');
    await database.prepare(`UPDATE applications SET status = 'sent_to_migration' WHERE id = ?`).bind(applicationId).run();
    await seedMigrationOverlay(database, { recordKind: 'online', recordId: applicationId, state: 'missing_documents', deadline: '2026-12-05' });

    const chatResponse = await worker.fetch(new Request('https://portal.test/api/public/chat', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20' },
        body: JSON.stringify({
            language: 'tr',
            messages: [{ role: 'user', content: `${referenceNumber} durumu nedir?` }]
        })
    }), environment, {});
    assert.equal(chatResponse.status, 200);
    const chatText = await chatResponse.text();
    assertNoPrivateOverlayFields(chatText);
    const chatPayload = JSON.parse(chatText);
    assert.ok(chatPayload.reply.includes('Göç İdaresi dosyanız için eksik evrak istiyor. Son tarih: 05.12.2026. Lütfen Uluslararası Öğrenci Ofisi ile iletişime geçin.'));
});
