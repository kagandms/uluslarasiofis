import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupD1ToR2, getLatestBackupMetadata } from '../src/server/services/d1BackupService.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

class MockR2Bucket {
    constructor() {
        this.storage = new Map();
    }

    async put(key, value, options = {}) {
        this.storage.set(key, {
            data: value,
            customMetadata: options.customMetadata || {},
            httpMetadata: options.httpMetadata || {},
            size: typeof value === 'string' ? Buffer.byteLength(value) : value.length,
            uploaded: new Date()
        });
        return { key, size: this.storage.get(key).size };
    }

    async head(key) {
        const item = this.storage.get(key);
        if (!item) return null;
        return {
            key,
            size: item.size,
            customMetadata: item.customMetadata,
            uploaded: item.uploaded
        };
    }

    async get(key) {
        const item = this.storage.get(key);
        if (!item) return null;
        return {
            key,
            customMetadata: item.customMetadata,
            async text() {
                return typeof item.data === 'string' ? item.data : item.data.toString();
            }
        };
    }
}

test('backupD1ToR2 captures all user tables into dated and latest JSON files in R2', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);

    // Insert mock data into students and applications
    const studentId = 'student-test-01';
    database.prepare(`INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, 'STD-100', 'STD-100')`).bind(studentId).run();
    database.prepare(`INSERT INTO applications (id, student_id, application_type, status)
        VALUES ('app-test-01', ?, 'initial', 'submitted')`).bind(studentId).run();

    const mockStorage = new MockR2Bucket();
    const result = await backupD1ToR2({
        database,
        storage: mockStorage,
        environmentName: 'staging'
    });

    assert.equal(result.success, true);
    assert.ok(result.backupKey.startsWith('backups/staging/'));
    assert.equal(result.latestKey, 'backups/staging/latest.json');
    assert.ok(result.tableCount > 5);
    assert.equal(result.stats.students, 1);
    assert.equal(result.stats.applications, 1);
    assert.ok(result.sizeBytes > 100);

    // Verify written data in R2
    const latestFile = await mockStorage.get('backups/staging/latest.json');
    assert.ok(latestFile);
    const parsed = JSON.parse(await latestFile.text());
    assert.equal(parsed.metadata.environment, 'staging');
    assert.equal(parsed.tables.students[0].student_number, 'STD-100');
    assert.equal(parsed.tables.applications[0].id, 'app-test-01');

    // Verify metadata retrieval
    const metadata = await getLatestBackupMetadata(mockStorage, 'staging');
    assert.ok(metadata);
    assert.equal(metadata.key, 'backups/staging/latest.json');
    assert.ok(metadata.recordCount >= 2);
});

test('backupD1ToR2 rejects invalid database or storage bindings', async () => {
    await assert.rejects(
        async () => backupD1ToR2({ database: null, storage: new MockR2Bucket() }),
        /D1 database binding is required/
    );
    await assert.rejects(
        async () => backupD1ToR2({ database: new TestD1Database(), storage: null }),
        /R2 storage binding is required/
    );
});
