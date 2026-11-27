import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

test('staff scanner panel exposes backlog, stale host and controlled failed-job retry', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    const pollDelays = [];
    document.defaultView.setTimeout = (_callback, delay) => { pollDelays.push(delay); return pollDelays.length; };
    const retries = [];
    const api = {
        readStatus: async () => ({ jobs: [{ status: 'queued', count: 3 }, { status: 'leased', count: 1 }],
            runners: [{ runner_id: 'mac', health: 'ready', seen_at: '2026-01-01T00:00:00.000Z', signature_updated_at: '2026-01-01T00:00:00.000Z' }],
            last_successful_scan: null, failed_jobs: [{ id: 'job-id', result_code: 'scan_timeout', attempts: 3 }] }),
        retry: async (jobId) => { retries.push(jobId); }
    };
    module.initializeScannerManager(root, api);

    root.querySelector('[data-action="refresh-scanner"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /4/);
    assert.match(root.textContent, /Kuyrukta veya işlemde: 4/);
    assert.match(root.textContent, /Doğrulanamayan dosya: 1/);
    assert.match(root.textContent, /çevrimdışı|bayat/);
    assert.equal(pollDelays.at(-1), 60_000);
    const retry = root.querySelector('[data-action="retry-scan"]');
    retry.click();
    assert.equal(retry.disabled, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(retries, ['job-id']);
    document.defaultView.close();
});

test('staff scanner panel does not offer replay for deterministic unsupported content', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    const pollDelays = [];
    document.defaultView.setTimeout = (_callback, delay) => { pollDelays.push(delay); return pollDelays.length; };
    const retries = [];
    const api = {
        readStatus: async () => ({ jobs: [], runners: [], last_successful_scan: null,
            failed_jobs: [{ id: 'job-unsupported', result_code: 'unsupported_content', attempts: 1 }] }),
        retry: async (jobId) => { retries.push(jobId); }
    };
    module.initializeScannerManager(root, api);

    root.querySelector('[data-action="refresh-scanner"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /replacement akışından yüklemeli/i);
    assert.match(root.textContent, /Kuyrukta veya işlemde: 0\. Doğrulanamayan dosya: 1/);
    assert.equal(pollDelays.at(-1), 300_000);
    assert.equal(root.querySelector('[data-action="retry-scan"]'), null);
    assert.deepEqual(retries, []);
    document.defaultView.close();
});

test('staff scanner panel reports the full failed count, not the listed sample', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    document.defaultView.setTimeout = () => 0;
    const api = {
        readStatus: async () => ({ jobs: [{ status: 'failed', count: 66 }], runners: [], last_successful_scan: null,
            failed_jobs: [{ id: 'job-unsupported', result_code: 'unsupported_content', attempts: 1 }] }),
        retry: async () => {}
    };
    module.initializeScannerManager(root, api);

    root.querySelector('[data-action="refresh-scanner"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.querySelector('.staff-scanner-badge').textContent, /66 Doğrulanamayan Dosya/);
    assert.match(root.textContent, /Doğrulanamayan dosya: 66/);
    assert.match(root.textContent, /ilk 1 kayıt gösteriliyor/);
    document.defaultView.close();
});

test('staff scanner panel treats 48-hour-old signatures as active within 72-hour window', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    document.defaultView.setTimeout = () => 0;
    const nowMs = Date.now();
    const api = {
        readStatus: async () => ({
            jobs: [],
            runners: [{
                runner_id: 'mac',
                health: 'ready',
                seen_at: new Date(nowMs).toISOString(),
                signature_updated_at: new Date(nowMs - 48 * 3_600_000).toISOString()
            }],
            last_successful_scan: null,
            failed_jobs: []
        }),
        retry: async () => {}
    };
    module.initializeScannerManager(root, api);

    root.querySelector('[data-action="refresh-scanner"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.doesNotMatch(root.textContent, /çevrimdışı|bayat/i);
    assert.match(root.querySelector('.staff-scanner-badge').textContent, /Tarama Servisi Aktif/);
    document.defaultView.close();
});

test('staff scanner panel marks 4-day-old signatures as stale', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    document.defaultView.setTimeout = () => 0;
    const nowMs = Date.now();
    const api = {
        readStatus: async () => ({
            jobs: [],
            runners: [{
                runner_id: 'mac',
                health: 'ready',
                seen_at: new Date(nowMs).toISOString(),
                signature_updated_at: new Date(nowMs - 4 * 86_400_000).toISOString()
            }],
            last_successful_scan: null,
            failed_jobs: []
        }),
        retry: async () => {}
    };
    module.initializeScannerManager(root, api);

    root.querySelector('[data-action="refresh-scanner"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /çevrimdışı|bayat/);
    document.defaultView.close();
});

test('staff scanner panel supports opening application, resubmission on submitted with second-call retry, and blocks sent_to_migration', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    document.defaultView.setTimeout = () => 0;

    const openedApplications = [];
    document.addEventListener('staff-scanner:open-application', (event) => {
        openedApplications.push(event.detail.applicationId);
    });

    const transitions = [];
    const resubmissions = [];
    let failResubmissionOnce = true;

    const api = {
        readStatus: async () => ({
            jobs: [],
            runners: [],
            last_successful_scan: null,
            actionable_failed_total: 51,
            failed_jobs: [
                {
                    id: 'job-submitted-unsafe',
                    result_code: 'malware',
                    scan_status: 'unsafe',
                    attempts: 1,
                    application_id: 'app-sub',
                    student_number: 'STU-100',
                    first_name: 'Ali',
                    last_name: 'Veli',
                    document_code: 'passport',
                    revision_number: 1,
                    application_status: 'submitted',
                    application_updated_at: '2026-11-27T08:00:00.000Z',
                    can_request_resubmission: true
                },
                {
                    id: 'job-migration-failed',
                    result_code: 'scan_timeout',
                    scan_status: 'failed',
                    attempts: 3,
                    application_id: 'app-mig',
                    student_number: 'STU-200',
                    first_name: 'Ayşe',
                    last_name: 'Yılmaz',
                    document_code: 'visa',
                    revision_number: 2,
                    application_status: 'sent_to_migration',
                    application_updated_at: '2026-11-27T08:00:00.000Z',
                    can_request_resubmission: false
                }
            ]
        }),
        retry: async () => {},
        transitionApplication: async (appId, targetStatus, updatedAt) => {
            transitions.push({ appId, targetStatus, updatedAt });
            return { application_status: targetStatus, updated_at: '2026-11-27T08:01:00.000Z' };
        },
        requestResubmission: async (appId, code, rev, reason) => {
            resubmissions.push({ appId, code, rev, reason });
            if (failResubmissionOnce) {
                failResubmissionOnce = false;
                throw new Error('İstek geçici olarak başarısız.');
            }
            return { ok: true };
        }
    };

    module.initializeScannerManager(root, api);
    await new Promise((resolve) => setImmediate(resolve));

    const items = root.querySelectorAll('.staff-scanner-failure-item');
    assert.equal(items.length, 2);
    assert.match(root.textContent, /Doğrulanamayan dosya: 51 \(ilk 2 kayıt gösteriliyor\)/);

    // First item (submitted + unsafe): has open-application, "İncelemeye al ve tekrar iste", NO retry-scan
    const firstItem = items[0];
    assert.match(firstItem.textContent, /Ali Veli · STU-100 · Pasaport/);
    assert.equal(firstItem.querySelector('[data-action="retry-scan"]'), null);
    firstItem.querySelector('[data-action="open-application"]').click();
    assert.deepEqual(openedApplications, ['app-sub']);

    const reqBtn = firstItem.querySelector('[data-action="request-resubmission"]');
    assert.equal(reqBtn.textContent, 'İncelemeye al ve tekrar iste');
    reqBtn.click();

    const textarea = firstItem.querySelector('[data-action="scanner-resubmission-reason"]');
    assert.ok(textarea);
    assert.match(textarea.value, /Güvenlik taraması.*Security scan/);

    // First submit: transition succeeds, requestResubmission fails -> error shown, application stays under_review
    firstItem.querySelector('.staff-scanner-resubmission-form')
        .dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(transitions.length, 1);
    assert.equal(resubmissions.length, 1);
    assert.match(firstItem.querySelector('.staff-scanner-resubmission-error').textContent, /İstek geçici olarak başarısız/);
    assert.equal(reqBtn.textContent, 'Tekrar yükleme iste');

    // Retry submit: should NOT call transitionApplication again, only requestResubmission
    firstItem.querySelector('.staff-scanner-resubmission-form')
        .dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(transitions.length, 1);
    assert.equal(resubmissions.length, 2);

    // Second item (sent_to_migration): no request-resubmission button, shows "Önce Göç'ten geri alın"
    const secondItem = items[1];
    assert.equal(secondItem.querySelector('[data-action="request-resubmission"]'), null);
    assert.match(secondItem.textContent, /Önce Göç'ten geri alın/);

    document.defaultView.close();
});

test('staff scanner panel hides retry-scan when failed row has no scan job', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    document.defaultView.setTimeout = () => 0;

    const api = {
        readStatus: async () => ({
            jobs: [],
            runners: [],
            last_successful_scan: null,
            actionable_failed_total: 1,
            failed_jobs: [
                {
                    id: 'file-only-id',
                    has_scan_job: false,
                    result_code: 'failed',
                    scan_status: 'failed',
                    attempts: 0,
                    application_id: 'app-no-job',
                    student_number: 'STU-300',
                    first_name: 'Deniz',
                    last_name: 'Kaya',
                    document_code: 'passport',
                    revision_number: 1,
                    application_status: 'under_review',
                    application_updated_at: '2026-11-27T08:00:00.000Z',
                    can_request_resubmission: true
                }
            ]
        }),
        retry: async () => {},
        requestResubmission: async () => ({})
    };

    module.initializeScannerManager(root, api);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(root.querySelector('[data-action="retry-scan"]'), null);
    assert.ok(root.querySelector('[data-action="request-resubmission"]'));
    document.defaultView.close();
});

