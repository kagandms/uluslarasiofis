import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimesheet } from '../src/staff/timesheet/timesheetModel.js';
import { sanitizeTextCell, writeTimesheet } from '../src/staff/timesheet/timesheetWriter.js';

function createMockXlsx() {
    const captured = { rows: null, sheetName: null, worksheet: null, writeOptions: null };
    const XLSX = {
        utils: {
            aoa_to_sheet(rows) {
                captured.rows = rows;
                const sheet = { '!ref': 'A1:C40' };
                captured.worksheet = sheet;
                return sheet;
            },
            book_new() {
                return { SheetNames: [], Sheets: {} };
            },
            book_append_sheet(workbook, worksheet, sheetName) {
                captured.sheetName = sheetName;
                workbook.SheetNames.push(sheetName);
                workbook.Sheets[sheetName] = worksheet;
            }
        },
        write(_workbook, options) {
            captured.writeOptions = options;
            return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        }
    };
    return { XLSX, captured };
}

test('writeTimesheet produces Turkish file name, half hours, totals, and keeps empty vs 0 distinct', () => {
    const timesheet = buildTimesheet({
        month: '2026-11',
        today: '2026-11-27',
        person: { key: 'kagan_samet', name: 'Kağan Samet' },
        records: [
            { staff_key: 'kagan_samet', work_date: '2026-11-02', minutes: 450 },
            { staff_key: 'kagan_samet', work_date: '2026-11-03', minutes: 0 },
            { staff_key: 'kagan_samet', work_date: '2026-11-04', minutes: 90 }
        ]
    });

    const { XLSX, captured } = createMockXlsx();
    const result = writeTimesheet(timesheet, { XLSX });

    assert.equal(result.fileName, 'Puantaj_2026-11_Kağan-Samet.xlsx');
    assert.ok(result.bytes instanceof Uint8Array);
    assert.equal(captured.sheetName, 'Puantaj');
    assert.deepEqual(captured.writeOptions, { bookType: 'xlsx', type: 'array' });

    assert.deepEqual(captured.rows[0], ['Ad Soyad', 'Kağan Samet']);
    assert.deepEqual(captured.rows[1], ['Ay', '2026-11']);
    assert.deepEqual(captured.rows[3], ['Tarih', 'Gün', 'Saat']);

    // 2026-11-01 (empty -> null)
    assert.deepEqual(captured.rows[4], ['01.11.2026', 'Pazar', null]);
    // 2026-11-02 (450 min -> 7.5 hours)
    assert.deepEqual(captured.rows[5], ['02.11.2026', 'Pazartesi', 7.5]);
    // 2026-11-03 (0 min -> 0 hours, distinct from empty)
    assert.deepEqual(captured.rows[6], ['03.11.2026', 'Salı', 0]);
    // 2026-11-04 (90 min -> 1.5 hours)
    assert.deepEqual(captured.rows[7], ['04.11.2026', 'Çarşamba', 1.5]);

    const totalRow = captured.rows.at(-1);
    assert.deepEqual(totalRow, ['Toplam', '', 9]);
});

test('writeTimesheet neutralizes formula-like text cells', () => {
    assert.equal(sanitizeTextCell('=SUM(A1:A2)'), "'=SUM(A1:A2)");
    assert.equal(sanitizeTextCell('+1+1'), "'+1+1");
    assert.equal(sanitizeTextCell('-cmd'), "'-cmd");
    assert.equal(sanitizeTextCell('@SUM(1,2)'), "'@SUM(1,2)");
    assert.equal(sanitizeTextCell('\t=1'), "'\t=1");
    assert.equal(sanitizeTextCell('\r=1'), "'\r=1");
    assert.equal(sanitizeTextCell('Kağan Samet'), 'Kağan Samet');

    const timesheet = buildTimesheet({
        month: '2026-11',
        today: '2026-11-27',
        person: { key: 'test', name: '=HYPERLINK("https://evil.example")' },
        records: []
    });
    const { XLSX, captured } = createMockXlsx();
    writeTimesheet(timesheet, { XLSX });

    assert.equal(captured.rows[0][1], '\'=HYPERLINK("https://evil.example")');
});

test('writeTimesheet throws a clear error when XLSX is unavailable', () => {
    const timesheet = buildTimesheet({
        month: '2026-11',
        today: '2026-11-27',
        person: { key: 'asaf', name: 'Asaf' },
        records: []
    });

    assert.throws(
        () => writeTimesheet(timesheet, { XLSX: undefined }),
        /Excel kütüphanesi \(XLSX\) yüklenemedi/
    );
});
