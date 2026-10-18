import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createPortFixture,portRequest,registerPortPdf } from './physical-port-fixtures.js';
import { readIstanbulDay,requireApplicationDate,createTrackingReference,normalizeTrackingReference,readReceiptPortalOrigin,TRACKING_ALPHABET } from '../src/server/domain/physical-tracking-policy.js';
import { validateReceiptPdf } from '../src/server/services/physical-receipt-content.js';
import { cleanupPhysicalReceipts } from '../src/server/services/physical-receipt-cleanup.js';

const BASE='/api/staff/physical-intakes';
const METADATA={first_name:'Synthetic',last_name:'Student',passport_number:'receipt-test',application_type:'initial',application_date:'2026-10-12',student_number:''};

async function fixture() {
    const context=await createPortFixture();
    Object.assign(context.environment,{PHYSICAL_RECEIPTS_CREATE_ENABLED:'true',PUBLIC_PORTAL_ORIGIN:'https://portal.test',PUBLIC_PORTAL_ORIGIN_ALLOWLIST:'https://portal.test',PRINT_FILES:context.storage,PRINT_ENABLED:'true'});
    const put=context.storage.put;
    context.storage.put=async (key,bytes,options)=>{
        if (options?.onlyIf?.etagDoesNotMatch==='*' && context.objects.has(key)) return null;
        await put(key,bytes,options); return context.storage.head(key);
    };
    await context.database.prepare(`INSERT INTO printer_heartbeats(printer_id,runner_id,health,printer_name,seen_at,settings_protocol)
        VALUES('synthetic','agent','ready','Synthetic',?,3)`).bind(new Date().toISOString()).run();
    return context;
}

async function json(context,path,body,options={}) {
    return portRequest(context,`${BASE}${path}`,{method:options.method || 'POST',cookie:options.cookie || context.staffCookie,json:body});
}

async function reserve(context,options={}) {
    const response=await json(context,'/reference-reservations',{draft_id:options.draftId || crypto.randomUUID(),application_date:options.day || METADATA.application_date,
        application_type:options.applicationType || METADATA.application_type},options);
    assert.equal(response.status,200,await response.clone().text());
    return response.json();
}

async function register(context,options={}) {
    const reservation=await reserve(context,options);
    const body={registration_id:crypto.randomUUID(),reservation_id:reservation.id,...METADATA,...options.metadata};
    const response=await json(context,'/registrations',body);
    assert.equal(response.status,200,await response.clone().text());
    return {...await response.json(),body,reservation};
}

async function pdfBytes(pageCount=1,size=[595.28,841.89]) {
    const pdf=await PDFDocument.create();
    for (let page=0;page<pageCount;page++) pdf.addPage(size);
    return pdf.save();
}

