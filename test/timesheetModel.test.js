import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimesheet } from '../src/staff/timesheet/timesheetModel.js';

test('buildTimesheet generates exact day counts for 28, 29, 30, and 31-day months', () => {
    const person = { key: 'asaf', name: 'Asaf' };

    assert.equal(buildTimesheet({ month: '2025-02', today: '2025-02-28', person, records: [] }).days.length, 28);
    assert.equal(buildTimesheet({ month: '2024-02', today: '2024-02-29', person, records: [] }).days.length, 29);
    assert.equal(buildTimesheet({ month: '2026-11', today: '2026-11-30', person, records: [] }).days.length, 30);
    assert.equal(buildTimesheet({ month: '2026-10', today: '2026-10-31', person, records: [] }).days.length, 31);
});

test('buildTimesheet handles half hours, totals, and distinguishes empty vs 0 minutes', () => {
    const timesheet = buildTimesheet({
        month: '2026-11',
        today: '2026-11-05',
        person: { key: 'kagan_samet', name: 'Kağan Samet' },
        records: [
            { staff_key: 'kagan_samet', work_date: '2026-11-02', minutes: 450 },
            { staff_key: 'kagan_samet', work_date: '2026-11-03', minutes: 0 },
            { staff_key: 'kagan_samet', work_date: '2026-11-04', minutes: 90 },
            { staff_key: 'asaf', work_date: '2026-11-02', minutes: 480 },
            { staff_key: 'kagan_samet', work_date: '2026-10-30', minutes: 480 }
        ]
    });

    assert.equal(timesheet.days[0].date, '2026-11-01');
    assert.equal(timesheet.days[0].weekday, 'Pazar');
    assert.equal(timesheet.days[0].isWeekend, true);
    assert.equal(timesheet.days[0].minutes, null);

    assert.equal(timesheet.days[1].date, '2026-11-02');
    assert.equal(timesheet.days[1].weekday, 'Pazartesi');
    assert.equal(timesheet.days[1].isWeekend, false);
    assert.equal(timesheet.days[1].minutes, 450);

    assert.equal(timesheet.days[2].date, '2026-11-03');
    assert.equal(timesheet.days[2].minutes, 0);

    assert.equal(timesheet.days[3].date, '2026-11-04');
    assert.equal(timesheet.days[3].minutes, 90);

    assert.equal(timesheet.days[4].date, '2026-11-05');
    assert.equal(timesheet.days[4].minutes, null);

    assert.equal(timesheet.totalMinutes, 540);
    assert.equal(timesheet.recordedDays, 3);
    // 2026-11-05 is Thursday and unrecorded; 2026-11-01 is Sunday; 02, 03, 04 are recorded; 06+ are future.
    assert.equal(timesheet.missingDays, 1);
});

test('buildTimesheet handles empty month without counting future days as missing', () => {
    // 2026-11-01 is Sunday, 2026-11-02 is Monday, 2026-11-03 is Tuesday.
    const currentMonth = buildTimesheet({
        month: '2026-11',
        today: '2026-11-03',
        person: { key: 'eyup', name: 'Eyüp' },
        records: []
    });

    assert.equal(currentMonth.totalMinutes, 0);
    assert.equal(currentMonth.recordedDays, 0);
    // Only Nov 2 (Mon) and Nov 3 (Tue) are weekdays up to today; Nov 4..30 are future days.
    assert.equal(currentMonth.missingDays, 2);

    const futureMonth = buildTimesheet({
        month: '2026-12',
        today: '2026-11-27',
        person: { key: 'eyup', name: 'Eyüp' },
        records: []
    });
    assert.equal(futureMonth.missingDays, 0);
});

test('buildTimesheet counts all unrecorded weekdays in a past month', () => {
    // February 2026 has 28 days: 20 weekdays and 8 weekend days.
    const pastMonth = buildTimesheet({
        month: '2026-02',
        today: '2026-11-27',
        person: { key: 'oguz', name: 'Oğuz' },
        records: [
            { staff_key: 'oguz', work_date: '2026-02-02', minutes: 480 }
        ]
    });

    assert.equal(pastMonth.days.length, 28);
    assert.equal(pastMonth.recordedDays, 1);
    assert.equal(pastMonth.totalMinutes, 480);
    assert.equal(pastMonth.missingDays, 19);
});
