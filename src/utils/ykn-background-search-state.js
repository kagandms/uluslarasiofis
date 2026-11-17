/**
 * Arka planda YÖKSİS araması durum makinesi ve aktarım kapısı (saf mantık, DOM bağımsız).
 */

export const BACKGROUND_SEARCH_STATUS = Object.freeze({
    IDLE: 'idle',
    READING_LETTER: 'reading_letter',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    NEEDS_ATTENTION: 'needs_attention'
});

/**
 * Başlangıçta veya sıfırlama sonrasında kullanılacak boş arka plan arama durumunu oluşturur.
 * @returns {{ status: string, requestId: string | null, reasonKey: string | null, errorMessage: string | null, surfaced: boolean, formReady: boolean }}
 */
export function createBackgroundSearchState() {
    return {
        status: BACKGROUND_SEARCH_STATUS.IDLE,
        requestId: null,
        reasonKey: null,
        errorMessage: null,
        surfaced: false,
        formReady: false
    };
}

/**
 * Durumu kabul mektubu okuma aşamasına geçirir.
 * @param {object} [state] Mevcut durum.
 * @returns {object} Güncellenmiş yeni durum nesnesi.
 */
export function startReadingLetter(state = createBackgroundSearchState()) {
    void state;
    return {
        ...createBackgroundSearchState(),
        status: BACKGROUND_SEARCH_STATUS.READING_LETTER
    };
}

/**
 * Verilen istek kimliği ile arka plan YÖKSİS aramasını başlatır.
 * @param {object} state Mevcut durum.
 * @param {{ requestId?: string }} [options] İstek seçenekleri.
 * @returns {object} Güncellenmiş yeni durum nesnesi.
 */
export function startBackgroundSearch(state = createBackgroundSearchState(), options = {}) {
    const rawId = options && options.requestId != null ? String(options.requestId).trim() : '';
    if (!rawId) {
        return failBackgroundSearch(state, 'missing_request_id');
    }
    return {
        status: BACKGROUND_SEARCH_STATUS.RUNNING,
        requestId: rawId,
        reasonKey: null,
        errorMessage: null,
        surfaced: false,
        formReady: false
    };
}

/**
 * Arka plan aramasını belirtilen hata nedeni ile başarısız durumuna geçirir.
 * @param {object} [state] Mevcut durum.
 * @param {string | { reasonKey?: string, reason?: string, errorMessage?: string, message?: string }} [reason] Hata nedeni anahtarı veya nesnesi.
 * @param {string | null} [errorMessage] İsteğe bağlı açıklayıcı hata mesajı.
 * @returns {object} Güncellenmiş yeni durum nesnesi.
 */
export function failBackgroundSearch(state = createBackgroundSearchState(), reason = 'search_failed', errorMessage = null) {
    let reasonKey = 'search_failed';
    let resolvedMessage = typeof errorMessage === 'string' && errorMessage.trim() ? errorMessage.trim() : null;

    if (reason && typeof reason === 'object') {
        const rawKey = reason.reasonKey || reason.reason || 'search_failed';
        reasonKey = String(rawKey).trim() || 'search_failed';
        const rawMsg = reason.errorMessage || reason.message || resolvedMessage;
        resolvedMessage = typeof rawMsg === 'string' && rawMsg.trim() ? rawMsg.trim() : null;
    } else if (typeof reason === 'string' && reason.trim()) {
        reasonKey = reason.trim();
    }

    return {
        ...(state && typeof state === 'object' ? state : createBackgroundSearchState()),
        status: BACKGROUND_SEARCH_STATUS.FAILED,
        reasonKey,
        errorMessage: resolvedMessage,
        surfaced: false,
        formReady: false
    };
}

/**
 * Eklentiden gelen TRANSFER_TO_YOKSIS yanıtını arka plan arama durumuna uygular.
 * Eski veya uyumsuz requestId taşıyan yanıtları yok sayar.
 * @param {object} state Mevcut durum.
 * @param {object | null | undefined} response Eklenti yanıt nesnesi.
 * @returns {object} Güncellenmiş yeni durum nesnesi (yok sayıldıysa aynı referans).
 */
