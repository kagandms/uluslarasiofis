import { canonical, digest } from './evidence.mjs';

const need = ok => { if (!ok) throw new Error('RECOVERY_INVALID_CONTRACT_METADATA'); };
const sorted = items => [...items].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
const unique = items => { need(new Set(items.map(item => item.name)).size === items.length); return sorted(items); };

// Adapter for the approved maintenance metadata check. It accepts schema/metadata, never table rows or secret values.
// Worker and asset bytes must already have been verified against their immutable version IDs by the maintenance check.
export function contractFromMetadata(input) {
    need(input && Object.keys(input).sort().join('|') === ['assets', 'bindings', 'crons', 'migrations', 'schema', 'secrets', 'vars', 'worker'].join('|'));
    for (const field of ['worker', 'assets']) need(typeof input[field] === 'string' && /^[a-f0-9]{64}$/.test(input[field]));
    for (const field of ['schema', 'migrations', 'secrets', 'bindings', 'crons']) need(Array.isArray(input[field]) && input[field].length > 0);
    need(input.vars && typeof input.vars === 'object' && !Array.isArray(input.vars) && Object.values(input.vars).every(value => typeof value === 'string'));
    const schema = input.schema.map(item => {
        need(['table', 'index', 'trigger', 'view'].includes(item.type) && typeof item.name === 'string' && item.name.length > 0 && typeof item.sql === 'string' && item.sql.length > 0);
        return { type: item.type, name: item.name, sql: item.sql };
    });
    const migrations = input.migrations.map(item => {
        need(typeof item.name === 'string' && /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(item.name) && /^[a-f0-9]{64}$/.test(item.sha256));
        return { name: item.name, sha256: item.sha256 };
    });
    const secrets = input.secrets.map(item => {
        need(typeof item.name === 'string' && typeof item.type === 'string');
        return { name: item.name, type: item.type };
    });
    const bindings = input.bindings.map(item => {
        need(typeof item.name === 'string' && ['d1', 'r2_bucket', 'assets'].includes(item.type) && typeof item.id === 'string' && item.id.length > 0);
        return { name: item.name, type: item.type, id: item.id };
    });
    for (const [name, type] of [['DB', 'd1'], ['DOCUMENTS', 'r2_bucket'], ['PRINT_FILES', 'r2_bucket']]) {
        need(bindings.some(item => item.name === name && item.type === type));
    }
    need(input.crons.every(item => typeof item === 'string') && new Set(input.crons).size === input.crons.length);
    return { schema: digest(unique(schema)), migrations: digest(unique(migrations)), secrets: digest(unique(secrets)),
        bindings: digest(unique(bindings)), crons: digest([...input.crons].sort()), vars: digest(input.vars), worker: input.worker, assets: input.assets };
}
