/**
 * @fileoverview Pasaport sayfası OCR metni puanlama yardımcısı.
 * `src/managers/yknManager.js` içindeki puanlama gövdesinin saf modül kopyasıdır.
 */

function readProfileText(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * OCR metninin pasaport kimlik (biodata) sayfası olma olasılığını puanlar.
 *
 * @param {string} text - Sayfadan çıkarılan OCR metni.
 * @param {string} [studentName=''] - Öğrencinin adı ve soyadı.
 * @param {string} [passportNo=''] - Öğrencinin pasaport numarası.
 * @returns {number} Sayfa uygunluk puanı.
 */
export function scorePassportPageText(text, studentName = '', passportNo = '') {
    if (!text || typeof text !== 'string') return 0;
    let score = 0;
    const upperText = text.toUpperCase();

    // 1. MRZ (Machine Readable Zone) indicators - massive signal for biodata page
    if (upperText.includes('P<') || /P[A-Z0-9<]{5,}/.test(upperText) || upperText.includes('<<<')) {
        score += 100;
    }

    // 2. Passport identification words in multiple languages
    if (
        upperText.includes('PASSPORT') ||
        upperText.includes('PASSEPORT') ||
        upperText.includes('PASAPORTE') ||
        upperText.includes('PASAPORT') ||
        upperText.includes('ПАСПОРТ') ||
        upperText.includes('جواز') ||
        upperText.includes('REISEPASS') ||
        upperText.includes('PASSAPORTO')
    ) {
        score += 30;
    }

    // 3. Student Passport Number Match
    if (passportNo) {
        const cleanNo = readProfileText(passportNo).replace(/\s+/g, '').toUpperCase();
        if (cleanNo.length >= 5 && upperText.replace(/\s+/g, '').includes(cleanNo)) {
            score += 50;
        }
    }

    // 4. Student Name Token Match
    if (studentName) {
        const nameTokens = readProfileText(studentName).toUpperCase().split(/\s+/).filter(t => t.length >= 3);
        let matchedTokens = 0;
        for (const token of nameTokens) {
            if (upperText.includes(token)) matchedTokens++;
        }
        if (matchedTokens > 0) {
            score += Math.min(40, matchedTokens * 15);
        }
    }

    // 5. Passport field labels (Dates, Birth, Authority, Gender) in multiple languages
    if (
        upperText.includes('DATE OF BIRTH') ||
        upperText.includes('DATE DE NAISSANCE') ||
        upperText.includes('DOĞUM TARİHİ') ||
        upperText.includes('ДАТА РОЖДЕНИЯ') ||
        upperText.includes('ДАТА РОЖД') ||
        upperText.includes('تاريخ الميلاد')
    ) {
        score += 25;
    }
    if (
        upperText.includes('DATE OF EXPIRY') ||
        upperText.includes('EXPIRATION') ||
        upperText.includes('VALID UNTIL') ||
        upperText.includes('GEÇERLİLİK') ||
        upperText.includes('СРОК ДЕЙСТВИЯ') ||
        upperText.includes('ДЕЙСТВИТЕЛЕН ДО') ||
        upperText.includes('تاريخ الانتهاء') ||
        upperText.includes('تاريخ الصلاحية') ||
        upperText.includes('MÖHLETI') ||
        upperText.includes('MUDDATI')
    ) {
        score += 25;
    }
    if (
        upperText.includes('DATE OF ISSUE') ||
        upperText.includes('DÜZENLEME TARİHİ') ||
        upperText.includes('ISSUED') ||
        upperText.includes('ДАТА ВЫДАЧИ') ||
        upperText.includes('تاريخ الإصدار') ||
        upperText.includes('تاريخ الاصدار') ||
        upperText.includes('BERILGAN')
    ) {
        score += 20;
    }
    if (
        upperText.includes('PLACE OF BIRTH') ||
        upperText.includes('LIEU DE NAISSANCE') ||
        upperText.includes('DOĞUM YERİ') ||
        upperText.includes('МЕСТО РОЖДЕНИЯ') ||
        upperText.includes('МЕСТО РОЖД') ||
        upperText.includes('ТУҒАН ЖЕРІ') ||
        upperText.includes('ТУҒАН ЖЕР') ||
        upperText.includes('مكان الميلاد') ||
        upperText.includes('محل الميلاد')
    ) {
        score += 20;
    }
    if (
        upperText.includes('AUTHORITY') ||
        upperText.includes('AUTORITÉ') ||
        upperText.includes('VEREN MAKAM') ||
        upperText.includes('ОРГАН ВЫДАЧИ') ||
        upperText.includes('КЕМ ВЫДАН') ||
        upperText.includes('جهة الإصدار') ||
        upperText.includes('جهة الاصدار') ||
        upperText.includes('SMST')
    ) {
        score += 20;
    }

    return score;
}
