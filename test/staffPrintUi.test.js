import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const staffHtml = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

function createJob(id, status) {
    return { id, status, source: 'staff', paper_size: 'A4', color_mode: 'monochrome', orientation: 'portrait',
        duplex: 'simplex', copies: 1, created_at: '2026-10-09T09:00:00.000Z', page_count: 2 };
}

async function openPrintView(role, jobs) {
    const dom = new JSDOM(staffHtml, { url: 'https://portal.test/yetkili/' });
    const fetchPaths = [];
    dom.window.setInterval = () => 1;
    dom.window.clearInterval = () => {};
    dom.window.confirm = () => true;
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.fetch = async (path) => {
        fetchPaths.push(String(path));
        const payload = String(path).includes('/history') ? { jobs: [], hasMore: false, nextCursor: null }
            : { printer: { online: true, printer_name: 'Kyocera Office', seen_at: '2026-10-09T09:00:00.000Z',
                runner_id: 'agent-1', health: 'ready' }, queue: { paused: false }, counts: { queued: 1,
                processing: 1, submitted: 2, pending: 2 }, jobs, canManage: role === 'admin' };
        return { ok: true, json: async () => payload };
    };
    await import(`../src/staff/print-status.js?ui=${crypto.randomUUID()}`);
    const { initializeStaffPrintStatus } = await import(`../src/staff/print-status.js?ui-init=${crypto.randomUUID()}`);
    initializeStaffPrintStatus(dom.window.document);
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('workspace:view-changed', {
        detail: { viewName: 'print' }
    }));
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (dom.window.document.querySelectorAll('.print-job-card').length >= jobs.length) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { dom, fetchPaths };
}

function closePrintView(dom) {
    dom.window.close();
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.fetch;
}

test('admin UI offers pause and only enables cancellation for safe pending jobs', async () => {
    const jobs = [createJob('10000000-0000-4000-8000-000000000001', 'queued'),
        createJob('10000000-0000-4000-8000-000000000002', 'leased')];
    const { dom, fetchPaths } = await openPrintView('admin', jobs);
    try {
        const document = dom.window.document;
        assert.equal(document.getElementById('print-queue-pause').hidden, false);
        assert.equal(document.getElementById('print-queue-resume').hidden, true);
        const cancellationButtons = document.querySelectorAll('#print-staff-jobs .print-job-cancel');
        assert.equal(cancellationButtons.length, 2);
        assert.equal(cancellationButtons[0].disabled, false);
        assert.equal(cancellationButtons[1].disabled, true);
        assert.match(cancellationButtons[1].title, /güvenli iptal/i);
        assert.ok(fetchPaths.includes('/api/staff/print/management'));
        assert.ok(fetchPaths.some((path) => path.startsWith('/api/staff/print/history?')));
        assert.equal(document.querySelector('.staff-print-frame').getAttribute('src'), '/yazdir/?mode=staff');
    } finally {
        closePrintView(dom);
    }
});

test('reviewer UI keeps read access and hides management controls', async () => {
    const { dom } = await openPrintView('reviewer', [createJob('10000000-0000-4000-8000-000000000003', 'queued')]);
    try {
        const document = dom.window.document;
        assert.equal(document.getElementById('print-queue-pause').hidden, true);
        assert.equal(document.getElementById('print-queue-resume').hidden, true);
        assert.equal(document.querySelector('#print-staff-jobs .print-job-cancel').disabled, true);
        assert.match(document.querySelector('#print-staff-counts').textContent, /Bekleyen/);
    } finally {
        closePrintView(dom);
    }
});
