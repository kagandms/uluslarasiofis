import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPortFixture, pairPortPhone, portRequest, uploadPhoto } from './physical-port-fixtures.js';

test('ending an empty transfer invalidates the phone and the old claim token', async () => {
    const fixture = await createPortFixture();
    const transfer = await pairPortPhone(fixture);

    const closed = await portRequest(fixture, `/api/staff/mobile-transfers/${transfer.id}`, {
        method: 'DELETE', cookie: fixture.staffCookie
    });
    const phone = await portRequest(fixture, `/api/mobile-transfer/${transfer.id}/batch`, { cookie: transfer.phoneCookie });
    const claim = await portRequest(fixture, '/api/mobile-transfer/claim', {
        method: 'POST', json: { token: transfer.claimToken }
    });

    assert.equal(closed.status, 200);
    assert.equal(phone.status, 410);
    assert.equal(claim.status, 410);
    assert.equal((await uploadPhoto(fixture, transfer)).status, 410);
    assert.equal(fixture.objects.size, 0);
    assert.notEqual((await pairPortPhone(fixture)).id, transfer.id);
});

test('ending a transfer cannot discard finalized or uploading photos', async () => {
    for (const status of ['finalized', 'uploading']) {
        const fixture = await createPortFixture();
        const transfer = await pairPortPhone(fixture);
        const photoId = crypto.randomUUID();
        assert.equal((await uploadPhoto(fixture, transfer, { id: photoId })).status, 200);
        await fixture.database.prepare('UPDATE mobile_document_transfer_files SET upload_status=? WHERE id=?')
            .bind(status, photoId).run();

        const closed = await portRequest(fixture, `/api/staff/mobile-transfers/${transfer.id}`, {
            method: 'DELETE', cookie: fixture.staffCookie
        });

        assert.equal(closed.status, 409, status);
        assert.equal((await closed.json()).error.code, 'BATCH_PENDING_PHOTOS');
        assert.equal(fixture.objects.size, 1);
        assert.equal((await portRequest(fixture, `/api/mobile-transfer/${transfer.id}/batch`, {
            cookie: transfer.phoneCookie
        })).status, 200);
    }
});

test('another PC cannot end the owner transfer', async () => {
    const fixture = await createPortFixture();
    const transfer = await pairPortPhone(fixture);

    const denied = await portRequest(fixture, `/api/staff/mobile-transfers/${transfer.id}`, {
        method: 'DELETE', cookie: fixture.otherCookie
    });

    assert.equal(denied.status, 410);
    assert.equal((await portRequest(fixture, `/api/mobile-transfer/${transfer.id}/batch`, {
        cookie: transfer.phoneCookie
    })).status, 200);
});
