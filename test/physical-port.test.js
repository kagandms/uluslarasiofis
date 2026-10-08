import { requireSingleJpegContainer } from '../src/server/domain/jpeg-container-policy.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupMobileTransfers } from '../src/server/routes/mobile-transfer-routes.js';
import { listPhysicalTransitions, validatePhysicalIntake } from '../src/server/domain/physical-intake-policy.js';
import { validatePhysicalPdf } from '../src/server/routes/physical-pdf-routes.js';
import { createPortFixture, pairPortPhone, portRequest, uploadPhoto, registerPortPdf } from './physical-port-fixtures.js';
test('QR claims are single-use and bound to the creating PC session', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);

    const replay = await portRequest(context, '/api/mobile-transfer/claim', { method: 'POST', json: { token: transfer.claimToken } });
    const other = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}`, { cookie: context.otherCookie });

    assert.equal(replay.status, 410);
    assert.equal(other.status, 410);
});

test('validated phone photos reach only the owning PC without a scanner job', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    const id = crypto.randomUUID();
    const base = `/api/staff/mobile-transfers/${transfer.id}`;

    assert.equal((await uploadPhoto(context, transfer, { id })).status, 200);
    const owner = await portRequest(context, `${base}/files/${id}`, { cookie: context.staffCookie });
    const other = await portRequest(context, `${base}/files/${id}`, { cookie: context.otherCookie });

    assert.equal(owner.status, 200);
    assert.deepEqual(new Uint8Array(await owner.arrayBuffer()), context.objects.values().next().value.bytes);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM document_scan_jobs').first()).total, 0);
    assert.equal(other.status, 410);
    assert.equal((await portRequest(context, `${base}/files/${id}`)).status, 401);
});

test('logout, staff deactivation, idle timeout and transfer expiry revoke the phone too', async () => {
    for (const state of ['logout','inactive','idle','expired']) {
        const context = await createPortFixture();
        const transfer = await pairPortPhone(context);
        if (state === 'logout') await context.database.prepare("UPDATE staff_sessions SET revoked_at=? WHERE id='pc'").bind(new Date().toISOString()).run();
        if (state === 'inactive') await context.database.prepare('UPDATE staff_users SET is_active=0').run();
        if (state === 'idle') await context.database.prepare("UPDATE staff_sessions SET last_seen_at='2000-01-01T00:00:00Z' WHERE id='pc'").run();
        if (state === 'expired') await context.database.prepare('UPDATE mobile_document_transfers SET expires_at=0').run();

        const upload = await uploadPhoto(context, transfer);

        assert.equal(upload.status, 410, state);
        assert.equal(context.objects.size, 0);
    }
});

test('revoked or expired PC cannot be claimed via an unused QR', async () => {
    const context = await createPortFixture();
    const response = await portRequest(context, '/api/staff/mobile-transfers', { method:'POST', cookie: context.staffCookie });
    const transfer = await response.json();
    await context.database.prepare("UPDATE staff_sessions SET revoked_at=? WHERE id='pc'").bind(new Date().toISOString()).run();

    const claim = await portRequest(context, '/api/mobile-transfer/claim', { method:'POST', json:{token:transfer.claimToken} });

    assert.equal(claim.status, 410);
});

test('duplicate simultaneous uploads never overwrite or delete the winning object', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    const id = crypto.randomUUID();

    const results = await Promise.all([uploadPhoto(context, transfer, { id }), uploadPhoto(context, transfer, { id })]);
    const replay = await uploadPhoto(context, transfer, { id });

    assert.ok(results.some(response => response.status === 200));
    assert.ok(results.every(response => [200,409].includes(response.status)));
    assert.equal(replay.status, 200);
    assert.equal(context.objects.size, 1);
    assert.equal((await context.database.prepare('SELECT file_count FROM mobile_document_transfers').first()).file_count, 1);
});

test('consumed photo IDs remain idempotent and cannot reappear on retry', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    const id = crypto.randomUUID();
    await uploadPhoto(context, transfer, { id });

    const consumed = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}/files/${id}`, { method:'DELETE', cookie:context.staffCookie });
    const replay = await uploadPhoto(context, transfer, { id });
    const list = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}`, { cookie:context.staffCookie });

    assert.equal(consumed.status, 200);
    assert.equal(replay.status, 200);
    assert.deepEqual((await list.json()).files, []);
    assert.equal(context.objects.size, 0);
});

test('rejects forged MIME, malformed JPEG, oversize payloads and cross-origin uploads', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);

    const invalid = await uploadPhoto(context, transfer, { bytes:new Uint8Array([255,216,255,217]) });
    const mime = await uploadPhoto(context, transfer, { headers:{'Content-Type':'text/html'} });
    const large = await uploadPhoto(context, transfer, { bytes:new Uint8Array(8*1024*1024+1) });
    const origin = await uploadPhoto(context, transfer, { headers:{Origin:'https://other.test'} });

    assert.deepEqual([invalid.status,mime.status,large.status,origin.status], [415,415,413,403]);
    assert.equal(context.objects.size, 0);
});

test('upload and claim rate limits are enforced by atomic database counters', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    await context.database.prepare('UPDATE mobile_transfer_rate_limits SET attempts=20').run();

    const response = await portRequest(context, '/api/mobile-transfer/claim', { method:'POST', json:{token:transfer.claimToken} });

    assert.equal(response.status, 429);
});

test('file quotas and simultaneous PC transfer quotas are enforced', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    await context.database.prepare('UPDATE mobile_document_transfers SET file_count=30').run();

    const denied = await uploadPhoto(context, transfer);
    const results = await Promise.all(Array.from({length:6}, () => portRequest(context, '/api/staff/mobile-transfers', {method:'POST',cookie:context.staffCookie})));

    assert.equal(denied.status, 409);
    assert.equal(results.filter(response => response.status===200).length, 4);
    assert.equal(results.filter(response => response.status===429).length, 2);
});

test('expiry cleanup removes temporary objects while preserving online documents', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    await uploadPhoto(context, transfer);
    context.objects.set('online/keep.pdf', { bytes:new Uint8Array([1]), options:{} });
    await context.database.prepare('UPDATE mobile_document_transfers SET expires_at=0').run();

    await cleanupMobileTransfers(context.environment);

    assert.equal(context.objects.size, 1);
    assert.ok(context.objects.has('online/keep.pdf'));
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM mobile_document_transfers').first()).total, 0);
});

test('physical registration and approval work without a verdict and never change online records', async () => {
    const context = await createPortFixture();
    await context.database.exec("INSERT INTO students(id,student_number,normalized_student_number) VALUES('student','ONLINE','ONLINE'); INSERT INTO applications(id,student_id,application_type,status) VALUES('online','student','initial','under_review');");
    const receipt = await registerPortPdf(context);
    const base = `/api/staff/physical-intakes/${receipt.id}`;

    const approved = await portRequest(context, `${base}/status`, {method:'PATCH',cookie:context.staffCookie,json:{lock_version:1,status:'approved_for_processing'}});
    const opened = await portRequest(context, `${base}/files/${receipt.id}/download`, {cookie:context.staffCookie});

    assert.equal(approved.status,200);
    assert.equal(opened.status,200);
    assert.deepEqual(new Uint8Array(await opened.arrayBuffer()),receipt.bytes);
    assert.equal((await context.database.prepare('SELECT scan_status FROM physical_intake_files').first()).scan_status,'pending');
    assert.equal((await context.database.prepare("SELECT status FROM applications WHERE id='online'").first()).status,'under_review');
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM document_scan_jobs').first()).total,0);
});

test('physical query uses the independent records with pagination and safe search', async () => {
    const context = await createPortFixture();
    await registerPortPdf(context);

    const response = await portRequest(context, '/api/staff/physical-intakes/query', {method:'POST',cookie:context.staffCookie,json:{q:'Synthetic',page:1,page_size:25,status:'all'}});

    assert.equal(response.status,200,await response.clone().text());
    assert.equal((await response.json()).pagination.total,1);
});

test('physical policy validates identity, versions and readable PDFs', async () => {
    const receipt = { first_name:' Synthetic ',last_name:'Student',passport_number:'test',application_type:'initial' };

    assert.equal(validatePhysicalIntake(receipt).passport_number,'TEST');
    assert.throws(() => validatePhysicalIntake({...receipt,application_type:'unknown'}));
    await assert.rejects(validatePhysicalPdf(new Uint8Array([1,2,3])));
});

test('physical uploads never enter the online scanner and leave its pending verdict untouched', async () => {
    const context = await createPortFixture();
    const storageKey = `quarantine/${crypto.randomUUID()}`;
    const bytes = new TextEncoder().encode('%PDF-1.7\nsynthetic online document\n%%EOF');
    await context.storage.put(storageKey,bytes,{httpMetadata:{contentType:'application/pdf'}});
    await context.database.exec(`INSERT INTO students(id,student_number,normalized_student_number) VALUES('s','SCAN','SCAN');
        INSERT INTO applications(id,student_id,application_type,status) VALUES('a','s','initial','under_review');
        INSERT INTO document_records(id,application_id,requirement_id,application_type) VALUES('d','a','req-initial-passport','initial');
        INSERT INTO document_revisions(id,document_record_id,revision_number,status,is_current,submitted_by_type) VALUES('r','d',1,'submitted',1,'student');`);
    await context.database.prepare(`INSERT INTO document_revision_files(id,revision_id,page_order,storage_key,original_filename,media_type,byte_size,upload_status,scan_status)
        VALUES('f','r',0,?,'synthetic.pdf','application/pdf',?,'finalized','pending')`).bind(storageKey,bytes.length).run();
    await context.database.exec(`INSERT INTO upload_intents(id,revision_file_id,idempotency_key,expires_at,status,completed_at)
        VALUES('i','f','ik','2000-01-01T00:00:00Z','completed','2000-01-01T00:00:00Z');`);
    await registerPortPdf(context);

    const scanner = await portRequest(context, '/api/scanner/claim', {method:'POST',json:{runner_id:'synthetic'},headers:{Authorization:`Bearer ${context.environment.SCANNER_SECRET}`}});
    const { job } = await scanner.json();

    const pendingDownload = await portRequest(context, '/api/staff/applications/a/documents/passport/download', {cookie:context.staffCookie});
    assert.equal(pendingDownload.status,404);
    assert.equal(job.file_id,'f');
    assert.equal((await context.database.prepare('SELECT scan_status FROM physical_intake_files').first()).scan_status,'pending');
    assert.equal((await context.database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first()).scan_status,'pending');
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM document_scan_jobs').first()).total,1);

});

test('failed storage writes can retry the same phone photo without consuming another quota', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    const originalPut = context.storage.put;
    const id = crypto.randomUUID();
    context.storage.put = async () => { throw new Error('synthetic transient storage failure'); };

    const failed = await uploadPhoto(context,transfer,{id});
    context.storage.put = originalPut;
    const retried = await uploadPhoto(context,transfer,{id});

    assert.equal(failed.status,500);
    assert.equal(retried.status,200);
    assert.equal(context.objects.size,1);
    assert.equal((await context.database.prepare('SELECT file_count FROM mobile_document_transfers').first()).file_count,1);
});

test('single JPEG validation rejects concatenated images and content after the image end', async () => {
    const context = await createPortFixture();
    const transfer = await pairPortPhone(context);
    assert.equal((await uploadPhoto(context, transfer)).status, 200);
    const jpeg = context.objects.values().next().value.bytes;

    assert.doesNotThrow(() => requireSingleJpegContainer(jpeg));
    assert.throws(() => requireSingleJpegContainer(Buffer.concat([jpeg, jpeg])), { code: 'PHOTO_FORMAT' });
    assert.throws(() => requireSingleJpegContainer(Buffer.concat([jpeg, Buffer.from('appended'), jpeg.subarray(-2)])), { code: 'PHOTO_FORMAT' });
    assert.throws(() => requireSingleJpegContainer(jpeg.subarray(0, -2)), { code: 'PHOTO_FORMAT' });
});

test('QR owner checks respect the existing normalized staff identifier contract', async () => {
    const context = await createPortFixture();
    context.database.exec("UPDATE staff_users SET username='Synthetic' WHERE id='staff'");

    const transfer = await pairPortPhone(context);
    const photo = await uploadPhoto(context, transfer);

    assert.equal(photo.status, 200);
});
