import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    extractPassportPlaceOfBirth,
    extractPassportIssuingAuthority,
    extractPassportMetadata,
    extractPassportGender,
    extractPassportDatesFromText,
    extractPassportDatesFromText as extractPassportDates,
    parseDateValue
} from '../src/utils/ykn-document-parser.js';

// Evaluate extension parser in global scope
const extCode = readFileSync(new URL('../ykn_eklenti/document-parser.js', import.meta.url), 'utf8');
const runExt = new Function(extCode);
runExt();
const extParser = globalThis.YknDocumentParser;

test('Russian bilingual passport place of birth and authority extraction', () => {
    const text = `РОССИЙСКАЯ ФЕДЕРАЦИЯ / RUSSIAN FEDERATION
МЕСТО РОЖДЕНИЯ / PLACE OF BIRTH
Г. МОСКВА / MOSCOW
ОРГАН ВЫДАЧИ / ISSUING AUTHORITY: МВД 77001 / MIA 77001
ДАТА ВЫДАЧИ / DATE OF ISSUE: 12.05.2021
СРОК ДЕЙСТВИЯ / DATE OF EXPIRY: 12.05.2031`;

    const pob = extractPassportPlaceOfBirth(text);
    const auth = extractPassportIssuingAuthority(text);
    assert.equal(pob, 'MOSCOW');
    assert.equal(auth, 'MIA 77001');

    const extPob = extParser.extractPassportPlaceOfBirth(text);
    const extAuth = extParser.extractPassportIssuingAuthority(text);
    assert.equal(extPob, 'MOSCOW');
    assert.equal(extAuth, 'MIA 77001');
});

test('Arabic bilingual passport place of birth and authority extraction', () => {
    const text = `جمهورية مصر العربية / ARAB REPUBLIC OF EGYPT
مكان الميلاد / Place of birth: القاهرة / CAIRO
جهة الإصدار / Authority: مصلحة الجوازات / IMMIGRATION AND PASSPORTS
تاريخ الإصدار / Date of issue: 10/02/2019
تاريخ الانتهاء / Date of expiry: 09/02/2026`;

    const pob = extractPassportPlaceOfBirth(text);
    const auth = extractPassportIssuingAuthority(text);
    assert.equal(pob, 'CAIRO');
    assert.equal(auth, 'IMMIGRATION AND PASSPORTS');

    const extPob = extParser.extractPassportPlaceOfBirth(text);
    const extAuth = extParser.extractPassportIssuingAuthority(text);
    assert.equal(extPob, 'CAIRO');
    assert.equal(extAuth, 'IMMIGRATION AND PASSPORTS');
});

test('Arabic passport with multiline labels and values', () => {
    const text = `الجمهورية العربية السورية
مكان الميلاد
DAMASCUS
جهة الإصدار
دمشق
تاريخ الصدور: 15/06/2020`;

    const pob = extractPassportPlaceOfBirth(text);
    const auth = extractPassportIssuingAuthority(text);
    assert.equal(pob, 'DAMASCUS');
    assert.equal(auth, 'دمشق');

    const extPob = extParser.extractPassportPlaceOfBirth(text);
    const extAuth = extParser.extractPassportIssuingAuthority(text);
    assert.equal(extPob, 'DAMASCUS');
    assert.equal(extAuth, 'دمشق');
});

test('Arabic passport with combined date and place of birth', () => {
    const text = `جمهورية السودان
مكان وتاريخ الميلاد: KHARTOUM 12/05/2001
المهنة: طالب`;

    assert.equal(extractPassportPlaceOfBirth(text), 'KHARTOUM');
    assert.equal(extParser.extractPassportPlaceOfBirth(text), 'KHARTOUM');
});

