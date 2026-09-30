import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submitCurrentApplication } from '../src/public/applicationApi.js';

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
