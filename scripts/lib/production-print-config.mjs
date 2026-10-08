const PRINT_SECRET_NAMES = Object.freeze([
    'PRINTER_SECRET', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY'
]);

/**
 * Reject deploy configurations that could publish credentials as ordinary vars.
 * @param {{readonly vars?: Readonly<Record<string, unknown>>}} configuration Production configuration.
 * @param {readonly {readonly name: string, readonly type: string}[]} bindings Remote secret metadata.
 * @returns {void}
 * @throws {Error} If credentials are plaintext or required secret bindings are absent.
 */
export function assertProductionPrintSecrets(configuration, bindings) {
    const variableNames = Object.keys(configuration.vars || {});
    const plaintextNames = variableNames.filter((name) => /SECRET|PASSWORD|TOKEN|API_KEY|ACCESS_KEY/.test(name));
    if (plaintextNames.length) throw new Error(`Plaintext credential vars rejected: ${plaintextNames.join(', ')}`);
    const missingNames = PRINT_SECRET_NAMES.filter((name) =>
        !bindings.some((binding) => binding.name === name && binding.type === 'secret_text'));
    if (missingNames.length) throw new Error(`Production secret bindings missing: ${missingNames.join(', ')}`);
}
