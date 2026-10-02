import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { TestD1Database } from './d1-test-binding.js';
import { applyAllMigrations } from './apply-migrations.js';
import { hashSessionToken } from '../../src/server/auth/sessionToken.js';
import worker from '../../src/server/worker.js';

function createBucket(objects) {
    function objectFor(key) {
        const stored = objects.get(key);
        if (!stored) return null;
        return { etag: createHash('sha256').update(stored.bytes).digest('hex'), size: stored.bytes.length,
            httpMetadata: { contentType: stored.mediaType }, body: new Response(stored.bytes).body,
            arrayBuffer: async () => stored.bytes.slice().buffer };
    }
    return {
        head: async (key) => objectFor(key),
        get: async (key, options) => {
            const object = objectFor(key);
            if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object?.etag) return null;
            return object;
        },
        delete: async (key) => objects.delete(key)
    };
}

export async function createRealScannerFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const environment = { DB: database, DOCUMENTS: createBucket(objects), APP_ENV: 'local',
        SCANNER_SECRET: randomBytes(32).toString('base64url'), STAFF_SHARED_USERNAME: 'synthetic-reviewer',
        R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET_NAME: 'synthetic-bucket',
        R2_ACCESS_KEY_ID: 'synthetic-key', R2_SECRET_ACCESS_KEY: 'synthetic-secret' };
    const token = randomBytes(32).toString('base64url');
    await database.prepare(`INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role)
        VALUES('staff','synthetic-reviewer','synthetic-reviewer','test-hash','Synthetic Reviewer','reviewer')`).run();
    await database.prepare('INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at) VALUES(?,?,?,?)')
        .bind(crypto.randomUUID(),'staff',await hashSessionToken(token),new Date(Date.now()+3600_000).toISOString()).run();
    return { database,objects,environment,staffCookie:`staff_session=${token}` };
}

export function portalRequest(context,path,options={}) {
    context.requestCount = (context.requestCount || 0) + 1;
    const headers = { Origin:'https://portal.test', 'CF-Connecting-IP':`198.51.100.${context.requestCount}`,  ...(options.cookie?{Cookie:options.cookie}:{}),
        ...(options.body?{'Content-Type':'application/json'}:{}) };
    return worker.fetch(new Request(`https://portal.test${path}`,{ method:options.method||'GET',headers,
        ...(options.body?{body:JSON.stringify(options.body)}:{}) }),context.environment);
}

export async function createSyntheticDraft(context) {
    const response = await portalRequest(context,'/api/public/applications',{method:'POST',body:{
        student_number:crypto.randomUUID().slice(0,12),application_type:'initial',email:'synthetic@example.invalid',phone:'+905551112233' }});
    assert.equal(response.status,201);
    const cookie=response.headers.get('Set-Cookie').split(';')[0];
    const application=context.database.prepare('SELECT id FROM applications ORDER BY rowid DESC LIMIT 1').first();
    return { cookie,applicationId:application.id };
}

export async function finalizeSyntheticFile({context,app,bytes,mediaType='application/pdf',replacement=false}) {
    const base='/api/public/applications/current/documents';
    const response=await portalRequest(context,`${base}/${replacement?'resubmission-upload-intent':'upload-intent'}`,{
        cookie:app.cookie,method:'POST',body:{code:'passport',filename:'synthetic-document',media_type:mediaType,byte_size:bytes.length}});
    assert.equal(response.status,201,await response.clone().text());
    const {upload}=await response.json();
    assert.equal(upload.required_headers['if-none-match'],'*');
    const storageKey=new URL(upload.url).pathname.split('/').slice(-2).join('/');
    context.objects.set(storageKey,{bytes:new Uint8Array(bytes),mediaType});
    const finalized=await portalRequest(context,`${base}/${replacement?'resubmission-finalize':'finalize'}`,{
        cookie:app.cookie,method:'POST',body:{intent_id:upload.intent_id}});
    assert.equal(finalized.status,200,await finalized.clone().text());
    const file=context.database.prepare('SELECT * FROM document_revision_files WHERE storage_key=?').bind(storageKey).first();
    const job=context.database.prepare('SELECT * FROM document_scan_jobs WHERE file_id=?').bind(file.id).first();
    assert.equal(file.scan_status,'pending');
    assert.equal(job.status,'queued');
    return {file,job};
}

export function advanceSyntheticQueueClock(context, jobId) {
    // Only test timing is advanced. Verdicts always come from the real runner.
    context.database.prepare("UPDATE document_scan_jobs SET available_at='2026-01-01T00:00:00.000Z' WHERE status='queued' AND id=?").bind(jobId).run();
}
