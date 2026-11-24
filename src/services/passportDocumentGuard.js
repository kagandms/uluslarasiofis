/**
 * @fileoverview Pasaport sayfası yanlış belge koruması (MRZ + öğrenci eşleşmesi).
 */

import { scorePassportPageText } from '../utils/passportPageScore.js';

function readText(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

const MRZ_LINE1_START_RE = /^P[A-Z<]/;
const MRZ_LINE2_TOKEN_RE = /(?:[A-Z0-9]{9}|[A-Z0-9]{8}<|[A-Z0-9]{7}<<|[A-Z0-9]{6}<<<|[A-Z0-9]{5}<<<<)[0-9]/;

/**
 * Büyük harfe çevrilmiş OCR metninde pasaport MRZ alanı bulunup bulunmadığını belirler.
 * OCR motoru '<' dolgu karakterlerini bozabildiği veya kırpabildiği için, standart
 * MRZ desenlerine ek olarak en az iki adet çoklu '<' kümesi ya da 25+ karakterlik
 * MRZ 1./2. satır kalıpları da toleranslı biçimde kabul edilir.
 *
 * @param {string} upperText - Büyük harfe dönüştürülmüş sayfa OCR metni.
 * @returns {boolean} MRZ tespit edilirse true, aksi halde false.
 */
function detectMrz(upperText) {
    if (upperText.includes('P<') || upperText.includes('<<<')) {
        return true;
    }

    const fillerRuns = upperText.match(/<{2,}/g);
    if (fillerRuns && fillerRuns.length >= 2) {
        return true;
    }

    const compactLines = upperText
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ''));

    const mrzLikeLines = compactLines.filter((line) => line.length >= 30 && line.includes('<'));
    if (mrzLikeLines.length >= 2) {
        return true;
    }

    return compactLines.some((line) => {
        if (line.length < 25) {
            return false;
        }
        const chevronCount = (line.match(/</g) || []).length;
        if (chevronCount < 3) {
            return false;
        }
        return MRZ_LINE1_START_RE.test(line) || MRZ_LINE2_TOKEN_RE.test(line);
    });
}

/**
 * Bir belge sayfasının ilgili öğrenciye ait pasaport kimlik sayfası olup olmadığını değerlendirir.
 *
 * @param {{ text?: string, studentName?: string, passportNo?: string }} [input={}] - Sayfa OCR metni ve öğrenci bilgileri.
 * @returns {{ isPassport: boolean, hasMrz: boolean, passportNoMatched: boolean, nameMatched: boolean, score: number, reason: string }} Değerlendirme sonucu.
 */
export function evaluatePassportPage({ text = '', studentName = '', passportNo = '' } = {}) {
    if (!text || typeof text !== 'string' || !text.trim()) {
        return {
            isPassport: false,
            hasMrz: false,
            passportNoMatched: false,
            nameMatched: false,
            score: 0,
            reason: 'Sayfada okunabilir metin bulunamadı; pasaport belgesini kontrol edin.'
        };
    }

    const upperText = text.toUpperCase();
    const hasMrz = detectMrz(upperText);

    const cleanNo = readText(passportNo).replace(/\s+/g, '').toUpperCase();
    const passportNoMatched = cleanNo.length >= 5 && upperText.replace(/\s+/g, '').includes(cleanNo);

    const nameTokens = readText(studentName)
        .toUpperCase()
        .split(/\s+/)
        .filter((token) => token.length >= 3);
    const nameMatched = nameTokens.some((token) => upperText.includes(token));

    const score = scorePassportPageText(text, studentName, passportNo);
    const isPassport = Boolean(hasMrz && (passportNoMatched || nameMatched));

    let reason = 'Pasaport kimlik sayfası doğrulandı.';
    if (!hasMrz) {
        reason = 'Sayfada pasaport MRZ alanı bulunamadı; diploma veya farklı bir belge yüklenmiş olabilir.';
    } else if (!passportNoMatched && !nameMatched) {
        reason = 'Pasaport sayfası öğrencinin adı veya pasaport numarası ile eşleşmiyor.';
    }

    return {
        isPassport,
        hasMrz,
        passportNoMatched,
        nameMatched,
        score,
        reason
    };
}
