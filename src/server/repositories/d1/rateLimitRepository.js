/**
 * Creates the short-lived hashed-key public request limiter repository.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {{consume(input: object): Promise<object|null>}} Rate limit persistence operations.
 */
export function createRateLimitRepository(database) {
    return Object.freeze({
        async consume({ endpoint, requestKeyHash, nowSeconds, windowSeconds, maxRequests }) {
            await database.prepare(`
                INSERT INTO public_rate_limits (endpoint, request_key_hash, window_started_at, request_count)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(endpoint, request_key_hash) DO UPDATE SET
                    request_count = CASE
                        WHEN public_rate_limits.window_started_at <= ? THEN 1
                        ELSE public_rate_limits.request_count + 1
                    END,
                    window_started_at = CASE
                        WHEN public_rate_limits.window_started_at <= ? THEN excluded.window_started_at
                        ELSE public_rate_limits.window_started_at
                    END,
                    blocked_until = CASE
                        WHEN public_rate_limits.window_started_at <= ? THEN NULL
                        WHEN public_rate_limits.request_count + 1 > ? THEN ?
                        ELSE public_rate_limits.blocked_until
                    END,
                    updated_at = CURRENT_TIMESTAMP
            `).bind(
                endpoint,
                requestKeyHash,
                nowSeconds,
                nowSeconds - windowSeconds,
                nowSeconds - windowSeconds,
                nowSeconds - windowSeconds,
                maxRequests,
                nowSeconds + windowSeconds
            ).run();
            return database.prepare(`
                SELECT request_count, blocked_until
                FROM public_rate_limits WHERE endpoint = ? AND request_key_hash = ?
            `).bind(endpoint, requestKeyHash).first();
        }
    });
}
