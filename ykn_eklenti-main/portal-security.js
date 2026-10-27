(function registerPortalSecurity(global) {
    const PORTAL_ACTIONS = new Set([
        'SEARCH_STUDENT',
        'READ_APPLY_DOCUMENT',
        'TRANSFER_TO_YOKSIS',
        'COPY_APPLY_DATA',
        'copyData',
        'EXTRACT_KABUL_CODE',
        'SAVE_CROPPED_PHOTO',
        'FILL_YOKSIS_FORM',
        'CHECK_YOKSIS_DOCUMENT_AUDIT',
        'START_YOKSIS_DOCUMENT_AUDIT',
        'STOP_YOKSIS_DOCUMENT_AUDIT'
    ]);
    const YOKSIS_AUDIT_EVENTS = new Set([
        'YOKSIS_DOCUMENT_AUDIT_PROGRESS',
        'YOKSIS_DOCUMENT_AUDIT_RECORD',
        'YOKSIS_DOCUMENT_AUDIT_COMPLETE'
    ]);
    const APPLY_EVENTS = new Set([
        'OPEN_STUDENT_PROFILE',
        'STUDENT_DOCUMENTS_FOUND',
        'STUDENT_FOUND',
        'STUDENT_NOT_FOUND',
        'DOCUMENTS_NOT_FOUND'
    ]);
    const LOCAL_DEVELOPMENT_PORTS = new Set(['4173', '5173']);

    function isRequestId(value) {
        return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
    }

    function isScanId(value) {
        return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
    }

    function isBoundedText(value, maxLength = 300) {
        return typeof value === 'string' && value.length <= maxLength;
    }

    function isCount(value) {
        return Number.isInteger(value) && value >= 0 && value <= 10_000;
    }


    function matchesExactPortalOrigin(url, matchPattern) {
        const pattern = /^(https?):\/\/([^/*]+)\/\*$/.exec(matchPattern);
        if (!pattern) return false;

        const [, scheme, hostname] = pattern;
        if (url.protocol !== `${scheme}:` || url.hostname.toLowerCase() !== hostname.toLowerCase()) return false;

        const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
        if (!isLoopback) return scheme === 'https' && (!url.port || url.port === '443');
        return scheme === 'http' && LOCAL_DEVELOPMENT_PORTS.has(url.port);
    }

    function isAllowedPortalUrl(rawUrl, matchPatterns) {
        try {
            const url = new URL(rawUrl);
            const isStaffPath = url.pathname === '/yetkili' || url.pathname.startsWith('/yetkili/');
            if (!isStaffPath || url.username || url.password) return false;
            return Array.isArray(matchPatterns) && matchPatterns.some((pattern) => matchesExactPortalOrigin(url, pattern));
        } catch {
            return false;
        }
    }

    function isAllowedApplySender(rawUrl) {
        try {
            const url = new URL(rawUrl);
            return url.protocol === 'https:'
                && url.hostname === 'apply.topkapi.edu.tr'
                && (!url.port || url.port === '443')
                && (url.pathname === '/panel/applications' || url.pathname.startsWith('/panel/applications/'));
        } catch {
            return false;
        }
    }

    function isAllowedApplyDocumentUrl(rawUrl) {
        try {
            const url = new URL(rawUrl);
            return url.protocol === 'https:'
                && url.hostname === 'apply.topkapi.edu.tr'
                && (!url.port || url.port === '443')
                && !url.username
                && !url.password;
        } catch {
            return false;
        }
    }

    function isValidPortalMessage(request) {
        if (!request || typeof request !== 'object' || !PORTAL_ACTIONS.has(request.action) || !isRequestId(request.requestId)) {
            return false;
        }

        if (request.action === 'SEARCH_STUDENT') {
            return typeof request.passportNo === 'string' && request.passportNo.trim().length > 0 && request.passportNo.length <= 64;
        }

        if (request.action === 'READ_APPLY_DOCUMENT') {
            return typeof request.documentKind === 'string'
                && request.documentKind.length <= 40
                && isAllowedApplyDocumentUrl(request.documentUrl);
        }

        if (request.action === 'SAVE_CROPPED_PHOTO') {
            return typeof request.photoBase64 === 'string'
                && request.photoBase64.length <= 15_000_000
                && /^data:image\/(?:jpeg|png);base64,/i.test(request.photoBase64)
                && (request.fileName === undefined || (typeof request.fileName === 'string' && request.fileName.length <= 120));
        }

        if (['CHECK_YOKSIS_DOCUMENT_AUDIT', 'START_YOKSIS_DOCUMENT_AUDIT'].includes(request.action)) {
            return isScanId(request.scanId);
        }
        if (request.action === 'STOP_YOKSIS_DOCUMENT_AUDIT') {
            return isScanId(request.scanId) && Number.isInteger(request.targetTabId) && request.targetTabId >= 0;
        }

        if (request.action === 'FILL_YOKSIS_FORM' || request.action === 'TRANSFER_TO_YOKSIS') {
            return Boolean(request.data) && typeof request.data === 'object' && !Array.isArray(request.data);
        }

        return true;
    }

    function isValidApplyEvent(request) {
        if (!request || typeof request !== 'object' || !APPLY_EVENTS.has(request.action) || !isRequestId(request.requestId)) {
            return false;
        }
        if (request.action === 'OPEN_STUDENT_PROFILE') return isAllowedApplySender(request.profileUrl);
        return true;
    }

    function isValidYoksisAuditEvent(request) {
        if (!request || request.source !== 'YOKSIS_DOCUMENT_AUDIT'
            || !YOKSIS_AUDIT_EVENTS.has(request.action)
            || !isRequestId(request.requestId) || !isScanId(request.scanId)
            || !Number.isInteger(request.portalTabId) || request.portalTabId < 0
            || !request.data || typeof request.data !== 'object' || Array.isArray(request.data)) return false;

        const data = request.data;
        if (request.action === 'YOKSIS_DOCUMENT_AUDIT_PROGRESS') {
            return data.type === 'progress' && isCount(data.completed) && isCount(data.total)
                && isCount(data.remaining) && ['running', 'queue-incomplete'].includes(data.status);
        }
        if (request.action === 'YOKSIS_DOCUMENT_AUDIT_COMPLETE') {
            return data.type === 'complete' && isCount(data.completed) && isCount(data.remaining)
                && ['complete', 'stopped', 'incomplete', 'failed', 'rejected'].includes(data.status)
                && (data.reason === undefined || isBoundedText(data.reason, 80));
        }

        if (data.type !== 'record' || !isCount(data.index) || !isCount(data.total)
            || !data.entry || typeof data.entry !== 'object'
            || !/^\d{4}-\d{2}-\d{7}$/.test(data.entry.applicationNumber || '')
            || !/^\d{8,14}$/.test(data.entry.studentNumber || '')
            || !data.result || typeof data.result !== 'object'
            || !['verified', 'unreadable', 'identity-mismatch'].includes(data.result.status)) return false;

        if (data.result.status !== 'verified') {
            return data.result.status === 'identity-mismatch'
                || (data.result.reason === undefined || isBoundedText(data.result.reason, 80));
        }

        const { identity, applicationStatus, documents } = data.result;
        return identity?.applicationNumber === data.entry.applicationNumber
            && identity?.studentNumber === data.entry.studentNumber
            && isBoundedText(identity?.firstName)
            && isBoundedText(identity?.lastName)
            && isBoundedText(identity?.phone, 40)
            && isBoundedText(applicationStatus)
            && Array.isArray(documents) && documents.length <= 100
            && documents.every((document) => document && typeof document === 'object'
                && isBoundedText(document.code, 80)
                && isBoundedText(document.name)
                && typeof document.required === 'boolean'
                && isBoundedText(document.note)
                && isBoundedText(document.uploadStatus, 80));
    }

    global.YKN_PORTAL_SECURITY = Object.freeze({
        isAllowedPortalUrl,
        isAllowedApplySender,
        isAllowedApplyDocumentUrl,
        isValidPortalMessage,
        isValidApplyEvent,
        isValidYoksisAuditEvent
    });
})(globalThis);