test('Central Asian Cyrillic/bilingual formats (Kazakh, Kyrgyz, Uzbek, Tajik)', () => {
    const kazakh = `ҚАЗАҚСТАН РЕСПУБЛИКАСЫ / REPUBLIC OF KAZAKHSTAN
ТУҒАН ЖЕРІ / PLACE OF BIRTH: АЛМАТЫ / ALMATY
БЕРГЕН ОРГАН / ISSUING AUTHORITY: ІІМ / MIA
БЕРІЛГЕН КҮНІ: 01.06.2020`;

    assert.equal(extractPassportPlaceOfBirth(kazakh), 'ALMATY');
    assert.equal(extractPassportIssuingAuthority(kazakh), 'MIA');
    assert.equal(extParser.extractPassportPlaceOfBirth(kazakh), 'ALMATY');
    assert.equal(extParser.extractPassportIssuingAuthority(kazakh), 'MIA');

    const uzbek = `OZBEKISTON RESPUBLIKASI / REPUBLIC OF UZBEKISTAN
TUG'ILGAN JOYI / PLACE OF BIRTH: TOSHKENT
KIM TOMONIDAN BERILGAN / ISSUED BY: IIB TOSHKENT SH
BERILGAN SANASI: 2021-04-10`;

    assert.equal(extractPassportPlaceOfBirth(uzbek), 'TOSHKENT');
    assert.equal(extractPassportIssuingAuthority(uzbek), 'IIB TOSHKENT SH');
    assert.equal(extParser.extractPassportPlaceOfBirth(uzbek), 'TOSHKENT');
    assert.equal(extParser.extractPassportIssuingAuthority(uzbek), 'IIB TOSHKENT SH');

    const tajik = `ҶУМҲУРИИ ТОҶИКИСТОН / REPUBLIC OF TAJIKISTAN
ҶОИ ТАВАЛЛУД / PLACE OF BIRTH: ДУШАНБЕ / DUSHANBE
МАҚОМИ ВАСИҚАДИҲАНДА / AUTHORITY: ВКД / MIA`;

    assert.equal(extractPassportPlaceOfBirth(tajik), 'DUSHANBE');
    assert.equal(extParser.extractPassportPlaceOfBirth(tajik), 'DUSHANBE');
});

test('Russian passport with abbreviation and city prefix', () => {
    const text = `РОССИЯ
МЕСТО РОЖД.: ГОР. КАЗАНЬ
КЕМ ВЫДАН: МВД РОССИИ`;

    assert.equal(extractPassportPlaceOfBirth(text), 'КАЗАНЬ');
    assert.equal(extractPassportIssuingAuthority(text), 'МВД РОССИИ');
    assert.equal(extParser.extractPassportPlaceOfBirth(text), 'КАЗАНЬ');
    assert.equal(extParser.extractPassportIssuingAuthority(text), 'МВД РОССИИ');
});

test('French bilingual formats', () => {
    const text = `REPUBLIQUE DU SENEGAL
LIEU DE NAISSANCE / PLACE OF BIRTH: DAKAR - SENEGAL
AUTORITE / AUTHORITY: DIRECTION GENERALE DE LA POLICE`;

    assert.equal(extractPassportPlaceOfBirth(text), 'DAKAR - SENEGAL');
    assert.equal(extractPassportIssuingAuthority(text), 'DIRECTION GENERALE DE LA POLICE');
    assert.equal(extParser.extractPassportPlaceOfBirth(text), 'DAKAR - SENEGAL');
    assert.equal(extParser.extractPassportIssuingAuthority(text), 'DIRECTION GENERALE DE LA POLICE');
});

test('Turkmenistan passport always overrides to TKM for YOKSIS', () => {
    const text = `P<TKM1234567<<<<<<<<<<<<<<<<<<
DOGLAN YERI: ASHGABAT`;

    assert.equal(extractPassportPlaceOfBirth(text), 'TKM');
    assert.equal(extParser.extractPassportPlaceOfBirth(text), 'TKM');
});

test('Chained bilingual labels never capture secondary label as city value', () => {
    const text = `PLACE OF BIRTH / LIEU DE NAISSANCE
مكان الميلاد
ALEXANDRIA
DATE OF ISSUE / DATE DE DELIVRANCE: 01.01.2022`;

    assert.equal(extractPassportPlaceOfBirth(text), 'ALEXANDRIA');
    assert.equal(extParser.extractPassportPlaceOfBirth(text), 'ALEXANDRIA');
});

