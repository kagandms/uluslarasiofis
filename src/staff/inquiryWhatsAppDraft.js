const MAX_QUOTED_MESSAGE_LENGTH = 400;

const SUPPORTED_LANGUAGES = new Set(['TR', 'EN', 'RU', 'TK', 'AR']);

const DRAFT_TEMPLATES = {
    TR: "Merhaba, İstanbul Topkapı Üniversitesi Uluslararası Ofisi'nden yazıyorum. Gördüğümüz üzere portalımız üzerinden bize şu mesajı göndermişsiniz:\n«{message}»\n\n\n\nAnlayışınız için teşekkür ederiz.",
    EN: 'Hello, I am writing from the International Office of Istanbul Topkapı University. As we can see, you sent us the following message through our portal:\n“{message}”\n\n\n\nThank you for your understanding.',
    RU: 'Здравствуйте! Пишу вам из Международного офиса Стамбульского университета Топкапы. Как мы видим, вы отправили нам через наш портал следующее сообщение:\n«{message}»\n\n\n\nБлагодарим за понимание.',
    TK: 'Salam, Stambul Topkapy uniwersitetiniň Halkara ofisinden ýazýaryn. Görşümiz ýaly, siz portalymyz arkaly bize şu habary iberipsiňiz:\n«{message}»\n\n\n\nDüşünişiňiz üçin sag boluň.',
    AR: 'مرحباً، أكتب إليكم من المكتب الدولي في جامعة إسطنبول توبكابي. كما نرى، لقد أرسلتم إلينا عبر بوابتنا الرسالة التالية:\n«{message}»\n\n\n\nشكراً لتفهمكم.'
};

function stripControlCharsAndCollapseSpaces(value) {
    return String(value || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();
}

function truncateAtWordBoundary(text, maxLength) {
    if (text.length <= maxLength) return text;
    const slice = text.slice(0, maxLength);
    if (text[maxLength] === ' ') {
        return `${slice.trimEnd()}…`;
    }
    const lastSpace = slice.lastIndexOf(' ');
    const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
    return `${cut}…`;
}

function normalizeLanguage(language) {
    const code = String(language || '').trim().toUpperCase();
    return SUPPORTED_LANGUAGES.has(code) ? code : 'EN';
}

/**
 * Builds a localized WhatsApp reply draft quoting the visitor's inquiry message.
 * @param {{ language?: string, message?: string }} [params]
 * @returns {string}
 */
export function buildInquiryDraft({ language, message } = {}) {
    const lang = normalizeLanguage(language);
    const cleanMessage = truncateAtWordBoundary(
        stripControlCharsAndCollapseSpaces(message),
        MAX_QUOTED_MESSAGE_LENGTH
    );

    return DRAFT_TEMPLATES[lang].replace(/\{message\}/gu, () => cleanMessage);
}

/**
 * Builds a wa.me link for the visitor's phone digits with an optional pre-filled draft message.
 * @param {string} phone
 * @param {string} [draftText]
 * @returns {string}
 */
export function buildWhatsAppHref(phone, draftText) {
    const digits = String(phone || '').replace(/\D/gu, '');
    if (!digits) return '';
    const base = `https://wa.me/${digits}`;
    if (typeof draftText !== 'string' || !draftText.trim()) {
        return base;
    }
    return `${base}?text=${encodeURIComponent(draftText)}`;
}
