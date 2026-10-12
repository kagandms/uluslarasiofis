/** Opens the PDF tab during the user's click, before asynchronous registration.
 * @param {Window} browser Staff browser. @returns {Window|null} Reserved tab or a blocked popup.
 */
export function reservePhysicalReceiptPreview(browser) {
    const preview = browser.open('', '_blank');
    if (!preview) return null;
    preview.opener = null;
    preview.document.title = 'Bilgilendirme PDF’i hazırlanıyor';
    preview.document.body.textContent = 'Öğrenci kaydı ve bilgilendirme PDF’i hazırlanıyor…';
    return preview;
}

/** Opens and downloads the same stored A4 without starting a printer job.
 * @param {object} options Document, reserved tab, intake and ready receipt.
 * @returns {object} Authenticated fallback links and preview availability.
 */
export function deliverPhysicalReceiptPdf(options) {
    const base = `/api/staff/physical-intakes/${encodeURIComponent(options.intake.id)}/receipts/${encodeURIComponent(options.receipt.id)}`;
    const previewUrl = `${base}?preview=1`;
    const downloadUrl = `${base}?download=1`;
    const hasPreview = Boolean(options.preview && !options.preview.closed);
    const targetUrl = options.blobUrl || previewUrl;
    if (hasPreview) {
        try { options.preview.location.replace(targetUrl); }
        catch { options.preview.location.href = targetUrl; }
    }
    const shouldDownload = Boolean(options.autoDownload ?? !hasPreview);
    if (shouldDownload) {
        const link = options.document.createElement('a');
        link.href = options.blobUrl || downloadUrl;
        link.download = `${options.intake.tracking_reference}.pdf`;
        link.hidden = true;
        options.document.body.append(link);
        link.click();
        link.remove();
    }
    return { previewUrl, downloadUrl, hasPreview };
}