test('Date parsing: Eastern Arabic digits convert and parse correctly', () => {
    assert.equal(parseDateValue('١٥/٠٦/٢٠٢٠'), '2020-06-15');
    assert.equal(parseDateValue('٠١.٠٥.٢٠٢٢'), '2022-05-01');
    assert.equal(parseDateValue('٢٠٢١-١١-٢٥'), '2021-11-25');
    assert.equal(extParser.parseDateValue('١٥/٠٦/٢٠٢٠'), '2020-06-15');
    assert.equal(extParser.parseDateValue('٠١.٠٥.٢٠٢٢'), '2022-05-01');

    const docText = `تاريخ الإصدار: ١٥/٠٦/٢٠٢٠
تاريخ الانتهاء: ١٤/٠٦/٢٠٣٠`;
    const dates = extractPassportDatesFromText(docText);
    assert.equal(dates.issueDate, '2020-06-15');
    assert.equal(dates.expiryDate, '2030-06-14');

    const extDates = extParser.extractPassportDates(docText);
    assert.equal(extDates.issueDate, '2020-06-15');
    assert.equal(extDates.expiryDate, '2030-06-14');
});

test('Date parsing: Roman numeral months in Eastern European and CIS passports', () => {
    assert.equal(parseDateValue('12.VII.2021'), '2021-07-12');
    assert.equal(parseDateValue('15/X/2023'), '2023-10-15');
    assert.equal(parseDateValue('01 - IV - 2025'), '2025-04-01');
    assert.equal(extParser.parseDateValue('12.VII.2021'), '2021-07-12');
    assert.equal(extParser.parseDateValue('15/X/2023'), '2023-10-15');
});

test('Date parsing: Russian full month names (nominative and genitive)', () => {
    assert.equal(parseDateValue('12 мая 2021'), '2021-05-12');
    assert.equal(parseDateValue('15 января 2022'), '2022-01-15');
    assert.equal(parseDateValue('20 октября 2024'), '2024-10-20');
    assert.equal(extParser.parseDateValue('12 мая 2021'), '2021-05-12');
    assert.equal(extParser.parseDateValue('15 января 2022'), '2022-01-15');
});

test('Date parsing: Arabic month names', () => {
    assert.equal(parseDateValue('12 مايو 2021'), '2021-05-12');
    assert.equal(parseDateValue('15 تموز 2023'), '2023-07-15');
    assert.equal(extParser.parseDateValue('12 مايو 2021'), '2021-05-12');
    assert.equal(extParser.parseDateValue('15 تموز 2023'), '2023-07-15');
});

test('Passport gender extraction across MRZ and text labels', () => {
    // 1. TD3 MRZ Female
    const mrzFemale = `P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
L898902C36UTO7408122F1204159ZE184226B<<<<<10`;
    assert.equal(extractPassportGender(mrzFemale), 'Kadın');
    assert.equal(extParser.extractPassportGender(mrzFemale), 'Kadın');

    // 2. TD3 MRZ Male
    const mrzMale = `P<UTOERIKSSON<<CARL<JOHAN<<<<<<<<<<<<<<<<<<<
L898902C36UTO7408122M1204159ZE184226B<<<<<10`;
    assert.equal(extractPassportGender(mrzMale), 'Erkek');
    assert.equal(extParser.extractPassportGender(mrzMale), 'Erkek');

    // 3. Russian text label
    const ruMale = `ПАСПОРТ РОССИЯ
ПОЛ / SEX: М / M
МЕСТО РОЖДЕНИЯ: МОСКВА`;
    assert.equal(extractPassportGender(ruMale), 'Erkek');
    assert.equal(extParser.extractPassportGender(ruMale), 'Erkek');

    const ruFemale = `ПАСПОРТ РОССИЯ
ПОЛ: ЖЕН.
МЕСТО РОЖДЕНИЯ: САМАРА`;
    assert.equal(extractPassportGender(ruFemale), 'Kadın');
    assert.equal(extParser.extractPassportGender(ruFemale), 'Kadın');

    // 4. Arabic text label
    const arMale = `جواز سفر
الجنس: ذكر
مكان الميلاد: القاهرة`;
    assert.equal(extractPassportGender(arMale), 'Erkek');
    assert.equal(extParser.extractPassportGender(arMale), 'Erkek');

    const arFemale = `جواز سفر
الجنس: أنثى
مكان الميلاد: دمشق`;
    assert.equal(extractPassportGender(arFemale), 'Kadın');
    assert.equal(extParser.extractPassportGender(arFemale), 'Kadın');

    // 5. French text label
    const frFemale = `PASSEPORT
SEXE / SEX: F
LIEU DE NAISSANCE: PARIS`;
    assert.equal(extractPassportGender(frFemale), 'Kadın');
    assert.equal(extParser.extractPassportGender(frFemale), 'Kadın');

    // 6. Turkish text label
    const trMale = `TÜRKİYE CUMHURİYETİ
CİNSİYETİ / SEX: ERKEK / M`;
    assert.equal(extractPassportGender(trMale), 'Erkek');
    assert.equal(extParser.extractPassportGender(trMale), 'Erkek');
});

