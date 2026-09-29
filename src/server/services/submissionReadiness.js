/**
 * Reports the current server-side submission readiness boundary.
 * @returns {Promise<{status: 'not_ready', code: 'REQUIRED_DOCUMENT_PROVIDER_UNAVAILABLE'}>} Closed readiness state until the required-document engine is implemented.
 */
export async function readSubmissionReadiness() {
    return Object.freeze({
        status: 'not_ready',
        code: 'REQUIRED_DOCUMENT_PROVIDER_UNAVAILABLE'
    });
}
