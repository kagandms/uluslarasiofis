import { readCachedSchemaReadiness } from './schemaReadinessCache.js';

/** Checks the explicit C/F creation gate. @param {object} environment Worker bindings. @returns {boolean} New metadata registrations allowed. */
export function isPhysicalReceiptCreationEnabled(environment) {
    return environment.PHYSICAL_RECEIPTS_CREATE_ENABLED === 'true';
}

/** Requires the final migration marker before exposing receipt capabilities. @param {object} environment Bindings.
 * @returns {Promise<boolean>} Complete receipt schema. @throws {Error} Unavailable database. */
export async function hasPhysicalReceiptSchema(environment) {
    if (!environment.DB) return false;
    return readCachedSchemaReadiness(environment.DB, 'physical-receipts', async () => {
        const marker = await environment.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='physical_receipt_schema'").first();
        if (!marker) return false;
        const version = await environment.DB.prepare("SELECT version FROM physical_receipt_schema WHERE id='global'").first();
        return version?.version === 1;
    });
}
