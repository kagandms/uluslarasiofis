import { readPhysicalAccess } from './routes/physical-access-routes.js';
import { handlePhysicalIntakes } from './routes/physical-intake-routes.js';
import { handleMobileTransfer, cleanupMobileTransfers } from './routes/mobile-transfer-routes.js';
import { requirePrintRequestAccess } from './services/print-access.js';
import { readStaffPrintUatStatus, uploadPrintUatDocument } from './routes/print-uat-routes.js';
import { handleScannerRequest, handleStaffScannerRequest, prioritizeStaffDocumentScan } from './routes/scanner-routes.js';
import { ApiError, RepositoryConfigurationError } from './domain/errors.js';
import { createRequestId, errorResponse, jsonResponse } from './http/apiResponse.js';
import { isRouteResult } from './http/routeResult.js';
import { createCurrentStudentDocumentUploadIntent, deleteCurrentStudentDocument, finalizeCurrentStudentDocument, readCurrentStudentDocumentRequirements } from './routes/applicationDocumentRoutes.js';
import { acceptCurrentApplicationDeclaration, acceptCurrentContactAcknowledgement, accessApplicationWithReference, autosaveCurrentApplication, createApplicationDraft, logoutApplication, readCurrentApplication, readCurrentApplicationStatus, regenerateCurrentAccessCode, resetStaffApplicationAccessCode, submitCurrentApplication, updateCurrentApplication } from './routes/applicationRoutes.js';
import { lookupApplicationTracking, readCurrentApplicationTracking } from './routes/applicationTrackingRoutes.js';
import { readPrivateDocument } from './routes/documentRoutes.js';
import { createCurrentResubmissionUploadIntent, finalizeCurrentResubmissionUpload, readCurrentResubmissionEligibility } from './routes/resubmissionUploadRoutes.js';
import { createStaffDocumentPreview, createStaffApplicationArchiveManifest, downloadStaffApplicationDocument,
    streamStaffApplicationArchiveFile } from './routes/staffDocumentAccessRoutes.js';
import { queryStaffApplications, readStaffApplicationDetail } from './routes/staffApplicationRoutes.js';
import { approveStaffApplicationDocument, unapproveStaffApplicationDocument, requestStaffDocumentResubmission, transitionStaffApplicationStatus } from './routes/staffReviewRoutes.js';
import { recognizeDocument } from './routes/ocrRoute.js';
import { bootstrapStaff, loginStaff, logoutStaff, readStaffSession } from './routes/staffRoutes.js';
import { handleTebligatRequest } from './routes/tebligatRoutes.js';
import { readCurrentNotificationPreferences, updateCurrentNotificationPreferences } from './routes/applicantNotificationPreferenceRoutes.js';
import { enqueueStaffNotification, previewStaffNotification, readStaffNotificationHistory,
    retryStaffNotification } from './routes/staffNotificationRoutes.js';
import { handleMetaWhatsAppWebhook } from './services/metaWhatsAppWebhook.js';
import { createMetaWhatsAppProvider } from './services/metaWhatsAppProvider.js';
import { runNotificationDispatchBatch } from './services/notificationDispatcher.js';
import { handleStaffApplicationDeletion } from './routes/staffApplicationDeletionRoutes.js';
import { backupD1ToR2, getLatestBackupMetadata } from './services/d1BackupService.js';
import { requireStaff } from './auth/staffAuth.js';
import { requireMethod } from './routes/shared.js';
import { createPublicPrintUploadIntent, finalizePublicPrintUpload, readPublicPrintJobStatus,
    readPublicPrintStatus } from './routes/printRoutes.js';
import { handlePrinterRequest, readStaffPrintStatus } from './routes/printerRoutes.js';
import { runPrintCleanup } from './services/printCleanupService.js';

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

function withMetaWhatsAppProvider(environment) {
    if (environment.NOTIFICATION_PROVIDERS?.whatsapp) return environment;
    return { ...environment, NOTIFICATION_PROVIDERS: {
        ...environment.NOTIFICATION_PROVIDERS,
        whatsapp: createMetaWhatsAppProvider(environment)
    } };
}

