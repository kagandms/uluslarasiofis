import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractPassportDatesFromText,
    extractYoksisIdFromText,
    isValidYoksisId,
    extractPassportPlaceOfBirth,
    extractPassportIssuingAuthority,
    extractPassportMetadata,
    extractDatesFromMrz
} from '../src/utils/ykn-document-parser.js';

test('extracts a labeled YÖKSİS ID from acceptance letter text', () => {
    const result = extractYoksisIdFromText('Acceptance information - YÖKSİS ID: ABC-123-XY');

    assert.equal(result, 'ABC-123-XY');
});

test('extracts Topkapı YOKSIS ID from real acceptance letter text', () => {
    const textEn = 'Sedat GÖZCÜ Vice Head of International Relations Department YOKSIS ID: 0F0-881-60 You can scan the QR code';
    assert.equal(extractYoksisIdFromText(textEn), '0F0-881-60');

    const textTr = 'Sedat GÖZCÜ Uluslararası İlişkiler Daire Başkan Yardımcısı YÖKSİS ID: 0F0-881-60 Kare kodu taratarak';
    assert.equal(extractYoksisIdFromText(textTr), '0F0-881-60');

    const textRushana = 'Sedat GÖZCÜ Vice Head of International Relations Department YOKSIS ID: 821-EC2-34 You can scan the QR code';
    assert.equal(extractYoksisIdFromText(textRushana), '821-EC2-34');
});

test('rejects SVG-ICON-3HX and css artifacts from YOKSIS ID candidates', () => {
    assert.equal(extractYoksisIdFromText('svg-icon-3hx'), '');
    assert.equal(extractYoksisIdFromText('Metronic badge svg-icon-3hx element'), '');
    assert.equal(extractYoksisIdFromText('class="svg-icon svg-icon-3hx" YOKSIS ID: 821-EC2-34'), '821-EC2-34');
    assert.equal(isValidYoksisId('SVG-ICON-3HX'), false);
    assert.equal(isValidYoksisId('821-EC2-34'), true);
    assert.equal(isValidYoksisId('0F0-881-60'), true);
    assert.equal(isValidYoksisId('2024-05-12'), false);
});

test('extracts passport issue and expiry dates from labeled text', () => {
    const result = extractPassportDatesFromText(
        'Date of Issue: 11.03.2026 Date of Expiry: 11.03.2031'
    );

    assert.deepEqual(result, { issueDate: '2026-03-11', expiryDate: '2031-03-11' });
});

test('rejects invalid passport date order instead of guessing', () => {
    const result = extractPassportDatesFromText(
        'Düzenlenme Tarihi: 11.03.2031 Geçerlilik Tarihi: 11.03.2026'
    );

    assert.deepEqual(result, { issueDate: '', expiryDate: '' });
});

test('extracts passport dates written with English month names', () => {
    const result = extractPassportDatesFromText(
        'Date of issue: 11 MAR 2025 Date of expiry: 11 SEPTEMBER 2030'
    );

    assert.deepEqual(result, { issueDate: '2025-03-11', expiryDate: '2030-09-11' });
});

test('extracts passport dates separated by spaces after OCR', () => {
    const result = extractPassportDatesFromText(
        'Düzenlenme tarihi: 11 03 2025 Geçerlilik tarihi: 11 03 2030'
    );

    assert.deepEqual(result, { issueDate: '2025-03-11', expiryDate: '2030-03-11' });
});

test('extracts passport dates with two-digit years', () => {
    const result = extractPassportDatesFromText(
        'Date of issue: 11/03/25 Date of expiry: 11/03/30'
    );

    assert.deepEqual(result, { issueDate: '2025-03-11', expiryDate: '2030-03-11' });
});

test('extracts passport dates without separators in day-first and year-first formats', () => {
    const result = extractPassportDatesFromText(
        'Date of issue: 11032025 Date of expiry: 20300311'
    );

    assert.deepEqual(result, { issueDate: '2025-03-11', expiryDate: '2030-03-11' });
});

test('extracts passport dates with bilingual slash month names', () => {
    const result = extractPassportDatesFromText(
        'Date of issue: 11 MAR / MARS 2025 Date of expiry: 11 SEP / SEPT 2030'
    );

    assert.deepEqual(result, { issueDate: '2025-03-11', expiryDate: '2030-09-11' });
});

test('extracts passport dates with French labels', () => {
    const result = extractPassportDatesFromText(
        "Date de délivrance: 15/05/2023 Date d'expiration: 15/05/2033"
    );

    assert.deepEqual(result, { issueDate: '2023-05-15', expiryDate: '2033-05-15' });
});

