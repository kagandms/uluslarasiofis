const readinessCache = new WeakMap();

/**
 * Reads a D1 schema readiness check once per database binding while it succeeds.
 * Missing schemas and failed reads are retried so fail-closed rollout checks remain current.
 * @param {D1Database} database D1 binding used for the schema check.
 * @param {string} schemaKey Stable key for this readiness check.
 * @param {() => Promise<boolean>} readReadiness Performs the uncached readiness query.
 * @returns {Promise<boolean>} Whether the required schema is present and ready.
 */
export async function readCachedSchemaReadiness(database, schemaKey, readReadiness) {
    let databaseCache = readinessCache.get(database);
    if (!databaseCache) {
        databaseCache = new Map();
        readinessCache.set(database, databaseCache);
    }

    const cachedReadiness = databaseCache.get(schemaKey);
    if (cachedReadiness) return cachedReadiness;

    const readiness = Promise.resolve().then(readReadiness).then((isReady) => {
        if (!isReady) databaseCache.delete(schemaKey);
        return isReady;
    }, (error) => {
        databaseCache.delete(schemaKey);
        throw error;
    });
    databaseCache.set(schemaKey, readiness);
    return readiness;
}
