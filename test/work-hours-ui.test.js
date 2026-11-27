import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initWorkHours } from '../src/staff/work-hours.js';

const WORK_HOURS_HTML = `
<!DOCTYPE html>
<html lang="tr">
<body>
    <aside class="work-hours-reminder" data-work-hours-reminder hidden></aside>
    <div id="staff-work-hours">
        <span data-work-hours-display></span>
        <input type="date" data-work-hours-date>
        <p data-work-hours-holiday hidden></p>
        <span data-work-hours-status></span>
        <div data-work-hours-table></div>
        <div data-work-hours-history></div>
    </div>
</body>
</html>
`;

function createMockXlsx(onBuild) {
    return {
        utils: {
            aoa_to_sheet(rows) {
                onBuild?.(rows);
                return { '!ref': 'A1:C40' };
            },
            book_new() {
                return { SheetNames: [], Sheets: {} };
            },
            book_append_sheet(workbook, worksheet, sheetName) {
                workbook.SheetNames.push(sheetName);
                workbook.Sheets[sheetName] = worksheet;
            }
        },
        write() {
            return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        }
    };
}

function flushMicrotasks() {
    return new Promise((resolve) => setImmediate(resolve));
}

function createDom({ xlsx } = {}) {
    const dom = new JSDOM(WORK_HOURS_HTML, { url: 'https://portal.test/yetkili/' });
    const downloads = [];

    if (xlsx !== undefined) {
        dom.window.XLSX = xlsx;
    }

    dom.window.URL.createObjectURL = () => 'blob:https://portal.test/mock-timesheet';
    dom.window.URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function mockClick() {
        downloads.push({ download: this.download, href: this.href });
    };

    return { dom, downloads };
}

test('renders one enabled Puantaj Oluştur button per person, template note, and no bulk export button', async () => {
    const originalFetch = globalThis.fetch;
    const { dom, downloads } = createDom({ xlsx: createMockXlsx() });

    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return {
                selectedDate: '2026-10-15',
                today: '2026-11-27',
                people: [],
                records: [
                    { staff_key: 'asaf', work_date: '2026-10-15', minutes: 450 }
                ]
            };
        }
    });

    try {
        initWorkHours(dom.window.document);
        await flushMicrotasks();

        const root = dom.window.document.getElementById('staff-work-hours');
        const exportButtons = root.querySelectorAll('[data-export-timesheet]');
        assert.equal(exportButtons.length, 5);
        for (const button of exportButtons) {
            assert.equal(button.textContent, 'Puantaj Oluştur');
            assert.equal(button.disabled, false);
        }

        assert.doesNotMatch(root.textContent, /Tümünü aktar/i);
        assert.match(root.textContent, /okul şablonu henüz eklenmedi/i);

        const asafButton = root.querySelector('[data-export-timesheet="asaf"]');
        asafButton.click();

        assert.equal(downloads.length, 1);
        assert.equal(downloads[0].download, 'Puantaj_2026-10_Asaf.xlsx');

        const status = root.querySelector('[data-work-hours-status]').textContent;
        // October 2026 has 22 weekdays; 1 recorded -> 21 missing weekdays.
        assert.match(status, /21 hafta içi günü eksik/);
        assert.match(status, /Puantaj_2026-10_Asaf\.xlsx indirildi/);
    } finally {
        globalThis.fetch = originalFetch;
        dom.window.close();
    }
});

test('shows error message and skips download when XLSX is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const { dom, downloads } = createDom({ xlsx: undefined });

    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return {
                selectedDate: '2026-11-27',
                today: '2026-11-27',
                people: [],
                records: []
            };
        }
    });

    try {
        initWorkHours(dom.window.document);
        await flushMicrotasks();

        const root = dom.window.document.getElementById('staff-work-hours');
        root.querySelector('[data-export-timesheet="eyup"]').click();

        assert.equal(downloads.length, 0);
        const status = root.querySelector('[data-work-hours-status]').textContent;
        assert.match(status, /Excel kütüphanesi \(XLSX\) yüklenemedi/);
    } finally {
        globalThis.fetch = originalFetch;
        dom.window.close();
    }
});

test('uses the currently displayed month for download even while a date change is still loading', async () => {
    const originalFetch = globalThis.fetch;
    let capturedRows = null;
    const { dom, downloads } = createDom({
        xlsx: createMockXlsx((rows) => {
            capturedRows = rows;
        })
    });

    let resolvePendingFetch;
    let callCount = 0;

    globalThis.fetch = async () => {
        callCount += 1;
        if (callCount === 1) {
            return {
                ok: true,
                async json() {
                    return {
                        selectedDate: '2026-11-27',
                        today: '2026-11-27',
                        people: [],
                        records: [
                            { staff_key: 'kagan_samet', work_date: '2026-11-26', minutes: 480 }
                        ]
                    };
                }
            };
        }

        return new Promise((resolve) => {
            resolvePendingFetch = resolve;
        });
    };

    try {
        initWorkHours(dom.window.document);
        await flushMicrotasks();

        const root = dom.window.document.getElementById('staff-work-hours');
        const dateInput = root.querySelector('[data-work-hours-date]');
        dateInput.value = '2026-10-15';
        dateInput.dispatchEvent(new dom.window.Event('change'));

        // While 2026-10-15 is still loading, click export on the currently displayed November month.
        root.querySelector('[data-export-timesheet="kagan_samet"]').click();

        assert.equal(downloads.length, 1);
        assert.equal(downloads[0].download, 'Puantaj_2026-11_Kağan-Samet.xlsx');
        assert.equal(capturedRows[1][1], '2026-11');

        resolvePendingFetch({
            ok: true,
            async json() {
                return {
                    selectedDate: '2026-10-15',
                    today: '2026-11-27',
                    people: [],
                    records: []
                };
            }
        });
        await flushMicrotasks();
    } finally {
        globalThis.fetch = originalFetch;
        dom.window.close();
    }
});
