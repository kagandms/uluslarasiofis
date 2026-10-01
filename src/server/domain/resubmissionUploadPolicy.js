function hasCompatibleRecord(input) {
    return input.application?.status === 'resubmission_required'
        && input.policyIsApplicable === true
        && input.documentRecord?.id
        && input.documentRecord.applicationId === input.application.id
        && input.hasStudentMessageForDocument === true;
}

function hasCurrentRevision(input) {
    return input.currentRevision?.documentRecordId === input.documentRecord?.id
        && input.currentRevision.isCurrent === true
        && input.currentRevision.file?.cleanupStatus !== 'pending';
}

function isFirstReplacement(input) {
    return hasCurrentRevision(input)
        && input.documentRecord.reviewStatus === 'resubmission_required'
        && input.currentRevision.status === 'resubmission_required'
        && input.currentRevision.file?.uploadStatus === 'finalized'
        && input.currentRevision.file?.scanStatus === 'clean';
}

function isUnsafeScanRetry(input) {
    return hasCurrentRevision(input)
        && input.documentRecord.reviewStatus === 'pending'
        && input.currentRevision.status === 'submitted'
        && input.currentRevision.file?.uploadStatus === 'finalized'
        && input.currentRevision.file?.intentStatus === 'completed'
        && ['unsafe', 'failed'].includes(input.currentRevision.file?.scanStatus);
}

/**
 * Evaluates the persisted facts required for an initial replacement or unsafe-scan retry.
 * @param {object} input Server-loaded application, record, revision, file, policy, and note facts.
 * @returns {{allowed: boolean, mode: 'first_replacement'|'unsafe_scan_retry'|null}} Eligibility hint.
 */
export function evaluateResubmissionEligibility(input) {
    if (!hasCompatibleRecord(input)) return { allowed: false, mode: null };
    if (isFirstReplacement(input)) return { allowed: true, mode: 'first_replacement' };
    if (isUnsafeScanRetry(input)) return { allowed: true, mode: 'unsafe_scan_retry' };
    return { allowed: false, mode: null };
}
