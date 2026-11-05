const BLOCKED_SCAN_STATUSES = new Set(['pending', 'unsafe', 'failed']);

async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Reads the current, clean application documents pinned by the archive manifest. */
export async function readApplicationDocumentFiles({ applicationId, api, signal }) {
    const detail = await api.readApplicationDetail(applicationId, signal);
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    if (detail?.application?.id !== applicationId || detail.application.status === 'draft' || !detail.application.submitted_at) {
        throw new Error('Yalnızca gönderilmiş başvuruların evrakları aktarılabilir.');
    }
    const blockedDocument = detail.documents?.find((item) => item.revision_number
        && BLOCKED_SCAN_STATUSES.has(item.scan_status));
    if (blockedDocument) throw new Error(`“${blockedDocument.filename || blockedDocument.code}” güvenlik taramasından geçmedi.`);

    const manifest = await api.createArchiveManifest(applicationId, signal);
    if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
        throw new Error('Birleştirilecek güncel ve güvenli evrak bulunamadı.');
    }
    const filesByCode = new Map(manifest.files.map((file) => [file.code, file]));
    const missingRequired = detail.documents?.find((item) => item.required
        && (!item.access_available || !filesByCode.has(item.code)));
    if (missingRequired) throw new Error(`Zorunlu belge “${missingRequired.filename || missingRequired.code}” güncel ve güvenli değil.`);
    if (manifest.files.length > 30) throw new Error('PDF için en fazla 30 evrak birleştirilebilir.');

    const files = [];
    for (const file of manifest.files) {
        if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
        const response = await api.readArchiveFile(applicationId, file, signal);
        if (!response.ok || !response.body) throw new Error(`“${file.entry_name}” güvenli biçimde alınamadı; PDF oluşturulmadı.`);
        const blob = await response.blob();
        if (blob.size !== file.byte_size) throw new Error(`“${file.entry_name}” boyutu doğrulanamadı; PDF oluşturulmadı.`);
        files.push(new File([blob], file.entry_name, { type: file.media_type }));
    }
    const manifestFingerprint = await sha256(manifest.files.map((file) => [file.code, file.expected_revision_number,
        file.object_identity, file.media_type, file.byte_size].join('|')).join('\n'));
    return { application: detail.application, manifest, manifestFingerprint, files };
}
