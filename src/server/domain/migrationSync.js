import { searchTokens } from '../../shared/searchFold.js';
import {
    COMPLETED_GOC_STATUS_TARGET,
    classifyGocStatus,
    diffIsoCalendarDays,
    getIstanbulTodayIso,
    isValidIsoCalendarDate,
    normalizeSearch,
    toIstanbulCalendarDate
} from './yoksisAuditPolicy.js';

/** Maximum number of items accepted by `/api/staff/yoksis-document-audit/sync/apply`. */
export const MAX_MIGRATION_SYNC_APPLY_ITEMS = 20;

const DATE_GUARD_MAX_OLDER_DAYS = 30;
const STALE_QUERY_THRESHOLD_DAYS = 7;
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
 * Compatible when token sets match in any order, or when the shorter name has >= 2 tokens
 * and every token is contained in the longer name (each token used once).
 * @param {object} auditRow Excel audit row.
 * @param {object} portalRecord Online application or physical intake record.
 * @returns {boolean} True when normalized name tokens are compatible.
 */
export function areNamesCompatible(auditRow, portalRecord) {
    const auditTokens = searchTokens(`${auditRow?.first_name || ''} ${auditRow?.last_name || ''}`);
    const portalTokens = searchTokens(`${portalRecord?.first_name || ''} ${portalRecord?.last_name || ''}`);
    if (auditTokens.length === 0 || portalTokens.length === 0) return false;

    const shorter = auditTokens.length <= portalTokens.length ? auditTokens : portalTokens;
    const longer = auditTokens.length <= portalTokens.length ? portalTokens : auditTokens;

    if (shorter.length === longer.length) {
        const sortedShorter = [...shorter].sort();
        const sortedLonger = [...longer].sort();
        return sortedShorter.every((token, index) => token === sortedLonger[index]);
    }

    if (shorter.length < 2) return false;

    const remaining = new Map();
    for (const token of longer) {
        remaining.set(token, (remaining.get(token) || 0) + 1);
    }
    for (const token of shorter) {
        const count = remaining.get(token) || 0;
        if (count === 0) return false;
        remaining.set(token, count - 1);
    }
    return true;
}

function resolvePortalCalendarDate(portalRecord) {
    const rawPortalDate = portalRecord?.record_kind === 'physical'
        ? (portalRecord.application_date || portalRecord.submitted_at)
        : portalRecord?.created_at;
    return toIstanbulCalendarDate(rawPortalDate);
}

function isWithinDateGuardForPortalDate(auditRowOrDate, portalDate) {
    if (!portalDate) return false;
    const rawRecordDate = typeof auditRowOrDate === 'string'
        ? auditRowOrDate
        : auditRowOrDate?.record_date;
    if (!isValidIsoCalendarDate(rawRecordDate)) return false;
    const olderByDays = diffIsoCalendarDays(rawRecordDate, portalDate);
    return olderByDays !== null && olderByDays <= DATE_GUARD_MAX_OLDER_DAYS;
}

/**
 * Enforces the date guard: the Excel row's `record_date` must be >= the portal record's
 * Europe/Istanbul calendar date (`created_at`; physical `application_date` or `submitted_at`) minus 30 days.
 * Never parses the E-İkamet application number.
 * @param {object|string|null|undefined} auditRowOrDate Excel audit row or ISO `record_date`.
 * @param {object} portalRecord Portal record.
 * @returns {boolean} True when `record_date` is present and within the allowed 30-day window.
 */
