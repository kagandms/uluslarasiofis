function textElement(tagName, text) {
    const element = document.createElement(tagName);
    element.textContent = text;
    return element;
}

function formatHeartbeat(value) {
    if (!value) return 'Henüz bağlantı yok';
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.valueOf()) ? 'Bilinmiyor' : timestamp.toLocaleString('tr-TR');
}

function renderStatus(statusElement, detailsElement, payload) {
    const printer = payload.printer || {};
    statusElement.textContent = printer.online ? 'Yazıcı çevrimiçi' : 'Yazıcı çevrimdışı';
    detailsElement.replaceChildren();
    const fields = [
        ['Yazıcı', printer.printer_name || 'Tanımlı değil'],
        ['Son bağlantı', formatHeartbeat(printer.seen_at)],
        ['İşleyici', printer.runner_id || 'Bağlı değil'],
        ...payload.jobs.map((job) => [job.status, String(job.count)])
    ];
    for (const [label, value] of fields) {
        const term = textElement('dt', label);
        const description = textElement('dd', value);
        detailsElement.append(term, description);
    }
}

export function initializeStaffPrintStatus(root = document) {
    const statusElement = root.getElementById('print-staff-status');
    const detailsElement = root.getElementById('print-staff-details');
    const refreshButton = root.getElementById('print-staff-refresh');
    if (!statusElement || !detailsElement || !refreshButton) return;
    let isLoading = false;

    const loadStatus = async () => {
        if (isLoading) return;
        isLoading = true;
        refreshButton.disabled = true;
        try {
            const response = await fetch('/api/staff/print/status', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error('status_unavailable');
            renderStatus(statusElement, detailsElement, await response.json());
        } catch {
            statusElement.textContent = 'Yazdırma durumu yüklenemedi.';
            detailsElement.replaceChildren();
        } finally {
            isLoading = false;
            refreshButton.disabled = false;
        }
    };

    refreshButton.addEventListener('click', () => void loadStatus());
    document.addEventListener('workspace:view-changed', (event) => {
        if (event.detail?.viewName === 'print') void loadStatus();
    });
}
