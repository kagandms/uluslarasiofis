import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken, readCookie } from '../src/server/auth/sessionToken.js';
import { readPhysicalGate } from '../src/server/config/physical-intake-gate.js';
import { createPortFixture, pairPortPhone, portRequest, uploadPhoto } from './physical-port-fixtures.js';

async function enableUat(context, seconds = 600) {
    context.environment.PHYSICAL_INTAKE_MODE = 'uat';
    context.environment.PHYSICAL_INTAKE_UAT_STARTS_AT = new Date().toISOString();
    context.environment.PHYSICAL_INTAKE_UAT_EXPIRES_AT = new Date(Date.now() + seconds * 1000).toISOString();
    context.environment.PHYSICAL_INTAKE_UAT_SESSION_HASH = await hashSessionToken(context.staffCookie.split('=')[1]);
}

test('missing, malformed, future, expired and oversized gate windows fail closed', () => {
    for (const mode of [undefined, '', 'true', 'ON', 'uat', 'off']) {
        assert.equal(readPhysicalGate({ APP_ENV: 'production', PHYSICAL_INTAKE_MODE: mode }).mode, 'off');
    }
    const settings = { APP_ENV: 'production', PHYSICAL_INTAKE_MODE: 'uat', PHYSICAL_INTAKE_UAT_SESSION_HASH: 'a'.repeat(64) };
    for (const [start, end] of [[-1, 3601], [1, 600], [-600, -1], [0, 0]]) {
        assert.equal(readPhysicalGate({ ...settings, PHYSICAL_INTAKE_UAT_STARTS_AT: new Date(Date.now() + start * 1000).toISOString(),
            PHYSICAL_INTAKE_UAT_EXPIRES_AT: new Date(Date.now() + end * 1000).toISOString() }).mode, 'off');
    }
});

test('default OFF denies new physical records and QR while online authentication still works', async () => {
    const context = await createPortFixture();
    delete context.environment.PHYSICAL_INTAKE_MODE;

    const physical = await portRequest(context, '/api/staff/physical-intakes/query', { method: 'POST', cookie: context.staffCookie, json: {} });
    const qr = await portRequest(context, '/api/staff/mobile-transfers', { method: 'POST', cookie: context.staffCookie });
    const online = await portRequest(context, '/api/staff/applications/query', { method: 'POST', cookie: context.staffCookie, json: {} });

    assert.equal(physical.status, 403);
    assert.equal(qr.status, 403);
    assert.equal(online.status, 200, await online.clone().text());
    assert.equal(context.database.prepare('SELECT count(*) AS total FROM mobile_document_transfers').first().total, 0);
    assert.equal(context.objects.size, 0);
});

test('UAT admits only the operator-approved PC session, including shared-account second computers', async () => {
    const context = await createPortFixture();
    await enableUat(context, 120);

    const owner = await portRequest(context, '/api/staff/mobile-transfers', { method: 'POST', cookie: context.staffCookie });
    const other = await portRequest(context, '/api/staff/mobile-transfers', { method: 'POST', cookie: context.otherCookie });
    const otherPhysical = await portRequest(context, '/api/staff/physical-intakes/query', { method: 'POST', cookie: context.otherCookie, json: {} });

    assert.equal(owner.status, 200);
    assert.equal(other.status, 403);
    assert.equal(otherPhysical.status, 403);
    assert.ok((await owner.json()).expiresAt * 1000 <= Date.parse(context.environment.PHYSICAL_INTAKE_UAT_EXPIRES_AT));
});

test('the candidate endpoint requires authentication and same-origin and grants no authority', async () => {
    const context = await createPortFixture();
    delete context.environment.PHYSICAL_INTAKE_MODE;

    const anonymous = await portRequest(context, '/api/staff/physical-access/session', { method: 'POST' });
    const foreign = await portRequest(context, '/api/staff/physical-access/session', { method: 'POST', cookie: context.staffCookie, headers: { Origin: 'https://foreign.test' } });
    const candidate = await portRequest(context, '/api/staff/physical-access/session', { method: 'POST', cookie: context.staffCookie });
    const payload = await candidate.json();

    assert.equal(anonymous.status, 401);
    assert.equal(foreign.status, 403);
    assert.equal(candidate.status, 200);
    assert.equal(payload.allowed, false);
    assert.equal(payload.candidateSessionHash, await hashSessionToken(context.staffCookie.split('=')[1]));
    assert.ok(!JSON.stringify(payload).includes(context.staffCookie.split('=')[1]));
});

