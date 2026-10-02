const TEMPLATES = Object.freeze([
    ['application_received', 'Başvuru alındı'], ['document_update_needed', 'Belge güncellemesi'],
    ['status_updated', 'Durum güncellemesi'], ['forwarded_to_migration', 'Göç İdaresine iletildi'],
    ['application_completed', 'Başvuru tamamlandı']
]);
const LANGUAGES = Object.freeze([['tr', 'Türkçe'], ['en', 'English'], ['ru', 'Русский'],
    ['tk', 'Türkmençe'], ['ar', 'العربية']]);
const CHANNELS = Object.freeze([['whatsapp', 'WhatsApp'], ['email', 'E-posta']]);
const REASONS = Object.freeze({
    WHATSAPP_CONSENT_REQUIRED: 'Öğrencinin WhatsApp izni yok.',
    WHATSAPP_CONSENT_PHONE_CHANGED: 'Telefon değişti; öğrencinin yeniden izin vermesi gerekiyor.',
    WHATSAPP_PROVIDER_NOT_CONFIGURED: 'WhatsApp sağlayıcısı yapılandırılmadı.',
    EMAIL_PROVIDER_NOT_CONFIGURED: 'E-posta sağlayıcısı yapılandırılmadı.',
    RECIPIENT_PHONE_UNAVAILABLE: 'Başvuruda geçerli uluslararası telefon numarası yok.',
    RECIPIENT_EMAIL_UNAVAILABLE: 'Başvuruda geçerli bir e-posta adresi yok.',
    TEMPLATE_STATUS_MISMATCH: 'Bu şablon mevcut başvuru durumunda kullanılamaz.'
});

function createText(document, tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
}

function createSelect(document, labelText, name, options, value, onChange) {
    const label = createText(document, 'label', '', labelText);
    const select = document.createElement('select');
    select.className = 'glass-input';
    select.name = name;
    for (const [optionValue, title] of options) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = title;
        option.selected = optionValue === value;
        select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    label.append(select);
    return select;
}

function readProviderStatus(item) {
    const labels = { not_sent: 'Kuyrukta; gönderim başlamadı', accepted: 'Sağlayıcı kabul etti; teslim edildiği doğrulanmadı',
        sent: 'Sağlayıcı gönderimi onayladı', delivered: 'Teslim edildi', read: 'Okundu',
        failed: 'Başarısız', unknown: 'Sonuç belirsiz; yeniden gönderim engellendi' };
    return labels[item.provider_status] || 'Durum bilinmiyor';
}

function readApplicationStatus(item) {
    return ({ queued: 'Kuyrukta', processing: 'İşleniyor', sent: 'Gönderildi', delivered: 'Teslim edildi',
        read: 'Okundu', failed: 'Başarısız' })[item.status] || 'Durum bilinmiyor';
}

function createHistory(document, items, onRetry) {
    const section = document.createElement('section');
    section.className = 'staff-notification-history';
    section.append(createText(document, 'h4', '', 'Bildirim geçmişi'));
    if (!items.length) section.append(createText(document, 'p', '', 'Henüz bildirim kaydı yok.'));
    for (const item of items) {
        const row = document.createElement('div');
        row.className = 'staff-notification-history-row';
        row.append(createText(document, 'span', '', `${item.channel === 'whatsapp' ? 'WhatsApp' : 'E-posta'} · ${item.recipient_masked || 'Alıcı gizli'}`),
            createText(document, 'span', '', `${readApplicationStatus(item)} · ${readProviderStatus(item)}`));
        if (item.can_retry) {
            const retry = document.createElement('button');
            retry.type = 'button'; retry.className = 'btn btn-outline'; retry.textContent = 'Tekrar kuyruğa al';
            retry.addEventListener('click', () => onRetry(item.id));
            row.append(retry);
        }
        section.append(row);
    }
    return section;
}

/** Creates same-origin staff requests for notification preview, enqueue, and history. */
export function createNotificationApi() {
    async function request(path, options = {}) {
        const response = await fetch(path, { credentials: 'same-origin', ...options });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(payload?.error?.message || 'Bildirim işlemi tamamlanamadı.'), {
            code: payload?.error?.code, status: response.status
        });
        return payload;
    }
    const url = (applicationId) => `/api/staff/applications/${encodeURIComponent(applicationId)}/notifications`;
    const json = (method, body, key) => ({ method, headers: {
        'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {})
    }, body: JSON.stringify(body) });
    return {
        preview(applicationId, selection) { return request(`${url(applicationId)}/preview`, json('POST', selection)); },
        enqueue(applicationId, selection, key) { return request(url(applicationId), json('POST', selection, key)); },
        history(applicationId) { return request(url(applicationId)); },
        retry(applicationId, notificationId) { return request(`${url(applicationId)}/${encodeURIComponent(notificationId)}/retry`, { method: 'POST' }); }
    };
}

