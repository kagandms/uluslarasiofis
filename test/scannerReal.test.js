import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,readFile,writeFile,chmod,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:https';
import { JSDOM } from 'jsdom';
import { ZipReader,BlobReader,Uint8ArrayWriter } from '@zip.js/zip.js';
import worker from '../src/server/worker.js';
import { downloadApplicationArchive } from '../src/staff/applicationArchive.js';
import { createRealScannerFixture,portalRequest,createSyntheticDraft,finalizeSyntheticFile,advanceSyntheticQueueClock,submitSyntheticApplication } from './helpers/scanner-real-fixture.js';

const runCommand=promisify(execFile);
const SHOULD_RUN=process.env.RUN_REAL_CLAMAV==='1';
const SCANNER_STATE=process.env.SCANNER_REAL_STATE;

async function createHarness(context,directory) {
    await runCommand('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),
        '-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1']);
    const server=createServer({key:await readFile(join(directory,'key.pem')),cert:await readFile(join(directory,'cert.pem'))},async(request,response)=>{
        try {
            const parts=[];
            for await (const chunk of request) parts.push(chunk);
            const body=Buffer.concat(parts);
            recordScannerResult(context,request,body);
            const result=await worker.fetch(new Request(`https://localhost${request.url}`,{method:request.method,headers:request.headers,
                ...(request.method==='GET'?{}:{body})}),context.environment);
            response.writeHead(result.status,Object.fromEntries(result.headers));
            response.end(Buffer.from(await result.arrayBuffer()));
        } catch { response.writeHead(500);response.end('synthetic harness failed'); }
    });
    await new Promise((ready)=>server.listen(0,'127.0.0.1',ready));
    await writeFile(join(directory,'secret'),context.environment.SCANNER_SECRET,{mode:0o600});
    return {server,origin:`https://127.0.0.1:${server.address().port}`,directory};
}

function recordScannerResult(context, request, body) {
    const match=request.url.match(/^\/api\/scanner\/jobs\/([^/]+)\/result$/);
    if (!match) return;
    context.scannerResults ??= new Map();
    context.scannerResults.set(match[1],{body:JSON.parse(body.toString()),lease:request.headers['x-scan-lease']});
}

async function startSyntheticReview(context, app) {
    const detail=await portalRequest(context,`/api/staff/applications/${app.applicationId}`,{cookie:context.staffCookie});
    const {application}=await detail.json();
    const started=await portalRequest(context,`/api/staff/applications/${app.applicationId}/status`,{
        cookie:context.staffCookie,method:'POST',body:{target_status:'under_review',expected_updated_at:application.updated_at}});
    assert.equal(started.status,200);
}

async function replaceFromSecondOwner(context, app, bytes) {
    const access=await portalRequest(context,'/api/public/applications/access',{method:'POST',body:{
        reference_number:app.reference,access_code:app.code}});
    assert.equal(access.status,200);
    const second={...app,cookie:access.headers.get('Set-Cookie').split(';')[0]};
    assert.notEqual(second.cookie,app.cookie);
    const denied=await portalRequest(context,'/api/public/applications/current/documents/resubmission-upload-intent',{
        cookie:second.cookie,method:'POST',body:{code:'student_certificate',filename:'synthetic',media_type:'application/pdf',byte_size:bytes.length}});
    assert.equal(denied.status,409);
    return finalizeSyntheticFile({context,app:second,bytes,replacement:true});
}

async function denyOldScannerResult(context, job) {
    const previous=context.scannerResults.get(job.id);
    const replay=await portalRequest(context,`/api/scanner/jobs/${job.id}/result`,{method:'POST',
        headers:{Authorization:`Bearer ${context.environment.SCANNER_SECRET}`,'X-Scan-Lease':previous.lease},
        body:{...previous.body,outcome:'clean',result_code:'scanned',full_scan:true}});
    assert.equal(replay.status,409);
}

