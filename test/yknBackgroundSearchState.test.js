import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BACKGROUND_SEARCH_STATUS,
    createBackgroundSearchState,
    startReadingLetter,
    startBackgroundSearch,
    applyExtensionResponse,
    failBackgroundSearch,
    resetBackgroundSearch,
    getTransferGate,
    getLatestTransferGate,
    setLatestTransferGate
} from '../src/utils/ykn-background-search-state.js';

test('idle state allows transfer so the default flow stays untouched', () => {
    const initial = createBackgroundSearchState();

    assert.equal(initial.status, BACKGROUND_SEARCH_STATUS.IDLE);
    assert.equal(initial.requestId, null);
    assert.deepEqual(getTransferGate(initial), {
        allowed: true,
        queueable: false,
        reasonKey: null,
        label: ''
    });
});

test('reading_letter and running states close the transfer gate with queueable waiting label', () => {
    const idle = createBackgroundSearchState();
    const reading = startReadingLetter(idle);

    assert.equal(idle.status, BACKGROUND_SEARCH_STATUS.IDLE);
    assert.equal(reading.status, BACKGROUND_SEARCH_STATUS.READING_LETTER);
    assert.deepEqual(getTransferGate(reading), {
        allowed: false,
        queueable: true,
        reasonKey: 'reading_letter',
        label: 'YÖKSİS aranıyor...'
    });

    const running = startBackgroundSearch(reading, { requestId: 'bg-req-1' });
    assert.equal(reading.status, BACKGROUND_SEARCH_STATUS.READING_LETTER);
    assert.equal(running.status, BACKGROUND_SEARCH_STATUS.RUNNING);
    assert.equal(running.requestId, 'bg-req-1');
    assert.deepEqual(getTransferGate(running), {
        allowed: false,
        queueable: true,
        reasonKey: 'running',
        label: 'YÖKSİS aranıyor...'
    });
});

test('startBackgroundSearch without requestId transitions to failed', () => {
    const failed = startBackgroundSearch(createBackgroundSearchState(), {});

    assert.equal(failed.status, BACKGROUND_SEARCH_STATUS.FAILED);
    assert.equal(failed.reasonKey, 'missing_request_id');
    assert.equal(getTransferGate(failed).allowed, false);
    assert.equal(getTransferGate(failed).queueable, false);
});

test('applyExtensionResponse opens gate only when success === true and formReady === true', () => {
    const running = startBackgroundSearch(createBackgroundSearchState(), { requestId: 'bg-req-2' });
    const succeeded = applyExtensionResponse(running, {
        requestId: 'bg-req-2',
        success: true,
        formReady: true,
        background: true
    });

    assert.equal(running.status, BACKGROUND_SEARCH_STATUS.RUNNING);
    assert.equal(succeeded.status, BACKGROUND_SEARCH_STATUS.SUCCESS);
    assert.equal(succeeded.formReady, true);
    assert.deepEqual(getTransferGate(succeeded), {
        allowed: true,
        queueable: false,
        reasonKey: null,
        label: ''
    });
});

test('applyExtensionResponse moves manualOverride without formReady to needs_attention', () => {
    const running = startBackgroundSearch(createBackgroundSearchState(), { requestId: 'bg-req-3' });
    const next = applyExtensionResponse(running, {
        requestId: 'bg-req-3',
        success: true,
        formReady: false,
        manualOverrideAvailable: true
    });

    assert.equal(next.status, BACKGROUND_SEARCH_STATUS.NEEDS_ATTENTION);
    assert.equal(next.reasonKey, 'manual_confirmation');
    assert.deepEqual(getTransferGate(next), {
        allowed: false,
        queueable: false,
        reasonKey: 'manual_confirmation',
        label: 'YÖKSİS formu otomatik doğrulanamadı; YÖKSİS sekmesinde kontrol edip “1. Kabul Mektubunu Oku ve YÖKSİS’te Ara” ile devam edin'
    });
});

