import { STORAGE_KEYS } from '../config/constants.js';
import { getFormElements, getFormData, populateForm, clearFormExceptTeslimTarihi } from '../ui/formManager.js';
import { showToast } from '../ui/toastManager.js';

export function saveDraft() {
    const data = getFormData();
    
    // Sadece teslim tarihi olan boş formu kaydetme
    const hasData = Object.keys(data).some(key => key !== 'teslimTarihi' && data[key].trim() !== '');
    
    if (hasData) {
        localStorage.setItem(STORAGE_KEYS.DRAFT, JSON.stringify(data));
    } else {
        localStorage.removeItem(STORAGE_KEYS.DRAFT);
    }
}

export function restoreDraft() {
    try {
        const draftStr = localStorage.getItem(STORAGE_KEYS.DRAFT);
        if (draftStr) {
            const data = JSON.parse(draftStr);
            if (Object.keys(data).length > 0) {
                if (confirm('Önceki oturumdan kalan kaydedilmemiş bir formunuz var. Geri yüklemek ister misiniz?')) {
                    populateForm(data);
                    
                    // Trigger input event to re-save draft
                    const fields = getFormElements();
                    if(fields.basvuruNo) {
                        fields.basvuruNo.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    showToast('Taslak form başarıyla yüklendi.', 'success');
                } else {
                    localStorage.removeItem(STORAGE_KEYS.DRAFT);
                    clearFormExceptTeslimTarihi();
                }
            }
        }
    } catch (e) {
        console.error('Draft okuma hatası:', e);
        localStorage.removeItem(STORAGE_KEYS.DRAFT);
    }
}

export function clearDraft() {
    localStorage.removeItem(STORAGE_KEYS.DRAFT);
}

export function initDraftAutoSave() {
    const fields = getFormElements();
    
    Object.values(fields).forEach(field => {
        if (!field) return;
        field.addEventListener('input', () => {
            if (field.value) field.classList.add('field-filled');
            else field.classList.remove('field-filled');
            saveDraft();
        });
        field.addEventListener('change', saveDraft);
    });
}
