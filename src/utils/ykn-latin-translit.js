/**
 * @fileoverview Pasaport doğum yeri alanları için Kiril → Latin (ICAO Doc 9303)
 * çevrimyazı ve Arap alfabesi (Darice, Peştuca, Urduca) elle giriş tespiti.
 */

const CYRILLIC_TO_LATIN = Object.freeze({
    А: 'A',
    Б: 'B',
    В: 'V',
    Г: 'G',
    Д: 'D',
    Е: 'E',
    Ё: 'E',
    Ж: 'ZH',
    З: 'Z',
    И: 'I',
    Й: 'I',
    К: 'K',
    Л: 'L',
    М: 'M',
    Н: 'N',
    О: 'O',
    П: 'P',
    Р: 'R',
    С: 'S',
    Т: 'T',
    У: 'U',
    Ф: 'F',
    Х: 'KH',
    Ц: 'TS',
    Ч: 'CH',
    Ш: 'SH',
    Щ: 'SHCH',
    Ъ: 'IE',
    Ы: 'Y',
    Ь: '',
    Э: 'E',
    Ю: 'IU',
    Я: 'IA',
    І: 'I',
    Ї: 'I',
    Є: 'IE',
    Ґ: 'G',
    Ў: 'U',
    Қ: 'K',
    Ғ: 'G',
    Ң: 'N',
    Ү: 'U',
    Ұ: 'U',
    Ө: 'O',
    Ә: 'A',
    Һ: 'H',
    Ҳ: 'H',
    Ҷ: 'J',
    Ӣ: 'I',
    Ӯ: 'U'
});

const CYRILLIC_CHAR_RE = /[\u0400-\u052F]/;
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_SCRIPT_GLOBAL_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+/g;
const LATIN_LETTER_RE = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/;
const KEPT_CHAR_RE = /[A-Z\u00C0-\u024F\u1E00-\u1EFF0-9 ,.\-]/;

/**
 * Kiril harfli metni ICAO Doc 9303 tablosuna göre büyük harfli Latin metne dönüştürür.
 * Rakamlar, boşluklar, tireler, virgüller ve noktalar korunur.
 *
 * @param {string} text - Dönüştürülecek metin.
 * @returns {string} Büyük harfli Latin karşılığı.
 */
export function transliterateCyrillic(text) {
    if (!text || typeof text !== 'string') return '';
    const upper = text.normalize('NFC').toUpperCase();
    let result = '';

    for (const ch of upper) {
        if (Object.prototype.hasOwnProperty.call(CYRILLIC_TO_LATIN, ch)) {
            result += CYRILLIC_TO_LATIN[ch];
        } else if (KEPT_CHAR_RE.test(ch)) {
            result += ch;
        } else {
            result += ' ';
        }
    }

    return result.replace(/\s+/g, ' ').trim();
}

/**
 * Arap alfabesi barındıran iki dilli alandan yalnızca Latin belirteçlerini çıkarır.
 *
 * @param {string} text - Ham doğum yeri metni.
 * @returns {string} Temizlenmiş büyük harfli Latin belirteçler veya boş dize.
 */
function extractLatinSegmentFromBilingual(text) {
    const withoutArabic = text
        .replace(ARABIC_SCRIPT_GLOBAL_RE, ' ')
        .normalize('NFC')
        .toUpperCase();

    if (!LATIN_LETTER_RE.test(withoutArabic)) {
        return '';
    }

    const tokens = withoutArabic
        .split(/\s+/)
        .map((token) => token.replace(/^[^A-Z\u00C0-\u024F\u1E00-\u1EFF0-9]+|[^A-Z\u00C0-\u024F\u1E00-\u1EFF0-9.]+$/g, ''))
        .filter((token) => /[A-Z\u00C0-\u024F\u1E00-\u1EFF0-9]/.test(token));

    const joined = tokens.join(' ').replace(/\s+/g, ' ').trim();
    return LATIN_LETTER_RE.test(joined) ? joined : '';
}

/**
 * Pasaport doğum yeri değerini YÖKSİS için Latin alfabesine normalize eder.
 * Kiril metni çevirir; Arap alfabesini asla tahmin etmez (varsa Latin parçayı alır,
 * yoksa elle giriş için `needsManual: true` döner).
 *
 * @param {string} text - Doğum yeri ham metni.
 * @returns {{ value: string, needsManual: boolean }} Normalize sonuç.
 */
export function toLatinBirthPlace(text) {
    if (!text || typeof text !== 'string') {
        return { value: '', needsManual: false };
    }

    const trimmed = text.trim();
    if (!trimmed) {
        return { value: '', needsManual: false };
    }

    if (ARABIC_SCRIPT_RE.test(trimmed)) {
        const latinOnly = extractLatinSegmentFromBilingual(trimmed);
        if (!latinOnly) {
            return { value: '', needsManual: true };
        }
        return {
            value: CYRILLIC_CHAR_RE.test(latinOnly) ? transliterateCyrillic(latinOnly) : latinOnly,
            needsManual: false
        };
    }

    if (CYRILLIC_CHAR_RE.test(trimmed)) {
        const transliterated = transliterateCyrillic(trimmed);
        return { value: transliterated, needsManual: false };
    }

    return { value: trimmed.toUpperCase(), needsManual: false };
}
