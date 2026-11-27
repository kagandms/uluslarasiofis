import { searchTokens } from '../../shared/searchFold.js';
import { COMPLETED_GOC_STATUS_TARGET, normalizeSearch } from './yoksisAuditPolicy.js';

/** Maximum number of items accepted by `/api/staff/yoksis-document-audit/sync/apply`. */
export const MAX_MIGRATION_SYNC_APPLY_ITEMS = 20;

const PROTECTED_RECORD_STATUSES = new Set(['cancelled', 'rejected', 'completed', 'migration_approved']);

/**
 * Maps a raw Excel "Göç Durumu" string to a portal sync target state.
 * @param {unknown} applicationStatus Raw Göç Durumu text from `yoksis_document_audit_records.application_status`.
 * @returns {'approved'|'missing_documents'|'reviewing'|null} Sync target state, or null for no change.
 */
export function mapExcelStatusToTargetState(applicationStatus) {
    const normalized = normalizeSearch(applicationStatus);
    if (!normalized) return null;
    if (normalized === COMPLETED_GOC_STATUS_TARGET.normalizedText) {
        return COMPLETED_GOC_STATUS_TARGET.targetState;
    }
    if (normalized === 'eksik belge istendi' || normalized.startsWith('eksik belge istendi ')) {
        return 'missing_documents';
    }
    if (
        normalized === 'eksik belgeler iletildi'
        || normalized.startsWith('eksik belgeler iletildi ')
        || normalized === 'islem bekliyor'
        || normalized === 'degerlendirme asamasinda'
    ) {
        return 'reviewing';
    }
    return null;
}

/**
 * Extracts missing-document note and deadline from an Excel audit row.
 * @param {object} row Row from `yoksis_document_audit_records`.
 * @returns {{ note: string, deadline: string|null }} Sanitized note and ISO deadline.
 */
export function extractAuditMissingDetails(row) {
    const deadline = typeof row?.missing_deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.missing_deadline)
        ? row.missing_deadline
        : null;
    let documents = [];
    if (Array.isArray(row?.documents)) {
        documents = row.documents;
    } else if (typeof row?.documents_json === 'string' && row.documents_json.trim()) {
        try {
            const parsed = JSON.parse(row.documents_json);
            if (Array.isArray(parsed)) documents = parsed;
        } catch {
            documents = [];
        }
    }
    const firstName = typeof documents[0]?.name === 'string' ? documents[0].name.trim().slice(0, 1000) : '';
    return { note: firstName, deadline };
}

/**
 * Checks whether an Excel row's full name is compatible with a portal record's first/last name.
 * @param {object} auditRow Excel audit row.
 * @param {object} portalRecord Online application or physical intake record.
 * @returns {boolean} True when normalized name tokens match (exact or reordered).
 */
export function areNamesCompatible(auditRow, portalRecord) {
    const auditTokens = searchTokens(`${auditRow?.first_name || ''} ${auditRow?.last_name || ''}`);
    const portalTokens = searchTokens(`${portalRecord?.first_name || ''} ${portalRecord?.last_name || ''}`);
    if (auditTokens.length === 0 || portalTokens.length === 0) return false;
    if (auditTokens.length !== portalTokens.length) return false;
    if (auditTokens.join(' ') === portalTokens.join(' ')) return true;
    const sortedAudit = [...auditTokens].sort().join(' ');
    const sortedPortal = [...portalTokens].sort().join(' ');
    return sortedAudit === sortedPortal;
}

function parseYearMonth(yearText, monthText) {
    const year = Number(yearText);
    const monthRaw = Number(monthText);
    if (!Number.isSafeInteger(year) || !Number.isSafeInteger(monthRaw)) return null;
    const month = monthRaw === 0 ? 1 : monthRaw;
    if (month < 1 || month > 12) return null;
    return year * 12 + (month - 1);
}

