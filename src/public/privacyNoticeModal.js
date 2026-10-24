const NOTICE_VERSION = 'topkapi-privacy-summary-v1';
const STORAGE_KEY = 'portal.privacy-notice.acknowledged';
export const OFFICIAL_NOTICE_URL = 'https://www.topkapi.edu.tr/tr-TR/gizlilik-politikasi/13455';

const NOTICE_MESSAGES = Object.freeze({
    tr: {
        title: 'KVKK Aydınlatma Metni', intro: 'İstanbul Topkapı Üniversitesi, başvuru sürecinde kişisel verilerinizi aşağıdaki amaçlarla işler.',
        sections: [
            ['Veri sorumlusu', 'İstanbul Topkapı Üniversitesi.'],
            ['Toplanan bilgiler', 'Kimlik, iletişim, eğitim ve başvuru belgelerinize ait bilgiler.'],
            ['Kullanım amacı', 'Başvurunuzu tamamlamak ve değerlendirmek, durumunu göstermek, eksik veya yeniden istenen belgeleri size bildirmek ve yüklemelerinizi almak.'],
            ['Saklama ve koruma', 'Veriler başvuru süreci ve mevzuatın gerektirdiği süre boyunca saklanır; yetkisiz erişime karşı korunur.'],
            ['Haklarınız ve iletişim', 'KVKK kapsamındaki taleplerinizi kisiselverilerim@topkapi.edu.tr adresine iletebilirsiniz.']
        ], acknowledge: 'Aydınlatma metnini okudum, anladım.', continue: 'Devam et', fullNotice: 'Üniversitenin resmi KVKK metnini aç', close: 'Pencereyi kapat',
        languageLabel: 'Dil seçimi'
    },
    en: {
        title: 'Data Protection Notice', intro: 'İstanbul Topkapı Üniversitesi processes your personal data during the application process for the purposes below.',
        sections: [
            ['Data controller', 'İstanbul Topkapı Üniversitesi.'],
            ['Information collected', 'Identity, contact, education and application document information.'],
            ['Purpose', 'To complete and review your application, show its status, notify you about missing or requested replacement documents, and receive your uploads.'],
            ['Retention and protection', 'Data is kept during the application process and for the period required by law, and protected from unauthorized access.'],
            ['Your rights and contact', 'You can send data protection requests to kisiselverilerim@topkapi.edu.tr.']
        ], acknowledge: 'I have read and understood this notice.', continue: 'Continue', fullNotice: 'Open the university’s official data protection notice', close: 'Close notice',
        languageLabel: 'Language'
    },
    ru: {
        title: 'Уведомление о защите персональных данных', intro: 'İstanbul Topkapı Üniversitesi обрабатывает ваши персональные данные в ходе подачи заявления для указанных ниже целей.',
        sections: [
            ['Оператор данных', 'İstanbul Topkapı Üniversitesi.'],
            ['Собираемые сведения', 'Данные, удостоверяющие личность, контактные данные, сведения об обучении и документы для заявления.'],
            ['Цель обработки', 'Подача и рассмотрение заявления, отображение его статуса, уведомления о недостающих или повторно запрошенных документах и получение загруженных вами файлов.'],
            ['Хранение и защита', 'Данные хранятся во время рассмотрения заявления и в течение срока, установленного законом; они защищаются от несанкционированного доступа.'],
            ['Ваши права и связь', 'Обращения по защите данных можно направить на kisiselverilerim@topkapi.edu.tr.']
        ], acknowledge: 'Я прочитал(а) и понял(а) это уведомление.', continue: 'Продолжить', fullNotice: 'Открыть официальное уведомление университета', close: 'Закрыть уведомление',
        languageLabel: 'Язык'
    },
    tk: {
        title: 'Şahsy maglumatlary goramak barada bildiriş', intro: 'İstanbul Topkapı Üniversitesi arza işiniň dowamynda şahsy maglumatlaryňyzy aşakdaky maksatlar üçin işleýär.',
        sections: [
            ['Maglumatlar üçin jogapkär', 'İstanbul Topkapı Üniversitesi.'],
            ['Ýygnalýan maglumatlar', 'Şahsyýet, aragatnaşyk, bilim we arza resminamalary baradaky maglumatlar.'],
            ['Ulanylyş maksady', 'Arzany tamamlamak we gözden geçirmek, ýagdaýyny görkezmek, ýetmeýän ýa-da täzeden soralan resminamalar barada habar bermek hem-de ýüklän faýllaryňyzy kabul etmek.'],
            ['Saklamak we goramak', 'Maglumatlar arza işiniň dowamynda we kanunda bellenen möhletde saklanýar, rugsatsyz girişden goralýar.'],
            ['Hukuklaryňyz we habarlaşmak', 'Maglumatlary goramak baradaky ýüz tutmalary kisiselverilerim@topkapi.edu.tr salgysyna iberip bilersiňiz.']
        ], acknowledge: 'Bildirişi okadym we düşündim.', continue: 'Dowam et', fullNotice: 'Uniwersitetiň resmi maglumat goragy bildirişini aç', close: 'Bildirişi ýap',
        languageLabel: 'Dil'
    },
    ar: {
        title: 'إشعار حماية البيانات الشخصية', intro: 'تعالج İstanbul Topkapı Üniversitesi بياناتك الشخصية أثناء إجراءات الطلب للأغراض الموضحة أدناه.',
        sections: [
            ['مسؤول البيانات', 'İstanbul Topkapı Üniversitesi.'],
            ['البيانات التي نجمعها', 'بيانات الهوية والاتصال والتعليم والمستندات المتعلقة بالطلب.'],
            ['الغرض من الاستخدام', 'استكمال طلبك ومراجعته، وعرض حالته، وإبلاغك بالمستندات الناقصة أو المطلوبة مرة أخرى، واستلام الملفات التي ترفعها.'],
            ['الاحتفاظ والحماية', 'نحتفظ بالبيانات أثناء معالجة الطلب وللمدة التي يحددها القانون، ونحميها من الوصول غير المصرح به.'],
            ['حقوقك والتواصل', 'يمكنك إرسال طلبات حماية البيانات إلى kisiselverilerim@topkapi.edu.tr.']
        ], acknowledge: 'قرأت هذا الإشعار وفهمته.', continue: 'متابعة', fullNotice: 'افتح إشعار حماية البيانات الرسمي للجامعة', close: 'إغلاق الإشعار',
        languageLabel: 'اللغة'
    }
});

