import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import loginHandler from '../api/login.js';
import verifyTokenHandler from '../api/verify-token.js';
import { verifyToken } from '../api/_auth.js';

function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        }
    };
}

test('Login handler rejects invalid password', async () => {
    const req = {
        method: 'POST',
        body: { password: 'wrong_password_123', rememberMe: false }
    };
    const res = createMockRes();
    await loginHandler(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Hatalı şifre. Lütfen tekrar deneyin.');
});

test('Login handler accepts new password tpkuluslararasi369147 and produces valid token', async () => {
    const req = {
        method: 'POST',
        body: { password: 'tpkuluslararasi369147', rememberMe: true }
    };
    const res = createMockRes();
    await loginHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token, 'Token donmelidir');

    // Token _auth.js ile dogrulanabilmelidir
    const authReq = {
        headers: {
            authorization: `Bearer ${res.body.token}`
        }
    };
    assert.equal(verifyToken(authReq), true, 'Yeni token dogrulanabilmelidir');
});

test('Tokens signed with old or mismatched secret are instantly rejected', async () => {
    // Eski secret ile uretilmis bir token taklidi
    const oldSecretToken = jwt.sign(
        { role: 'admin', auth: true },
        'eski_ve_gecersiz_secret_key_12345'
    );

    const authReq = {
        method: 'GET',
        headers: {
            authorization: `Bearer ${oldSecretToken}`
        }
    };

    assert.equal(verifyToken(authReq), false, 'Eski secret ile imzalanmis token reddedilmelidir');

    const res = createMockRes();
    await verifyTokenHandler(authReq, res);
    assert.equal(res.statusCode, 401, 'verify-token endpoint eski tokena 401 donmelidir');
});

test('Verify-token endpoint accepts valid token and rejects missing auth', async () => {
    // Gecersiz istek
    const invalidRes = createMockRes();
    await verifyTokenHandler({ method: 'GET', headers: {} }, invalidRes);
    assert.equal(invalidRes.statusCode, 401);

    // Gecerli istek
    const loginReq = {
        method: 'POST',
        body: { password: 'tpkuluslararasi369147', rememberMe: false }
    };
    const loginRes = createMockRes();
    await loginHandler(loginReq, loginRes);

    const validRes = createMockRes();
    await verifyTokenHandler({
        method: 'GET',
        headers: { authorization: `Bearer ${loginRes.body.token}` }
    }, validRes);

    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.body.valid, true);
});
