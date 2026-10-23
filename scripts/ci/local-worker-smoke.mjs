import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';

// No existing .dev.vars, ignored local state or service credentials enter this copy.
const root = fileURLToPath(new URL('../../', import.meta.url));
for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'PRINTER_SECRET',
    'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY', 'SCANNER_SECRET']) {
    assert.ok(!process.env[name], `Local smoke refuses service credential: ${name}`);
}
const temporary = mkdtempSync(join(tmpdir(), 'office-ci-'));
const checkout = join(temporary, 'source');
let worker;
let workerLog = '';
const env = { ...process.env, XDG_CONFIG_HOME: join(temporary, 'config'),
    WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', CI: 'true' };
delete env.CLOUDFLARE_ENV;
const run = args => execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args],
    { cwd: checkout, env, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });

try {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const file of new Set(files)) {
        assert.ok(!file.split('/').some(part => part === '.env' || part.startsWith('.env.') || part === '.dev.vars' || part.startsWith('.dev.vars.'))
            || file.endsWith('.example'), 'Credential files must never be tracked/copied into CI');
        const target = resolve(checkout, file);
        assert.ok(target.startsWith(`${checkout}/`), 'Invalid tracked path');
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(root, file), target, { dereference: false });
    }
    symlinkSync(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
    const config = JSON.parse(readFileSync(join(checkout, 'wrangler.jsonc'), 'utf8'));
    assert.equal(config.name, 'uluslarasiofis-local');
    assert.equal(config.d1_databases.length, 1);
    assert.equal(config.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000000');
    assert.ok([...config.d1_databases, ...config.r2_buckets].every(binding => binding.remote === false));
    run(['d1', 'migrations', 'apply', 'uluslarasiofis-local', '--local']);
    const second = run(['d1', 'migrations', 'apply', 'uluslarasiofis-local', '--local']);
    assert.match(second, /No migrations to apply/i);
    const { readdirSync } = await import('node:fs');
    const expected = readdirSync(join(checkout, 'migrations')).filter(name => name.endsWith('.sql')).sort();
    const ledger = JSON.parse(run(['d1', 'execute', 'uluslarasiofis-local', '--local', '--json', '--command', 'SELECT name FROM d1_migrations ORDER BY name']));
    assert.deepEqual(ledger.flatMap(result => result.results.map(row => row.name)).sort(), expected);
    const integrity = JSON.parse(run(['d1', 'execute', 'uluslarasiofis-local', '--local', '--json', '--command', 'PRAGMA foreign_key_check']));
    assert.equal(integrity.flatMap(result => result.results).length, 0);
    console.log(`PASS: ${expected.length} migrations on empty local D1; second apply unchanged; foreign keys valid`);

    const listener = createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    worker = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => { workerLog = (workerLog + chunk).slice(-12_000); });
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
        assert.equal(worker.exitCode, null, 'Local Worker exited before readiness');
        try {
            const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
            if (response.status === 200) { ready = true; break; }
        } catch { /* Wait for local runtime, never switch to a remote endpoint. */ }
        await delay(500);
    }
    assert.ok(ready, 'Local Worker readiness timeout');
    for (const path of ['/', '/basvuru/', '/basvurum/', '/yetkili/', '/yazdir/', '/mobile-transfer/']) {
        const response = await fetch(base + path, { signal: AbortSignal.timeout(10_000) });
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get('content-type'), /text\/html/);
    }
    const headers = { Origin: base, 'Content-Type': 'application/json' };
    const post = (path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    let response = await post('/api/public/applications/tracking-lookup', { reference_number: 'ITU-7K9M-4X2P' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).found, false);
    assert.equal((await fetch(`${base}/api/public/applications/current`)).status, 401);
    response = await post('/api/public/applications', { student_number: `CI${Date.now()}`, application_type: 'initial', email: 'ci@example.invalid', phone: '+905321234567' });
    assert.equal(response.status, 201, 'Synthetic local draft');
    const created = await response.json();
    assert.equal(created.application?.status ?? created.status, 'draft');
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookie, 'Owner session required');
    response = await fetch(`${base}/api/public/applications/current`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const current = await response.json();
    assert.equal(current.application?.status ?? current.status, 'draft');
    console.log('PASS: six HTML pages, missing lookup, anonymous 401, synthetic draft 201 and owner reload 200');
} catch (error) {
    // Only the synthetic isolated runtime is logged. Never log API bodies/cookies.
    console.error(workerLog);
    throw error;
} finally {
    if (worker && worker.exitCode === null) {
        const exited = new Promise(resolve => worker.once('exit', resolve));
        worker.kill('SIGTERM');
        if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) { worker.kill('SIGKILL'); await exited; }
    }
    rmSync(temporary, { recursive: true, force: true });
}
