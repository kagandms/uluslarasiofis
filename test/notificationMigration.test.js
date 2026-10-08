import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

const migrationDirectory = new URL('../migrations/', import.meta.url);

test('migration versions allow only the three historical production print and physical pairs', () => {
    const migrationFiles = readdirSync(migrationDirectory).filter((file) => file.endsWith('.sql')).sort();
    const versions = migrationFiles.map((file) => file.slice(0, file.indexOf('_')));
    const historicalPairs = {
        '0011': ['0011_mobile_document_transfers.sql', '0011_print_queue.sql'],
        '0012': ['0012_physical_intakes.sql', '0012_print_options.sql'],
        '0013': ['0013_physical_intake_review.sql', '0013_print_orientation_volume.sql']
    };
    for (const version of new Set(versions)) {
        const filenames = migrationFiles.filter(file => file.startsWith(`${version}_`));
        if (filenames.length === 1) continue;
        assert.deepEqual(filenames, historicalPairs[version], `Unexpected version collision: ${version}`);
    }
    assert.ok(migrationFiles.includes('0005_document_scoped_application_notes.sql'));
    assert.ok(migrationFiles.includes('0006_notification_preferences_and_delivery_state.sql'));
    assert.ok(migrationFiles.includes('0007_notification_provider_webhook_events.sql'));
    assert.equal(migrationFiles.includes('0005_notification_preferences_and_delivery_state.sql'), false);
});