test('Administrative prefix stripping in place of birth and authority', () => {
    const arabicGov = `مكان الميلاد: محافظة الإسكندرية`;
    assert.equal(extractPassportPlaceOfBirth(arabicGov), 'الإسكندرية');
    assert.equal(extParser.extractPassportPlaceOfBirth(arabicGov), 'الإسكندرية');

    const ruCity = `МЕСТО РОЖДЕНИЯ: ГОРОД САМАРА`;
    assert.equal(extractPassportPlaceOfBirth(ruCity), 'САМАРА');
    assert.equal(extParser.extractPassportPlaceOfBirth(ruCity), 'САМАРА');

    const frCity = `LIEU DE NAISSANCE: VILLE DE LYON`;
    assert.equal(extractPassportPlaceOfBirth(frCity), 'LYON');
    assert.equal(extParser.extractPassportPlaceOfBirth(frCity), 'LYON');
});

test('Complete passport metadata extraction with gender and authority', () => {
    const text = `PASSPORT / PASSEPORT
SURNAME: DOE
GIVEN NAMES: JANE
SEX: F
PLACE OF BIRTH: CHICAGO
ISSUING AUTHORITY: US DEPARTMENT OF STATE
DATE OF ISSUE: 15 JAN 2021
DATE OF EXPIRY: 14 JAN 2031`;

    const meta = extractPassportMetadata(text);
    assert.equal(meta.cinsiyet, 'Kadın');
    assert.equal(meta.placeOfBirth, 'CHICAGO');
    assert.equal(meta.issuingAuthority, 'US DEPARTMENT OF STATE');
    assert.equal(meta.issueDate, '2021-01-15');
    assert.equal(meta.expiryDate, '2031-01-14');

    const extMeta = extParser.extractPassportMetadata(text);
    assert.equal(extMeta.cinsiyet, 'Kadın');
    assert.equal(extMeta.placeOfBirth, 'CHICAGO');
    assert.equal(extMeta.issuingAuthority, 'US DEPARTMENT OF STATE');
    assert.equal(extMeta.issueDate, '2021-01-15');
    assert.equal(extMeta.expiryDate, '2031-01-14');
});

