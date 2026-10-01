import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResubmissionUploadIntent, finalizeResubmissionUpload, lookupApplicationTracking,
    readCurrentApplicationTracking, readCurrentResubmissionEligibility, submitCurrentApplication } from '../src/public/applicationApi.js';

test('submit API uses the owner session POST and returns the student-safe application', async (context) => {
    const application = { status: 'submitted', student_number: '2026123456' };
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(
        JSON.stringify({ application }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));

    const result = await submitCurrentApplication();

    assert.deepEqual(result, application);
    assert.equal(fetchMock.mock.calls.length, 1);
    const [path, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(path, '/api/public/applications/current/submit');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.body, undefined);
});

test('tracking API uses only the same-origin owner session and sends no application selector', async (context) => {
    const tracking = { application: { student_number: 'TRACK-1' }, documents: [] };
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(
        JSON.stringify(tracking),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));

    const result = await readCurrentApplicationTracking();

    assert.deepEqual(result, tracking);
    const [path, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(path, '/api/public/applications/current/tracking');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.body, undefined);
});

test('resubmission API sends only stable document code and safe file metadata for intent creation', async (context) => {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(
        JSON.stringify({ upload: { intent_id: 'opaque-intent' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
    ));
    const file = { name: 'passport.pdf', type: 'application/pdf', size: 10 };

    await createResubmissionUploadIntent('passport', file);

    const [path, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(path, '/api/public/applications/current/documents/resubmission-upload-intent');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(options.body), {
        code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 10
    });
    assert.doesNotMatch(options.body, /application_id|document_record_id|revision_id|student_number/i);
});

test('resubmission eligibility and finalize use dedicated owner-session endpoints', async (context) => {
    const fetchMock = context.mock.method(globalThis, 'fetch', async (path) => {
        const payload = String(path).endsWith('resubmission-finalize')
            ? { document: { code: 'passport', upload_status: 'finalized' } }
            : { documents: [{ code: 'passport' }] };
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    assert.deepEqual(await readCurrentResubmissionEligibility(), { documents: [{ code: 'passport' }] });
    assert.deepEqual(await finalizeResubmissionUpload('opaque-intent'), { code: 'passport', upload_status: 'finalized' });
    assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/public/applications/current/documents/resubmission-eligibility');
    const [path, options] = fetchMock.mock.calls[1].arguments;
    assert.equal(path, '/api/public/applications/current/documents/resubmission-finalize');
    assert.deepEqual(JSON.parse(options.body), { intent_id: 'opaque-intent' });
    assert.doesNotMatch(options.body, /application_id|document_record_id|revision_id|student_number/i);
});

test('public lookup remains a separate read-only API call', async (context) => {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(
        JSON.stringify({ found: false, application: null, documents: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));

    await lookupApplicationTracking('LOOKUP-ONLY');

    const [path, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(path, '/api/public/applications/tracking-lookup');
    assert.deepEqual(JSON.parse(options.body), { student_number: 'LOOKUP-ONLY' });
    assert.equal(fetchMock.mock.calls.length, 1);
});
