const FALLBACK_LIMIT = 5_000_000;
const DEFAULT_STATUS = 'Cloudflare analitiği · günlük kullanım, UTC';
const UNAVAILABLE_STATUS = 'Kullanım verisi alınamıyor';

/**
 * Loads and displays the staff homepage's daily D1 usage snapshot.
 * @param {{root?: Document, fetcher?: typeof fetch}} options Page document and fetch implementation.
 * @returns {void} Starts the usage request when the widget exists.
 */
export function initD1UsageCounter({ root = document, fetcher = fetch } = {}) {
    const widget = root.getElementById('d1-usage-counter');
    if (!widget) return;

    const value = widget.querySelector('#d1-usage-value');
    const percentage = widget.querySelector('#d1-usage-percent');
    const status = widget.querySelector('#d1-usage-status');
    const progress = widget.querySelector('[role="progressbar"]');
    let usage = null;
    let hasLoaded = false;
    const render = () => {
        const numberFormat = new Intl.NumberFormat('tr-TR');
        const limit = usage?.limit || FALLBACK_LIMIT;
        value.textContent = `${usage ? numberFormat.format(usage.rowsRead) : '—'} / ${numberFormat.format(limit)}`;
        if (percentage) percentage.textContent = usage
            ? `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usage.rowsRead / limit * 100)}%`
            : '—';
        if (!usage) {
            status.textContent = hasLoaded ? UNAVAILABLE_STATUS : DEFAULT_STATUS;
            return;
        }
        progress.setAttribute('aria-valuenow', String(usage.rowsRead));
        progress.setAttribute('aria-valuemax', String(limit));
        progress.style.setProperty('--d1-usage-progress', `${Math.min(usage.rowsRead / limit, 1) * 100}%`);
        status.textContent = `${usage.date} UTC`;
    };

    render();
    void fetcher('/api/staff/admin/d1-usage', { credentials: 'same-origin', cache: 'no-store' })
        .then((response) => {
            if (!response.ok) throw new Error('D1 usage is unavailable.');
            return response.json();
        })
        .then((payload) => {
            hasLoaded = true;
            if (!Number.isSafeInteger(payload.rowsRead) || payload.rowsRead < 0 || !Number.isSafeInteger(payload.limit) || payload.limit <= 0) {
                throw new Error('D1 usage response is invalid.');
            }
            usage = payload;
            render();
        })
        .catch(() => {
            hasLoaded = true;
            render();
        });
}