async function proveInitialScanRecovery(context,harness,options) {
    const fixtures=options.fixtures;
    const app=await createSyntheticDraft(context);
    const bytes=await readFile(join(fixtures,'clean.pdf'));
    const initial=await finalizeSyntheticFile({context,app,bytes:await readFile(join(fixtures,options.fixture)),mediaType:options.mediaType});
    await submitSyntheticApplication(context,app,bytes);
    for (let attempt=0;attempt<options.attempts;attempt+=1) {
        advanceSyntheticQueueClock(context,initial.job.id);
        assert.match(await runRunner(harness),new RegExp(`outcome=${options.outcome}`));
    }
    assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?').bind(initial.file.id).first().scan_status,options.outcome);
    await startSyntheticReview(context,app);
    await checkDenied(context,app);
    assert.equal((await portalRequest(context,`/api/staff/applications/${app.applicationId}/documents/passport/request-resubmission`,{
        cookie:context.staffCookie,method:'POST',body:{expected_revision_number:1,reason:'Synthetic initial scan recovery'}})).status,200);
    const replacement=await replaceFromSecondOwner(context,app,bytes);
    assert.notEqual(replacement.job.id,initial.job.id);
    await denyOldScannerResult(context,initial.job);
    assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?').bind(replacement.file.id).first().scan_status,'pending');
    advanceSyntheticQueueClock(context,replacement.job.id);
    assert.match(await runRunner(harness),/outcome=clean/);
    await checkRecoveredDocumentAccess(context,app,bytes);
    assert.equal((await portalRequest(context,`/api/staff/applications/${app.applicationId}/documents/passport/approve`,{
        cookie:context.staffCookie,method:'POST',body:{expected_revision_number:2}})).status,200);
    assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?').bind(initial.file.id).first().scan_status,options.outcome);
}

