import { createArchiveFilename, downloadApplicationArchive } from './applicationArchive.js';

/**
 * Temporary staff-only bulk export of applications sent to the Göç İdaresi.
 * The button is hidden after this instant. Staff session checks remain the access control.
 */
export const MIGRATION_BULK_EXPORT_AVAILABLE_UNTIL = '2026-11-30T23:59:59+03:00';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const SUMMARY_PREFIX = 'goc-indirme-ozeti';

/** @param {Date} [now] Current time. @returns {boolean} True while the temporary export button may be shown. */
export function isMigrationBulkExportAvailable(now = new Date()) {
    return now.getTime() <= Date.parse(MIGRATION_BULK_EXPORT_AVAILABLE_UNTIL);
}

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

/**
 * Saves one ZIP per application into the chosen folder, then a JSON summary of every outcome.
 * Applications that fail a document gate are reported and skipped; the export continues.
 * @param {object} options Export inputs.
 * @param {{createArchiveManifest: Function, readArchiveFile: Function}} options.api Staff API client.
 * @param {FileSystemDirectoryHandle} options.directory Folder selected by staff.
 * @param {Window} options.window Browser window used for archive streaming.
 * @param {Array<object>} options.applications Applications from listSentToMigrationApplications.
 * @param {AbortSignal} [options.signal] Stops after the current application.
 * @param {(progress: {index: number, total: number}) => void} [options.onProgress] Progress callback.
 * @param {Date} [options.now] Clock for the summary.
 * @returns {Promise<{saved: number, failed: number, summary_file: string, entries: Array<object>}>} Totals.
 */
export async function runMigrationBulkExport({ api, directory, window, applications, signal, onProgress = () => {}, now = new Date() }) {
    const usedNames = new Set();
    const entries = [];
    for (const [index, application] of applications.entries()) {
        if (signal?.aborted) break;
        onProgress({ index, total: applications.length });
        const fileName = createBulkArchiveFilename(application, usedNames);
        const entry = {
            student_number: application.student_number ?? '',
            name: [application.first_name, application.last_name].filter(Boolean).join(' '),
            zip_file: fileName, status: 'failed', files: 0, bytes: 0, reason: null
        };
        entries.push(entry);
        try {
            if (await fileExists(directory, fileName)) {
                throw new Error('Aynı adlı dosya klasörde zaten var; üzerine yazılmadı.');
            }
            const manifest = await api.createArchiveManifest(application.id, signal);
            await downloadApplicationArchive({
                applicationId: application.id,
                window,
                manifest,
                fetchFile: (applicationId, file, requestSignal) => api.readArchiveFile(applicationId, file, requestSignal),
                signal,
                suggestedName: fileName,
                targetDirectory: directory
            });
            entry.status = 'saved';
            entry.files = manifest.files.length;
            entry.bytes = manifest.total_source_bytes;
        } catch (error) {
            if (error?.name === 'AbortError') {
                entry.reason = 'İndirme iptal edildi.';
                break;
            }
            entry.reason = typeof error?.message === 'string' ? error.message : 'Bilinmeyen hata.';
        }
    }
    const saved = entries.filter((entry) => entry.status === 'saved').length;
    const requested = applications.length;
    const report = {
        generated_at: now.toISOString(),
        available_until: MIGRATION_BULK_EXPORT_AVAILABLE_UNTIL,
        requested,
        processed: entries.length,
        not_attempted: requested - entries.length,
        saved,
        failed: entries.length - saved,
        success_percent: requested === 0 ? 0 : Math.round((saved / requested) * 1000) / 10,
        entries
    };
    const summaryFile = await writeSummary(directory, report);
    return {
        saved,
        failed: report.failed,
        summary_file: summaryFile,
        report,
        failed_entries: entries.filter((entry) => entry.status !== 'saved')
    };
}
