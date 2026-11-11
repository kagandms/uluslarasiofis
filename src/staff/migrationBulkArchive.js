import { createArchiveFilename, downloadApplicationArchive } from './applicationArchive.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const SUMMARY_PREFIX = 'goc-indirme-ozeti';

/** Attempts per application: the first try plus two retries with these waits. */
export const BULK_EXPORT_RETRY_DELAYS_MS = Object.freeze([2000, 5000]);

/**
 * Collects every application in the Göç filter whose status is exactly sent_to_migration.
 * @param {{queryApplications: Function}} api Staff API client.
 * @param {AbortSignal} [signal] Cancels paging.
 * @returns {Promise<Array<{id: string, student_number: string, first_name: string, last_name: string}>>} Applications.
 */
export async function listSentToMigrationApplications(api, signal) {
    const applications = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
        const result = await api.queryApplications({ q: '', status: 'migration', from_date: '', to_date: '', page, page_size: PAGE_SIZE });
        if (!Array.isArray(result?.items) || !Number.isSafeInteger(result?.pagination?.total_pages)) {
            throw new Error('Başvuru listesi okunamadı. Listeyi yenileyip tekrar deneyin.');
        }
        applications.push(...result.items.filter((item) => item.status === 'sent_to_migration'));
        if (page >= result.pagination.total_pages) return applications;
    }
    throw new Error('Göç listesi beklenenden büyük. İndirme başlatılmadı.');
}

/**
 * Builds a collision-free ZIP name from the student number and the existing safe archive name.
 * @param {{student_number?: string, first_name?: string, last_name?: string}} application Queue item.
 * @param {Set<string>} usedNames Names already assigned in this export; updated in place.
 * @returns {string} File name ending in .zip.
 */
export function createBulkArchiveFilename(application, usedNames) {
    const stem = createArchiveFilename({
        firstName: application.first_name,
        lastName: application.last_name,
        studentNumber: application.student_number
    }).replace(/\.zip$/, '');
    const studentPart = String(application.student_number ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    const base = studentPart ? `${studentPart}-${stem}` : stem;
    let candidate = `${base}.zip`;
    for (let suffix = 2; usedNames.has(candidate); suffix += 1) candidate = `${base}-${suffix}.zip`;
    usedNames.add(candidate);
    return candidate;
}

async function fileExists(directory, name) {
    try {
        await directory.getFileHandle(name);
        return true;
    } catch (error) {
        if (error?.name === 'NotFoundError') return false;
        throw error;
    }
}

async function writeSummary(directory, summary) {
    const stamp = summary.generated_at.replace(/[:.]/g, '-');
    const handle = await directory.getFileHandle(`${SUMMARY_PREFIX}-${stamp}.json`, { create: true });
    const writer = (await handle.createWritable()).getWriter();
    await writer.write(JSON.stringify(summary, null, 2));
    await writer.close();
    return handle.name;
}

/** Client-side rejections and 4xx answers will not change on retry; network, 409, 429 and 5xx may. */
function isRetryableError(error) {
    if (error?.name === 'AbortError') return false;
    return ![400, 401, 403, 404].includes(error?.status);
}

function describeError(error) {
    const message = typeof error?.message === 'string' && error.message ? error.message : 'Bilinmeyen hata.';
    if (error?.status === undefined) return message;
    return error.status === 0 ? `${message} (ağ hatası)` : `${message} (HTTP ${error.status})`;
}

function waitBeforeRetry(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Canceled', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Canceled', 'AbortError'));
        }, { once: true });
    });
}

/**
 * Saves one ZIP per application into the chosen folder, then a JSON summary of every outcome.
 * Applications that fail are retried for transient errors, reported, and skipped; the export continues.
 * @param {object} options Export inputs.
 * @param {{createArchiveManifest: Function, readArchiveFile: Function}} options.api Staff API client.
 * @param {FileSystemDirectoryHandle} options.directory Folder selected by staff.
 * @param {Window} options.window Browser window used for archive streaming.
 * @param {Array<object>} options.applications Applications from listSentToMigrationApplications.
 * @param {AbortSignal} [options.signal] Stops after the current application.
 * @param {(progress: object) => void} [options.onProgress] Progress callback with application and document counts.
 * @param {number[]} [options.retryDelaysMs] Waits before each retry; the default is BULK_EXPORT_RETRY_DELAYS_MS.
 * @param {Date} [options.now] Clock for the summary.
 * @returns {Promise<{saved: number, failed: number, summary_file: string, report: object, failed_entries: Array<object>}>} Totals.
 */
