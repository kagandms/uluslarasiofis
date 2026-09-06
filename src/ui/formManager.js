export function formatApplicationNumberInput(value, fallbackYear = String(new Date().getFullYear())) {
    const digits = value.replace(/\D/g, '').slice(0, 14);
    const hasYearPrefix = /^20\d{2}/.test(digits);
    const year = hasYearPrefix ? digits.slice(0, 4) : fallbackYear;
    const numberPart = hasYearPrefix ? digits.slice(4) : digits;
    const branch = numberPart.slice(0, 2);
    const sequence = numberPart.slice(2, 10);

    if (!branch) return `${year}-`;
    if (!sequence) return `${year}-${branch}`;
    return `${year}-${branch}-${sequence}`;
}

export function getFormElements(node = document) {
    return {
        basvuruNo: node.querySelector('[data-field="basvuru-no"]'),
        teslimTarihi: node.querySelector('[data-field="teslim-tarihi"]'),
        pasaportNo: node.querySelector('[data-field="pasaport-no"]'),
        adi: node.querySelector('[data-field="adi"]'),
        soyadi: node.querySelector('[data-field="soyadi"]'),
        uyrugu: node.querySelector('[data-field="uyrugu"]'),
        dogumTarihi: node.querySelector('[data-field="dogum-tarihi"]'),
        adres: node.querySelector('[data-field="adres"]'),
        tel: node.querySelector('[data-field="tel"]'),
        mail: node.querySelector('[data-field="mail"]'),
        uyruguOther: node.querySelector('[data-field="uyrugu-other"]')
    };
}

export function getAllFormsData() {
    const wrappers = document.querySelectorAll('.student-form-wrapper');
    const dataArray = [];
    wrappers.forEach(wrapper => {
        dataArray.push(getFormDataFromNode(wrapper));
    });
    return dataArray;
}

