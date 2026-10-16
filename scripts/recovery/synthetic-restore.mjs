import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { canonical } from './evidence.mjs';
import { sha256, verifyRestoredObject } from './restore-checks.mjs';

const need = (ok, code) => { if (!ok) throw new Error(code); };
const cleanSql = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value)
    : value instanceof Uint8Array ? `X'${Buffer.from(value).toString('hex')}'` : `'${String(value).replaceAll("'", "''")}'`;
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const schemaQuery = "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name";

// No user path, resource ID, export, runtime credential or remote flag is accepted.
// Only checked-in migrations and constants created below can enter this local exercise.
export async function runSyntheticRestore() {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_API_TOKEN', 'CF_API_KEY',
        'CF_EMAIL', 'PRINTER_SECRET', 'SCANNER_SECRET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY']) {
        need(!process.env[name], 'RECOVERY_SYNTHETIC_REFUSES_CREDENTIALS');
    }
    const source = new DatabaseSync(':memory:');
    let runtime;
    try {
        const migrations = readdirSync(new URL('../../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();
        source.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE);');
        for (const name of migrations) {
            source.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
            source.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
        }
        source.exec("CREATE TABLE recovery_fixture_objects(id TEXT PRIMARY KEY, student_id TEXT REFERENCES students(id), bucket TEXT, object_key TEXT, sha256 TEXT);");
        source.prepare('INSERT INTO students(id,student_number,normalized_student_number) VALUES(?,?,?)')
            .run('synthetic-recovery-student', 'RECOVERY-SYNTHETIC', 'RECOVERY-SYNTHETIC');
        const objects = [
            { bucket: 'DOCS', key: 'synthetic-document.pdf', bytes: Buffer.from('Synthetic document bytes, no student data.') },
            { bucket: 'PRINT', key: 'synthetic-print.pdf', bytes: Buffer.from('Synthetic print bytes; never submitted to an agent.') }
        ];
        for (const object of objects) source.prepare('INSERT INTO recovery_fixture_objects VALUES(?,?,?,?,?)')
            .run(object.key, 'synthetic-recovery-student', object.bucket, object.key, sha256(object.bytes));
        const schema = source.prepare(schemaQuery).all();
        const tables = schema.filter(item => item.type === 'table');
        const inserts = tables.flatMap(table => source.prepare(`SELECT * FROM ${identifier(table.name)}`).all().map(row =>
            `INSERT INTO ${identifier(table.name)}(${Object.keys(row).map(identifier).join(',')}) VALUES(${Object.values(row).map(literal).join(',')})`));
        const ddl = schema.filter(item => item.type === 'table').map(item => cleanSql(item.sql));
        const afterData = schema.filter(item => item.type !== 'table').map(item => cleanSql(item.sql));
        const sqlExport = [...ddl, ...inserts, ...afterData].join(';\n');
        need(Buffer.byteLength(sqlExport) > 0, 'RECOVERY_SYNTHETIC_EMPTY_SQL');
        const sqlRestored = new DatabaseSync(':memory:');
        try {
            sqlRestored.exec(`PRAGMA foreign_keys=OFF; ${sqlExport}; PRAGMA foreign_keys=ON;`);
            need(Object.values(sqlRestored.prepare('PRAGMA integrity_check').get())[0] === 'ok', 'RECOVERY_SYNTHETIC_SQL_INTEGRITY');
            need(sqlRestored.prepare('PRAGMA foreign_key_check').all().length === 0, 'RECOVERY_SYNTHETIC_FOREIGN_KEYS');
        } finally { sqlRestored.close(); }
        runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true, host: '127.0.0.1', port: 0,
            compatibilityDate: '2026-10-01',
            script: 'export default { async fetch(){ return fetch("https://recovery-egress-denied.invalid/"); } };',
            outboundService: () => new Response(null, { status: 403 }),
            d1Databases: ['RESTORED_DB'], r2Buckets: ['SOURCE_DOCS', 'SOURCE_PRINT', 'RESTORED_DOCS', 'RESTORED_PRINT'] }));
        const database = await runtime.getD1Database('RESTORED_DB');
        for (const sql of ddl) await database.exec(sql);
        await database.batch([database.prepare('PRAGMA defer_foreign_keys=ON'), ...inserts.map(sql => database.prepare(sql))]);
        for (const sql of afterData) await database.exec(sql);
        const restoredSchema = (await database.prepare(schemaQuery).all()).results;
        const normalizeSchema = rows => canonical(rows.map(row => ({ type: row.type, name: row.name, sql: cleanSql(row.sql) })));
        need(normalizeSchema(schema) === normalizeSchema(restoredSchema), 'RECOVERY_SYNTHETIC_SCHEMA_MISMATCH');
        for (const table of tables) {
            const rows = source.prepare(`SELECT * FROM ${identifier(table.name)}`).all();
            const restored = (await database.prepare(`SELECT * FROM ${identifier(table.name)}`).all()).results;
            need(canonical(rows.map(row => canonical(row)).sort()) === canonical(restored.map(row => canonical(row)).sort()), 'RECOVERY_SYNTHETIC_ROWS_MISMATCH');
        }
        need((await database.prepare('PRAGMA foreign_key_check').all()).results.length === 0, 'RECOVERY_SYNTHETIC_FOREIGN_KEYS');
        // D1 allows quick_check; full SQLite integrity_check was run on the SQL restore above.
        need(Object.values((await database.prepare('PRAGMA quick_check').first()))[0] === 'ok', 'RECOVERY_SYNTHETIC_SQL_INTEGRITY');
        const ledger = (await database.prepare('SELECT name FROM d1_migrations ORDER BY name').all()).results.map(row => row.name);
        need(canonical(ledger) === canonical(migrations), 'RECOVERY_SYNTHETIC_LEDGER');
        for (const object of objects) {
            const originalBucket = await runtime.getR2Bucket(`SOURCE_${object.bucket}`);
            const restoredBucket = await runtime.getR2Bucket(`RESTORED_${object.bucket}`);
            const options = { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { synthetic: 'true' } };
            await originalBucket.put(object.key, object.bytes, options);
            const original = await originalBucket.get(object.key);
            await restoredBucket.put(object.key, await original.arrayBuffer(), options);
            const checked = await verifyRestoredObject(await originalBucket.get(object.key), await restoredBucket.get(object.key));
            const reference = await database.prepare('SELECT sha256 FROM recovery_fixture_objects WHERE object_key=?').bind(object.key).first();
            need(reference?.sha256 === checked.sha256, 'RECOVERY_SYNTHETIC_REFERENCE_MISMATCH');
        }
        need((await runtime.dispatchFetch('http://localhost/')).status === 403, 'RECOVERY_SYNTHETIC_EGRESS_NOT_BLOCKED');
        return { environment: 'synthetic-local', eligible_for_production: false, migrations: ledger.length, tables: tables.length,
            objects: objects.length, sql_sha256: sha256(Buffer.from(sqlExport)), checks: 'local-only-complete' };
    } finally {
        source.close();
        await runtime?.dispose();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        need(process.argv.length === 2, 'RECOVERY_SYNTHETIC_REFUSES_INPUT');
        console.log(JSON.stringify(await runSyntheticRestore()));
    } catch {
        console.error('Synthetic recovery preparation failed; no production operation or evidence was created.');
        process.exitCode = 1;
    }
}
