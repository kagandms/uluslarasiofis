const fs = require('fs');

let content = fs.readFileSync('app.js', 'utf8');

const oldDraft = `
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

const newDraft = `
// Draft Auto-Save (Fixed Scope)
function getDraftFields() {
    return {
        basvuruNo: document.getElementById('field-basvuru-no'),
        teslimTarihi: document.getElementById('field-teslim-tarihi'),
        pasaportNo: document.getElementById('field-pasaport-no'),
        adi: document.getElementById('field-adi'),
        soyadi: document.getElementById('field-soyadi'),
        uyrugu: document.getElementById('field-uyrugu'),
        dogumTarihi: document.getElementById('field-dogum-tarihi'),
        adres: document.getElementById('field-adres'),
        tel: document.getElementById('field-tel'),
        mail: document.getElementById('field-mail')
    };
}

function saveDraft() {
    const draft = {};
    const formFields = getDraftFields();
    Object.keys(formFields).forEach(id => {
        if (formFields[id]) draft[id] = formFields[id].value;
    });
    localStorage.setItem('ikamet_draft', JSON.stringify(draft));
}

function restoreDraft() {
    const draftStr = localStorage.getItem('ikamet_draft');
    if (draftStr) {
        try {
            const draft = JSON.parse(draftStr);
            let hasData = false;
            const formFields = getDraftFields();
            Object.keys(draft).forEach(k => {
                if (formFields[k] && draft[k]) {
                    formFields[k].value = draft[k];
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
    const formFields = getDraftFields();
    Object.keys(formFields).forEach(id => {
        if (formFields[id]) {
            formFields[id].addEventListener('input', saveDraft);
            formFields[id].addEventListener('change', saveDraft);
        }
    });
});
`;

content = content.replace(oldDraft.trim(), newDraft.trim());
fs.writeFileSync('app.js', content, 'utf8');
console.log("Draft fixed");
