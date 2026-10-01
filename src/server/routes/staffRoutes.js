import { ApiError } from '../domain/errors.js';
import { createOpaqueSessionToken, createSessionCookie, createExpiredSessionCookie, getSessionCookieName, hashSessionToken, readCookie } from '../auth/sessionToken.js';
import { deriveStaffPasswordHash, verifyStaffPassword } from '../auth/passwordHash.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readSharedStaffUsername } from '../config/sharedStaffAccount.js';
import { STAFF_IDLE_TIMEOUT_SECONDS } from '../config/sessionPolicy.js';
import { routeResult } from '../http/routeResult.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { normalizeUsername } from '../repositories/d1/staffRepository.js';
import { readJsonBody } from '../http/requestBody.js';
import { createAuditEvent, createRepositories, requireMethod, requireSameOrigin, requireText } from './shared.js';

const STAFF_SESSION_SECONDS = 12 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 5;

async function hashLoginIdentity(request, normalizedUsername) {
    const address = request.headers.get('CF-Connecting-IP') || 'unknown-client';
    const value = new TextEncoder().encode(`${address}\u0000${normalizedUsername}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function publicStaff(staff) {
    return {
        id: staff.id,
        username: staff.username,
        displayName: staff.display_name,
        role: staff.role
    };
}

function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 12 || new TextEncoder().encode(password).length > 1024) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Şifre en az 12 karakter olmalı ve izin verilen uzunluğu aşmamalıdır.');
    }
    return password;
}

async function findLoginStaff(repositories, username) {
    try {
        return await repositories.staff.findByUsername(username);
    } catch {
        return null;
    }
}

function readLoginInput(body) {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length > 64 || password.length === 0 || password.length > 1024) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Kullanıcı adı veya şifre hatalı. Bilgilerinizi kontrol edip tekrar deneyin.');
    }
    return { username, password, rememberMe: body.rememberMe === true };
}

async function authenticateStaff(repositories, request, { username, password }, sharedUsername) {
    const isSharedAccount = isConfiguredUsername(username, sharedUsername);
    const staff = isSharedAccount ? await findLoginStaff(repositories, username) : null;
    const loginKey = await hashLoginIdentity(request, staff?.normalized_username || username.toLocaleLowerCase('en-US'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (await repositories.sessions.isLoginBlocked(loginKey, nowSeconds)) {
        throw new ApiError(429, 'RATE_LIMITED', 'Çok fazla başarısız giriş denemesi yapıldı. Bir süre sonra tekrar deneyin.', true);
    }
    const passwordMatches = await verifyStaffPassword(password, staff?.password_hash);
    if (!isSharedAccount || !staff || !staff.is_active || !passwordMatches) {
        await repositories.sessions.recordFailedLogin(loginKey, nowSeconds, {
            maxAttempts: MAX_LOGIN_ATTEMPTS, windowSeconds: LOGIN_WINDOW_SECONDS
        });
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Kullanıcı adı veya şifre hatalı. Bilgilerinizi kontrol edip tekrar deneyin.');
    }
    return { staff, loginKey };
}

function isConfiguredUsername(username, sharedUsername) {
    try {
        return normalizeUsername(username) === sharedUsername;
    } catch {
        return false;
    }
}

async function createStaffLoginSession(repositories, staff, requestId, maxAge) {
    const token = createOpaqueSessionToken();
    const createdAt = new Date().toISOString();
    await repositories.sessions.createStaffSession({
        id: crypto.randomUUID(), staffUserId: staff.id, tokenHash: await hashSessionToken(token),
        expiresAt: new Date(Date.now() + maxAge * 1000).toISOString(), createdAt
    });
    await repositories.staff.updateLastLogin(staff.id, createdAt);
    await createAuditEvent(repositories, {
        eventType: 'staff.login', actorType: 'staff', actorStaffId: staff.id, requestId,
        metadata: { role: staff.role, result: 'success' }
    });
    return token;
}

/**
 * Authenticates one D1-backed staff account and creates its secure session cookie.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation ID for the audit event.
 * @returns {Promise<object>} Route result with the safe staff profile and cookie.
 * @throws {ApiError} When validation, origin, credentials, or rate checks fail.
 */
export async function loginStaff(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const credentials = readLoginInput(await readJsonBody(request));
    const sharedUsername = readSharedStaffUsername(environment);
    const repositories = createRepositories(environment);
    const { staff, loginKey } = await authenticateStaff(repositories, request, credentials, sharedUsername);
    await repositories.sessions.clearLoginAttempts(loginKey);
    const maxAge = credentials.rememberMe ? REMEMBERED_SESSION_SECONDS : STAFF_SESSION_SECONDS;
    const token = await createStaffLoginSession(repositories, staff, requestId, maxAge);
    return routeResult({ success: true, authenticated: true, staff: publicStaff(staff) }, {
        cookie: createSessionCookie('staff', token, maxAge)
    });
}

/**
 * Returns the current D1-backed staff identity.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Safe authenticated staff profile.
 * @throws {ApiError} When the request method or session is invalid.
 */
export async function readStaffSession(request, environment) {
    requireMethod(request, 'GET');
    const staff = await requireStaff(request, environment);
    return { authenticated: true, staff };
}

/**
 * Revokes the current staff session and expires its browser cookie.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Route result with an expired session cookie.
 * @throws {ApiError} When the request method or origin is invalid.
 */
export async function logoutStaff(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const token = readCookie(request, getSessionCookieName('staff'));
    if (token && environment.DB) {
        const repositories = createD1Repositories(environment.DB);
        const revokedAt = new Date().toISOString();
        await repositories.sessions.revokeStaffSessionWithAudit({
            tokenHash: await hashSessionToken(token),
            revokedAt,
            idleCutoff: new Date(Date.now() - STAFF_IDLE_TIMEOUT_SECONDS * 1000).toISOString(),
            auditEventId: crypto.randomUUID(),
            requestId
        });
    }
    return routeResult({ success: true }, { cookie: createExpiredSessionCookie('staff') });
}

/**
 * Creates the first administrator through the one-time bootstrap token.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation ID for the audit event.
 * @returns {Promise<object>} Route result containing the safe administrator profile.
 * @throws {ApiError} When bootstrap is unauthorized, closed, or invalid.
 */
export async function bootstrapStaff(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const sharedUsername = readSharedStaffUsername(environment);
    if (!environment.STAFF_BOOTSTRAP_TOKEN || !constantTimeEqual(request.headers.get('X-Staff-Bootstrap-Token') || '', environment.STAFF_BOOTSTRAP_TOKEN)) {
        throw new ApiError(403, 'BOOTSTRAP_TOKEN_REQUIRED', 'İlk yetkili hesabı için geçerli kurulum anahtarı gerekli.');
    }
    const repositories = createRepositories(environment);
    if (await repositories.staff.hasBootstrapAdmin()) throw new ApiError(409, 'BOOTSTRAP_CLOSED', 'İlk yetkili hesabı daha önce oluşturuldu.');
    const body = await readJsonBody(request);
    const username = readUsername(body.username);
    if (!isConfiguredUsername(username, sharedUsername)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kurulum kullanıcı adı yapılandırılmış ortak hesapla eşleşmelidir.');
    }
    const passwordHash = await deriveStaffPasswordHash(validatePassword(body.password));
    const displayName = requireText(body.display_name, { field: 'Görünen ad', minLength: 1, maxLength: 120 });
    const createdAt = new Date().toISOString();
    try {
        const staff = await repositories.staff.createFirstAdmin({
            id: crypto.randomUUID(), username, passwordHash, displayName, createdAt, requestId
        });
        if (!staff) throw new ApiError(409, 'BOOTSTRAP_CLOSED', 'İlk yetkili hesabı daha önce oluşturuldu.');
        return routeResult({ user: publicStaff(staff) }, { status: 201 });
    } catch (error) {
        if (await repositories.staff.hasBootstrapAdmin()) throw new ApiError(409, 'BOOTSTRAP_CLOSED', 'İlk yetkili hesabı daha önce oluşturuldu.');
        if (/unique constraint/i.test(String(error?.message))) throw new ApiError(409, 'USERNAME_UNAVAILABLE', 'Bu kullanıcı adı kullanılamıyor.');
        throw error;
    }
}

function constantTimeEqual(first, second) {
    const left = new TextEncoder().encode(first);
    const right = new TextEncoder().encode(second);
    let difference = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
    return difference === 0;
}

function readUsername(value) {
    const username = requireText(value, { field: 'Kullanıcı adı', minLength: 3, maxLength: 64 });
    try {
        normalizeUsername(username);
    } catch {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kullanıcı adını kontrol edip tekrar deneyin.');
    }
    return username;
}