/**
 * Enforces the date guard: the E-İkamet YYYY-MM prefix must not be more than 1 month older
 * than the portal record's month (online `created_at`; physical `application_date` or `submitted_at`).
 * @param {string} applicationNumber E-İkamet number (`YYYY-MM-NNNNNNN`).
 * @param {object} portalRecord Portal record.
 * @returns {boolean} True when the Excel row is within the allowed date window.
 */
export function isWithinDateGuard(applicationNumber, portalRecord) {
    const appMatch = String(applicationNumber || '').match(/^(\d{4})-(\d{2})-\d{7}$/);
    if (!appMatch) return false;
    const eikametYM = parseYearMonth(appMatch[1], appMatch[2]);
    if (eikametYM === null) return false;

    const rawPortalDate = portalRecord?.record_kind === 'physical'
        ? (portalRecord.application_date || portalRecord.submitted_at)
        : portalRecord?.created_at;
    const portalMatch = String(rawPortalDate || '').slice(0, 7).match(/^(\d{4})-(\d{2})$/);
    if (!portalMatch) return false;
    const portalYM = parseYearMonth(portalMatch[1], portalMatch[2]);
    if (portalYM === null) return false;

    return eikametYM >= portalYM - 1;
}

function isProtectedRecord(record) {
    if (record.record_kind === 'online') {
        return PROTECTED_RECORD_STATUSES.has(record.status);
    }
    return Boolean(record.processing_closed_at)
        || record.legacy_status === 'completed'
        || PROTECTED_RECORD_STATUSES.has(record.status);
}

function readRecordVersion(record) {
    return record.record_kind === 'online' ? record.updated_at : record.lock_version;
}

function pickHighestApplicationRow(rows) {
    return rows.reduce((best, current) =>
        (!best || current.application_number > best.application_number ? current : best), null);
}

function buildPlanItem(record, auditRow, targetState, reason, details = { note: '', deadline: null }) {
    return {
        record_kind: record.record_kind,
        record_id: record.record_id,
        application_number: auditRow.application_number,
        current_status: record.status,
        target_state: targetState,
        version: readRecordVersion(record),
        reason,
        note: details.note,
        deadline: details.deadline
    };
}

/**
 * Computes the deterministic sync plan between finalized Excel audit rows and portal records.
 * @param {{ auditRows: Array<object>, portalRecords: Array<object> }} input Loaded audit and portal rows.
 * @returns {{ changes: Array<object>, needsAttention: Array<object>, manual: Array<object>, unchangedCount: number }} Sync plan.
 */
