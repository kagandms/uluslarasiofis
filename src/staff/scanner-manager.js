async function fetchScanner(path, options = {}) {
    const response = await fetch(`/api/staff/scanner/${path}`, { credentials: 'same-origin', ...options });
    if (!response.ok) throw new Error('Tarama durumu okunamadı.');
    return response.json();
}

function createScannerApi() {
    return {
        readStatus: () => fetchScanner('status'),
        retry: (jobId) => fetchScanner('retry', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId }) })
    };
}

function formatScanTime(isoString) {
    if (!isoString) return 'Henüz yok';
    try {
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return isoString;
        return date.toLocaleString('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return isoString;
    }
}

function readHostSummary(runners) {
    const latestRunner = runners[0];
    if (!latestRunner) return 'Tarama hostundan henüz sinyal alınmadı.';
    if (Date.now() - Date.parse(latestRunner.seen_at) > 120_000) return 'Tarama hostu çevrimdışı; işler kuyrukta korunuyor.';
    if (latestRunner.health !== 'ready' || !latestRunner.signature_updated_at
        || Date.now() - Date.parse(latestRunner.signature_updated_at) > 86_400_000) {
        return 'Tarama motoru hazır değil veya imzalar bayat; güvenli sonuç üretilemiyor.';
    }
    return 'Tarama hostu hazır. Durum bu yenilemenin anını gösterir.';
}

/** Mounts operator health and audited retries with compact toggleable presentation. @param {HTMLElement} root Mount. @param {object} api Transport adapter. @returns {void} Registers controls. */
export function initializeScannerManager(root, api = createScannerApi()) {
    root.className = 'staff-scanner-panel';
    const document = root.ownerDocument;
    let isDetailsOpen = false;

    const header = document.createElement('div');
    header.className = 'staff-scanner-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'staff-scanner-title-group';

    const title = document.createElement('strong');
    title.className = 'staff-scanner-title';
    title.textContent = '🛡️ Belge Güvenlik Taraması';

    const badge = document.createElement('span');
    badge.className = 'staff-scanner-badge badge-neutral';
    badge.textContent = 'Durum sorgulanıyor…';

    titleGroup.append(title, badge);

    const actions = document.createElement('div');
    actions.className = 'staff-scanner-actions';

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'btn btn-outline btn-sm';
    refresh.dataset.action = 'refresh-scanner';
    refresh.textContent = 'Tarama durumunu yenile';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-outline btn-sm staff-scanner-toggle';
    toggle.dataset.action = 'toggle-scanner-details';
    toggle.textContent = 'Ayrıntılar ▼';
    toggle.setAttribute('aria-expanded', 'false');

    actions.append(refresh, toggle);
    header.append(titleGroup, actions);
    root.append(header);

    const detailsRoot = document.createElement('div');
    detailsRoot.className = 'staff-scanner-details';
    detailsRoot.hidden = true;
    root.append(detailsRoot);

    toggle.addEventListener('click', () => {
        isDetailsOpen = !isDetailsOpen;
        detailsRoot.hidden = !isDetailsOpen;
        toggle.setAttribute('aria-expanded', String(isDetailsOpen));
        toggle.textContent = isDetailsOpen ? 'Ayrıntıları Gizle ▲' : 'Ayrıntılar ▼';
    });

    function renderStatus(status) {
        const backlog = (status.jobs || [])
            .filter((item) => ['queued', 'leased'].includes(item.status))
            .reduce((total, item) => total + item.count, 0);
        const hostSummary = readHostSummary(status.runners || []);
        const isOfflineOrStale = hostSummary.includes('çevrimdışı') || hostSummary.includes('bayat');
        const failedJobs = status.failed_jobs || [];

        if (isOfflineOrStale) {
            badge.className = 'staff-scanner-badge badge-danger';
            badge.textContent = '⚠️ Tarama Servisi Çevrimdışı';
        } else if (backlog > 0) {
            badge.className = 'staff-scanner-badge badge-warning';
            badge.textContent = `⏳ ${backlog} Belge Kuyrukta`;
        } else if (failedJobs.length > 0) {
            badge.className = 'staff-scanner-badge badge-amber';
            badge.textContent = `⚠️ ${failedJobs.length} Doğrulanamayan Dosya`;
        } else {
            badge.className = 'staff-scanner-badge badge-success';
            badge.textContent = '🟢 Tarama Servisi Aktif (0 bekleyen)';
        }

        detailsRoot.replaceChildren();

        const summary = document.createElement('p');
        summary.className = 'staff-scanner-summary-text';
        summary.textContent = `Bekleyen tarama: ${backlog}. ${hostSummary} Son başarılı tarama: ${formatScanTime(status.last_successful_scan)}`;
        summary.setAttribute('aria-live', 'polite');
        detailsRoot.append(summary);

        if (failedJobs.length > 0) {
            const failuresContainer = document.createElement('div');
            failuresContainer.className = 'staff-scanner-failures';
            failedJobs.forEach((job) => {
                const row = document.createElement('div');
                row.className = 'staff-scanner-failure-item';
                const requiresReplacement = ['unsupported_content', 'policy_blocked'].includes(job.result_code);
                if (requiresReplacement) {
                    row.classList.add('is-warning');
                    row.textContent = `Belge bu tarama politikasıyla doğrulanamadı (${job.result_code}). Başvuru sahibi desteklenen dosyayı replacement akışından yüklemeli; aynı dosyayı yeniden taramayın.`;
                } else {
                    row.classList.add('is-danger');
                    row.textContent = `Tamamlanamayan tarama (${job.result_code}); ${job.attempts} deneme. `;
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'btn btn-outline btn-sm';
                    button.dataset.action = 'retry-scan';
                    button.textContent = 'Taramayı yeniden dene';
                    button.addEventListener('click', () => retryJob(job.id, button));
                    row.append(button);
                }
                failuresContainer.append(row);
            });
            detailsRoot.append(failuresContainer);
        } else {
            const cleanText = document.createElement('p');
            cleanText.className = 'staff-scanner-clean-text';
            cleanText.textContent = 'Tüm taranan belgeler güvenli ve onaylı.';
            detailsRoot.append(cleanText);
        }

        schedulePoll(backlog > 0 ? 6_000 : 30_000);
    }

    let pollTimer = null;
    function schedulePoll(delayMs) {
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
        const view = root.ownerDocument?.defaultView || window;
        if (!view || view.closed) return;
        pollTimer = view.setTimeout(() => {
            void loadStatus().catch(() => {});
        }, delayMs);
        if (typeof pollTimer?.unref === 'function') pollTimer.unref();
    }

    async function loadStatus() {
        refresh.disabled = true;
        try {
            const status = await api.readStatus();
            renderStatus(status);
        } catch {
            badge.className = 'staff-scanner-badge badge-danger';
            badge.textContent = 'Tarama durumu alınamadı';
            detailsRoot.replaceChildren();
            const err = document.createElement('p');
            err.textContent = 'Tarama durumu alınamadı. Yenileyin; belgeler güvenli kabul edilmedi.';
            detailsRoot.append(err);
            schedulePoll(30_000);
        } finally {
            refresh.disabled = false;
        }
    }

    async function retryJob(jobId, button) {
        button.disabled = true;
        try {
            await api.retry(jobId);
            await loadStatus();
        } catch {
            detailsRoot.append(document.createTextNode('Tarama yeniden başlatılamadı. Güncel durumu yenileyin.'));
        } finally {
            button.disabled = false;
        }
    }

    refresh.addEventListener('click', loadStatus);

    const handleGlobalRefresh = () => { void loadStatus().catch(() => {}); };
    root.ownerDocument.addEventListener('scanner:refresh', handleGlobalRefresh);
    root.ownerDocument.addEventListener('staff-applications:view-changed', (event) => {
        if (event.detail?.view !== 'detail') {
            handleGlobalRefresh();
        }
    });

    void loadStatus().catch(() => {});
}
