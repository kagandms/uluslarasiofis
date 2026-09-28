import assert from 'node:assert/strict';
import test from 'node:test';
import { readStaffSessionState } from '../src/staff/auth.js';

test('staff session accepts only the authenticated JSON response', async () => {
    const response = new Response(JSON.stringify({ authenticated: true }), { status: 200 });

    const state = await readStaffSessionState(response);

    assert.equal(state, 'authenticated');
});

test('staff session rejects a successful HTML fallback response', async () => {
    const response = new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });

    const state = await readStaffSessionState(response);

    assert.equal(state, 'error');
});

test('staff session reports an unauthenticated API response', async () => {
    const response = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

    const state = await readStaffSessionState(response);

    assert.equal(state, 'unauthenticated');
});
