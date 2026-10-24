// Transport permits code/assets publication and the separately gated cron-only operation. No retries, settings PATCH, SQL, or R2 API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { assertUploadHead } from './worker-version.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Reuse the hash implementation already locked with Wrangler; no additional dependency.
const { hash } = createRequire(require.resolve('wrangler/package.json'))('blake3-wasm');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.zip': 'application/zip', '.ttf': 'font/ttf',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function cloudflareClient(account, token, fetchImpl = fetch) {
    assert.match(account || '', /^[a-f0-9]{32}$/); assert.ok(token);
    return async (path, options = {}, credential = token) => {
        const read = /^\/workers\/scripts\/goc\/(?:settings|deployments|schedules|versions|versions\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.test(path);
        const write = /^\/workers\/scripts\/goc\/(?:assets-upload-session|versions\?bindings_inherit=strict|deployments)$/.test(path)
            || path === '/workers/assets/upload?base64=true' || /^\/workers\/assets\/upload\/[a-f0-9]{32}$/.test(path);
        assert.ok((!options.method || options.method === 'GET') ? read
            : options.method === 'POST' && write || options.method === 'PUT' && path === '/workers/scripts/goc/schedules',
        'Only reviewed goc metadata reads, code/assets publication, and the protected cron endpoint are allowed.');
        let response, body;
        try {
            response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
                ...options, headers: { ...options.headers, authorization: `Bearer ${credential}` },
                redirect: 'error', signal: AbortSignal.timeout(120_000)
            });
            body = await response.json();
        } catch { throw new Error('Cloudflare request failed or outcome uncertain; no automatic retry.'); }
        if (!response.ok || body.success !== true) {
            const codes = (body.errors || []).map(e => e.code).filter(Number.isInteger).join(',');
            throw new Error(`Cloudflare request denied/failed (HTTP ${response.status}, codes ${codes}); check request compatibility and account-scoped permissions. No retry.`);
        }
        return body.result;
    };
}

export async function readPreparedBundle(bytes, root) {
    const boundary = bytes.subarray(0, bytes.indexOf('\r\n')).toString().slice(2);
    assert.match(boundary, /^[\w-]+$/);
    const form = await new Response(bytes, { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }).formData();
    const metadata = JSON.parse(form.get('metadata'));
    assert.equal(metadata.main_module, 'index.js');
    assert.ok(!metadata.migrations && !metadata.exports && !metadata.containers && !metadata.assets);
    let modules = 0;
    for (const [name, file] of form) {
        if (name === 'metadata') continue;
        assert.ok(!name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\'));
        const original = readFileSync(join(root, 'dist/uluslarasiofis_local', name));
        // Wrangler rewrites source-map source paths even with --no-bundle. Upload the tested map bytes.
        if (name.endsWith('.map')) form.set(name, new Blob([original], { type: file.type }), name);
        assert.equal(digest(Buffer.from(await form.get(name).arrayBuffer())), digest(original),
            'Prepared Worker module differs from the tested artifact.');
        modules++;
    }
    assert.ok(modules > 0 && form.has('index.js'));
    assert.equal([...form.keys()].length, new Set(form.keys()).size, 'Duplicate upload parts are forbidden.');
    return { form, metadata };
}

export function assetPlan(root) {
    const tested = JSON.parse(readFileSync(join(root, 'candidate-artifact.json'), 'utf8'));
    // Keep the existing build's ignore semantics narrow; new patterns need review.
    assert.equal(readFileSync(join(root, 'dist/client/.assetsignore'), 'utf8').trim(), 'wrangler.json\n.dev.vars');
    const manifest = {}, byHash = new Map();
    for (const entry of tested.files.filter(f => f.path.startsWith('client/') && f.path !== 'client/.assetsignore')) {
        const name = entry.path.slice('client/'.length);
        assert.ok(!name.split('/').some(p => p.startsWith('.')));
        const bytes = readFileSync(join(root, 'dist', entry.path));
        assert.equal(bytes.length, entry.bytes); assert.equal(digest(bytes), entry.sha256);
        assert.ok(!['/wrangler.json', '/.dev.vars', '/_headers', '/_redirects', '/_worker.js'].includes(`/${name}`), 'Unexpected asset control file requires review.');
        const extension = extname(name);
        const contentHash = hash(bytes.toString('base64') + extension.slice(1)).toString('hex').slice(0, 32);
        manifest[`/${name}`] = { hash: contentHash, size: bytes.length };
        byHash.set(contentHash, { bytes, type: types[extension] || 'application/octet-stream' });
    }
    assert.ok(byHash.size > 0);
    return { manifest, byHash };
}

export async function uploadAssets(plan, api) {
    const session = await api('/workers/scripts/goc/assets-upload-session', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest: plan.manifest })
    });
    assert.ok(typeof session.jwt === 'string' && Array.isArray(session.buckets));
    let completion = session.buckets.length === 0 ? session.jwt : null;
    let single = false;
    try { single = JSON.parse(Buffer.from(session.jwt.split('.')[1], 'base64url').toString()).wrangler_single_asset_uploads === true; } catch { /* Legacy bulk-upload protocol. */ }
    const buckets = single ? session.buckets.flat().map(hash => [hash]) : session.buckets;
    const requested = new Set();
    for (const bucket of buckets) {
        const form = new FormData();
        assert.ok(Array.isArray(bucket) && bucket.length > 0);
        for (const hash of bucket) {
            assert.ok(plan.byHash.has(hash) && !requested.has(hash), 'Unexpected/duplicate asset requested.');
            requested.add(hash);
            const { bytes, type } = plan.byHash.get(hash);
            form.append(hash, new Blob([bytes.toString('base64')], { type }), hash);
        }
        const file = plan.byHash.get(bucket[0]);
        const result = single
            ? await api(`/workers/assets/upload/${bucket[0]}`, { method: 'POST', headers: { 'content-type': file.type }, body: file.bytes }, session.jwt)
            : await api('/workers/assets/upload?base64=true', { method: 'POST', body: form }, session.jwt);
        if (result.jwt) completion = result.jwt;
    }
    assert.ok(completion, 'Asset upload did not return a completion token.');
    return completion; // Memory only: never print or persist provider tokens.
}

