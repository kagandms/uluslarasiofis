import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const databaseName = process.argv[2];
if (!databaseName || !/^[A-Za-z0-9_-]+$/.test(databaseName)) throw new Error('Supply the production D1 database name.');
const wranglerCli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const migrationName = '0018_staff_document_security.sql';
const migrationFiles = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();
const requiredColumns = {
    mobile_document_transfer_files: ['upload_status', 'sha256']
};
const requiredObjects = ['mobile_transfer_rate_limits'];

/** Runs read-only metadata SQL without showing CLI diagnostics or credentials.
 * @param {string} query Metadata query. @returns {object[]} Result rows. @throws {Error} Failed remote query.
 */
function queryMetadata(query) {
    try {
        const output = execFileSync(process.execPath, [wranglerCli, 'd1', 'execute', databaseName,
            '--remote', '--env', 'production', '--command', query, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return JSON.parse(output).flatMap(result => result.results);
    } catch {
        throw new Error('Read-only production schema check failed; inspect operator authentication without exposing credentials.');
    }
}

const appliedNames = queryMetadata('SELECT name FROM d1_migrations ORDER BY id').map(row => row.name);
const pendingNames = migrationFiles.filter(name => !appliedNames.includes(name));
const isApplied = appliedNames.includes(migrationName);
const columnState = Object.entries(requiredColumns).flatMap(([table, columns]) => {
    const existing = queryMetadata(`PRAGMA table_info(${table})`).map(row => row.name);
    return columns.map(column => ({ table, column, present: existing.includes(column) }));
});
const objectState = queryMetadata("SELECT name FROM sqlite_master WHERE name IN ('mobile_transfer_rate_limits','staff_document_scan_jobs','staff_scan_files','physical_approval_scan_guard','physical_insert_scan_guard')");
const obsoleteColumns = {
    mobile_document_transfers: ['pairing_code_hash', 'phone_approved_at'],
    mobile_document_transfer_files: ['scan_status']
};
const unexpectedColumns = Object.entries(obsoleteColumns).flatMap(([table, columns]) => {
    const existing = queryMetadata(`PRAGMA table_info(${table})`).map(row => row.name);
    return columns.filter(column => existing.includes(column)).map(column => ({ table, column }));
});
const hasExpectedColumns = columnState.every(column => column.present === isApplied) && unexpectedColumns.length === 0;
const hasExpectedObjects = isApplied ? objectState.length === requiredObjects.length && requiredObjects.every(name => objectState.some(row => row.name === name)) : objectState.length === 0;
const hasExpectedHistory = isApplied ? pendingNames.length === 0 : pendingNames.length === 1 && pendingNames[0] === migrationName;
const status = hasExpectedColumns && hasExpectedObjects && hasExpectedHistory ? isApplied ? 'ALREADY_APPLIED_SKIP' : 'READY_PENDING' : 'BLOCKED_SCHEMA_DRIFT';
process.stdout.write(`${JSON.stringify({ status, appliedNames, pendingNames, columnState, unexpectedColumns, objectCount: objectState.length }, null, 2)}\n`);
process.exitCode = status.startsWith('BLOCKED') ? 1 : 0;
