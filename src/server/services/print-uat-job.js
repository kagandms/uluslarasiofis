import { ApiError } from '../domain/errors.js';
import { readPrintUatIdempotencyScope } from '../domain/print-uat-policy.js';
import { readPrintUatJobId } from '../repositories/d1/print-uat-repository.js';

/**
 * Restrict UAT browser and machine work to the single persistent reservation.
 * @param {string} jobId Requested job ID.
 * @param {object} environment Worker bindings.
 * @returns {Promise<void>}
 * @throws {ApiError} When the requested job is outside the UAT reservation.
 */
export async function requirePrintUatJob(jobId, environment) {
    if (!readPrintUatIdempotencyScope(environment)) return;
    if (await readPrintUatJobId(environment.DB) !== jobId) {
        throw new ApiError(403, 'PRINT_UAT_JOB_INVALID', 'UAT işi doğrulanamadı.');
    }
}
