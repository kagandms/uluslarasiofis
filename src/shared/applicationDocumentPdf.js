import { formatApplicationTimestamp } from './application-timestamps.js';

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
    if (includeTime) return formatApplicationTimestamp(value) || String(value);
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
const APPLICATION_COVER_COPY = Object.freeze([
    { locale: 'tr', language: 'TR · TÜRKÇE', body: 'Üniversitemiz, öğrencinin teslim ettiği dosyayı inceleyerek Göç İdaresi Başkanlığına iletecektir.', disclaimer: 'Bu belge, ikamet izni başvurusunun onaylandığını göstermez.' },
    { locale: 'en', language: 'EN · ENGLISH', body: 'The University will review the student’s file and forward it to the Presidency of Migration Management.', disclaimer: 'This document does not confirm approval of the residence permit application.' },
    { locale: 'ru', language: 'RU · РУССКИЙ', body: 'Университет проверит документы студента и направит их в Управление по вопросам миграции.', disclaimer: 'Документ не подтверждает одобрение заявления на вид на жительство.' },
    { locale: 'tk', language: 'TK · TÜRKMENÇE', body: 'Uniwersitet talybyň resminamalaryny barlap, Migrasiýa müdirligine iberer.', disclaimer: 'Bu resminama ýaşamak üçin rugsatnama baradaky arzanyň tassyklanandygyny görkezmeýär.' },
    { locale: 'ar', language: 'AR · العربية', body: 'ستراجع الجامعة مستندات الطالب ثم تحيلها إلى رئاسة إدارة الهجرة.', disclaimer: 'هذه الوثيقة لا تؤكد الموافقة على طلب تصريح الإقامة.' }
]);

export const APPLICATION_COVER_STYLES = `
.application-cover-page{position:relative;box-sizing:border-box;width:794px;height:1123px;padding:42px 49px 38px;overflow:hidden;background:#fff;color:#29262c;font-family:Arial,"Receipt Sans",sans-serif;font-size:13px;line-height:1.4}
.application-cover-page:before{content:"";position:absolute;inset:0 0 auto;height:12px;background:#7e1830}
.application-cover-page .cover-header{display:grid;grid-template-columns:151px 1fr 151px;align-items:center;gap:20px;height:101px;margin:0;padding:10px 0 13px;border-bottom:1px solid #e5d9dc}
.application-cover-page .cover-logo{height:76px;border:1px solid #e5d9dc;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#fff}
.application-cover-page .cover-university-logo{flex-direction:column;gap:2px}
.application-cover-page .cover-university-logo img{width:52px;height:52px;object-fit:contain}
.application-cover-page .cover-university-logo span{color:#69656a;font-size:8px;white-space:nowrap}
.application-cover-page .cover-migration-logo img{width:44px;height:70px;object-fit:contain}
.application-cover-page .cover-header-copy{text-align:center}
.application-cover-page .cover-header-copy p{margin:0 0 5px;color:#69656a;font-size:11px;letter-spacing:1.4px}
.application-cover-page .cover-header-copy strong{color:#7e1830;font-size:16px}
.application-cover-page .cover-intro{margin:0;padding:27px 0 22px;border-bottom:2px solid #7e1830}
.application-cover-page .cover-eyebrow{margin:0 0 9px;color:#7e1830;font-size:11px;font-weight:700;letter-spacing:1.6px}
.application-cover-page .cover-intro h1{margin:0;color:#29262c;font-size:31px;line-height:1.15}
.application-cover-page .cover-subtitle{margin:8px 0 0;color:#625e64;font-size:14px}
.application-cover-page .cover-fields{display:grid;grid-template-columns:1.65fr .95fr;gap:18px;margin:22px 0 0}
.application-cover-page .cover-field-panel{min-height:132px;border-radius:11px;padding:16px 19px;background:#f8f5f6}
.application-cover-page .cover-field-label{display:block;margin-bottom:8px;color:#69656a;font-size:10px;font-weight:700;letter-spacing:1px}
.application-cover-page .application-cover-code{box-sizing:border-box;max-width:100%;margin:0;color:#7e1830;font-size:30px;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden}
.application-cover-page .cover-name{display:flex;align-items:baseline;gap:10px;margin-top:15px;color:#69656a;font-size:11px}
.application-cover-page .cover-name strong{overflow:hidden;color:#29262c;font-size:13px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.application-cover-page .cover-tracking{margin:7px 0 0;color:#69656a;font-size:10px}
.application-cover-page .cover-tracking strong{color:#29262c;font-weight:700}
.application-cover-page .cover-delivery{background:#7e1830;color:#fff}
.application-cover-page .cover-delivery .cover-field-label{color:#f1dfe3}
.application-cover-page .cover-choices{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;font-size:13px}
.application-cover-page .cover-choice{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.application-cover-page .cover-choice-box{width:16px;height:16px;border:1.5px solid #fff;border-radius:4px}
.application-cover-page .cover-choice-box[data-selected="true"]{background:#fff;color:#7e1830}
.application-cover-page .cover-choice-box[data-selected="true"]:after{content:"✓";display:block;margin:-2px 0 0 1px;font-size:14px;font-weight:700}
.application-cover-page .cover-delivery-date{display:block;margin-top:20px}
.application-cover-page .cover-date-value{min-height:24px;border-bottom:1px solid #c69aa4;color:#fff;font-size:13px}
.application-cover-page .cover-languages-heading{display:flex;align-items:baseline;justify-content:space-between;margin:22px 0 10px}
.application-cover-page .cover-languages-heading h2{margin:0;color:#29262c;font-size:16px}
.application-cover-page .cover-language-codes{color:#69656a;font-size:10px}
.application-cover-page .cover-language-list{display:grid;gap:8px;margin:0}
.application-cover-page .cover-language-card{min-height:72px;padding:10px 17px 9px;border:1px solid #eadfe2;border-left:5px solid #7e1830;border-radius:9px;background:#fcfafb}
.application-cover-page .cover-language-name{margin:0 0 5px;color:#7e1830;font-size:10px;font-weight:700;letter-spacing:.5px}
.application-cover-page .cover-language-copy{margin:0;color:#29262c;font-size:12px;line-height:1.38}
.application-cover-page .cover-language-copy strong{display:block;margin-top:4px;color:#7e1830;font-weight:700}
.application-cover-page .cover-language-copy[lang="ar"]{direction:rtl;text-align:center;font-family:"Receipt Arabic",Arial,sans-serif;font-size:13px;line-height:1.45}
.application-cover-page .cover-footer{position:absolute;right:49px;bottom:30px;left:49px;display:flex;align-items:center;justify-content:space-between;padding-top:14px;border-top:1px solid #e5d9dc;color:#7e1830;font-size:14px;font-weight:700}
.application-cover-page .cover-site-qr{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:9px;line-height:1.2}
.application-cover-page .cover-site-qr img{display:block;width:72px;height:72px}
.application-cover-page .cover-site-qr a{color:#7e1830;font-size:9px;font-weight:600;text-decoration:none}
`;

