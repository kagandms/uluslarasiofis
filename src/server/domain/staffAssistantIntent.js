/**
 * Deterministic Turkish intent, duration, count, and staff-person parsing
 * for the staff Topi assistant. Runs before any model call.
 */

const PERSON_MATCHERS = Object.freeze([
    { key: 'kagan_samet', pattern: /(?:^|[^\p{L}])(?:kagan(?:\s+samet)?|samet)(?:['’]?(?:a|e|i|u|in|un|la|le|da|de|dan|den|ya|ye|yi|yu|nin|nun))?(?=$|[^\p{L}])/u },
    { key: 'asaf', pattern: /(?:^|[^\p{L}])asaf(?:['’]?(?:a|e|i|u|in|un|la|le|da|de|dan|den|ya|ye|yi|yu|nin|nun))?(?=$|[^\p{L}])/u },
    { key: 'eyup', pattern: /(?:^|[^\p{L}])eyup(?:['’]?(?:a|e|i|u|in|un|la|le|da|de|dan|den|ya|ye|yi|yu|nin|nun))?(?=$|[^\p{L}])/u },
    { key: 'oguz', pattern: /(?:^|[^\p{L}])oguz(?:['’]?(?:a|e|i|u|in|un|la|le|da|de|dan|den|ya|ye|yi|yu|nin|nun))?(?=$|[^\p{L}])/u },
    { key: 'eray', pattern: /(?:^|[^\p{L}])eray(?:['’]?(?:a|e|i|u|in|un|la|le|da|de|dan|den|ya|ye|yi|yu|nin|nun))?(?=$|[^\p{L}])/u }
]);

const TURKISH_UNITS = Object.freeze({
    sifir: 0,
    bir: 1,
    iki: 2,
    uc: 3,
    dort: 4,
    bes: 5,
    alti: 6,
    yedi: 7,
    sekiz: 8,
    dokuz: 9
});

const TURKISH_TENS = Object.freeze({
    on: 10,
    yirmi: 20,
    otuz: 30,
    kirk: 40,
    elli: 50,
    altmis: 60,
    yetmis: 70,
    seksen: 80,
    doksan: 90
});

const VIEW_ALIASES = Object.freeze([
    { view: 'yoksis-audit', patterns: [/\byoksis\b/u, /\beksik\s+evrak\b/u] },
    { view: 'work-hours', patterns: [/\bcalisma\s+saat\w*/u, /\bmesai\b/u] },
    { view: 'applications', patterns: [/\bbasvurular\w*/u, /\bbasvuru\s+(?:ekran|sekme|sayfa|kuyrug)/u] },
    { view: 'cover', patterns: [/\bkapak\w*/u] },
    { view: 'documents', patterns: [/\bbelgeler\w*/u, /\bdilekceler\w*/u, /\bbelge\s+(?:ekran|sekme|sayfa)/u] },
    { view: 'inquiries', patterns: [/\bgelen\s+sorular\w*/u, /\bsorular\w*/u] },
    { view: 'physical', patterns: [/\bfiziki\w*/u, /\bfiziksel\w*/u] },
    { view: 'print', patterns: [/\byazdirma\w*/u, /\bbaski\w*/u] },
    { view: 'teblig', patterns: [/\bteblig\w*/u] },
    { view: 'ykn', patterns: [/\bykn\b/u] }
]);

const NAVIGATION_VERB_PATTERN = /(?:^|[^\p{L}])(?:ac|git|gec|goster|ekran\w*|sekme\w*|sayfa\w*)(?=$|[^\p{L}])/u;

const NON_TODAY_DATE_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(dun(?:e|un|ku)?|yarin(?:a|in|ki)?|gecen\s+\w+|onceki\s+\w+|gelecek\s+\w+)(?=$|[^\p{L}])/u,
    /(?:^|[^\p{L}])(pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)(?=$|[^\p{L}])/u,
    /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\/\d{1,2})\b/u,
    /\b(\d{1,2}\s+(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik))\b/u
]);

const ARCHIVE_VERB_PATTERN = /(?:^|[^\p{L}])arsivl(?:e\w*|iyor\w*)(?=$|[^\p{L}])/u;
const ARCHIVE_MOVE_PATTERN = /(?:^|[^\p{L}])arsive\s+(?:[\p{L}\p{N}'’]+\s+){0,2}(?:al(?:ir\w*|abil\w*|in\w*|sana\w*|sin\w*|mak\w*|ma\w*|iyor\w*|acak\w*)?|tasi\w*|at(?:ar\w*|abil\w*|in\w*|ilsin\w*|sana\w*|mak\w*|ma\w*)?|aktar\w*|koy\w*|gonder\w*)(?=$|[^\p{L}])/u;
const APPROVE_VERB_PATTERN = /(?:^|[^\p{L}])onayl(?:a(?:r\w*|yabil\w*|yin\w*|sin\w*|sana\w*|nsin\w*|nabil\w*|nmeli\w*|nacak\w*|niyor\w*|yacak\w*|mak\w*|ma\w*|meli\w*|yayim|yalim)?|iyor\w*)(?=$|[^\p{L}])/u;
const REJECT_VERB_PATTERN = /(?:^|[^\p{L}])redd(?:et(?:sin\w*|sene\w*|mek\w*|me\w*|meli\w*)?|ed(?:er\w*|ebil\w*|in\w*|ilsin\w*|iyor\w*|ecek\w*|eyim|elim))(?=$|[^\p{L}])/u;
const SAVE_BUTTON_PATTERN = /(?:^|[^\p{L}])kaydet\s+tusu\w*(?=$|[^\p{L}])/u;
const MARK_VERB_PATTERN = /(?:^|[^\p{L}])isaretl(?:e(?:r\w*|yabil\w*|yebil\w*|yin\w*|sin\w*|sene\w*|nsin\w*|nebil\w*|nmeli\w*|necek\w*|niyor\w*|yecek\w*|mek\w*|me\w*|meli\w*|yeyim|yelim)?|iyor\w*)(?=$|[^\p{L}])/u;
const STATUS_VALUE_MAKE_PATTERN = /(?:^|[^\p{L}])(?:iletildi|tamamlandi|reddedildi|onaylandi|arsivlendi|iptal(?:\s+edildi)?|beklemede|inceleniyor|eksik\s+evrak|eksik\s+belge)\s+(?:olarak\s+)?yap(?:ar\w*|abil\w*|in(?:iz)?|sin\w*|sana\w*|ilsin\w*|ilabil\w*|ilacak\w*|iliyor\w*|iyor\w*|acak\w*|mak\w*|ma\w*|mali\w*|ayim|alim)?(?=$|[^\p{L}])/u;
const UNDO_VERB_PATTERN = /(?:^|[^\p{L}])geri\s+al(?:ir\w*|abil\w*|in(?:iz|sin\w*)?|sin\w*|sana\w*|iyor\w*|acak\w*|mak\w*|ma\w*|mali\w*|ayim|alim)?(?=$|[^\p{L}])/u;

const RED_LINE_PATTERNS = Object.freeze([
    ARCHIVE_VERB_PATTERN,
    ARCHIVE_MOVE_PATTERN,
    APPROVE_VERB_PATTERN,
    REJECT_VERB_PATTERN,
    SAVE_BUTTON_PATTERN,
    MARK_VERB_PATTERN,
    STATUS_VALUE_MAKE_PATTERN,
    UNDO_VERB_PATTERN
]);

const DELETE_VERB_PATTERN = /(?:^|[^\p{L}])(?:sil(?:er\w*|sen\w*|sin\w*|ebil\w*|eyim|elim|iyor\w*|ecek\w*|eceg\w*|meli\w*|in(?:iz|sin\w*|meli\w*|ebil\w*|ecek\w*|iyor\w*)?|me(?:yi|ye|k\w*|n\w*)?|dir\w*)?|purge)(?=$|[^\p{L}])/u;
const DISENROLLMENT_DOCUMENT_PATTERN = /kayit\s+silme(?:\s+(?:form\w*|dilekce\w*|belge\w*))?/gu;

const REMOVE_VERB_PATTERN = /(?:^|[^\p{L}])kaldir(?:in(?:iz)?|ir\w*|abil\w*|sana\w*|sene\w*|sin\w*|ilsin\w*|iyor\w*|acak\w*|ayim|alim|mak\w*|ma(?:yi|ya|ni\w*)?|meli\w*|ilabil\w*)?(?=$|[^\p{L}])/u;
const REMOVE_TARGET_PATTERN = /(?:^|[^\p{L}])(?:ogrenci\w*|basvuru\w*|kayit\w*|kayd\w*|belge\w*|evrak\w*|dosya\w*|dilekce\w*)(?=$|[^\p{L}])/u;

const CANCEL_VERB_PATTERN = /(?:^|[^\p{L}])iptal\s+(?:et(?:sin\w*|sene\w*|mek\w*|me\w*|meli\w*)?|ed(?:er\w*|ebil\w*|in\w*|ilsin\w*|iyor\w*|ecek\w*|eyim|elim))(?=$|[^\p{L}])/u;
const CANCEL_TARGET_PATTERN = /(?:^|[^\p{L}])(?:basvuru\w*|kayit\w*|kayd\w*|ogrenci\w*|belge\w*|islem\w*)(?=$|[^\p{L}])/u;

const SEND_VERB_PATTERN = /(?:^|[^\p{L}])gonder(?:ir\w*|ebil\w*|in\w*|sin\w*|ilsin\w*|sene\w*|iyor\w*|ecek\w*|mek\w*|me\w*|meli\w*|eyim|elim)?(?=$|[^\p{L}])/u;
const REQUEST_TARGET_PATTERN = /(?:^|[^\p{L}])tale(?:p|b)\w*(?=$|[^\p{L}])/u;
const APPLY_TARGET_PATTERN = /(?:^|[^\p{L}])apply(?:['’]?(?:a|ya|e|ye|da|de|dan|den))?(?=$|[^\p{L}])/u;

const GOC_TARGET_PATTERN = /(?:^|[^\p{L}])goc(?:['’]?e|e|net(?:['’]?e|e)?|\s+idares\w*)?(?=$|[^\p{L}])/u;
const FORWARD_VERB_PATTERN = /(?:^|[^\p{L}])ilet(?:ir\w*|ebil\w*|in(?:iz)?|sin\w*|sene\w*|ilsin\w*|ilebil\w*|ilecek\w*|iliyor\w*|iyor\w*|ecek\w*|mek\w*|me\w*|meli\w*|eyim|elim)?(?=$|[^\p{L}])/u;

const MOVE_VERB_PATTERN = /(?:^|[^\p{L}])tasi(?:r\w*|yabil\w*|yin\w*|sin\w*|sana\w*|nsin\w*|nabil\w*|nmali\w*|nacak\w*|niyor\w*|yor\w*|yacak\w*|mak\w*|ma\w*|mali\w*|yayim|yalim)?(?=$|[^\p{L}])/u;
const MOVE_TARGET_PATTERN = /(?:^|[^\p{L}])(?:basvuru\w*|ogrenci\w*|kayit\w*|kayd\w*)(?=$|[^\p{L}])/u;

const CHANGE_VERB_PATTERN = /(?:^|[^\p{L}])degistir(?:ir\w*|ebil\w*|in\w*|sin\w*|sene\w*|ilsin\w*|ilebil\w*|ilecek\w*|iliyor\w*|iyor\w*|ecek\w*|mek\w*|me\w*|meli\w*|eyim|elim)?(?=$|[^\p{L}])/u;
const UPDATE_VERB_PATTERN = /(?:^|[^\p{L}])guncell(?:e(?:r\w*|yebil\w*|yin\w*|sin\w*|sene\w*|nsin\w*|nebil\w*|nmeli\w*|necek\w*|niyor\w*|yecek\w*|mek\w*|me\w*|meli\w*|yeyim|yelim)?|iyor\w*)(?=$|[^\p{L}])/u;
const EDIT_VERB_PATTERN = /(?:^|[^\p{L}])duzenl(?:e(?:r\w*|yebil\w*|yin\w*|sin\w*|sene\w*|nsin\w*|nebil\w*|nmeli\w*|necek\w*|niyor\w*|yecek\w*|mek\w*|me\w*|meli\w*|yeyim|yelim)?|iyor\w*)(?=$|[^\p{L}])/u;
const EDIT_TARGET_PATTERN = /(?:^|[^\p{L}])(?:ad(?:i(?:n(?:i|a|da|dan))?|lar\w*)?|soyad\w*|isim\w*|ismi\w*|numara\w*|belge\w*|basvuru\w*|durum\w*|kayit\w*|kayd\w*|ogrenci\w*|evrak\w*|pasaport\w*)(?=$|[^\p{L}])/u;
const OLARAK_PATTERN = /(?:^|[^\p{L}])olarak(?=$|[^\p{L}])/u;

const SAVE_VERB_PATTERN = /(?:^|[^\p{L}])kayd(?:et(?:sin\w*|sene\w*|mek\w*|me\w*|meli\w*)?|ed(?:er\w*|ebil\w*|in\w*|ilsin\w*|iyor\w*|ecek\w*|eyim|elim))(?=$|[^\p{L}])/u;
const SAVE_CONTEXT_PATTERN = /(?:^|[^\p{L}])(?:yoksis(?:['’]?(?:e|te|de|i|ten|den))?|basvuru\w*|durum\w*|apply(?:['’]?(?:a|ya|e|ye|da|de))?)(?=$|[^\p{L}])/u;

const PRINT_TRIGGER_PATTERN = /(?:^|[^\p{L}])(?:dilekce\w*|taahhutname\w*|checklist\w*|kontrol\s+liste\w*|basvuru\s+form\w*|kayit\s+silme\s+form\w*|yazdir\w*|cikar\w*|cikti\w*|kopya\w*|taksit\w*|indirim\s+dilekce\w*)(?=$|[^\p{L}])/u;
const WORK_HOURS_TRIGGER_PATTERN = /(?:^|[^\p{L}])(?:saat\w*|dk|dakika\w*|mesai\w*|calisma\s+saat\w*|bucuk)(?=$|[^\p{L}])/u;
const TEBLIGAT_TRIGGER_PATTERN = /(?:^|[^\p{L}])teblig\w*(?=$|[^\p{L}])/u;
const YOKSIS_TRIGGER_PATTERN = /(?:^|[^\p{L}])(?:eksik\s+evrak\w*|yoksis\w*)(?=$|[^\p{L}])/u;
const APPLICATION_TRIGGER_PATTERN = /(?:^|[^\p{L}])(?:basvuru\w*|sorgula\w*|ara|arayin|bul|bulun|ogrenci\s+no\w*)(?=$|[^\p{L}])/u;
const YKN_TRIGGER_PATTERN = /(?:^|[^\p{L}])ykn(?:['’]?(?:ye|ya|e|a|de|da|yi|i))?(?=$|[^\p{L}])/u;

/**
 * Normalizes Turkish text to ASCII-folded lowercase for deterministic matching.
 * @param {string} text Raw text.
 * @returns {string} Folded lowercase text.
 */
export function normalizeTurkishText(text) {
    return String(text || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .trim();
}

/**
 * Returns true when a staff message asks for a forbidden red-line write/destructive action.
 * @param {string} message Raw staff message.
 * @returns {boolean} True if the message requests a forbidden action.
 */
export function isRedLineStaffMessage(message) {
    if (typeof message !== 'string') return false;
    const normalized = normalizeTurkishText(message);
    if (!normalized) return false;
    if (RED_LINE_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return true;
    }
    if (REMOVE_VERB_PATTERN.test(normalized) && REMOVE_TARGET_PATTERN.test(normalized)) {
        return true;
    }
    if (CANCEL_VERB_PATTERN.test(normalized) && CANCEL_TARGET_PATTERN.test(normalized)) {
        return true;
    }
    if (SEND_VERB_PATTERN.test(normalized) && (REQUEST_TARGET_PATTERN.test(normalized) || APPLY_TARGET_PATTERN.test(normalized))) {
        return true;
    }
    if (GOC_TARGET_PATTERN.test(normalized) && (FORWARD_VERB_PATTERN.test(normalized) || SEND_VERB_PATTERN.test(normalized))) {
        return true;
    }
    if (MOVE_VERB_PATTERN.test(normalized) && MOVE_TARGET_PATTERN.test(normalized)) {
        return true;
    }
    if (
        (CHANGE_VERB_PATTERN.test(normalized) || UPDATE_VERB_PATTERN.test(normalized) || EDIT_VERB_PATTERN.test(normalized))
        && EDIT_TARGET_PATTERN.test(normalized)
    ) {
        return true;
    }
    if (OLARAK_PATTERN.test(normalized) && (SAVE_VERB_PATTERN.test(normalized) || UPDATE_VERB_PATTERN.test(normalized))) {
        return true;
    }
    if (SAVE_VERB_PATTERN.test(normalized) && SAVE_CONTEXT_PATTERN.test(normalized)) {
        return true;
    }
    if (DELETE_VERB_PATTERN.test(normalized)) {
        const withoutDisenrollmentDoc = normalized.replace(DISENROLLMENT_DOCUMENT_PATTERN, ' ');
        if (DELETE_VERB_PATTERN.test(withoutDisenrollmentDoc)) {
            return true;
        }
    }
    return false;
}

function parseTurkishNumberWord(normalizedText) {
    const tokens = normalizedText.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i += 1) {
        const word = tokens[i];
        if (word === 'on' && tokens[i + 1] === 'lisans') {
            continue;
        }
        if (Object.hasOwn(TURKISH_TENS, word)) {
            const tens = TURKISH_TENS[word];
            const next = tokens[i + 1];
            if (next && Object.hasOwn(TURKISH_UNITS, next) && next !== 'sifir') {
                return tens + TURKISH_UNITS[next];
            }
            return tens;
        }
        if (word === 'yuz') return 100;
        if (Object.hasOwn(TURKISH_UNITS, word)) {
            return TURKISH_UNITS[word];
        }
    }
    return null;
}

/**
 * Parses a duration expression in Turkish or digits and returns hours as a number.
 * Returns raw out-of-range or non-half-hour numbers so the tool can report a clear explanation.
 * @param {string} text Raw duration text or full message.
 * @returns {number|null} Parsed hours, or null when no duration is present.
 */
export function parseHoursText(text) {
    if (typeof text !== 'string') return null;
    const normalized = normalizeTurkishText(text);
    if (!normalized) return null;

    // 1. "<hours> saat <minutes> dk/dakika"
    const hoursAndMinutes = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*(?:saat|sa)\s*(\d+)\s*(?:dk|dakika)\b/u);
    if (hoursAndMinutes) {
        const hours = Number(hoursAndMinutes[1].replace(',', '.'));
        const minutes = Number(hoursAndMinutes[2]);
        if (Number.isFinite(hours) && Number.isFinite(minutes)) {
            return hours + minutes / 60;
        }
    }

    // 2. "<number> bucuk"
    const numericHalf = normalized.match(/(-?\d+)\s+bucuk\b/u);
    if (numericHalf) {
        const base = Number(numericHalf[1]);
        if (Number.isFinite(base)) {
            return base >= 0 ? base + 0.5 : base - 0.5;
        }
    }

    // 3. "<turkish-word> bucuk" (e.g., "altı buçuk", "on iki buçuk")
    const wordHalf = normalized.match(/\b((?:on|yirmi)\s+)?(bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yirmi)\s+bucuk\b/u);
    if (wordHalf) {
        const phrase = `${wordHalf[1] || ''}${wordHalf[2]}`.trim();
        const base = parseTurkishNumberWord(phrase);
        if (base !== null) return base + 0.5;
    }

    // 4. "yarim saat" / "bucuk saat"
    if (/\b(?:yarim|bucuk)\s+saat\b/u.test(normalized)) {
        return 0.5;
    }

    // 5. "<minutes> dk/dakika"
    const minutesOnly = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*(?:dk|dakika)\b/u);
    if (minutesOnly) {
        const minutes = Number(minutesOnly[1].replace(',', '.'));
        if (Number.isFinite(minutes)) return minutes / 60;
    }

    // 6. "<number> saat"
    const numericHours = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*(?:saat|sa)\b/u);
    if (numericHours) {
        const hours = Number(numericHours[1].replace(',', '.'));
        if (Number.isFinite(hours)) return hours;
    }

    // 7. "<turkish-word> saat"
    const wordHours = normalized.match(/\b((?:on|yirmi)\s+)?(sifir|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yirmi)\s+saat\b/u);
    if (wordHours) {
        const phrase = `${wordHours[1] || ''}${wordHours[2]}`.trim();
        const hours = parseTurkishNumberWord(phrase);
        if (hours !== null) return hours;
    }

    // 8. Standalone numeric value (e.g., "6,5", "6.25", "25")
    const standaloneNumeric = normalized.match(/^-?\d{1,3}(?:[.,]\d{1,4})?$/u);
    if (standaloneNumeric) {
        const value = Number(standaloneNumeric[0].replace(',', '.'));
        return Number.isFinite(value) ? value : null;
    }

    return null;
}

/**
 * Parses an integer copy count from digits or Turkish number words.
 * @param {string} text Raw text or message.
 * @returns {number|null} Parsed integer count, or null when no count is present.
 */
export function parseCount(text) {
    if (typeof text !== 'string') return null;
    const normalized = normalizeTurkishText(text);
    if (!normalized) return null;

    const digitMatch = normalized.match(/(?:^|\s)(-?\d{1,7})(?=\s|$)/u);
    if (digitMatch) {
        const value = Number.parseInt(digitMatch[1], 10);
        if (Number.isSafeInteger(value)) return value;
    }

    return parseTurkishNumberWord(normalized);
}

/**
 * Resolves a staff person key from Turkish text.
 * Returns the person key when uniquely matched, `{ ask }` when ambiguous, or `null` when unknown.
 * @param {string} text Raw text or message.
 * @returns {string|{ ask: string }|null} Person key, disambiguation prompt, or null.
 */
export function resolvePerson(text) {
    if (typeof text !== 'string') return null;
    const normalized = normalizeTurkishText(text);
    if (!normalized) return null;

    const matched = [];
    for (const entry of PERSON_MATCHERS) {
        if (entry.pattern.test(normalized)) {
            matched.push(entry.key);
        }
    }

    if (matched.length === 1) return matched[0];
    if (matched.length > 1) {
        return {
            ask: 'Birden fazla personel adı geçiyor. Hangi personel için çalışma saati gireyim? (Kağan Samet, Asaf, Eyüp, Oğuz, Eray)'
        };
    }
    return null;
}

function extractNonTodayDateText(normalized) {
    for (const pattern of NON_TODAY_DATE_PATTERNS) {
        const match = normalized.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function extractPassportCandidate(message) {
    const tokens = String(message || '').match(/\b[A-Za-z0-9]{5,20}\b/g) || [];
    for (const token of tokens) {
        if (/\d/.test(token)) {
            return token.toUpperCase();
        }
    }
    return '';
}

function resolveNavigateView(normalized) {
    if (!NAVIGATION_VERB_PATTERN.test(normalized)) return null;
    for (const entry of VIEW_ALIASES) {
        if (entry.patterns.some((pattern) => pattern.test(normalized))) {
            return entry.view;
        }
    }
    return null;
}

const POLITE_QUERY_FILLER_SOURCE =
    'm[ıiİuü]s[ıiİuü]n(?:[ıiİuü]z)?|rica(?:\\s+ed(?:er[\\p{L}\\p{N}]*|ebilir[\\p{L}\\p{N}]*))?|ederim|edebilir[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü](?:y[ıiİuü]m)?)?|edersen(?:iz)?|eder\\s+m[ıiİuü](?:s[ıiİuü]n(?:[ıiİuü]z)?)?|bakal[ıiİ]m|l[uü]tfen|acaba';

const TEBLIGAT_QUERY_REMOVE_PATTERN = new RegExp(
    `(?:^|[^\\p{L}])(?:tebli[gğ][\\p{L}\\p{N}]*|bul(?:un|ur[\\p{L}\\p{N}]*|abilir[\\p{L}\\p{N}]*)?(?:\\s+m[ıiİuü])?|ara(?:y[iı]n|r[\\p{L}\\p{N}]*|b[iı]l[\\p{L}\\p{N}]*)?(?:\\s+m[ıiİuü])?|sorgula[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|getir[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|bak[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|g[oö]ster[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|listele[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|kontrol\\s+(?:et[\\p{L}\\p{N}]*|ed(?:er[\\p{L}\\p{N}]*|ebilir[\\p{L}\\p{N}]*))(?:\\s+m[ıiİuü])?|i[cç]in|var\\s+m[iı]|nedir|${POLITE_QUERY_FILLER_SOURCE})(?=$|[^\\p{L}])`,
    'giu'
);

const YOKSIS_QUERY_REMOVE_PATTERN = new RegExp(
    `(?:^|[^\\p{L}])(?:y[oö]ksis[\\p{L}\\p{N}]*|eksik\\s+evrak[\\p{L}\\p{N}]*|durum[\\p{L}\\p{N}]*|sorgula[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|ara[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|bul[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|bak[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|listele[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|kontrol[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|nedir|var\\s+m[iı]|i[cç]in|${POLITE_QUERY_FILLER_SOURCE})(?=$|[^\\p{L}])`,
    'giu'
);

const APPLICATION_QUERY_REMOVE_PATTERN = new RegExp(
    `(?:^|[^\\p{L}])(?:ba[sş]vuru[\\p{L}\\p{N}]*|[oö][gğ]renci\\s+no[\\p{L}\\p{N}]*|[oö][gğ]renci[\\p{L}\\p{N}]*|sorgula[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|ara(?:y[iı]n)?(?:\\s+m[ıiİuü])?|bul(?:un)?(?:\\s+m[ıiİuü])?|bak[\\p{L}\\p{N}]*(?:\\s+m[ıiİuü])?|durum[\\p{L}\\p{N}]*|nedir|var\\s+m[iı]|i[cç]in|${POLITE_QUERY_FILLER_SOURCE})(?=$|[^\\p{L}])`,
    'giu'
);

function cleanQueryTokens(rawMessage, removePattern) {
    return String(rawMessage || '')
        .replace(removePattern, ' ')
        .replace(/[?!.,;:()[\]"'’]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Deterministically maps common Turkish staff commands to a tool call before falling back to the model.
 * Returns `null` for red-line requests or unrecognized messages.
 * @param {string} message Raw staff message.
 * @returns {{ tool: string, args: object } | null} Matched tool call or null.
 */
export function parseStaffIntent(message) {
    if (typeof message !== 'string') return null;
    const trimmed = message.trim();
    if (!trimmed) return null;
    if (isRedLineStaffMessage(trimmed)) return null;

    const normalized = normalizeTurkishText(trimmed);

    // 1. YKN flow (passportNo + ykn) vs pure navigation to YKN view.
    if (YKN_TRIGGER_PATTERN.test(normalized)) {
        const passportNo = extractPassportCandidate(trimmed);
        if (passportNo) {
            return { tool: 'run_ykn_flow', args: { passportNo } };
        }
        if (NAVIGATION_VERB_PATTERN.test(normalized)) {
            return { tool: 'navigate', args: { view: 'ykn' } };
        }
        return { tool: 'run_ykn_flow', args: { passportNo: '' } };
    }

    // 2. Pure navigation to a workspace view (when no data/count/duration query is attached).
    const navView = resolveNavigateView(normalized);
    if (navView) {
        const hasSearchOrActionArgs =
            (navView === 'work-hours' && parseHoursText(trimmed) !== null)
            || (navView === 'documents' && parseCount(trimmed) !== null)
            || (navView === 'teblig' && cleanQueryTokens(normalized, /\b(?:teblig\w*(?:\s+bul)?|ekran\w*|sekme\w*|sayfa\w*|ac|git|gec|goster)\b/giu).length >= 2)
            || (navView === 'applications' && /\d{4,}/.test(trimmed))
            || (navView === 'yoksis-audit' && /\d{4,}/.test(trimmed));
        if (!hasSearchOrActionArgs) {
            return { tool: 'navigate', args: { view: navView } };
        }
    }

    // 3. Tebligat search.
    if (TEBLIGAT_TRIGGER_PATTERN.test(normalized)) {
        const withoutApostropheSuffixes = trimmed.replace(
            /['’](?:y?[ıiuü]|n?[ıiuü]n|n?[ae]|y[ae]|d[ae]n?|t[ae]n?)(?=$|[^\p{L}])/giu,
            ''
        );
        const query = cleanQueryTokens(
            withoutApostropheSuffixes,
            TEBLIGAT_QUERY_REMOVE_PATTERN
        );
        return { tool: 'search_tebligat', args: { query } };
    }

    // 4. Document print proposal (before YÖKSİS check when explicitly asking for taahhütname).
    const isUndertakingDoc = /\btaahhutname\w*/u.test(normalized);
    if (PRINT_TRIGGER_PATTERN.test(normalized) && (!YOKSIS_TRIGGER_PATTERN.test(normalized) || isUndertakingDoc)) {
        const count = parseCount(trimmed);
        const query = cleanQueryTokens(
            trimmed,
            /(?:^|[^\p{L}\p{N}])(?:-?\d+|tane|adet|kopya|n[uü]sha|yazd[iı]r[\p{L}\p{N}]*|[cç][iı]kar[\p{L}\p{N}]*|[cç][iı]kt[iı][\p{L}\p{N}]*|ver[\p{L}\p{N}]*|l[uü]tfen|on(?!\s+lisans)|bir|iki|[uü][cç]|d[oö]rt|be[sş]|alt[iı]|yedi|sekiz|dokuz|yirmi|otuz|k[iı]rk|elli)(?=$|[^\p{L}\p{N}])/giu
        );
        const args = { query };
        if (count !== null) args.copies = count;
        return { tool: 'propose_documents_print', args };
    }

    // 5. Work hours proposal.
    if (WORK_HOURS_TRIGGER_PATTERN.test(normalized)) {
        const person = resolvePerson(trimmed);
        const hours = parseHoursText(trimmed);
        const dateText = extractNonTodayDateText(normalized);
        const args = {};
        if (typeof person === 'string') args.person = person;
        if (hours !== null) args.hours = hours;
        if (dateText) args.dateText = dateText;
        return { tool: 'propose_work_hours', args };
    }

    // 6. YÖKSİS document audit lookup.
    if (YOKSIS_TRIGGER_PATTERN.test(normalized)) {
        const query = cleanQueryTokens(
            trimmed,
            YOKSIS_QUERY_REMOVE_PATTERN
        );
        const args = {};
        if (query) args.query = query;
        return { tool: 'lookup_yoksis_audit', args };
    }

    // 7. Application search.
    if (APPLICATION_TRIGGER_PATTERN.test(normalized)) {
        const query = cleanQueryTokens(
            trimmed,
            APPLICATION_QUERY_REMOVE_PATTERN
        );
        if (query.length >= 1) {
            return { tool: 'search_applications', args: { query } };
        }
    }

    return null;
}
