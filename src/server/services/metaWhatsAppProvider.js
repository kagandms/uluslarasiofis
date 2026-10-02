const GRAPH_API_ORIGIN = 'https://graph.facebook.com';
const PHONE_NUMBER_ID_PATTERN = /^\d{5,30}$/;
const API_VERSION_PATTERN = /^v\d{2,3}\.\d+$/;
const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;

function isPlainRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function readTemplate(environment, templateKey, language) {
    const selected = environment.WHATSAPP_APPROVED_TEMPLATES?.[templateKey]?.[language];
    if (!selected || !TEMPLATE_NAME_PATTERN.test(selected.name || '')
        || typeof selected.languageCode !== 'string' || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(selected.languageCode)) {
        throw Object.assign(new Error('approved_template_unavailable'), { classification: 'permanent' });
    }
    return selected;
}

function isConfigured(environment) {
    return typeof environment.WHATSAPP_ACCESS_TOKEN === 'string' && environment.WHATSAPP_ACCESS_TOKEN.length > 0
        && PHONE_NUMBER_ID_PATTERN.test(environment.WHATSAPP_PHONE_NUMBER_ID || '')
        && API_VERSION_PATTERN.test(environment.WHATSAPP_CLOUD_API_VERSION || '')
        && isPlainRecord(environment.WHATSAPP_APPROVED_TEMPLATES)
        && Object.keys(environment.WHATSAPP_APPROVED_TEMPLATES).length > 0;
}

/** Creates a template-only Meta Cloud API adapter with an injectable transport for local tests. */
export function createMetaWhatsAppProvider(environment, fetchImplementation = fetch) {
    const configured = isConfigured(environment);
    return Object.freeze({
        isConfigured: configured,
        isTemplateConfigured(templateKey, language) {
            if (!configured) return false;
            try { readTemplate(environment, templateKey, language); return true; }
            catch { return false; }
        },
        async dispatch(input) {
            if (!configured) throw Object.assign(new Error('provider_not_configured'), { classification: 'permanent' });
            const selectedTemplate = readTemplate(environment, input.templateKey, input.language);
            const recipient = input.recipient.replace(/^\+/, '');
            if (!/^\d{8,15}$/.test(recipient)) {
                throw Object.assign(new Error('recipient_invalid'), { classification: 'permanent' });
            }
            const endpoint = `${GRAPH_API_ORIGIN}/${environment.WHATSAPP_CLOUD_API_VERSION}/${environment.WHATSAPP_PHONE_NUMBER_ID}/messages`;
            const response = await fetchImplementation(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${environment.WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ messaging_product: 'whatsapp',
                    to: recipient, type: 'template',
                    template: { name: selectedTemplate.name,
                        language: { code: selectedTemplate.languageCode } } })
            });
            if (!response.ok) {
                const classification = response.status === 429 ? 'transient'
                    : response.status >= 500 ? 'unknown' : 'permanent';
                throw Object.assign(new Error('meta_provider_rejected'), { classification });
            }
            const payload = await response.json().catch(() => null);
            const messageId = payload?.messages?.[0]?.id;
            if (typeof messageId !== 'string' || !messageId.startsWith('wamid.')) {
                throw Object.assign(new Error('meta_provider_outcome_unknown'), { classification: 'unknown' });
            }
            return { status: 'accepted', messageId };
        }
    });
}
