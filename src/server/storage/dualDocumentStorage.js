/**
 * Migration-period storage: new objects go to the encrypted remote store, and reads fall back to the
 * legacy R2 store for objects that have not been migrated yet. Deletes remove both copies.
 * A read never returns a remote outage as "not found": if the remote fails and the legacy store has no
 * copy, the remote error is raised so callers retry instead of treating the document as missing.
 * @param {{remote: object, legacy: object}} stores Adapters with the shared document storage shape.
 * @returns {object} Provider-neutral document storage operations.
 */
export function createDualDocumentStorage({ remote, legacy }) {
    async function readEither(operation) {
        let remoteError = null;
        try {
            const fromRemote = await operation(remote);
            if (fromRemote) return fromRemote;
        } catch (error) {
            remoteError = error;
        }
        const fromLegacy = await operation(legacy);
        if (fromLegacy) return fromLegacy;
        if (remoteError) throw remoteError;
        return null;
    }

    return Object.freeze({
        createQuarantineKey: () => remote.createQuarantineKey(),
        put: (key, body, contentType) => remote.put(key, body, contentType),
        async putIfAbsent(key, body, contentType) {
            if (await legacy.head(key)) return null;
            return remote.putIfAbsent(key, body, contentType);
        },
        head: (key) => readEither((store) => store.head(key)),
        get: (key, options) => readEither((store) => store.get(key, options)),
        async delete(key) {
            await remote.delete(key);
            await legacy.delete(key);
        },
        async deleteMany(keys) {
            await remote.deleteMany(keys);
            await legacy.deleteMany(keys);
        },
        createUploadCapability: (...args) => remote.createUploadCapability(...args),
        createWriteOnceUploadCapability: (...args) => remote.createWriteOnceUploadCapability(...args),
        createReadCapability: (...args) => remote.createReadCapability(...args)
    });
}
