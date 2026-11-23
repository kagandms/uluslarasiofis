/**
 * @fileoverview Pasaport sayfası yanlış belge koruması (MRZ + öğrenci eşleşmesi).
 */

import { scorePassportPageText } from '../utils/passportPageScore.js';

function readText(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function detectMrz(upperText) {
    if (upperText.includes('P<') || upperText.includes('<<<')) {
        return true;
    }
    const mrzLikeLines = upperText
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ''))
        .filter((line) => line.length >= 30 && line.includes('<'));
    return mrzLikeLines.length >= 2;
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