async function ready(context,registration) {
    const receipt=registration.receipts[0];
    const response=await portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}/content`,{method:'PUT',cookie:context.staffCookie,
        headers:{'Content-Type':'application/pdf'},body:await pdfBytes()});
    assert.equal(response.status,200,await response.clone().text());
    return response.json();
}

async function print(context,registration,receipt,options={}) {
    return json(context,`/${registration.intake.id}/receipts/${receipt.id}/print`,{creation_id:crypto.randomUUID(),decision:'print',...options});
}

async function readAttempt(context,id) {
    return context.database.prepare('SELECT * FROM physical_receipt_print_attempts WHERE id=?').bind(id).first();
}

async function setJobState(context,attempt,status,started=null) {
    await context.database.prepare('UPDATE print_jobs SET status=?,submission_started_at=?,updated_at=? WHERE id=?')
        .bind(status,started,new Date().toISOString(),attempt.job_id).run();
}

test('tracking references use Istanbul day boundaries, unbiased alphabet and strict normalization',()=>{
    assert.equal(readIstanbulDay(new Date('2026-12-31T21:00:00Z')),'2027-01-01');
    assert.equal(readIstanbulDay(new Date('2026-12-31T20:59:59Z')),'2026-12-31');
    for (const day of ['2024-02-29','1990-01-01','2099-12-31']) assert.equal(requireApplicationDate(day),day);
    for (const day of ['2026-02-29','2026-13-01','2026-1-01','','0000-01-01']) assert.throws(()=>requireApplicationDate(day));
    for (let count=0;count<100;count++) {
        const reference=createTrackingReference('2026-10-12');
        assert.match(reference,new RegExp(`^ITU-26-[${TRACKING_ALPHABET}]{7}$`));
        assert.equal(normalizeTrackingReference(` ${reference.toLowerCase()} `),reference);
        assert.equal(normalizeTrackingReference(reference.replaceAll('-','')),reference);
    }
    assert.equal(normalizeTrackingReference('ITU-26-ABC!DEF'),null);
    assert.equal(normalizeTrackingReference('ITU-26-ABC0DEF'),null);
});

test('portal origin requires explicit HTTPS allowlist and rejects host/path injection',()=>{
    const environment={PUBLIC_PORTAL_ORIGIN:'https://portal.test',PUBLIC_PORTAL_ORIGIN_ALLOWLIST:'https://portal.test'};
    assert.equal(readReceiptPortalOrigin(environment),'https://portal.test');
    for (const origin of ['http://portal.test','https://portal.test/evil','https://user@portal.test','https://evil.test','https://portal.test/?x=1']) assert.equal(readReceiptPortalOrigin({...environment,PUBLIC_PORTAL_ORIGIN:origin}),null);
    assert.equal(readReceiptPortalOrigin({PUBLIC_PORTAL_ORIGIN:'https://portal.test'}),null);
});

test('allocation is session-bound and replayable; year changes retire a code forever',async()=>{
    const context=await fixture(); const draftId=crypto.randomUUID();

    const first=await reserve(context,{draftId});
    const replay=await reserve(context,{draftId});
    const changed=await reserve(context,{draftId,day:'2027-01-01'});
    const other=await reserve(context,{draftId,cookie:context.otherCookie});

    assert.equal(first.id,replay.id); assert.match(changed.tracking_reference,/^ITU-27-/);assert.notEqual(other.id,first.id);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_reference_reservations').first()).total,3);
});

test('reference allocation rejects a missing or invalid application type before reserving a number',async()=>{
    const context=await fixture();
    const response=await json(context,'/reference-reservations',{draft_id:crypto.randomUUID(),application_date:METADATA.application_date});

    assert.equal(response.status,400);
    assert.equal((await response.json()).error.message,'Önce başvuru türünü seçin.');
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_reference_reservations').first()).total,0);
});

test('reference collision retries only its UNIQUE constraint and does not hide database faults',async()=>{
    const context=await fixture();
    const random=crypto.getRandomValues;
    crypto.getRandomValues=bytes=>bytes.fill(0);
    try {
        await reserve(context);
        const response=await json(context,'/reference-reservations',{draft_id:crypto.randomUUID(),application_date:METADATA.application_date,application_type:METADATA.application_type});
        assert.equal(response.status,503);
        assert.equal((await response.json()).error.code,'REFERENCE_UNAVAILABLE');
    } finally {crypto.getRandomValues=random;}
    context.database.exec(`CREATE TRIGGER fail_reference BEFORE INSERT ON physical_reference_reservations BEGIN SELECT RAISE(ABORT,'synthetic_database_failure'); END;`);
    const failed=await json(context,'/reference-reservations',{draft_id:crypto.randomUUID(),application_date:METADATA.application_date,application_type:METADATA.application_type});
    assert.equal(failed.status,500);
});

test('one session has at most five active reservations',async()=>{
    const context=await fixture();
    for (let count=0;count<5;count++) await reserve(context);

    const response=await json(context,'/reference-reservations',{draft_id:crypto.randomUUID(),application_date:METADATA.application_date,application_type:METADATA.application_type});

    assert.equal(response.status,429);
});

test('PDF-free registration atomically consumes a reservation and replay survives expiry',async()=>{
    const context=await fixture();
    const registration=await register(context);
    await context.database.prepare("UPDATE physical_reference_reservations SET expires_at='2000-01-01T00:00:00Z'").run();

    const replay=await json(context,'/registrations',registration.body);
    const changed=await json(context,'/registrations',{...registration.body,first_name:'Other'});

    assert.equal(replay.status,200);assert.equal(changed.status,409);assert.equal(registration.intake.current_pdf_id,null);
    assert.equal(registration.intake.status,'under_review');
    const detail=await portRequest(context,`${BASE}/${registration.intake.id}`,{cookie:context.staffCookie});
    assert.equal((await detail.json()).intake.status,'under_review');
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total,1);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intake_receipts').first()).total,1);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intake_files').first()).total,0);
    assert.equal((await context.database.prepare('SELECT consumed_intake_id FROM physical_reference_reservations').first()).consumed_intake_id,registration.intake.id);
});

test('expired or other-session reservations never create a student',async()=>{
    const context=await fixture(); const reservation=await reserve(context);
    const body={registration_id:crypto.randomUUID(),reservation_id:reservation.id,...METADATA};

    const foreign=await json(context,'/registrations',body,{cookie:context.otherCookie});
    await context.database.prepare("UPDATE physical_reference_reservations SET expires_at='2000-01-01T00:00:00Z'").run();
    const expired=await json(context,'/registrations',body);

    assert.equal(foreign.status,409);assert.equal(expired.status,409);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total,0);
});

test('a receipt insert failure rolls back the student and reservation consumption',async()=>{
    const context=await fixture(); const reservation=await reserve(context);
    context.database.exec(`CREATE TRIGGER fail_snapshot BEFORE INSERT ON physical_intake_receipts BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END;`);

    const response=await json(context,'/registrations',{registration_id:crypto.randomUUID(),reservation_id:reservation.id,...METADATA});

    assert.equal(response.status,500);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total,0);
    assert.equal((await context.database.prepare('SELECT consumed_intake_id FROM physical_reference_reservations').first()).consumed_intake_id,null);
});

test('parallel duplicate registrations result in one active passport/type and return matches',async()=>{
    const context=await fixture(); const reservations=await Promise.all([reserve(context),reserve(context)]);

    const responses=await Promise.all(reservations.map(reservation=>json(context,'/registrations',{registration_id:crypto.randomUUID(),reservation_id:reservation.id,...METADATA})));

    assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
    const conflict=await responses.find(response=>response.status===409).json();assert.equal(conflict.matches.length,1);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total,1);
});

test('passport triggers protect old multipart, restore and reopen while preserving punctuation',async()=>{
    const context=await fixture(); const old=await registerPortPdf(context);
    const reservation=await reserve(context);
    const duplicate=await json(context,'/registrations',{registration_id:crypto.randomUUID(),reservation_id:reservation.id,...METADATA,passport_number:' test '});
    assert.equal(duplicate.status,409);
    const created=await register(context,{metadata:{passport_number:'TE-ST'}});
    const close=await json(context,`/${old.id}/close`,{lock_version:old.detail.intake.lock_version,reason:'Synthetic closure'});
    assert.equal(close.status,200);
    const next=await register(context,{metadata:{passport_number:'TEST'}});
    await context.database.prepare("UPDATE staff_users SET role='admin' WHERE id='staff'").run();
    const reopened=await json(context,`/${old.id}/reopen`,{lock_version:2,reason:'Synthetic reopen'});
    assert.equal(reopened.status,409);
    await context.database.prepare('UPDATE physical_intakes SET deleted_at=? WHERE id=?').bind(new Date().toISOString(),next.intake.id).run();
    await context.database.prepare('UPDATE physical_intakes SET processing_closed_at=NULL WHERE id=?').bind(old.id).run();
    assert.throws(()=>context.database.prepare('UPDATE physical_intakes SET deleted_at=NULL WHERE id=?').bind(next.intake.id).run(),/physical_active_passport_conflict/);
    assert.notEqual(created.intake.id,next.intake.id);
});

test('metadata uses optimistic locks, keeps its reference and stales only document fields',async()=>{
    const context=await fixture();const registration=await register(context);await ready(context,registration);
    const id=registration.intake.id;

    const changed=await json(context,`/${id}/metadata`,{...METADATA,first_name:'Corrected',application_date:'2027-01-01',lock_version:1},{method:'PATCH'});
    const stale=await json(context,`/${id}/metadata`,{...METADATA,lock_version:1},{method:'PATCH'});
    const receipt=await portRequest(context,`${BASE}/${id}/receipts/${registration.receipts[0].id}`,{cookie:context.staffCookie});

    assert.equal(changed.status,200);assert.equal(stale.status,409);
    const payload=await changed.json();assert.equal(payload.intake.metadata_version,2);assert.equal(payload.intake.tracking_reference,registration.intake.tracking_reference);
    assert.equal((await receipt.json()).is_stale,true);
    const printResponse=await print(context,registration,registration.receipts[0]);assert.equal(printResponse.status,409);
});

test('closing stops metadata and PDF mutation; only admins reopen',async()=>{
    const context=await fixture();const registration=await register(context);const id=registration.intake.id;
    assert.equal((await json(context,`/${id}/close`,{lock_version:1,reason:'Documents processed'})).status,200);

    const edit=await json(context,`/${id}/metadata`,{...METADATA,first_name:'Changed',lock_version:2},{method:'PATCH'});
    const reopen=await json(context,`/${id}/reopen`,{lock_version:2,reason:'Synthetic reopen'});
    const upload=await portRequest(context,`${BASE}/${id}/pdf`,{method:'POST',cookie:context.staffCookie,headers:{'Content-Type':'application/pdf','If-Match':'2','X-Pdf-Id':crypto.randomUUID()},body:await pdfBytes()});

    assert.equal(edit.status,409);assert.equal(reopen.status,403);assert.equal(upload.status,409);
    await context.database.prepare("UPDATE staff_users SET role='admin' WHERE id='staff'").run();
    assert.equal((await json(context,`/${id}/reopen`,{lock_version:2,reason:'Synthetic reopen'})).status,200);
});

test('receipt parser rejects non-A4, rotated, multi-page and malformed bytes',async()=>{
    await validateReceiptPdf(await pdfBytes());
    await assert.rejects(()=>validateReceiptPdf(awaitableInvalid()),{code:'INVALID_RECEIPT_PDF'});
    await assert.rejects(()=>validateReceiptPdf(new Uint8Array([1,2,3])));
    for (const bytes of [await pdfBytes(2),await pdfBytes(1,[841.89,595.28]),await pdfBytes(1,[200,200])]) await assert.rejects(()=>validateReceiptPdf(bytes));
    const pdf=await PDFDocument.load(await pdfBytes());pdf.getPage(0).setRotation({type:'degrees',angle:90});
    const rotatedBytes=await pdf.save();
    await assert.rejects(()=>validateReceiptPdf(rotatedBytes));
});

function awaitableInvalid(){return new TextEncoder().encode('%PDF-not-a-real-pdf');}

test('write-once artefacts retain first valid bytes under different render replays',async()=>{
    const context=await fixture();const registration=await register(context);const first=await ready(context,registration);
    const second=await ready(context,registration);

    assert.equal(first.sha256,second.sha256);
    assert.equal([...context.objects.keys()].filter(key=>key.startsWith('receipts/')).length,1);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_document_scan_jobs').first()).total,0);
});

test('R2 success followed by D1 bind failure recovers the same object',async()=>{
    const context=await fixture();const registration=await register(context);
    context.database.exec(`CREATE TRIGGER fail_bind BEFORE UPDATE OF state ON physical_intake_receipts BEGIN SELECT RAISE(ABORT,'synthetic_bind_failure'); END;`);
    const bytes=await pdfBytes();const receipt=registration.receipts[0];const path=`${BASE}/${registration.intake.id}/receipts/${receipt.id}/content`;
    const options={method:'PUT',cookie:context.staffCookie,headers:{'Content-Type':'application/pdf'},body:bytes};

    const failed=await portRequest(context,path,options);context.database.exec('DROP TRIGGER fail_bind');
    const recovered=await portRequest(context,path,options);

    assert.equal(failed.status,500);assert.equal(recovered.status,200);
    assert.equal([...context.objects.keys()].filter(key=>key.startsWith('receipts/')).length,1);
});

test('print retries use the same job and persist ordinary Agent settings without browser tokens',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const creationId=crypto.randomUUID();

    const first=await print(context,registration,receipt,{creation_id:creationId});
    const second=await print(context,registration,receipt,{creation_id:creationId});

    assert.equal(first.status,200,await first.clone().text());assert.equal(second.status,200);
    const payload=await first.json();assert.equal(payload.status,'queued');assert.equal(payload.id,(await second.json()).id);
    assert.equal(JSON.stringify(payload).includes('token'),false);
    const job=await context.database.prepare('SELECT * FROM print_jobs').first();
    assert.deepEqual([job.source,job.copies,job.paper_size,job.orientation,job.color_mode,job.duplex],['staff',1,'A4','portrait','monochrome','simplex']);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,1);
    assert.equal((await context.storage.head(job.storage_key)).size,receipt.byte_size);
});

test('failed copy resumes an existing uploading job after a fresh staff login',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const put=context.storage.put;context.storage.put=async(key,bytes,options)=>{if(key.startsWith('print/'))throw new Error('synthetic_r2_failure');return put(key,bytes,options);};
    assert.equal((await print(context,registration,receipt)).status,500);
    const attempt=await context.database.prepare('SELECT * FROM physical_receipt_print_attempts').first();context.storage.put=put;

    const resumed=await json(context,`/${registration.intake.id}/print-attempts/${attempt.id}/resume`,{},{cookie:context.otherCookie});

    assert.equal(resumed.status,200,await resumed.clone().text());assert.equal((await resumed.json()).status,'queued');
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,1);
});

test('queue pause, stale heartbeat and disabled gate keep the student/A4 and do not create jobs',async()=>{
    for (const mode of ['pause','stale','disabled']) {
        const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
        if(mode==='pause')context.database.exec("UPDATE print_queue_controls SET is_paused=1");
        if(mode==='stale')context.database.exec("UPDATE printer_heartbeats SET seen_at='2000-01-01T00:00:00Z'");
        if(mode==='disabled')context.environment.PRINT_ENABLED='false';

        const response=await print(context,registration,receipt);

        assert.equal(response.status,503,mode);assert.equal((await context.database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,0);
        assert.equal((await context.database.prepare('SELECT state FROM physical_intake_receipts').first()).state,'ready');
    }
});

test('parallel sends across receipt versions cannot bypass the intake-wide attempt lock',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);

    const responses=await Promise.all([print(context,registration,receipt),print(context,registration,receipt)]);

    assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,1);
});

test('Agent update and purge preserve terminal or unknown result independently of the browser',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const response=await print(context,registration,receipt);const payload=await response.json();const attempt=await readAttempt(context,payload.id);

    await setJobState(context,attempt,'submission_started',new Date().toISOString());
    context.database.prepare('DELETE FROM print_jobs WHERE id=?').bind(attempt.job_id).run();

    const durable=await readAttempt(context,attempt.id);assert.equal(durable.status,'unknown');assert.equal(durable.blocks_new_attempt,1);assert.ok(durable.submission_started_at);
    assert.equal((await print(context,registration,receipt,{decision:'reprint'})).status,409);
});

test('receipt attempts retain submitted result and spooler information after job purge',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const response=await print(context,registration,receipt);const attempt=await readAttempt(context,(await response.json()).id);
    await context.database.prepare("UPDATE print_jobs SET status='submitted',spooler_job_id='synthetic-spooler',submission_started_at=? WHERE id=?").bind(new Date().toISOString(),attempt.job_id).run();

    context.database.prepare('DELETE FROM print_jobs WHERE id=?').bind(attempt.job_id).run();

    const durable=await readAttempt(context,attempt.id);assert.equal(durable.status,'submitted');assert.equal(durable.blocks_new_attempt,0);assert.equal(durable.spooler_job_id,'synthetic-spooler');
});

test('failed status transfer rolls back Agent mutation and print row purge',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const response=await print(context,registration,receipt);const attempt=await readAttempt(context,(await response.json()).id);
    context.database.exec("CREATE TRIGGER fail_attempt BEFORE UPDATE ON physical_receipt_print_attempts BEGIN SELECT RAISE(ABORT,'synthetic_transfer_failure'); END;");

    assert.throws(()=>context.database.prepare("UPDATE print_jobs SET status='submitted' WHERE id=?").bind(attempt.job_id).run());
    assert.throws(()=>context.database.prepare('DELETE FROM print_jobs WHERE id=?').bind(attempt.job_id).run());

    assert.equal((await context.database.prepare('SELECT status FROM print_jobs WHERE id=?').bind(attempt.job_id).first()).status,'queued');
});

test('reviewer cancellation is limited to unclaimed receipt jobs',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const response=await print(context,registration,receipt);const attempt=await readAttempt(context,(await response.json()).id);
    const cancelled=await json(context,`/${registration.intake.id}/print-attempts/${attempt.id}/cancel`,{});
    assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).status,'cancelled');
    const reprint=await print(context,registration,receipt,{decision:'reprint'});const next=await readAttempt(context,(await reprint.json()).id);
    await setJobState(context,next,'leased');

    const unsafe=await json(context,`/${registration.intake.id}/print-attempts/${next.id}/cancel`,{});

    assert.equal(unsafe.status,409);assert.equal((await readAttempt(context,next.id)).status,'leased');
});

test('explicit physical risk acknowledgement preserves old unknown status and creates one reprint',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const response=await print(context,registration,receipt);const attempt=await readAttempt(context,(await response.json()).id);
    await setJobState(context,attempt,'unknown',new Date().toISOString());
    const decision={decision:'reprint',creation_id:crypto.randomUUID(),risk_confirmed:true,acknowledged_attempt_id:attempt.id,reason:'Checked physical spooler'};

    const reprint=await print(context,registration,receipt,decision);const replay=await print(context,registration,receipt,decision);

    assert.equal(reprint.status,200,await reprint.clone().text());assert.equal(replay.status,200);
    const old=await readAttempt(context,attempt.id);assert.equal(old.status,'unknown');assert.equal(old.blocks_new_attempt,0);assert.ok(old.risk_acknowledged_at);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,2);
});

test('artifact retention protects live/uncertain print attempts and download leases',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const response=await print(context,registration,receipt);const attempt=await readAttempt(context,(await response.json()).id);
    context.database.exec("UPDATE physical_intake_receipts SET expires_at='2000-01-01T00:00:00Z'");
    await cleanupPhysicalReceipts(context.environment);
    assert.equal((await context.database.prepare('SELECT state FROM physical_intake_receipts').first()).state,'ready');
    await setJobState(context,attempt,'submitted');
    const downloaded=await portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}?download=1`,{cookie:context.staffCookie});
    assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('Cache-Control'),'private, no-store');
    await cleanupPhysicalReceipts(context.environment);
    assert.equal((await context.database.prepare('SELECT state FROM physical_intake_receipts').first()).state,'ready');
    context.database.exec("UPDATE physical_intake_receipts SET download_lease_until=NULL");

    await cleanupPhysicalReceipts(context.environment);

    assert.equal((await context.database.prepare('SELECT state FROM physical_intake_receipts').first()).state,'purged');
    assert.equal([...context.objects.keys()].filter(key=>key.startsWith('receipts/')).length,0);
});

