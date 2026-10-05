/**
 * D1 Database automated snapshot backup service for R2 bucket storage.
 * Exports all user tables to structured JSON snapshots with metadata and retention.
 */

/**
 * Performs a full snapshot of all user tables in D1 and persists it to R2.
 * @param {object} options
 * @param {object} options.database Cloudflare D1 binding (env.DB).
 * @param {object} options.storage Cloudflare R2 bucket binding (env.DOCUMENTS).
 * @param {string} [options.environmentName] Target environment name ('staging' | 'production').
 * @returns {Promise<{success: boolean, backupKey: string, latestKey: string, tableCount: number, stats: Record<string, number>, sizeBytes: number}>}
 */
export async function backupD1ToR2({ database, storage, environmentName = 'production' }) {
    if (!database || typeof database.prepare !== 'function') {
        throw new Error('D1 database binding is required for backup.');
    }
    if (!storage || typeof storage.put !== 'function') {
        throw new Error('R2 storage binding is required for backup.');
    }

    // Discover all user tables excluding SQLite internal and D1 migration metadata
    const tablesQuery = await database.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_migrations' ORDER BY name ASC"
    ).all();

    const tableNames = (tablesQuery.results || []).map((row) => row.name);
    const backupData = {
        metadata: {
            timestamp: new Date().toISOString(),
            environment: environmentName,
            tableCount: tableNames.length
        },
        stats: {},
        tables: {}
    };

    for (const tableName of tableNames) {
        if (!/^[a-zA-Z0-9_]+$/.test(tableName)) continue;
        const rowsQuery = await database.prepare(`SELECT * FROM ${tableName}`).all();
        const rows = rowsQuery.results || [];
        backupData.tables[tableName] = rows;
        backupData.stats[tableName] = rows.length;
    }

    const totalRecords = Object.values(backupData.stats).reduce((a, b) => a + b, 0);
    backupData.metadata.recordCount = totalRecords;

    const jsonString = JSON.stringify(backupData, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const backupKey = `backups/${environmentName}/${dateStr}/d1-backup-${timestampStr}.json`;
    const latestKey = `backups/${environmentName}/latest.json`;

    // Write dated historical snapshot
    await storage.put(backupKey, jsonString, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
            environment: environmentName,
            createdAt: backupData.metadata.timestamp,
            tableCount: String(tableNames.length),
            recordCount: String(totalRecords)
        }
    });

    // Write pointer to latest backup for easy retrieval
    await storage.put(latestKey, jsonString, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
            environment: environmentName,
            createdAt: backupData.metadata.timestamp,
            tableCount: String(tableNames.length),
            recordCount: String(totalRecords),
            originalKey: backupKey
        }
    });

    return {
        success: true,
        backupKey,
        latestKey,
        tableCount: tableNames.length,
        stats: backupData.stats,
        sizeBytes: jsonString.length
    };
}

/**
 * Retrieves metadata about the latest backup stored in R2.
 * @param {object} storage R2 bucket binding.
 * @param {string} environmentName Environment name.
 * @returns {Promise<object|null>}
 */
export async function getLatestBackupMetadata(storage, environmentName = 'production') {
    if (!storage || typeof storage.head !== 'function') return null;
    const latestKey = `backups/${environmentName}/latest.json`;
    const object = await storage.head(latestKey);
    if (!object) return null;
    return {
        key: latestKey,
        originalKey: object.customMetadata?.originalKey || latestKey,
        createdAt: object.customMetadata?.createdAt || object.uploaded?.toISOString?.(),
        tableCount: object.customMetadata?.tableCount ? Number(object.customMetadata.tableCount) : null,
        recordCount: object.customMetadata?.recordCount ? Number(object.customMetadata.recordCount) : null,
        sizeBytes: object.size
    };
}
