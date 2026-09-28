import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import loginHandler from '../api/login.js';
import logoutHandler from '../api/logout.js';
import sessionHandler from '../api/session.js';
import addTebligatHandler from '../api/add-tebligat.js';
import getAllTebligatHandler from '../api/get-all-tebligat.js';
import removeTebligatHandler from '../api/remove-tebligat.js';
import searchTebligatHandler from '../api/search-tebligat.js';
import unmarkTebligatHandler from '../api/unmark-tebligat.js';
import updateTebligatHandler from '../api/update-tebligat.js';
import ocrHandler from '../api/ocr.js';
import { verifyToken } from '../api/_auth.js';

const TEST_PASSWORD = 'test-only-password';
const TEST_SECRET = 'test-only-secret-with-sufficient-length';
const originalAuthEnvironment = {
    sitePassword: process.env.SITE_PASSWORD,
    jwtSecret: process.env.JWT_SECRET
};

function createResponse() {
    return {
        statusCode: 200,
        body: undefined,
        headers: {},
        status(statusCode) {
            this.statusCode = statusCode;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        }
    };
}

function signSession() {
    return jwt.sign({ role: 'staff', auth: true }, TEST_SECRET, { expiresIn: '1h' });
}

test.beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.SITE_PASSWORD = TEST_PASSWORD;
});

test.afterEach(() => {
    if (originalAuthEnvironment.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalAuthEnvironment.jwtSecret;
    if (originalAuthEnvironment.sitePassword === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = originalAuthEnvironment.sitePassword;
});

test('staff auth accepts an HttpOnly session cookie without exposing bearer tokens', () => {
    delete process.env.SITE_PASSWORD;
    const request = { headers: { cookie: `staff_session=${signSession()}` } };

    assert.equal(verifyToken(request), true);
});

test('staff auth rejects bearer tokens and requests without a session cookie', () => {
    const request = { headers: { authorization: `Bearer ${signSession()}` } };

    assert.equal(verifyToken(request), false);
    assert.equal(verifyToken({ headers: {} }), false);
});

test('staff auth reports missing signing configuration separately', () => {
    delete process.env.JWT_SECRET;

    assert.equal(verifyToken({ headers: {} }), 'MISSING_CONFIG');
});

test('staff auth rejects an undersized signing secret as missing configuration', () => {
    process.env.JWT_SECRET = 'short';

    assert.equal(verifyToken({ headers: {} }), 'MISSING_CONFIG');
});

test('login sets a secure HttpOnly cookie and returns no token to JavaScript', async () => {
    const response = createResponse();

    await loginHandler({
        method: 'POST',
        headers: { origin: 'http://localhost:5173', host: 'localhost:5173' },
        body: { password: TEST_PASSWORD, rememberMe: false }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { success: true });
    assert.match(response.headers['set-cookie'], /^staff_session=.+; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/);
});

test('login clears the session cookie when configured secrets are missing', async () => {
    delete process.env.JWT_SECRET;
    const response = createResponse();

    await loginHandler({
        method: 'POST',
        headers: { origin: 'http://localhost:5173', host: 'localhost:5173' },
        body: { password: TEST_PASSWORD }
    }, response);

    assert.equal(response.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(response.body), /JWT_SECRET|stack|undefined/i);
});

test('session endpoint authenticates only the session cookie', async () => {
    const response = createResponse();

    await sessionHandler({ method: 'GET', headers: { cookie: `staff_session=${signSession()}` } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { authenticated: true });
});

test('logout revokes the browser cookie', async () => {
    const response = createResponse();

    await logoutHandler({
        method: 'POST',
        headers: { origin: 'http://localhost:5173', host: 'localhost:5173' }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { success: true });
    assert.match(response.headers['set-cookie'], /^staff_session=; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=0$/);
});

test('state-changing APIs reject cross-origin requests before calling upstream services', async () => {
    const originalFetch = globalThis.fetch;
    let upstreamCalled = false;
    globalThis.fetch = async () => {
        upstreamCalled = true;
        return { ok: true, status: 200, text: async () => '{"success":true}' };
    };

    try {
        const response = createResponse();
        await addTebligatHandler({
            method: 'POST',
            headers: {
                cookie: `staff_session=${signSession()}`,
                origin: 'https://attacker.example',
                host: 'portal.example'
            },
            body: { sayfa: '01.01.2026', isim: 'Test' }
        }, response);

        assert.equal(response.statusCode, 403);
        assert.equal(upstreamCalled, false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('every protected endpoint rejects missing sessions before calling upstream services', async () => {
    const upstreamFetch = globalThis.fetch;
    let upstreamCalled = false;
    globalThis.fetch = async () => {
        upstreamCalled = true;
        return { ok: true, status: 200, text: async () => '{"success":true}' };
    };

    const protectedEndpoints = [
        [getAllTebligatHandler, { method: 'GET', headers: {}, query: {} }],
        [searchTebligatHandler, { method: 'GET', headers: {}, query: { q: 'test', year: '2026' } }],
        [addTebligatHandler, { method: 'POST', headers: {}, body: { sayfa: '01.01.2026', isim: 'Test' } }],
        [updateTebligatHandler, { method: 'POST', headers: {}, body: { sayfa: '01.01.2026', isim: 'Test', no: '1' } }],
        [unmarkTebligatHandler, { method: 'POST', headers: {}, body: { sayfa: '01.01.2026', isim: 'Test', no: '1' } }],
        [removeTebligatHandler, { method: 'POST', headers: {}, body: { sayfa: '01.01.2026', isim: 'Test', no: '1' } }],
        [ocrHandler, { method: 'POST', headers: {}, body: {} }]
    ];

    try {
        for (const [handler, request] of protectedEndpoints) {
            const response = createResponse();
            await handler(request, response);
            assert.equal(response.statusCode, 401);
        }
    } finally {
        globalThis.fetch = upstreamFetch;
    }

    assert.equal(upstreamCalled, false);
});