const LANGUAGE_LABELS = Object.freeze({ tr: 'Türkçe', en: 'English', ru: 'Русский', tk: 'Türkmençe', ar: 'العربية' });

function createElement(document, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function renderSections(document, container, locale) {
    const messages = NOTICE_MESSAGES[locale] || NOTICE_MESSAGES.tr;
    container.replaceChildren();
    container.lang = locale;
    container.dir = locale === 'ar' ? 'rtl' : 'ltr';
    messages.sections.forEach(([heading, text]) => {
        const section = createElement(document, 'section', 'privacy-notice-section');
        section.append(createElement(document, 'h3', '', heading), createElement(document, 'p', '', text));
        container.append(section);
    });
}

function buildDialog(document) {
    const dialog = createElement(document, 'dialog', 'privacy-notice-dialog');
    dialog.id = 'privacy-notice-dialog';
    dialog.setAttribute('aria-labelledby', 'privacy-notice-title');

    const header = createElement(document, 'header', 'privacy-notice-header');
    const title = createElement(document, 'h2', '', NOTICE_MESSAGES.tr.title);
    title.id = 'privacy-notice-title';
    const languagePicker = createElement(document, 'nav', 'privacy-notice-languages');
    languagePicker.setAttribute('aria-label', NOTICE_MESSAGES.tr.languageLabel);
    const content = createElement(document, 'div', 'privacy-notice-content');
    content.setAttribute('aria-live', 'polite');
    const intro = createElement(document, 'p', 'privacy-notice-intro', NOTICE_MESSAGES.tr.intro);
    const sections = createElement(document, 'div', 'privacy-notice-sections');
    const fullNoticeLink = createElement(document, 'a', 'privacy-notice-full-link', NOTICE_MESSAGES.tr.fullNotice);
    fullNoticeLink.href = OFFICIAL_NOTICE_URL;
    fullNoticeLink.target = '_blank';
    fullNoticeLink.rel = 'noopener noreferrer';
    content.append(intro, sections, fullNoticeLink);

    const footer = createElement(document, 'footer', 'privacy-notice-footer');
    const label = createElement(document, 'label', 'privacy-notice-acknowledge');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const acknowledgeText = createElement(document, 'span', '', NOTICE_MESSAGES.tr.acknowledge);
    label.append(checkbox, acknowledgeText);
    const continueButton = createElement(document, 'button', 'privacy-notice-continue', NOTICE_MESSAGES.tr.continue);
    continueButton.type = 'button';
    continueButton.disabled = true;
    footer.append(label, continueButton);
    header.append(title, languagePicker);
    dialog.append(header, content, footer);

    return { dialog, title, languagePicker, intro, sections, fullNoticeLink, checkbox, acknowledgeText, continueButton };
}

function setDialogLocale(elements, locale) {
    const selectedLocale = NOTICE_MESSAGES[locale] ? locale : 'tr';
    const messages = NOTICE_MESSAGES[selectedLocale];
    elements.dialog.lang = selectedLocale;
    elements.dialog.dir = selectedLocale === 'ar' ? 'rtl' : 'ltr';
    elements.languagePicker.setAttribute('aria-label', messages.languageLabel);
    elements.title.textContent = messages.title;
    elements.intro.textContent = messages.intro;
    elements.fullNoticeLink.textContent = messages.fullNotice;
    elements.acknowledgeText.textContent = messages.acknowledge;
    elements.continueButton.textContent = messages.continue;
    renderSections(elements.dialog.ownerDocument, elements.sections, selectedLocale);
    elements.languagePicker.querySelectorAll('button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.locale === selectedLocale));
    });
}

