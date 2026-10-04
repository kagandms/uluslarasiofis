import { BlobWriter, ZipWriter } from '@zip.js/zip.js';

export const ARCHIVE_LIMITS = Object.freeze({
    streamedBytes: 150 * 1024 * 1024,
    blobBytes: 32 * 1024 * 1024,
    files: 15
});

function validateManifest(manifest, maxBytes) {
    if (!Array.isArray(manifest?.files)) throw new Error('Belge listesi güvenli biçimde doğrulanamadı.');
    if (manifest.files.length === 0) throw new Error('İndirilecek güvenli güncel belge bulunamadı.');
    if (manifest.files.length > ARCHIVE_LIMITS.files || !Number.isSafeInteger(manifest.total_source_bytes) || manifest.total_source_bytes < 0
        || manifest.total_source_bytes > maxBytes) {
        throw new Error('ZIP bu tarayıcı için büyük. Lütfen belgeleri ofis bilgisayarından indirin.');
    }
    let sum = 0;
    const names = new Set();
    for (const [index, file] of manifest.files.entries()) {
        const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.media_type];
        if (!/^[a-z0-9_]+$/.test(file.code) || !Number.isSafeInteger(file.expected_revision_number)
            || file.expected_revision_number < 1
            || !/^[a-f0-9]{64}$/.test(file.object_identity) || !Number.isSafeInteger(file.byte_size)
            || file.byte_size < 0 || file.entry_name !== `${String(index + 1).padStart(2, '0')}-${file.code}.${extension}`
            || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.media_type)
            || names.has(file.entry_name)) throw new Error('Belge listesi güvenli biçimde doğrulanamadı.');
        names.add(file.entry_name);
        sum += file.byte_size;
    }
    if (sum !== manifest.total_source_bytes) throw new Error('Belge listesi boyutları uyuşmuyor.');
}

function createByteGuard(expectedBytes, limits) {
    let fileBytes = 0;
    return new TransformStream({
        transform(chunk, controller) {
            fileBytes += chunk.byteLength;
            limits.totalBytes += chunk.byteLength;
            if (fileBytes > expectedBytes || limits.totalBytes > limits.maxBytes) {
                controller.error(new Error('Belge akışının boyutu sınırı aştı.'));
                return;
            }
            controller.enqueue(chunk);
        },
        flush(controller) {
            if (fileBytes !== expectedBytes) controller.error(new Error('Belge akışı eksik veya kesildi.'));
        }
    });
}

export function createArchiveFilename({ firstName, lastName, studentNumber } = {}) {
    const rawName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const source = rawName || (studentNumber ? String(studentNumber).trim() : '');
    if (!source) return 'basvuru-belgeleri.zip';
    const trMap = {
        'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i',
        'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'
    };
    const normalized = source
        .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (ch) => trMap[ch] || ch)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized ? `${normalized}.zip` : 'basvuru-belgeleri.zip';
}

function saveBlob(window, blob, filename = 'basvuru-belgeleri.zip') {
    const url = window.URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = filename;
    window.document.body.append(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

/** Creates a current-documents ZIP after validating every streamed byte. */
export async function downloadApplicationArchive({ applicationId, window, manifest, getManifest, fetchFile, signal, suggestedName = 'basvuru-belgeleri.zip' }) {
    const supportsStreaming = typeof window?.showSaveFilePicker === 'function' && window.isSecureContext !== false;
    const maxBytes = supportsStreaming ? ARCHIVE_LIMITS.streamedBytes : ARCHIVE_LIMITS.blobBytes;
    const abortController = new AbortController();
    const relayAbort = () => abortController.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener('abort', relayAbort, { once: true });
    let zipWriter;
    let writable;
    let completed = false;
    const limits = { maxBytes, totalBytes: 0 };
    try {
        const currentManifest = manifest ?? await getManifest(abortController.signal);
        if (abortController.signal.aborted) throw new DOMException('Canceled', 'AbortError');
        validateManifest(currentManifest, maxBytes);
        const selectedHandle = supportsStreaming ? await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'ZIP arşivi', accept: { 'application/zip': ['.zip'] } }]
        }) : null;
        if (supportsStreaming) {
            writable = await selectedHandle.createWritable();
            zipWriter = new ZipWriter(writable, { level: 0, signal: abortController.signal });
        } else {
            zipWriter = new ZipWriter(new BlobWriter('application/zip'), { level: 0, signal: abortController.signal });
        }
        for (const file of currentManifest.files) {
            const response = await fetchFile(applicationId, file, abortController.signal);
            if (!response.ok || !response.body) throw new Error('Bir belge güvenli biçimde indirilemedi. ZIP iptal edildi.');
            const guardedStream = response.body.pipeThrough(createByteGuard(file.byte_size, limits));
            await zipWriter.add(file.entry_name, guardedStream, {
                compressionMethod: 0, level: 0, uncompressedSize: file.byte_size
            });
        }
        if (limits.totalBytes !== currentManifest.total_source_bytes) throw new Error('İndirilen belge boyutları uyuşmuyor. ZIP iptal edildi.');
        const blob = await zipWriter.close();
        completed = true;
        if (!supportsStreaming) saveBlob(window, blob, suggestedName);
        return { status: 'saved' };
    } catch (error) {
        abortController.abort();
        if (!completed) {
            try { await zipWriter?.terminate(); } catch { /* Writer may already be closed. */ }
            try { await writable?.abort(error); } catch { /* Preserve the original archive error. */ }
        }
        throw error;
    } finally {
        signal?.removeEventListener('abort', relayAbort);
    }
}
