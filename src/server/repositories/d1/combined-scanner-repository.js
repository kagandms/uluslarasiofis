import { createScannerRepository } from './scanner-repository.js';
import { createStaffDocumentScannerRepository } from './staff-document-scanner-repository.js';

/** Adds staff documents behind the existing online queue without changing agent contracts.
 * @param {D1Database} database Binding. @returns {object} Combined scanner operations.
 */
export function createCombinedScannerRepository(database) {
    const online = createScannerRepository(database);
    const staff = createStaffDocumentScannerRepository(database);
    const selectRepository = input => (input.jobId || input.job?.id || '').startsWith('staff_') ? staff : online;
    return Object.freeze({
        ...online,
        reconcile: async now => { await online.reconcile(now); await staff.reconcile(now); },
        claim: async input => await online.claim(input) || await staff.claim(input),
        findLease: input => selectRepository(input).findLease(input),
        bindContent: input => selectRepository(input).bindContent(input),
        persistResult: input => selectRepository(input).persistResult(input)
    });
}