function addLanguageButtons(document, elements) {
    Object.entries(LANGUAGE_LABELS).forEach(([locale, label]) => {
        const button = createElement(document, 'button', 'privacy-notice-language', locale.toUpperCase());
        button.type = 'button';
        button.dataset.locale = locale;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => {
            const sitePicker = document.getElementById('locale-select');
            if (sitePicker) {
                sitePicker.value = locale;
                sitePicker.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
            }
            setDialogLocale(elements, locale);
        });
        elements.languagePicker.append(button);
    });
}

function hasAcknowledged(window) {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === NOTICE_VERSION;
    } catch {
        return false;
    }
}

function saveAcknowledgement(window) {
    try {
        window.localStorage.setItem(STORAGE_KEY, NOTICE_VERSION);
    } catch {
        // The notice remains usable when browser storage is unavailable.
    }
}

/**
 * Shows the five-language privacy summary on first home-page entry and makes it available from the footer.
 * @returns {void}
 */
export function initializePrivacyNoticeModal() {
    const browserWindow = globalThis.window;
    if (!browserWindow?.document) return;

    const document = browserWindow.document;
    const openButton = document.getElementById('btn-privacy-notice');
    if (!openButton || document.getElementById('privacy-notice-dialog')) return;

    const elements = buildDialog(document);
    addLanguageButtons(document, elements);
    setDialogLocale(elements, document.documentElement.lang || 'tr');
    document.body.append(elements.dialog);

    elements.checkbox.addEventListener('change', () => {
        elements.continueButton.disabled = !elements.checkbox.checked;
    });
    elements.continueButton.addEventListener('click', () => {
        if (!elements.checkbox.checked) return;
        saveAcknowledgement(browserWindow);
        elements.dialog.close();
    });
    elements.dialog.addEventListener('cancel', (event) => event.preventDefault());
    elements.dialog.addEventListener('close', () => {
        elements.checkbox.checked = false;
        elements.continueButton.disabled = true;
    });
    openButton.addEventListener('click', () => elements.dialog.showModal());

    if (!hasAcknowledged(browserWindow)) elements.dialog.showModal();
}
