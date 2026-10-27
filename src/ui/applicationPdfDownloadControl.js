/** Creates the same owner-safe application PDF control for student and staff views. */
export function createApplicationPdfDownloadControl(document, application, messages, className = '') {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    const status = document.createElement('p');
    wrapper.className = `application-pdf-download-control ${className}`.trim();
    button.type = 'button';
    button.className = className.includes('staff-') ? 'btn btn-primary' : 'application-button application-button-secondary';
    button.dataset.action = 'download-application-pdf';
    button.dataset.i18n = 'downloadApplicationPdf';
    button.textContent = messages.downloadApplicationPdf;
    status.className = 'application-pdf-download-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        status.hidden = false;
        status.textContent = messages.applicationPdfPreparing;
        try {
            const { downloadOnlineApplicationPdf } = await import('../services/onlineApplicationPdf.js');
            await downloadOnlineApplicationPdf(application, document);
            status.textContent = messages.applicationPdfReady;
        } catch {
            status.textContent = messages.applicationPdfFailed;
        } finally {
            button.disabled = false;
        }
    });
    wrapper.append(button, status);
    return wrapper;
}
