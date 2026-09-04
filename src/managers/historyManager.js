import { STORAGE_KEYS, HISTORY_MAX_DAYS } from '../config/constants.js';
import { getFormDataFromNode, getFormElements } from '../ui/formManager.js';
import { setActiveStep, STEP_IDS } from '../ui/stepWizard.js';
import { showToast } from '../ui/toastManager.js';

export const historyManager = {
    isDeleteMode: false,
    isTrashMode: false,
    selectedIds: new Set(),
    searchQuery: '',
    getAll() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]'); } catch { return []; }
    },
    getTrashAll() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.TRASH) || '[]'); } catch { return []; }
    },
    saveTrash(items) {
        const trash = this.getTrashAll();
        const now = new Date().toISOString();
        items.forEach(i => { i.deletedAt = now; trash.unshift(i); });
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);
        const filtered = trash.filter(t => new Date(t.deletedAt || t.timestamp) > cutoff);
        localStorage.setItem(STORAGE_KEYS.TRASH, JSON.stringify(filtered));
    },
    restoreFromTrash(id) {
        const trash = this.getTrashAll();
        const entry = trash.find(t => t.id === id);
        if (entry) {
            const history = this.getAll();
            delete entry.deletedAt;
            history.unshift(entry);
            history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
            const remaining = trash.filter(t => t.id !== id);
            localStorage.setItem(STORAGE_KEYS.TRASH, JSON.stringify(remaining));
            this.render();
        }
    },
    emptyTrash() {
        localStorage.removeItem(STORAGE_KEYS.TRASH);
        this.render();
    },
    save(action, data) {
        const now = new Date();
        const entry = {
            id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: now.toISOString(),
            date: `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`,
            time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
            action: action, // 'pdf' veya 'print'
            fields: data || {}
        };

        const history = this.getAll();
        history.unshift(entry); 

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);
        const filtered = history.filter(h => new Date(h.timestamp) > cutoff);

        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(filtered));
        this.render();
    },
    toggleSelection(id) {
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
        } else {
            this.selectedIds.add(id);
        }
        this.render();
    },
    deleteSelected() {
        const history = this.getAll();
        const toDelete = history.filter(h => this.selectedIds.has(h.id));
        if (toDelete.length > 0) this.saveTrash(toDelete);

        const remaining = history.filter(h => !this.selectedIds.has(h.id));
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(remaining));
        this.selectedIds.clear();
        this.isDeleteMode = false;
        this.render();
    },
    deleteEntry(id) {
        const history = this.getAll();
        const entry = history.find(h => h.id === id);
        if (entry) this.saveTrash([entry]);

        const remaining = history.filter(h => h.id !== id);
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(remaining));
        this.render();
    },
    clearAll() {
        const history = this.getAll();
        if (history.length > 0) this.saveTrash(history);
        localStorage.removeItem(STORAGE_KEYS.HISTORY);
        this.render();
    },
    getTodayCount() {
        const today = new Date();
        const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
        return this.getAll().filter(h => h.date === todayStr).length;
    },
    getGroupedByDate(sourceArray) {
        const history = sourceArray || this.getAll();
        const groups = {};
        history.forEach(h => {
            if (!groups[h.date]) groups[h.date] = [];
            groups[h.date].push(h);
        });
        return groups;
    },
    _formatDateLabel(dateStr) {
        const today = new Date();
        const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = `${String(yesterday.getDate()).padStart(2, '0')}.${String(yesterday.getMonth() + 1).padStart(2, '0')}.${yesterday.getFullYear()}`;

        if (dateStr === todayStr) return 'Bugün';
        if (dateStr === yesterdayStr) return 'Dün';
        return dateStr;
    },
    restore(id) {
        const entry = this.getAll().find(h => h.id === id);
        if (!entry || !entry.fields) return;

        const fields = getFormElements();
        Object.entries(entry.fields).forEach(([key, value]) => {
            if (key === 'uyruguOther') return;
            const field = fields[key];
            if (!field) return;
            field.value = value;
            if (value) field.classList.add('field-filled');
            else field.classList.remove('field-filled');
        });

        if (fields.uyruguOther) {
            if (entry.fields.uyrugu === 'OTHER' && entry.fields.uyruguOther) {
                fields.uyruguOther.value = entry.fields.uyruguOther;
                fields.uyruguOther.style.display = 'block';
            } else {
                fields.uyruguOther.value = '';
                fields.uyruguOther.style.display = 'none';
            }
        }

        // State reset for cropper and file upload would need to be handled by orchestrator, 
        // but we trigger step change here. We will dispatch a custom event so main.js can clear image states.
        window.dispatchEvent(new CustomEvent('historyRestore'));
        
        setActiveStep(STEP_IDS.FORM_RESULT);
        
        const name = [entry.fields.adi, entry.fields.soyadi].filter(Boolean).join(' ') || 'Kayıt';
        showToast(`${name} bilgileri yüklendi.`, 'success');
    },
    render() {
        const todayCount = this.getTodayCount();
        let allItems = this.isTrashMode ? this.getTrashAll() : this.getAll();

        // Apply search filter
        if (this.searchQuery && this.searchQuery.length >= 1) {
            const q = this.searchQuery.toLocaleLowerCase('tr-TR');
            allItems = allItems.filter(item => {
                const name = `${item.fields.adi || ''} ${item.fields.soyadi || ''}`.toLocaleLowerCase('tr-TR');
                const basvuruNo = (item.fields.basvuruNo || '').toLocaleLowerCase('tr-TR');
                const pasaportNo = (item.fields.pasaportNo || '').toLocaleLowerCase('tr-TR');
                return name.includes(q) || basvuruNo.includes(q) || pasaportNo.includes(q);
            });
        }

        const groups = this.getGroupedByDate(allItems);
        const totalCount = allItems.length;
        const trashCount = this.getTrashAll().length;

        const badge = document.getElementById('history-today-badge');
        if (badge) {
            badge.textContent = `Bugün: ${todayCount}`;
            badge.style.display = todayCount > 0 ? 'inline-flex' : 'none';
        }

        const dailyCounterCount = document.getElementById('daily-counter-count');
        const dailyCounterDate = document.getElementById('daily-counter-date');
        if (dailyCounterCount && dailyCounterDate) {
            dailyCounterCount.textContent = todayCount;
            const today = new Date();
            const dd = String(today.getDate()).padStart(2, '0');
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            dailyCounterDate.textContent = `${dd}.${mm}.${yyyy}`;
        }

        const panel = document.getElementById('history-panel');
        if (!panel) return;

        const header = panel.querySelector('.history-header');
        const body = panel.querySelector('.history-body');
        if (!header || !body) return;

        const countEl = header.querySelector('.history-count');
        if (countEl) {
            if (this.isTrashMode) {
                countEl.textContent = 'Çöp Kutusu';
            } else {
                countEl.textContent = todayCount > 0 ? `Bugün: ${todayCount} işlem` : 'Henüz işlem yok';
            }
        }

        // Build search box HTML (only in normal mode, not trash mode)
        const allRawItems = this.isTrashMode ? this.getTrashAll() : this.getAll();
        const searchBoxHtml = !this.isTrashMode && allRawItems.length > 0 ? `
            <div class="history-search-box" style="position: relative; margin-bottom: 12px;">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="var(--text-secondary)" stroke-width="2" fill="none" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                    <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input id="history-search-input" type="text" placeholder="İsim, başvuru no veya pasaport ile ara..." 
                    value="${this.searchQuery.replace(/"/g, '&quot;')}"
                    style="width: 100%; padding: 7px 30px 7px 30px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--bg-color); color: var(--text-primary); font-size: 0.82rem; outline: none; box-sizing: border-box;">
                ${this.searchQuery ? `<button id="history-search-clear" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-secondary); padding: 2px; display: flex; align-items: center;">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>` : ''}
            </div>` : '';

        if (totalCount === 0) {
            if (this.isTrashMode) {
                body.innerHTML = '<p class="history-empty">Çöp kutusu boş.</p>';
                body.innerHTML += '<div class="history-actions-row"><button class="history-btn-secondary" id="btn-history-back">← Geri Dön</button></div>';
            } else if (allRawItems.length === 0) {
                body.innerHTML = '<p class="history-empty">Henüz kayıt bulunmuyor. PDF indirdiğinizde veya yazdırdığınızda burada görünecek.</p>';
                if (trashCount > 0) {
                    body.innerHTML += `<div class="history-actions-row" style="margin-top:15px;"><button class="history-btn-secondary" id="btn-history-trash">🗑️ Çöp Kutusu (${trashCount})</button></div>`;
                }
            } else {
                // Has records but search found nothing
                body.innerHTML = searchBoxHtml + `<p class="history-empty">🔍 "<strong>${this.searchQuery}</strong>" için kayıt bulunamadı.</p>`;
            }
        } else {
            let html = searchBoxHtml;
            const dates = Object.keys(groups);
            dates.forEach(date => {
                const label = this._formatDateLabel(date);
                const items = groups[date];
                html += `<div class="history-date-group">
                    <div class="history-date-title">
                        <span>${label}</span>
                        <span class="history-date-count">${items.length} kayıt</span>
                    </div>`;
                
                items.forEach(item => {
                    const name = [item.fields.adi, item.fields.soyadi].filter(Boolean).join(' ') || '—';
                    const basvuruNo = item.fields.basvuruNo || '';
                    let uyruk = item.fields.uyrugu || '';
                    if (uyruk === 'OTHER' && item.fields.uyruguOther) uyruk = item.fields.uyruguOther;
                    const actionIcon = item.action === 'pdf' ? '📄' : '🖨️';
                    const actionLabel = item.action === 'pdf' ? 'PDF' : 'Yazdır';
                    const isSelected = this.selectedIds.has(item.id);
                    const selectedClass = isSelected ? 'selected' : '';
                    
                    const checkboxHtml = this.isDeleteMode ? `
                        <div class="history-checkbox ${selectedClass}">
                            ${isSelected ? '✓' : ''}
                        </div>
                    ` : '';

                    const itemActionBtn = this.isTrashMode 
                        ? `<button class="history-restore-btn" data-restore-id="${item.id}" title="Geri Yükle">↺</button>`
                        : (!this.isDeleteMode ? `<button class="history-delete-btn" data-delete-id="${item.id}" title="Sil">✕</button>` : '');

                    html += `<div class="history-item ${this.isDeleteMode ? 'delete-mode' : ''} ${selectedClass}" data-id="${item.id}" title="${this.isDeleteMode ? 'Seç / Bırak' : (this.isTrashMode ? 'Geri yüklemek için yandaki butonu kullanın' : 'Tıkla → formu doldur')}">
                        ${checkboxHtml}
                        <div class="history-item-content">
                            <div class="history-item-main">
                                <span class="history-item-name">${name}</span>
                                <span class="history-item-time">${actionIcon} ${item.time}</span>
                            </div>
                            <div class="history-item-detail">
                                ${basvuruNo ? `<span>${basvuruNo}</span>` : ''}
                                ${uyruk ? `<span>• ${uyruk}</span>` : ''}
                                <span class="history-item-action-label">${actionLabel}</span>
                            </div>
                        </div>
                        ${itemActionBtn}
                    </div>`;
                });
                html += '</div>';
            });

            html += `<div class="history-actions-row">`;
            if (this.isTrashMode) {
                html += `<button class="history-btn-secondary" id="btn-history-back">← Geri Dön</button>`;
                html += `<button class="history-btn-danger" id="btn-history-empty-trash">💥 Çöp Kutusunu Boşalt</button>`;
            } else {
                if (trashCount > 0) {
                    html += `<button class="history-btn-secondary" id="btn-history-trash">🗑️ Çöp Kutusu (${trashCount})</button>`;
                }
                html += `<button class="history-btn-danger" id="btn-history-clear">🗑️ Tümünü Temizle</button>`;
            }
            html += `</div>`;
            body.innerHTML = html;
        }

        // Wire up search input
        const searchInput = body.querySelector('#history-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.render();
                // Re-focus and restore cursor position
                const newInput = body.querySelector('#history-search-input');
                if (newInput) {
                    const len = newInput.value.length;
                    newInput.focus();
                    newInput.setSelectionRange(len, len);
                }
            });
            searchInput.addEventListener('focus', (e) => {
                e.target.style.borderColor = 'var(--accent)';
            });
            searchInput.addEventListener('blur', (e) => {
                e.target.style.borderColor = 'var(--card-border)';
            });
        }

        const searchClearBtn = body.querySelector('#history-search-clear');
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', () => {
                this.searchQuery = '';
                this.render();
                const newInput = body.querySelector('#history-search-input');
                if (newInput) newInput.focus();
            });
        }

        // Event delegation
        body.querySelectorAll('.history-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.history-delete-btn') || e.target.closest('.history-restore-btn')) return;
                if (this.isTrashMode) return; 
                if (this.isDeleteMode) {
                    this.toggleSelection(el.dataset.id);
                } else {
                    this.restore(el.dataset.id);
                }
            });
        });

        body.querySelectorAll('.history-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteEntry(btn.dataset.deleteId);
            });
        });

        body.querySelectorAll('.history-restore-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.restoreFromTrash(btn.dataset.restoreId);
                showToast('Kayıt geçmişe geri yüklendi.', 'info');
            });
        });

        const clearBtn = document.getElementById('btn-history-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Tüm geçmiş çöp kutusuna taşınacak. Emin misiniz?')) {
                    this.clearAll();
                }
            });
        }

        const emptyTrashBtn = document.getElementById('btn-history-empty-trash');
        if (emptyTrashBtn) {
            emptyTrashBtn.addEventListener('click', () => {
                if (confirm('Çöp kutusu tamamen boşaltılacak ve geri alınamayacak. Emin misiniz?')) {
                    this.emptyTrash();
                }
            });
        }
        
        const backBtn = document.getElementById('btn-history-back');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.isTrashMode = false;
                this.render();
            });
        }

        const trashBtn = document.getElementById('btn-history-trash');
        if (trashBtn) {
            trashBtn.addEventListener('click', () => {
                this.isTrashMode = true;
                this.isDeleteMode = false;
                this.selectedIds.clear();
                this.render();
            });
        }
    }
};

export function initHistoryPanel() {
    const toggle = document.getElementById('history-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const body = document.querySelector('.history-body');
            const icon = document.querySelector('.history-toggle-icon');
            if (!body || !icon) return;
            
            if (body.classList.contains('open')) {
                body.classList.remove('open');
                icon.textContent = '▼';
            } else {
                body.classList.add('open');
                icon.textContent = '▲';
            }
        });
    }
    historyManager.render();
}
