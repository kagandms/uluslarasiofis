// Runs exclusively against an in-memory SQLite D1 adapter; no remote bindings.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { TestD1Database } from '../../../test/helpers/d1-test-binding.js';
import { applyAllMigrations } from '../../../test/helpers/apply-migrations.js';
import worker from '../../../src/server/worker.js';
import { listDocumentPolicies } from '../../../src/server/domain/documentPolicy.js';
import { evaluateApplicationTransition } from '../../../src/server/domain/applicationStateMachine.js';
import { readSubmissionReadiness } from '../../../src/server/services/submissionReadiness.js';
import { createD1Repositories } from '../../../src/server/repositories/d1/index.js';
import { CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../../../src/config/constants.js';
import { calculateUnder18 } from '../../../src/shared/age.js';

const database = new TestD1Database();
applyAllMigrations(database);
const environment = { DB: database };
const evidence = { recorded_on: '2026-10-23', scope: 'in-memory only', checks: {} };

function buildRequest(path, { body, cookie } = {}) {
    return new Request(`https://portal.test${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
}

const created = await worker.fetch(buildRequest('/api/public/applications', { body: {
    student_number: 'AUDIT-SYNTHETIC-1', application_type: 'initial', email: 'audit@example.edu', phone: '+905551112233'
} }), environment, {});
assert.equal(created.status, 201);
const credentials = await created.json();
const cookie = created.headers.get('set-cookie').split(';')[0];
const applicationId = database.prepare('SELECT id FROM applications').first().id;

database.exec(`UPDATE applications SET first_name='Synthetic', last_name='Audit', passport_number='SYNTHETIC',
    nationality='Test', date_of_birth='2000-01-01', is_under_18=0, accommodation_type='rental_contract',
    address_evidence_type='rental_contract', insurance_basis='gss_pending', fingerprint_status='registered',
    fingerprint_code='SYNTHETIC', declaration_version='student-information-accuracy-v1',
    declaration_accepted_at='2026-10-23T08:00:00.000Z'`);
database.prepare(`INSERT INTO audit_events (id,event_type,actor_type,application_id,request_id,safe_metadata_json)
    VALUES ('audit-contact','application.contact_responsibility_accepted','student',?,'audit',?)`)
    .bind(applicationId, JSON.stringify({ version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION })).run();

function seedDocument(policy) {
    const requirement = database.prepare("SELECT id FROM document_requirements WHERE code=? AND application_type='initial'").bind(policy.code).first();
    const recordId = `record-${policy.code}`;
    const revisionId = `revision-${policy.code}`;
    const fileId = `file-${policy.code}`;
    database.prepare("INSERT INTO document_records (id,application_id,requirement_id,application_type) VALUES (?,?,?,'initial')")
        .bind(recordId, applicationId, requirement.id).run();
    database.prepare("INSERT INTO document_revisions (id,document_record_id,revision_number,status,is_current,submitted_by_type) VALUES (?,?,1,'submitted',1,'student')")
        .bind(revisionId, recordId).run();
    database.prepare(`INSERT INTO document_revision_files (id,revision_id,page_order,storage_key,original_filename,media_type,byte_size,upload_status,scan_status)
        VALUES (?,?,0,?,'synthetic.pdf','application/pdf',10,'finalized','clean')`).bind(fileId, revisionId, `synthetic/${policy.code}`).run();
    database.prepare("INSERT INTO upload_intents (id,revision_file_id,idempotency_key,expires_at,status) VALUES (?,?,?,'2099-01-01T00:00:00.000Z','completed')")
        .bind(`intent-${policy.code}`, fileId, `key-${policy.code}`).run();
}

const repositories = createD1Repositories(database);
const application = await repositories.applications.findById(applicationId);
listDocumentPolicies('initial', false, application).filter(policy => policy.required).forEach(seedDocument);
const readiness = await readSubmissionReadiness(applicationId, environment, 'student-information-accuracy-v1');
assert.equal(readiness.status, 'ready');
evidence.checks.gss_future_promise = { result: readiness.status, eligibility_dates_stored: false, note: 'No active insurance or GSS application evidence was seeded.' };

const originalBatch = database.batch.bind(database);
let raceInjected = false;
database.batch = async (statements) => {
    if (!raceInjected && statements.some(statement => statement.sql.includes("SET status = 'submitted'"))) {
        raceInjected = true;
        database.prepare("UPDATE applications SET accommodation_type='hotel', address_evidence_type=NULL, lock_version=lock_version+1 WHERE id=?")
            .bind(applicationId).run();
    }
    return originalBatch(statements);
};
const submitted = await worker.fetch(buildRequest('/api/public/applications/current/submit', { body: {}, cookie }), environment, {});
assert.equal(submitted.status, 200);
const afterRace = await readSubmissionReadiness(applicationId, environment, 'student-information-accuracy-v1');
assert.ok(afterRace.missing_documents.includes('address_hotel'));
evidence.checks.submit_race = { injected_between_readiness_and_write: raceInjected, http_status: submitted.status,
    persisted_status: (await submitted.json()).application.status, missing_documents: afterRace.missing_documents };
database.batch = originalBatch;
database.prepare("UPDATE applications SET accommodation_type='rental_contract', address_evidence_type='rental_contract', status='resubmission_required' WHERE id=?").bind(applicationId).run();
database.prepare("INSERT INTO application_notes (id,application_id,document_record_id,author_type,visibility,body) VALUES ('audit-note',?,'record-passport','system','student',?)")
    .bind(applicationId, 'SYNTHETIC PRIVATE OFFICE MESSAGE').run();
const lookup = await worker.fetch(buildRequest('/api/public/applications/tracking-lookup', { body: { student_number: 'AUDIT-SYNTHETIC-1' } }), environment, {});
const publicPayload = await lookup.json();
assert.equal(publicPayload.documents.find(document => document.code === 'passport').student_message, 'SYNTHETIC PRIVATE OFFICE MESSAGE');
evidence.checks.unauthenticated_note = { http_status: lookup.status, cookie_supplied: false,
    student_message_exposed: true, document_codes_exposed: publicPayload.documents.map(document => document.code) };

database.prepare("UPDATE applications SET status='migration_approved' WHERE id=?").bind(applicationId).run();
const version = (await repositories.applications.findById(applicationId)).updated_at;
assert.equal(await repositories.applicationReviews.transitionApplicationStatus({ applicationId, currentStatus: 'migration_approved',
    expectedUpdatedAt: version, targetStatus: 'completed', staffId: null, now: new Date().toISOString(), requestId: 'audit', auditId: 'audit-complete' }), true);
const ownerTracking = await worker.fetch(buildRequest('/api/public/applications/current/tracking', { cookie }), environment, {});
const access = await worker.fetch(buildRequest('/api/public/applications/access', { body: {
    reference_number: credentials.reference_number, student_number: 'AUDIT-SYNTHETIC-1'
} }), environment, {});
assert.equal(ownerTracking.status, 401);
assert.equal(access.status, 401);
evidence.checks.completed_owner_access = { existing_session_http_status: ownerTracking.status, valid_credentials_http_status: access.status };

evidence.checks.rejection = Object.fromEntries(['submitted','under_review','approved_for_processing','sent_to_migration','migration_approved']
    .map(status => [status, evaluateApplicationTransition(status, 'rejected', { allRequiredDocumentsApproved: true })]));
assert.ok(Object.values(evidence.checks.rejection).every(result => !result.allowed));
const transfer = await worker.fetch(buildRequest('/api/public/applications', { body: {
    student_number: 'AUDIT-TRANSFER', application_type: 'transfer', email: 'audit@example.edu', phone: '+905551112233'
} }), environment, {});
assert.equal(transfer.status, 400);
evidence.checks.transfer = { http_status: transfer.status, code: (await transfer.json()).error.code };

let combinations = 0;
for (const applicationType of ['initial','renewal']) for (const accommodation of ['rental_contract','own_home','dormitory','hotel','undertaking']) {
    for (const isUnder18 of [false,true]) for (const insurance of ['system_verified','bilateral_agreement','gss_pending']) {
        for (const married of ['yes','no']) for (const entry of ['student_visa','other']) {
            for (const family of ['both_parents','divorced','deceased','single_parent','absent']) for (const parentsIdentified of ['yes','no']) {
                const context = { accommodation_type: accommodation, insurance_basis: insurance, host_is_married: married,
                    minor_entry_type: entry, minor_family_status: family, minor_parents_identified: parentsIdentified };
                const codes = listDocumentPolicies(applicationType,isUnder18,context).filter(policy=>policy.required).map(policy=>policy.code);
                assert.equal(codes.includes('host_spouse_undertaking'), accommodation==='undertaking' && married==='yes');
                assert.equal(codes.includes('health_insurance'), insurance==='bilateral_agreement');
                assert.equal(codes.includes('uets'), applicationType==='renewal' && !isUnder18);
                assert.equal(codes.includes('minor_consent'), isUnder18 && entry!=='student_visa');
                assert.equal(codes.includes('home_utility_bill'), applicationType==='renewal');
                combinations++;
            }
        }
    }
}
evidence.checks.policy_combinations = { evaluated: combinations, note: 'Includes irrelevant-answer combinations; policy invariants, not legal approval or browser UAT.' };
evidence.checks.age_reference_date = { date_of_birth:'2008-10-20', e_ikamet_date:'2026-10-19', portal_date:'2026-10-23',
    under18_at_e_ikamet:calculateUnder18('2008-10-20','2026-10-19'), under18_at_portal:calculateUnder18('2008-10-20','2026-10-23') };
await writeFile(new URL('./evidence.json', import.meta.url), `${JSON.stringify(evidence,null,2)}\n`);
process.stdout.write(`${JSON.stringify(evidence,null,2)}\n`);
