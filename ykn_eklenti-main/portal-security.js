(function registerPortalSecurity(global) {
    const PORTAL_ACTIONS = new Set([
        'SEARCH_STUDENT',
        'READ_APPLY_DOCUMENT',
        'TRANSFER_TO_YOKSIS',
        'COPY_APPLY_DATA',
        'copyData',
        'EXTRACT_KABUL_CODE',
        'SAVE_CROPPED_PHOTO',
        'FILL_YOKSIS_FORM'
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

    global.YKN_PORTAL_SECURITY = Object.freeze({
        isAllowedPortalUrl,
        isAllowedApplySender,
        isAllowedApplyDocumentUrl,
        isValidPortalMessage,
        isValidApplyEvent
    });
})(globalThis);
