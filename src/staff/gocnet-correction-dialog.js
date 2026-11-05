/** Ask staff to confirm an ambiguous registration number or supply a valid mobile for this attempt. */
export function requestGocnetCorrection(error, previous = {}) {
    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'staff-gocnet-correction-dialog';
        Object.assign(dialog.style, { width: 'min(760px, calc(100% - 2rem))', maxHeight: '90vh', overflow: 'auto',
            border: '0', borderRadius: '.75rem', padding: '1.25rem', color: 'var(--text-primary, #1e293b)',
            boxShadow: '0 16px 48px rgb(15 23 42 / 28%)' });
        dialog.setAttribute('aria-labelledby', 'gocnet-correction-title');
        const form = document.createElement('form');
        form.method = 'dialog';
        Object.assign(form.style, { display: 'grid', gap: '1rem' });
        const title = document.createElement('h2');
        title.id = 'gocnet-correction-title';
        title.textContent = error.code === 'REGISTRATION_NUMBER_CONFIRMATION_REQUIRED'
            ? 'Başvuru kayıt numarasını doğrulayın' : 'Türkiye mobil telefonunu girin';
        form.append(title);

        let objectUrl = null;
        if (error.formFile) {
            objectUrl = URL.createObjectURL(error.formFile);
            const preview = document.createElement(error.formFile.type.startsWith('image/') ? 'img' : 'iframe');
            preview.className = 'staff-gocnet-correction-preview';
            Object.assign(preview.style, { width: '100%', height: 'min(58vh, 620px)', border: '1px solid #cbd5e1', objectFit: 'contain' });
            preview.src = error.formFile.type.startsWith('image/') ? objectUrl : `${objectUrl}#page=1`;
            preview.setAttribute(error.formFile.type.startsWith('image/') ? 'alt' : 'title', 'Başvuru formunun ilk sayfası');
            form.append(preview);
        }

        const fields = {};
        if (error.code === 'REGISTRATION_NUMBER_CONFIRMATION_REQUIRED') {
            const label = document.createElement('label');
            label.textContent = 'E-İkamet kayıt numarası';
            Object.assign(label.style, { display: 'grid', gap: '.4rem', fontWeight: '600' });
            const input = document.createElement('input');
            Object.assign(input.style, { minHeight: '2.75rem', padding: '.5rem' });
            input.type = 'text';
            input.inputMode = 'numeric';
            input.autocomplete = 'off';
            input.required = true;
            input.pattern = '20[0-9]{2}-[0-9]{2}-[0-9]{5,8}';
            input.value = previous.registrationNumberCorrection || '';
            input.setAttribute('aria-describedby', 'gocnet-number-help');
            label.append(input);
            fields.registrationNumberCorrection = input;
            form.append(label);
            if (error.candidates?.length) {
                const select = document.createElement('select');
                Object.assign(select.style, { minHeight: '2.75rem', padding: '.5rem' });
                select.setAttribute('aria-label', 'OCR ile bulunan kayıt numarası adayları');
                const prompt = document.createElement('option');
                prompt.value = '';
                prompt.textContent = 'Bulunan adaylardan seçin';
                select.append(prompt);
                for (const candidate of error.candidates) {
                    const option = document.createElement('option');
                    option.value = candidate;
                    option.textContent = candidate;
                    select.append(option);
                }
                select.addEventListener('change', () => { if (select.value) input.value = select.value; });
                form.append(select);
            }
            const help = document.createElement('p');
            help.id = 'gocnet-number-help';
            help.textContent = error.message;
            form.append(help);
        } else {
            const label = document.createElement('label');
            label.textContent = 'İrtibat telefonu (5XXXXXXXXX veya +90 5XXXXXXXXX)';
            Object.assign(label.style, { display: 'grid', gap: '.4rem', fontWeight: '600' });
            const input = document.createElement('input');
            Object.assign(input.style, { minHeight: '2.75rem', padding: '.5rem' });
            input.type = 'tel';
            input.autocomplete = 'tel-national';
            input.required = true;
            input.value = previous.phoneCorrection || '';
            label.append(input);
            fields.phoneCorrection = input;
            form.append(label);
        }

        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '.75rem' });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'İptal';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Bu denemede kullan';
        actions.append(cancel, submit);
        form.append(actions);
        dialog.append(form);
        document.body.append(dialog);

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            dialog.remove();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            resolve(value);
        };
        cancel.addEventListener('click', () => finish(null));
        dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
        form.addEventListener('submit', (event_) => {
            event_.preventDefault();
            finish(Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.value.trim()])));
        });
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        Object.values(fields)[0]?.focus();
    });
}
