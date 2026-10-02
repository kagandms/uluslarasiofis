import portal from '../../src/server/worker.js';

/**
 * Reports native workerd crypto behavior only in an explicitly local acceptance harness.
 * @param {Request} request Local request.
 * @param {object} environment Local bindings.
 * @param {object} context Runtime context.
 * @returns {Promise<Response>|Response} Probe or actual portal response.
 */
function fetchLocalProbe(request, environment, context) {
    if (new URL(request.url).pathname === '/__runtime_probe') {
        const encoder = new TextEncoder();
        return Response.json({
            timingSafeEqual: typeof crypto.subtle.timingSafeEqual,
            equal: crypto.subtle.timingSafeEqual(encoder.encode('same'), encoder.encode('same')),
            different: crypto.subtle.timingSafeEqual(encoder.encode('same'), encoder.encode('diff'))
        });
    }
    return portal.fetch(request, environment, context);
}

export default { fetch: fetchLocalProbe };