test('failed R2 deletion never labels an artifact purged',async()=>{
    const context=await fixture();const registration=await register(context);await ready(context,registration);
    context.database.exec("UPDATE physical_intake_receipts SET expires_at='2000-01-01T00:00:00Z'");
    context.storage.delete=async()=>{throw new Error('synthetic_delete_failure');};

    await cleanupPhysicalReceipts(context.environment);

    const receipt=await context.database.prepare('SELECT * FROM physical_intake_receipts').first();assert.equal(receipt.state,'ready');assert.equal(receipt.purge_claim_until,null);
});

test('public lookup exposes no PII or internal IDs and expired reservations do not expire tracking',async()=>{
    const context=await fixture();const registration=await register(context);
    context.database.exec("UPDATE physical_reference_reservations SET expires_at='2000-01-01T00:00:00Z'");

    const response=await portRequest(context,'/api/public/physical-intakes/tracking-lookup',{method:'POST',json:{tracking_reference:registration.intake.tracking_reference.toLowerCase().replaceAll('-','')}});

    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const payload=await response.json();assert.equal(payload.office_status,'under_review');
    assert.deepEqual(Object.keys(payload).sort(),['application_date','found','office_status','requestId','tracking_reference','updated_at'].sort());
    assert.equal(JSON.stringify(payload).includes('Synthetic'),false);
    context.database.prepare('UPDATE physical_intakes SET deleted_at=? WHERE id=?').bind(new Date().toISOString(),registration.intake.id).run();
    const hidden=await portRequest(context,'/api/public/physical-intakes/tracking-lookup',{method:'POST',json:{tracking_reference:registration.intake.tracking_reference}});assert.equal((await hidden.json()).found,false);
});

