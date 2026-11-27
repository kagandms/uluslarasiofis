import { PUBLIC_MESSAGES } from '../public/i18n/messages.js';

const QUEUED_POLL_INTERVAL_MS = 60_000;
const IDLE_POLL_INTERVAL_MS = 300_000;
const NON_RETRYABLE_CODES = new Set(['unsupported_content', 'policy_blocked']);
const MIGRATION_LOCKED_STATUSES = new Set(['sent_to_migration', 'migration_approved']);
const TERMINAL_APPLICATION_STATUSES = new Set(['completed', 'cancelled', 'rejected']);

async function requestJson(url, options = {}, fallbackError = 'İşlem tamamlanamadı.') {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw Object.assign(new Error(payload?.error?.message || fallbackError), {
            status: response.status,
            code: payload?.error?.code
        });
    }
    return payload;
}

async function fetchScanner(path, options = {}) {
    return requestJson(`/api/staff/scanner/${path}`, options, 'Tarama durumu okunamadı.');
}

function createScannerApi() {
    return {
        readStatus: () => fetchScanner('status'),
        retry: (jobId) => fetchScanner('retry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId })
        }),
        requestResubmission: (applicationId, code, revisionNumber, reason) => requestJson(
            `/api/staff/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(code)}/request-resubmission`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expected_revision_number: revisionNumber, reason })
            }
        ),
        transitionApplication: (applicationId, targetStatus, expectedUpdatedAt) => requestJson(
            `/api/staff/applications/${encodeURIComponent(applicationId)}/status`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_status: targetStatus, expected_updated_at: expectedUpdatedAt })
            }
        )
    };
}

function readDocumentLabel(code) {
    if (!code) return '';
    const key = `document${code.replace(/(?:^|_)([a-z0-9])/g, (_, ch) => ch.toUpperCase())}`;
    return PUBLIC_MESSAGES.tr[key] || code;
}

function readFailureReason(job) {
    if (job.scan_status === 'unsafe' || job.result_code === 'malware') {
        return 'Güvenlik taraması dosyayı güvenli bulmadı; yeni dosya yüklenmeli.';
    }
    if (NON_RETRYABLE_CODES.has(job.result_code)) {
        return `Belge bu tarama politikasıyla doğrulanamadı (${job.result_code}). Başvuru sahibi desteklenen dosyayı replacement akışından yüklemeli; aynı dosyayı yeniden taramayın.`;
    }
    return `Tamamlanamayan tarama (${job.result_code}); ${job.attempts} deneme.`;
}

