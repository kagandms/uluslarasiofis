import { STORAGE_KEYS } from '../config/constants.js';
import { getAllFormsData, renderStudentForms } from '../ui/formManager.js';
import { showToast } from '../ui/toastManager.js';

export function saveDraft() {
    const dataArray = getAllFormsData();
    
    // Check if there is any data other than teslimTarihi across all forms
    let hasData = false;
    dataArray.forEach(data => {
        if (Object.keys(data).some(key => key !== 'teslimTarihi' && data[key].trim() !== '')) {
            hasData = true;
        }
    });
    
    if (hasData) {
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
                // Backward compatibility for single object draft
                dataArray = [dataArray];
            }
            if (dataArray.length > 0 && Object.keys(dataArray[0]).length > 0) {
                if (confirm('Önceki oturumdan kalan kaydedilmemiş form verileriniz var. Geri yüklemek ister misiniz?')) {
                    renderStudentForms(dataArray);
                    showToast('Taslak form başarıyla yüklendi.', 'success');
                } else {
                    localStorage.removeItem(STORAGE_KEYS.DRAFT);
                    renderStudentForms([{}]);
                }
            } else {
                renderStudentForms([{}]);
            }
        } else {
            renderStudentForms([{}]);
        }
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
