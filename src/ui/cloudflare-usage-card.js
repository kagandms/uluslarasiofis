const PREFERENCE_KEY = 'cloudflare-usage-card-open';
const REFRESH_COOLDOWN_MS = 30_000;
const LABELS = {
    workers_requests: 'Workers istekleri',
    d1_rows_read: 'D1 okunan satır',
    d1_rows_written: 'D1 yazılan satır',
    d1_largest_db_bytes: 'D1 en büyük veritabanı',
    d1_total_bytes: 'D1 toplam depolama',
    r2_class_a: 'R2 yazma/listeleme (A)',
    r2_class_b: 'R2 okuma (B)',
    r2_storage_bytes: 'R2 depolama'
};
const PERIOD_TEXT = { day: 'günlük', month: 'aylık', now: 'anlık' };
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

/**
 * Wires the collapsible Cloudflare usage card on the staff home.
 * @param {{root?: Document, fetcher?: typeof fetch}} options Page document and fetch implementation.
 * @returns {void} Does nothing when the card is absent; requests data only once it is opened.
 */
export function initCloudflareUsageCard({ root = document, fetcher = fetch } = {}) {
    const card = root.getElementById('cloudflare-usage-card');
    const toggle = root.getElementById('cloudflare-usage-toggle');
    const panel = root.getElementById('cloudflare-usage-panel');
    if (!card || !toggle || !panel) return;
    const summary = card.querySelector('#cloudflare-usage-summary');
    const list = card.querySelector('#cloudflare-usage-list');
    const stamp = card.querySelector('#cloudflare-usage-retrieved');
    const refresh = card.querySelector('#cloudflare-usage-refresh');
    let open = readPreference(root);
    let loading = false;
    let loaded = false;
    let lastRefreshAt = 0;

    const setOpen = (next) => {
        open = next;
        toggle.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
    };

    const renderUnavailable = () => {
        list.replaceChildren();
        if (summary) summary.textContent = 'alınamıyor';
        if (stamp) stamp.textContent = 'Kullanım verisi alınamıyor';
    };

    const render = (payload) => {
        const metrics = (Array.isArray(payload?.metrics) ? payload.metrics : []).filter((m) => m && typeof m.key === 'string' && m.limit > 0);
        if (!metrics.length) throw new Error('Invalid usage payload.');
        list.replaceChildren();
        let highest = null;
        for (const metric of metrics) {
            const available = metric.status === 'ok' && Number.isFinite(metric.value) && metric.value >= 0;
            const percent = available ? metric.value / metric.limit * 100 : null;
            if (available && (!highest || percent > highest.percent)) highest = { metric, percent };
            list.append(buildRow(root, metric, available, percent));
        }
        if (summary) summary.textContent = highest ? `${labelOf(highest.metric)} ${formatPercent(highest.percent)}` : 'alınamıyor';
        if (stamp) stamp.textContent = payload.retrievedAt ? `Alınma: ${formatTime(payload.retrievedAt)}` : '';
    };

    const load = () => {
        if (loading) return;
        loading = true;
        lastRefreshAt = Date.now();
        void Promise.resolve()
            .then(() => fetcher('/api/staff/admin/usage', { credentials: 'same-origin', cache: 'no-store' }))
            .then((response) => {
                if (!response.ok) throw new Error('Usage is unavailable.');
                return response.json();
            })
            .then((payload) => { render(payload); loaded = true; })
            .catch(() => renderUnavailable())
            .finally(() => { loading = false; });
    };

    toggle.addEventListener('click', () => {
        setOpen(!open);
        writePreference(root, open);
        if (open && !loaded && !loading) load();
    });
    refresh?.addEventListener('click', () => {
        if (loading || Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) return;
        load();
    });
    setOpen(open);
    if (open) load();
}

function labelOf(metric) {
    return LABELS[metric.key] || metric.key;
}

function buildRow(root, metric, available, percent) {
    const item = root.createElement('li');
    item.className = 'cf-usage-row';
    const head = root.createElement('div');
    head.className = 'cf-usage-row-head';
    const name = root.createElement('span');
    name.textContent = `${labelOf(metric)} · ${PERIOD_TEXT[metric.period] || ''}`.replace(/ · $/, '');
    const figures = root.createElement('span');
    figures.className = 'cf-usage-figures';
    const bar = root.createElement('span');
    bar.className = 'cf-usage-track';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', labelOf(metric));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(metric.limit));
    const fill = root.createElement('span');
    fill.className = 'cf-usage-fill';
    bar.append(fill);
    const isBytes = metric.key.endsWith('_bytes');
    const format = (n) => (isBytes ? formatBytes(n) : new Intl.NumberFormat('tr-TR').format(n));
    if (available) {
        bar.setAttribute('aria-valuenow', String(metric.value));
        fill.style.width = `${Math.min(percent, 100)}%`;
        figures.textContent = `${format(metric.value)} / ${format(metric.limit)} · ${formatPercent(percent)}`;
        if (percent >= 90) item.classList.add('is-danger');
        else if (percent >= 70) item.classList.add('is-warning');
    } else {
        fill.style.width = '0%';
        figures.textContent = 'alınamıyor';
        item.classList.add('is-unavailable');
    }
    head.append(name, figures);
    item.append(head, bar);
    if (available && Array.isArray(metric.detail) && metric.detail.length) {
        const detail = root.createElement('small');
        detail.className = 'cf-usage-detail';
        detail.textContent = metric.detail.map((d) => `DB ${d.name}: ${format(d.value)}`).join(' · ');
        item.append(detail);
    }
    return item;
}

function formatPercent(percent) {
    return `%${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(percent)}`;
}

function formatBytes(value) {
    let unit = 0;
    let scaled = value;
    while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) { scaled /= 1024; unit += 1; }
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: unit ? 1 : 0 }).format(scaled)} ${BYTE_UNITS[unit]}`;
}

function formatTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function readPreference(root) {
    try { return root.defaultView?.localStorage.getItem(PREFERENCE_KEY) === 'true'; } catch { return false; }
}

function writePreference(root, open) {
    try { root.defaultView?.localStorage.setItem(PREFERENCE_KEY, String(open)); } catch { /* preference is optional */ }
}