export function applyExtensionResponse(state, response) {
    if (!state || state.status !== BACKGROUND_SEARCH_STATUS.RUNNING) {
        return state;
    }

    if (response && typeof response === 'object' && response.requestId !== undefined && response.requestId !== null) {
        const incomingId = String(response.requestId).trim();
        if (state.requestId && incomingId !== state.requestId) {
            return state;
        }
    }

    if (!response || typeof response !== 'object') {
        return failBackgroundSearch(state, 'search_failed');
    }

    const surfaced = response.surfaced === true;
    const rawAttentionReason = typeof response.attentionReason === 'string' ? response.attentionReason.trim() : '';
    const hasAttentionReason = rawAttentionReason.length > 0;
    const manualOverrideAvailable = Boolean(response.manualOverrideAvailable || response.yoksisManualOverrideAvailable);
    const errorMessage = typeof response.error === 'string' && response.error.trim()
        ? response.error.trim()
        : (typeof response.message === 'string' && response.message.trim() ? response.message.trim() : null);

    // İnsan müdahalesi veya doğrulama gerektiren durumlar önce yakalanır
    if (surfaced || hasAttentionReason || (response.success === true && response.formReady !== true) || (response.success === true && manualOverrideAvailable && response.formReady !== true)) {
        const reasonKey = hasAttentionReason
            ? rawAttentionReason
            : (response.success === false ? 'search_failed' : 'manual_confirmation');
        return {
            ...state,
            status: BACKGROUND_SEARCH_STATUS.NEEDS_ATTENTION,
            reasonKey,
            errorMessage,
            surfaced,
            formReady: false
        };
    }

    if (response.success === true && response.formReady === true) {
        return {
            ...state,
            status: BACKGROUND_SEARCH_STATUS.SUCCESS,
            reasonKey: null,
            errorMessage: null,
            surfaced: false,
            formReady: true
        };
    }

    return failBackgroundSearch(
        state,
        typeof response.reasonKey === 'string' && response.reasonKey.trim() ? response.reasonKey.trim() : 'search_failed',
        errorMessage
    );
}

/**
 * Arka plan aramasını başlangıç ('idle') durumuna sıfırlar.
 * @returns {object} Sıfırlanmış durum nesnesi.
 */
export function resetBackgroundSearch() {
    return createBackgroundSearchState();
}

/**
 * Mevcut arka plan arama durumuna göre YÖKSİS aktarım kapısı bilgisini döndürür.
 * @param {object} [state] Mevcut durum.
 * @returns {{ allowed: boolean, queueable: boolean, reasonKey: string | null, label: string }}
 */
export function getTransferGate(state) {
    const status = state?.status || BACKGROUND_SEARCH_STATUS.IDLE;

    if (status === BACKGROUND_SEARCH_STATUS.IDLE || status === BACKGROUND_SEARCH_STATUS.SUCCESS) {
        return {
            allowed: true,
            queueable: false,
            reasonKey: null,
            label: ''
        };
    }

    if (status === BACKGROUND_SEARCH_STATUS.READING_LETTER || status === BACKGROUND_SEARCH_STATUS.RUNNING) {
        return {
            allowed: false,
            queueable: true,
            reasonKey: status,
            label: 'YÖKSİS aranıyor...'
        };
    }

    if (status === BACKGROUND_SEARCH_STATUS.NEEDS_ATTENTION) {
        const reasonKey = state?.reasonKey || 'manual_confirmation';
        let label = 'YÖKSİS sekmesinden kontrol edin';
        if (reasonKey === 'login_required') {
            label = 'YÖKSİS oturumu gerekli';
        } else if (reasonKey === 'manual_confirmation') {
            label = 'YÖKSİS formu otomatik doğrulanamadı; YÖKSİS sekmesinde kontrol edip “1. Kabul Mektubunu Oku ve YÖKSİS’te Ara” ile devam edin';
        } else if (state?.errorMessage) {
            label = state.errorMessage;
        }
        return {
            allowed: false,
            queueable: false,
            reasonKey,
            label
        };
    }

    const reasonKey = state?.reasonKey || 'search_failed';
    let label = state?.errorMessage || 'YÖKSİS araması başarısız oldu, tekrar deneyin';
    if (reasonKey === 'timeout') {
        label = state?.errorMessage || 'YÖKSİS arama süresi doldu, tekrar deneyin';
    } else if (reasonKey === 'document_read_failed') {
        label = state?.errorMessage || 'Kabul mektubu okunamadı, tekrar deneyin';
    }
    return {
        allowed: false,
        queueable: false,
        reasonKey,
        label
    };
}

let latestTransferGate = getTransferGate(createBackgroundSearchState());

/**
 * Son yayımlanan YÖKSİS aktarım kapısı durumunu döndürür (sonradan açılan kırpıcı için).
 * @returns {{ allowed: boolean, queueable: boolean, reasonKey: string | null, label: string }}
 */
export function getLatestTransferGate() {
    return { ...latestTransferGate };
}

/**
 * Son YÖKSİS aktarım kapısı değerini durum veya kapı nesnesinden günceller.
 * @param {object} gateOrState Durum nesnesi veya doğrudan kapı nesnesi.
 * @returns {{ allowed: boolean, queueable: boolean, reasonKey: string | null, label: string }}
 */
export function setLatestTransferGate(gateOrState) {
    if (gateOrState && typeof gateOrState === 'object' && typeof gateOrState.allowed === 'boolean') {
        latestTransferGate = {
            allowed: gateOrState.allowed,
            queueable: Boolean(gateOrState.queueable),
            reasonKey: gateOrState.reasonKey ?? null,
            label: typeof gateOrState.label === 'string' ? gateOrState.label : ''
        };
    } else {
        latestTransferGate = getTransferGate(gateOrState);
    }
    return { ...latestTransferGate };
}
