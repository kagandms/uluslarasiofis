/**
 * Client-side YÖKSİS İkamet İşlemleri Excel parser, validator and chunked uploader.
 * Pure normalization logic is separated from SheetJS workbook access so it can be unit-tested in Node.
 */

/** Session storage key used to persist interrupted Excel import batches for resume. */
export const IMPORT_PENDING_STORAGE_KEY = 'staff-yoksis-audit-import-pending-v1';

/** Maximum accepted Excel file size in bytes (10 MB). */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum accepted data row count per Excel file. */
export const MAX_IMPORT_ROWS = 5000;

/** Default number of rows sent per `/import` HTTP request (contract 7.3). */
export const DEFAULT_IMPORT_CHUNK_SIZE = 50;

const IMPORT_ENDPOINT = '/api/staff/yoksis-document-audit/import';
const STALE_EXPORT_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const FORBIDDEN_HEADER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const HEADER_FIELD_MAP = new Map([
    ['e ikamet basvuru no', 'applicationNumber'],
    ['ogrenci no', 'studentNumber'],
    ['ad soyad', 'fullName'],
    ['birim', 'unit'],
    ['program', 'program'],
    ['islem turu', 'processType'],
    ['gocnet kayit no', 'gocNetRecordNo'],
    ['kayit tarihi', 'recordDate'],
    ['goc durumu', 'gocStatus'],
    ['eksik belge son tarih', 'missingDeadline'],
    ['eksik belge aciklamasi', 'missingNote'],
    ['goc son sorgu tarihi', 'gocLastQueryAt']
]);

const REQUIRED_HEADERS = [
    ['applicationNumber', 'E-İkamet Başvuru No'],
    ['studentNumber', 'Öğrenci No'],
    ['fullName', 'Ad Soyad'],
    ['gocStatus', 'Göç Durumu']
];

function normalizeHeader(value) {
    return String(value ?? '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isValidCalendarDate(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function parseTurkishDateToIso(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function cleanSingleLineText(value) {
    return String(value ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function compareGocNetRecordNo(a, b) {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (left === right) return 0;
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
        const leftBig = BigInt(left);
        const rightBig = BigInt(right);
        return leftBig > rightBig ? 1 : (leftBig < rightBig ? -1 : 0);
    }
    return left > right ? 1 : -1;
}

function isIncomingTransactionNewer(existing, incoming) {
    const existingDate = existing.recordDateIso || '';
    const incomingDate = incoming.recordDateIso || '';
    if (incomingDate !== existingDate) {
        return incomingDate > existingDate;
    }
    return compareGocNetRecordNo(incoming.gocNetRecordNo, existing.gocNetRecordNo) > 0;
}

function createNullProtoRow(fields) {
    const row = Object.create(null);
    row.applicationNumber = fields.applicationNumber;
    row.studentNumber = fields.studentNumber;
    row.fullName = fields.fullName;
    row.unit = fields.unit;
    row.program = fields.program;
    row.processType = fields.processType;
    row.transactionCount = fields.transactionCount;
    row.gocStatus = fields.gocStatus;
    row.missingDeadline = fields.missingDeadline;
    row.missingNote = fields.missingNote;
    row.gocLastQueryAt = fields.gocLastQueryAt;
    return row;
}

function createImportId() {
    const randomPart = globalThis.crypto?.randomUUID?.()?.replace(/[^A-Za-z0-9_-]/g, '')
        || Math.random().toString(36).slice(2, 12);
    return `excel-${Date.now()}-${randomPart}`.slice(0, 128);
}

/**
 * Extracts `YYYY-MM-DD HH:mm` from a YÖKSİS export filename (`Ikamet_Islemleri_YYYYMMDD_HHmm.xls`).
 * @param {string} fileName Excel file name.
 * @returns {string|null} Formatted timestamp or `null` when absent or invalid.
 */
export function parseExportedAtFromFileName(fileName) {
    const text = String(fileName || '');
    const match = text.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59) return null;
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

/**
 * Returns true when the given `exportedAt` timestamp (`YYYY-MM-DD HH:mm`) is older than 24 hours.
 * @param {string|null|undefined} exportedAt Export timestamp string.
 * @param {number} [nowMs=Date.now()] Reference timestamp in milliseconds.
 * @returns {boolean} True if older than 24 hours.
 */
export function isExportedAtStale(exportedAt, nowMs = Date.now()) {
    if (typeof exportedAt !== 'string') return false;
    const match = exportedAt.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59) return false;
    const exportedMs = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
    return Number.isFinite(exportedMs) && (nowMs - exportedMs) > STALE_EXPORT_THRESHOLD_MS;
}

/**
 * Formats an ISO calendar date (`YYYY-MM-DD`) as `GG.AA.YYYY` with remaining days in Turkish.
 * @param {string|null|undefined} isoDate ISO date string.
 * @param {number} [nowMs=Date.now()] Reference timestamp in milliseconds.
 * @returns {string} Formatted deadline text or empty string when invalid.
 */
export function formatDeadlineWithRemaining(isoDate, nowMs = Date.now()) {
    if (typeof isoDate !== 'string') return '';
    const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidCalendarDate(year, month, day)) return '';
    const nowDate = new Date(nowMs);
    const todayUtc = Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    const targetUtc = Date.UTC(year, month - 1, day);
    const diffDays = Math.round((targetUtc - todayUtc) / (24 * 60 * 60 * 1000));
    const display = `${match[3]}.${match[2]}.${match[1]}`;
    if (diffDays > 0) return `${display} (${diffDays} gün kaldı)`;
    if (diffDays === 0) return `${display} (bugün son gün)`;
    return `${display} (süresi geçti)`;
}

