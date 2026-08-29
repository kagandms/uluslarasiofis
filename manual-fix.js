const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// The block to remove for buttons:
const buttonsBlock = `} else if (this.isDeleteMode) {
                    html += \`<button class="history-btn-secondary" id="btn-history-cancel">İptal</button>\`;
                    html += \`<button class="history-btn-danger" id="btn-history-delete-selected" \${this.selectedIds.size === 0 ? 'disabled' : ''}>🗑️ Seçilenleri Sil (\${this.selectedIds.size})</button>\`;
                } else {
                    html += \`<button class="history-btn-secondary" id="btn-history-delete-mode">Kayıt Seçerek Sil</button>\`;`;

const newButtonsBlock = `} else {`;
code = code.replace(buttonsBlock, newButtonsBlock);

const eventDelegationBlock = `if (this.isDeleteMode) {
                        this.toggleSelection(el.dataset.id);
                        return;
                    }`;
code = code.replace(eventDelegationBlock, '');

const checkboxRenderBlock = `if (this.isTrashMode) {
                        html += \`<button class="history-restore-btn" data-id="\${item.id}" title="Geri Yükle">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                        </button>\`;
                    } else if (this.isDeleteMode) {
                        html += \`<div class="history-checkbox \${this.selectedIds.has(item.id) ? 'selected' : ''}"></div>\`;
                    }`;
const newCheckboxRenderBlock = `if (this.isTrashMode) {
                        html += \`<button class="history-restore-btn" data-id="\${item.id}" title="Geri Yükle">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                        </button>\`;
                    }`;
code = code.replace(checkboxRenderBlock, newCheckboxRenderBlock);

const listenersBlock = `const deleteModeBtn = document.getElementById('btn-history-delete-mode');
            if (deleteModeBtn) {
                deleteModeBtn.addEventListener('click', () => {
                    this.isDeleteMode = true;
                    this.selectedIds.clear();
                    this.render();
                });
            }

            const cancelBtn = document.getElementById('btn-history-cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.isDeleteMode = false;
                    this.selectedIds.clear();
                    this.render();
                });
            }

            const deleteSelectedBtn = document.getElementById('btn-history-delete-selected');
            if (deleteSelectedBtn) {
                deleteSelectedBtn.addEventListener('click', () => {
                    this.deleteSelected();
                });
            }`;
code = code.replace(listenersBlock, '');

fs.writeFileSync('app.js', code);
console.log("Safe replacement done");