export async function runMigrationBulkExport({
    api, directory, window, applications, signal, onProgress = () => {},
    retryDelaysMs = BULK_EXPORT_RETRY_DELAYS_MS, now = new Date()
}) {
    const usedNames = new Set();
    const entries = [];
    let savedSoFar = 0;
    let savedDocuments = 0;
    for (const [index, application] of applications.entries()) {
        if (signal?.aborted) break;
        const fileName = createBulkArchiveFilename(application, usedNames);
        const entry = {
            student_number: application.student_number ?? '',
            name: [application.first_name, application.last_name].filter(Boolean).join(' '),
            zip_file: fileName, status: 'failed', files: 0, bytes: 0, attempts: 0, reason: null
        };
        entries.push(entry);
        const report = (phase, extra = {}) => {
            const done = phase === 'done' ? entries.length : entries.length - 1;
            onProgress({
                phase, index, total: applications.length, name: entry.name,
                done, saved: savedSoFar, failed: done - savedSoFar,
                documents_saved: savedDocuments, ...extra
            });
        };
        report('start');
        try {
            if (await fileExists(directory, fileName)) {
                throw new Error('Aynı adlı dosya klasörde zaten var; üzerine yazılmadı.');
            }
        } catch (error) {
            entry.reason = describeError(error);
            report('done');
            continue;
        }
        let aborted = false;
        for (let attempt = 1; ; attempt += 1) {
            entry.attempts = attempt;
            try {
                const manifest = await api.createArchiveManifest(application.id, signal);
                let fileDone = 0;
                report('files', { file_done: 0, file_total: manifest.files.length });
                await downloadApplicationArchive({
                    applicationId: application.id,
                    window,
                    manifest,
                    fetchFile: (applicationId, file, requestSignal) => {
                        const response = api.readArchiveFile(applicationId, file, requestSignal);
                        fileDone += 1;
                        report('files', { file_done: fileDone, file_total: manifest.files.length });
                        return response;
                    },
                    signal,
                    suggestedName: fileName,
                    targetDirectory: directory
                });
                entry.status = 'saved';
                entry.files = manifest.files.length;
                entry.bytes = manifest.total_source_bytes;
                entry.reason = null;
                savedSoFar += 1;
                savedDocuments += manifest.files.length;
                break;
            } catch (error) {
                if (error?.name === 'AbortError') {
                    entry.reason = 'İndirme iptal edildi.';
                    aborted = true;
                    break;
                }
                entry.reason = describeError(error);
                const retryDelay = retryDelaysMs[attempt - 1];
                if (!isRetryableError(error) || retryDelay === undefined) break;
                report('retry', { attempt: attempt + 1, retry_in_ms: retryDelay });
                try {
                    await waitBeforeRetry(retryDelay, signal);
                } catch {
                    entry.reason = 'İndirme iptal edildi.';
                    aborted = true;
                    break;
                }
            }
        }
        report('done');
        if (aborted) break;
    }
    const saved = entries.filter((entry) => entry.status === 'saved').length;
    const requested = applications.length;
    const summary = {
        generated_at: now.toISOString(),
        requested,
        processed: entries.length,
        not_attempted: requested - entries.length,
        saved,
        failed: entries.length - saved,
        success_percent: requested === 0 ? 0 : Math.round((saved / requested) * 1000) / 10,
        entries
    };
    const summaryFile = await writeSummary(directory, summary);
    return {
        saved,
        failed: summary.failed,
        summary_file: summaryFile,
        report: summary,
        failed_entries: entries.filter((entry) => entry.status !== 'saved')
    };
}