test('extracts passport dates with Russian labels', () => {
    const result = extractPassportDatesFromText(
        'Дата выдачи: 10.02.2024 Действителен до: 10.02.2034'
    );

    assert.deepEqual(result, { issueDate: '2024-02-10', expiryDate: '2034-02-10' });
});

test('extracts expiry date from passport MRZ line when visual label is missing', () => {
    const textWithMrz = `
    REPUBLIC OF TURKEY PASSPORT
    SURNAME: DEMIR GIVEN NAMES: KAGAN
    Date of issue: 15.05.2022
    P<TURDEMIR<<KAGAN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
    U123456784TUR0205159M3205155<<<<<<<<<<<<<<02
    `;
    const result = extractPassportDatesFromText(textWithMrz);

    assert.deepEqual(result, { issueDate: '2022-05-15', expiryDate: '2032-05-15' });
});

test('extracts YOKSIS ID from various acceptance letter formats', () => {
    assert.equal(extractYoksisIdFromText('KABUL MEKTUBU KODU: 821-EC2-34'), '821-EC2-34');
    assert.equal(extractYoksisIdFromText('VERIFICATION CODE: 0F0-881-60'), '0F0-881-60');
    assert.equal(extractYoksisIdFromText('ACCEPTANCE LETTER NO: ABC-123-XY'), 'ABC-123-XY');
});

test('extracts passport dates with Uzbek labels', () => {
    const result = extractPassportDatesFromText(
        'Berilgan sanasi / Date of issue: 14.06.2024 Amal qilish muddati / Date of expiry: 13.06.2034'
    );

    assert.deepEqual(result, { issueDate: '2024-06-14', expiryDate: '2034-06-13' });
});

test('strictly rejects year 5552 or random numbers like 03045552', () => {
    const textWithRandomNumber = 'Passport Issue: 14.06.2024 PINFL: 31610085552012 Barcode: 03045552';
    const result = extractPassportDatesFromText(textWithRandomNumber);

    assert.notEqual(result.expiryDate, '5552-04-03');
    assert.equal(result.issueDate, '2024-06-14');
});

test('extracts Uzbek passport MRZ expiry using birthDate hint', () => {
    const textUzbek = `
    O'ZBEKISTON RESPUBLIKASI PASSPORT
    JUMABAEV UMIDJON
    Berilgan sanasi: 14 06 2024
    P<UZBJUMABAEV<<UMIDJON<<<<<<<<<<<<<<<<<<<<<
    FB2517115<0UZB0810168M3405260<<<<<<<<<<<<<<02
    `;
    const result = extractPassportDatesFromText(textUzbek, { birthDate: '2008-10-16' });

    assert.equal(result.issueDate, '2024-06-14');
    assert.equal(result.expiryDate, '2034-05-26');
});

test('extracts Ethiopian passport dates with English and Amharic labels', () => {
    const textEthiopian = `
    FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA PASSPORT
    Date of issue / የተሰጠበት ቀን: 16 DEC 2022
    Date of expiry / የሚያበቃበት ቀን: 15 DEC 2027
    `;
    const result = extractPassportDatesFromText(textEthiopian);

    assert.deepEqual(result, { issueDate: '2022-12-16', expiryDate: '2027-12-15' });
});

test('extracts passport dates with spaces around slashes and two-digit year', () => {
    const textSpaced = 'Date of issue : 16 / DEC / 22 Date of expiry : 15 / DEC / 27';
    const result = extractPassportDatesFromText(textSpaced);

    assert.deepEqual(result, { issueDate: '2022-12-16', expiryDate: '2027-12-15' });
});

test('falls back to candidate pair (earliest=issue, latest=expiry) when labels are missing or degraded', () => {
    const degradedText = 'PASSPORT DOCUMENT 123456\n16 DEC 2022\n15 DEC 2027';
    const result = extractPassportDatesFromText(degradedText);

    assert.deepEqual(result, { issueDate: '2022-12-16', expiryDate: '2027-12-15' });
});

test('rejects student birthDate or dates before 2010 from being selected as issueDate', () => {
    const text = 'Date of birth: 19.02.1988 Date of issue: 19.02.1988 10.10.2024 Date of expiry: 09.10.2029';
    const result = extractPassportDatesFromText(text, { birthDate: '1988-02-19' });

    assert.equal(result.issueDate, '2024-10-10');
    assert.equal(result.expiryDate, '2029-10-09');
});

