import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { hashSessionToken, createOpaqueSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';

class QueryDatabase extends TestD1Database {
    async batch(statements) {
        this.database.exec('BEGIN IMMEDIATE');
        try {
            const results = statements.map(statement => /^\s*SELECT/i.test(statement.sql)
                ? { results: statement.all().results, meta: { changes: 0 } } : statement.run());
            this.database.exec('COMMIT');
            return results;
        } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    }
}

/** Creates only synthetic private storage and staff sessions for portal tests. */
export async function createPortFixture(database = new QueryDatabase(), bucket) {
    if (!bucket) applyAllMigrations(database);
    const objects = new Map();
    const objectFor = key => {
        const object = objects.get(key);
        if (!object) return null;
        return { etag: createHash('sha256').update(object.bytes).digest('hex'), size: object.bytes.length,
            httpMetadata: object.options.httpMetadata, body: new Response(object.bytes).body,
            arrayBuffer: async () => object.bytes.slice().buffer };
    };
    const storage = bucket || {
        put: async (key, bytes, options) => { objects.set(key, { bytes: new Uint8Array(bytes), options }); },
        head: async key => objectFor(key),
        get: async (key, options) => { const object = objectFor(key); return options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object?.etag ? null : object; },
        delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); }
    };
    const cookieFor = async id => {
        const token = createOpaqueSessionToken();
        await database.prepare(`INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at,last_seen_at)
            VALUES(?, 'staff',?,?,?)`).bind(id, await hashSessionToken(token), new Date(Date.now()+3600_000).toISOString(), new Date().toISOString()).run();
        return `staff_session=${token}`;
    };
    await database.prepare(`INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role)
        VALUES('staff','synthetic','synthetic','synthetic-only','Synthetic','reviewer')`).run();
    return { database, objects, storage, staffCookie: await cookieFor('pc'), otherCookie: await cookieFor('other-pc'),
        environment: { DB: database, DOCUMENTS: storage, APP_ENV: 'production', PHYSICAL_INTAKE_MODE: 'on', STAFF_SHARED_USERNAME: 'synthetic', SCANNER_SECRET: 's'.repeat(43) } };
}

/** Calls the local Worker with synthetic authorization. */
export async function portRequest(context, path, options = {}) {
    return worker.fetch(new Request(`https://portal.test${path}`, { method: options.method || 'GET',
        headers: { Origin: 'https://portal.test', ...(options.cookie ? { Cookie: options.cookie } : {}),
            ...(options.json ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        body: options.json ? JSON.stringify(options.json) : options.body }), context.environment);
}

/** Claims a one-use QR token with an independent phone cookie. */
export async function pairPortPhone(context) {
    const created = await portRequest(context, '/api/staff/mobile-transfers', { method: 'POST', cookie: context.staffCookie });
    assert.equal(created.status, 200, await created.clone().text());
    const transfer = await created.json();
    const claimed = await portRequest(context, '/api/mobile-transfer/claim', { method: 'POST', json: { token: transfer.claimToken } });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const phone = await claimed.json();
    const approved = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}/approve`, { method: 'POST', cookie: context.staffCookie, json: { code: phone.pairingCode } });
    assert.equal(approved.status, 200, await approved.clone().text());
    return { ...transfer, phoneCookie: claimed.headers.get('Set-Cookie').split(';')[0] };
}

const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=', 'base64'));

export function uploadPhoto(context, transfer, options = {}) {
    return portRequest(context, `/api/mobile-transfer/${transfer.id}/photos`, { method: 'POST', cookie: transfer.phoneCookie,
        body: options.bytes || JPEG, headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Id': options.id || crypto.randomUUID(), ...options.headers } });
}

/** Exercises the unchanged scanner content/result wire contract with synthetic engine evidence. */
export async function scanPortFile(context, outcome = 'clean') {
    const machine = { Authorization: `Bearer ${context.environment.SCANNER_SECRET}` };
    const claimed = await portRequest(context, '/api/scanner/claim', { method: 'POST', json: { runner_id: 'synthetic-runner' }, headers: machine });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const { job } = await claimed.json();
    assert.ok(job);
    const headers = { ...machine, 'X-Scan-Lease': job.lease_token };
    const content = await portRequest(context, `/api/scanner/jobs/${job.id}/content`, { headers });
    assert.equal(content.status, 200, await content.clone().text());
    const bytes = new Uint8Array(await content.arrayBuffer());
    const result = { file_id: job.file_id, revision_id: job.revision_id, storage_key: job.storage_key, byte_size: job.byte_size,
        object_etag: content.headers.get('X-Object-ETag'), sha256: content.headers.get('X-Content-SHA256'), outcome,
        result_code: outcome === 'clean' ? 'scanned' : 'malware', engine_version: 'synthetic', signature_version: 'synthetic',
        signature_updated_at: new Date().toISOString(), scanned_at: new Date().toISOString(), full_scan: true, policy_version: 'clamav-full-v1' };
    const response = await portRequest(context, `/api/scanner/jobs/${job.id}/result`, { method: 'POST', headers, json: result });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await portRequest(context, `/api/scanner/jobs/${job.id}/result`, { method: 'POST', headers, json: result })).status, 409);
    return { job, bytes };
}

/** Creates a valid synthetic PDF registration request. */
export async function registerPortPdf(context, id = crypto.randomUUID(), options = {}) {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const bytes = options.bytes || await pdf.save();
    const form = new FormData();
    form.set('metadata', JSON.stringify({student_number:'',first_name:'Synthetic',last_name:'Student',passport_number:'TEST',application_type:'initial'}));
    form.set('pdf', new Blob([bytes], {type:'application/pdf'}), 'synthetic.pdf');
    const response = await portRequest(context, '/api/staff/physical-intakes/register', {method:'POST',cookie:context.staffCookie,body:form,headers:{'X-Registration-Id':id}});
    assert.equal(response.status, 200, await response.clone().text());
    return { id, detail:await response.json(), bytes };
}
