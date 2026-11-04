import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { callAppsScript, UpstreamServiceError } from '../services/appsScriptProxy.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);
const DATE_SHEET_NAME = /^\d{2}\.\d{2}\.\d{4}$/;

function transferError(status, code, message) {
    return new ApiError(status, code, message, true);
}

function readAction(body) {
    if (Object.keys(body).length !== 1 || !['add', 'remove'].includes(body.action)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'E-Tablo işlemini kontrol edip tekrar deneyin.');
    }
    return body.action;
}

function readTransferState(record) {
    return record?.state === 'present'
        ? { state: 'present', sheetName: record.sheet_name }
        : { state: 'absent' };
}

function requireConfirmedUpstream(payload, action, recordKey) {
    if (action === 'add'
        && payload?.success === true
        && payload.state === 'present'
        && payload.recordKey === recordKey
        && typeof payload.sheetName === 'string'
        && DATE_SHEET_NAME.test(payload.sheetName)) {
        return payload.sheetName;
    }
    if (action === 'remove'
        && payload?.success === true
        && payload.state === 'absent'
        && payload.recordKey === recordKey) return null;
    throw transferError(502, 'SPREADSHEET_UNCONFIRMED', 'E-Tablo işleminin sonucu doğrulanamadı. Listeyi yenileyip tekrar deneyin.');
}

/**
 * Adds or removes one online application using the server-owned student identity.
 * @param {Request} request Same-origin staff POST request.
 * @param {object} environment Worker bindings.
 * @param {string} applicationId Application identifier from the route.
 * @returns {Promise<object>} Confirmed persisted transfer state.
 */
export async function handleStaffApplicationSpreadsheet(request, environment, applicationId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const action = readAction(await readJsonBody(request));
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    if (!application || application.status === 'draft' || !application.submitted_at) {
        throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Gönderilmiş başvuru bulunamadı.');
    }
    const deletion = await environment.DB.prepare('SELECT state FROM application_deletions WHERE application_id = ?')
        .bind(applicationId).first();
    if (deletion) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Gönderilmiş başvuru bulunamadı.');

    const spreadsheet = repositories.applicationSpreadsheet;
    const current = await spreadsheet.findByApplicationId(applicationId);
    if (['cancelled', 'rejected'].includes(application.status)
        && (action === 'add' ? current?.state !== 'pending_add'
            : !['present', 'pending_add', 'pending_remove'].includes(current?.state))) {
        throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Gönderilmiş başvuru bulunamadı.');
    }
    if (action === 'add' && current?.state === 'present') return readTransferState(current);
    if (action === 'remove' && (!current || current.state === 'absent')) return { state: 'absent' };
    if (action === 'add' && current?.state === 'pending_remove' || action === 'remove' && current?.state === 'pending_add') {
        throw new ApiError(409, 'SPREADSHEET_OPERATION_PENDING', 'Önceki E-Tablo işlemi sonuçlanıyor. Biraz sonra listeyi yenileyin.');
    }
    if (action === 'add' && (!application.first_name?.trim() || !application.last_name?.trim()
        || typeof application.passport_number !== 'string' || !application.passport_number.trim())) {
        throw new ApiError(409, 'SPREADSHEET_DATA_MISSING', 'Başvuruda ad, soyad ve pasaport numarası eksik.');
    }

    const operationId = (action === 'add' && current?.state === 'pending_add'
        || action === 'remove' && current?.state === 'pending_remove')
        ? current.operation_id : crypto.randomUUID();
    const input = { applicationId, operationId, staffId: staff.username, updatedAt: new Date().toISOString() };
    const pending = action === 'add'
        ? await spreadsheet.startAdd({ ...input, recordKey: current?.record_key || applicationId })
        : await spreadsheet.startRemove(input);
    const expectedPendingState = action === 'add' ? 'pending_add' : 'pending_remove';
    if (!pending || pending.state !== expectedPendingState) {
        throw new ApiError(409, 'SPREADSHEET_OPERATION_PENDING', 'Başka bir E-Tablo işlemi devam ediyor. Listeyi yenileyin.');
    }

    let upstream;
    try {
        upstream = await callAppsScript(action === 'add' ? 'residenceAdd' : 'residenceRemove', action === 'add'
            ? {
                applicationId, recordKey: pending.record_key,
                verifyExisting: current?.state === 'pending_add' ? 'true' : 'false',
                firstName: application.first_name.trim(), lastName: application.last_name.trim(),
                passportNumber: application.passport_number
            }
            : { applicationId, recordKey: pending.record_key,
                sheetName: typeof pending.sheet_name === 'string' ? pending.sheet_name : '' }, environment);
    } catch (error) {
        console.warn('Apps Script spreadsheet transfer failed.', {
            action,
            code: error instanceof UpstreamServiceError ? error.code : 'UNEXPECTED_FAILURE',
            reason: error instanceof UpstreamServiceError ? error.reason || 'UNCLASSIFIED' : 'UNEXPECTED'
        });
        throw transferError(502, 'SPREADSHEET_UNCONFIRMED', 'E-Tablo işleminin sonucu doğrulanamadı. Listeyi yenileyip tekrar deneyin.');
    }

    const sheetName = requireConfirmedUpstream(upstream, action, pending.record_key);
    const completed = await spreadsheet.complete({
        applicationId, operationId: pending.operation_id, fromState: expectedPendingState,
        state: action === 'add' ? 'present' : 'absent', sheetName,
        updatedAt: new Date().toISOString()
    });
    if (!completed) {
        const confirmed = await spreadsheet.findByApplicationId(applicationId);
        if (confirmed?.state !== (action === 'add' ? 'present' : 'absent')
            || (action === 'add' && confirmed.sheet_name !== sheetName)) {
            throw transferError(502, 'SPREADSHEET_UNCONFIRMED', 'E-Tablo işleminin sonucu doğrulanamadı. Listeyi yenileyip tekrar deneyin.');
        }
    }
    return action === 'add' ? { state: 'present', sheetName } : { state: 'absent' };
}