test('public physical tracking returns the staff rejection reason only for rejected records',async()=>{
    const context=await fixture();const registration=await register(context);
    const reason='Pasaport kopyası okunaklı değil.';
    context.database.prepare("UPDATE physical_intakes SET status='rejected',rejection_reason=? WHERE id=?")
        .bind(reason,registration.intake.id).run();

    const response=await portRequest(context,'/api/public/physical-intakes/tracking-lookup',{
        method:'POST',json:{tracking_reference:registration.intake.tracking_reference}
    });
    const payload=await response.json();

    assert.equal(response.status,200);assert.equal(payload.office_status,'rejected');
    assert.equal(payload.rejection_reason,reason);
    assert.equal(Object.hasOwn(payload,'rejection_reason'),true);
    assert.equal(Object.hasOwn(payload,'student_number'),false);
});

test('public rate limits are per-IP and per-IP/code, never a global code lock',async()=>{
    const context=await fixture();const registration=await register(context);const path='/api/public/physical-intakes/tracking-lookup';
    const lookup=ip=>portRequest(context,path,{method:'POST',json:{tracking_reference:registration.intake.tracking_reference},headers:{'CF-Connecting-IP':ip}});
    for(let count=0;count<15;count++)assert.equal((await lookup('192.0.2.1')).status,200);

    assert.equal((await lookup('192.0.2.1')).status,429);
    assert.equal((await lookup('192.0.2.2')).status,200);
});