test('Multi-line and bilingual authority extraction with RTL and fallback support', () => {
    // 1. Multi-line Authority (e.g. US Department of State across lines)
    const usMulti = `PASSPORT / PASSEPORT
ISSUING AUTHORITY / AUTORITE
UNITED STATES
DEPARTMENT OF STATE
DATE OF ISSUE / DATE DE DELIVRANCE
01 JAN 2020`;
    assert.equal(extractPassportIssuingAuthority(usMulti), 'UNITED STATES DEPARTMENT OF STATE');
    assert.equal(extParser.extractPassportIssuingAuthority(usMulti), 'UNITED STATES DEPARTMENT OF STATE');

    // 2. Multi-line bilingual across lines: prefer Latin for YOKSIS
    const ruMulti = `ОРГАН ВЫДАЧИ / ISSUING AUTHORITY
МВД РОССИИ
MIA OF RUSSIA
ДАТА ВЫДАЧИ / DATE OF ISSUE
12.05.2021`;
    assert.equal(extractPassportIssuingAuthority(ruMulti), 'MIA OF RUSSIA');
    assert.equal(extParser.extractPassportIssuingAuthority(ruMulti), 'MIA OF RUSSIA');

    // 3. Arabic RTL layout where authority precedes label on same line
    const arRtl = `دمشق جهة الإصدار
15/06/2020 تاريخ الإصدار`;
    assert.equal(extractPassportIssuingAuthority(arRtl), 'دمشق');
    assert.equal(extParser.extractPassportIssuingAuthority(arRtl), 'دمشق');

    // 4. Known authority signature fallback when label is missing
    const smudged = `PASSPORT
MINISTERE DE L'INTERIEUR
DIRECTION GENERALE DE LA POLICE
P<FRA123456789`;
    assert.equal(extractPassportIssuingAuthority(smudged), 'MINISTERE DE L\'INTERIEUR');
    assert.equal(extParser.extractPassportIssuingAuthority(smudged), 'MINISTERE DE L\'INTERIEUR');

    // 5. MRZ with OCR artifacts fallback
    const mrzNoise = `DOCUMENT DE VOYAGE
P«TUR123456789`;
    assert.equal(extractPassportIssuingAuthority(mrzNoise), 'TUR');
    assert.equal(extParser.extractPassportIssuingAuthority(mrzNoise), 'TUR');
});

test('Date parsing: US MM/DD/YYYY auto-detection when day > 12', () => {
    assert.equal(parseDateValue('05/22/2018'), '2018-05-22');
    assert.equal(parseDateValue('11/25/2023'), '2023-11-25');
    assert.equal(extParser.parseDateValue('05/22/2018'), '2018-05-22');
    assert.equal(extParser.parseDateValue('11/25/2023'), '2023-11-25');

    const usPassport = `PASSPORT
DATE OF ISSUE: 05/22/2018
DATE OF EXPIRY: 05/21/2028`;
    const res = extractPassportDates(usPassport);
    assert.equal(res.issueDate, '2018-05-22');
    assert.equal(res.expiryDate, '2028-05-21');

    const extRes = extParser.extractPassportDates(usPassport);
    assert.equal(extRes.issueDate, '2018-05-22');
    assert.equal(extRes.expiryDate, '2028-05-21');
});

test('Date parsing: Ordinal suffixes (1st, 2nd, 3rd, 15th, etc.)', () => {
    assert.equal(parseDateValue('15th August 2021'), '2021-08-15');
    assert.equal(parseDateValue('1st January 2022'), '2022-01-01');
    assert.equal(parseDateValue('2nd February 2023'), '2023-02-02');
    assert.equal(parseDateValue('3rd March 2024'), '2024-03-03');
    assert.equal(parseDateValue('August 15th, 2021'), '2021-08-15');
    assert.equal(extParser.parseDateValue('15th August 2021'), '2021-08-15');
    assert.equal(extParser.parseDateValue('1st January 2022'), '2022-01-01');
    assert.equal(extParser.parseDateValue('August 15th, 2021'), '2021-08-15');

    const ordinalPassport = `PASSPORT
DATE OF ISSUE: 15th August 2021
DATE OF EXPIRY: 14th August 2031`;
    const res = extractPassportDates(ordinalPassport);
    assert.equal(res.issueDate, '2021-08-15');
    assert.equal(res.expiryDate, '2031-08-14');

    const extRes = extParser.extractPassportDates(ordinalPassport);
    assert.equal(extRes.issueDate, '2021-08-15');
    assert.equal(extRes.expiryDate, '2031-08-14');
});

