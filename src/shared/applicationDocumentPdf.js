const STATUS_LABELS = Object.freeze({
    submitted: 'Gönderildi', under_review: 'İncelemede', resubmission_required: 'Yeniden yükleme gerekli',
    approved_for_processing: 'İşleme alınmak üzere onaylandı', sent_to_migration: 'Göç İdaresine aktarıldı',
    migration_approved: 'Göç İdaresi onayladı', completed: 'Tamamlandı', cancelled: 'İptal edildi', rejected: 'Reddedildi'
});
const ADDRESS_LABELS = Object.freeze({
    rental_contract: 'Kira sözleşmesi', residence_certificate: 'Yerleşim yeri belgesi',
    undertaking: 'Taahhütname', own_home: 'Kendi konutu', dormitory: 'Yurt', hotel: 'Otel'
});
const ANSWER_LABELS = Object.freeze({
    yes: 'Evet', no: 'Hayır', system_verified: 'Sistemden doğrulanacak', bilateral_agreement: 'İkili anlaşma',
    gss_pending: 'GSS işlemi bekliyor', both_parents: 'Her iki ebeveyn', divorced: 'Boşanmış',
    deceased: 'Vefat etmiş', single_parent: 'Tek ebeveyn', absent: 'Ulaşılamıyor'
});

function dateLabel(value, includeTime = false) {
    if (!value) return '';
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(value)
        ? new Date(`${value}T12:00:00Z`) : new Date(value);
    if (!Number.isFinite(date.valueOf())) return String(value);
    return new Intl.DateTimeFormat('tr-TR', {
        dateStyle: 'medium', ...(includeTime ? { timeStyle: 'short' } : {}), timeZone: 'Europe/Istanbul'
    }).format(date);
}

function displayValue(value) {
    if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
    return value === null || value === undefined ? '' : String(value).trim();
}

function fieldsFromEntries(entries) {
    return entries.map(([label, value]) => ({ label, value: displayValue(value) })).filter(field => field.value);
}

/** Returns only application fields suitable for the applicant's local PDF copy. */
export function buildApplicationDocumentSections(application) {
    const sections = [
        {
            title: 'Başvuru bilgileri',
            fields: fieldsFromEntries([
                ['Başvuru Referansı', application.reference_number],
                ['Öğrenci No', application.student_number],
                ['Başvuru Durumu', STATUS_LABELS[application.status] || application.status],
                ['Başvuru türü', application.application_type === 'transition' ? 'Geçiş başvurusu'
                    : application.application_type === 'renewal' ? 'Uzatma başvurusu'
                        : application.application_type === 'initial' ? 'İlk başvuru' : ''],
                ['Başvuru Tarihi', dateLabel(application.submitted_at || application.created_at, true)]
            ])
        },
        {
            title: 'Öğrenci ve iletişim bilgileri',
            fields: fieldsFromEntries([
                ['Ad', application.first_name], ['Soyad', application.last_name],
                ['E-posta', application.email || application.student_email], ['Telefon', application.phone || application.student_phone],
                ['Pasaport No', application.passport_number], ['Uyruk', application.nationality],
                ['Doğum tarihi', dateLabel(application.date_of_birth)]
            ])
        },
        {
            title: 'Başvuru ve eğitim bilgileri',
            fields: fieldsFromEntries([
                ['e-İkamet başvuru tarihi', dateLabel(application.residence_application_date)],
                ['Akademik yıl başlangıç tarihi', dateLabel(application.academic_year_start_date)],
                ['Adres belgesi türü', ADDRESS_LABELS[application.address_evidence_type] || application.address_evidence_type],
                ['Sağlık güvencesi', ANSWER_LABELS[application.insurance_basis] || application.insurance_basis],
                ['Ev sahibinin medeni durumu', ANSWER_LABELS[application.host_is_married] || application.host_is_married],
                ['Aile durumu', ANSWER_LABELS[application.minor_family_status] || application.minor_family_status],
                ['Ebeveyn bilgisi', ANSWER_LABELS[application.minor_parents_identified] || application.minor_parents_identified],
                ['Geçiş yabancı kimlik no', application.transition_foreign_id],
                ['Mevcut kart seri no', application.transition_card_serial],
                ['Mevcut kart no', application.transition_card_number],
                ['İkamet ili değişikliği', application.transition_change_province],
                ['Tercih edilen iletişim', application.transition_contact_preference],
                ['18 yaş altı', application.is_under_18]
            ])
        },
        {
            title: 'Beyan ve işlem bilgileri',
            fields: fieldsFromEntries([
                ['Parmak izi durumu', application.fingerprint_status],
                ['Parmak izi kodu', application.fingerprint_code],
                ['Beyan tarihi', dateLabel(application.declaration_accepted_at || application.declaration?.accepted_at, true)],
                ['İletişim teyidi', application.contact_acknowledgement_accepted_current ?? application.contact_acknowledgement?.accepted_current],
                ['İletişim teyit tarihi', dateLabel(application.contact_acknowledgement_accepted_at || application.contact_acknowledgement?.accepted_at, true)]
            ])
        }
    ];
    return sections.filter(section => section.fields.length > 0);
}

function appendText(document, parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
}

/** Builds local-only, textContent-safe A4 page markup for the shared student/staff PDF exporter. */
export function createApplicationDocumentPages(document, application, logos = null) {
    const sections = buildApplicationDocumentSections(application);
    const reference = displayValue(application.reference_number) || displayValue(application.student_number);
    const page = document.createElement('article');
    page.className = 'physical-receipt-sheet online-application-pdf-page';
    page.setAttribute('aria-label', 'Çevrimiçi başvuru formu');
    page.lang = 'tr';
    page.dir = 'ltr';
    const header = document.createElement('header');
    for (const [key, label] of [['university', 'İstanbul Topkapı Üniversitesi'], ['migration', 'Göç İdaresi']]) {
        const image = document.createElement('img');
        image.alt = label;
        image.dataset.documentLogo = key;
        image.src = logos?.[key] || '';
        header.append(image);
    }
    page.append(header);
    appendText(document, page, 'h1', '', 'Çevrimiçi Başvuru Formu');
    appendText(document, page, 'h2', '', 'Başvuru Takip No / Application Reference');
    const referenceCode = appendText(document, page, 'p', 'physical-receipt-code', reference || '—');
    referenceCode.dir = 'ltr';
    for (const section of sections) {
        const group = document.createElement('section');
        group.className = 'online-application-pdf-section';
        appendText(document, group, 'h2', '', section.title);
        const fields = document.createElement('dl');
        fields.className = 'online-application-pdf-fields';
        for (const field of section.fields) {
            const item = document.createElement('div');
            item.className = 'online-application-pdf-field';
            appendText(document, item, 'dt', '', field.label);
            appendText(document, item, 'dd', '', field.value);
            fields.append(item);
        }
        group.append(fields);
        page.append(group);
    }
    appendText(document, page, 'p', 'online-application-pdf-footer', 'Bu belge, başvuru sırasında kaydedilen çevrimiçi bilgilerden oluşturulmuştur.');
    return [page];
}