export function getFormDataFromNode(node) {
    const fields = getFormElements(node);
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

export function populateFormNode(node, data) {
    const mapping = {
        'basvuruNo': 'basvuruNo',
        'soyadi': 'soyadi',
        'adi': 'adi',
        'uyrugu': 'uyrugu',
        'dogumTarihi': 'dogumTarihi',
        'pasaportNo': 'pasaportNo',
        'adres': 'adres',
        'tel': 'tel',
        'mail': 'mail',
        'teslimTarihi': 'teslimTarihi'
    };

    const fields = getFormElements(node);
    Object.keys(mapping).forEach(key => {
        if (data[key] !== undefined && fields[key]) {
            if (key === 'uyrugu') {
                const selectEl = fields.uyrugu;
                let optionExists = false;
                
                const normalize = (str) => str ? str.toLocaleUpperCase('tr-TR').replace(/[UÜ]/g, 'U').replace(/[Iİ]/g, 'I').replace(/[OÖ]/g, 'O').replace(/[GĞ]/g, 'G').replace(/[SŞ]/g, 'S').replace(/[CÇ]/g, 'C').trim() : '';
                const normalizedData = normalize(data[key]);

                for (let i = 0; i < selectEl.options.length; i++) {
                    selectEl.options[i].removeAttribute('selected'); // Ensure no other option has it
                    if (normalize(selectEl.options[i].value) === normalizedData) {
                        data[key] = selectEl.options[i].value; // Fix the data to exactly match option value
                        selectEl.options[i].selected = true;
                        selectEl.options[i].setAttribute('selected', 'selected'); // Set attribute so it survives appendChild
                        optionExists = true;
                    }
                }
                if (optionExists) {
                    selectEl.value = data[key];
                    if(fields.uyruguOther) fields.uyruguOther.style.display = 'none';
                } else {
                    selectEl.value = 'OTHER';
                    for (let i = 0; i < selectEl.options.length; i++) {
                        if (selectEl.options[i].value === 'OTHER') {
                            selectEl.options[i].selected = true;
                            selectEl.options[i].setAttribute('selected', 'selected');
                        }
                    }
                    if(fields.uyruguOther) {
                        fields.uyruguOther.style.display = 'block';
                        fields.uyruguOther.value = data['uyruguOther'] || data[key];
                    }
                    if (fields.basvuruNo) fields.basvuruNo.value = "UYRUK BULUNAMADI: " + data[key];
                }
            } else {
                fields[key].value = data[key];
            }
            if (fields[key].value) {
                fields[key].classList.add('field-filled');
            }
        }
    });
}

export function renderStudentForms(studentsDataArray) {
    const container = document.getElementById('students-forms-container');
    const template = document.getElementById('student-form-template');
    if (!container || !template) return;
    
    container.innerHTML = '';
    
    if (!studentsDataArray || studentsDataArray.length === 0) {
        studentsDataArray = [{}];
    }
    
    studentsDataArray.forEach((data, index) => {
        const clone = template.content.cloneNode(true);
        const formWrapper = clone.querySelector('.student-form-wrapper');
        formWrapper.dataset.index = index;
        
        const title = clone.querySelector('.student-form-title');
        if (data.adi || data.soyadi) {
            title.textContent = `${index + 1}. Öğrenci - ${data.adi || ''} ${data.soyadi || ''}`;
        } else {
            title.textContent = `${index + 1}. Öğrenci`;
        }
        
        // Ensure teslim tarihi is set if empty
        if (!data.teslimTarihi) {
            const today = new Date();
            const dd = String(today.getDate()).padStart(2, '0');
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            data.teslimTarihi = `${dd}.${mm}.${yyyy}`;
        }
        
        // Başvuru no default format
        if (!data.basvuruNo) {
            data.basvuruNo = `${new Date().getFullYear()}-`;
        }
        
        populateFormNode(clone, data);
        
        const btnRetake1 = clone.querySelector('.btn-retake-page1');
        const btnRecrop1 = clone.querySelector('.btn-recrop-page1');
        const btnRetake2 = clone.querySelector('.btn-retake-page2');
        const btnRecrop2 = clone.querySelector('.btn-recrop-page2');

        // Eğer manuel girilmişse (resim yoksa) bu butonların bulunduğu kapsayıcıyı (veya butonları) gizle
        if (!data._page1Record) {
            if (btnRetake1) {
                btnRetake1.style.display = 'none';
                if (btnRetake1.parentElement) btnRetake1.parentElement.style.display = 'none';
            }
            if (btnRecrop1) btnRecrop1.style.display = 'none';
        } else {
            if (btnRetake1) btnRetake1.addEventListener('click', () => window.dispatchEvent(new CustomEvent('requestRetake', { detail: { index, page: 1 } })));
            if (btnRecrop1) btnRecrop1.addEventListener('click', () => window.dispatchEvent(new CustomEvent('requestRecrop', { detail: { index, page: 1, record: data._page1Record } })));
        }

        if (!data._page2Record) {
            if (btnRetake2) {
                btnRetake2.style.display = 'none';
                if (btnRetake2.parentElement) btnRetake2.parentElement.style.display = 'none';
            }
            if (btnRecrop2) btnRecrop2.style.display = 'none';
        } else {
            if (btnRetake2) btnRetake2.addEventListener('click', () => window.dispatchEvent(new CustomEvent('requestRetake', { detail: { index, page: 2 } })));
            if (btnRecrop2) btnRecrop2.addEventListener('click', () => window.dispatchEvent(new CustomEvent('requestRecrop', { detail: { index, page: 2, record: data._page2Record } })));
        }
        
        container.appendChild(clone);
    });
    
    const lastWrapper = container.lastElementChild;
    if (lastWrapper) {
        lastWrapper.style.marginBottom = '0';
        lastWrapper.style.borderBottom = 'none';
        lastWrapper.style.paddingBottom = '0';
    }
    
    initDynamicEvents();
}

function initDynamicEvents() {
    const wrappers = document.querySelectorAll('.student-form-wrapper');
    wrappers.forEach(wrapper => {
        const fields = getFormElements(wrapper);
        
        if (fields.basvuruNo) {
            fields.basvuruNo.addEventListener('input', (e) => {
                e.target.value = formatApplicationNumberInput(e.target.value);
            });
            
            fields.basvuruNo.addEventListener('focus', (e) => {
                const defaultValue = `${new Date().getFullYear()}-`;
                if (!e.target.value || e.target.value === defaultValue) {
                    e.target.value = defaultValue;
                    setTimeout(() => {
                        e.target.setSelectionRange(e.target.value.length, e.target.value.length);
                    }, 0);
                }
            });
            
            // Format mevcut değeri (OCR'dan gelenler veya default değer)
            if (fields.basvuruNo.value) {
                fields.basvuruNo.dispatchEvent(new Event('input'));
            }
        }
        
        if (fields.dogumTarihi) {
            fields.dogumTarihi.addEventListener('input', (e) => {
                let val = e.target.value.replace(/\D/g, '');
                if (val.length > 8) val = val.substring(0, 8);
                
                let formatted = '';
                if (val.length > 0) formatted += val.substring(0, 2);
                if (val.length > 2) formatted += '/' + val.substring(2, 4);
                if (val.length > 4) formatted += '/' + val.substring(4, 8);
                
                e.target.value = formatted;
            });
            
            if (fields.dogumTarihi.value) {
                fields.dogumTarihi.dispatchEvent(new Event('input'));
            }
        }
        
        if (fields.uyrugu && fields.uyruguOther) {
            // Remove existing listeners by cloning (must preserve value which is lost during cloneNode)
            const currentValue = fields.uyrugu.value;
            const oldUyrugu = fields.uyrugu.cloneNode(true);
            fields.uyrugu.parentNode.replaceChild(oldUyrugu, fields.uyrugu);
            fields.uyrugu = oldUyrugu; // Update reference
            fields.uyrugu.value = currentValue; // Restore value
            
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
        
        // Trigger draft save on inputs
        Object.values(fields).forEach(field => {
            if (!field) return;
            field.addEventListener('input', () => {
                if (field.type === 'text') {
                    const start = field.selectionStart;
                    const end = field.selectionEnd;
                    
                    if (field.dataset.field === 'mail') {
                        field.value = field.value.toLocaleLowerCase('en-US');
                    } else if (!['dogum-tarihi', 'tel', 'teslim-tarihi', 'basvuru-no'].includes(field.dataset.field)) {
                        field.value = field.value.toLocaleUpperCase('tr-TR');
                    }
                    
                    if (start !== null) {
                        try { field.setSelectionRange(start, end); } catch(e) {}
                    }
                }
                
                if (field.value) field.classList.add('field-filled');
                else field.classList.remove('field-filled');
                window.dispatchEvent(new Event('formChanged'));
            });
            field.addEventListener('change', () => {
                window.dispatchEvent(new Event('formChanged'));
            });
        });
    });
}
