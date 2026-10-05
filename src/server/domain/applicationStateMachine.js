const STATUS_TRANSITIONS = Object.freeze({
    submitted: Object.freeze(['under_review']),
    resubmission_required: Object.freeze(['under_review']),
    under_review: Object.freeze(['approved_for_processing']),
    approved_for_processing: Object.freeze(['sent_to_migration', 'under_review']),
    sent_to_migration: Object.freeze(['migration_approved', 'approved_for_processing']),
    migration_approved: Object.freeze(['completed', 'sent_to_migration'])
});

/**
 * Evaluates one staff application status transition against the allowed workflow and its guards.
 * @param {string} currentStatus Persisted application status.
 * @param {string} targetStatus Requested next status.
 * @param {{hasResubmissionRequiredDocuments?: boolean, allRequiredDocumentsApproved?: boolean}} [guards] Server-derived readiness facts.
 * @returns {{allowed: boolean, code: string|null}} Safe transition result.
 */
export function evaluateApplicationTransition(currentStatus, targetStatus, guards = {}) {
    if (!STATUS_TRANSITIONS[currentStatus]?.includes(targetStatus)) {
        return { allowed: false, code: 'INVALID_APPLICATION_TRANSITION' };
    }
    if (currentStatus === 'resubmission_required' && guards.hasResubmissionRequiredDocuments) {
        return { allowed: false, code: 'RESUBMISSION_DOCUMENTS_REMAIN' };
    }
    if (targetStatus === 'approved_for_processing' && !guards.allRequiredDocumentsApproved) {
        return { allowed: false, code: 'APPLICATION_NOT_READY_FOR_APPROVAL' };
    }
    return { allowed: true, code: null };
}

/**
 * Lists the direct state-machine targets for a persisted application status.
 * @param {string} currentStatus Persisted application status.
 * @returns {string[]} Allowed direct targets before workflow guards.
 */
export function listApplicationStatusTransitions(currentStatus) {
    return [...(STATUS_TRANSITIONS[currentStatus] || [])];
}
