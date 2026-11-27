import { formatDeadlineWithRemaining, isExportedAtStale } from './yoksisExcelImport.js';

export const MIGRATION_SYNC_BATCH_SIZE = 20;

const SYNC_PREVIEW_PATH = '/api/staff/yoksis-document-audit/sync/preview';
const SYNC_APPLY_PATH = '/api/staff/yoksis-document-audit/sync/apply';

export const TARGET_STATE_LABELS = Object.freeze({
    approved: 'Göç İdaresi tarafından onaylandı',
    missing_documents: 'Göç: Eksik evrak',
    reviewing: 'Göç İdaresi inceliyor'
});

export const MANUAL_REASON_LABELS = Object.freeze({
    multiple_open_records: 'Aynı öğrencinin birden fazla açık kaydı var',
    older_application: 'E-İkamet başvuru tarihi portal kaydından eski (tarih koruması)',
    name_mismatch: 'Excel ve portaldaki ad soyad uyuşmuyor',
    terminal_status_conflict: 'Portal kaydı kapalı veya sonuçlanmış durumda, Excel ile çelişiyor'
});

export const CONFLICT_REASON_LABELS = Object.freeze({
    import_changed: 'Yeni bir Excel aktarımı yapıldığı için işlem durduruldu',
    version_conflict: 'Kayıt başka bir işlem tarafından değiştirilmiş (çakışma)',
    write_failed: 'Kayıt güncellenemedi'
});

export function chunkSyncItems(items, size = MIGRATION_SYNC_BATCH_SIZE) {
    const packets = [];
    for (let index = 0; index < items.length; index += size) {
        packets.push(items.slice(index, index + size));
    }
    return packets;
}

export function summarizeSyncPlan(plan) {
    const actionable = [...(plan?.changes || []), ...(plan?.needsAttention || [])];
    let approved = 0;
    let missingDocuments = 0;
    let reviewing = 0;
    for (const item of actionable) {
        if (item.target_state === 'approved') approved += 1;
        else if (item.target_state === 'missing_documents') missingDocuments += 1;
        else if (item.target_state === 'reviewing') reviewing += 1;
    }
    return {
        approved,
        missing_documents: missingDocuments,
        reviewing,
        manual: Array.isArray(plan?.manual) ? plan.manual.length : 0,
        unchanged: Number(plan?.unchangedCount || 0)
    };
}

function itemKey(item) {
    return `${item.record_kind}:${item.record_id}`;
}

function createEl(document, tag, className = '', textValue = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue !== null && textValue !== undefined) node.textContent = String(textValue);
    return node;
}

function defaultFetcher(document) {
    const win = document.defaultView;
    if (win && typeof win.fetch === 'function') return win.fetch.bind(win);
    return globalThis.fetch;
}

