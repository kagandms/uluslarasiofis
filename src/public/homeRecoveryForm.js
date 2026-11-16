import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from './i18n/messages.js';

function readActiveLocale(root) {
    const lang = String(root?.documentElement?.lang || '').trim().toLowerCase();
    return SUPPORTED_LOCALES.includes(lang) ? lang : 'tr';
}

function createDefaultGetMessage(root) {
    return (key) => {
        const locale = readActiveLocale(root);
        return PUBLIC_MESSAGES[locale]?.[key] ?? PUBLIC_MESSAGES.tr[key] ?? key;
    };
}

function isNetworkFailure(error) {
    return !error || error.code === 'NETWORK_ERROR' || typeof error.status !== 'number';
}

function prefersReducedMotion(root) {
    return Boolean(root?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function restartRevealAnimation(element, className, root) {
    if (!element) return;
    element.classList.remove(className);
    if (prefersReducedMotion(root)) return;
    // Animasyonun her açılışta ve her tekrar gönderimde yeniden başlaması için yerleşimi zorla yenile.
    void element.offsetWidth;
    element.classList.add(className);
}

/**
 * Telegram kurtarma bağlantısını etkin dile göre ?start=recover_<dil> parametresiyle oluşturur.
 * @param {string|null|undefined} baseUrl Sunucudan dönen Telegram temel URL'si.
 * @param {string} language Aktif arayüz dili (tr|en|ru|tk|ar).
 * @returns {string|null} Güvenli Telegram bağlantısı veya geçersizse null.
 */
export function buildTelegramRecoveryUrl(baseUrl, language) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) return null;
    const normalizedLang = SUPPORTED_LOCALES.includes(language) ? language : 'tr';
    try {
        const parsed = new URL(baseUrl.trim());
        if (parsed.protocol !== 'https:') return null;
        const startValue = parsed.searchParams.get('start');
        if (typeof startValue === 'string' && /recover(?:_[a-z]{2})?/i.test(startValue)) {
            parsed.searchParams.set('start', startValue.replace(/recover(?:_[a-z]{2})?/i, `recover_${normalizedLang}`));
        } else {
            parsed.searchParams.set('start', `recover_${normalizedLang}`);
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

/**
 * Ana sayfadaki başvuru numarası hatırlatma formunu, Telegram seçeneğini ve dil senkronizasyonunu bağlar.
 * @param {{root?: Document, api: {readApplicationRecoveryOptions?: Function, requestApplicationAccessCodeRecoveryByEmail: Function}, getMessage?: (key: string) => string}} options Sayfa belgesi, API ve çeviri yardımcısı.
 * @returns {void} Form mevcutsa olay dinleyicilerini başlatır.
 */
export function initHomeRecoveryForm({ root = document, api, getMessage } = {}) {
    const form = root?.getElementById('access-recovery-form');
    if (!form) return;

    const resolveMessage = typeof getMessage === 'function' ? getMessage : createDefaultGetMessage(root);
    const panel = root.getElementById('access-recovery-panel');
    const toggleButton = root.getElementById('btn-access-recovery');
    const studentNumberInput = form.elements.namedItem('recovery_student_number')
        || form.querySelector('[name="recovery_student_number"]');
    const submitButton = form.querySelector('[type="submit"]');
    const telegramLink = root.getElementById('recovery-telegram-link');
    const languageBadge = root.getElementById('recovery-current-language');
    const feedbackContainer = root.getElementById('recovery-feedback');
    const feedbackMessage = root.getElementById('recovery-feedback-message');
    const spamWarning = root.getElementById('recovery-spam-warning');

    const telegramState = { enabled: false, baseUrl: null };
    let feedbackState = 'idle';
    let isSubmitting = false;

    function syncLanguageDisplay() {
        if (languageBadge) {
            languageBadge.textContent = resolveMessage('recoveryCurrentLanguageName');
        }
    }

    function syncTelegramLink() {
        if (!telegramLink) return;
        telegramLink.textContent = resolveMessage('recoveryTelegramAction');
        const url = telegramState.enabled
            ? buildTelegramRecoveryUrl(telegramState.baseUrl, readActiveLocale(root))
            : null;
        if (url) {
            telegramLink.href = url;
            telegramLink.hidden = false;
        } else {
            telegramLink.hidden = true;
            telegramLink.removeAttribute('href');
        }
    }

    function syncFeedbackMessages() {
        if (!feedbackContainer || !feedbackMessage) return;
        if (feedbackState === 'confirmed') {
            feedbackContainer.dataset.feedbackType = 'confirmed';
            feedbackContainer.hidden = false;
            feedbackMessage.dataset.i18n = 'recoveryConfirmation';
            feedbackMessage.textContent = resolveMessage('recoveryConfirmation');
            if (spamWarning) {
                spamWarning.dataset.i18n = 'recoverySpamWarning';
                spamWarning.textContent = resolveMessage('recoverySpamWarning');
                spamWarning.hidden = false;
            }
            return;
        }
        if (feedbackState === 'network_error') {
            feedbackContainer.dataset.feedbackType = 'error';
            feedbackContainer.hidden = false;
            feedbackMessage.dataset.i18n = 'recoveryNetworkRetry';
            feedbackMessage.textContent = resolveMessage('recoveryNetworkRetry');
            if (spamWarning) spamWarning.hidden = true;
            return;
        }
        delete feedbackContainer.dataset.feedbackType;
        feedbackMessage.textContent = '';
        delete feedbackMessage.dataset.i18n;
        if (spamWarning) spamWarning.hidden = true;
    }

    async function loadRecoveryOptions() {
        if (typeof api?.readApplicationRecoveryOptions !== 'function') {
            syncTelegramLink();
            return;
        }
        try {
            const options = await api.readApplicationRecoveryOptions();
            telegramState.enabled = options?.telegram?.enabled === true;
            telegramState.baseUrl = typeof options?.telegram?.url === 'string' ? options.telegram.url : null;
        } catch {
            // Seçenekler okunamazsa hata göstermeden yalnızca Telegram bağlantısı gizlenir.
            telegramState.enabled = false;
            telegramState.baseUrl = null;
        }
        syncTelegramLink();
    }

    if (toggleButton && panel) {
        toggleButton.addEventListener('click', () => {
            const shouldOpen = panel.hidden;
            panel.hidden = !shouldOpen;
            toggleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            if (shouldOpen) {
                restartRevealAnimation(panel, 'is-revealing', root);
                studentNumberInput?.focus?.();
            } else {
                panel.classList.remove('is-revealing');
            }
        });

        panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !panel.hidden) {
                panel.hidden = true;
                panel.classList.remove('is-revealing');
                toggleButton.setAttribute('aria-expanded', 'false');
                toggleButton.focus?.();
            }
        });
    }

    root.addEventListener('public:locale-changed', () => {
        syncLanguageDisplay();
        syncTelegramLink();
        syncFeedbackMessages();
        if (submitButton && !isSubmitting) {
            submitButton.textContent = resolveMessage('recoveryEmailSubmit');
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting || !studentNumberInput) return;
        const studentNumber = studentNumberInput.value.trim();
        if (!studentNumber) return;

        isSubmitting = true;
        // Tekrarlanan gönderimlerde önceki onay kutusunu temizleyerek sonucun yeniden göründüğünü ve okunduğunu hissettir.
        feedbackState = 'idle';
        feedbackContainer?.classList.remove('is-animating');
        syncFeedbackMessages();

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = resolveMessage('recoverySubmitting');
        }
        try {
            await api.requestApplicationAccessCodeRecoveryByEmail({
                student_number: studentNumber,
                language: readActiveLocale(root)
            });
            feedbackState = 'confirmed';
        } catch (error) {
            // Kayıt var/yok ayrımını sızdırmamak için tüm sunucu yanıtlarında aynı genel onay gösterilir.
            feedbackState = isNetworkFailure(error) ? 'network_error' : 'confirmed';
        } finally {
            isSubmitting = false;
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = resolveMessage('recoveryEmailSubmit');
            }
            syncFeedbackMessages();
            if (feedbackState === 'confirmed' || feedbackState === 'network_error') {
                restartRevealAnimation(feedbackContainer, 'is-animating', root);
            }
        }
    });

    syncLanguageDisplay();
    syncTelegramLink();
    syncFeedbackMessages();
    void loadRecoveryOptions();
}
