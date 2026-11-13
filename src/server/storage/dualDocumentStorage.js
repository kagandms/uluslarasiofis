/**
 * Migration-period storage. New objects are written to BOTH stores: the encrypted remote store and the
 * legacy R2 store, so a document is never held only on the office PC before a separate backup exists.
 * Reads prefer the remote store and fall back to R2 for objects that have not been migrated yet.
 * Deletes remove both copies. A read never reports a remote outage as "not found": if the remote fails and
 * R2 has no copy, the remote error is raised so callers retry instead of treating the document as missing.
 * If the second write fails, the first is removed again so a retry starts from a clean state.
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

    async function toBytes(body) {
        return body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    }

    return Object.freeze({
        createQuarantineKey: () => remote.createQuarantineKey(),
        async put(key, body, contentType) {
            const bytes = await toBytes(body);
            const stored = await remote.put(key, bytes, contentType);
            try {
                await legacy.put(key, bytes, contentType);
            } catch (error) {
                await remote.delete(key).catch(() => {});
                throw error;
            }
            return stored;
        },
        async putIfAbsent(key, body, contentType) {
            if (await legacy.head(key)) return null;
            const bytes = await toBytes(body);
            const stored = await remote.putIfAbsent(key, bytes, contentType);
            if (!stored) return null;
            try {
                await legacy.putIfAbsent(key, bytes, contentType);
            } catch (error) {
                await remote.delete(key).catch(() => {});
                throw error;
            }
            return stored;
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