test('Date parsing: Bilingual month slashes in Cyrillic and Latin', () => {
    assert.equal(parseDateValue('12 ДЕК / DEC 2021'), '2021-12-12');
    assert.equal(parseDateValue('15 JUL / JUIL 2023'), '2023-07-15');
    assert.equal(parseDateValue('20 MAY-MAI 2022'), '2022-05-20');
    assert.equal(extParser.parseDateValue('12 ДЕК / DEC 2021'), '2021-12-12');
    assert.equal(extParser.parseDateValue('15 JUL / JUIL 2023'), '2023-07-15');

    const bilingualPassport = `ПАСПОРТ / PASSPORT
ДАТА ВЫДАЧИ / DATE OF ISSUE: 12 ДЕК / DEC 2021
СРОК ДЕЙСТВИЯ / DATE OF EXPIRY: 11 ДЕК / DEC 2031`;
    const res = extractPassportDates(bilingualPassport);
    assert.equal(res.issueDate, '2021-12-12');
    assert.equal(res.expiryDate, '2031-12-11');

    const extRes = extParser.extractPassportDates(bilingualPassport);
    assert.equal(extRes.issueDate, '2021-12-12');
    assert.equal(extRes.expiryDate, '2031-12-11');
});

test('Date parsing: OCR confusion characters (O/0, l/1, Z/2, S/5, B/8)', () => {
    assert.equal(parseDateValue('l5.O8.2O2O'), '2020-08-15');
    assert.equal(parseDateValue('Z0.05.2021'), '2021-05-20');
    assert.equal(extParser.parseDateValue('l5.O8.2O2O'), '2020-08-15');
    assert.equal(extParser.parseDateValue('Z0.05.2021'), '2021-05-20');

    const ocrConfusedPassport = `PASAPORT
DÜZENLEME TARİHİ: l5.O8.2O2O
GEÇERLİLİK TARİHİ: 14.O8.2O3O`;
    const res = extractPassportDates(ocrConfusedPassport);
    assert.equal(res.issueDate, '2020-08-15');
    assert.equal(res.expiryDate, '2030-08-14');

    const extRes = extParser.extractPassportDates(ocrConfusedPassport);
    assert.equal(extRes.issueDate, '2020-08-15');
    assert.equal(extRes.expiryDate, '2030-08-14');
});

test('Date parsing: Compact month formats without spaces', () => {
    assert.equal(parseDateValue('11MAR2021'), '2021-03-11');
    assert.equal(parseDateValue('10MAR31'), '2031-03-10');
    assert.equal(parseDateValue('15МАЙ2022'), '2022-05-15');
    assert.equal(extParser.parseDateValue('11MAR2021'), '2021-03-11');
    assert.equal(extParser.parseDateValue('10MAR31'), '2031-03-10');
    assert.equal(extParser.parseDateValue('15МАЙ2022'), '2022-05-15');

    const compactPassport = `PASSPORT
DATE OF ISSUE: 11MAR2021
DATE OF EXPIRY: 10MAR2031`;
    const res = extractPassportDates(compactPassport);
    assert.equal(res.issueDate, '2021-03-11');
    assert.equal(res.expiryDate, '2031-03-10');

    const extRes = extParser.extractPassportDates(compactPassport);
    assert.equal(extRes.issueDate, '2021-03-11');
    assert.equal(extRes.expiryDate, '2031-03-10');
});

test('Date parsing: Swapped dates recovery when issue > expiry', () => {
    const swappedPassport = `PASSPORT
DATE OF ISSUE: 14 JAN 2031
DATE OF EXPIRY: 15 JAN 2021`;
    const res = extractPassportDates(swappedPassport);
    assert.equal(res.issueDate, '2021-01-15');
    assert.equal(res.expiryDate, '2031-01-14');

    const extRes = extParser.extractPassportDates(swappedPassport);
    assert.equal(extRes.issueDate, '2021-01-15');
    assert.equal(extRes.expiryDate, '2031-01-14');
});

test('Date parsing: Portuguese, Spanish, Italian, and Central Asian month names', () => {
    assert.equal(parseDateValue('20 de outubro 2022'), '2022-10-20');
    assert.equal(parseDateValue('15 de febrero 2021'), '2021-02-15');
    assert.equal(parseDateValue('10 maggio 2023'), '2023-05-10');
    assert.equal(parseDateValue('18 avgust 2022'), '2022-08-18');
    assert.equal(parseDateValue('25 қазан 2023'), '2023-10-25');
    assert.equal(parseDateValue('12 ýanwar 2022'), '2022-01-12');

    assert.equal(extParser.parseDateValue('20 de outubro 2022'), '2022-10-20');
    assert.equal(extParser.parseDateValue('15 de febrero 2021'), '2021-02-15');
    assert.equal(extParser.parseDateValue('10 maggio 2023'), '2023-05-10');
    assert.equal(extParser.parseDateValue('18 avgust 2022'), '2022-08-18');
    assert.equal(extParser.parseDateValue('25 қазан 2023'), '2023-10-25');
    assert.equal(extParser.parseDateValue('12 ýanwar 2022'), '2022-01-12');
});