export function buildMigrationSyncPlan({ auditRows, portalRecords }) {
    const changes = [];
    const needsAttention = [];
    const manual = [];
    let unchangedCount = 0;

    const excelRowsByStudent = new Map();
    for (const row of auditRows || []) {
        if (row?.source !== 'excel') continue;
        const targetState = mapExcelStatusToTargetState(row.application_status);
        if (!targetState) continue;
        const studentNumber = String(row.student_number || '').trim().toUpperCase();
        if (!studentNumber) continue;
        let list = excelRowsByStudent.get(studentNumber);
        if (!list) {
            list = [];
            excelRowsByStudent.set(studentNumber, list);
        }
        list.push({ ...row, targetState });
    }

    const portalByStudent = new Map();
    for (const record of portalRecords || []) {
        if (!record || record.status === 'draft' || record.deleted_at) continue;
        const studentNumber = String(record.student_number || '').trim().toUpperCase();
        if (!studentNumber) continue;
        let list = portalByStudent.get(studentNumber);
        if (!list) {
            list = [];
            portalByStudent.set(studentNumber, list);
        }
        list.push(record);
    }

    for (const [studentNumber, records] of portalByStudent.entries()) {
        const studentExcelRows = excelRowsByStudent.get(studentNumber);
        if (!studentExcelRows || studentExcelRows.length === 0) continue;

        const openRecords = records.filter((record) => !isProtectedRecord(record));
        const protectedRecords = records.filter((record) => isProtectedRecord(record));

        if (openRecords.length > 0) {
            const openOnlineIds = new Set(
                openRecords.filter((record) => record.record_kind === 'online').map((record) => record.record_id)
            );
            const unlinkedOpenRecords = openRecords.filter((record) =>
                !(record.record_kind === 'physical' && record.linked_application_id && openOnlineIds.has(record.linked_application_id))
            );
            if (unlinkedOpenRecords.length > 1) {
                for (const record of openRecords) {
                    const dateEligible = studentExcelRows.filter((row) => isWithinDateGuard(row.application_number, record));
                    const bestRow = pickHighestApplicationRow(dateEligible);
                    if (!bestRow) continue;
                    manual.push(buildPlanItem(record, bestRow, bestRow.targetState, 'multiple_open_records'));
                }
                continue;
            }

            for (const record of openRecords) {
                const dateEligible = studentExcelRows.filter((row) => isWithinDateGuard(row.application_number, record));
                if (dateEligible.length === 0) {
                    const bestOlderRow = pickHighestApplicationRow(studentExcelRows);
                    manual.push(buildPlanItem(record, bestOlderRow, bestOlderRow.targetState, 'older_application'));
                    continue;
                }

                const nameMatched = dateEligible.filter((row) => areNamesCompatible(row, record));
                if (nameMatched.length === 0) {
                    const bestDateRow = pickHighestApplicationRow(dateEligible);
                    manual.push(buildPlanItem(record, bestDateRow, bestDateRow.targetState, 'name_mismatch'));
                    continue;
                }

                const bestRow = pickHighestApplicationRow(nameMatched);
                const targetState = bestRow.targetState;
                const details = targetState === 'missing_documents'
                    ? extractAuditMissingDetails(bestRow)
                    : { note: '', deadline: null };

                if (record.status === 'sent_to_migration') {
                    const currentOverlayState = record.overlay_state || null;
                    const currentOverlayNote = record.overlay_note || '';
                    const currentOverlayDeadline = record.overlay_deadline ?? null;

                    if (targetState === 'approved') {
                        changes.push(buildPlanItem(record, bestRow, 'approved', 'status_approved'));
                    } else if (targetState === 'missing_documents') {
                        if (
                            currentOverlayState === 'missing_documents'
                            && currentOverlayNote === details.note
                            && currentOverlayDeadline === details.deadline
                        ) {
                            unchangedCount += 1;
                        } else {
                            changes.push(buildPlanItem(record, bestRow, 'missing_documents', 'missing_documents', details));
                        }
                    } else if (currentOverlayState === 'missing_documents') {
                        changes.push(buildPlanItem(record, bestRow, 'reviewing', 'missing_documents_cleared'));
                    } else {
                        unchangedCount += 1;
                    }
                } else {
                    needsAttention.push(buildPlanItem(record, bestRow, targetState, 'not_sent_to_migration', details));
                }
            }
            continue;
        }

        for (const record of protectedRecords) {
            const dateEligible = studentExcelRows.filter((row) => isWithinDateGuard(row.application_number, record));
            if (dateEligible.length === 0) continue;
            const nameMatched = dateEligible.filter((row) => areNamesCompatible(row, record));
            if (nameMatched.length === 0) {
                const bestDateRow = pickHighestApplicationRow(dateEligible);
                manual.push(buildPlanItem(record, bestDateRow, bestDateRow.targetState, 'name_mismatch'));
                continue;
            }
            const bestRow = pickHighestApplicationRow(nameMatched);
            if (record.status === 'migration_approved' && bestRow.targetState === 'approved') {
                unchangedCount += 1;
            } else {
                manual.push(buildPlanItem(record, bestRow, bestRow.targetState, 'terminal_status_conflict'));
            }
        }
    }

    return { changes, needsAttention, manual, unchangedCount };
}
