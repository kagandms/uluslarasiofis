const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REFERENCE_PATTERN = /^ITU-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/i;
const ACCESS_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const encoder = new TextEncoder();

/**
 * Normalizes an application reference number.
 * @param {string} reference Raw user input.
 * @returns {string} Normalized uppercase reference.
 */
export function normalizeApplicationReference(reference) {
    if (typeof reference !== 'string') return '';
    return reference.trim().toUpperCase();
}

/**
 * Checks if a string conforms to the application reference format.
 * Format: ITU-XXXX-XXXX (where X is from unconfusable alphanumeric set).
 * @param {string} reference Candidate string.
 * @returns {boolean} True if format matches.
 */
export function isValidApplicationReference(reference) {
    if (typeof reference !== 'string') return false;
    return REFERENCE_PATTERN.test(reference.trim());
}

/**
 * Generates a unique, non-guessable, format-compliant application reference.
 * Not derived from any personal data (student number, passport, etc.).
 * Exact entropy: 31^8 ≈ 8.5289 * 10^11 combinations (8 * log2(31) ≈ 39.63 bits).
 * Uses rejection sampling (byte < 248, 248 = 31 * 8) to ensure zero modulo bias.
 * @returns {string} Formatted reference, e.g. "ITU-7K9M-4X2P".
 */
export function generateApplicationReference() {
    let part1 = '';
    let part2 = '';
    while (part1.length < 4 || part2.length < 4) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            if (byte < 248) {
                const char = REFERENCE_ALPHABET[byte % 31];
                if (part1.length < 4) {
                    part1 += char;
                } else if (part2.length < 4) {
                    part2 += char;
                } else {
                    break;
                }
            }
        }
    }
    return `ITU-${part1}-${part2}`;
}

/**
 * Generates a cryptographically secure access code with 130 bits of true entropy (>= 128 bits).
 * Format: 26 unconfusable characters grouped into 5 chunks (5-5-5-5-6).
 * Alphabet: 32 unconfusable characters (excludes 0, 1, I, O).
 * Masking: byte & 0x1f provides strictly uniform distribution with zero modulo bias
 * because 256 is an exact integer multiple of 32 (256 / 32 = 8).
 * Entropy: 26 * log2(32) = 26 * 5 = 130 bits.
 * @returns {string} Plaintext access code, e.g. "K7M9X-4P2WR-8T5NV-3Y6BQ-9D2FAL".
 */
export function generateAccessCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(26));
    const chars = [];
    for (let i = 0; i < 26; i++) {
        chars.push(ACCESS_CODE_ALPHABET[bytes[i] & 0x1f]);
    }
    return [
        chars.slice(0, 5).join(''),
        chars.slice(5, 10).join(''),
        chars.slice(10, 15).join(''),
        chars.slice(15, 20).join(''),
        chars.slice(20, 26).join('')
    ].join('-');
}

/**
 * Normalizes an access code by trimming whitespace and converting to uppercase.
 * Removes hyphens and non-alphabet characters for robust comparison.
 * @param {string} code Raw input code.
 * @returns {string} Normalized code without hyphens.
 */
export function normalizeAccessCode(code) {
    if (typeof code !== 'string') return '';
    return code.trim().toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '');
}

/**
 * Checks if a candidate access code has valid length and character content.
 * Standard access code has 26 normalized characters.
 * @param {string} code Candidate access code.
 * @returns {boolean} True if length and charset are valid.
 */
export function isValidAccessCodeFormat(code) {
    if (typeof code !== 'string') return false;
    const normalized = normalizeAccessCode(code);
    return normalized.length === 26 && /^[2-9A-HJ-NP-Z]{26}$/.test(normalized);
}

/**
 * Computes the SHA-256 hex digest of a normalized access code.
 * Only this hash is stored on the server.
 * @param {string} code Plaintext access code.
 * @returns {Promise<string>} 64-char lowercase hex digest.
 */
export async function hashAccessCode(code) {
    const normalized = normalizeAccessCode(code);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(normalized)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Performs a constant-time comparison of two hex hashes to prevent timing attacks.
 * @param {string} hashA First hex string.
 * @param {string} hashB Second hex string.
 * @returns {boolean} True if identical.
 */
export function constantTimeCompare(hashA, hashB) {
    if (typeof hashA !== 'string' || typeof hashB !== 'string') return false;
    if (hashA.length !== hashB.length) return false;
    const bufA = encoder.encode(hashA);
    const bufB = encoder.encode(hashB);
    if (typeof crypto?.subtle?.timingSafeEqual === 'function') {
        return crypto.subtle.timingSafeEqual(bufA, bufB);
    }
    let mismatch = 0;
    for (let i = 0; i < bufA.length; i++) {
        mismatch |= bufA[i] ^ bufB[i];
    }
    return mismatch === 0;
}

/**
 * Verifies a submitted access code against a stored SHA-256 hash.
 * @param {string} submittedCode Plaintext code submitted by user.
 * @param {string} storedHash SHA-256 hex hash from database.
 * @returns {Promise<boolean>} True if match.
 */
export async function verifyAccessCode(submittedCode, storedHash) {
    if (!submittedCode || !storedHash) return false;
    const submittedHash = await hashAccessCode(submittedCode);
    return constantTimeCompare(submittedHash, storedHash);
}