/** Creates the shared one-page cover used by online applications and physical intake receipts. */
export function createImmigrationFileCoverPage(document, details, logos, trackingQr) {
    const root = document.createElement('article');
    root.className = 'physical-receipt-sheet application-cover-page';
    root.setAttribute('aria-label', 'İkamet izni başvuru dosyası kapağı');
    root.lang = 'tr';
    root.dir = 'ltr';

    const header = document.createElement('header');
    header.className = 'cover-header';
    const university = document.createElement('div');
    university.className = 'cover-logo cover-university-logo';
    const universityLogo = document.createElement('img');
    universityLogo.src = logos.university;
    universityLogo.alt = 'İstanbul Topkapı Üniversitesi logosu';
    const universityName = document.createElement('span');
    universityName.textContent = 'İstanbul Topkapı Üniversitesi';
    university.append(universityLogo, universityName);
    const heading = document.createElement('div');
    heading.className = 'cover-header-copy';
    appendText(document, heading, 'p', '', 'İKAMET İZNİ BAŞVURU DOSYASI');
    appendText(document, heading, 'strong', '', 'TESLİM VE İNCELEME BİLGİSİ');
    const migration = document.createElement('div');
    migration.className = 'cover-logo cover-migration-logo';
    const migrationLogo = document.createElement('img');
    migrationLogo.src = logos.migration;
    migrationLogo.alt = 'Göç İdaresi Başkanlığı logosu';
    migration.append(migrationLogo);
    header.append(university, heading, migration);
    root.append(header);

    const intro = document.createElement('section');
    intro.className = 'cover-intro';
    appendText(document, intro, 'p', 'cover-eyebrow', 'İKAMET İZNİ İŞLEMLERİ');
    appendText(document, intro, 'h1', '', 'Başvuru Dosyası');
    appendText(document, intro, 'p', 'cover-subtitle', 'Öğrenci dosyasının teslim ve değerlendirme sürecine ilişkin bilgilendirme');
    root.append(intro);

    const fields = document.createElement('section');
    fields.className = 'cover-fields';
    const identity = document.createElement('div');
    identity.className = 'cover-field-panel';
    appendText(document, identity, 'span', 'cover-field-label', 'ÖĞRENCİ KODU');
    const code = appendText(document, identity, 'p', 'application-cover-code', displayValue(details.studentCode) || '—');
    code.dir = 'ltr';
    const name = document.createElement('div');
    name.className = 'cover-name';
    appendText(document, name, 'span', '', 'Ad Soyad');
    appendText(document, name, 'strong', '', [details.firstName, details.lastName].map(displayValue).filter(Boolean).join(' ') || '—');
    identity.append(name);
    if (details.trackingReference) {
        const tracking = document.createElement('p');
        tracking.className = 'cover-tracking';
        tracking.append(document.createTextNode('Başvuru Takip No: '));
        appendText(document, tracking, 'strong', '', details.trackingReference);
        identity.append(tracking);
    }
    const delivery = document.createElement('div');
    delivery.className = 'cover-field-panel cover-delivery';
    appendText(document, delivery, 'span', 'cover-field-label', 'TESLİM ŞEKLİ');
    const choices = document.createElement('div');
    choices.className = 'cover-choices';
    for (const [key, label] of [['online', 'Online'], ['physical', 'Fiziksel']]) {
        const choice = document.createElement('span');
        choice.className = 'cover-choice';
        const box = document.createElement('span');
        box.className = 'cover-choice-box';
        box.dataset.selected = String(details.deliveryMethod === key);
        choice.append(box, document.createTextNode(label));
        choices.append(choice);
    }
    delivery.append(choices);
    const date = document.createElement('div');
    date.className = 'cover-delivery-date';
    appendText(document, date, 'span', 'cover-field-label', 'TESLİM TARİHİ');
    appendText(document, date, 'div', 'cover-date-value', dateLabel(details.deliveryDate) || '—');
    delivery.append(date);
    fields.append(identity, delivery);
    root.append(fields);

    const languagesHeading = document.createElement('div');
    languagesHeading.className = 'cover-languages-heading';
    appendText(document, languagesHeading, 'h2', '', 'Dosyanın işlem süreci');
    appendText(document, languagesHeading, 'span', 'cover-language-codes', 'TR · EN · RU · TK · AR');
    root.append(languagesHeading);
    const languageList = document.createElement('section');
    languageList.className = 'cover-language-list';
    for (const translation of APPLICATION_COVER_COPY) {
        const card = document.createElement('article');
        card.className = 'cover-language-card';
        appendText(document, card, 'h3', 'cover-language-name', translation.language);
        const copy = appendText(document, card, 'p', 'cover-language-copy', translation.body);
        copy.lang = translation.locale;
        if (translation.locale === 'ar') copy.dir = 'rtl';
        appendText(document, copy, 'strong', '', translation.disclaimer);
        languageList.append(card);
    }
    root.append(languageList);

    const footer = document.createElement('footer');
    footer.className = 'cover-footer';
    appendText(document, footer, 'div', '', 'İstanbul Topkapı Üniversitesi');
    if (trackingQr) {
        const siteQr = document.createElement('div');
        siteQr.className = 'cover-site-qr';
        const qr = document.createElement('img');
        qr.src = trackingQr;
        qr.alt = 'Başvuru sitesinin QR kodu';
        const link = appendText(document, siteQr, 'a', 'physical-receipt-origin', 'Başvuru sitesi');
        link.href = details.portalOrigin;
        link.dir = 'ltr';
        siteQr.prepend(qr);
        footer.append(siteQr);
    }
    root.append(footer);
    return root;
}

/** Shrinks an overlong student code just enough to keep it on a single line. */
export function fitApplicationCoverCode(root) {
    const code = root.querySelector('.application-cover-code');
    if (!code) return;
    const view = root.ownerDocument.defaultView;
    const canvas = root.ownerDocument.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!view || !context) return;
    const style = view.getComputedStyle(code);
    const fontSize = Number.parseFloat(style.fontSize);
    context.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    const measuredWidth = context.measureText(code.textContent || '').width;
    const availableWidth = code.clientWidth;
    if (measuredWidth > availableWidth && availableWidth > 0) {
        code.style.fontSize = `${Math.max(10, fontSize * availableWidth / measuredWidth)}px`;
    }
}

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
