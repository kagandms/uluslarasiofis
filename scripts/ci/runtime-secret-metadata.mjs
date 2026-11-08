import assert from 'node:assert/strict';

// Reviewed names only. D1_ANALYTICS_API_TOKEN powers the staff D1 usage counter;
// see docs/d1-usage-counter.md and its introduction in commit 9acc1d8.
const expectedSecretNames = [
    'APPS_SCRIPT_API_KEY', 'APPS_SCRIPT_URL', 'AZURE_VISION_ENDPOINT', 'AZURE_VISION_KEY',
    'D1_ANALYTICS_API_TOKEN',
    'PRINTER_SECRET', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY',
    'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_SECRET_ACCESS_KEY', 'SCANNER_SECRET', 'STAFF_BOOTSTRAP_TOKEN'
];

export function assertProductionRuntimeSecretMetadata(secrets, requiredNames) {
    // Project metadata only; never inspect secret content or accept new names automatically.
    const actualSecrets = (Array.isArray(secrets) ? secrets : secrets?.secrets || [])
        .map(secret => ({ name: secret.name, type: secret.type }));
    // Default string sort uses UTF-16 code units and is independent of the runner locale.
    assert.deepEqual(actualSecrets.map(secret => secret.name).sort(), [...expectedSecretNames].sort(),
        'Production runtime secret metadata differs from the reviewed baseline.');
    for (const requiredName of requiredNames) {
        const secret = actualSecrets.find(item => item.name === requiredName);
        assert.equal(secret?.type, 'secret_text', `Required production secret metadata is missing or has the wrong type: ${requiredName}.`);
    }
    return actualSecrets;
}