async function postJson(fetcher, url, body) {
    const response = await fetcher(url, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (!response.ok) {
        const message = payload?.error?.message || `İstek tamamlanamadı (HTTP ${response.status}).`;
        const error = new Error(message);
        error.status = response.status;
        error.code = payload?.error?.code;
        throw error;
    }
    return payload || {};
}

function resolveItemIdentity(item) {
    const fullName = (item.full_name || [item.first_name, item.last_name].filter(Boolean).join(' ')).trim();
    const studentNumber = String(item.student_number || '').trim();
    return {
        fullName: fullName || '—',
        studentNumber: studentNumber || '—'
    };
}

function getFocusableElements(container) {
    return [...container.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.hidden && el.offsetParent !== null || el.tagName === 'BUTTON' || el.tagName === 'INPUT');
}

/**
 * Opens an accessible native <dialog> to preview and apply YÖKSİS Excel status syncs.
 * @param {Document} document Owner document.
 * @param {object} [options] Dialog dependencies and callbacks.
 * @returns {{ dialog: HTMLDialogElement, ready: Promise<void>, close: () => void }} Dialog handle.
 */
export function openMigrationSyncDialog(document, options = {}) {
    const {
        trigger = null,
        fetcher = defaultFetcher(document),
        nowMs = Date.now(),
        onApplied = null
    } = options;

    const returnFocusTo = (trigger && typeof trigger.focus === 'function')
        ? trigger
        : (document.activeElement && typeof document.activeElement.focus === 'function' ? document.activeElement : null);

    const dialog = createEl(document, 'dialog', 'migration-sync-dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'migration-sync-title');
    dialog.setAttribute('aria-describedby', 'migration-sync-desc');

    const card = createEl(document, 'div', 'migration-sync-card');
    const header = createEl(document, 'div', 'migration-sync-header');
    const titleWrap = createEl(document, 'div');
    const title = createEl(document, 'h3', 'migration-sync-title', 'Durumları portala işle');
    title.id = 'migration-sync-title';
    const desc = createEl(document, 'p', 'migration-sync-desc', 'Son yüklenen YÖKSİS Excel kaydı ile portal kayıtları karşılaştırılıyor…');
    desc.id = 'migration-sync-desc';
    titleWrap.append(title, desc);

    const headerClose = createEl(document, 'button', 'btn btn-outline', 'Kapat');
    headerClose.type = 'button';
    headerClose.dataset.action = 'close-sync';
    headerClose.setAttribute('aria-label', 'Pencereyi kapat');
    header.append(titleWrap, headerClose);

    const body = createEl(document, 'div', 'migration-sync-body');
    const footer = createEl(document, 'div', 'migration-sync-footer');
    const closeBtn = createEl(document, 'button', 'btn btn-outline', 'Kapat');
    closeBtn.type = 'button';
    closeBtn.dataset.action = 'close-sync';
    const applyBtn = createEl(document, 'button', 'btn btn-primary', 'Seçilenleri uygula');
    applyBtn.type = 'button';
    applyBtn.dataset.action = 'apply-sync';
    applyBtn.disabled = true;
    footer.append(closeBtn, applyBtn);

    card.append(header, body, footer);
    dialog.append(card);
    document.body.append(dialog);

    const state = {
        loading: true,
        applying: false,
        closed: false,
        error: '',
        preview: null,
        selectedKeys: new Set(),
        staleConfirmed: false,
        progress: null,
        result: null,
        interruption: null
    };

    function isStaleExport() {
        return isExportedAtStale(state.preview?.exported_at, nowMs);
    }

    function updateApplyButtonState() {
        const count = state.selectedKeys.size;
        applyBtn.textContent = state.applying ? 'Uygulanıyor…' : `Seçilenleri uygula (${count})`;
        applyBtn.disabled = state.loading
            || state.applying
            || !state.preview?.import_id
            || count === 0
            || (isStaleExport() && !state.staleConfirmed);
        closeBtn.disabled = state.applying;
        headerClose.disabled = state.applying;
    }

    function renderCounts(counts) {
        const grid = createEl(document, 'div', 'migration-sync-counts');
        const entries = [
            ['approved', 'Onaylanacak', counts.approved],
            ['missing_documents', 'Eksik evrak', counts.missing_documents],
            ['reviewing', 'İncelemeye dönecek', counts.reviewing],
            ['manual', 'Elle kontrol', counts.manual],
            ['unchanged', 'Değişmeyen', counts.unchanged]
        ];
        for (const [key, label, value] of entries) {
            const box = createEl(document, 'div', 'migration-sync-count-card');
            const val = createEl(document, 'span', 'migration-sync-count-value', String(value));
            val.dataset.syncCount = key;
            const lbl = createEl(document, 'span', 'migration-sync-count-label', label);
            box.append(val, lbl);
            grid.append(box);
        }
        return grid;
    }

    function renderSelectableList(items, groupName) {
        const list = createEl(document, 'ul', 'migration-sync-list');
        for (const item of items) {
            const key = itemKey(item);
            const identity = resolveItemIdentity(item);
            const li = createEl(document, 'li', 'migration-sync-item');
            const checkbox = createEl(document, 'input');
            checkbox.type = 'checkbox';
            checkbox.checked = state.selectedKeys.has(key);
            checkbox.disabled = state.applying;
            checkbox.dataset.syncSelect = groupName;
            checkbox.dataset.recordKey = key;
            checkbox.setAttribute('aria-label', `${identity.fullName} (${item.application_number})`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) state.selectedKeys.add(key);
                else state.selectedKeys.delete(key);
                updateApplyButtonState();
            });

            const main = createEl(document, 'div', 'migration-sync-item-main');
            const top = createEl(document, 'div', 'migration-sync-item-top');
            top.append(
                createEl(document, 'span', '', identity.fullName),
                createEl(document, 'span', 'migration-sync-tag', item.record_kind === 'physical' ? 'Fiziksel' : 'Online'),
                createEl(document, 'span', 'migration-sync-tag', TARGET_STATE_LABELS[item.target_state] || item.target_state)
            );
            const meta = createEl(
                document,
                'div',
                'migration-sync-item-meta',
                `Öğrenci No: ${identity.studentNumber} · Başvuru No: ${item.application_number}`
            );
            main.append(top, meta);
            if (item.target_state === 'missing_documents') {
                const deadlineText = formatDeadlineWithRemaining(item.deadline, nowMs);
                if (deadlineText || item.note) {
                    const detail = [deadlineText ? `Son tarih: ${deadlineText}` : '', item.note || '']
                        .filter(Boolean)
                        .join(' · ');
                    main.append(createEl(document, 'div', 'migration-sync-item-note', detail));
                }
            }
            li.append(checkbox, main);
            list.append(li);
        }
        return list;
    }

    function renderManualList(items) {
        const list = createEl(document, 'ul', 'migration-sync-list');
        for (const item of items) {
            const identity = resolveItemIdentity(item);
            const li = createEl(document, 'li', 'migration-sync-item');
            li.dataset.syncManual = itemKey(item);
            const main = createEl(document, 'div', 'migration-sync-item-main');
            const top = createEl(document, 'div', 'migration-sync-item-top');
            top.append(
                createEl(document, 'span', '', identity.fullName),
                createEl(document, 'span', 'migration-sync-tag', item.record_kind === 'physical' ? 'Fiziksel' : 'Online')
            );
            const meta = createEl(
                document,
                'div',
                'migration-sync-item-meta',
                `Öğrenci No: ${identity.studentNumber} · Başvuru No: ${item.application_number}`
            );
            const reasonText = MANUAL_REASON_LABELS[item.reason] || item.reason || 'Elle kontrol gerekiyor';
            const reasonEl = createEl(document, 'div', 'migration-sync-item-note', `Neden: ${reasonText}`);
            main.append(top, meta, reasonEl);
            li.append(main);
            list.append(li);
        }
        return list;
    }

    function renderConflictsList(conflicts) {
        const list = createEl(document, 'ul', 'migration-sync-list');
        for (const conflict of conflicts) {
            const li = createEl(document, 'li', 'migration-sync-item');
            li.dataset.syncConflict = `${conflict.record_kind}:${conflict.record_id}`;
            const main = createEl(document, 'div', 'migration-sync-item-main');
            const reasonText = CONFLICT_REASON_LABELS[conflict.reason] || conflict.reason || 'Çakışma';
            main.append(
                createEl(document, 'div', 'migration-sync-item-top', conflict.application_number || conflict.record_id),
                createEl(document, 'div', 'migration-sync-item-note', reasonText)
            );
            li.append(main);
            list.append(li);
        }
        return list;
    }

    function render() {
        body.replaceChildren();
        if (state.loading) {
            body.append(createEl(document, 'p', '', 'Önizleme hazırlanıyor…'));
            updateApplyButtonState();
            return;
        }
        if (state.error && !state.preview) {
            const errBox = createEl(document, 'div', 'migration-sync-banner migration-sync-banner--error', state.error);
            errBox.setAttribute('role', 'alert');
            body.append(errBox);
            updateApplyButtonState();
            return;
        }
        if (state.interruption) {
            const banner = createEl(
                document,
                'div',
                'migration-sync-banner migration-sync-banner--error',
                state.interruption.message
            );
            banner.setAttribute('role', 'alert');
            banner.dataset.syncInterrupted = 'true';
            body.append(banner);
        }
        if (state.result) {
            const summary = createEl(
                document,
                'div',
                `migration-sync-banner ${state.result.conflicts.length > 0 ? 'migration-sync-banner--warning' : 'migration-sync-banner--success'}`,
                `${state.result.applied.length} kayıt güncellendi, ${state.result.conflicts.length} çakışma.`
            );
            summary.setAttribute('role', 'status');
            summary.dataset.syncSummary = 'true';
            body.append(summary);
            if (state.result.conflicts.length > 0) {
                const conflictSection = createEl(document, 'section', 'migration-sync-section');
                conflictSection.append(
                    createEl(document, 'h4', 'migration-sync-section-title', 'Çakışan kayıtlar'),
                    renderConflictsList(state.result.conflicts)
                );
                body.append(conflictSection);
            }
            updateApplyButtonState();
            return;
        }
        if (state.progress) {
            const progWrap = createEl(document, 'div', 'migration-sync-progress-wrap');
            progWrap.setAttribute('role', 'status');
            progWrap.setAttribute('aria-live', 'polite');
            const progressEl = createEl(document, 'progress');
            progressEl.max = Math.max(state.progress.total, 1);
            progressEl.value = state.progress.done;
            const statusText = createEl(
                document,
                'p',
                '',
                `Paket ${state.progress.packet} / ${state.progress.totalPackets} · ${state.progress.done} / ${state.progress.total} kayıt işlendi`
            );
            progWrap.append(progressEl, statusText);
            body.append(progWrap);
        }

        const preview = state.preview;
        if (!preview) {
            updateApplyButtonState();
            return;
        }

        desc.textContent = preview.exported_at
            ? `Aktarım: ${preview.import_id || '—'} · Dışa aktarım tarihi: ${preview.exported_at}`
            : `Aktarım: ${preview.import_id || 'Henüz Excel yüklenmedi'}`;

        const counts = summarizeSyncPlan(preview);
        body.append(renderCounts(counts));

        if (isStaleExport()) {
            const staleBox = createEl(document, 'div', 'migration-sync-banner migration-sync-banner--warning');
            staleBox.setAttribute('role', 'alert');
            staleBox.append(createEl(document, 'div', '', `Bu Excel dışa aktarımı 24 saatten eski (${preview.exported_at}). Güncel bir dosya indirmeniz önerilir.`));
            const label = createEl(document, 'label', 'migration-sync-stale-check');
            const cb = createEl(document, 'input');
            cb.type = 'checkbox';
            cb.checked = state.staleConfirmed;
            cb.disabled = state.applying;
            cb.dataset.syncStaleConfirm = 'true';
            cb.addEventListener('change', () => {
                state.staleConfirmed = cb.checked;
                updateApplyButtonState();
            });
            label.append(cb, createEl(document, 'span', '', 'Dosyanın 24 saatten eski olduğunu biliyorum, yine de uygula'));
            staleBox.append(label);
            body.append(staleBox);
        }

        const changes = preview.changes || [];
        const needsAttention = preview.needsAttention || [];
        const manual = preview.manual || [];

        if (changes.length === 0 && needsAttention.length === 0 && manual.length === 0) {
            body.append(createEl(document, 'p', '', 'İşlenecek değişiklik bulunamadı.'));
            updateApplyButtonState();
            return;
        }

        if (changes.length > 0) {
            const section = createEl(document, 'section', 'migration-sync-section');
            section.dataset.syncGroup = 'changes';
            const head = createEl(document, 'div', 'migration-sync-section-head');
            head.append(createEl(document, 'h4', 'migration-sync-section-title', `Önerilen değişiklikler (${changes.length})`));
            section.append(head, renderSelectableList(changes, 'changes'));
            body.append(section);
        }

        if (needsAttention.length > 0) {
            const section = createEl(document, 'section', 'migration-sync-section');
            section.dataset.syncGroup = 'needsAttention';
            const head = createEl(document, 'div', 'migration-sync-section-head');
            head.append(createEl(document, 'h4', 'migration-sync-section-title', `Henüz Göç'e iletilmemiş görünenler (${needsAttention.length})`));
            const warning = createEl(
                document,
                'div',
                'migration-sync-banner migration-sync-banner--warning',
                'Bu gruptaki kayıtlar portalda henüz Göç İdaresine iletilmemiş görünüyor. Seçilenler önce Göç İdaresine iletildi olarak işaretlenir; online kayıtlarda belgeler de toplu olarak onaylanır.'
            );
            section.append(head, warning, renderSelectableList(needsAttention, 'needsAttention'));
            body.append(section);
        }

        if (manual.length > 0) {
            const section = createEl(document, 'section', 'migration-sync-section');
            section.dataset.syncGroup = 'manual';
            section.append(
                createEl(document, 'h4', 'migration-sync-section-title', `Elle kontrol (${manual.length})`),
                renderManualList(manual)
            );
            body.append(section);
        }

        updateApplyButtonState();
    }

    async function loadPreview({ preserveInterruption = false } = {}) {
        state.loading = true;
        if (!preserveInterruption) {
            state.interruption = null;
            state.result = null;
        }
        render();
        try {
            const preview = await postJson(fetcher, SYNC_PREVIEW_PATH, {});
            state.preview = preview;
            state.selectedKeys = new Set((preview.changes || []).map(itemKey));
            state.staleConfirmed = false;
            state.error = '';
        } catch (error) {
            state.error = error?.message || 'Önizleme yüklenemedi.';
        } finally {
            state.loading = false;
            render();
        }
    }

    async function applySelected() {
        if (state.applying || !state.preview?.import_id) return;
        const allActionable = [
            ...(state.preview.changes || []),
            ...(state.preview.needsAttention || [])
        ];
        const selected = allActionable.filter((item) => state.selectedKeys.has(itemKey(item)));
        if (selected.length === 0) return;
        if (isStaleExport() && !state.staleConfirmed) return;

        const packets = chunkSyncItems(selected, MIGRATION_SYNC_BATCH_SIZE);
        state.applying = true;
        state.interruption = null;
        state.result = null;
        state.progress = { packet: 0, totalPackets: packets.length, done: 0, total: selected.length };
        render();

        const applied = [];
        const conflicts = [];

        for (let index = 0; index < packets.length; index += 1) {
            const packet = packets[index];
            state.progress = {
                packet: index + 1,
                totalPackets: packets.length,
                done: applied.length + conflicts.length,
                total: selected.length
            };
            render();

            try {
                const payload = await postJson(fetcher, SYNC_APPLY_PATH, {
                    import_id: state.preview.import_id,
                    items: packet.map((item) => ({
                        record_kind: item.record_kind,
                        record_id: item.record_id,
                        application_number: item.application_number,
                        version: item.version
                    }))
                });
                if (Array.isArray(payload.applied)) applied.push(...payload.applied);
                if (Array.isArray(payload.conflicts)) conflicts.push(...payload.conflicts);
            } catch (error) {
                state.applying = false;
                state.progress = null;
                state.interruption = {
                    message: `${applied.length} kayıt uygulandıktan sonra aktarım yarıda kaldı (${error?.message || 'Bağlantı hatası'}). Kalan kayıtlar yeniden önizlendi.`,
                    applied,
                    conflicts
                };
                if (applied.length > 0) onApplied?.();
                await loadPreview({ preserveInterruption: true });
                return;
            }
        }

        state.applying = false;
        state.progress = null;
        state.result = { applied, conflicts };
        if (applied.length > 0) onApplied?.();
        render();
    }

    function close() {
        if (state.closed || state.applying) return;
        state.closed = true;
        dialog.removeEventListener('keydown', onKeydown);
        dialog.removeEventListener('cancel', onCancel);
        dialog.removeEventListener('click', onBackdropClick);
        if (dialog.open && typeof dialog.close === 'function') {
            dialog.close();
        } else {
            dialog.removeAttribute('open');
        }
        dialog.remove();
        if (returnFocusTo && returnFocusTo.isConnected && typeof returnFocusTo.focus === 'function') {
            returnFocusTo.focus();
        }
    }

    function onCancel(event) {
        event.preventDefault();
        close();
    }

    function onBackdropClick(event) {
        if (event.target === dialog) {
            close();
        }
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === 'Tab') {
            const focusables = getFocusableElements(dialog);
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey) {
                if (document.activeElement === first || !dialog.contains(document.activeElement)) {
                    event.preventDefault();
                    last.focus();
                }
            } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    headerClose.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    applyBtn.addEventListener('click', () => { void applySelected(); });
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdropClick);
    dialog.addEventListener('keydown', onKeydown);

    if (typeof dialog.showModal === 'function') {
        dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
    headerClose.focus();

    const ready = loadPreview();
    return { dialog, ready, close };
}
