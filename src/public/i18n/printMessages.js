export const PRINT_LOCALES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);

export const PRINT_MESSAGES = Object.freeze({
    tr: Object.freeze({
        pageTitle: 'Belge yazdır | İstanbul Topkapı Üniversitesi',
        brandLabel: 'Portal ana sayfa', logoAlt: 'İstanbul Topkapı Üniversitesi',
        eyebrow: 'Uluslararası Öğrenci Ofisi', title: 'Belge yazdır',
        intro: 'Yazdırmak istediğiniz dosyaları ekleyin. Her dosya en fazla 10 MB olabilir.',
        availabilityChecking: 'Yazıcı durumu kontrol ediliyor…', availabilityReady: 'Yazıcı kullanıma hazır.',
        availabilityOffline: 'Yazıcı şu anda çevrimdışı veya kullanılamıyor.',
        guidance: 'Her dosyanın baskı ayarlarını seçin. Yalnızca istediğiniz sayfaları yazdırabilirsiniz.',
        addFile: '+ Dosya Ekle', basketLabel: 'Yazdırma özeti', submit: 'Tümünü Yazdır', submitting: 'Dosyalar gönderiliyor…',
        historyTitle: 'Gönderim durumu', footer: 'İstanbul Topkapı Üniversitesi Uluslararası Öğrenci Ofisi',
        remove: 'Kaldır', removeFile: '{name} dosyasını kaldır', paperSize: 'Kağıt boyutu', paperA4: 'A4',
        printColor: 'Baskı rengi', monochrome: 'Siyah-beyaz', color: 'Renkli', colorUnavailable: 'Renkli · kullanılamıyor',
        orientationLabel: 'Sayfa yönü', portrait: 'Dikey', landscape: 'Yatay', copiesLabel: 'Kopya sayısı',
        pdfPages: 'PDF sayfaları', allPages: 'Tüm sayfalar', customPages: 'Belirli sayfalar',
        pageRangePlaceholder: 'Örn. 1-5,8,12-15', pageRangeLabel: 'Yazdırılacak sayfalar',
        pageRangeHint: '{count} seçili; bir işte en fazla {maximum} sayfa basılabilir.',
        pageRangeReading: 'PDF sayfaları okunuyor…', pageCount: '{count} baskı sayfası',
        pageCountWithLimit: '{count} baskı sayfası · Sınır {maximum}',
        fileCount: ({ count }) => `${count} dosya`, pagesWord: ({ count }) => `${count} sayfa`,
        copiesCount: ({ count }) => `${count} kopya`,
        settingsSummary: ({ paper, color, sides, orientation, copies }) =>
            `${paper} · ${color} · ${sides} · ${orientation} · ${copies}`,
        simplex: 'Tek taraflı', duplex: 'Çift taraflı (uzun kenardan çevir)',
        pdfTypeError: 'PDF, JPG veya PNG dosyası seçin.', fileTooLarge: 'Dosya en fazla 10 MB olabilir.',
        pdfUnreadable: 'PDF sayfaları okunamadı.', pdfReadFailed: 'PDF açılamadı. Şifreli veya bozuk PDF yazdırılamaz.',
        pageCountUnavailable: 'PDF sayfa sayısı okunamadı.', pageRequired: 'Yazdırılacak sayfaları girin.',
        pageFormatInvalid: 'Sayfaları 1-5, 3,7 biçiminde girin.', pageOutOfRange: 'Sayfa numaraları 1 ile {maximum} arasında olmalı.',
        pageDuplicate: 'Aynı sayfa birden fazla seçilemez.', tooManyPages: 'Bir yazdırma işi en fazla {maximum} sayfa olabilir. Daha az sayfa seçin.',
        settingsUnavailable: 'Seçilen baskı ayarı yazıcıda kullanılamıyor.', copyRange: '1 ile {maximum} arasında kopya seçin.',
        uploadFailedUncertain: 'Bu dosya gönderilemedi. İşlemin sonucu belirsizse aynı dosyayı yeniden göndermeyin.',
        rateLimited: 'Güvenlik sınırına ulaşıldı. Kalan dosyaları birkaç dakika sonra gönderin.',
        someFilesFailed: 'Bazı dosyalar gönderilemedi. Sonuçları dosya listesinde kontrol edin.',
        queued: 'Yazdırma sıranız oluşturuldu.', uploadingFile: '“{name}” yükleniyor…',
        statusSubmitted: 'Dosyanız yazıcıya iletildi.',
        statusUnknown: 'İşlemin sonucu henüz doğrulanamadı. Aynı dosyayı yeniden göndermeyin.',
        statusFailed: 'Bu dosya gönderilemedi. Tekrar deneyin.', statusUploading: 'Dosyanız yükleniyor…',
        statusQueued: 'Yazdırma sıranız oluşturuldu.', statusPreparing: 'Yazdırma isteğiniz hazırlanıyor.',
        statusSending: 'Dosyanız yazıcıya gönderiliyor.', statusChecking: 'Gönderim durumu kontrol ediliyor…'
    }),
    en: Object.freeze({
        pageTitle: 'Print a document | Istanbul Topkapi University',
        brandLabel: 'Portal home', logoAlt: 'Istanbul Topkapi University',
        eyebrow: 'International Student Office', title: 'Print a document',
        intro: 'Add the files you want to print. Each file can be up to 10 MB.',
        availabilityChecking: 'Checking printer status…', availabilityReady: 'The printer is ready.',
        availabilityOffline: 'The printer is offline or unavailable right now.',
        guidance: 'Choose print settings for each file. You can print only the pages you need.',
        addFile: '+ Add files', basketLabel: 'Print summary', submit: 'Print all', submitting: 'Sending files…',
        historyTitle: 'Submission status', footer: 'Istanbul Topkapi University International Student Office',
        remove: 'Remove', removeFile: 'Remove {name}', paperSize: 'Paper size', paperA4: 'A4',
        printColor: 'Print color', monochrome: 'Black and white', color: 'Color', colorUnavailable: 'Color · unavailable',
        orientationLabel: 'Page orientation', portrait: 'Portrait', landscape: 'Landscape', copiesLabel: 'Copies',
        pdfPages: 'PDF pages', allPages: 'All pages', customPages: 'Selected pages',
        pageRangePlaceholder: 'e.g. 1-5,8,12-15', pageRangeLabel: 'Pages to print',
        pageRangeHint: '{count} selected; up to {maximum} pages per job.',
        pageRangeReading: 'Reading PDF pages…', pageCount: '{count} print pages',
        pageCountWithLimit: '{count} print pages · Limit {maximum}',
        fileCount: ({ count }) => `${count} ${count === 1 ? 'file' : 'files'}`,
        pagesWord: ({ count }) => `${count} ${count === 1 ? 'page' : 'pages'}`,
        copiesCount: ({ count }) => `${count} ${count === 1 ? 'copy' : 'copies'}`,
        settingsSummary: ({ paper, color, sides, orientation, copies }) =>
            `${paper} · ${color} · ${sides} · ${orientation} · ${copies}`,
        simplex: 'Single-sided', duplex: 'Double-sided (flip on long edge)',
        pdfTypeError: 'Choose a PDF, JPG, or PNG file.', fileTooLarge: 'Each file can be up to 10 MB.',
        pdfUnreadable: 'The PDF pages could not be read.', pdfReadFailed: 'The PDF could not be opened. Encrypted or damaged PDFs cannot be printed.',
        pageCountUnavailable: 'The PDF page count could not be read.', pageRequired: 'Enter the pages to print.',
        pageFormatInvalid: 'Enter pages like 1-5, 3,7.', pageOutOfRange: 'Page numbers must be between 1 and {maximum}.',
        pageDuplicate: 'A page cannot be selected more than once.', tooManyPages: 'A print job can contain up to {maximum} pages. Select fewer pages.',
        settingsUnavailable: 'The selected print setting is unavailable on this printer.', copyRange: 'Choose between 1 and {maximum} copies.',
        uploadFailedUncertain: 'This file could not be submitted. If the result is unclear, do not submit it again.',
        rateLimited: 'The security limit was reached. Send the remaining files in a few minutes.',
        someFilesFailed: 'Some files could not be submitted. Check their status in the file list.',
        queued: 'Your print jobs have been queued.', uploadingFile: 'Uploading “{name}”…',
        statusSubmitted: 'Your file was sent to the printer.',
        statusUnknown: 'The result has not been confirmed yet. Do not submit the same file again.',
        statusFailed: 'This file could not be submitted. Please try again.', statusUploading: 'Your file is uploading…',
        statusQueued: 'Your print job is queued.', statusPreparing: 'Your print request is being prepared.',
        statusSending: 'Your file is being sent to the printer.', statusChecking: 'Checking submission status…'
    }),
    ru: Object.freeze({
        pageTitle: 'Печать документа | Стамбульский университет Топкапы',
        brandLabel: 'На главную портала', logoAlt: 'Стамбульский университет Топкапы',
        eyebrow: 'Офис по работе с иностранными студентами', title: 'Печать документа',
        intro: 'Добавьте файлы для печати. Размер каждого файла — не более 10 МБ.',
        availabilityChecking: 'Проверка состояния принтера…', availabilityReady: 'Принтер готов к работе.',
        availabilityOffline: 'Принтер сейчас отключён или недоступен.',
        guidance: 'Выберите настройки печати для каждого файла. Можно напечатать только нужные страницы.',
        addFile: '+ Добавить файлы', basketLabel: 'Сводка печати', submit: 'Печатать всё', submitting: 'Отправка файлов…',
        historyTitle: 'Состояние отправки', footer: 'Офис по работе с иностранными студентами Стамбульского университета Топкапы',
        remove: 'Удалить', removeFile: 'Удалить файл {name}', paperSize: 'Размер бумаги', paperA4: 'A4',
        printColor: 'Цветность печати', monochrome: 'Чёрно-белая', color: 'Цветная', colorUnavailable: 'Цветная · недоступна',
        orientationLabel: 'Ориентация страницы', portrait: 'Книжная', landscape: 'Альбомная', copiesLabel: 'Количество копий',
        pdfPages: 'Страницы PDF', allPages: 'Все страницы', customPages: 'Выбрать страницы',
        pageRangePlaceholder: 'Например: 1-5,8,12-15', pageRangeLabel: 'Страницы для печати',
        pageRangeHint: 'Выбрано страниц: {count}; максимум в одном задании — {maximum}.',
        pageRangeReading: 'Чтение страниц PDF…', pageCount: 'Страниц для печати: {count}',
        pageCountWithLimit: 'Страниц для печати: {count} · Лимит {maximum}',
        fileCount: ({ count }) => {
            const category = new Intl.PluralRules('ru').select(count);
            return `${count} ${category === 'one' ? 'файл' : category === 'few' ? 'файла' : 'файлов'}`;
        },
        pagesWord: ({ count }) => {
            const category = new Intl.PluralRules('ru').select(count);
            return `${count} ${category === 'one' ? 'страница' : category === 'few' ? 'страницы' : 'страниц'}`;
        },
        copiesCount: ({ count }) => {
            const category = new Intl.PluralRules('ru').select(count);
            return `${count} ${category === 'one' ? 'копия' : category === 'few' ? 'копии' : 'копий'}`;
        },
        settingsSummary: ({ paper, color, sides, orientation, copies }) =>
            `${paper} · ${color} · ${sides} · ${orientation} · ${copies}`,
        simplex: 'Односторонняя', duplex: 'Двусторонняя (переворот по длинному краю)',
        pdfTypeError: 'Выберите файл PDF, JPG или PNG.', fileTooLarge: 'Размер каждого файла не должен превышать 10 МБ.',
        pdfUnreadable: 'Не удалось прочитать страницы PDF.', pdfReadFailed: 'Не удалось открыть PDF. Зашифрованные и повреждённые файлы печатать нельзя.',
        pageCountUnavailable: 'Не удалось определить количество страниц PDF.', pageRequired: 'Укажите страницы для печати.',
        pageFormatInvalid: 'Укажите страницы в формате 1-5, 3,7.', pageOutOfRange: 'Номера страниц должны быть от 1 до {maximum}.',
        pageDuplicate: 'Нельзя выбрать одну страницу несколько раз.', tooManyPages: 'В одном задании можно напечатать не более {maximum} страниц. Выберите меньше страниц.',
        settingsUnavailable: 'Выбранные настройки печати недоступны на этом принтере.', copyRange: 'Выберите от 1 до {maximum} копий.',
        uploadFailedUncertain: 'Не удалось отправить этот файл. Если результат неизвестен, не отправляйте его повторно.',
        rateLimited: 'Достигнут лимит безопасности. Отправьте остальные файлы через несколько минут.',
        someFilesFailed: 'Не удалось отправить некоторые файлы. Проверьте их состояние в списке.',
        queued: 'Задания на печать добавлены в очередь.', uploadingFile: 'Загрузка файла «{name}»…',
        statusSubmitted: 'Файл передан на принтер.',
        statusUnknown: 'Результат пока не подтверждён. Не отправляйте тот же файл повторно.',
        statusFailed: 'Не удалось отправить этот файл. Попробуйте ещё раз.', statusUploading: 'Файл загружается…',
        statusQueued: 'Задание на печать в очереди.', statusPreparing: 'Подготовка задания на печать.',
        statusSending: 'Файл отправляется на принтер.', statusChecking: 'Проверка состояния отправки…'
    }),
    tk: Object.freeze({
        pageTitle: 'Resminamany çap etmek | Stambul Topkapy uniwersiteti',
        brandLabel: 'Portalyň baş sahypasy', logoAlt: 'Stambul Topkapy uniwersiteti',
        eyebrow: 'Halkara talyplar bölümi', title: 'Resminamany çap etmek',
        intro: 'Çap etmek isleýän faýllaryňyzy goşuň. Her faýlyň göwrümi 10 MB-dan köp bolmaly däl.',
        availabilityChecking: 'Printeriň ýagdaýy barlanýar…', availabilityReady: 'Printer çap etmäge taýýar.',
        availabilityOffline: 'Printer häzir öçük ýa-da elýeterli däl.',
        guidance: 'Her faýl üçin çap sazlamalaryny saýlaň. Diňe gerek sahypalaryňyzy çap edip bilersiňiz.',
        addFile: '+ Faýl goş', basketLabel: 'Çap etmegiň gysgaça maglumaty', submit: 'Hemmesini çap et', submitting: 'Faýllar iberilýär…',
        historyTitle: 'Iberiş ýagdaýy', footer: 'Stambul Topkapy uniwersitetiniň Halkara talyplar bölümi',
        remove: 'Aýyr', removeFile: '{name} faýlyny aýyr', paperSize: 'Kagyzyň ölçegi', paperA4: 'A4',
        printColor: 'Çap reňki', monochrome: 'Ak-gara', color: 'Reňkli', colorUnavailable: 'Reňkli · elýeterli däl',
        orientationLabel: 'Sahypanyň ugry', portrait: 'Dik', landscape: 'Kese', copiesLabel: 'Nusga sany',
        pdfPages: 'PDF sahypalary', allPages: 'Ähli sahypalar', customPages: 'Saýlanan sahypalar',
        pageRangePlaceholder: 'Mysal: 1-5,8,12-15', pageRangeLabel: 'Çap edilmeli sahypalar',
        pageRangeHint: '{count} sahypa saýlandy; bir çap işinde iň köp {maximum} sahypa çap edilýär.',
        pageRangeReading: 'PDF sahypalary okalýar…', pageCount: 'Çap sahypalarynyň sany: {count}',
        pageCountWithLimit: 'Çap sahypalarynyň sany: {count} · Çäk {maximum}',
        fileCount: ({ count }) => `${count} faýl`, pagesWord: ({ count }) => `${count} sahypa`,
        copiesCount: ({ count }) => `${count} nusga`,
        settingsSummary: ({ paper, color, sides, orientation, copies }) =>
            `${paper} · ${color} · ${sides} · ${orientation} · ${copies}`,
        simplex: 'Bir taraply', duplex: 'Iki taraply (uzyn gyrasy boýunça öwrüň)',
        pdfTypeError: 'PDF, JPG ýa-da PNG faýlyny saýlaň.', fileTooLarge: 'Her faýlyň göwrümi 10 MB-dan köp bolmaly däl.',
        pdfUnreadable: 'PDF sahypalaryny okap bolmady.', pdfReadFailed: 'PDF açylmady. Parol bilen goralýan ýa-da zeper ýeten PDF çap edilmeýär.',
        pageCountUnavailable: 'PDF sahypalarynyň sanyny anyklap bolmady.', pageRequired: 'Çap edilmeli sahypalary giriziň.',
        pageFormatInvalid: 'Sahypalary 1-5, 3,7 görnüşinde giriziň.', pageOutOfRange: 'Sahypa belgileri 1 bilen {maximum} aralygynda bolmaly.',
        pageDuplicate: 'Bir sahypany birnäçe gezek saýlap bolmaýar.', tooManyPages: 'Bir çap işinde iň köp {maximum} sahypa çap edip bolýar. Has az sahypa saýlaň.',
        settingsUnavailable: 'Saýlanan çap sazlamasy bu printerde elýeterli däl.', copyRange: '1 bilen {maximum} aralygynda nusga sanyny saýlaň.',
        uploadFailedUncertain: 'Faýly iberip bolmady. Netije näbell bolsa, şol faýly gaýtadan ibermäň.',
        rateLimited: 'Howpsuzlyk çägine ýetildi. Galan faýllary birnäçe minutdan soň iberiň.',
        someFilesFailed: 'Käbir faýllary iberip bolmady. Olaryň ýagdaýyny faýl sanawyndan barlaň.',
        queued: 'Çap işleri nobata goşuldy.', uploadingFile: '“{name}” faýly ýüklenýär…',
        statusSubmitted: 'Faýlyňyz printere iberildi.',
        statusUnknown: 'Netije entek tassyklanmady. Şol bir faýly gaýtadan ibermäň.',
        statusFailed: 'Faýly iberip bolmady. Gaýtadan synanyşyň.', statusUploading: 'Faýlyňyz ýüklenýär…',
        statusQueued: 'Çap işiňiz nobatda.', statusPreparing: 'Çap işiňiz taýýarlanylýar.',
        statusSending: 'Faýlyňyz printere iberilýär.', statusChecking: 'Iberiş ýagdaýy barlanýar…'
    }),
    ar: Object.freeze({
        pageTitle: 'طباعة مستند | جامعة إسطنبول توبكابي',
        brandLabel: 'الصفحة الرئيسية للبوابة', logoAlt: 'جامعة إسطنبول توبكابي',
        eyebrow: 'مكتب الطلاب الدوليين', title: 'طباعة مستند',
        intro: 'أضف الملفات التي تريد طباعتها. يجب ألا يتجاوز حجم كل ملف 10 ميغابايت.',
        availabilityChecking: 'جارٍ التحقق من حالة الطابعة…', availabilityReady: 'الطابعة جاهزة للاستخدام.',
        availabilityOffline: 'الطابعة غير متصلة أو غير متاحة حاليًا.',
        guidance: 'اختر إعدادات الطباعة لكل ملف. يمكنك طباعة الصفحات التي تحتاج إليها فقط.',
        addFile: '+ إضافة ملفات', basketLabel: 'ملخص الطباعة', submit: 'طباعة الكل', submitting: 'جارٍ إرسال الملفات…',
        historyTitle: 'حالة الإرسال', footer: 'مكتب الطلاب الدوليين في جامعة إسطنبول توبكابي',
        remove: 'إزالة', removeFile: 'إزالة الملف {name}', paperSize: 'حجم الورق', paperA4: 'A4',
        printColor: 'لون الطباعة', monochrome: 'أبيض وأسود', color: 'ملون', colorUnavailable: 'ملون · غير متاح',
        orientationLabel: 'اتجاه الصفحة', portrait: 'عمودي', landscape: 'أفقي', copiesLabel: 'عدد النسخ',
        pdfPages: 'صفحات PDF', allPages: 'كل الصفحات', customPages: 'صفحات محددة',
        pageRangePlaceholder: 'مثال: 1-5,8,12-15', pageRangeLabel: 'الصفحات المطلوب طباعتها',
        pageRangeHint: 'تم تحديد {count} صفحة؛ الحد الأقصى لكل مهمة هو {maximum} صفحة.',
        pageRangeReading: 'جارٍ قراءة صفحات PDF…', pageCount: 'صفحات الطباعة: {count}',
        pageCountWithLimit: 'صفحات الطباعة: {count} · الحد {maximum}',
        fileCount: ({ count }) => `${count} ${arabicPlural(count, 'ملف', 'ملفان', 'ملفات', 'ملفًا')}`,
        pagesWord: ({ count }) => `${count} ${arabicPlural(count, 'صفحة', 'صفحتان', 'صفحات', 'صفحة')}`,
        copiesCount: ({ count }) => `${count} ${arabicPlural(count, 'نسخة', 'نسختان', 'نسخ', 'نسخة')}`,
        settingsSummary: ({ paper, color, sides, orientation, copies }) =>
            `${paper} · ${color} · ${sides} · ${orientation} · ${copies}`,
        simplex: 'وجه واحد', duplex: 'على الوجهين (قلب على الحافة الطويلة)',
        pdfTypeError: 'اختر ملف PDF أو JPG أو PNG.', fileTooLarge: 'يجب ألا يتجاوز حجم كل ملف 10 ميغابايت.',
        pdfUnreadable: 'تعذرت قراءة صفحات PDF.', pdfReadFailed: 'تعذر فتح PDF. لا يمكن طباعة الملفات المشفرة أو التالفة.',
        pageCountUnavailable: 'تعذر تحديد عدد صفحات PDF.', pageRequired: 'أدخل الصفحات المطلوب طباعتها.',
        pageFormatInvalid: 'أدخل الصفحات بهذا التنسيق: 1-5, 3,7.', pageOutOfRange: 'يجب أن تكون أرقام الصفحات بين 1 و{maximum}.',
        pageDuplicate: 'لا يمكن تحديد الصفحة نفسها أكثر من مرة.', tooManyPages: 'يمكن أن تضم مهمة الطباعة {maximum} صفحة كحد أقصى. اختر صفحات أقل.',
        settingsUnavailable: 'إعداد الطباعة المحدد غير متاح على هذه الطابعة.', copyRange: 'اختر عددًا من النسخ بين 1 و{maximum}.',
        uploadFailedUncertain: 'تعذر إرسال هذا الملف. إذا كانت النتيجة غير مؤكدة، فلا ترسله مرة أخرى.',
        rateLimited: 'تم بلوغ حد الأمان. أرسل الملفات المتبقية بعد بضع دقائق.',
        someFilesFailed: 'تعذر إرسال بعض الملفات. تحقق من حالتها في قائمة الملفات.',
        queued: 'أُضيفت مهام الطباعة إلى قائمة الانتظار.', uploadingFile: 'جارٍ تحميل «{name}»…',
        statusSubmitted: 'أُرسل ملفك إلى الطابعة.',
        statusUnknown: 'لم يتم تأكيد النتيجة بعد. لا ترسل الملف نفسه مرة أخرى.',
        statusFailed: 'تعذر إرسال هذا الملف. حاول مرة أخرى.', statusUploading: 'جارٍ تحميل ملفك…',
        statusQueued: 'مهمة الطباعة في قائمة الانتظار.', statusPreparing: 'جارٍ إعداد طلب الطباعة.',
        statusSending: 'جارٍ إرسال ملفك إلى الطابعة.', statusChecking: 'جارٍ التحقق من حالة الإرسال…'
    })
});

function arabicPlural(count, one, two, few, other) {
    const category = new Intl.PluralRules('ar').select(count);
    if (category === 'one') return one;
    if (category === 'two') return two;
    if (category === 'few') return few;
    return other;
}

export function detectPrintLocale(languages, language) {
    const preferences = Array.isArray(languages) ? [...languages] : [];
    if (typeof language === 'string' && !preferences.includes(language)) preferences.push(language);
    for (const preference of preferences) {
        if (typeof preference !== 'string') continue;
        const normalizedPreference = preference.trim().toLowerCase();
        if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{1,8})*$/.test(normalizedPreference)) continue;
        const primaryLanguage = normalizedPreference.split(/[-_]/)[0];
        if (PRINT_LOCALES.includes(primaryLanguage)) return primaryLanguage;
    }
    return 'en';
}

export function translatePrintMessage(locale, key, params = {}) {
    const message = PRINT_MESSAGES[locale]?.[key] ?? PRINT_MESSAGES.en[key];
    if (typeof message === 'function') return message(params);
    if (typeof message !== 'string') return key;
    return message.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name) => String(params[name] ?? placeholder));
}

export function getPrintMessageKeys() {
    return Object.keys(PRINT_MESSAGES.tr).sort();
}