test('applyExtensionResponse moves surfaced or attentionReason responses to needs_attention with reason', () => {
    const running = startBackgroundSearch(createBackgroundSearchState(), { requestId: 'bg-req-4' });

    const loginRequired = applyExtensionResponse(running, {
        requestId: 'bg-req-4',
        success: false,
        surfaced: true,
        attentionReason: 'login_required'
    });
    assert.equal(loginRequired.status, BACKGROUND_SEARCH_STATUS.NEEDS_ATTENTION);
    assert.equal(loginRequired.surfaced, true);
    assert.equal(loginRequired.reasonKey, 'login_required');
    assert.deepEqual(getTransferGate(loginRequired), {
        allowed: false,
        queueable: false,
        reasonKey: 'login_required',
        label: 'YÖKSİS oturumu gerekli'
    });

    const surfacedSearchFail = applyExtensionResponse(running, {
        requestId: 'bg-req-4',
        success: false,
        surfaced: true,
        attentionReason: 'search_failed',
        error: 'Kayıt eşleşmedi'
    });
    assert.equal(surfacedSearchFail.status, BACKGROUND_SEARCH_STATUS.NEEDS_ATTENTION);
    assert.equal(surfacedSearchFail.surfaced, true);
    assert.equal(surfacedSearchFail.reasonKey, 'search_failed');
    assert.deepEqual(getTransferGate(surfacedSearchFail), {
        allowed: false,
        queueable: false,
        reasonKey: 'search_failed',
        label: 'Kayıt eşleşmedi'
    });
});

test('applyExtensionResponse moves non-surfaced failure to failed and closes gate', () => {
    const running = startBackgroundSearch(createBackgroundSearchState(), { requestId: 'bg-req-5' });
    const failed = applyExtensionResponse(running, {
        requestId: 'bg-req-5',
        success: false,
        error: 'YÖKSİS sekmesine ulaşılamadı'
    });

    assert.equal(failed.status, BACKGROUND_SEARCH_STATUS.FAILED);
    assert.equal(failed.reasonKey, 'search_failed');
    assert.deepEqual(getTransferGate(failed), {
        allowed: false,
        queueable: false,
        reasonKey: 'search_failed',
        label: 'YÖKSİS sekmesine ulaşılamadı'
    });
});

test('stale responses with different requestId or non-running state are ignored', () => {
    const running = startBackgroundSearch(createBackgroundSearchState(), { requestId: 'bg-req-active' });
    const staleIgnored = applyExtensionResponse(running, {
        requestId: 'bg-req-old',
        success: true,
        formReady: true
    });

    assert.equal(staleIgnored, running);
    assert.equal(staleIgnored.status, BACKGROUND_SEARCH_STATUS.RUNNING);

    const idle = createBackgroundSearchState();
    const idleIgnored = applyExtensionResponse(idle, {
        requestId: 'bg-req-active',
        success: true,
        formReady: true
    });
    assert.equal(idleIgnored, idle);
});

test('failBackgroundSearch handles timeout and document_read_failed and closes gate', () => {
    const running = startBackgroundSearch(createBackgroundSearchState(), { requestId: 'bg-req-6' });
    const timedOut = failBackgroundSearch(running, 'timeout');

    assert.equal(timedOut.status, BACKGROUND_SEARCH_STATUS.FAILED);
    assert.equal(timedOut.reasonKey, 'timeout');
    assert.deepEqual(getTransferGate(timedOut), {
        allowed: false,
        queueable: false,
        reasonKey: 'timeout',
        label: 'YÖKSİS arama süresi doldu, tekrar deneyin'
    });

    const reading = startReadingLetter(createBackgroundSearchState());
    const docFailed = failBackgroundSearch(reading, 'document_read_failed');
    assert.equal(docFailed.status, BACKGROUND_SEARCH_STATUS.FAILED);
    assert.equal(docFailed.reasonKey, 'document_read_failed');
    assert.deepEqual(getTransferGate(docFailed), {
        allowed: false,
        queueable: false,
        reasonKey: 'document_read_failed',
        label: 'Kabul mektubu okunamadı, tekrar deneyin'
    });
});

test('resetBackgroundSearch returns idle and opens gate, and latest gate store tracks updates', () => {
    const reset = resetBackgroundSearch();
    assert.equal(reset.status, BACKGROUND_SEARCH_STATUS.IDLE);
    assert.equal(getTransferGate(reset).allowed, true);
    assert.equal(getTransferGate(reset).queueable, false);

    const running = startBackgroundSearch(createBackgroundSearchState(), { requestId: 'bg-req-7' });
    setLatestTransferGate(running);
    assert.equal(getLatestTransferGate().allowed, false);
    assert.equal(getLatestTransferGate().queueable, true);
    assert.equal(getLatestTransferGate().reasonKey, 'running');

    setLatestTransferGate(reset);
    assert.equal(getLatestTransferGate().allowed, true);
    assert.equal(getLatestTransferGate().queueable, false);
    assert.equal(getLatestTransferGate().reasonKey, null);
});
