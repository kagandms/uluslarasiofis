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
                    if (normalize(selectEl.options[i].value) === normalizedData) {
                        data[key] = selectEl.options[i].value; // Fix the data to exactly match option value
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
        
        populateFormNode(clone, data);
        container.appendChild(clone);
    });
    
    initDynamicEvents();
}

function initDynamicEvents() {
    const wrappers = document.querySelectorAll('.student-form-wrapper');
    wrappers.forEach(wrapper => {
        const fields = getFormElements(wrapper);
        
        if (fields.uyrugu && fields.uyruguOther) {
            // Remove old listener to avoid duplicates if re-init
            const oldUyrugu = fields.uyrugu.cloneNode(true);
            fields.uyrugu.parentNode.replaceChild(oldUyrugu, fields.uyrugu);
            fields.uyrugu = oldUyrugu; // Update reference
            
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
