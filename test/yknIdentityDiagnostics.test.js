import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const identitySource = await readFile(new URL('../ykn_eklenti-main/yoksis-student-identity.js', import.meta.url), 'utf8');
const fieldTargetsSource = await readFile(new URL('../ykn_eklenti-main/yoksis-field-targets.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../ykn_eklenti-main/content.js', import.meta.url), 'utf8');

function createDiagnosticsHarness(html = '') {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
        url: 'https://yoksis.yok.gov.tr/',
        runScripts: 'outside-only'
    });
    dom.window.eval(identitySource);
    dom.window.eval(fieldTargetsSource);
    const patchedContent = contentSource.replace(
        /\}\)\(\);\s*$/,
        'window.__yknDiagTest = { buildIdentityDiagnostics, classifyDateShape, describeCurrentBirthDateSource };\n})();'
    );
    dom.window.eval(patchedContent);
    return {
        dom,
        ...dom.window.__yknDiagTest
    };
}

test('content.js readiness warning includes identity diagnostics only on semanticMatch === false', () => {
    assert.match(contentSource, /function buildIdentityMatchOptions\(expectedStudent\)/);
    assert.match(contentSource, /function buildExpectedKeysPresent\(expectedStudent\)/);
    assert.match(contentSource, /function buildIdentityDiagnostics\(expectedStudent\)/);
    assert.match(contentSource, /window\.YknStudentIdentity\.explain\(matchOptions\)/);
    assert.match(
        contentSource,
        /if \(signals\.semanticMatch === false\) \{\s*readinessPayload\.identity = buildIdentityDiagnostics\(expectedStudent\);\s*\}/
    );
    assert.match(
        contentSource,
        /console\.warn\('\[YKN_FORM_READINESS\] Öğrenci formu doğrulanamadı\.', JSON\.stringify\(readinessPayload\)\);/
    );
});

test('content.js expectedKeysPresent tracks the expected student keys as booleans', () => {
    for (const key of ['passportNo', 'studentName', 'studentSurname', 'birthDate', 'dogumTarihi']) {
        assert.match(contentSource, new RegExp(`${key}:\\s*hasValue\\(src\\.${key}\\)`));
    }
});

test('classifyDateShape classifies each supported date format without leaking digits', () => {
    const { dom, classifyDateShape } = createDiagnosticsHarness();
    try {
        assert.equal(classifyDateShape('2000-01-10'), 'YYYY-MM-DD');
        assert.equal(classifyDateShape('10.01.2000'), 'DD.MM.YYYY');
        assert.equal(classifyDateShape('10/01/2000'), 'DD/MM/YYYY');
        assert.equal(classifyDateShape('10-01-2000'), 'DD-MM-YYYY');
        assert.equal(classifyDateShape(''), 'other');
        assert.equal(classifyDateShape('10.1.2000'), 'other');
        assert.equal(classifyDateShape('not-a-date'), 'other');
    } finally {
        dom.window.close();
    }
});

test('describeCurrentBirthDateSource handles single, ambiguous, and none matches in DOM', () => {
    const singleHarness = createDiagnosticsHarness(`
        <table>
            <tr><td>Doğum Tarihi</td><td><input id="dob" type="text" value="10.01.2000"></td></tr>
        </table>
    `);
    try {
        assert.deepEqual(JSON.parse(JSON.stringify(singleHarness.describeCurrentBirthDateSource())), {
            labelMatched: 'Doğum Tarihi',
            candidateCount: 1,
            readFrom: 'single'
        });
    } finally {
        singleHarness.dom.window.close();
    }

    const ambiguousHarness = createDiagnosticsHarness(`
        <table>
            <tr><td>Doğum Tarihi</td><td><input id="dob1" type="text" value="10.01.2000"></td></tr>
            <tr><td>Birth Date</td><td><input id="dob2" type="text" value="01/10/2000"></td></tr>
        </table>
    `);
    try {
        assert.deepEqual(JSON.parse(JSON.stringify(ambiguousHarness.describeCurrentBirthDateSource())), {
            labelMatched: 'Doğum Tarihi',
            candidateCount: 2,
            readFrom: 'ambiguous'
        });
    } finally {
        ambiguousHarness.dom.window.close();
    }

    const noneHarness = createDiagnosticsHarness(`
        <table>
            <tr><td>Adı</td><td><input id="firstName" type="text" value="Ali"></td></tr>
        </table>
    `);
    try {
        assert.deepEqual(JSON.parse(JSON.stringify(noneHarness.describeCurrentBirthDateSource())), {
            labelMatched: '',
            candidateCount: 0,
            readFrom: 'none'
        });
    } finally {
        noneHarness.dom.window.close();
    }
});

test('buildIdentityDiagnostics serializes without leaking digits (>=4) or passport/name values', () => {
    const harness = createDiagnosticsHarness(`
        <table>
            <tr><td>Adı</td><td><input id="ad" type="text" value="DISTINCTIVEFIRSTNAME"></td></tr>
            <tr><td>Soyadı</td><td><input id="soyad" type="text" value="DISTINCTIVELASTNAME"></td></tr>
            <tr><td>Belge No</td><td><input id="belge" type="text" value="YY55443322"></td></tr>
            <tr><td>Doğum Tarihi</td><td><input id="dob" type="text" value="10/01/1987"></td></tr>
        </table>
    `);
    try {
        const diagnostics = harness.buildIdentityDiagnostics({
            passportNo: 'ZZ99887766',
            studentName: 'DISTINCTIVEFIRSTNAME',
            studentSurname: 'DISTINCTIVELASTNAME',
            dogumTarihi: '1987-10-01'
        });

        assert.equal(diagnostics.expectedBirthDateKeyUsed, 'dogumTarihi');
        assert.equal(diagnostics.expectedBirthDateShape, 'YYYY-MM-DD');
        assert.equal(diagnostics.currentBirthDateShape, 'DD/MM/YYYY');
        assert.equal(diagnostics.birthDayMonthSwappedEqual, true);
        assert.equal(diagnostics.birthDateEqual, false);
        assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.currentBirthDateSource)), {
            labelMatched: 'Doğum Tarihi',
            candidateCount: 1,
            readFrom: 'single'
        });

        const serialized = JSON.stringify(diagnostics);
        assert.equal(/\d{4,}/.test(serialized), false, `serialized diagnostics leaked 4+ digits: ${serialized}`);
        for (const secret of ['ZZ99887766', 'YY55443322', 'DISTINCTIVEFIRSTNAME', 'DISTINCTIVELASTNAME', '1987']) {
            assert.equal(serialized.toUpperCase().includes(secret), false, `serialized diagnostics leaked ${secret}`);
        }
    } finally {
        harness.dom.window.close();
    }
});