test('C gate closes new creation but preserves lookup, receipt downloads and secure resume',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);context.environment.PHYSICAL_RECEIPTS_CREATE_ENABLED='false';

    const replay=await json(context,'/registrations',registration.body);
    const lookup=await portRequest(context,'/api/public/physical-intakes/tracking-lookup',{method:'POST',json:{tracking_reference:registration.intake.tracking_reference}});
    const download=await portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}?download=1`,{cookie:context.staffCookie});

    assert.equal(replay.status,403);assert.equal((await lookup.json()).found,true);assert.equal(download.status,200);
    const unauthorized=await portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}`,{});assert.equal(unauthorized.status,401);
    const crossOrigin=await portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}/print`,{method:'POST',cookie:context.staffCookie,json:{},headers:{Origin:'https://evil.test'}});assert.equal(crossOrigin.status,403);
});

test('ten staff sessions can create one hundred unique receipts within their separate endpoint budgets',async()=>{
    const context=await fixture();
    const {createOpaqueSessionToken,hashSessionToken}=await import('../src/server/auth/sessionToken.js');
    const cookies=await Promise.all(Array.from({length:10},async()=>{
        const token=createOpaqueSessionToken();
        await context.database.prepare(`INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at,last_seen_at) VALUES(?,'staff',?,?,?)`)
            .bind(crypto.randomUUID(),await hashSessionToken(token),new Date(Date.now()+3600_000).toISOString(),new Date().toISOString()).run();
        return `staff_session=${token}`;
    }));

    await Promise.all(cookies.map(async(cookie,sessionIndex)=>{
        for(let index=0;index<10;index++) {
            const reservation=await reserve(context,{cookie});
            const response=await json(context,'/registrations',{registration_id:crypto.randomUUID(),reservation_id:reservation.id,...METADATA,
                passport_number:`LOAD-${sessionIndex}-${index}`},{cookie});
            assert.equal(response.status,200,await response.clone().text());
        }
    }));

    const totals=await context.database.prepare('SELECT count(*) AS total,count(DISTINCT tracking_reference) AS references_count FROM physical_intakes').first();
    assert.equal(totals.total,100);assert.equal(totals.references_count,100);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intake_receipts').first()).total,100);
});

test('forward migration preserves old duplicate passports and allows unrelated name/date edits',async()=>{
    const {TestD1Database}=await import('./helpers/d1-test-binding.js');
    const {readFileSync,readdirSync}=await import('node:fs');
    const database=new TestD1Database();const directory=new URL('../migrations/',import.meta.url);
    for(const filename of readdirSync(directory).filter(name=>name.endsWith('.sql') && name<'0020_physical_intake_receipts.sql').sort()) database.exec(readFileSync(new URL(filename,directory),'utf8'));
    await createPortFixture(database,{});
    for(const id of ['old-one','old-two'])database.prepare(`INSERT INTO physical_intakes(id,student_number,first_name,last_name,passport_number,application_type,submitted_at,updated_at,created_by_staff_id,status)
        VALUES(?,'','Synthetic','Legacy','PUNCT-UATED','initial','2026-01-01','2026-01-01','staff','under_review')`).bind(id).run();

    database.exec(readFileSync(new URL('0020_physical_intake_receipts.sql',directory),'utf8'));
    database.prepare("UPDATE physical_intakes SET first_name='Corrected',application_date='2026-10-12' WHERE id='old-one'").run();

    const old=await database.prepare("SELECT * FROM physical_intakes WHERE id='old-two'").first();
    assert.equal(old.tracking_reference,null);assert.equal(old.application_date,null);assert.equal(old.first_name,'Synthetic');
    assert.equal((await database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total,2);
    assert.throws(()=>database.prepare(`INSERT INTO physical_intakes(id,student_number,first_name,last_name,passport_number,application_type,submitted_at,updated_at,created_by_staff_id,status)
        VALUES('new','','Synthetic','New',' punct-uated ','initial','2026-10-12','2026-10-12','staff','under_review')`).run(),/physical_active_passport_conflict/);
});

test('new receipt versions retain the same tracking number after expiry and creation replay stays immutable',async()=>{
    const context=await fixture();const registration=await register(context);await ready(context,registration);
    context.database.exec("UPDATE physical_intake_receipts SET expires_at='2000-01-01T00:00:00Z'");await cleanupPhysicalReceipts(context.environment);
    const creationId=crypto.randomUUID();

    const response=await json(context,`/${registration.intake.id}/receipts`,{creation_id:creationId,lock_version:1});
    const replay=await json(context,`/${registration.intake.id}/receipts`,{creation_id:creationId,lock_version:1});

    assert.equal(response.status,200,await response.clone().text());const receipt=await response.json();
    assert.equal(receipt.document_version,2);assert.equal(receipt.snapshot.tracking_reference,registration.intake.tracking_reference);
    assert.equal((await replay.json()).id,receipt.id);
});

test('risk unlock and reprint reservation roll back together when the printer is paused',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const first=await print(context,registration,receipt);const attempt=await readAttempt(context,(await first.json()).id);
    await setJobState(context,attempt,'unknown',new Date().toISOString());
    context.database.exec("UPDATE print_queue_controls SET is_paused=1");

    const blocked=await print(context,registration,receipt,{decision:'reprint',risk_confirmed:true,acknowledged_attempt_id:attempt.id,reason:'Checked physical printer'});

    assert.equal(blocked.status,503);const old=await readAttempt(context,attempt.id);
    assert.equal(old.status,'unknown');assert.equal(old.blocks_new_attempt,1);assert.equal(old.risk_acknowledged_at,null);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,1);
});

test('an acknowledged unknown attempt still protects its old receipt artifact from expiry',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    const first=await print(context,registration,receipt);const attempt=await readAttempt(context,(await first.json()).id);
    await setJobState(context,attempt,'unknown',new Date().toISOString());
    context.database.prepare("UPDATE physical_receipt_print_attempts SET blocks_new_attempt=0,risk_acknowledged_at=? WHERE id=?").bind(new Date().toISOString(),attempt.id).run();
    context.database.exec("UPDATE physical_intake_receipts SET expires_at='2000-01-01T00:00:00Z'");

    await cleanupPhysicalReceipts(context.environment);

    assert.equal((await context.database.prepare('SELECT state FROM physical_intake_receipts').first()).state,'ready');
});

test('invalid portal configuration still saves the student but cannot generate or print an A4',async()=>{
    const context=await fixture();context.environment.PUBLIC_PORTAL_ORIGIN_ALLOWLIST='';
    const registration=await register(context);const receipt=registration.receipts[0];

    const uploaded=await portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}/content`,{method:'PUT',cookie:context.staffCookie,headers:{'Content-Type':'application/pdf'},body:await pdfBytes()});

    assert.equal(uploaded.status,503);assert.equal(registration.intake.current_pdf_id,null);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total,1);
    assert.equal([...context.objects.keys()].length,0);
});

