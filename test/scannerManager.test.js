import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeScannerManager } from '../src/staff/scanner-manager.js';

function createScannerDom() {
    return new JSDOM('<!doctype html><html><body><div id="scanner-root"></div></body></html>', {
        url: 'https://portal.test/yetkili/'
    });
}

test('scanner panel shows "Öğrenciden yeni dosya bekleniyor" for failed files already marked resubmission_required', async () => {
    const dom = createScannerDom();
    const { document } = dom.window;
    const root = document.getElementById('scanner-root');
    const nowIso = new Date().toISOString();

    const api = {
        async readStatus() {
            return {
                jobs: [{ status: 'failed', count: 2 }],
                runners: [{ seen_at: nowIso, health: 'ready', signature_updated_at: nowIso }],
                last_successful_scan: nowIso,
                actionable_failed_total: 2,
                failed_jobs: [
                    {
                        id: 'job-rev-resub',
                        has_scan_job: true,
                        attempts: 1,
                        result_code: 'unsupported_content',
                        scan_status: 'failed',
                        updated_at: nowIso,
                        application_id: 'app-1',
                        student_number: '26000000001',
                        first_name: 'Ayşe',
                        last_name: 'Yılmaz',
                        document_code: 'passport',
                        revision_number: 1,
                        revision_status: 'resubmission_required',
                        review_status: 'resubmission_required',
                        application_status: 'resubmission_required',
                        can_request_resubmission: false
                    },
                    {
                        id: 'job-app-resub',
                        has_scan_job: true,
                        attempts: 1,
                        result_code: 'policy_blocked',
                        scan_status: 'failed',
                        updated_at: nowIso,
                        application_id: 'app-2',
                        student_number: '26000000002',
                        first_name: 'Mehmet',
                        last_name: 'Kaya',
                        document_code: 'health_insurance',
                        revision_number: 1,
                        application_status: 'resubmission_required',
                        can_request_resubmission: false
                    }
                ]
            };
        },
        async requestResubmission() {
            throw new Error('should not be called');
        }
    };

    initializeScannerManager(root, api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    dom.window.closed = true;

    const items = [...root.querySelectorAll('.staff-scanner-failure-item')];
    assert.equal(items.length, 2);

    for (const item of items) {
        const actions = item.querySelector('.staff-scanner-failure-actions');
        assert.ok(actions);
        assert.equal(actions.querySelector('[data-action="request-resubmission"]'), null);
        const note = actions.querySelector('.staff-scanner-migration-note');
        assert.ok(note);
        assert.equal(note.textContent, 'Öğrenciden yeni dosya bekleniyor');
    }
});
