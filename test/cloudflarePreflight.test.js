import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionRuntimeSecretMetadata } from '../scripts/ci/runtime-secret-metadata.mjs';

// Independent fixture of the reviewed production names, including the staff analytics token.
const names = [
    'APPS_SCRIPT_API_KEY', 'APPS_SCRIPT_URL', 'AZURE_VISION_ENDPOINT', 'AZURE_VISION_KEY',
    'D1_ANALYTICS_API_TOKEN', 'PRINTER_SECRET', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY',
    'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_SECRET_ACCESS_KEY', 'SCANNER_SECRET', 'STAFF_BOOTSTRAP_TOKEN'
];
const requiredNames = ['PRINTER_SECRET', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY'];
const metadata = order => order.map(name => ({ name, type: 'secret_text' }));

test('production runtime secret metadata accepts the same names in any order, including print sort differences', () => {
    const localePrintOrder = [
        ...names.filter(name => !requiredNames.includes(name)),
        'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY', 'PRINTER_SECRET'
    ];
    for (const order of [names, [...names].sort(), [...names].reverse(), localePrintOrder]) {
        const input = metadata(order);
        const original = structuredClone(input);
        assert.equal(assertProductionRuntimeSecretMetadata(input, requiredNames).length, 13);
        assert.deepEqual(input, original, 'Validation must not mutate metadata supplied by the caller.');
        assert.equal(assertProductionRuntimeSecretMetadata({ secrets: input }, requiredNames).length, 13);
    }
});

test('production runtime secret metadata rejects missing, additional, duplicate and renamed secrets', () => {
    for (const missing of names) {
        assert.throws(() => assertProductionRuntimeSecretMetadata(metadata(names.filter(name => name !== missing)), requiredNames),
            /differs from the reviewed baseline/);
    }
    for (const order of [
        [...names, 'UNREVIEWED_NEW_SECRET'],
        [...names, 'D1_ANALYTICS_API_TOKEN'],
        names.map(name => name === 'D1_ANALYTICS_API_TOKEN' ? 'd1_analytics_api_token' : name)
    ]) {
        assert.throws(() => assertProductionRuntimeSecretMetadata(metadata(order), requiredNames),
            /differs from the reviewed baseline/);
    }
    for (const input of [undefined, {}, { secrets: [] }]) {
        assert.throws(() => assertProductionRuntimeSecretMetadata(input, requiredNames), /differs from the reviewed baseline/);
    }
});

test('required print runtime secret metadata still requires secret_text for every required name', () => {
    for (const requiredName of requiredNames) {
        for (const type of ['plain_text', undefined]) {
            const input = metadata(names).map(secret => secret.name === requiredName ? { name: requiredName, type } : secret);
            assert.throws(() => assertProductionRuntimeSecretMetadata(input, requiredNames), /missing or has the wrong type/);
        }
    }
});

test('production runtime secret validation inspects names and types without accessing secret content', () => {
    const input = metadata(names).map(secret => Object.defineProperty(secret, 'text', {
        get() { throw new Error('Secret content must not be inspected.'); }
    }));
    assert.deepEqual(assertProductionRuntimeSecretMetadata(input, requiredNames), metadata(names));
});
