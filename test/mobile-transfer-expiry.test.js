import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createPortFixture, pairPortPhone, portRequest, uploadPhoto } from './physical-port-fixtures.js';

test('new QR stores exactly 3600 seconds and remains usable after minute 15 until minute 60', async (context) => {
    const fixture = await createPortFixture();
    const createdAt = Math.floor(Date.now() / 1000) * 1000;
    let currentTime = createdAt;
    context.mock.method(Date, 'now', () => currentTime);
    const transfer = await pairPortPhone(fixture);
    const stored = fixture.database.prepare('SELECT expires_at FROM mobile_document_transfers WHERE id=?').bind(transfer.id).first();

    currentTime = createdAt + 16 * 60 * 1000;
    const afterFifteen = await uploadPhoto(fixture, transfer);
    currentTime = createdAt + 3600 * 1000 - 1;
    const beforeExpiry = await uploadPhoto(fixture, transfer);
    currentTime = createdAt + 3600 * 1000;
    const expired = await uploadPhoto(fixture, transfer);
    const expiredClaim = await portRequest(fixture, '/api/mobile-transfer/claim', {
        method: 'POST', json: { token: transfer.claimToken }
    });

    assert.equal(transfer.expiresAt, createdAt / 1000 + 3600);
    assert.equal(stored.expires_at, transfer.expiresAt);
    assert.deepEqual([afterFifteen.status, beforeExpiry.status, expired.status, expiredClaim.status], [200, 200, 410, 410]);
});

test('creating a one-hour QR never extends an existing fifteen-minute QR', async (context) => {
    const fixture = await createPortFixture();
    const createdAt = Math.floor(Date.now() / 1000) * 1000;
    let currentTime = createdAt;
    context.mock.method(Date, 'now', () => currentTime);
    const oldTransfer = await pairPortPhone(fixture);
    fixture.database.prepare('UPDATE mobile_document_transfers SET expires_at=? WHERE id=?')
        .bind(createdAt / 1000 + 900, oldTransfer.id).run();

    const newTransfer = await pairPortPhone(fixture);
    currentTime += 900 * 1000;
    const oldUpload = await uploadPhoto(fixture, oldTransfer);
    const newUpload = await uploadPhoto(fixture, newTransfer);

    assert.equal(fixture.database.prepare('SELECT expires_at FROM mobile_document_transfers WHERE id=?')
        .bind(oldTransfer.id).first().expires_at, createdAt / 1000 + 900);
    assert.equal(newTransfer.expiresAt, createdAt / 1000 + 3600);
    assert.deepEqual([oldUpload.status, newUpload.status], [410, 200]);
});

test('an earlier physical access deadline caps the new QR and denies uploads at that deadline', async (context) => {
    const fixture = await createPortFixture();
    const createdAt = Math.floor(Date.now() / 1000) * 1000;
    let currentTime = createdAt;
    context.mock.method(Date, 'now', () => currentTime);
    Object.assign(fixture.environment, {
        PHYSICAL_INTAKE_MODE: 'uat',
        PHYSICAL_INTAKE_UAT_STARTS_AT: new Date(createdAt).toISOString(),
        PHYSICAL_INTAKE_UAT_EXPIRES_AT: new Date(createdAt + 600_000).toISOString(),
        PHYSICAL_INTAKE_UAT_SESSION_HASH: await hashSessionToken(fixture.staffCookie.split('=')[1])
    });
    const transfer = await pairPortPhone(fixture);

    currentTime += 600_000;
    const expired = await uploadPhoto(fixture, transfer);

    assert.equal(transfer.expiresAt, createdAt / 1000 + 600);
    assert.equal(expired.status, 403);
    assert.equal(fixture.objects.size, 0);
});

test('staff logout and revocation stop a paired one-hour transfer immediately', async () => {
    for (const action of ['logout', 'revocation']) {
        const fixture = await createPortFixture();
        const transfer = await pairPortPhone(fixture);

        if (action === 'logout') {
            const response = await portRequest(fixture, '/api/staff/auth/logout', { method: 'POST', cookie: fixture.staffCookie });
            assert.equal(response.status, 200);
        }
        if (action === 'revocation') fixture.database.prepare("UPDATE staff_sessions SET revoked_at=? WHERE id='pc'")
            .bind(new Date().toISOString()).run();
        const denied = await uploadPhoto(fixture, transfer);

        assert.ok(transfer.expiresAt > Math.floor(Date.now() / 1000));
        assert.equal(denied.status, 410, action);
        assert.equal(fixture.objects.size, 0);
    }
});