async function checkRecoveredDocumentAccess(context, app, bytes) {
    const base=`/api/staff/applications/${app.applicationId}/documents`;
    assert.equal((await portalRequest(context,`${base}/passport/preview`,{
        cookie:context.staffCookie,method:'POST',body:{}})).status,200);
    const downloaded=await portalRequest(context,`${base}/passport/download`,{cookie:context.staffCookie});
    assert.equal(downloaded.status,200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
    // Other required initial files are still pending, so the whole-application ZIP stays blocked.
    assert.equal((await portalRequest(context,`${base}/archive-manifest`,{
        cookie:context.staffCookie,method:'POST',body:{}})).status,404);
}

async function runRunner(harness,overrides={}) {
    const result=await runCommand(join(SCANNER_STATE,'venv/bin/python'),['scripts/scanner/runner.py','--once'],{
        timeout:180_000,env:{...process.env,SCANNER_ORIGIN:harness.origin,SCANNER_RUNNER_ID:'synthetic-macbook',
            SCANNER_SECRET_FILE:join(harness.directory,'secret'),SCANNER_STATE_DIR:SCANNER_STATE,
            SCANNER_DATABASE_DIR:join(SCANNER_STATE,'signatures'),SCANNER_CERTS_DIR:'/opt/homebrew/etc/clamav/certs',
            SCANNER_CLAMSCAN:'/opt/homebrew/bin/clamscan',SCANNER_CA_FILE:join(harness.directory,'cert.pem'),...overrides}});
    return result.stderr;
}

async function checkDenied(context,app) {
    const base=`/api/staff/applications/${app.applicationId}/documents`;
    assert.equal((await portalRequest(context,`${base}/passport/download`,{cookie:context.staffCookie})).status,404);
    assert.equal((await portalRequest(context,`${base}/passport/preview`,{cookie:context.staffCookie,method:'POST',body:{}})).status,404);
    assert.equal((await portalRequest(context,`${base}/passport/approve`,{cookie:context.staffCookie,method:'POST',body:{expected_revision_number:1}})).status,409);
    assert.equal((await portalRequest(context,`${base}/archive-manifest`,{cookie:context.staffCookie,method:'POST',body:{}})).status,404);
}

async function checkCleanAccess(context,app,bytes) {
    const base=`/api/staff/applications/${app.applicationId}/documents`;
    const options={cookie:context.staffCookie,method:'POST',body:{}};
    assert.equal((await portalRequest(context,`${base}/passport/preview`,options)).status,200);
    const download=await portalRequest(context,`${base}/passport/download`,{cookie:context.staffCookie});
    assert.equal(download.status,200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
    const response=await portalRequest(context,`${base}/archive-manifest`,options);
    assert.equal(response.status,200);
    const manifest=await response.json();
    await checkZip(context,app,manifest,bytes);
}

async function checkZip(context,app,manifest,bytes) {
    const window=new JSDOM('<body></body>').window;
    let savedBlob;
    window.URL.createObjectURL=(blob)=>{savedBlob=blob;return 'blob:synthetic-zip';};
    window.URL.revokeObjectURL=()=>{};
    window.HTMLAnchorElement.prototype.click=()=>{};
    await downloadApplicationArchive({applicationId:app.applicationId,window,manifest,
        fetchFile:(_id,file)=>portalRequest(context,`/api/staff/applications/${app.applicationId}/documents/${file.code}/archive-file?revision=${file.expected_revision_number}&identity=${file.object_identity}`,{cookie:context.staffCookie})});
    const reader=new ZipReader(new BlobReader(savedBlob));
    const entries=await reader.getEntries();
    assert.equal(entries.length,1);
    assert.deepEqual(Buffer.from(await entries[0].getData(new Uint8ArrayWriter())),bytes);
    await reader.close();
    window.close();
}

async function proveReplacement(context,harness,app,bytes) {
    const path=`/api/staff/applications/${app.applicationId}/documents/passport`;
    const requested=await portalRequest(context,`${path}/request-resubmission`,{cookie:context.staffCookie,method:'POST',
        body:{expected_revision_number:1,reason:'Synthetic replacement acceptance'}});
    assert.equal(requested.status,200,await requested.clone().text());
    const {file,job}=await finalizeSyntheticFile({context,app,bytes,replacement:true});
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM document_scan_jobs').first().count,2);
    advanceSyntheticQueueClock(context,job.id);
    assert.match(await runRunner(harness),/outcome=clean/);
    assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?').bind(file.id).first().scan_status,'clean');
    assert.equal(context.database.prepare('SELECT status FROM document_scan_jobs WHERE id=?').bind(job.id).first().status,'complete');
    const approved=await portalRequest(context,`${path}/approve`,{cookie:context.staffCookie,method:'POST',body:{expected_revision_number:2}});
    assert.equal(approved.status,200,await approved.clone().text());
    await checkCleanAccess(context,app,bytes);
}

async function proveCleanAndReplacement(context,harness,fixtures) {
    const app=await createSyntheticDraft(context);
    const bytes=await readFile(join(fixtures,'clean.pdf'));
    const {file,job}=await finalizeSyntheticFile({context,app,bytes});
    context.database.prepare("UPDATE applications SET status='under_review' WHERE id=?").bind(app.applicationId).run();
    await checkDenied(context,app);
    // A stopped runner cannot lose the durable job; restart below uses the same row.
    assert.equal(context.database.prepare('SELECT status FROM document_scan_jobs').first().status,'queued');
    advanceSyntheticQueueClock(context,job.id);
    assert.match(await runRunner(harness),/outcome=clean/);
    assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?').bind(file.id).first().scan_status,'clean');
    await checkCleanAccess(context,app,bytes);
    await proveReplacement(context,harness,app,bytes);
}

async function proveUnsafeAndErrors(context,harness,fixtures) {
    for (const [name,mediaType,expected] of [['eicar.png','image/png','unsafe'],['encrypted.pdf','application/pdf','failed'],['broken.png','image/png','failed']]) {
        const app=await createSyntheticDraft(context);
        const {file,job}=await finalizeSyntheticFile({context,app,bytes:await readFile(join(fixtures,name)),mediaType});
        context.database.prepare("UPDATE applications SET status='under_review' WHERE id=?").bind(app.applicationId).run();
        advanceSyntheticQueueClock(context,job.id);
        await runRunner(harness);
        const outcome=context.database.prepare('SELECT outcome,result_code FROM document_scan_jobs WHERE file_id=?').bind(file.id).first();
        assert.equal(outcome.outcome,expected,name);
        await checkDenied(context,app);
        // Isolate the next acceptance scenario from this one's delayed retries.
        context.database.prepare("UPDATE document_scan_jobs SET available_at='2999-01-01T00:00:00.000Z' WHERE file_id=? AND status='queued'").bind(file.id).run();
    }
}

async function proveAcceptedImages(context,harness,fixtures) {
    for (const [name,mediaType] of [['clean.png','image/png'],['clean.jpg','image/jpeg'],['clean.webp','image/webp']]) {
        const app=await createSyntheticDraft(context);
        const {file,job}=await finalizeSyntheticFile({context,app,bytes:await readFile(join(fixtures,name)),mediaType});
        context.database.prepare("UPDATE document_scan_jobs SET available_at='2026-01-01T00:00:00.000Z' WHERE file_id=?").bind(file.id).run();
        assert.match(await runRunner(harness),/outcome=clean/);
        assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?').bind(file.id).first().scan_status,'clean',name);
    }
}

async function proveEngineOutageAndTimeout(context,harness,fixtures) {
    const bytes=await readFile(join(fixtures,'clean.pdf'));
    const app=await createSyntheticDraft(context);
    const queued=await finalizeSyntheticFile({context,app,bytes});
    advanceSyntheticQueueClock(context,queued.job.id);
    await runRunner(harness,{SCANNER_CLAMSCAN:'/missing/real-engine'});
    assert.equal(context.database.prepare('SELECT status FROM document_scan_jobs WHERE id=?').bind(queued.job.id).first().status,'queued');
    assert.equal(context.database.prepare('SELECT health FROM scanner_heartbeats').first().health,'engine_unavailable');
    assert.match(await runRunner(harness),/outcome=clean/);
    const timeoutApp=await createSyntheticDraft(context);
    const timed=await finalizeSyntheticFile({context,app:timeoutApp,bytes});
    context.database.prepare("UPDATE applications SET status='under_review' WHERE id=?").bind(timeoutApp.applicationId).run();
    for(let attempt=0;attempt<3;attempt+=1) {
        advanceSyntheticQueueClock(context,timed.job.id);
        assert.match(await runRunner(harness,{SCANNER_SCAN_TIMEOUT_SECONDS:'1'}),/code=scan_timeout/);
    }
    assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?').bind(timed.file.id).first().scan_status,'failed');
    await checkDenied(context,timeoutApp);
}

test('real MacBook ClamAV scans via HTTPS job protocol and preserves staff/review/ZIP/replacement gates', {skip:!SHOULD_RUN,timeout:240_000},async(testContext)=>{
    assert.ok(SCANNER_STATE,'SCANNER_REAL_STATE is required');
    const directory=await mkdtemp(join(tmpdir(),'scanner-real-'));
    await chmod(directory,0o700);
    const context=await createRealScannerFixture();
    let harness;
    try {
        harness=await createHarness(context,directory);
        const fixtures=join(directory,'fixtures');
        await runCommand(join(SCANNER_STATE,'venv/bin/python'),['scripts/scanner/create_fixtures.py',fixtures]);
        await proveCleanAndReplacement(context,harness,fixtures);
        await proveUnsafeAndErrors(context,harness,fixtures);
        await proveAcceptedImages(context,harness,fixtures);
        await proveEngineOutageAndTimeout(context,harness,fixtures);
        await proveInitialScanRecovery(context,harness,{fixtures,fixture:'eicar.png',mediaType:'image/png',outcome:'unsafe',attempts:1});
        await proveInitialScanRecovery(context,harness,{fixtures,fixture:'encrypted.pdf',mediaType:'application/pdf',outcome:'failed',attempts:3});
        assert.equal((await readdir(join(SCANNER_STATE,'tmp'))).filter((name)=>name.startsWith('job-')).length,0);
        assert.equal(context.database.prepare("SELECT count(*) AS count FROM document_scan_jobs WHERE outcome='clean'").first().count,8);
        testContext.diagnostic('Real HTTPS + MacBook ClamAV: clean PDF/PNG/JPEG/WebP, EICAR unsafe, encrypted/broken non-clean, replacement, restart and real engine timeout.');
        testContext.diagnostic('Initial submitted unsafe/terminal failed → staff reason → distinct owner → requested revision 2/current pending/new job → real clean → access/approval; old verdict preserved and old lease/result denied. Other required submit fixtures remain pending.');
        testContext.diagnostic(JSON.stringify(context.database.prepare('SELECT status,attempts,outcome,result_code,engine_version,signature_version,signature_updated_at,scanned_at FROM document_scan_jobs ORDER BY rowid').all().results));
    } finally {
        if(harness) await new Promise((done)=>harness.server.close(done));
        context.database.database.close();
        await rm(directory,{recursive:true,force:true});
    }
});