function readDefaultResubmissionReason(job) {
    if (job.scan_status === 'unsafe' || job.result_code === 'malware') {
        return 'Güvenlik taraması dosyayı güvenli bulmadı; lütfen yeni ve temiz bir dosya yükleyin. / Security scan found the file unsafe; please upload a new clean file.';
    }
    return 'Dosya güvenlik taramasından geçemedi; lütfen açılabilir yeni bir PDF veya fotoğraf yükleyin. / File could not pass security scan; please upload a new readable PDF or photo.';
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
    // Matches the runner's SCANNER_MAX_SIGNATURE_AGE_SECONDS upper bound (72 hours).
    if (latestRunner.health !== 'ready' || !latestRunner.signature_updated_at
        || Date.now() - Date.parse(latestRunner.signature_updated_at) > 259_200_000) {
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
        // failed_jobs is capped at 50 current records; the full count comes from actionable_failed_total (or job counter fallback).
        const failedTotal = typeof status.actionable_failed_total === 'number'
            ? status.actionable_failed_total
            : ((status.jobs || []).find((item) => item.status === 'failed')?.count ?? failedJobs.length);
        const sampleNotice = failedTotal > failedJobs.length ? ` (ilk ${failedJobs.length} kayıt gösteriliyor)` : '';

        if (isOfflineOrStale) {
            badge.className = 'staff-scanner-badge badge-danger';
            badge.textContent = '⚠️ Tarama Servisi Çevrimdışı';
        } else if (backlog > 0) {
            badge.className = 'staff-scanner-badge badge-warning';
            badge.textContent = `⏳ ${backlog} Belge Kuyrukta`;
        } else if (failedTotal > 0) {
            badge.className = 'staff-scanner-badge badge-amber';
            badge.textContent = `⚠️ ${failedTotal} Doğrulanamayan Dosya`;
        } else {
            badge.className = 'staff-scanner-badge badge-success';
            badge.textContent = '🟢 Tarama Servisi Aktif (0 bekleyen)';
        }

        detailsRoot.replaceChildren();

        const summary = document.createElement('p');
        summary.className = 'staff-scanner-summary-text';
        summary.textContent = `Kuyrukta veya işlemde: ${backlog}. Doğrulanamayan dosya: ${failedTotal}${sampleNotice}. ${hostSummary} Son başarılı tarama: ${formatScanTime(status.last_successful_scan)}`;
        summary.setAttribute('aria-live', 'polite');
        detailsRoot.append(summary);

        if (failedJobs.length > 0) {
            const failuresContainer = document.createElement('div');
            failuresContainer.className = 'staff-scanner-failures';
            failedJobs.forEach((job) => {
                const row = document.createElement('div');
                row.className = 'staff-scanner-failure-item';
                const requiresReplacement = NON_RETRYABLE_CODES.has(job.result_code) || job.scan_status === 'unsafe';
                row.classList.add(requiresReplacement ? 'is-warning' : 'is-danger');

                const info = document.createElement('div');
                info.className = 'staff-scanner-failure-info';
                const studentName = [job.first_name, job.last_name].filter(Boolean).join(' ');
                const metaParts = [studentName, job.student_number, readDocumentLabel(job.document_code)].filter(Boolean);
                if (metaParts.length > 0) {
                    const meta = document.createElement('strong');
                    meta.className = 'staff-scanner-failure-meta';
                    meta.textContent = metaParts.join(' · ');
                    info.append(meta);
                }
                const reasonText = document.createElement('span');
                reasonText.className = 'staff-scanner-failure-reason';
                reasonText.textContent = readFailureReason(job);
                info.append(reasonText);

                const rowActions = document.createElement('div');
                rowActions.className = 'staff-scanner-failure-actions';

                if (job.application_id) {
                    const openButton = document.createElement('button');
                    openButton.type = 'button';
                    openButton.className = 'btn btn-outline btn-sm';
                    openButton.dataset.action = 'open-application';
                    openButton.textContent = 'Başvuruyu aç';
                    openButton.addEventListener('click', () => {
                        const view = document.defaultView || window;
                        const EventCtor = view?.CustomEvent || (typeof CustomEvent === 'function' ? CustomEvent : null);
                        if (EventCtor) {
                            document.dispatchEvent(new EventCtor('staff-scanner:open-application', {
                                detail: { applicationId: job.application_id }
                            }));
                        }
                    });
                    rowActions.append(openButton);
                }

                if (MIGRATION_LOCKED_STATUSES.has(job.application_status)) {
                    const note = document.createElement('span');
                    note.className = 'staff-scanner-migration-note';
                    note.textContent = 'Önce Göç\'ten geri alın';
                    rowActions.append(note);
                } else if (!TERMINAL_APPLICATION_STATUSES.has(job.application_status)
                    && job.can_request_resubmission !== false
                    && job.application_id && job.document_code && job.revision_number != null
                    && typeof api.requestResubmission === 'function') {
                    const requestButton = document.createElement('button');
                    requestButton.type = 'button';
                    requestButton.className = 'btn btn-primary btn-sm';
                    requestButton.dataset.action = 'request-resubmission';
                    requestButton.textContent = job.application_status === 'submitted'
                        ? 'İncelemeye al ve tekrar iste'
                        : 'Tekrar yükleme iste';
                    requestButton.addEventListener('click', () => openScannerResubmissionForm(row, job, requestButton));
                    rowActions.append(requestButton);
                }

                if (!requiresReplacement && job.has_scan_job !== false) {
                    const retryButton = document.createElement('button');
                    retryButton.type = 'button';
                    retryButton.className = 'btn btn-outline btn-sm';
                    retryButton.dataset.action = 'retry-scan';
                    retryButton.textContent = 'Taramayı yeniden dene';
                    retryButton.addEventListener('click', () => retryJob(job.id, retryButton));
                    rowActions.append(retryButton);
                }

                row.append(info, rowActions);
                failuresContainer.append(row);
            });
            detailsRoot.append(failuresContainer);
        } else {
            const cleanText = document.createElement('p');
            cleanText.className = 'staff-scanner-clean-text';
            cleanText.textContent = 'Tüm taranan belgeler güvenli ve onaylı.';
            detailsRoot.append(cleanText);
        }

        schedulePoll(backlog > 0 ? QUEUED_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
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
            schedulePoll(IDLE_POLL_INTERVAL_MS);
        } finally {
            refresh.disabled = false;
        }
    }

    function openScannerResubmissionForm(row, job, triggerButton) {
        const existingForm = row.querySelector('.staff-scanner-resubmission-form');
        if (existingForm) {
            existingForm.querySelector('textarea')?.focus();
            return;
        }
        const form = document.createElement('form');
        form.className = 'staff-scanner-resubmission-form';
        const textarea = document.createElement('textarea');
        textarea.name = 'reason';
        textarea.rows = 3;
        textarea.required = true;
        textarea.minLength = 3;
        textarea.maxLength = 1000;
        textarea.dataset.action = 'scanner-resubmission-reason';
        textarea.value = readDefaultResubmissionReason(job);

        const formActions = document.createElement('div');
        formActions.className = 'staff-scanner-resubmission-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-outline btn-sm';
        cancel.dataset.action = 'cancel-scanner-resubmission';
        cancel.textContent = 'Vazgeç';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'btn btn-primary btn-sm';
        submit.dataset.action = 'submit-scanner-resubmission';
        submit.textContent = 'Gönder';
        const errorText = document.createElement('p');
        errorText.className = 'staff-scanner-resubmission-error';
        errorText.setAttribute('role', 'alert');
        errorText.hidden = true;

        cancel.addEventListener('click', () => form.remove());
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const reason = textarea.value.trim();
            if ([...reason.replace(/[\s\p{C}]/gu, '')].length < 3) {
                errorText.textContent = 'En az 3 karakter girin.';
                errorText.hidden = false;
                return;
            }
            submit.disabled = true;
            cancel.disabled = true;
            errorText.hidden = true;
            let step1SucceededInSubmit = false;
            try {
                if (job.application_status === 'submitted') {
                    const transitioned = await api.transitionApplication(
                        job.application_id,
                        'under_review',
                        job.application_updated_at
                    );
                    step1SucceededInSubmit = true;
                    job.application_status = transitioned?.application_status || transitioned?.application?.status || 'under_review';
                    const nextUpdatedAt = transitioned?.updated_at || transitioned?.application?.updated_at;
                    if (nextUpdatedAt) {
                        job.application_updated_at = nextUpdatedAt;
                    }
                    triggerButton.textContent = 'Tekrar yükleme iste';
                }
                await api.requestResubmission(
                    job.application_id,
                    job.document_code,
                    job.revision_number,
                    reason
                );
                await loadStatus();
                const view = document.defaultView || window;
                const EventCtor = view?.CustomEvent || (typeof CustomEvent === 'function' ? CustomEvent : null);
                if (EventCtor) {
                    document.dispatchEvent(new EventCtor('staff-scanner:resubmission-requested', {
                        detail: { applicationId: job.application_id, documentCode: job.document_code }
                    }));
                }
            } catch (error) {
                errorText.textContent = error?.message || 'Yeniden yükleme isteği gönderilemedi. Tekrar deneyin.';
                errorText.hidden = false;
                try {
                    const status = await api.readStatus();
                    const freshJob = (status?.failed_jobs || []).find((entry) =>
                        entry.id === job.id
                        || (entry.application_id === job.application_id && entry.document_code === job.document_code)
                    );
                    if (freshJob) {
                        const preservedStatus = step1SucceededInSubmit && freshJob.application_status === 'submitted'
                            ? job.application_status
                            : freshJob.application_status;
                        const preservedUpdatedAt = step1SucceededInSubmit && freshJob.application_status === 'submitted'
                            ? job.application_updated_at
                            : freshJob.application_updated_at;
                        Object.assign(job, freshJob, {
                            application_status: preservedStatus,
                            application_updated_at: preservedUpdatedAt
                        });
                        triggerButton.textContent = job.application_status === 'submitted'
                            ? 'İncelemeye al ve tekrar iste'
                            : 'Tekrar yükleme iste';
                    }
                } catch {
                    // Keep the open form, typed reason, and error even if status refresh fails.
                }
                submit.disabled = false;
                cancel.disabled = false;
            }
        });

        formActions.append(cancel, submit);
        form.append(textarea, formActions, errorText);
        row.append(form);
        textarea.focus();
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
