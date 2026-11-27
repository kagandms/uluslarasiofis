import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { initWorkHours } from '../src/staff/work-hours.js';

test('work-hours timesheet export revokes object URL asynchronously via setTimeout, not synchronously', async (context) => {
    const dom = new JSDOM(`
        <section id="staff-work-hours">
            <input type="date" data-work-hours-date />
            <span data-work-hours-display></span>
            <span data-work-hours-status></span>
            <p data-work-hours-holiday hidden></p>
            <div data-work-hours-table></div>
            <div data-work-hours-history></div>
        </section>
    `, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const { document } = window;
    context.after(() => window.close());

    const createdUrls = [];
    const revokedUrls = [];
    const scheduledTimers = [];

    window.URL.createObjectURL = () => {
        const url = `blob:https://portal.test/${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
    };
    window.URL.revokeObjectURL = (url) => {
        revokedUrls.push(url);
    };
    window.setTimeout = (fn, delay) => {
        scheduledTimers.push({ fn, delay });
        return scheduledTimers.length;
    };
    window.HTMLAnchorElement.prototype.click = () => {};
    window.XLSX = {
        utils: {
            aoa_to_sheet: () => ({ '!ref': 'A1:C10' }),
            book_new: () => ({ SheetNames: [], Sheets: {} }),
            book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; }
        },
        write: () => new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    };

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return {
                selectedDate: '2026-11-27',
                today: '2026-11-27',
                people: [{ key: 'asaf', name: 'Asaf' }],
                records: [{ staff_key: 'asaf', work_date: '2026-11-27', minutes: 480 }]
            };
        }
    });
    context.after(() => { globalThis.fetch = previousFetch; });

    initWorkHours(document);
    await new Promise((resolve) => setImmediate(resolve));

    document.querySelector('[data-export-timesheet="asaf"]').click();

    assert.equal(createdUrls.length, 1);
    assert.deepEqual(revokedUrls, []);
    assert.equal(scheduledTimers.length, 1);
    assert.ok(scheduledTimers[0].delay >= 1000);

    scheduledTimers[0].fn();
    assert.deepEqual(revokedUrls, createdUrls);
});