test('staff scanner panel refreshes job data on 409 without looping on stale updated_at/revision_number and dispatches DOM event on success', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    document.defaultView.setTimeout = () => 0;

    const dispatchedEvents = [];
    document.addEventListener('staff-scanner:resubmission-requested', (event) => {
        dispatchedEvents.push(event.detail);
    });

    let serverRevision = 1;
    let serverUpdatedAt = '2026-11-27T08:00:00.000Z';
    const resubmissionCalls = [];

    const api = {
        readStatus: async () => ({
            jobs: [],
            runners: [],
            last_successful_scan: null,
            actionable_failed_total: 1,
            failed_jobs: [{
                id: 'job-409',
                result_code: 'scan_timeout',
                scan_status: 'failed',
                attempts: 1,
                application_id: 'app-409',
                student_number: 'STU-409',
                first_name: 'Can',
                last_name: 'Demir',
                document_code: 'passport',
                revision_number: serverRevision,
                application_status: 'under_review',
                application_updated_at: serverUpdatedAt,
                can_request_resubmission: true
            }]
        }),
        retry: async () => {},
        requestResubmission: async (appId, code, rev, reason) => {
            resubmissionCalls.push({ appId, code, rev, reason });
            if (rev === 1) {
                serverRevision = 2;
                serverUpdatedAt = '2026-11-27T08:05:00.000Z';
                throw Object.assign(new Error('Belge güncellendi, tekrar deneyin.'), { status: 409 });
            }
            return { ok: true };
        }
    };

    module.initializeScannerManager(root, api);
    await new Promise((resolve) => setImmediate(resolve));

    root.querySelector('[data-action="request-resubmission"]').click();
    const textarea = root.querySelector('[data-action="scanner-resubmission-reason"]');
    textarea.value = 'Özel tarama nedeni.';

    // First submit hits 409 -> refreshes job data (revision_number becomes 2), keeps form, reason, and error
    root.querySelector('.staff-scanner-resubmission-form')
        .dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(resubmissionCalls.length, 1);
    assert.equal(resubmissionCalls[0].rev, 1);
    assert.equal(root.querySelector('[data-action="scanner-resubmission-reason"]').value, 'Özel tarama nedeni.');
    assert.match(root.querySelector('.staff-scanner-resubmission-error').textContent, /Belge güncellendi/);

    // Second submit uses refreshed revision_number = 2 and dispatches DOM event on success
    root.querySelector('.staff-scanner-resubmission-form')
        .dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(resubmissionCalls.length, 2);
    assert.equal(resubmissionCalls[1].rev, 2);
    assert.deepEqual(dispatchedEvents, [{ applicationId: 'app-409', documentCode: 'passport' }]);
    document.defaultView.close();
});
