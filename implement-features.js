const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');
let swJs = fs.readFileSync('sw.js', 'utf8');

// 1. CTRL+P Handler & 4. Smart Internet Check & 2. Draft Auto-Save
const newFeatures = `
// --- OFFLINE AND SHORTCUT HANDLERS ---
function updateOnlineStatus() {
    const btnUpload = document.getElementById('btn-upload');
    if (!navigator.onLine) {
        if(btnUpload) {
            btnUpload.disabled = true;
            btnUpload.style.opacity = '0.5';
            btnUpload.title = "İnternet bağlantısı koptu. Tarama yapılamaz.";
        }
        showToast('İnternet yok. Tarama yapılamaz, manuel giriş yapabilirsiniz.', 'warning');
    } else {
        if(btnUpload) {
            btnUpload.disabled = false;
            btnUpload.style.opacity = '1';
            btnUpload.title = "";
        }
    }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
window.addEventListener('DOMContentLoaded', updateOnlineStatus);

// Intercept Ctrl+P / Cmd+P
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const step3 = document.getElementById('step-3');
        if (step3 && step3.classList.contains('active')) {
            const btnPrint = document.getElementById('btn-print');
            if (btnPrint) btnPrint.click();
        } else {
            showToast('Yazdırmak için önce bir form hazırlamalısınız.', 'info');
        }
    }
});

// Draft Auto-Save
function saveDraft() {
    const draft = {};
    const fieldIds = ['basvuruNo', 'teslimTarihi', 'pasaportNo', 'adi', 'soyadi', 'uyrugu', 'dogumTarihi', 'adres', 'tel', 'mail'];
    fieldIds.forEach(id => {
        if (fields[id]) draft[id] = fields[id].value;
    });
    localStorage.setItem('ikamet_draft', JSON.stringify(draft));
}

function restoreDraft() {
    const draftStr = localStorage.getItem('ikamet_draft');
    if (draftStr) {
        try {
            const draft = JSON.parse(draftStr);
            let hasData = false;
            Object.keys(draft).forEach(k => {
                if (fields[k] && draft[k]) {
                    fields[k].value = draft[k];
                    hasData = true;
                }
            });
            if (hasData) {
                showToast('Kaldığınız yerden devam ediyorsunuz (Taslak yüklendi).', 'info');
            }
        } catch(e) {}
    }
}

// Bind save draft to inputs
document.addEventListener('DOMContentLoaded', () => {
    const fieldIds = ['basvuruNo', 'teslimTarihi', 'pasaportNo', 'adi', 'soyadi', 'uyrugu', 'dogumTarihi', 'adres', 'tel', 'mail'];
    fieldIds.forEach(id => {
        if (fields[id]) {
            fields[id].addEventListener('input', saveDraft);
            fields[id].addEventListener('change', saveDraft);
        }
    });
});
`;

// Insert new features at the end of app.js
appJs += '\n' + newFeatures;

// We need to call restoreDraft when Manuel Giriş is clicked or Step 3 is activated
// Actually, let's just intercept btn-manual-entry click to restore draft.
const manualEntrySearch = `btnManualEntry.addEventListener('click', () => {`;
const manualEntryReplace = `btnManualEntry.addEventListener('click', () => {
            restoreDraft();`;
appJs = appJs.replace(manualEntrySearch, manualEntryReplace);

// Let's also restore draft when they clear the form (they shouldn't restore draft on clear!)
// Wait, if they click Temizle, we should clear the draft.
const btnClearSearch = `btnClear.addEventListener('click', () => {`;
const btnClearReplace = `btnClear.addEventListener('click', () => {
            localStorage.removeItem('ikamet_draft');`;
appJs = appJs.replace(btnClearSearch, btnClearReplace);

// Let's also clear draft when they go home
const goToStep1Search = `function resetApp() {`;
const goToStep1Replace = `function resetApp() {
        localStorage.removeItem('ikamet_draft');`;
appJs = appJs.replace(goToStep1Search, goToStep1Replace);

fs.writeFileSync('app.js', appJs);

// 3. Update sw.js for True Offline
const swSearch = `'./goc_logo.png'`;
const swReplace = `'./goc_logo.png',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js'`;

swJs = swJs.replace(swSearch, swReplace);
swJs = swJs.replace('ikamet-ocr-v2.0', 'ikamet-ocr-v2.0.1');

fs.writeFileSync('sw.js', swJs);

console.log('Features injected.');
