import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contentSource = await readFile(new URL('../ykn_eklenti-main/content.js', import.meta.url), 'utf8');

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
