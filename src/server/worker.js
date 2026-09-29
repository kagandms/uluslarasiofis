import { ApiError, RepositoryConfigurationError } from './domain/errors.js';
import { createRequestId, errorResponse, jsonResponse } from './http/apiResponse.js';
import { isRouteResult } from './http/routeResult.js';
import { createApplicationDraft, logoutApplication, readCurrentApplication, updateCurrentApplication } from './routes/applicationRoutes.js';
import { readPrivateDocument } from './routes/documentRoutes.js';
import { recognizeDocument } from './routes/ocrRoute.js';
import { bootstrapStaff, createStaffUser, listStaffUsers, loginStaff, logoutStaff, readStaffSession, updateStaffAccount } from './routes/staffRoutes.js';
import { handleTebligatRequest } from './routes/tebligatRoutes.js';

function apiErrorFromUnknown(error) {
    if (error instanceof ApiError) return error;
    if (error instanceof RepositoryConfigurationError) {
        return new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.', true);
    }
    return new ApiError(500, 'INTERNAL_ERROR', 'İşlem tamamlanamadı. Lütfen daha sonra tekrar deneyin.', true);
}

function safeRouteResponse(result, requestId) {
    if (result instanceof Response) {
        const headers = new Headers(result.headers);
        headers.set('X-Request-Id', requestId);
        if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
        return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
    }
    if (isRouteResult(result)) {
        const headers = result.cookie ? { 'Set-Cookie': result.cookie } : {};
        return jsonResponse(result.body, result.status, requestId, headers);
    }
    return jsonResponse(result ?? {}, 200, requestId);
}

async function routeStaffUsers(request, environment, requestId, pathname) {
    if (pathname === '/api/staff/users') {
        if (request.method === 'GET') return listStaffUsers(request, environment);
        return createStaffUser(request, environment, requestId);
    }
    const accountMatch = pathname.match(/^\/api\/staff\/users\/([^/]+)\/(password|active)$/);
    if (!accountMatch) return null;
    return updateStaffAccount(request, environment, requestId, decodeURIComponent(accountMatch[1]), accountMatch[2]);
}

async function routeApi(request, environment, requestId) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/staff/auth/login' || pathname === '/api/login') return loginStaff(request, environment, requestId);
    if (pathname === '/api/staff/auth/session' || pathname === '/api/session') return readStaffSession(request, environment);
    if (pathname === '/api/staff/auth/logout' || pathname === '/api/logout') return logoutStaff(request, environment);
    if (pathname === '/api/staff/auth/bootstrap') return bootstrapStaff(request, environment, requestId);
    if (pathname === '/api/public/applications') return createApplicationDraft(request, environment, requestId);
    if (pathname === '/api/public/applications/current') {
        if (request.method === 'PATCH') return updateCurrentApplication(request, environment, requestId);
        return readCurrentApplication(request, environment);
    }
    if (pathname === '/api/public/applications/logout') return logoutApplication(request, environment);
    const documentMatch = pathname.match(/^\/api\/staff\/documents\/([^/]+)\/content$/);
    if (documentMatch) return readPrivateDocument(request, environment, decodeURIComponent(documentMatch[1]));
    const userResult = await routeStaffUsers(request, environment, requestId, pathname);
    if (userResult) return userResult;
    if (pathname === '/api/ocr') return recognizeDocument(request, environment);
    if (pathname.startsWith('/api/') && [
        '/api/get-all-tebligat', '/api/search-tebligat', '/api/add-tebligat',
        '/api/update-tebligat', '/api/unmark-tebligat', '/api/remove-tebligat'
    ].includes(pathname)) return handleTebligatRequest(request, environment, pathname);
    throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
}

const worker = {
    async fetch(request, environment) {
        const requestId = createRequestId();
        const { pathname } = new URL(request.url);
        if (!pathname.startsWith('/api/')) {
            if (environment.ASSETS) return environment.ASSETS.fetch(request);
            return new Response('Not Found', { status: 404 });
        }

        try {
            return safeRouteResponse(await routeApi(request, environment, requestId), requestId);
        } catch (error) {
            const apiError = apiErrorFromUnknown(error);
            if (apiError.status >= 500) {
                console.error('Worker request failed.', {
                    requestId,
                    errorName: error?.name || 'UnknownError',
                    errorCode: apiError.code
                });
            }
            return errorResponse(requestId, apiError.status, apiError.code, apiError.message, apiError.retryable);
        }
    }
};

export default worker;
