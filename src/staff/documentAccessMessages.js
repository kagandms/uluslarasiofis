const DOCUMENT_ACCESS_MESSAGES = Object.freeze({
    pending: 'Belge güvenlik kontrolü bekleniyor.',
    unsafe: 'Belge güvenli bulunmadı ve erişime kapatıldı.',
    failed: 'Belge güvenlik kontrolü tamamlanamadı.'
});

/**
 * Returns a safe explanation for a document denied by the existing access policy.
 * @param {{scan_status?: string|null}|null|undefined} item Current document status from the staff DTO.
 * @returns {string} User-facing explanation without exposing storage details.
 */
export function readDocumentAccessMessage(item) {
    return DOCUMENT_ACCESS_MESSAGES[item?.scan_status]
        || 'Belge güvenli erişime uygun değil.';
}
