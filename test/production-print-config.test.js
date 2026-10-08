import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProductionPrintSecrets } from '../scripts/lib/production-print-config.mjs';

const SECRET_BINDINGS = ['PRINTER_SECRET', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY']
    .map((name) => ({ name, type: 'secret_text' }));

test('production print deployment accepts secret metadata without reading values', () => {
    const configuration = { vars: { PRINT_ENABLED: 'false' } };

    assert.doesNotThrow(() => assertProductionPrintSecrets(configuration, SECRET_BINDINGS));
});

test('production print deployment rejects plaintext credentials without disclosing their value', () => {
    const configuration = { vars: { PRINTER_SECRET: 'private-test-value' } };

    assert.throws(() => assertProductionPrintSecrets(configuration, SECRET_BINDINGS), (error) => {
        assert.match(error.message, /PRINTER_SECRET/);
        assert.equal(error.message.includes('private-test-value'), false);
        return true;
    });
});

test('production print deployment rejects missing or plaintext remote secret bindings', () => {
    const bindings = SECRET_BINDINGS.map((binding) => ({ ...binding, type: 'plain_text' }));

    assert.throws(() => assertProductionPrintSecrets({ vars: {} }, bindings), /secret bindings missing/);
});