test('extracts place of birth from English, Turkish, Russian and Uzbek passport text', () => {
    const textEn = 'PASSPORT REPUBLIC Place of birth: ASHGABAT Date of issue: 10.02.2024';
    assert.equal(extractPassportPlaceOfBirth(textEn), 'ASHGABAT');

    const textTr = 'TÜRKİYE CUMHURİYETİ PASAPORT Doğum Yeri: İSTANBUL Verildiği Tarih: 15.05.2023';
    assert.equal(extractPassportPlaceOfBirth(textTr), 'İSTANBUL');

    const textRu = 'ПАСПОРТ Место рождения: САМАРКАНД Дата выдачи: 12.01.2022';
    assert.equal(extractPassportPlaceOfBirth(textRu), 'САМАРКАНД');

    const textUz = "O'ZBEKISTON RESPUBLIKASI Tug'ilgan joyi: TOSHKENT Berilgan sanasi: 01.06.2023";
    assert.equal(extractPassportPlaceOfBirth(textUz), 'TOSHKENT');
});

test('extracts issuing authority from English, Turkish, French and Russian passport text', () => {
    const textEn = 'PASSPORT Authority: STATE MIGRATION SERVICE OF TURKMENISTAN Date of issue: 10.02.2024';
    assert.equal(extractPassportIssuingAuthority(textEn), 'STATE MIGRATION SERVICE OF TURKMENISTAN');

    const textTr = 'PASAPORT Belgeyi Veren Makam: İSTANBUL EMNİYET MÜDÜRLÜĞÜ Düzenlenme: 15.05.2023';
    assert.equal(extractPassportIssuingAuthority(textTr), 'İSTANBUL EMNİYET MÜDÜRLÜĞÜ');

    const textShort = 'PASSPORT Authority: SMST 1002 Date of expiry: 10.02.2029';
    assert.equal(extractPassportIssuingAuthority(textShort), 'SMST 1002');

    const textRu = 'ПАСПОРТ Орган выдачи: МВД 77001 Дата выдачи: 01.05.2021';
    assert.equal(extractPassportIssuingAuthority(textRu), 'МВД 77001');
});

test('extractPassportMetadata returns comprehensive object with dates, place of birth, and authority', () => {
    const fullText = `
    PASSPORT
    Place of birth: ASHGABAT
    Authority: SMST
    Date of issue: 11.03.2025
    Date of expiry: 11.03.2030
    `;
    const metadata = extractPassportMetadata(fullText);
    assert.equal(metadata.issueDate, '2025-03-11');
    assert.equal(metadata.expiryDate, '2030-03-11');
    assert.equal(metadata.placeOfBirth, 'ASHGABAT');
    assert.equal(metadata.issuingAuthority, 'SMST');
});

test('MRZ with OCR noise, brackets, spaces and sanitization', () => {
    const mrzText = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
    const res = extractDatesFromMrz(mrzText);
    assert.equal(res.birthDate, '1974-08-12');
    assert.equal(res.expiryDate, '2012-04-15');
});

test('extracts German passport (Reisepass) dates', () => {
    const text = "BUNDESREPUBLIK DEUTSCHLAND REISEPASS\nAusstellungsdatum: 24.03.2021\nGültig bis: 23.03.2031";
    const res = extractPassportDatesFromText(text);
    assert.equal(res.issueDate, '2021-03-24');
    assert.equal(res.expiryDate, '2031-03-23');
});

test('extracts Arabic passport dates', () => {
    const text = "PASSPORT\nتاريخ الإصدار: 15.01.2023\nتاريخ الانتهاء: 14.01.2033";
    const res = extractPassportDatesFromText(text);
    assert.equal(res.issueDate, '2023-01-15');
    assert.equal(res.expiryDate, '2033-01-14');
});

test('extracts Kazakh / Kyrgyz passport dates', () => {
    const text = "ҚАЗАҚСТАН РЕСПУБЛИКАСЫ ПАСПОРТ\nБерілген күні: 05.09.2022\nҚолданылу мерзімі: 04.09.2032";
    const res = extractPassportDatesFromText(text);
    assert.equal(res.issueDate, '2022-09-05');
    assert.equal(res.expiryDate, '2032-09-04');
});

test('extracts Azerbaijani passport dates', () => {
    const text = "AZƏRBAYCAN RESPUBLİKASI PASPORT\nVerilmə tarixi: 18.06.2020\nEtibarlılıq müddəti: 17.06.2030";
    const res = extractPassportDatesFromText(text);
    assert.equal(res.issueDate, '2020-06-18');
    assert.equal(res.expiryDate, '2030-06-17');
});

test('extracts place of birth with Central Asian and stopWords cleanly', () => {
    const textUz = "O'ZBEKISTON RESPUBLIKASI Tug'ilgan joyi: TOSHKENT Berilgan sanasi: 01.06.2023";
    assert.equal(extractPassportPlaceOfBirth(textUz), 'TOSHKENT');
});