test('public tracking bounds streaming JSON and counts malformed requests in the IP budget',async()=>{
    const context=await fixture();

    const response=await portRequest(context,'/api/public/physical-intakes/tracking-lookup',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify({tracking_reference:'x'.repeat(1100)})});

    assert.equal(response.status,413);
    assert.equal((await context.database.prepare("SELECT request_count FROM public_rate_limits WHERE endpoint='physical-tracking-ip'").first()).request_count,1);
});

test('bounded orphan cleanup advances its cursor and keeps ready receipt objects',async()=>{
    const context=await fixture();const registration=await register(context);await ready(context,registration);
    const receipt=await context.database.prepare('SELECT * FROM physical_intake_receipts').first();
    const orphan='receipts/synthetic-orphan/test.pdf';await context.storage.put(orphan,new Uint8Array([1]),{});
    let calls=0;
    context.storage.list=async options=>{
        calls++;
        if(calls===1)return {objects:[{key:receipt.artefact_key,uploaded:new Date('2000-01-01')},{key:orphan,uploaded:new Date('2000-01-01')}],truncated:true,cursor:'synthetic-next'};
        assert.equal(options.cursor,'synthetic-next');return {objects:[],truncated:false};
    };

    await cleanupPhysicalReceipts(context.environment);await cleanupPhysicalReceipts(context.environment);

    assert.equal(context.objects.has(orphan),false);assert.equal(context.objects.has(receipt.artefact_key),true);
    assert.equal((await context.database.prepare('SELECT listing_cursor FROM physical_receipt_cleanup_cursor').first()).listing_cursor,null);
});

