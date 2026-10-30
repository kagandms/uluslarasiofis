(() => {
    if (globalThis.__YOKSIS_DOCUMENT_AUDIT_CONTROLLER_LOADED__) return;
    globalThis.__YOKSIS_DOCUMENT_AUDIT_CONTROLLER_LOADED__ = true;

    const reader = globalThis.YoksisDocumentAudit;
    const activeScans = new Map();
    const SELECTION_TIMEOUT_MS = 12_000;

    function isValidScanId(value) {
        return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
    }

    function checkYoksisDocumentAuditReadiness(rootDocument) {
        return collectYoksisAuditQueueAcrossInnerScroll(rootDocument).then((queue) => ({
            ready: queue.status === 'complete' && queue.entries.length > 0,
            queueCount: queue.entries.length,
            ...(queue.status === 'incomplete' ? { reason: queue.reason } : {})
        }));
    }

    function findScrollableListContainer(rootDocument) {
        const table = reader.findYoksisAuditRecordTable(rootDocument);
        if (!table) return null;
        const ownerDoc = table.ownerDocument || rootDocument;
        const view = ownerDoc.defaultView || rootDocument.defaultView;
        let ancestor = table.parentElement;
        while (ancestor && ancestor !== ownerDoc.body && ancestor !== ownerDoc.documentElement) {
            const style = view?.getComputedStyle(ancestor);
            const overflow = `${style?.overflowY || ''} ${style?.overflow || ''}`;
            if (/(auto|scroll)/.test(overflow) && ancestor.clientHeight > 0) return ancestor;
            ancestor = ancestor.parentElement;
        }
        return null;
    }

    function waitForNextPaint(rootDocument) {
        const view = rootDocument.defaultView;
        if (typeof view?.requestAnimationFrame === 'function') {
            return new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
        }
        return Promise.resolve();
    }

    function mergeQueueEntries(target, source) {
        for (const entry of source.entries) {
            if (!target.some((known) => known.applicationNumber === entry.applicationNumber)) target.push(entry);
        }
    }

    async function collectYoksisAuditQueueAcrossInnerScroll(rootDocument) {
        const container = findScrollableListContainer(rootDocument);
        if (!container) return { status: 'incomplete', entries: [], reason: 'record-list-scroll-container-not-found' };

        const originalScrollTop = container.scrollTop;
        const entries = [];
        let incompleteReason = '';
        let reachedBottom = false;
        let bottomStableFrames = 0;
        let previousSignature = '';
        const maxSteps = 1000;

        try {
            for (let step = 0; step < maxSteps; step += 1) {
                const snapshot = reader.collectYoksisAuditQueue(rootDocument);
                mergeQueueEntries(entries, snapshot);
                if (snapshot.reason && snapshot.reason !== 'no-verifiable-records') incompleteReason ||= snapshot.reason;
                const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
                if (maxScrollTop === 0) {
                    reachedBottom = true;
                    break;
                }

                const currentScrollTop = container.scrollTop;
                const nextScrollTop = Math.min(maxScrollTop, currentScrollTop + Math.max(1, Math.floor(container.clientHeight * 0.75)));
                if (nextScrollTop > currentScrollTop) {
                    container.scrollTop = nextScrollTop;
                    container.dispatchEvent(new rootDocument.defaultView.Event('scroll', { bubbles: true }));
                    await waitForNextPaint(rootDocument);
                    bottomStableFrames = 0;
                    continue;
                }

                const signature = `${container.scrollTop}:${entries.map((entry) => entry.applicationNumber).join(',')}`;
                if (signature === previousSignature) bottomStableFrames += 1;
                else bottomStableFrames = 0;
                previousSignature = signature;
                await waitForNextPaint(rootDocument);
                if (bottomStableFrames >= 1) {
                    mergeQueueEntries(entries, reader.collectYoksisAuditQueue(rootDocument));
                    reachedBottom = true;
                    break;
                }
            }
        } finally {
            container.scrollTop = originalScrollTop;
            container.dispatchEvent(new rootDocument.defaultView.Event('scroll', { bubbles: true }));
        }

        if (!reachedBottom) return { status: 'incomplete', entries, reason: 'record-list-bottom-not-confirmed' };
        if (incompleteReason) return { status: 'incomplete', entries, reason: incompleteReason };
        return entries.length ? { status: 'complete', entries } : { status: 'incomplete', entries, reason: 'no-verifiable-records' };
    }

    async function findRecordButtonThroughScroll(rootDocument, entry, startAtTop = false) {
        const container = findScrollableListContainer(rootDocument);
        if (!container) return null;
        const originalScrollTop = container.scrollTop;
        if (startAtTop) {
            container.scrollTop = 0;
            container.dispatchEvent(new rootDocument.defaultView.Event('scroll', { bubbles: true }));
            await waitForNextPaint(rootDocument);
        }
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const stepSize = Math.max(1, Math.floor(container.clientHeight * 0.75));
        for (let step = 0; step < 1000; step += 1) {
            const button = reader.findYoksisAuditRecordButton(rootDocument, entry);
            if (button?.isConnected) return button;
            if (container.scrollTop >= maxScrollTop) break;
            container.scrollTop = Math.min(maxScrollTop, container.scrollTop + stepSize);
            container.dispatchEvent(new rootDocument.defaultView.Event('scroll', { bubbles: true }));
            await waitForNextPaint(rootDocument);
        }
        container.scrollTop = originalScrollTop;
        container.dispatchEvent(new rootDocument.defaultView.Event('scroll', { bubbles: true }));
        return null;
    }

    function observeAccessibleRoots(observer, rootDocument) {
        const docs = typeof reader.getAccessibleDocuments === 'function'
            ? reader.getAccessibleDocuments(rootDocument)
            : [rootDocument];
        for (const doc of docs) {
            if (doc?.documentElement) {
                observer.observe(doc.documentElement, {
                    attributes: true,
                    childList: true,
                    characterData: true,
                    subtree: true
                });
            }
        }
    }

    function waitForSelectedIdentity(rootDocument, expectedIdentity, timeoutMs = SELECTION_TIMEOUT_MS) {
        return new Promise((resolve) => {
            const Observer = rootDocument.defaultView?.MutationObserver || globalThis.MutationObserver;
            if (!Observer || !rootDocument.documentElement) {
                resolve(false);
                return;
            }
            let finished = false;
            const observer = new Observer(check);
            const timer = setTimeout(() => finish(false), timeoutMs);
            function finish(matches) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                observer.disconnect();
                resolve(matches);
            }
            function check() {
                const selected = reader.readSelectedAuditIdentity(rootDocument);
                if (selected.applicationNumber === expectedIdentity.applicationNumber
                    && selected.studentNumber === expectedIdentity.studentNumber) finish(true);
            }
            observeAccessibleRoots(observer, rootDocument);
            check();
        });
    }

    function waitForSelectedRecord(rootDocument, entry, timeoutMs) {
        return new Promise((resolve) => {
            const Observer = rootDocument.defaultView?.MutationObserver || globalThis.MutationObserver;
            if (!Observer || !rootDocument.documentElement) {
                resolve({ status: 'unreadable', reason: 'page-observer-unavailable' });
                return;
            }

            let finished = false;
            const observer = new Observer(() => check());
            const timer = setTimeout(() => {
                const result = reader.readSelectedYoksisAuditRecord(rootDocument, entry);
                if (result.status === 'verified') finish(result);
                else if (result.status === 'unreadable') finish(result);
                else finish({ status: 'unreadable', reason: 'identity-mismatch' });
            }, timeoutMs);

            function finish(result) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                observer.disconnect();
                resolve(result);
            }

            function check() {
                const result = reader.readSelectedYoksisAuditRecord(rootDocument, entry);
                if (result.status === 'verified'
                    || (result.status === 'unreadable' && ![
                        'application-status-missing',
                        'identity-fields-incomplete',
                        'missing-documents-section-not-found',
                        'missing-documents-table-empty'
                    ].includes(result.reason))) {
                    finish(result);
                }
            }

            observeAccessibleRoots(observer, rootDocument);
            check();
        });
    }

    async function startYoksisDocumentAudit(scanId, rootDocument, emitEvent) {
        if (!isValidScanId(scanId) || typeof emitEvent !== 'function') {
            return { status: 'rejected', completed: 0, remaining: 0, reason: 'invalid-scan-request' };
        }
        if (activeScans.has(scanId)) {
            return { status: 'rejected', completed: 0, remaining: 0, reason: 'scan-already-active' };
        }

        const scan = { stopRequested: false };
        activeScans.set(scanId, scan);
        let completed = 0;
        let remaining = 0;
        let total = 0;
        let completionStatus = 'complete';
        let initialSelectionRestored = null;
        const initialSelection = reader.readSelectedAuditIdentity(rootDocument);
        const initialListContainer = findScrollableListContainer(rootDocument);
        const initialListScrollTop = initialListContainer?.scrollTop ?? null;

        try {
            const queue = await collectYoksisAuditQueueAcrossInnerScroll(rootDocument);
            total = queue.entries.length;
            if (queue.status !== 'complete' || queue.entries.length === 0) {
                emitEvent({ type: 'progress', completed, total: queue.entries.length, remaining: queue.entries.length, status: 'queue-incomplete' });
                return { status: 'incomplete', completed, remaining: queue.entries.length, reason: queue.reason || 'empty-queue' };
            }

            if (initialListContainer?.isConnected) {
                initialListContainer.scrollTop = 0;
                initialListContainer.dispatchEvent(new rootDocument.defaultView.Event('scroll', { bubbles: true }));
                await waitForNextPaint(rootDocument);
            }

            emitEvent({ type: 'progress', completed, total: queue.entries.length, remaining: queue.entries.length, status: 'running' });
            for (let index = 0; index < queue.entries.length; index += 1) {
                if (scan.stopRequested) {
                    completionStatus = 'stopped';
                    remaining = queue.entries.length - index;
                    break;
                }

                const entry = queue.entries[index];
                const button = await findRecordButtonThroughScroll(rootDocument, entry);
                let result;
                if (!button?.isConnected) {
                    result = { status: 'unreadable', reason: 'record-control-not-found' };
                } else {
                    button.click();
                    result = await waitForSelectedRecord(rootDocument, entry, SELECTION_TIMEOUT_MS);
                    if (result.status === 'identity-mismatch') {
                        result = { status: 'unreadable', reason: 'identity-mismatch' };
                    }
                }

                completed += 1;
                emitEvent({ type: 'record', index: index + 1, total: queue.entries.length, entry, result });
                emitEvent({
                    type: 'progress',
                    completed,
                    total: queue.entries.length,
                    remaining: queue.entries.length - completed,
                    status: 'running'
                });
            }

            const originalEntry = queue.entries.find((entry) => (
                entry.applicationNumber === initialSelection.applicationNumber
                && entry.studentNumber === initialSelection.studentNumber
            ));
            if (originalEntry) {
                const currentSelection = reader.readSelectedAuditIdentity(rootDocument);
                if (currentSelection.applicationNumber === originalEntry.applicationNumber
                    && currentSelection.studentNumber === originalEntry.studentNumber) {
                    initialSelectionRestored = true;
                } else {
                    const originalButton = await findRecordButtonThroughScroll(rootDocument, originalEntry, true);
                    if (originalButton?.isConnected) {
                        originalButton.click();
                        initialSelectionRestored = await waitForSelectedIdentity(rootDocument, originalEntry);
                    } else {
                        initialSelectionRestored = false;
                    }
                }
            }
            return {
                status: completionStatus,
                completed,
                remaining,
                ...(initialSelectionRestored === null ? {} : { selectionRestored: initialSelectionRestored })
            };
        } catch {
            remaining = Math.max(0, total - completed);
            return { status: 'failed', completed, remaining, reason: 'scan-failed' };
        } finally {
            if (initialListContainer?.isConnected && initialListScrollTop !== null) {
                initialListContainer.scrollTop = initialListScrollTop;
                initialListContainer.dispatchEvent(new rootDocument.defaultView.Event('scroll', { bubbles: true }));
            }
            activeScans.delete(scanId);
        }
    }

    function requestStopYoksisDocumentAudit(scanId) {
        const scan = activeScans.get(scanId);
        if (!scan) return false;
        scan.stopRequested = true;
        return true;
    }

    function sendAuditEvent(command, event) {
        chrome.runtime.sendMessage({
            source: 'YOKSIS_DOCUMENT_AUDIT',
            action: `YOKSIS_DOCUMENT_AUDIT_${event.type.toUpperCase()}`,
            requestId: command.requestId,
            scanId: command.scanId,
            portalTabId: command.portalTabId,
            data: event
        }, () => void chrome.runtime.lastError);
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && location.hostname === 'yoksis.yok.gov.tr' && window === window.top) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !isValidScanId(request?.scanId)) return false;
            if (request.action === 'YOKSIS_DOCUMENT_AUDIT_CHECK') {
                void checkYoksisDocumentAuditReadiness(document).then(sendResponse)
                    .catch(() => sendResponse({ ready: false, queueCount: 0, reason: 'readiness-check-failed' }));
                return true;
            }
            if (request.action === 'YOKSIS_DOCUMENT_AUDIT_STOP') {
                sendResponse({ success: requestStopYoksisDocumentAudit(request.scanId) });
                return false;
            }
            if (request.action !== 'YOKSIS_DOCUMENT_AUDIT_START'
                || !Number.isInteger(request.portalTabId)
                || typeof request.requestId !== 'string') return false;

            sendResponse({ success: true, scanId: request.scanId });
            void startYoksisDocumentAudit(request.scanId, document, (event) => sendAuditEvent(request, event))
                .then((result) => sendAuditEvent(request, { type: 'complete', ...result }));
            return false;
        });
    }

    globalThis.YoksisDocumentAuditController = Object.freeze({
        checkYoksisDocumentAuditReadiness,
        collectYoksisAuditQueueAcrossInnerScroll,
        startYoksisDocumentAudit,
        requestStopYoksisDocumentAudit
    });
})();