export function isWithinDateGuard(auditRowOrDate, portalRecord) {
    const portalDate = resolvePortalCalendarDate(portalRecord);
    return isWithinDateGuardForPortalDate(auditRowOrDate, portalDate);
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

function compareAuditRows(left, right) {
    const leftRecordDate = isValidIsoCalendarDate(left?.record_date) ? left.record_date : '';
    const rightRecordDate = isValidIsoCalendarDate(right?.record_date) ? right.record_date : '';
    if (leftRecordDate !== rightRecordDate) {
        return leftRecordDate > rightRecordDate ? 1 : -1;
    }
    const leftQueryAt = isValidIsoCalendarDate(left?.goc_last_query_at) ? left.goc_last_query_at : '';
    const rightQueryAt = isValidIsoCalendarDate(right?.goc_last_query_at) ? right.goc_last_query_at : '';
    if (leftQueryAt !== rightQueryAt) {
        return leftQueryAt > rightQueryAt ? 1 : -1;
    }
    const leftApp = String(left?.application_number || '');
    const rightApp = String(right?.application_number || '');
    if (leftApp === rightApp) return 0;
    return leftApp > rightApp ? 1 : -1;
}

function pickBestAuditRow(rows) {
    return rows.reduce((best, current) =>
        (!best || compareAuditRows(current, best) > 0 ? current : best), null);
}

function buildPlanItem(record, auditRow, targetState, reason, details = { note: '', deadline: null }) {
    return {
        record_kind: record.record_kind,
        record_id: record.record_id,
        application_number: auditRow.application_number,
        student_number: record.student_number || '',
        first_name: record.first_name || '',
        last_name: record.last_name || '',
        current_status: record.status,
        target_state: targetState,
        version: readRecordVersion(record),
        reason,
        note: details.note,
        deadline: details.deadline,
        goc_last_query_at: auditRow?.goc_last_query_at ?? null
    };
}

function isStaleUnfinishedAuditRow(row, todayIso) {
    if (classifyGocStatus(row?.application_status) === 'successful') return false;
    if (!isValidIsoCalendarDate(row?.goc_last_query_at)) return true;
    const ageDays = diffIsoCalendarDays(row.goc_last_query_at, todayIso);
    return ageDays !== null && ageDays > STALE_QUERY_THRESHOLD_DAYS;
}

/**
 * Computes the deterministic sync plan between finalized Excel audit rows and portal records.
 * @param {{ auditRows: Array<object>, portalRecords: Array<object>, nowMs?: number, includePhysicalInOutput?: boolean }} input Loaded audit and portal rows.
 * @returns {{ changes: Array<object>, needsAttention: Array<object>, manual: Array<object>, unchangedCount: number, staleUnfinishedCount: number }} Sync plan.
 */
export function buildMigrationSyncPlan({ auditRows, portalRecords, nowMs = Date.now(), includePhysicalInOutput = true }) {
    const changes = [];
    const needsAttention = [];
    const manual = [];
    let unchangedCount = 0;
    let staleUnfinishedCount = 0;
    const todayIso = getIstanbulTodayIso(nowMs);
    const shouldEmitRecord = (record) => includePhysicalInOutput || record.record_kind !== 'physical';

    const excelRowsByStudent = new Map();
    for (const row of auditRows || []) {
        if (row?.source !== 'excel') continue;
        if (isStaleUnfinishedAuditRow(row, todayIso)) {
            staleUnfinishedCount += 1;
        }
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
                    if (!shouldEmitRecord(record)) continue;
                    const portalDate = resolvePortalCalendarDate(record);
                    const dateEligible = studentExcelRows.filter((row) => isWithinDateGuardForPortalDate(row, portalDate));
                    const bestRow = pickBestAuditRow(dateEligible);
                    if (!bestRow) continue;
                    manual.push(buildPlanItem(record, bestRow, bestRow.targetState, 'multiple_open_records'));
                }
                continue;
            }

            for (const record of openRecords) {
                if (!shouldEmitRecord(record)) continue;
                const portalDate = resolvePortalCalendarDate(record);
                const dateEligible = studentExcelRows.filter((row) => isWithinDateGuardForPortalDate(row, portalDate));
                if (dateEligible.length === 0) {
                    const bestOlderRow = pickBestAuditRow(studentExcelRows);
                    const reason = isValidIsoCalendarDate(bestOlderRow?.record_date)
                        ? 'older_application'
                        : 'missing_record_date';
                    manual.push(buildPlanItem(record, bestOlderRow, bestOlderRow.targetState, reason));
                    continue;
                }

                const nameMatched = dateEligible.filter((row) => areNamesCompatible(row, record));
                if (nameMatched.length === 0) {
                    const bestDateRow = pickBestAuditRow(dateEligible);
                    manual.push(buildPlanItem(record, bestDateRow, bestDateRow.targetState, 'name_mismatch'));
                    continue;
                }

                const bestRow = pickBestAuditRow(nameMatched);
                const targetState = bestRow.targetState;
                const details = targetState === 'missing_documents'
                    ? extractAuditMissingDetails(bestRow)
                    : { note: '', deadline: null };

                if (record.status === 'sent_to_migration') {
                    const currentOverlayState = record.overlay_state || null;
                    const currentOverlayNote = record.overlay_note || '';
                    const currentOverlayDeadline = record.overlay_deadline ?? null;
                    const currentOverlayQueryAt = isValidIsoCalendarDate(record.overlay_goc_last_query_at)
                        ? record.overlay_goc_last_query_at
                        : null;
                    const incomingQueryAt = isValidIsoCalendarDate(bestRow.goc_last_query_at)
                        ? bestRow.goc_last_query_at
                        : null;
                    const isOlderOrMissingAgainstMissingDocs = currentOverlayState === 'missing_documents'
                        && Boolean(currentOverlayQueryAt)
                        && (!incomingQueryAt || incomingQueryAt < currentOverlayQueryAt);

                    if (targetState === 'missing_documents') {
                        if (
                            currentOverlayState === 'missing_documents'
                            && currentOverlayNote === details.note
                            && currentOverlayDeadline === details.deadline
                        ) {
                            unchangedCount += 1;
                        } else if (isOlderOrMissingAgainstMissingDocs) {
                            manual.push(buildPlanItem(record, bestRow, targetState, 'stale_query_conflict', details));
                        } else {
                            changes.push(buildPlanItem(record, bestRow, 'missing_documents', 'missing_documents', details));
                        }
                    } else if (isOlderOrMissingAgainstMissingDocs) {
                        manual.push(buildPlanItem(record, bestRow, targetState, 'stale_query_conflict', details));
                    } else if (targetState === 'approved') {
                        changes.push(buildPlanItem(record, bestRow, 'approved', 'status_approved'));
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
            if (!shouldEmitRecord(record)) continue;
            const portalDate = resolvePortalCalendarDate(record);
            const dateEligible = studentExcelRows.filter((row) => isWithinDateGuardForPortalDate(row, portalDate));
            if (dateEligible.length === 0) continue;
            const nameMatched = dateEligible.filter((row) => areNamesCompatible(row, record));
            if (nameMatched.length === 0) {
                const bestDateRow = pickBestAuditRow(dateEligible);
                manual.push(buildPlanItem(record, bestDateRow, bestDateRow.targetState, 'name_mismatch'));
                continue;
            }
            const bestRow = pickBestAuditRow(nameMatched);
            if (record.status === 'migration_approved' && bestRow.targetState === 'approved') {
                unchangedCount += 1;
            } else {
                manual.push(buildPlanItem(record, bestRow, bestRow.targetState, 'terminal_status_conflict'));
            }
        }
    }

    return { changes, needsAttention, manual, unchangedCount, staleUnfinishedCount };
}