test('restored local SQLite data retains legacy fields when the additive receipt migration is applied',async()=>{
    const {TestD1Database}=await import('./helpers/d1-test-binding.js');
    const {DatabaseSync}=await import('node:sqlite');
    const {readFileSync,readdirSync,mkdtempSync,copyFileSync,rmSync}=await import('node:fs');
    const {tmpdir}=await import('node:os');const {join}=await import('node:path');
    const directory=mkdtempSync(join(tmpdir(),'physical-receipt-restore-'));const database=new TestD1Database();
    try {
        const migrations=new URL('../migrations/',import.meta.url);
        for(const filename of readdirSync(migrations).filter(name=>name.endsWith('.sql') && name<'0020_physical_intake_receipts.sql').sort()) database.exec(readFileSync(new URL(filename,migrations),'utf8'));
        await createPortFixture(database,{});
        database.exec(`INSERT INTO physical_intakes(id,student_number,first_name,last_name,passport_number,application_type,submitted_at,updated_at,created_by_staff_id,status,legacy_status)
            VALUES('restored','SYNTHETIC','Before','Migration','RESTORE-TEST','renewal','2026-01-01','2026-01-01','staff','approved_for_processing','completed')`);
        database.database.prepare('VACUUM INTO ?').run(join(directory,'backup.sqlite'));
        copyFileSync(join(directory,'backup.sqlite'),join(directory,'restored.sqlite'));
        database.database.close();database.database=new DatabaseSync(join(directory,'restored.sqlite'));database.exec('PRAGMA foreign_keys=ON');

        database.exec(readFileSync(new URL('0020_physical_intake_receipts.sql',migrations),'utf8'));

        const restored=database.prepare("SELECT * FROM physical_intakes WHERE id='restored'").first();
        assert.equal(restored.first_name,'Before');assert.equal(restored.legacy_status,'completed');assert.equal(restored.status,'approved_for_processing');
        assert.equal(restored.tracking_reference,null);assert.equal(restored.application_date,null);assert.equal(database.prepare('PRAGMA integrity_check').first().integrity_check,'ok');
    } finally {database.database.close();rmSync(directory,{recursive:true,force:true});}
});

test('receipt creation capability fails closed for absent or malformed values',async()=>{
    const {isPhysicalReceiptCreationEnabled}=await import('../src/server/config/physical-receipt-config.js');

    assert.equal(isPhysicalReceiptCreationEnabled({PHYSICAL_RECEIPTS_CREATE_ENABLED:'true'}),true);
    for(const value of [undefined,null,true,'TRUE',' true ','false',''])assert.equal(isPhysicalReceiptCreationEnabled({PHYSICAL_RECEIPTS_CREATE_ENABLED:value}),false);
});

