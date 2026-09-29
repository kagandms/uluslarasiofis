const ROUTE_RESULT_MARKER = '__worker_route_result__';

/**
 * Marks a JSON response with its status and optional session cookie.
 * @param {unknown} body JSON-safe response body.
 * @param {object} options Response status and optional Set-Cookie value.
 * @returns {object} Worker route result wrapper.
 */
export function routeResult(body, { status = 200, cookie } = {}) {
    return { [ROUTE_RESULT_MARKER]: true, body, status, cookie };
}

/**
 * Checks whether a value was marked as a Worker route result.
 * @param {unknown} value Candidate route value.
 * @returns {boolean} True when the value carries the private route marker.
 */
export function isRouteResult(value) {
    return Boolean(value?.[ROUTE_RESULT_MARKER]);
}
