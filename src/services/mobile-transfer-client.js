/**
 * Calls a same-origin transfer API and returns a decoded successful response.
 * @param {string} path Same-origin API path.
 * @param {RequestInit} options Fetch options.
 * @returns {Promise<object>} Response payload.
 * @throws {Error} With the server's safe message or a connection error.
 */
export async function requestMobileTransfer(path, options = {}) {
    const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
        const error = new Error(payload.error?.message || 'Aktarım tamamlanamadı.');
        error.code = payload.error?.code || 'TRANSFER_FAILED';
        throw error;
    }
    return payload;
}
