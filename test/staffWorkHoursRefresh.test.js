/**
 * Tests that the Çalışma Saatleri screen reloads the currently selected date when
 * `staff-work-hours:changed` is dispatched on `window` (e.g. after a Topi save).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initWorkHours } from '../src/staff/work-hours.js';

async function flushPromises() {
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
    await new Promise((resolveTick) => setImmediate(resolveTick));
}

function setupWorkHoursDom(context, fakeFetch) {
    const html = `<!doctype html>
<html lang="tr">
<head><title>Çalışma Saatleri</title></head>
<body>
    <div data-work-hours-reminder hidden></div>
    <section id="staff-work-hours">
        <input type="date" data-work-hours-date value="">
        <div data-work-hours-status></div>
        <div data-work-hours-display></div>
        <div data-work-hours-holiday hidden></div>
        <div data-work-hours-table></div>
        <div data-work-hours-history></div>
    </section>
</body>
</html>`;

    const dom = new JSDOM(html, { url: 'https://portal.test/yetkili/' });
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.fetch = fakeFetch;

    context.after(() => {
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
        if (originalDocument === undefined) {
            delete globalThis.document;
        } else {
            globalThis.document = originalDocument;
        }
        globalThis.fetch = originalFetch;
        dom.window.close();
    });

    return { dom, window: dom.window, document: dom.window.document };
}

test('initWorkHours reloads currently selected date on staff-work-hours:changed event', async (context) => {
    const getUrls = [];
    let currentRecords = [];

    const fakeFetch = async (url, options = {}) => {
        const method = (options.method || 'GET').toUpperCase();
        if (method === 'GET') {
            getUrls.push(String(url));
        }
        const parsed = new URL(String(url), 'https://portal.test');
        const selectedDate = parsed.searchParams.get('date') || '2026-11-23';
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    today: selectedDate,
                    selectedDate,
                    people: [
                        { key: 'kagan_samet', name: 'Kağan Samet' },
                        { key: 'asaf', name: 'Asaf' },
                        { key: 'eyup', name: 'Eyüp' },
                        { key: 'oguz', name: 'Oğuz' },
                        { key: 'eray', name: 'Eray' }
                    ],
                    records: currentRecords.map((entry) => ({
                        ...entry,
                        work_date: entry.work_date || selectedDate
                    }))
                };
            }
        };
    };

    const { window, document } = setupWorkHoursDom(context, fakeFetch);

    initWorkHours();
    await flushPromises();

    const dateInput = document.querySelector('[data-work-hours-date]');
    const today = dateInput.value;

    assert.equal(getUrls.length, 1);
    assert.equal(getUrls[0], `/api/staff/work-hours?date=${encodeURIComponent(today)}`);
    assert.equal(document.querySelector('[data-person="kagan_samet"]').value, '0');
    assert.match(document.querySelector('[data-work-hours-table]').textContent, /Henüz girilmedi/);

    // Simulate Topi saving 390 minutes for kagan_samet and dispatching the refresh event.
    currentRecords = [{ staff_key: 'kagan_samet', minutes: 390, work_date: today }];
    window.dispatchEvent(new window.CustomEvent('staff-work-hours:changed', {
        detail: { person: 'kagan_samet', minutes: 390 }
    }));
    await flushPromises();

    assert.equal(getUrls.length, 2);
    assert.equal(getUrls[1], `/api/staff/work-hours?date=${encodeURIComponent(today)}`);
    assert.equal(document.querySelector('[data-person="kagan_samet"]').value, '390');
    assert.match(document.querySelector('[data-work-hours-table]').textContent, /6\.5 saat/);

    // If a different date is selected in dateInput, the listener reloads that selected date.
    dateInput.value = '2026-11-20';
    window.dispatchEvent(new window.CustomEvent('staff-work-hours:changed', {
        detail: { person: 'kagan_samet', minutes: 390 }
    }));
    await flushPromises();

    assert.equal(getUrls.length, 3);
    assert.equal(getUrls[2], '/api/staff/work-hours?date=2026-11-20');
});
