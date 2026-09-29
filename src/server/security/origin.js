/**
 * Confirms a state-changing request originated from the same origin.
 * @param {Request} request Fetch API request.
 * @returns {boolean} Whether the supplied Origin matches the request URL.
 */
export function isSameOriginRequest(request) {
    const originHeader = request.headers.get('Origin');
    if (!originHeader) return false;
    try {
        const origin = new URL(originHeader);
        const requestUrl = new URL(request.url);
        return origin.origin === requestUrl.origin;
    } catch {
        return false;
    }
}
