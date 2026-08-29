const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');

const oldRestore = `function restoreDraft() {
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
}`;

const newRestore = `function restoreDraft() {
    const draftStr = localStorage.getItem('ikamet_draft');
    if (draftStr) {
        try {
            const draft = JSON.parse(draftStr);
            let hasData = false;
            Object.keys(draft).forEach(k => {
                if (draft[k] && draft[k].trim() !== '') hasData = true;
            });
            
            if (hasData) {
                if (confirm('Yarım kalan bir form taslağınız bulundu. Kaldığınız yerden devam etmek ister misiniz?')) {
                    const formFields = getDraftFields();
                    Object.keys(draft).forEach(k => {
                        if (formFields[k] && draft[k]) {
                            formFields[k].value = draft[k];
                        }
                    });
                    showToast('Taslak yüklendi.', 'info');
                } else {
                    localStorage.removeItem('ikamet_draft');
                }
            }
        } catch(e) {}
    }
}`;

if (appJs.includes(oldRestore)) {
    appJs = appJs.replace(oldRestore, newRestore);
    fs.writeFileSync('app.js', appJs);
    console.log("Draft prompt added");
} else {
    console.log("Could not find old restoreDraft function");
}
