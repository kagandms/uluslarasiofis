import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    generateApplicationReference,
    isValidApplicationReference,
    normalizeApplicationReference,
    generateAccessCode,
    normalizeAccessCode,
    isValidAccessCodeFormat,
    hashAccessCode,
    verifyAccessCode,
    constantTimeCompare
} from '../src/server/auth/applicationAccessCode.js';

test('application reference complies with format ITU-XXXX-XXXX and unconfusable alphabet', () => {
    const references = new Set();
    for (let i = 0; i < 100; i++) {
        const ref = generateApplicationReference();
        assert.match(ref, /^ITU-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
        assert.ok(isValidApplicationReference(ref));
        assert.equal(isValidApplicationReference('invalid-format'), false);
        assert.equal(isValidApplicationReference('ITU-0000-1111'), false); // 0 and 1 excluded from charset
        assert.equal(isValidApplicationReference('ITU-IIII-LLLL'), false); // I and L excluded from charset
        references.add(ref);
    }
    // High entropy check - 100 distinct generated references must all be unique (31^8 ≈ 8.53e11, 39.63 bits)
    assert.equal(references.size, 100);
});

test('normalizeApplicationReference trims and uppercases input', () => {
    assert.equal(normalizeApplicationReference('  itu-7k9m-4x2p  '), 'ITU-7K9M-4X2P');
    assert.equal(normalizeApplicationReference(''), '');
    assert.equal(normalizeApplicationReference(null), '');
});

test('access code generates formatted 128+ bit entropy string with hyphenated blocks', async () => {
    const codes = new Set();
    for (let i = 0; i < 50; i++) {
        const code = generateAccessCode();
        // 5 blocks (5-5-5-5-6) = 26 chars from 32-char alphabet (26 * 5 = 130 bits entropy >= 128 bits)
        assert.match(code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{6}$/);
        assert.ok(isValidAccessCodeFormat(code));
        codes.add(code);
    }
    assert.equal(codes.size, 50);
});

test('normalizeAccessCode strips hyphens, non-alphanumerics, and normalizes to uppercase', () => {
    const code = 'k7m9x-4p2wr-8t5nv-3y6bq-9d2fal';
    const normalized = normalizeAccessCode(code);
    assert.equal(normalized, 'K7M9X4P2WR8T5NV3Y6BQ9D2FAL');
    assert.equal(normalizeAccessCode('  K7M9X 4P2WR-8T5NV_3Y6BQ.9D2FAL  '), 'K7M9X4P2WR8T5NV3Y6BQ9D2FAL');
});

test('hashAccessCode produces consistent SHA-256 hex digest regardless of formatting/casing', async () => {
    const code1 = 'K7M9X-4P2WR-8T5NV-3Y6BQ-9D2FAL';
    const code2 = 'k7m9x-4p2wr-8t5nv-3y6bq-9d2fal';
    const code3 = 'K7M9X4P2WR8T5NV3Y6BQ9D2FAL';

    const hash1 = await hashAccessCode(code1);
    const hash2 = await hashAccessCode(code2);
    const hash3 = await hashAccessCode(code3);

    assert.equal(hash1.length, 64);
    assert.equal(hash1, hash2);
    assert.equal(hash1, hash3);
});

test('verifyAccessCode verifies correct code and rejects wrong or malformed codes', async () => {
    const code = generateAccessCode();
    const hash = await hashAccessCode(code);

    // Exact match
    assert.equal(await verifyAccessCode(code, hash), true);
    // Case-insensitive & formatting-tolerant match
    assert.equal(await verifyAccessCode(code.toLowerCase().replace(/-/g, ' '), hash), true);

    // Mismatched code
    const wrongCode = generateAccessCode();
    assert.equal(await verifyAccessCode(wrongCode, hash), false);

    // Null/empty edge cases
    assert.equal(await verifyAccessCode('', hash), false);
    assert.equal(await verifyAccessCode(code, ''), false);
    assert.equal(await verifyAccessCode(null, hash), false);
});

test('constantTimeCompare securely compares strings without short-circuiting on content', () => {
    assert.equal(constantTimeCompare('abcdef123456', 'abcdef123456'), true);
    assert.equal(constantTimeCompare('abcdef123456', 'abcdef123457'), false);
    assert.equal(constantTimeCompare('abcdef', 'abcdef123456'), false);
    assert.equal(constantTimeCompare(null, 'abc'), false);
    assert.equal(constantTimeCompare('abc', undefined), false);
});

test('constantTimeCompare delegates to crypto.subtle.timingSafeEqual when running in Cloudflare Workers', () => {
    const originalSubtleTimingSafeEqual = crypto.subtle.timingSafeEqual;
    let delegatedCallCount = 0;

    try {
        // Cloudflare Workers WebCrypto timingSafeEqual implementation
        crypto.subtle.timingSafeEqual = (a, b) => {
            delegatedCallCount++;
            assert.ok(ArrayBuffer.isView(a), 'first argument must be an ArrayBuffer view');
            assert.ok(ArrayBuffer.isView(b), 'second argument must be an ArrayBuffer view');
            assert.equal(a.byteLength, b.byteLength, 'views must be of equal byte length');
            let diff = 0;
            for (let i = 0; i < a.byteLength; i++) {
                diff |= a[i] ^ b[i];
            }
            return diff === 0;
        };

        assert.equal(constantTimeCompare('abcdef123456', 'abcdef123456'), true);
        assert.equal(delegatedCallCount, 1);

        assert.equal(constantTimeCompare('abcdef123456', 'abcdef123457'), false);
        assert.equal(delegatedCallCount, 2);

        // Different length strings short-circuit before delegating, preventing TypeError in Cloudflare runtime
        assert.equal(constantTimeCompare('short', 'longer_string'), false);
        assert.equal(delegatedCallCount, 2);
    } finally {
        if (originalSubtleTimingSafeEqual) {
            crypto.subtle.timingSafeEqual = originalSubtleTimingSafeEqual;
        } else {
            delete crypto.subtle.timingSafeEqual;
        }
    }
});
