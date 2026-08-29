export function getFormElements() {
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
        mail: document.getElementById('field-mail'),
        uyruguOther: document.getElementById('field-uyrugu-other')
    };
}

export function populateForm(data) {
    const mapping = {
        'basvuruNo': 'basvuruNo',
        'soyadi': 'soyadi',
        'adi': 'adi',
        'uyrugu': 'uyrugu',
        'dogumTarihi': 'dogumTarihi',
        'pasaportNo': 'pasaportNo',
        'adres': 'adres',
        'tel': 'tel',
        'mail': 'mail'
    };

    const fields = getFormElements();
    Object.keys(mapping).forEach(key => {
        if (data[key] && fields[key]) {
            if (key === 'uyrugu') {
                const selectEl = fields.uyrugu;
                let optionExists = false;
                for (let i = 0; i < selectEl.options.length; i++) {
                    if (selectEl.options[i].value === data[key]) {
                        optionExists = true;
                        break;
                    }
                }
                if (optionExists) {
                    selectEl.value = data[key];
                    if (data[key] === 'OTHER') {
                        if(fields.uyruguOther) {
                            fields.uyruguOther.style.display = 'block';
                            fields.uyruguOther.value = data['uyruguOther'] || '';
                        }
                    } else {
                        if(fields.uyruguOther) fields.uyruguOther.style.display = 'none';
                    }
                } else {
                    selectEl.value = 'OTHER';
                    if(fields.uyruguOther) {
                        fields.uyruguOther.style.display = 'block';
                        fields.uyruguOther.value = data['uyruguOther'] || data[key];
                    }
                }
            } else {
                fields[key].value = data[key];
            }
            fields[key].classList.add('field-filled');
        }
    });
}

export function clearFormExceptTeslimTarihi() {
    const fields = getFormElements();
    Object.entries(fields).forEach(([key, field]) => {
        if (!field) return;
        if (key === 'teslimTarihi') return;
        field.value = '';
        field.classList.remove('field-filled');
    });
    if (fields.uyruguOther) {
        fields.uyruguOther.style.display = 'none';
        fields.uyruguOther.value = '';
    }
}

export function clearAllFields() {
    const fields = getFormElements();
    Object.entries(fields).forEach(([key, field]) => {
        if (field) {
            field.value = '';
            field.classList.remove('field-filled');
        }
    });
    if (fields.uyruguOther) {
        fields.uyruguOther.style.display = 'none';
        fields.uyruguOther.value = '';
    }
}

export function setDefaultDeliveryDate() {
    const fields = getFormElements();
    if (!fields.teslimTarihi) return;
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    fields.teslimTarihi.value = `${dd}.${mm}.${yyyy}`;
}

export function getFormData() {
    const fields = getFormElements();
    const data = {};
    Object.entries(fields).forEach(([key, field]) => {
        if (field && key !== 'uyruguOther') {
            data[key] = field.value || '';
        }
    });
    
    if (fields.uyrugu && fields.uyrugu.value === 'OTHER' && fields.uyruguOther) {
        data.uyruguOther = fields.uyruguOther.value || '';
    }
    return data;
}

export function initFormEvents() {
    const fields = getFormElements();
    if (fields.uyrugu && fields.uyruguOther) {
        fields.uyrugu.addEventListener('change', (e) => {
            if (e.target.value === 'OTHER') {
                fields.uyruguOther.style.display = 'block';
                fields.uyruguOther.focus();
            } else {
                fields.uyruguOther.style.display = 'none';
                fields.uyruguOther.value = '';
            }
        });
    }
}
