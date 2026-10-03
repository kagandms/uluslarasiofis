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

function appendStatus(root, status, retryJob) {
    const document = root.ownerDocument;
    const backlog = status.jobs.filter((item) => ['queued','leased'].includes(item.status)).reduce((total,item) => total + item.count,0);
    const summary = document.createElement('p');
    summary.textContent = `Bekleyen tarama: ${backlog}. ${readHostSummary(status.runners)} Son başarılı tarama: ${status.last_successful_scan || 'Henüz yok'}`;
    summary.setAttribute('aria-live','polite');
    root.append(summary);
    status.failed_jobs.forEach((job) => {
        const row = document.createElement('p');
        const requiresReplacement = ['unsupported_content', 'policy_blocked'].includes(job.result_code);
        row.textContent = requiresReplacement
            ? `Belge bu tarama politikasıyla doğrulanamadı (${job.result_code}). Başvuru sahibi desteklenen dosyayı replacement akışından yüklemeli; aynı dosyayı yeniden taramayın.`
            : `Tamamlanamayan tarama (${job.result_code}); ${job.attempts} deneme. `;
        if (requiresReplacement) {
            root.append(row);
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = 'retry-scan';
        button.textContent = 'Taramayı yeniden dene';
        button.addEventListener('click',() => retryJob(job.id,button));
        row.append(button);
        root.append(row);
    });
}

/** Mounts operator health and audited retries. @param {HTMLElement} root Mount. @param {object} api Transport adapter. @returns {void} Registers controls. */
export function initializeScannerManager(root, api = createScannerApi()) {
    const refresh = root.ownerDocument.createElement('button');
    refresh.type='button';
    refresh.dataset.action='refresh-scanner';
    refresh.textContent='Tarama durumunu yenile';
    root.append(refresh);
    const statusRoot = root.ownerDocument.createElement('div');
    root.append(statusRoot);
    async function loadStatus() {
        refresh.disabled=true;
        try {
            const status = await api.readStatus();
            statusRoot.replaceChildren();
            appendStatus(statusRoot,status,retryJob);
        } catch {
            statusRoot.textContent='Tarama durumu alınamadı. Yenileyin; belgeler güvenli kabul edilmedi.';
        } finally { refresh.disabled=false; }
    }
    async function retryJob(jobId,button) {
        button.disabled=true;
        try { await api.retry(jobId); await loadStatus(); }
        catch { statusRoot.textContent='Tarama yeniden başlatılamadı. Güncel durumu yenileyin.'; }
        finally { button.disabled=false; }
    }
    refresh.addEventListener('click',loadStatus);
}
