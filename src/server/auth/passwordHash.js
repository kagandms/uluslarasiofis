const PASSWORD_HASH_SCHEME = 'pbkdf2_sha256';
const PASSWORD_HASH_ITERATIONS = 600_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;
const MAX_PASSWORD_BYTES = 1024;
const DUMMY_PASSWORD_HASH = `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const encoder = new TextEncoder();

function encodeBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(value) {
    const base64Value = value.replaceAll('-', '+').replaceAll('_', '/');
    const paddedValue = base64Value.padEnd(Math.ceil(base64Value.length / 4) * 4, '=');
    return Uint8Array.from(atob(paddedValue), (character) => character.charCodeAt(0));
}

async function deriveKey(password, salt, iterations) {
    const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const keyBits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations
    }, passwordKey, PASSWORD_KEY_BYTES * 8);
    return new Uint8Array(keyBits);
}

function isValidPassword(password) {
    if (typeof password !== 'string') return false;
    const passwordBytes = encoder.encode(password);
    return password.length >= 12 && passwordBytes.length <= MAX_PASSWORD_BYTES;
}

function haveEqualBytes(first, second) {
    if (first.length !== second.length) return false;
    let difference = 0;
    for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
    return difference === 0;
}

/**
 * Derives a salted PBKDF2-HMAC-SHA-256 staff password hash for Workers Web Crypto.
 * @param {string} password Plaintext input held only for this request.
 * @returns {Promise<string>} Versioned password hash suitable for D1 storage.
 * @throws {TypeError} When the password is shorter than 12 characters or exceeds 1024 UTF-8 bytes.
 */
export async function deriveStaffPasswordHash(password) {
    if (!isValidPassword(password)) throw new TypeError('Staff password must be at least 12 characters and at most 1024 UTF-8 bytes.');
    const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
    const key = await deriveKey(password, salt, PASSWORD_HASH_ITERATIONS);
    return `${PASSWORD_HASH_SCHEME}$${PASSWORD_HASH_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(key)}`;
}

/**
 * Verifies a password using the parameters encoded in a stored staff password hash.
 * @param {string} password Candidate plaintext password.
 * @param {string} passwordHash Versioned D1 password hash.
 * @returns {Promise<boolean>} Whether the supplied password matches the stored hash.
 */
export async function verifyStaffPassword(password, passwordHash) {
    if (typeof password !== 'string' || encoder.encode(password).length > MAX_PASSWORD_BYTES) return false;
    const storedHash = typeof passwordHash === 'string' ? passwordHash : DUMMY_PASSWORD_HASH;
    const [scheme, iterationText, saltText, keyText, ...extra] = storedHash.split('$');
    const iterations = Number(iterationText);
    if (extra.length || scheme !== PASSWORD_HASH_SCHEME || !Number.isSafeInteger(iterations)
        || iterations < PASSWORD_HASH_ITERATIONS || iterations > 1_000_000) {
        await deriveKey(password, new Uint8Array(PASSWORD_SALT_BYTES), PASSWORD_HASH_ITERATIONS);
        return false;
    }

    try {
        const salt = decodeBase64Url(saltText);
        const expectedKey = decodeBase64Url(keyText);
        if (salt.length !== PASSWORD_SALT_BYTES || expectedKey.length !== PASSWORD_KEY_BYTES) return false;
        const candidateKey = await deriveKey(password, salt, iterations);
        return haveEqualBytes(candidateKey, expectedKey);
    } catch {
        return false;
    }
}