test('Pakistani passport place of birth and authority extraction', () => {
    const pakPass1 = `GOVERNMENT OF PAKISTAN
PASSPORT
Place of Birth: RAWALPINDI, PAKISTAN
Issuing Authority: DGIP
Date of Issue: 15/08/2020
Date of Expiry: 14/08/2030`;

    assert.equal(extractPassportPlaceOfBirth(pakPass1), 'RAWALPINDI');
    assert.equal(extractPassportIssuingAuthority(pakPass1), 'DGIP');
    assert.equal(extParser.extractPassportPlaceOfBirth(pakPass1), 'RAWALPINDI');
    assert.equal(extParser.extractPassportIssuingAuthority(pakPass1), 'DGIP');

    const pakPass2 = `ISLAMIC REPUBLIC OF PAKISTAN
Country of Birth / Place of Birth: PAKISTAN / LAHORE
Authority: REGIONAL PASSPORT OFFICE LAHORE
Date of Issue: 10 JAN 2021
Date of Expiry: 09 JAN 2031`;

    assert.equal(extractPassportPlaceOfBirth(pakPass2), 'LAHORE');
    assert.equal(extractPassportIssuingAuthority(pakPass2), 'REGIONAL PASSPORT OFFICE LAHORE');
    assert.equal(extParser.extractPassportPlaceOfBirth(pakPass2), 'LAHORE');
    assert.equal(extParser.extractPassportIssuingAuthority(pakPass2), 'REGIONAL PASSPORT OFFICE LAHORE');

    const pakPass3 = `PAKISTAN PASSPORT
Place of Birth: KARACHI
Issuing Authority: IM&P`;

    assert.equal(extractPassportPlaceOfBirth(pakPass3), 'KARACHI');
    assert.equal(extractPassportIssuingAuthority(pakPass3), 'IM&P');
    assert.equal(extParser.extractPassportPlaceOfBirth(pakPass3), 'KARACHI');
    assert.equal(extParser.extractPassportIssuingAuthority(pakPass3), 'IM&P');

    // Pakistani authority and birth place fallbacks
    const fallbackAuth = extractPassportIssuingAuthority('', { uyruk: 'PAKISTAN' });
    assert.equal(fallbackAuth, 'DGIP');
    const extFallbackAuth = extParser.extractPassportIssuingAuthority('', { uyruk: 'PAKISTAN' });
    assert.equal(extFallbackAuth, 'DGIP');

    const fallbackPob = extractPassportPlaceOfBirth('PAKISTAN PASSPORT HOLDER BORN IN ISLAMABAD', { uyruk: 'PAKISTAN' });
    assert.equal(fallbackPob, 'ISLAMABAD');
});

