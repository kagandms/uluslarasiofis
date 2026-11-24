import assert from 'node:assert/strict';
import test from 'node:test';
import { transliterateCyrillic, toLatinBirthPlace } from '../src/utils/ykn-latin-translit.js';

test('transliterateCyrillic converts Russian cities per ICAO Doc 9303 table', () => {
    assert.equal(transliterateCyrillic('МОСКВА'), 'MOSKVA');
    assert.equal(transliterateCyrillic('ЩЁЛКОВО'), 'SHCHELKOVO');
    assert.equal(transliterateCyrillic('САНКТ-ПЕТЕРБУРГ'), 'SANKT-PETERBURG');
    assert.equal(transliterateCyrillic('ЧЕЛЯБИНСК'), 'CHELIABINSK');
    assert.equal(transliterateCyrillic('ЮЖНО-САХАЛИНСК'), 'IUZHNO-SAKHALINSK');
    assert.equal(transliterateCyrillic('москва'), 'MOSKVA');
});

test('transliterateCyrillic covers full Russian alphabet including signs and digraphs', () => {
    assert.equal(transliterateCyrillic('ТВЕРЬ'), 'TVER');
    assert.equal(transliterateCyrillic('ОБЪЯВЛЕНИЕ'), 'OBIEIAVLENIE');
    assert.equal(transliterateCyrillic('ЙОШКАР-ОЛА'), 'IOSHKAR-OLA');
    assert.equal(transliterateCyrillic('ЖИТОМИР'), 'ZHITOMIR');
    assert.equal(transliterateCyrillic('ХАБАРОВСК'), 'KHABAROVSK');
    assert.equal(transliterateCyrillic('ЦАРИЦЫН'), 'TSARITSYN');
    assert.equal(transliterateCyrillic('ШАХТЫ'), 'SHAKHTY');
    assert.equal(transliterateCyrillic('ЭЛИСТА'), 'ELISTA');
});

test('transliterateCyrillic handles Ukrainian, Belarusian, Kazakh and Tajik extra letters', () => {
    assert.equal(transliterateCyrillic('КИЇВ'), 'KIIV');
    assert.equal(transliterateCyrillic('ЄВПАТОРІЯ'), 'IEVPATORIIA');
    assert.equal(transliterateCyrillic('ҐУЛЯЙПОЛЕ'), 'GULIAIPOLE');
    assert.equal(transliterateCyrillic('МАГІЛЁЎ'), 'MAGILEU');
    assert.equal(transliterateCyrillic('ҚАРАҒАНДЫ'), 'KARAGANDY');
    assert.equal(transliterateCyrillic('ӨСКЕМЕН'), 'OSKEMEN');
    assert.equal(transliterateCyrillic('ӘУЛИЕАТА'), 'AULIEATA');
    assert.equal(transliterateCyrillic('ҢҮҰҺ'), 'NUUH');
    assert.equal(transliterateCyrillic('ХУҶАНД'), 'KHUJAND');
    assert.equal(transliterateCyrillic('ҚӮРҒОНТЕППА'), 'KURGONTEPPA');
    assert.equal(transliterateCyrillic('ҲИСОР'), 'HISOR');
    assert.equal(transliterateCyrillic('АЛӢ'), 'ALI');
});

test('transliterateCyrillic handles mixed Latin+Cyrillic and keeps digits, spaces, hyphens, commas, dots', () => {
    assert.equal(transliterateCyrillic('ROSTOV-НА-ДОНУ'), 'ROSTOV-NA-DONU');
    assert.equal(transliterateCyrillic('г. Москва, д. 12-Б'), 'G. MOSKVA, D. 12-B');
    assert.equal(transliterateCyrillic('АЛМАТЫ-1'), 'ALMATY-1');
});

test('toLatinBirthPlace transliterates Cyrillic and returns needsManual false', () => {
    assert.deepEqual(toLatinBirthPlace('МОСКВА'), { value: 'MOSKVA', needsManual: false });
    assert.deepEqual(toLatinBirthPlace('Южно-Сахалинск'), { value: 'IUZHNO-SAKHALINSK', needsManual: false });
});

test('toLatinBirthPlace never guesses Arabic-script birth places and sets needsManual true when no Latin remains', () => {
    assert.deepEqual(toLatinBirthPlace('كابل'), { value: '', needsManual: true });
    assert.deepEqual(toLatinBirthPlace('کابل'), { value: '', needsManual: true });
    assert.deepEqual(toLatinBirthPlace('شبرغان'), { value: '', needsManual: true });
    assert.deepEqual(toLatinBirthPlace('لاہور'), { value: '', needsManual: true });
    assert.deepEqual(toLatinBirthPlace('ﻛﺎﺑﻞ'), { value: '', needsManual: true });
    assert.deepEqual(toLatinBirthPlace('ݐ'), { value: '', needsManual: true });
    assert.deepEqual(toLatinBirthPlace('کابل 123'), { value: '', needsManual: true });
});

test('toLatinBirthPlace extracts Latin tokens from bilingual Arabic+Latin fields', () => {
    assert.deepEqual(toLatinBirthPlace('كابل KABUL'), { value: 'KABUL', needsManual: false });
    assert.deepEqual(toLatinBirthPlace('کابل / KABUL'), { value: 'KABUL', needsManual: false });
    assert.deepEqual(toLatinBirthPlace('MAZAR-I-SHARIF / مزار شریف'), { value: 'MAZAR-I-SHARIF', needsManual: false });
});

test('toLatinBirthPlace upper-cases and trims pure Latin text and handles empty input', () => {
    assert.deepEqual(toLatinBirthPlace('  ashgabat  '), { value: 'ASHGABAT', needsManual: false });
    assert.deepEqual(toLatinBirthPlace('İSTANBUL'), { value: 'İSTANBUL', needsManual: false });
    assert.deepEqual(toLatinBirthPlace(''), { value: '', needsManual: false });
    assert.deepEqual(toLatinBirthPlace('   '), { value: '', needsManual: false });
    assert.deepEqual(toLatinBirthPlace(null), { value: '', needsManual: false });
});
