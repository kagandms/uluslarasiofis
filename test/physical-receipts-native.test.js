import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { PDFDocument } from 'pdf-lib';
import { createPortFixture,portRequest } from './physical-port-fixtures.js';

const BASE='/api/staff/physical-intakes';

test('native D1/R2 receipt replay, write-once and print transactions survive restored local schema', { timeout: 30_000 }, async()=>{
    const runtime=new Miniflare(convertV4MiniflareOptions({cf:false,modules:true,script:'export default {fetch(){return new Response("synthetic")}};',compatibilityDate:'2026-10-01',d1Databases:['DB'],r2Buckets:['DOCUMENTS','PRINT_FILES']}));
    try {
        const database=await runtime.getD1Database('DB');const documents=await runtime.getR2Bucket('DOCUMENTS');
        for(const filename of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
            await database.exec(readFileSync(new URL(`../migrations/${filename}`,import.meta.url),'utf8').replace(/--[^\n]*/g,'').replaceAll('\n',' '));
        }
        const context=await createPortFixture(database,documents);
        Object.assign(context.environment,{PRINT_FILES:await runtime.getR2Bucket('PRINT_FILES'),PRINT_ENABLED:'true',PHYSICAL_RECEIPTS_CREATE_ENABLED:'true',PUBLIC_PORTAL_ORIGIN:'https://portal.test',PUBLIC_PORTAL_ORIGIN_ALLOWLIST:'https://portal.test'});
        const post=(path,json)=>portRequest(context,`${BASE}${path}`,{method:'POST',cookie:context.staffCookie,json});
        const reservationResponse=await post('/reference-reservations',{draft_id:crypto.randomUUID(),application_date:'2026-10-12',application_type:'initial'});
        assert.equal(reservationResponse.status,200,await reservationResponse.clone().text());
        const reservation=await reservationResponse.json();
        const body={registration_id:crypto.randomUUID(),reservation_id:reservation.id,application_date:'2026-10-12',first_name:'Synthetic',last_name:'Student',passport_number:'NATIVE-TEST',application_type:'initial'};
        // Pause one actual D1 replay read after it returns null. Let the other
        // request commit before the delayed request reads the consumed reservation.
        // This forces the previously intermittent read/commit/read interleaving.
        const replayRead = Promise.withResolvers();
        const winnerCommitted = Promise.withResolvers();
        let intercepted = false;
        context.environment.DB = {
            prepare(sql) {
                const statement = database.prepare(sql);
                if (!sql.includes('FROM physical_intakes WHERE id=?')) return statement;
                return { bind(...values) {
                    const bound = statement.bind(...values);
                    if (intercepted || values[0] !== body.registration_id) return bound;
                    intercepted = true;
                    return { async first() {
                        const snapshot = await bound.first();
                        replayRead.resolve();
                        await winnerCommitted.promise;
                        return snapshot;
                    } };
                } };
            },
            batch: statements => database.batch(statements)
        };
        const delayed = post('/registrations',body);
        await replayRead.promise;
        let winner;
        try { winner = await post('/registrations',body); }
        finally { winnerCommitted.resolve(); }
        const responses = [await delayed, winner];
        context.environment.DB = database;
        const diagnostics = await Promise.all(responses.map(async response => {
            const body = await response.clone().json();
            return { status: response.status, code: body.error?.code, message: body.error?.message };
        }));
        assert.ok(responses.every(response=>response.status===200), JSON.stringify(diagnostics));
        const ids = await Promise.all(responses.map(async response => (await response.clone().json()).intake.id));
        assert.deepEqual(ids, [body.registration_id, body.registration_id]);
        assert.equal((await database.prepare('SELECT count(*) AS total FROM physical_intakes').first()).total, 1);
        assert.equal((await database.prepare('SELECT count(*) AS total FROM physical_intake_receipts').first()).total, 1);
        assert.equal((await database.prepare("SELECT count(*) AS total FROM audit_events WHERE event_type='physical_intake.registered'").first()).total, 1);
        const changed = await post('/registrations', {...body, first_name:'Different'});
        assert.equal(changed.status, 409);
        assert.equal((await changed.json()).error.code, 'REGISTRATION_CONFLICT');
        const registration=await responses[0].json();const receipt=registration.receipts[0];
        const pdf=await PDFDocument.create();pdf.addPage([595.28,841.89]);const bytes=await pdf.save();
        const upload=()=>portRequest(context,`${BASE}/${registration.intake.id}/receipts/${receipt.id}/content`,{method:'PUT',cookie:context.staffCookie,headers:{'Content-Type':'application/pdf'},body:bytes});
        assert.equal((await upload()).status,200);assert.equal((await upload()).status,200);
        await database.prepare("INSERT INTO printer_heartbeats(printer_id,runner_id,health,printer_name,seen_at,settings_protocol) VALUES('native','agent','ready','Synthetic',?,3)").bind(new Date().toISOString()).run();
        const creationId=crypto.randomUUID();const printPath=`/${registration.intake.id}/receipts/${receipt.id}/print`;
        const printed=await post(printPath,{creation_id:creationId,decision:'print'});
        assert.equal(printed.status,200,await printed.clone().text());assert.equal((await printed.json()).status,'queued');
        assert.equal((await post(printPath,{creation_id:creationId,decision:'print'})).status,200);
        assert.equal((await database.prepare('SELECT count(*) AS total FROM print_jobs').first()).total,1);
        const attempt=await database.prepare('SELECT * FROM physical_receipt_print_attempts').first();
        await database.prepare("UPDATE print_jobs SET status='submission_started',submission_started_at=? WHERE id=?").bind(new Date().toISOString(),attempt.job_id).run();
        await database.prepare('DELETE FROM print_jobs WHERE id=?').bind(attempt.job_id).run();
        const durable=await database.prepare('SELECT * FROM physical_receipt_print_attempts').first();assert.equal(durable.status,'unknown');assert.equal(durable.blocks_new_attempt,1);
        assert.equal((await documents.list({prefix:'receipts/'})).objects.length,1);
    } finally {await runtime.dispose();}
});
