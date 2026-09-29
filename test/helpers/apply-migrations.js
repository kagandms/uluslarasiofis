import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_URL = new URL('../../migrations/', import.meta.url);

/**
 * Applies the repository's ordered SQL migrations to a test D1-compatible database.
 * @param {object} database Test D1 binding with an `exec` method.
 * @returns {void} Applies every migration in filename order.
 */
export function applyAllMigrations(database) {
    const migrationFiles = readdirSync(MIGRATIONS_URL).filter((file) => file.endsWith('.sql')).sort();
    for (const migrationFile of migrationFiles) {
        database.exec(readFileSync(new URL(migrationFile, MIGRATIONS_URL), 'utf8'));
    }
}
