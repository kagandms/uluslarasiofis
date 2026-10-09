const REFRESH_INTERVAL_MS = 15_000;
const TERMINAL_STATUS_LABELS = Object.freeze({
    uploading: 'Yükleniyor', queued: 'Bekliyor', leased: 'Agent aldı', ready: 'Yazdırmaya hazır',
    submission_started: 'Spooler’a gönderiliyor', submitted: 'Agent spooler’a gönderdi; fiziksel çıktı doğrulanmadı',
    failed: 'Başarısız', unknown: 'Sonuç belirsiz; otomatik tekrarlanmadı', cancelled: 'İptal edildi', expired: 'Süresi doldu'
});

function textElement(document, tagName, text, className = '') {
    const element = document.createElement(tagName);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function formatDate(value) {
    if (!value) return 'Bilinmiyor';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'Bilinmiyor' : date.toLocaleString('tr-TR');
}

function appendDefinitionList(document, target, fields) {
    target.replaceChildren();
    for (const [label, value] of fields) {
        target.append(textElement(document, 'dt', label), textElement(document, 'dd', value));
    }
}

function settingsSummary(job) {
    const color = job.color_mode === 'color' ? 'Renkli' : 'Siyah-beyaz';
    const orientation = job.orientation === 'landscape' ? 'Yatay' : 'Dikey';
    const sides = job.duplex === 'duplexlong' ? 'Çift taraflı' : 'Tek taraflı';
    return `${job.paper_size} · ${color} · ${orientation} · ${sides} · ${job.copies} kopya`;
}

function jobStatus(job) {
    return TERMINAL_STATUS_LABELS[job.status] || 'Bilinmeyen durum';
}

function canSafelyCancel(job) {
    return ['uploading', 'queued'].includes(job.status) && !job.runner_id && !job.submission_started_at;
}

function renderJob(document, job, options = {}) {
    const card = textElement(document, 'article', '', 'print-job-card');
    card.append(textElement(document, 'strong', jobStatus(job)));
    const mediaType = job.media_type === 'application/pdf' ? 'PDF'
        : job.media_type === 'image/png' ? 'PNG' : job.media_type === 'image/jpeg' ? 'JPG' : 'Bilinmeyen dosya';
    card.append(textElement(document, 'span', `İş ${job.id.slice(-8)} · ${mediaType} · ${(job.byte_size / 1024 / 1024).toFixed(2)} MB`));
    card.append(textElement(document, 'span', `Kaynak: ${job.source === 'unknown' ? 'Bilinmiyor' : job.source === 'staff' ? 'Personel' : 'Öğrenci QR'}`));
    card.append(textElement(document, 'span', settingsSummary(job)));
    const volume = job.page_count ? `${job.page_count} sayfa × ${job.copies} kopya` : `${job.copies} kopya`;
    card.append(textElement(document, 'span', volume));
    card.append(textElement(document, 'time', `Oluşturulma: ${formatDate(job.created_at)}`));
    if (job.status === 'submission_started' || job.status === 'submitted') {
        card.append(textElement(document, 'span', jobStatus({ status: job.status }), 'print-job-caveat'));
    }
    if (options.allowCancel) {
        const cancel = textElement(document, 'button', 'İşi iptal et', 'btn btn-outline print-job-cancel');
        cancel.type = 'button';
        cancel.disabled = !options.canManage || !canSafelyCancel(job);
        if (cancel.disabled) {
            cancel.title = options.canManage
                ? 'İş Agent tarafından alınmış veya yazdırma aşamasına geçmiş. Güvenli iptal yapılamaz.'
                : 'Yalnız admin işleri iptal edebilir.';
        }
        cancel.dataset.jobId = job.id;
        card.append(cancel);
    }
    return card;
}

function renderManagement(root, payload) {
    const document = root.ownerDocument || root;
    const printer = payload.printer || {};
    const status = root.getElementById('print-staff-status');
    status.textContent = printer.online ? 'Yazıcı çevrimiçi' : 'Yazıcı çevrimdışı';
    appendDefinitionList(document, root.getElementById('print-staff-details'), [
        ['Yazıcı', printer.printer_name || 'Tanımlı değil'], ['Son Agent heartbeat', formatDate(printer.seen_at)],
        ['Agent bağlantısı', printer.runner_id || 'Bağlı değil'], ['Agent durumu', printer.health || 'Bilinmiyor'],
        ['Kuyruk', payload.queue?.paused ? 'Duraklatıldı' : 'Devam ediyor']
    ]);
    appendDefinitionList(document, root.getElementById('print-staff-counts'), [
        ['Bekleyen', String(payload.counts?.queued || 0)], ['İşlenen', String(payload.counts?.processing || 0)],
        ['Agent tarafından gönderilen', String(payload.counts?.submitted || 0)], ['Toplam etkin', String(payload.counts?.pending || 0)]
    ]);
    root.getElementById('print-queue-pause').hidden = !payload.canManage || payload.queue?.paused === true;
    root.getElementById('print-queue-resume').hidden = !payload.canManage || payload.queue?.paused !== true;
    const jobs = root.getElementById('print-staff-jobs');
    jobs.replaceChildren();
    if (!payload.jobs?.length) jobs.append(textElement(document, 'p', 'Etkin yazdırma işi yok.'));
    for (const job of payload.jobs || []) jobs.append(renderJob(document, job, { allowCancel: true, canManage: payload.canManage }));
}

function readFilterQuery(root, cursor = null) {
    const params = new URLSearchParams();
    for (const [field, key] of [['print-history-from', 'from'], ['print-history-to', 'to'],
        ['print-history-status', 'status'], ['print-history-source', 'source']]) {
        const value = root.getElementById(field).value;
        if (value) params.set(key, value);
    }
    params.set('limit', '25');
    if (cursor) {
        params.set('before_created_at', cursor.created_at);
        params.set('before_id', cursor.id);
    }
    return params.toString();
}

export function initializeStaffPrintStatus(root = document) {
    const document = root.ownerDocument || root;
    const view = document.defaultView || globalThis;
    const status = root.getElementById('print-staff-status');
    const refreshButton = root.getElementById('print-staff-refresh');
    if (!status || !refreshButton) return;
    let isLoading = false;
    let refreshTimer = null;
    let historyCursor = null;

    const requestJson = async (path, options = {}) => {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error?.code || 'request_failed');
        return payload;
    };

    const refresh = async () => {
        if (isLoading) return;
        isLoading = true;
        refreshButton.disabled = true;
        try {
            renderManagement(root, await requestJson('/api/staff/print/management'));
        } catch {
            status.textContent = 'Yazdırma durumu yüklenemedi. Oturumunuzu ve bağlantınızı kontrol edin.';
        } finally {
            isLoading = false;
            refreshButton.disabled = false;
        }
    };

    const loadHistory = async (append = false) => {
        const query = readFilterQuery(root, append ? historyCursor : null);
        const target = root.getElementById('print-history-list');
        try {
            const result = await requestJson(`/api/staff/print/history?${query}`);
            if (!append) target.replaceChildren();
            if (!result.jobs.length && !append) target.append(textElement(document, 'p', 'Bu filtrelerle iş bulunamadı.'));
            for (const job of result.jobs) target.append(renderJob(document, job));
            historyCursor = result.nextCursor;
            root.getElementById('print-history-more').hidden = !result.hasMore;
        } catch {
            target.replaceChildren(textElement(document, 'p', 'Yazdırma geçmişi yüklenemedi.'));
            root.getElementById('print-history-more').hidden = true;
        }
    };

    const mutate = async (path, confirmation) => {
        if (!view.confirm(confirmation)) return;
        try {
            await requestJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            await Promise.all([refresh(), loadHistory()]);
        } catch {
            status.textContent = 'İşlem tamamlanamadı. Yetkinizi ve işin güncel durumunu kontrol edin.';
        }
    };

    refreshButton.addEventListener('click', () => void refresh());
    root.getElementById('print-queue-pause').addEventListener('click', () => void mutate(
        '/api/staff/print/queue/pause', 'Kuyruk duraklatılsın mı? Mevcut Agent işleri devam eder; yeni işler kabul edilmez.'
    ));
    root.getElementById('print-queue-resume').addEventListener('click', () => void mutate(
        '/api/staff/print/queue/resume', 'Kuyruk devam ettirilsin mi? Bekleyen işler sırayla işlenebilir.'
    ));
    root.getElementById('print-staff-jobs').addEventListener('click', (event) => {
        const button = event.target.closest('.print-job-cancel');
        if (!button || button.disabled) return;
        void mutate(`/api/staff/print/jobs/${encodeURIComponent(button.dataset.jobId)}/cancel`,
            'Bu bekleyen iş iptal edilsin mi? İş yalnızca Agent henüz almamışsa iptal edilir.');
    });
    root.getElementById('print-history-filters').addEventListener('submit', (event) => {
        event.preventDefault();
        historyCursor = null;
        void loadHistory();
    });
    root.getElementById('print-history-more').addEventListener('click', () => void loadHistory(true));
    document.addEventListener('workspace:view-changed', (event) => {
        if (event.detail?.viewName === 'print') {
            view.clearInterval(refreshTimer);
            void refresh();
            void loadHistory();
            refreshTimer = view.setInterval(() => {
                if (!document.hidden) void refresh();
            }, REFRESH_INTERVAL_MS);
            return;
        }
        view.clearInterval(refreshTimer);
        refreshTimer = null;
    });
}
