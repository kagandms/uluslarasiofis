import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStudentFilename } from '../src/shared/studentFilename.js';

test('createStudentFilename formats standard name and lower-cases uppercase passport number', () => {
    assert.equal(
        createStudentFilename({ firstName: 'Arzuv', lastName: 'Hudaykulova', passportNumber: 'A3578965' }),
        'arzuv_hudaykulova_a3578965.pdf'
    );
});

test('createStudentFilename folds Turkish letters and removes diacritics', () => {
    assert.equal(
        createStudentFilename({ firstName: 'Çağrı Şükrü', lastName: 'İnanç Öğrenci', passportNumber: 'IĞÜŞİÖÇ12' }),
        'cagri_sukru_inanc_ogrenci_igusioc12.pdf'
    );
    assert.equal(
        createStudentFilename({ firstName: 'José', lastName: 'Müller', passportNumber: 'P9' }),
        'jose_muller_p9.pdf'
    );
});

test('createStudentFilename turns spaces inside parts into single underscores with no leading or trailing underscores', () => {
    assert.equal(
        createStudentFilename({ firstName: 'Mary Ann', lastName: 'Van Der Berg', passportNumber: 'AB 123' }),
        'mary_ann_van_der_berg_ab_123.pdf'
    );
    assert.equal(
        createStudentFilename({ firstName: '  Ayşe   Nur  ', lastName: '_Yılmaz_', passportNumber: '  P123  ' }),
        'ayse_nur_yilmaz_p123.pdf'
    );
});

test('createStudentFilename omits missing passport or missing name parts and falls back to basvuru.pdf', () => {
    assert.equal(createStudentFilename({ firstName: 'Ayşe', lastName: 'Yılmaz' }), 'ayse_yilmaz.pdf');
    assert.equal(createStudentFilename({ firstName: 'Ayşe', lastName: 'Yılmaz', passportNumber: '' }), 'ayse_yilmaz.pdf');
    assert.equal(createStudentFilename({ firstName: 'Ayşe', lastName: 'Yılmaz', passportNumber: null }), 'ayse_yilmaz.pdf');
    assert.equal(createStudentFilename({ firstName: 'Ayşe', passportNumber: 'P123' }), 'ayse_p123.pdf');
    assert.equal(createStudentFilename({}), 'basvuru.pdf');
    assert.equal(createStudentFilename(), 'basvuru.pdf');
    assert.equal(createStudentFilename(null), 'basvuru.pdf');
    assert.equal(createStudentFilename({ firstName: '---', lastName: '___', passportNumber: '   ' }), 'basvuru.pdf');
});

test('createStudentFilename neutralizes injection-like characters and supports custom extensions', () => {
    assert.equal(
        createStudentFilename({ firstName: '../x"', lastName: '..\\y\\z', passportNumber: 'a"b\r\n1' }),
        'x_yz_ab_1.pdf'
    );
    assert.equal(
        createStudentFilename({ firstName: 'Ayşe', lastName: 'Yılmaz', passportNumber: 'P1' }, '.ZIP'),
        'ayse_yilmaz_p1.zip'
    );
});
