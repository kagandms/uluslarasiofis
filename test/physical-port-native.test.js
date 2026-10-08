import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createPortFixture, pairPortPhone, portRequest, registerPortPdf, uploadPhoto } from './physical-port-fixtures.js';

test('native D1/R2 validated photo import and physical PDF access work without scanning', async () => {
    const runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true,
        script:'export default {fetch(){return new Response("local synthetic test")}};',
        compatibilityDate:'2026-10-01', d1Databases:['DB'], r2Buckets:['DOCUMENTS'] }));

    try {
        const database = await runtime.getD1Database('DB');
        const bucket = await runtime.getR2Bucket('DOCUMENTS');
        for (const filename of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
            const migration = readFileSync(new URL(`../migrations/${filename}`,import.meta.url),'utf8').replace(/--[^\n]*/g,'').replaceAll('\n',' ');
            await database.exec(migration);
        }
        const context = await createPortFixture(database, bucket);
        const transfer = await pairPortPhone(context);
        const photoId = crypto.randomUUID();
        const photos = await Promise.all([uploadPhoto(context,transfer,{id:photoId}),uploadPhoto(context,transfer,{id:photoId})]);
        assert.ok(photos.some(response=>response.status===200));
        assert.ok(photos.every(response=>[200,409].includes(response.status)));
        const photo = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}/files/${photoId}`, {cookie:context.staffCookie});
        assert.equal(photo.status,200,await photo.clone().text());
        const receipt = await registerPortPdf(context);

        const opened = await portRequest(context, `/api/staff/physical-intakes/${receipt.id}/files/${receipt.id}/download`,{cookie:context.staffCookie});
        const foreign = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}`,{cookie:context.otherCookie});

        assert.equal((await context.database.prepare('SELECT scan_status FROM physical_intake_files').first()).scan_status,'pending');
        assert.equal(opened.status,200,await opened.clone().text());
        assert.equal(foreign.status,410);
        assert.deepEqual(new Uint8Array(await opened.arrayBuffer()),receipt.bytes);
    } finally { await runtime.dispose(); }
});