/** Creates a detail panel for explicit staff previews, sends, and masked history. */
export function createNotificationManager(api) {
    const states = new Map();
    function stateFor(applicationId) {
        if (!states.has(applicationId)) states.set(applicationId, { channel: 'whatsapp', template_key: 'status_updated',
            language: 'tr', preview: null, history: [], historyLoaded: false, loading: false,
            message: '', error: '', idempotencyKey: null });
        return states.get(applicationId);
    }
    function createPanel(document, application, onChange) {
        if (!api) {
            const unavailable = document.createElement('section');
            unavailable.className = 'staff-notification-panel';
            unavailable.append(createText(document, 'h3', '', 'Öğrenci bildirimi'),
                createText(document, 'p', '', 'Bildirim API bağlantısı kullanılamıyor.'));
            return unavailable;
        }
        const state = stateFor(application.id);
        const panel = document.createElement('section');
        panel.className = 'staff-notification-panel';
        panel.append(createText(document, 'h3', '', 'Öğrenci bildirimi'));
        const updateSelection = (key, value) => {
            state[key] = value; state.preview = null; state.idempotencyKey = null; state.message = ''; state.error = '';
            onChange();
        };
        const channel = createSelect(document, 'Kanal', 'channel', CHANNELS, state.channel, (value) => updateSelection('channel', value));
        const template = createSelect(document, 'Şablon', 'template', TEMPLATES, state.template_key, (value) => updateSelection('template_key', value));
        const language = createSelect(document, 'Dil', 'language', LANGUAGES, state.language, (value) => updateSelection('language', value));
        panel.append(channel.parentElement, template.parentElement, language.parentElement);
        const previewButton = document.createElement('button');
        previewButton.type = 'button'; previewButton.className = 'btn btn-outline'; previewButton.textContent = 'Önizle';
        previewButton.disabled = state.loading;
        previewButton.addEventListener('click', async () => {
            state.loading = true; state.error = ''; state.message = ''; onChange();
            try { state.preview = await api.preview(application.id, { channel: state.channel,
                template_key: state.template_key, language: state.language }); }
            catch (error) { state.error = error.message; }
            state.loading = false; onChange();
        });
        panel.append(previewButton);
        if (state.preview) {
            if (state.preview.recipient_masked) panel.append(createText(document, 'p', '', `Alıcı: ${state.preview.recipient_masked}`));
            if (state.preview.message) panel.append(createText(document, 'pre', 'staff-notification-preview', state.preview.message));
            for (const reason of state.preview.blocked_reasons || []) {
                panel.append(createText(document, 'p', 'staff-notification-blocked', REASONS[reason] || 'Bildirim şu anda gönderilemez.'));
            }
            const send = document.createElement('button');
            send.type = 'button'; send.className = 'btn btn-primary'; send.textContent = 'Gönder';
            send.disabled = state.loading || !state.preview.can_send;
            send.addEventListener('click', async () => {
                state.idempotencyKey ||= crypto.randomUUID();
                state.loading = true; state.error = ''; onChange();
                try {
                    await api.enqueue(application.id, { channel: state.channel, template_key: state.template_key,
                        language: state.language }, state.idempotencyKey);
                    state.idempotencyKey = null;
                    state.message = 'Kuyruğa alındı; sağlayıcıya veya öğrenciye iletildiği doğrulanmış değildir.';
                    state.history = (await api.history(application.id)).notifications;
                } catch (error) {
                    state.error = error.code === 'PROVIDER_NOT_CONFIGURED'
                        ? 'Sağlayıcı yapılandırılmadı; gönderim devre dışı.'
                        : 'Sonuç doğrulanamadı. Güvenli tekrar için aynı istek anahtarı kullanılacak.';
                }
                state.loading = false; onChange();
            });
            panel.append(send);
        }
        if (state.message) panel.append(createText(document, 'p', 'staff-notification-status', state.message));
        if (state.error) panel.append(createText(document, 'p', 'staff-notification-error', state.error));
        panel.append(createHistory(document, state.history, async (notificationId) => {
            state.loading = true; state.error = ''; onChange();
            try {
                await api.retry(application.id, notificationId);
                state.message = 'Tekrar deneme kuyruğa alındı; gönderim veya teslim doğrulanmış değildir.';
                state.history = (await api.history(application.id)).notifications;
            } catch (error) { state.error = error.message; }
            state.loading = false; onChange();
        }));
        if (!state.historyLoaded && !state.loading) {
            state.historyLoaded = true; state.loading = true;
            api.history(application.id).then((result) => { state.history = result.notifications; })
                .catch(() => { state.error = 'Bildirim geçmişi yüklenemedi.'; })
                .finally(() => { state.loading = false; onChange(); });
        }
        return panel;
    }
    return Object.freeze({ createPanel });
}
