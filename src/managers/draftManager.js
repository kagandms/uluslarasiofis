import { STORAGE_KEYS } from '../config/constants.js';
import { getAllFormsData, renderStudentForms } from '../ui/formManager.js';
import { showToast } from '../ui/toastManager.js';

export function hasActualDraftData(dataArray) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) return false;
    const defaultBasvuruYear = `${new Date().getFullYear()}-`;
    return dataArray.some(data => {
        if (!data || typeof data !== 'object') return false;
        return Object.entries(data).some(([key, val]) => {
            if (!val || typeof val !== 'string') return false;
            const trimmed = val.trim();
            if (!trimmed) return false;
            if (key === 'teslimTarihi') return false;
            if (key === 'basvuruNo' && (trimmed === defaultBasvuruYear || trimmed === `${new Date().getFullYear()}`)) return false;
            return true;
        });
    });
}

export function saveDraft() {
    const dataArray = getAllFormsData();
    if (hasActualDraftData(dataArray)) {
        localStorage.setItem(STORAGE_KEYS.DRAFT, JSON.stringify(dataArray));
    } else {
        localStorage.removeItem(STORAGE_KEYS.DRAFT);
    }
}

export function restoreDraft() {
    try {
        const draftStr = localStorage.getItem(STORAGE_KEYS.DRAFT);
        if (draftStr) {
            let dataArray = JSON.parse(draftStr);
            if (!Array.isArray(dataArray)) {
                dataArray = [dataArray];
            }
            if (hasActualDraftData(dataArray)) {
                if (confirm('Önceki oturumdan kalan kaydedilmemiş form verileriniz var. Geri yüklemek ister misiniz?')) {
                    renderStudentForms(dataArray);
                    showToast('Taslak form başarıyla yüklendi.', 'success');
                    return;
                } else {
                    localStorage.removeItem(STORAGE_KEYS.DRAFT);
                }
            }
        }
        renderStudentForms([{}]);
    } catch (e) {
        console.error('Draft okuma hatası:', e);
        localStorage.removeItem(STORAGE_KEYS.DRAFT);
        renderStudentForms([{}]);
    }
}

export function clearDraft() {
    localStorage.removeItem(STORAGE_KEYS.DRAFT);
}

export function initDraftAutoSave() {
    window.addEventListener('formChanged', saveDraft);
}
