import assert from 'node:assert/strict';
import worker from '../../src/server/worker.js';

/** @param {object} environment Bindings. @param {string} cookie Synthetic owner cookie. @returns {Promise<number>} Version observed by a client before editing. */
export async function readApplicationVersion(environment, cookie) {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications/current', { headers: { Cookie: cookie } }), environment);
    assert.equal(response.status, 200);
    return (await response.json()).application.lock_version;
}
