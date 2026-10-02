import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

const migrationDirectory = new URL('../migrations/', import.meta.url);

test('notification migrations use unique ordered Wrangler migration versions', () => {
    const migrationFiles = readdirSync(migrationDirectory).filter((file) => file.endsWith('.sql')).sort();
    const versions = migrationFiles.map((file) => file.slice(0, file.indexOf('_')));
    assert.equal(new Set(versions).size, versions.length);
    assert.ok(migrationFiles.includes('0005_document_scoped_application_notes.sql'));
    assert.ok(migrationFiles.includes('0006_notification_preferences_and_delivery_state.sql'));
    assert.ok(migrationFiles.includes('0007_notification_provider_webhook_events.sql'));
    assert.equal(migrationFiles.includes('0005_notification_preferences_and_delivery_state.sql'), false);
});