test('partial migrations never advertise receipt creation or issue new student references',async()=>{
    const context=await fixture();context.database.exec('DELETE FROM physical_receipt_schema');

    const config=await portRequest(context,`${BASE}/config`,{cookie:context.staffCookie});
    const reservation=await json(context,'/reference-reservations',{draft_id:crypto.randomUUID(),application_date:METADATA.application_date,application_type:METADATA.application_type});
    const lookup=await portRequest(context,'/api/public/physical-intakes/tracking-lookup',{method:'POST',json:{tracking_reference:'ITU-26-ABCDEFG'}});

    assert.equal(config.status,503);assert.equal(reservation.status,503);assert.equal((await lookup.json()).found,false);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total,0);
});

test('a 30-day-old ready artefact requires a new document version even before cleanup runs',async()=>{
    const context=await fixture();const registration=await register(context);const receipt=await ready(context,registration);
    context.database.exec("UPDATE physical_intake_receipts SET expires_at='2000-01-01T00:00:00Z'");

    const response=await print(context,registration,receipt);
    const status=await portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}`,{cookie:context.staffCookie});

    assert.equal(response.status,409);assert.equal((await response.json()).error.code,'RECEIPT_EXPIRED');assert.equal((await status.json()).is_expired,true);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,0);
});

test('a deleted intake cannot recycle its consumed reference or retain receipt snapshots indefinitely',async()=>{
    const context=await fixture();const registration=await register(context);

    context.database.prepare('DELETE FROM physical_intakes WHERE id=?').bind(registration.intake.id).run();
    const replay=await json(context,'/registrations',registration.body);

    assert.equal(replay.status,409);
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intake_receipts').first()).total,0);
    assert.equal((await context.database.prepare('SELECT consumed_intake_id FROM physical_reference_reservations').first()).consumed_intake_id,registration.intake.id);
});

test('all staff stages appear in code tracking without an uploaded PDF', async () => {
    const context = await fixture();
    const registration = await register(context);
    const id = registration.intake.id;

    for (const status of ['under_review', 'approved_for_processing', 'sent_to_migration', 'migration_approved', 'completed', 'rejected']) {
        const current = await context.database.prepare('SELECT lock_version FROM physical_intakes WHERE id=?').bind(id).first();
        if (status !== 'under_review') {
            const changed = await json(context, `/${id}/status`, { lock_version: current.lock_version, status,
                ...(status === 'rejected' ? { rejection_reason: 'Synthetic missing document' } : {}) }, { method: 'PATCH' });
            assert.equal(changed.status, 200, await changed.clone().text());
        }
        const tracked = await portRequest(context, '/api/public/physical-intakes/tracking-lookup', {
            method: 'POST', json: { tracking_reference: registration.intake.tracking_reference } });

        assert.equal((await tracked.json()).office_status, status);
        assert.equal((await context.database.prepare('SELECT current_pdf_id FROM physical_intakes WHERE id=?').bind(id).first()).current_pdf_id, null);
    }
});

test('physical intake query filters inclusively by delivery date and validates range', async () => {
    const context = await fixture();
    const older = await register(context, { day: '2026-10-10', metadata: { application_date: '2026-10-10', passport_number: 'older-test' } });
    const matching = await register(context, { day: '2026-10-12', metadata: { application_date: '2026-10-12', passport_number: 'match-test' } });
    const newer = await register(context, { day: '2026-10-14', metadata: { application_date: '2026-10-14', passport_number: 'newer-test' } });

    const response = await json(context, '/query', { from_date: '2026-10-12', to_date: '2026-10-14', page: 1, page_size: 25 });

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items.map(item => item.id).sort(), [matching.intake.id, newer.intake.id].sort());
    const invalid = await json(context, '/query', { from_date: '2026-10-15', to_date: '2026-10-14', page: 1, page_size: 25 });
    assert.equal(invalid.status, 400);
    const malformed = await json(context, '/query', { from_date: '2026-02-30', page: 1, page_size: 25 });
    assert.equal(malformed.status, 400);
    assert.notEqual(older.intake.id, matching.intake.id);
});

test('completed cases release the active identity but cannot reopen over a new case', async () => {
    const context = await fixture();
    const first = await register(context);
    const id = first.intake.id;
    const fileId = crypto.randomUUID();
    await portRequest(context, `${BASE}/${id}/pdf`, { method: 'POST', cookie: context.staffCookie,
        headers: { 'Content-Type': 'application/pdf', 'If-Match': '1', 'X-Pdf-Id': fileId }, body: await pdfBytes() });
    const closed = await json(context, `/${id}/status`, { lock_version: 2, status: 'completed' }, { method: 'PATCH' });
    assert.equal(closed.status, 200);

    const second = await register(context);
    const reopened = await json(context, `/${id}/status`, { lock_version: 3, status: 'under_review' }, { method: 'PATCH' });

    assert.notEqual(second.intake.id, id);
    assert.equal(reopened.status, 409);
    assert.equal((await context.database.prepare('SELECT status FROM physical_intakes WHERE id=?').bind(id).first()).status, 'completed');
    assert.equal((await context.database.prepare('SELECT count(*) AS total FROM physical_intake_files').first()).total, 1);
});