export function inheritWorkerMetadata(metadata, settings, sha, assetsJwt, activeVersion) {
    assert.match(activeVersion || '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    assert.equal(settings.compatibility_date, metadata.compatibility_date, 'Live compatibility date drift; separate configuration approval required.');
    assert.deepEqual(settings.compatibility_flags || [], metadata.compatibility_flags || []);
    const bindings = settings.bindings || [];
    assert.equal(bindings.filter(b => b.type === 'assets' && b.name === 'ASSETS').length, 1);
    // This API accepts only latest. publishPrepared verifies latest equals the approved active version.
    // Inherit by name, including secrets; no secret value is fetched or supplied.
    const result = { main_module: metadata.main_module, compatibility_date: settings.compatibility_date,
        compatibility_flags: settings.compatibility_flags || [],
        bindings: bindings.map(b => b.name === 'ASSETS' ? { name: 'ASSETS', type: 'assets' } : { name: b.name, type: 'inherit', version_id: 'latest' }),
        annotations: { 'workers/message': `release:${sha}` },
        assets: { jwt: assetsJwt, config: { not_found_handling: '404-page' } } };
    // Versioned settings are copied unchanged. Non-versioned settings/routes/cron are never written.
    for (const key of ['placement', 'limits', 'cache_options', 'usage_model']) if (settings[key] !== undefined) result[key] = settings[key];
    return result;
}

export async function publishPrepared({ bundle, plan, settings, sha, activeVersion, api, beforeActivation }) {
    await assertUploadHead(api, activeVersion); // Before any staging write.
    const jwt = await uploadAssets(plan, api);
    bundle.form.set('metadata', JSON.stringify(inheritWorkerMetadata(bundle.metadata, settings, sha, jwt, activeVersion)));
    await assertUploadHead(api, activeVersion); // Asset upload can take time: recheck immediately before inheritance.
    const version = await api('/workers/scripts/goc/versions?bindings_inherit=strict', { method: 'POST', body: bundle.form });
    assert.match(version.id || '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    console.log(`Candidate staged for goc: version ${version.id}, source ${sha}; activation not yet confirmed.`);
    await beforeActivation(version.id); // Recheck source, artifact and live version after staging.
    await assertUploadHead(api, activeVersion, version.id); // Our own candidate must now be latest.
    await api('/workers/scripts/goc/deployments', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: version.id, percentage: 100 }],
            annotations: { 'workers/message': `release:${sha}` } }) });
    return version.id; // Exactly one activation request. Any error stops; never rolls back or retries.
}
