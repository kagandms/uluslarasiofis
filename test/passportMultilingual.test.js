import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    extractPassportPlaceOfBirth,
    extractPassportIssuingAuthority,
    extractPassportMetadata
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
