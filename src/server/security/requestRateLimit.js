/**
 * Hız sınırı deposu için kimlik değerini SHA-256 ile özetler.
 * @param {string} value Özetlenecek ham kimlik değeri.
 * @returns {Promise<string>} Küçük harfli onaltılık SHA-256 özeti.
 */
export async function hashRateLimitIdentity(value) {
    const encoded = new TextEncoder().encode(value);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Consumes one hashed request-rate slot without storing the source IP in D1.
 * @param {{consume(input: object): Promise<object|null>}} repository Rate-limit repository.
 * @param {object} options Endpoint and limit window.
 * @returns {Promise<boolean>} Whether the request remains below its configured limit.
 */
export async function consumePublicRateLimit(repository, { endpoint, identity, nowSeconds, windowSeconds, maxRequests }) {
    const requestKeyHash = await hashRateLimitIdentity(identity);
    const rateLimit = await repository.consume({ endpoint, requestKeyHash, nowSeconds, windowSeconds, maxRequests });
    return rateLimit.request_count <= maxRequests && !(rateLimit.blocked_until > nowSeconds);
}
