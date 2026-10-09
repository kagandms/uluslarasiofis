import { requireStaff } from '../auth/staffAuth.js';
import { ApiError } from '../domain/errors.js';
import { createPrintRepository } from '../repositories/d1/printRepository.js';
import { readPrintLimits } from '../domain/printPolicy.js';
import { createStaffPrintUploadIntent, finalizeStaffPrintUpload } from './printRoutes.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const PRINT_STATUSES = new Set(['uploading', 'queued', 'leased', 'ready', 'submission_started',
    'submitted', 'failed', 'unknown', 'cancelled', 'expired']);
const STAFF_JOB_ID = /^[0-9a-f-]{36}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value) {
    if (!value || !ISO_DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function readHistoryFilters(url) {
    const params = url.searchParams;
    const status = params.get('status') || 'all';
    const source = params.get('source') || 'all';
    const limit = Number(params.get('limit') || 25);
    const from = params.get('from');
    const to = params.get('to');
    if ((status !== 'all' && status !== 'active' && !PRINT_STATUSES.has(status))
        || !['all', 'student', 'staff', 'unknown'].includes(source)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
        || (from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) {
        throw new ApiError(400, 'INVALID_PRINT_FILTER', 'Yazdırma geçmişi filtreleri geçersiz.');
    }
    const beforeCreatedAt = params.get('before_created_at');
    const beforeId = params.get('before_id');
    if (Boolean(beforeCreatedAt) !== Boolean(beforeId)
        || (beforeCreatedAt && Number.isNaN(Date.parse(beforeCreatedAt)))
        || (beforeId && !STAFF_JOB_ID.test(beforeId))) {
        throw new ApiError(400, 'INVALID_PRINT_CURSOR', 'Yazdırma geçmişi sayfa işareti geçersiz.');
    }
    const start = from ? new Date(`${from}T00:00:00.000Z`).toISOString() : null;
    const end = to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString() : null;
    if (start && end && start >= end) throw new ApiError(400, 'INVALID_PRINT_FILTER', 'Tarih aralığını kontrol edin.');
    return { status: status === 'all' ? null : status, source: source === 'all' ? null : source,
        from: start, to: end, limit, beforeCreatedAt, beforeId };
}

async function readManagement(request, environment) {
    requireMethod(request, 'GET');
    const staff = await requireStaff(request, environment, ['reviewer', 'admin']);
    const repository = createPrintRepository(environment.DB);
    const [status, jobs] = await Promise.all([
        repository.readStaffStatus(new Date().toISOString()),
        repository.listStaffJobs({ status: 'active', limit: 25 })
    ]);
    return { ...status, jobs: jobs.jobs, canManage: staff.role === 'admin' };
}

async function readHistory(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, ['reviewer', 'admin']);
    return createPrintRepository(environment.DB).listStaffJobs(readHistoryFilters(new URL(request.url)));
}

async function setQueueState(request, environment, staff, paused) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    if (Object.keys(await readJsonBody(request, 256)).length) {
        throw new ApiError(400, 'INVALID_PRINT_INPUT', 'İstek gövdesi boş olmalıdır.');
    }
    const repository = createPrintRepository(environment.DB);
    const changed = await repository.setQueuePaused({ paused, actorStaffId: staff.id,
        actorRole: staff.role, now: new Date().toISOString() });
    return { changed, queue: await repository.readStaffStatus(new Date().toISOString()).then((status) => status.queue) };
}

async function cancelJob(request, environment, staff, jobId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    if (Object.keys(await readJsonBody(request, 256)).length) {
        throw new ApiError(400, 'INVALID_PRINT_INPUT', 'İstek gövdesi boş olmalıdır.');
    }
    const repository = createPrintRepository(environment.DB);
    const job = await repository.findStaffJobControlState(jobId);
    if (!job) throw new ApiError(404, 'PRINT_JOB_NOT_FOUND', 'Yazdırma işi bulunamadı.');
    if (!['uploading', 'queued'].includes(job.status) || job.runner_id || job.lease_token_hash
        || job.submission_started_at || job.cleanup_status !== 'none') {
        throw new ApiError(409, 'PRINT_JOB_NOT_CANCELLABLE', 'Agent tarafından alınmış veya yazdırma aşamasındaki iş güvenle iptal edilemez.');
    }
    if (!await repository.cancelJob({ id: jobId, expectedStatus: job.status, actorStaffId: staff.id,
        actorRole: staff.role, now: new Date().toISOString() })) {
        throw new ApiError(409, 'PRINT_JOB_NOT_CANCELLABLE', 'İş bu sırada değişti. Durumu yenileyip tekrar kontrol edin.');
    }
    return { job_id: jobId, status: 'cancelled' };
}

/** Routes authenticated staff print management and staff-file submissions. */
export async function handleStaffPrintRequest(request, environment) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/staff/print/management') return readManagement(request, environment);
    if (pathname === '/api/staff/print/history') return readHistory(request, environment);
    if (pathname === '/api/staff/print/upload-intents') {
        const staff = await requireStaff(request, environment, ['reviewer', 'admin']);
        return createStaffPrintUploadIntent(request, environment, staff);
    }
    if (pathname === '/api/staff/print/queue/pause' || pathname === '/api/staff/print/queue/resume') {
        const staff = await requireStaff(request, environment, ['admin']);
        return setQueueState(request, environment, staff, pathname.endsWith('/pause'));
    }
    const finalizeMatch = pathname.match(/^\/api\/staff\/print\/jobs\/([0-9a-f-]{36})\/finalize$/i);
    if (finalizeMatch) {
        const staff = await requireStaff(request, environment, ['reviewer', 'admin']);
        return finalizeStaffPrintUpload(request, environment, finalizeMatch[1], staff);
    }
    const cancelMatch = pathname.match(/^\/api\/staff\/print\/jobs\/([0-9a-f-]{36})\/cancel$/i);
    if (cancelMatch) {
        const staff = await requireStaff(request, environment, ['admin']);
        return cancelJob(request, environment, staff, cancelMatch[1]);
    }
    throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
}
