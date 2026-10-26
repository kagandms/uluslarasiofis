const FALLBACK_LIMIT = 5_000_000;
const DEFAULT_STATUS = 'Cloudflare analitiği · günlük kullanım, UTC';
const UNAVAILABLE_STATUS = 'Kullanım verisi alınamıyor';
const HIDDEN_PREFERENCE_KEY = 'd1-usage-counter-hidden';

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
    const toggle = root.getElementById('d1-usage-toggle');
    const breakdown = widget.querySelector('#d1-usage-breakdown');
    const progress = widget.querySelector('[role="progressbar"]');
    let hidden = readHiddenPreference(root);
    let usage = null;
    let hasLoaded = false;
    let hasRequested = false;
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
        if (breakdown) {
            const databases = usage.databases;
            const hasValidBreakdown = Array.isArray(databases) && databases.length > 0
                && databases.every((database) => typeof database.databaseId === 'string'
                    && /^[a-f0-9-]{36}$/i.test(database.databaseId)
                    && Number.isSafeInteger(database.rowsRead) && database.rowsRead >= 0)
                && databases.reduce((total, database) => total + database.rowsRead, 0) === usage.rowsRead;
            breakdown.textContent = hasValidBreakdown
                ? [...databases].sort((left, right) => right.rowsRead - left.rowsRead)
                    .map((database) => `DB ${database.databaseId.slice(0, 8)}: ${numberFormat.format(database.rowsRead)}`).join(' · ')
                : '';
            breakdown.hidden = !hasValidBreakdown;
        }
    };

    const renderVisibility = () => {
        widget.hidden = hidden;
        if (!toggle) return;
        toggle.setAttribute('aria-expanded', String(!hidden));
        toggle.setAttribute('aria-label', hidden ? 'Sayacı göster' : 'Sayacı gizle');
        toggle.querySelector('svg path')?.setAttribute('d', hidden ? 'M5 9 12 16 19 9' : 'M5 15 12 8 19 15');
    };
    const loadUsage = () => {
        if (hasRequested) return;
        hasRequested = true;
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
    };

    render();
    renderVisibility();
    toggle?.addEventListener('click', () => {
        hidden = !hidden;
        renderVisibility();
        try {
            root.defaultView?.localStorage.setItem(HIDDEN_PREFERENCE_KEY, String(hidden));
        } catch {
            // Visibility remains usable for this page even when browser storage is unavailable.
        }
        if (!hidden) loadUsage();
    });
    if (!hidden) loadUsage();
}

function readHiddenPreference(root) {
    try {
        return root.defaultView?.localStorage.getItem(HIDDEN_PREFERENCE_KEY) === 'true';
    } catch {
        return false;
    }
}
