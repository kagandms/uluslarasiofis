/** Creates the same owner-safe application PDF control for student and staff views. */
export function createApplicationPdfDownloadControl(document, application, messages, className = '', options = {}) {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    const status = document.createElement('p');
    wrapper.className = `application-pdf-download-control ${className}`.trim();
    button.type = 'button';
    const isStaff = className.includes('staff-');
    button.className = isStaff ? 'btn btn-primary' : 'application-button application-button-primary';
    button.dataset.action = 'download-application-pdf';
    const labelKey = !isStaff && messages.downloadApplicationPdfRequired ? 'downloadApplicationPdfRequired' : 'downloadApplicationPdf';
    button.dataset.i18n = labelKey;
    button.textContent = messages[labelKey];
    if (!isStaff && messages.applicationPdfRequiredNote) {
        const note = document.createElement('p');
        note.className = 'application-pdf-required-note';
        note.dataset.i18n = 'applicationPdfRequiredNote';
        note.textContent = messages.applicationPdfRequiredNote;
        wrapper.append(note);
    }
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
            const pdfApplication = typeof options.resolveApplication === 'function'
                ? await options.resolveApplication() : application;
            const { downloadOnlineApplicationPdf } = await import('../services/onlineApplicationPdf.js');
            await downloadOnlineApplicationPdf(pdfApplication, document);
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
