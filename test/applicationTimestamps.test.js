import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatQueueDate } from '../src/staff/application-queue-table.js';
import { buildApplicationDocumentSections } from '../src/shared/applicationDocumentPdf.js';

test('application queues display SQLite UTC and offset timestamps in Istanbul regardless of device timezone', (context) => {
    const previousTimezone = process.env.TZ;
    context.after(() => {
        if (previousTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = previousTimezone;
    });
    for (const timezone of ['Europe/Istanbul', 'UTC', 'America/Los_Angeles']) {
        process.env.TZ = timezone;
        for (const timestamp of ['2026-11-02 15:40:59', '2026-11-02 15:40:59.123',
            '2026-11-02T15:40:59Z', '2026-11-02T18:40:59+03:00']) {
            assert.match(formatQueueDate(timestamp), /18:40/u, `${timezone}: ${timestamp}`);
        }
    }
    assert.equal(formatQueueDate(null), '—');
    assert.equal(formatQueueDate('invalid'), '—');
});

test('application PDF uses UTC for SQLite creation times without shifting date-only fields', (context) => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Istanbul';
    context.after(() => {
        if (previousTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = previousTimezone;
    });
    const sections = buildApplicationDocumentSections({
        created_at: '2026-11-02 15:40:59', date_of_birth: '2000-01-01'
    });
    const fields = sections.flatMap(section => section.fields);
    assert.match(fields.find(field => field.label === 'Başvuru Tarihi').value, /18:40/u);
    assert.match(fields.find(field => field.label === 'Doğum tarihi').value, /1 Oca 2000/u);
});
