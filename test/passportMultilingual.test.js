import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    extractPassportPlaceOfBirth,
    extractPassportIssuingAuthority,
    extractPassportMetadata,
    extractPassportGender,
    extractPassportDatesFromText,
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