test('Afghan passport place of birth and authority extraction (Dari, Pashto, English)', () => {
    const afgPass1 = `ISLAMIC REPUBLIC OF AFGHANISTAN
د زیږیدنې ځای / محل تولد / Place of Birth: KABUL
مرجع صدور / د صادرولو مرجع / Issuing Authority: PASSPORT DEPARTMENT
Date of Issue: 01/01/2022
Date of Expiry: 31/12/2026`;

    assert.equal(extractPassportPlaceOfBirth(afgPass1), 'KABUL');
    assert.equal(extractPassportIssuingAuthority(afgPass1), 'PASSPORT DEPARTMENT');
    assert.equal(extParser.extractPassportPlaceOfBirth(afgPass1), 'KABUL');
    assert.equal(extParser.extractPassportIssuingAuthority(afgPass1), 'PASSPORT DEPARTMENT');

    // RTL Dari / Pashto with city before label
    const afgPassRtl = `د افغانستان اسلامي جمهوریت
کابل د زیږیدنې ځای
د پاسپورت ریاست`;

    assert.equal(extractPassportPlaceOfBirth(afgPassRtl), 'KABUL');
    assert.equal(extractPassportIssuingAuthority(afgPassRtl), 'PASSPORT DEPARTMENT');
    assert.equal(extParser.extractPassportPlaceOfBirth(afgPassRtl), 'KABUL');
    assert.equal(extParser.extractPassportIssuingAuthority(afgPassRtl), 'PASSPORT DEPARTMENT');

    // Afghan city mapped from Dari
    const afgPassHerat = `محل تولد: هرات
مرجع صدور: وزارت امور داخله`;

    assert.equal(extractPassportPlaceOfBirth(afgPassHerat), 'HERAT');
    assert.equal(extractPassportIssuingAuthority(afgPassHerat), 'MINISTRY OF INTERIOR');
    assert.equal(extParser.extractPassportPlaceOfBirth(afgPassHerat), 'HERAT');
    assert.equal(extParser.extractPassportIssuingAuthority(afgPassHerat), 'MINISTRY OF INTERIOR');

    // Fallback Afghan authority
    assert.equal(extractPassportIssuingAuthority('', { nationality: 'AFGHANISTAN' }), 'PASSPORT DEPARTMENT');
    assert.equal(extParser.extractPassportIssuingAuthority('', { nationality: 'AFGHANISTAN' }), 'PASSPORT DEPARTMENT');
});

test('Russian and CIS passport place of birth and authority optimizations', () => {
    // Biometric passport with USSR country code: should extract SAMARA, not USSR
    const rusPass1 = `РОССИЙСКАЯ ФЕДЕРАЦИЯ / RUSSIAN FEDERATION
МЕСТО РОЖДЕНИЯ / PLACE OF BIRTH
Г. САМАРА / USSR
ОРГАН ВЫДАЧИ / ISSUING AUTHORITY: УФМС 50001`;

    assert.equal(extractPassportPlaceOfBirth(rusPass1), 'САМАРА');
    assert.equal(extractPassportIssuingAuthority(rusPass1), 'УФМС 50001');
    assert.equal(extParser.extractPassportPlaceOfBirth(rusPass1), 'САМАРА');
    assert.equal(extParser.extractPassportIssuingAuthority(rusPass1), 'УФМС 50001');

    // Biometric passport with RUSSIA country code: should extract МОСКВА, not RUSSIA
    const rusPass2 = `РОССИЙСКАЯ ФЕДЕРАЦИЯ
МЕСТО РОЖДЕНИЯ / PLACE OF BIRTH: Г. МОСКВА / RUSSIA
ОРГАН ВЫДАЧИ: ГУВМ МВД РОССИИ`;

    assert.equal(extractPassportPlaceOfBirth(rusPass2), 'МОСКВА');
    assert.equal(extractPassportIssuingAuthority(rusPass2), 'ГУВМ МВД РОССИИ');
    assert.equal(extParser.extractPassportPlaceOfBirth(rusPass2), 'МОСКВА');
    assert.equal(extParser.extractPassportIssuingAuthority(rusPass2), 'ГУВМ МВД РОССИИ');

    // Cyrillic administrative prefix stripped
    const rusPass3 = `МЕСТО РОЖДЕНИЯ: ГОР. КАЗАНЬ
ОРГАН ВЫДАЧИ: МВД 77001 / MIA 77001`;

    assert.equal(extractPassportPlaceOfBirth(rusPass3), 'КАЗАНЬ');
    assert.equal(extractPassportIssuingAuthority(rusPass3), 'MIA 77001');
    assert.equal(extParser.extractPassportPlaceOfBirth(rusPass3), 'КАЗАНЬ');
    assert.equal(extParser.extractPassportIssuingAuthority(rusPass3), 'MIA 77001');

    // Fallback Russian authority
    assert.equal(extractPassportIssuingAuthority('', { uyruk: 'RUSYA' }), 'MIA OF RUSSIA');
    assert.equal(extParser.extractPassportIssuingAuthority('', { uyruk: 'RUSYA' }), 'MIA OF RUSSIA');
});


