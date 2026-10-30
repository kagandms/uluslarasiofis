function normalizeStudentPassport(student) {
    return String(student?.passportNo || student?.pasaportNo || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
}

/**
 * Reports whether an incoming Apply event belongs to a different student context.
 * @param {{ currentStudent: object | null, incomingStudent: object, currentRequestId: string | null, incomingRequestId: string | null }} context
 * @returns {boolean} True when the portal must discard prior student workflow state.
 */
export function hasYknStudentContextChanged(context) {
    const currentRequestId = String(context.currentRequestId || '').trim();
    const incomingRequestId = String(context.incomingRequestId || '').trim();
    if (currentRequestId && incomingRequestId && currentRequestId !== incomingRequestId) return true;

    if (!context.currentStudent) return false;
    const currentPassport = normalizeStudentPassport(context.currentStudent);
    const incomingPassport = normalizeStudentPassport(context.incomingStudent);
    if (!currentPassport || !incomingPassport) return false;
    return currentPassport !== incomingPassport;
}

/**
 * Checks whether a one-click response still belongs to the active student request.
 * @param {{ responseRequestId: string | null, workflow: object | null, currentStudentRequestId: string | null }} context
 * @returns {boolean} True only when both workflow and student request IDs still match.
 */
export function isCurrentYknWorkflowResponse(context) {
    const workflow = context.workflow;
    if (!workflow || !context.responseRequestId || workflow.workflowId !== context.responseRequestId) return false;
    if (!workflow.studentRequestId || !context.currentStudentRequestId) return false;
    return workflow.studentRequestId === context.currentStudentRequestId;
}

/**
 * Accepts a YÖKSİS search response only for the active operation or its current-student workflow.
 * @param {{ responseRequestId: string | null, activeRequestId: string | null, activeTransferRequestId?: string | null, workflow: object | null, currentStudentRequestId: string | null }} context
 * @returns {boolean} True when the search result is correlated to the active student operation.
 */
export function isCurrentYknTransferResponse(context) {
    if (!context.responseRequestId) return false;
    if (context.responseRequestId === context.activeRequestId) return true;
    if (context.activeTransferRequestId && context.responseRequestId === context.activeTransferRequestId) return true;
    return isCurrentYknWorkflowResponse(context);
}
