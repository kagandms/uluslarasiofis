/**
 * Authenticated encryption for stored documents (AES-256-GCM).
 *
 * Layout: magic "GOCE" (4) | format version (1) | key id (1) | IV (12) | ciphertext + 16-byte tag.
 * The per-object key is derived with HKDF-SHA-256 from a master key and the storage key. The header and
 * the storage key are authenticated data, so an object copied to another key or edited in place fails to decrypt.
 * The master key lives only in Worker secrets; the storage host sees ciphertext only.
 */

const MAGIC = new Uint8Array([0x47, 0x4f, 0x43, 0x45]);
const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + 1 + IV_BYTES;
const MASTER_KEY_BYTES = 32;
const HKDF_INFO_PREFIX = 'goc-document-v1:';

/** Bytes added to every plaintext (header plus authentication tag). */
export const ENCRYPTION_OVERHEAD_BYTES = HEADER_BYTES + TAG_BYTES;

/**
 * Creates a crypto error with a stable code and no key or plaintext material.
 * @param {string} message Safe message.
 * @param {string} code Stable error code.
 * @returns {Error} Error named DocumentCryptoError.
 */
function createCryptoError(message, code) {
    const error = new Error(message);
    error.name = 'DocumentCryptoError';
    error.code = code;
    return error;
}

function decodeBase64(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
    try {
        return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

/**
 * Builds a keyring from base64 master keys.
 * @param {{keys: Record<string, string>, currentKeyId: number|string}} input Key id to base64 32-byte key, and the id used for new objects.
 * @returns {{currentKeyId: number, keys: Map<number, Uint8Array>}} Validated keyring.
 * @throws {Error} DocumentCryptoError when a key is malformed or the current key is missing.
 */
export function createKeyring({ keys, currentKeyId }) {
    const parsed = new Map();
    for (const [id, encoded] of Object.entries(keys ?? {})) {
        const numericId = Number(id);
        const bytes = decodeBase64(encoded);
        if (!Number.isInteger(numericId) || numericId < 1 || numericId > 255 || !bytes || bytes.length !== MASTER_KEY_BYTES) {
            throw createCryptoError('Document encryption key configuration is invalid.', 'ENCRYPTION_CONFIGURATION_ERROR');
        }
        parsed.set(numericId, bytes);
    }
    const current = Number(currentKeyId);
    if (!parsed.has(current)) {
        throw createCryptoError('Document encryption key configuration is invalid.', 'ENCRYPTION_CONFIGURATION_ERROR');
    }
    return Object.freeze({ currentKeyId: current, keys: parsed });
}

/**
 * Reads the keyring from Worker bindings.
 * @param {object} environment Bindings with DOCUMENT_ENCRYPTION_KEYS (JSON id to base64 key) and DOCUMENT_ENCRYPTION_KEY_ID.
 * @returns {{currentKeyId: number, keys: Map<number, Uint8Array>}} Validated keyring.
 * @throws {Error} DocumentCryptoError when the configuration is missing or invalid.
 */
export function createKeyringFromEnvironment(environment) {
    let keys;
    try {
        keys = JSON.parse(environment?.DOCUMENT_ENCRYPTION_KEYS ?? '');
    } catch {
        throw createCryptoError('Document encryption key configuration is invalid.', 'ENCRYPTION_CONFIGURATION_ERROR');
    }
    return createKeyring({ keys, currentKeyId: environment?.DOCUMENT_ENCRYPTION_KEY_ID });
}

async function deriveObjectKey(masterBytes, storageKey) {
    const material = await crypto.subtle.importKey('raw', masterBytes, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(`${HKDF_INFO_PREFIX}${storageKey}`) },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function buildAdditionalData(header, storageKey) {
    const keyBytes = new TextEncoder().encode(storageKey);
    const additional = new Uint8Array(header.length + keyBytes.length);
    additional.set(header, 0);
    additional.set(keyBytes, header.length);
    return additional;
}

/**
 * Encrypts one document for storage under a storage key.
 * @param {{keyring: object, storageKey: string, plaintext: Uint8Array}} input Keyring, key the object will be stored under, and bytes.
 * @returns {Promise<Uint8Array>} Header plus ciphertext and tag.
 */
export async function encryptObject({ keyring, storageKey, plaintext }) {
    const master = keyring.keys.get(keyring.currentKeyId);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const header = new Uint8Array(HEADER_BYTES);
    header.set(MAGIC, 0);
    header[MAGIC.length] = FORMAT_VERSION;
    header[MAGIC.length + 1] = keyring.currentKeyId;
    header.set(iv, MAGIC.length + 2);
    const key = await deriveObjectKey(master, storageKey);
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: buildAdditionalData(header, storageKey), tagLength: TAG_BYTES * 8 },
        key,
        plaintext
    ));
    const output = new Uint8Array(HEADER_BYTES + sealed.length);
    output.set(header, 0);
    output.set(sealed, HEADER_BYTES);
    return output;
}

/**
 * Decrypts and authenticates one stored document.
 * @param {{keyring: object, storageKey: string, data: Uint8Array}} input Keyring, key the object was read from, and stored bytes.
 * @returns {Promise<Uint8Array>} Plaintext bytes.
 * @throws {Error} DocumentCryptoError when the format, key id, storage key binding or tag does not verify.
 */
export async function decryptObject({ keyring, storageKey, data }) {
    if (!(data instanceof Uint8Array) || data.length < ENCRYPTION_OVERHEAD_BYTES
        || !MAGIC.every((byte, index) => data[index] === byte) || data[MAGIC.length] !== FORMAT_VERSION) {
        throw createCryptoError('Stored document is not in a supported format.', 'DOCUMENT_FORMAT_INVALID');
    }
    const master = keyring.keys.get(data[MAGIC.length + 1]);
    if (!master) throw createCryptoError('Stored document uses an unknown key.', 'DOCUMENT_KEY_UNKNOWN');
    const header = data.slice(0, HEADER_BYTES);
    const iv = header.slice(MAGIC.length + 2, HEADER_BYTES);
    try {
        const key = await deriveObjectKey(master, storageKey);
        return new Uint8Array(await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: buildAdditionalData(header, storageKey), tagLength: TAG_BYTES * 8 },
            key,
            data.subarray(HEADER_BYTES)
        ));
    } catch {
        throw createCryptoError('Stored document failed authentication.', 'DOCUMENT_DECRYPTION_FAILED');
    }
}
