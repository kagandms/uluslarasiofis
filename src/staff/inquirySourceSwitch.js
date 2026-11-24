/**
 * Yetkili panel "Gelen Sorular" ekranındaki kaynak seçici (Formdan gelen sorular / Topi sohbetleri).
 * Seçimi hem modül değişkeninde hem sessionStorage'da saklar, tek panel görünürlüğünü `hidden` ile yönetir
 * ve ana ekrandaki `#staff-inquiries-home-badge` yeni soru sayacını sekmeye yansıtır.
 */

const STORAGE_KEY = 'staff:inquiries:source';
const VALID_SOURCES = Object.freeze(['form', 'topi']);
const DEFAULT_SOURCE = 'form';

let activeSource = DEFAULT_SOURCE;

function normalizeSource(value) {
    return VALID_SOURCES.includes(value) ? value : null;
}

function getStorage(document, customStorage) {
    if (customStorage !== undefined) return customStorage;
    try {
        return document?.defaultView?.sessionStorage ?? null;
    } catch {
        return null;
    }
}

function readStoredSource(storage) {
    if (!storage) return { ok: false, value: null };
    try {
        const raw = storage.getItem(STORAGE_KEY);
        return { ok: true, value: normalizeSource(raw) };
    } catch {
        return { ok: false, value: null };
    }
}

function writeStoredSource(storage, source) {
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, source);
    } catch {
        // sessionStorage kısıtlıysa yalnızca bellek içi seçim kullanılır.
    }
}

/**
 * "Gelen Sorular" kaynak sekme anahtarını başlatır.
 * @param {{document?: Document, storage?: Storage|null}} [options] Testler için isteğe bağlı bağımlılıklar.
 * @returns {{getActiveSource: () => 'form'|'topi', setSource: (source: 'form'|'topi', opts?: {focus?: boolean}) => void, destroy: () => void}|null}
 */
export function initInquirySourceSwitch({ document: doc = globalThis.document, storage } = {}) {
    if (!doc) return null;

    const tablist = doc.getElementById('staff-inquiry-source-switch');
    const formTab = doc.getElementById('staff-source-tab-form');
    const topiTab = doc.getElementById('staff-source-tab-topi');
    const formPanel = doc.getElementById('staff-inquiries-manager');
    const topiPanel = doc.getElementById('staff-chat-history-section');
    if (!tablist || !formTab || !topiTab || !formPanel || !topiPanel) return null;

    const tabs = [formTab, topiTab];
    const formBadge = doc.getElementById('staff-source-form-badge');
    const homeBadge = doc.getElementById('staff-inquiries-home-badge');

    function resolveStorage() {
        return getStorage(doc, storage);
    }

    function applySource(nextSource, { focus = false, persist = true } = {}) {
        const normalized = normalizeSource(nextSource) || DEFAULT_SOURCE;
        activeSource = normalized;
        if (persist) {
            writeStoredSource(resolveStorage(), normalized);
        }

        const isForm = normalized === 'form';
        formTab.setAttribute('aria-selected', String(isForm));
        formTab.tabIndex = isForm ? 0 : -1;
        formTab.classList.toggle('is-active', isForm);

        topiTab.setAttribute('aria-selected', String(!isForm));
        topiTab.tabIndex = isForm ? -1 : 0;
        topiTab.classList.toggle('is-active', !isForm);

        formPanel.hidden = !isForm;
        topiPanel.hidden = isForm;

        if (focus) {
            (isForm ? formTab : topiTab).focus();
        }
    }

    function syncFormBadge() {
        if (!formBadge) return;
        const rawText = homeBadge ? String(homeBadge.textContent || '').trim() : '';
        const parsed = Number.parseInt(rawText, 10);
        const isEmptyOrZero = !rawText || (Number.isFinite(parsed) && parsed <= 0);

        formBadge.textContent = isEmptyOrZero ? '0' : rawText;
        formBadge.hidden = isEmptyOrZero;
        if (!isEmptyOrZero) {
            formBadge.setAttribute('aria-label', `${rawText} yeni soru`);
        } else {
            formBadge.removeAttribute('aria-label');
        }
    }

    function handleTabClick(event) {
        const targetTab = event.target?.closest?.('[role="tab"][data-inquiry-source-tab]');
        if (!targetTab || !tablist.contains(targetTab)) return;
        const source = targetTab.dataset.inquirySourceTab;
        if (!normalizeSource(source)) return;
        applySource(source, { focus: false, persist: true });
    }

    function handleTabKeydown(event) {
        const targetTab = event.target?.closest?.('[role="tab"][data-inquiry-source-tab]');
        if (!targetTab || !tablist.contains(targetTab)) return;

        const currentIndex = tabs.indexOf(targetTab);
        if (currentIndex === -1) return;

        let nextIndex = null;
        if (event.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === 'ArrowLeft') {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = tabs.length - 1;
        }

        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        applySource(nextTab.dataset.inquirySourceTab, { focus: true, persist: true });
    }

    tablist.addEventListener('click', handleTabClick);
    tablist.addEventListener('keydown', handleTabKeydown);

    let badgeObserver = null;
    syncFormBadge();
    const MutationObserverCtor = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (homeBadge && typeof MutationObserverCtor === 'function') {
        badgeObserver = new MutationObserverCtor(() => {
            syncFormBadge();
        });
        badgeObserver.observe(homeBadge, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['hidden']
        });
    }

    const stored = readStoredSource(resolveStorage());
    const initialSource = stored.ok
        ? (stored.value || DEFAULT_SOURCE)
        : (normalizeSource(activeSource) || DEFAULT_SOURCE);
    applySource(initialSource, { focus: false, persist: false });

    return {
        getActiveSource: () => activeSource,
        setSource(source, opts = {}) {
            applySource(source, { focus: Boolean(opts.focus), persist: true });
        },
        destroy() {
            tablist.removeEventListener('click', handleTabClick);
            tablist.removeEventListener('keydown', handleTabKeydown);
            badgeObserver?.disconnect();
            badgeObserver = null;
        }
    };
}