test('UAT expiry, OFF and a changed selected session revoke previously paired phones', async () => {
    for (const action of ['expired', 'off', 'other']) {
        const context = await createPortFixture();
        await enableUat(context);
        const transfer = await pairPortPhone(context);
        if (action === 'expired') context.environment.PHYSICAL_INTAKE_UAT_EXPIRES_AT = new Date(Date.now() - 1).toISOString();
        if (action === 'off') context.environment.PHYSICAL_INTAKE_MODE = 'off';
        if (action === 'other') context.environment.PHYSICAL_INTAKE_UAT_SESSION_HASH = 'b'.repeat(64);

        const upload = await uploadPhoto(context, transfer);

        assert.equal(upload.status, 403, action);
        assert.equal(context.objects.size, 0);
    }
});

test('a copied QR gives no upload authority before confirmation by the creating PC', async () => {
    const context = await createPortFixture();
    const created = await portRequest(context, '/api/staff/mobile-transfers', { method: 'POST', cookie: context.staffCookie });
    const transfer = await created.json();
    const claim = await portRequest(context, '/api/mobile-transfer/claim', { method: 'POST', json: { token: transfer.claimToken } });
    const phone = await claim.json();
    transfer.phoneCookie = claim.headers.get('Set-Cookie').split(';')[0];

    const premature = await uploadPhoto(context, transfer);
    const other = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}/approve`, { method: 'POST', cookie: context.otherCookie, json: { code: phone.pairingCode } });
    const wrong = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}/approve`, { method: 'POST', cookie: context.staffCookie, json: { code: '000000' } });
    const owner = await portRequest(context, `/api/staff/mobile-transfers/${transfer.id}/approve`, { method: 'POST', cookie: context.staffCookie, json: { code: phone.pairingCode } });

    assert.equal(premature.status, 409);
    assert.equal(other.status, 410);
    assert.equal(wrong.status, 409);
    assert.equal(owner.status, 200);
    assert.equal((await uploadPhoto(context, transfer)).status, 200);
    assert.equal(readCookie(new Request('https://portal.test', { headers: { Cookie: transfer.phoneCookie } }), 'mobile_transfer_session').length, 43);
});

test('OFF keeps the existing scanner usable before any physical security migration', async () => {
    const context = await createPortFixture();
    delete context.environment.PHYSICAL_INTAKE_MODE;
    context.database.exec('DROP TRIGGER physical_insert_scan_guard; DROP VIEW staff_scan_files; DROP TABLE staff_document_scan_jobs;');

    const scanner = await portRequest(context, '/api/scanner/claim', { method: 'POST', json: { runner_id: 'synthetic' }, headers: { Authorization: `Bearer ${context.environment.SCANNER_SECRET}` } });

    assert.equal(scanner.status, 200, await scanner.clone().text());
    assert.equal((await scanner.json()).job, null);
});

test('an accidentally opened gate without its schema cannot break the original scanner queue', async () => {
    const context = await createPortFixture();
    context.database.exec('DROP TRIGGER physical_insert_scan_guard; DROP VIEW staff_scan_files; DROP TABLE staff_document_scan_jobs;');

    const scanner = await portRequest(context, '/api/scanner/claim', { method: 'POST', json: { runner_id: 'synthetic' }, headers: { Authorization: `Bearer ${context.environment.SCANNER_SECRET}` } });
    const qr = await portRequest(context, '/api/staff/mobile-transfers', { method: 'POST', cookie: context.staffCookie });

    assert.equal(scanner.status, 200);
    assert.equal(qr.status, 503);
    assert.equal((await qr.json()).error.code, 'PHYSICAL_SCHEMA_NOT_READY');
});
