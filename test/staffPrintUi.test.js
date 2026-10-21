import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const staffHtml = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

function createJob(id, status) {
    return { id, status, source: 'staff', paper_size: 'A4', color_mode: 'monochrome', orientation: 'portrait',
        duplex: 'simplex', copies: 1, created_at: '2026-10-09T09:00:00.000Z', page_count: 2 };
}

async function openPrintView(role, jobs, overrides = {}) {
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
                processing: 1, submitted: 2, pending: 2 }, jobs, canManage: role === 'admin', ...overrides };
        return { ok: true, json: async () => payload };
    };
    await import(`../src/staff/print-status.js?ui=${crypto.randomUUID()}`);
    const { initializeStaffPrintStatus } = await import(`../src/staff/print-status.js?ui-init=${crypto.randomUUID()}`);
    initializeStaffPrintStatus(dom.window.document);
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('workspace:view-changed', {
        detail: { viewName: 'print' }
    }));
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (dom.window.document.querySelector('#print-staff-status').dataset.state) break;
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

test('staff status uses plain Turkish without showing printer implementation details', async () => {
    const { dom } = await openPrintView('admin', []);
    try {
        const document = dom.window.document;

        assert.equal(document.getElementById('print-staff-status').textContent, 'Yazıcı bağlı ve hazır');
        assert.equal(document.getElementById('print-staff-status').dataset.state, 'ready');
        assert.match(document.getElementById('print-staff-details').textContent, /Son bağlantı/);
        assert.match(document.getElementById('print-staff-details').textContent, /Hazır/);
        assert.doesNotMatch(document.getElementById('print-staff-details').textContent, /heartbeat|ready|agent-1/);
        assert.equal(document.querySelector('.print-technical-disclosure'), null);
        assert.equal(document.getElementById('print-staff-technical-details'), null);
        assert.match(document.getElementById('print-staff-jobs').textContent, /dosya yok/);
    } finally {
        closePrintView(dom);
    }
});

test('paused printing offers only resume and offline printing never claims readiness', async () => {
    for (const overrides of [{ queue: { paused: true } }, { printer: { online: false, health: 'ready' } },
        { printer: { online: true, health: 'unavailable' } }]) {
        const { dom } = await openPrintView('admin', [], overrides);
        try {
            const document = dom.window.document;
            const isPaused = overrides.queue?.paused === true;

            assert.equal(document.getElementById('print-staff-status').dataset.state, isPaused ? 'paused' : 'unavailable');
            assert.equal(document.getElementById('print-queue-pause').hidden, isPaused);
            assert.equal(document.getElementById('print-queue-resume').hidden, !isPaused);
            assert.notEqual(document.getElementById('print-staff-status').textContent, 'Yazıcı bağlı ve hazır');
            if (!isPaused) {
                assert.doesNotMatch(document.getElementById('print-staff-details').textContent, /Yeni dosyalar kabul ediliyor/);
                assert.match(document.getElementById('print-staff-details').textContent, /hazır olana kadar bekleyin/);
            }
        } finally {
            closePrintView(dom);
        }
    }
});

test('submitted and uncertain jobs keep the physical-output and duplicate-print caveats', async () => {
    const { dom } = await openPrintView('admin', [createJob('submitted-id', 'submitted'), createJob('unknown-id', 'unknown')]);
    try {
        const statuses = [...dom.window.document.querySelectorAll('.print-job-card strong')].map((element) => element.textContent);

        assert.match(statuses[0], /kağıt çıktısını kontrol edin/);
        assert.match(statuses[1], /otomatik tekrarlanmadı/);
        assert.ok([...dom.window.document.querySelectorAll('.print-job-cancel')].every((button) => button.disabled));
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
        assert.match(document.querySelector('#print-staff-counts').textContent, /Sırada bekleyen/);
    } finally {
        closePrintView(dom);
    }
});