/**
 * Formats the latest finalized Excel import metadata into the UI status line.
 * @param {{ uploadedAt?: string, uploadedBy?: string, rowCount?: number }|null} latest Latest import response.
 * @returns {string} Turkish summary line.
 */
export function formatLatestImportLine(latest) {
    if (!latest || typeof latest !== 'object') {
        return 'Son yükleme: Henüz Excel yüklenmedi';
    }
    const date = new Date(latest.uploadedAt || '');
    let formattedDate = String(latest.uploadedAt || '—');
    if (Number.isFinite(date.getTime())) {
        try {
            const parts = new Intl.DateTimeFormat('tr-TR', {
                timeZone: 'Europe/Istanbul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).formatToParts(date);
            const get = (type) => parts.find((part) => part.type === type)?.value || '';
            formattedDate = `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
        } catch {
            const d = String(date.getDate()).padStart(2, '0');
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const y = date.getFullYear();
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            formattedDate = `${d}.${m}.${y} ${hh}:${mm}`;
        }
    }
    const person = String(latest.uploadedBy || 'Yetkili').trim() || 'Yetkili';
    const rowCount = Number.isSafeInteger(latest.rowCount) ? latest.rowCount : Number(latest.rowCount || 0);
    return `Son yükleme: ${formattedDate} · ${person} · ${rowCount} satır`;
}

/**
 * Reads the first worksheet of an Excel workbook into an array of arrays via SheetJS.
 * @param {object} XLSX SheetJS global object (`window.XLSX`).
 * @param {ArrayBuffer|Uint8Array} arrayBuffer Binary workbook contents.
 * @returns {Array<Array<unknown>>} Sheet rows as arrays.
 */
export function rowsFromWorkbook(XLSX, arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(bytes, { type: 'array' });
    const firstSheetName = workbook?.SheetNames?.[0];
    if (!firstSheetName || !workbook?.Sheets?.[firstSheetName]) return [];
    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
}

/**
 * Normalizes, validates and deduplicates raw worksheet rows according to contract 7.3.
 * @param {Array<Array<unknown>>} aoa Worksheet rows (row 0 is headers).
 * @param {string} [fileName=''] Original file name for extracting `exportedAt`.
 * @returns {{
 *   rows: Array<object>,
 *   rejected: Array<{ rowNumber: number, reason: string }>,
 *   mergedCount: number,
 *   totalRows: number,
 *   exportedAt: string|null,
 *   missingHeaders: Array<string>
 * }} Normalization result.
 */
export function normalizeYoksisRows(aoa, fileName = '') {
    const exportedAt = parseExportedAtFromFileName(fileName);
    if (!Array.isArray(aoa) || aoa.length === 0 || !Array.isArray(aoa[0])) {
        return {
            rows: [],
            rejected: [],
            mergedCount: 0,
            totalRows: 0,
            exportedAt,
            missingHeaders: REQUIRED_HEADERS.map(([, label]) => label)
        };
    }

    const headerRow = aoa[0];
    const fieldToIndex = new Map();
    for (let col = 0; col < headerRow.length; col += 1) {
        const rawHeader = String(headerRow[col] ?? '').trim();
        if (!rawHeader || FORBIDDEN_HEADER_KEYS.has(rawHeader)) continue;
        const normalized = normalizeHeader(rawHeader);
        if (!normalized || FORBIDDEN_HEADER_KEYS.has(normalized)) continue;
        const field = HEADER_FIELD_MAP.get(normalized);
        if (field && !fieldToIndex.has(field)) {
            fieldToIndex.set(field, col);
        }
    }

    const missingHeaders = REQUIRED_HEADERS
        .filter(([field]) => !fieldToIndex.has(field))
        .map(([, label]) => label);
    if (missingHeaders.length > 0) {
        return {
            rows: [],
            rejected: [],
            mergedCount: 0,
            totalRows: 0,
            exportedAt,
            missingHeaders
        };
    }

    const rejected = [];
    const mergedByApp = new Map();
    let totalRows = 0;
    let mergedCount = 0;

    for (let rowIndex = 1; rowIndex < aoa.length; rowIndex += 1) {
        const rawArray = aoa[rowIndex];
        if (!Array.isArray(rawArray)) continue;
        const isBlank = rawArray.every((cell) => String(cell ?? '').trim() === '');
        if (isBlank) continue;

        totalRows += 1;
        const rowNumber = rowIndex + 1;
        const cells = Object.create(null);
        for (const [field, colIndex] of fieldToIndex.entries()) {
            cells[field] = String(rawArray[colIndex] ?? '').trim();
        }

        const applicationNumber = cells.applicationNumber || '';
        if (!/^\d{4}-\d{2}-\d{7}$/.test(applicationNumber)) {
            rejected.push({ rowNumber, reason: 'Başvuru numarası biçimi geçersiz (YYYY-AA-NNNNNNN beklenir).' });
            continue;
        }

        const studentNumber = cells.studentNumber || '';
        if (!/^\d{8,14}$/.test(studentNumber)) {
            rejected.push({ rowNumber, reason: 'Öğrenci numarası 8 ile 14 rakam arasında olmalıdır.' });
            continue;
        }

        const fullName = cleanSingleLineText(cells.fullName);
        if (fullName.length < 1 || fullName.length > 240) {
            rejected.push({ rowNumber, reason: 'Ad soyad alanı 1 ile 240 karakter arasında olmalıdır.' });
            continue;
        }

        const gocStatus = cleanSingleLineText(cells.gocStatus);
        if (gocStatus.length < 1 || gocStatus.length > 300) {
            rejected.push({ rowNumber, reason: 'Göç durumu alanı 1 ile 300 karakter arasında olmalıdır.' });
            continue;
        }

        const unit = cleanSingleLineText(cells.unit);
        if (unit.length > 120) {
            rejected.push({ rowNumber, reason: 'Birim alanı en fazla 120 karakter olabilir.' });
            continue;
        }

        const program = cleanSingleLineText(cells.program);
        if (program.length > 160) {
            rejected.push({ rowNumber, reason: 'Program alanı en fazla 160 karakter olabilir.' });
            continue;
        }

        const processType = cleanSingleLineText(cells.processType) || 'Belirtilmedi';
        if (processType.length > 40) {
            rejected.push({ rowNumber, reason: 'İşlem türü alanı en fazla 40 karakter olabilir.' });
            continue;
        }

        const missingNote = cleanSingleLineText(cells.missingNote);
        if (missingNote.length > 1000) {
            rejected.push({ rowNumber, reason: 'Eksik belge açıklaması en fazla 1000 karakter olabilir.' });
            continue;
        }

        const missingDeadline = parseTurkishDateToIso(cells.missingDeadline);
        const gocLastQueryAt = parseTurkishDateToIso(cells.gocLastQueryAt);
        const recordDateIso = parseTurkishDateToIso(cells.recordDate) || '';
        const gocNetRecordNo = cells.gocNetRecordNo || '';

        const incoming = {
            applicationNumber,
            studentNumber,
            fullName,
            unit,
            program,
            processType,
            transactionCount: 1,
            gocStatus,
            missingDeadline,
            missingNote,
            gocLastQueryAt,
            recordDateIso,
            gocNetRecordNo
        };

        const existing = mergedByApp.get(applicationNumber);
        if (!existing) {
            mergedByApp.set(applicationNumber, incoming);
        } else {
            mergedCount += 1;
            const nextCount = existing.transactionCount + 1;
            if (isIncomingTransactionNewer(existing, incoming)) {
                mergedByApp.set(applicationNumber, {
                    ...incoming,
                    unit: incoming.unit || existing.unit,
                    program: incoming.program || existing.program,
                    fullName: incoming.fullName || existing.fullName,
                    transactionCount: nextCount
                });
            } else {
                existing.transactionCount = nextCount;
                if (!existing.unit && incoming.unit) existing.unit = incoming.unit;
                if (!existing.program && incoming.program) existing.program = incoming.program;
            }
        }
    }

    const rows = Array.from(mergedByApp.values(), (entry) => createNullProtoRow(entry));
    return { rows, rejected, mergedCount, totalRows, exportedAt, missingHeaders: [] };
}

/**
 * Validates file extension, size and row count, reads the workbook via SheetJS, and normalizes rows.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer Binary Excel contents.
 * @param {string} fileName Original Excel file name.
 * @param {{ XLSX?: object, size?: number }} [options] Optional SheetJS injection and explicit byte size.
 * @returns {{
 *   rows: Array<object>,
 *   rejected: Array<{ rowNumber: number, reason: string }>,
 *   mergedCount: number,
 *   totalRows: number,
 *   exportedAt: string|null,
 *   missingHeaders: Array<string>
 * }} Parsed and normalized import payload.
 */
export function parseYoksisExcel(arrayBuffer, fileName, { XLSX = globalThis.XLSX, size } = {}) {
    const safeName = String(fileName || '').trim();
    if (!/\.(xls|xlsx)$/i.test(safeName)) {
        throw new Error('Yalnız .xls veya .xlsx uzantılı Excel dosyaları yüklenebilir.');
    }
    const byteSize = typeof size === 'number' ? size : (arrayBuffer?.byteLength ?? 0);
    if (byteSize > MAX_IMPORT_FILE_BYTES) {
        throw new Error('Dosya boyutu 10 MB sınırını aşıyor.');
    }
    if (!XLSX || typeof XLSX.read !== 'function' || typeof XLSX.utils?.sheet_to_json !== 'function') {
        throw new Error('Excel okuyucu yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
    }
    const aoa = rowsFromWorkbook(XLSX, arrayBuffer);
    const result = normalizeYoksisRows(aoa, safeName);
    if (result.totalRows > MAX_IMPORT_ROWS) {
        throw new Error(`Dosya en fazla ${MAX_IMPORT_ROWS} satır içerebilir.`);
    }
    return result;
}

/**
 * Splits normalized rows into fixed-size batches for `/api/staff/yoksis-document-audit/import`.
 * @param {Array<object>} rows Normalized import rows.
 * @param {number} [chunkSize=50] Maximum rows per batch.
 * @returns {Array<Array<object>>} Array of row batches.
 */
export function chunkImportRows(rows, chunkSize = DEFAULT_IMPORT_CHUNK_SIZE) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : DEFAULT_IMPORT_CHUNK_SIZE;
    const chunks = [];
    for (let index = 0; index < rows.length; index += size) {
        chunks.push(rows.slice(index, index + size));
    }
    return chunks;
}

/**
 * Reads an interrupted Excel import state from session storage.
 * @param {Storage|null|undefined} storage Browser storage object.
 * @returns {{
 *   importId: string,
 *   exportedAt: string|null,
 *   batches: Array<Array<object>>,
 *   completedBatches: number,
 *   totalBatches: number,
 *   storedCount: number
 * }|null} Pending import state or `null`.
 */
export function readPendingImport(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
        const raw = storage.getItem(IMPORT_PENDING_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object'
            || typeof parsed.importId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.importId)
            || !Array.isArray(parsed.batches) || parsed.batches.length === 0) {
            return null;
        }
        return {
            importId: parsed.importId,
            exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
            batches: parsed.batches,
            completedBatches: Number.isSafeInteger(parsed.completedBatches) ? parsed.completedBatches : 0,
            totalBatches: Number.isSafeInteger(parsed.totalBatches) ? parsed.totalBatches : parsed.batches.length,
            storedCount: Number.isSafeInteger(parsed.storedCount) ? parsed.storedCount : 0
        };
    } catch {
        return null;
    }
}

/**
 * Saves or clears pending Excel import batches in session storage (safe against quota/security errors).
 * @param {Storage|null|undefined} storage Browser storage object.
 * @param {object|null} state Pending state to save, or `null` to clear.
 * @returns {boolean} True when persisted successfully.
 */
export function savePendingImport(storage, state) {
    if (!storage) return false;
    try {
        if (!state) {
            if (typeof storage.removeItem === 'function') {
                storage.removeItem(IMPORT_PENDING_STORAGE_KEY);
            }
            return true;
        }
        if (typeof storage.setItem !== 'function') return false;
        storage.setItem(IMPORT_PENDING_STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch {
        return false;
    }
}

/**
 * Clears any saved pending Excel import state from session storage.
 * @param {Storage|null|undefined} storage Browser storage object.
 */
export function clearPendingImport(storage) {
    savePendingImport(storage, null);
}

/**
 * Uploads normalized Excel rows in 50-row batches to `POST /api/staff/yoksis-document-audit/import`.
 * Sends `final: true` only on the last batch after all preceding batches succeed.
 * On failure, persists remaining batches under `IMPORT_PENDING_STORAGE_KEY` with the same `importId`.
 * @param {{
 *   rows?: Array<object>,
 *   batches?: Array<Array<object>>,
 *   exportedAt?: string|null,
 *   fetcher?: typeof fetch,
 *   importId?: string,
 *   onProgress?: (progress: { completedBatches: number, totalBatches: number, storedCount: number }) => void,
 *   storage?: Storage|null,
 *   startBatchIndex?: number,
 *   totalBatches?: number,
 *   initialStoredCount?: number
 * }} options Upload options.
 * @returns {Promise<{
 *   ok: boolean,
 *   importId: string,
 *   storedCount: number,
 *   rejected: Array<{ index: number, reason: string }>,
 *   completedBatches: number,
 *   totalBatches: number,
 *   remainingBatches: Array<Array<object>>,
 *   error?: string
 * }>} Upload outcome.
 */
export async function uploadYoksisImport({
    rows = [],
    batches: providedBatches,
    exportedAt = null,
    fetcher = globalThis.fetch,
    importId: providedImportId,
    onProgress,
    storage = null,
    startBatchIndex = 0,
    totalBatches: providedTotalBatches,
    initialStoredCount = 0
} = {}) {
    const importId = providedImportId || createImportId();
    const batches = Array.isArray(providedBatches) ? providedBatches : chunkImportRows(rows, DEFAULT_IMPORT_CHUNK_SIZE);
    const totalBatches = Number.isSafeInteger(providedTotalBatches)
        ? providedTotalBatches
        : startBatchIndex + batches.length;

    let completedBatches = startBatchIndex;
    let storedCount = initialStoredCount;
    const serverRejected = [];

    if (batches.length === 0) {
        clearPendingImport(storage);
        return {
            ok: true,
            importId,
            storedCount,
            rejected: serverRejected,
            completedBatches,
            totalBatches,
            remainingBatches: []
        };
    }

    if (typeof fetcher !== 'function') {
        const remainingBatches = batches.slice();
        savePendingImport(storage, {
            importId,
            exportedAt,
            batches: remainingBatches,
            completedBatches,
            totalBatches,
            storedCount
        });
        return {
            ok: false,
            importId,
            storedCount,
            rejected: serverRejected,
            completedBatches,
            totalBatches,
            remainingBatches,
            error: 'Sunucu bağlantısı bulunamadı.'
        };
    }

    for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const isLast = i === batches.length - 1;
        if (typeof onProgress === 'function') {
            onProgress({ completedBatches, totalBatches, storedCount });
        }

        try {
            const response = await fetcher(IMPORT_ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    importId,
                    exportedAt: exportedAt ?? null,
                    final: isLast,
                    rows: batch
                })
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            if (!response.ok) {
                const message = payload?.error?.message || `Yükleme başarısız oldu (HTTP ${response.status}).`;
                throw new Error(message);
            }

            storedCount += Number(payload?.storedCount || 0);
            if (Array.isArray(payload?.rejected)) {
                for (const item of payload.rejected) {
                    if (item && typeof item.reason === 'string') {
                        serverRejected.push({ index: Number(item.index ?? 0), reason: item.reason });
                    }
                }
            }
            completedBatches += 1;
            if (typeof onProgress === 'function') {
                onProgress({ completedBatches, totalBatches, storedCount });
            }
        } catch (error) {
            const remainingBatches = batches.slice(i);
            savePendingImport(storage, {
                importId,
                exportedAt,
                batches: remainingBatches,
                completedBatches,
                totalBatches,
                storedCount
            });
            return {
                ok: false,
                importId,
                storedCount,
                rejected: serverRejected,
                completedBatches,
                totalBatches,
                remainingBatches,
                error: error instanceof Error ? error.message : 'Aktarım sırasında bağlantı kesildi.'
            };
        }
    }

    clearPendingImport(storage);
    return {
        ok: true,
        importId,
        storedCount,
        rejected: serverRejected,
        completedBatches,
        totalBatches,
        remainingBatches: []
    };
}