async function routeApi(request, environment, requestId) {
    const { pathname } = new URL(request.url);
    if (['/api/staff/physical-access', '/api/staff/physical-access/session'].includes(pathname)) return readPhysicalAccess(request, environment);
    if (pathname.startsWith('/api/staff/physical-intakes')) return handlePhysicalIntakes(request, environment, requestId);
    if (pathname.startsWith('/api/staff/mobile-transfers') || pathname.startsWith('/api/mobile-transfer/')) return handleMobileTransfer(request, environment);
    await requirePrintRequestAccess(request, environment);
    if (pathname.startsWith('/api/printer/')) return handlePrinterRequest(request, environment);
    if (pathname === '/api/public/print/status') return readPublicPrintStatus(request, environment);
    if (pathname === '/api/staff/print/uat/status') return readStaffPrintUatStatus(request, environment);
    const uatUploadMatch = pathname.match(/^\/api\/public\/print\/jobs\/([A-Za-z0-9_-]{1,64})\/upload$/);
    if (uatUploadMatch) return uploadPrintUatDocument(request, environment, uatUploadMatch[1]);
    if (pathname === '/api/public/print/upload-intents') return createPublicPrintUploadIntent(request, environment);
    if (pathname === '/api/public/print/jobs/status') return readPublicPrintJobStatus(request, environment);
    const printFinalizeMatch = pathname.match(/^\/api\/public\/print\/jobs\/([A-Za-z0-9_-]{1,64})\/finalize$/);
    if (printFinalizeMatch) return finalizePublicPrintUpload(request, environment, printFinalizeMatch[1]);
    if (pathname === '/api/staff/print/status') return readStaffPrintStatus(request, environment);
    if (pathname.startsWith('/api/scanner/')) return handleScannerRequest(request, environment);
    const documentScanMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/([^/]+)\/scan$/);
    if (documentScanMatch) {
        let applicationId;
        let documentCode;
        try {
            applicationId = decodeURIComponent(documentScanMatch[1]);
            documentCode = decodeURIComponent(documentScanMatch[2]);
        } catch {
            throw new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya erişilemiyor.');
        }
        return prioritizeStaffDocumentScan(request, environment, applicationId, documentCode, requestId);
    }
    if (['/api/staff/scanner/status', '/api/staff/scanner/retry'].includes(pathname)) return handleStaffScannerRequest(request, environment, requestId);
    const deletionMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/(archive|restore|purge)$/);
    if (deletionMatch) {
        let applicationId;
        try { applicationId = decodeURIComponent(deletionMatch[1]); }
        catch { throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.'); }
        return handleStaffApplicationDeletion(request, environment, applicationId, deletionMatch[2], requestId);
    }
    if (pathname === '/api/webhooks/whatsapp') {
        return handleMetaWhatsAppWebhook(request, environment, requestId);
    }
    const archiveManifestMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/archive-manifest$/);
    if (archiveManifestMatch) {
        let applicationId;
        try { applicationId = decodeURIComponent(archiveManifestMatch[1]); }
        catch { throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.'); }
        return createStaffApplicationArchiveManifest({ request, environment, applicationId, requestId });
    }
    const archiveFileMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/([^/]+)\/archive-file$/);
    if (archiveFileMatch) {
        let applicationId;
        let documentCode;
        try {
            applicationId = decodeURIComponent(archiveFileMatch[1]);
            documentCode = decodeURIComponent(archiveFileMatch[2]);
        } catch { throw new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya erişilemiyor.'); }
        return streamStaffApplicationArchiveFile({ request, environment, applicationId, code: documentCode, requestId });
    }
    const notificationRetryMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/notifications\/([^/]+)\/retry$/);
    if (notificationRetryMatch) {
        let applicationId;
        let notificationId;
        try {
            applicationId = decodeURIComponent(notificationRetryMatch[1]);
            notificationId = decodeURIComponent(notificationRetryMatch[2]);
        } catch { throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Bildirim kaydı bulunamadı.'); }
        return retryStaffNotification({ request, environment, applicationId, notificationId, requestId });
    }
    const staffNotificationMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/notifications(?:\/(preview))?$/);
    if (staffNotificationMatch) {
        let applicationId;
        try { applicationId = decodeURIComponent(staffNotificationMatch[1]); }
        catch { throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.'); }
        if (staffNotificationMatch[2]) {
            return previewStaffNotification({ request, environment: withMetaWhatsAppProvider(environment), applicationId, requestId });
        }
        if (request.method === 'GET') return readStaffNotificationHistory({ request, environment, applicationId });
        return enqueueStaffNotification({ request, environment: withMetaWhatsAppProvider(environment), applicationId, requestId });
    }
    if (pathname === '/api/staff/auth/login' || pathname === '/api/login') return loginStaff(request, environment, requestId);
    if (pathname === '/api/staff/auth/session' || pathname === '/api/session') return readStaffSession(request, environment);
    if (pathname === '/api/staff/auth/logout' || pathname === '/api/logout') return logoutStaff(request, environment, requestId);
    if (pathname === '/api/staff/auth/bootstrap') return bootstrapStaff(request, environment, requestId);
    if (pathname === '/api/staff/applications/query') return queryStaffApplications(request, environment);
    const staffStatusMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/status$/);
    if (staffStatusMatch) {
        let applicationId;
        try {
            applicationId = decodeURIComponent(staffStatusMatch[1]);
        } catch {
            throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
        }
        return transitionStaffApplicationStatus({ request, environment, applicationId, requestId });
    }
    const staffDocumentMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/([^/]+)\/(preview|download|approve|unapprove|request-resubmission)$/);
    if (staffDocumentMatch) {
        let applicationId;
        let documentCode;
        try {
            applicationId = decodeURIComponent(staffDocumentMatch[1]);
            documentCode = decodeURIComponent(staffDocumentMatch[2]);
        } catch {
            throw new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya erişilemiyor.');
        }
        if (staffDocumentMatch[3] === 'preview') {
            return createStaffDocumentPreview({ request, environment, applicationId, code: documentCode, requestId });
        }
        if (staffDocumentMatch[3] === 'download') {
            return downloadStaffApplicationDocument({ request, environment, applicationId, code: documentCode, requestId });
        }
        if (staffDocumentMatch[3] === 'approve') {
            return approveStaffApplicationDocument({ request, environment, applicationId, code: documentCode, requestId });
        }
        if (staffDocumentMatch[3] === 'unapprove') {
            return unapproveStaffApplicationDocument({ request, environment, applicationId, code: documentCode, requestId });
        }
        return requestStaffDocumentResubmission({ request, environment, applicationId, code: documentCode, requestId });
    }
    const staffResetMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/reset-access-code$/);
    if (staffResetMatch) {
        let applicationId;
        try {
            applicationId = decodeURIComponent(staffResetMatch[1]);
        } catch {
            throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
        }
        return resetStaffApplicationAccessCode({ request, environment, applicationId, requestId });
    }
    const staffApplicationMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)$/);
    if (staffApplicationMatch) {
        let applicationId;
        try {
            applicationId = decodeURIComponent(staffApplicationMatch[1]);
        } catch {
            throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
        }
        return readStaffApplicationDetail(request, environment, applicationId);
    }
    if (pathname === '/api/public/applications/access') return accessApplicationWithReference(request, environment, requestId);
    if (pathname === '/api/public/applications/current/regenerate-access-code') return regenerateCurrentAccessCode(request, environment, requestId);
    if (pathname === '/api/public/applications') return createApplicationDraft(request, environment, requestId);
    if (pathname === '/api/public/applications/current/status') return readCurrentApplicationStatus(request, environment);
    if (pathname === '/api/public/applications/current/tracking') return readCurrentApplicationTracking(request, environment);
    if (pathname === '/api/public/applications/current/notification-preferences') {
        if (request.method === 'PUT') return updateCurrentNotificationPreferences(request, environment, requestId);
        return readCurrentNotificationPreferences(request, environment);
    }
    if (pathname === '/api/public/applications/tracking-lookup') return lookupApplicationTracking(request, environment);
    if (pathname === '/api/public/applications/current/submit') return submitCurrentApplication(request, environment, requestId);
    if (pathname === '/api/public/applications/current/declaration') return acceptCurrentApplicationDeclaration(request, environment, requestId);
    if (pathname === '/api/public/applications/current/contact-acknowledgement') {
        return acceptCurrentContactAcknowledgement(request, environment, requestId);
    }
    if (pathname === '/api/public/applications/current/documents') return readCurrentStudentDocumentRequirements(request, environment);
    if (pathname === '/api/public/applications/current/documents/resubmission-eligibility') {
        return readCurrentResubmissionEligibility(request, environment);
    }
    if (pathname === '/api/public/applications/current/documents/resubmission-upload-intent') {
        return createCurrentResubmissionUploadIntent(request, environment, requestId);
    }
    if (pathname === '/api/public/applications/current/documents/resubmission-finalize') {
        return finalizeCurrentResubmissionUpload(request, environment, requestId);
    }
    if (pathname === '/api/public/applications/current/documents/upload-intent') return createCurrentStudentDocumentUploadIntent(request, environment);
    if (pathname === '/api/public/applications/current/documents/finalize') return finalizeCurrentStudentDocument(request, environment);
    const studentDocumentMatch = pathname.match(/^\/api\/public\/applications\/current\/documents\/([^/]+)$/);
    if (studentDocumentMatch) return deleteCurrentStudentDocument(request, environment, decodeURIComponent(studentDocumentMatch[1]));
    if (pathname === '/api/public/applications/current/autosave') return autosaveCurrentApplication(request, environment, requestId);
    if (pathname === '/api/public/applications/current') {
        if (request.method === 'PATCH') return updateCurrentApplication(request, environment, requestId);
        return readCurrentApplication(request, environment);
    }
    if (pathname === '/api/public/applications/logout') return logoutApplication(request, environment);
    const documentMatch = pathname.match(/^\/api\/staff\/documents\/([^/]+)\/content$/);
    if (documentMatch) return readPrivateDocument(request, environment, decodeURIComponent(documentMatch[1]));
    if (pathname === '/api/ocr') return recognizeDocument(request, environment);
    if (pathname.startsWith('/api/') && [
        '/api/get-all-tebligat', '/api/search-tebligat', '/api/add-tebligat',
        '/api/update-tebligat', '/api/unmark-tebligat', '/api/remove-tebligat'
    ].includes(pathname)) return handleTebligatRequest(request, environment, pathname);
    if (pathname === '/api/staff/admin/backup') {
        await requireStaff(request, environment);
        requireMethod(request, 'POST');
        return backupD1ToR2({
            database: environment.DB,
            storage: environment.DOCUMENTS,
            environmentName: environment.APP_ENV || 'production'
        });
    }
    if (pathname === '/api/staff/admin/backup/latest') {
        await requireStaff(request, environment);
        requireMethod(request, 'GET');
        const latest = await getLatestBackupMetadata(environment.DOCUMENTS, environment.APP_ENV || 'production');
        return { latest };
    }
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
    },
    async scheduled(controller, environment) {
        if (controller.cron === '* * * * *') {
            if (environment.DB && environment.PRINT_FILES) {
                try {
                    await runPrintCleanup(environment);
                } catch (cleanupError) {
                    console.error('[Scheduled] Print cleanup failed.', { errorName: cleanupError?.name || 'UnknownError' });
                    throw cleanupError;
                }
            }
            try { await cleanupMobileTransfers(environment); }
            catch (error) { console.error('Temporary photo cleanup failed.', { errorName: error.name }); }
            return;
        }
        try { await cleanupMobileTransfers(environment); }
        catch (error) { console.error('Temporary photo cleanup failed.', { errorName: error.name }); }
        if (environment.DB && environment.DOCUMENTS && typeof environment.DOCUMENTS.put === 'function') {
            try {
                await backupD1ToR2({
                    database: environment.DB,
                    storage: environment.DOCUMENTS,
                    environmentName: environment.APP_ENV || 'production'
                });
            } catch (backupError) {
                console.error('[Scheduled] D1 automated backup failed:', backupError);
            }
        }
        const provider = createMetaWhatsAppProvider(environment);
        return runNotificationDispatchBatch({ database: environment.DB, provider,
            isEnabled: environment.NOTIFICATION_DISPATCH_ENABLED === 'true' });
    }
};

export default worker;
