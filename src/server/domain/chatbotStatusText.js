import { CHATBOT_LANGUAGES } from './chatbotKnowledge.js';

/**
 * Fixed localized labels for every application status returned by createTrackingApplicationDto.
 */
export const APPLICATION_STATUS_LABELS = Object.freeze({
    tr: Object.freeze({
        draft: 'Taslak',
        submitted: 'Gönderildi',
        under_review: 'İncelemede',
        resubmission_required: 'Belge yeniden gönderilmeli',
        approved_for_processing: 'İşleme alınmak üzere onaylandı',
        sent_to_migration: 'Göç İdaresine gönderildi',
        migration_approved: 'Göç İdaresi onayladı',
        completed: 'Tamamlandı',
        cancelled: 'İptal edildi',
        rejected: 'Reddedildi'
    }),
    en: Object.freeze({
        draft: 'Draft',
        submitted: 'Submitted',
        under_review: 'Under review',
        resubmission_required: 'Document resubmission required',
        approved_for_processing: 'Approved for processing',
        sent_to_migration: 'Sent to Migration Authority',
        migration_approved: 'Approved by Migration Authority',
        completed: 'Completed',
        cancelled: 'Cancelled',
        rejected: 'Rejected'
    }),
    ru: Object.freeze({
        draft: 'Черновик',
        submitted: 'Отправлена',
        under_review: 'На рассмотрении',
        resubmission_required: 'Требуется повторно отправить документ',
        approved_for_processing: 'Одобрена для обработки',
        sent_to_migration: 'Передана в Миграционное управление',
        migration_approved: 'Одобрена Миграционным управлением',
        completed: 'Завершена',
        cancelled: 'Отменена',
        rejected: 'Отклонена'
    }),
    tk: Object.freeze({
        draft: 'Taslama',
        submitted: 'Iberildi',
        under_review: 'Gözden geçirilýär',
        resubmission_required: 'Resminama täzeden iberilmeli',
        approved_for_processing: 'Işlemek üçin tassyklandy',
        sent_to_migration: 'Migrasiýa edarasyna iberildi',
        migration_approved: 'Migrasiýa edarasy tarapyndan tassyklandy',
        completed: 'Tamamlandy',
        cancelled: 'Ýatyryldy',
        rejected: 'Ret edildi'
    }),
    ar: Object.freeze({
        draft: 'مسودة',
        submitted: 'تم الإرسال',
        under_review: 'قيد المراجعة',
        resubmission_required: 'يلزم إعادة إرسال المستند',
        approved_for_processing: 'تمت الموافقة للمعالجة',
        sent_to_migration: 'أُرسل إلى إدارة الهجرة',
        migration_approved: 'وافقت إدارة الهجرة',
        completed: 'مكتمل',
        cancelled: 'ملغى',
        rejected: 'مرفوض'
    })
});

/**
 * Fixed localized responses for not-found, unknown-status, and multi-reference status queries.
 */
export const CHATBOT_STATUS_FIXED_TEXTS = Object.freeze({
    notFound: Object.freeze({
        tr: 'Bu başvuru numarasıyla görüntülenebilir bir başvuru bulunamadı. Numarayı kontrol edip tekrar deneyebilir veya ana sayfadaki soru formunu kullanarak Uluslararası Öğrenci Ofisine ulaşabilirsiniz.',
        en: 'No application was found for this reference number. Please check the number and try again, or use the question form on the home page to contact the International Student Office.',
        ru: 'По этому номеру заявки не найдено доступного для просмотра заявления. Проверьте номер и повторите попытку или обратитесь в Международный студенческий офис через форму вопросов на главной странице.',
        tk: 'Bu arza belgisi boýunça görkezilip bilinjek arza tapylmady. Belgini barlap gaýtadan synanyşyň ýa-da baş sahypadaky sorag formasy arkaly Halkara talyplar ofisine ýüz tutuň.',
        ar: 'لم يتم العثور على طلب متاح للعرض بهذا الرقم المرجعي. يرجى التحقق من الرقم والمحاولة مرة أخرى، أو استخدام نموذج الأسئلة في الصفحة الرئيسية للتواصل مع مكتب الطلاب الدوليين.'
    }),
    unknownStatus: Object.freeze({
        tr: 'Başvurunuz işlem sürecindedir. Güncel durum ve ayrıntılar için /basvurum/ sayfasını inceleyebilirsiniz.',
        en: 'Your application is in progress. Please see /basvurum/ for current details.',
        ru: 'Ваша заявка находится в обработке. Актуальные подробности можно посмотреть на странице /basvurum/.',
        tk: 'Arzaňyz işlenýär. Häzirki jikme-jik maglumatlar üçin /basvurum/ sahypasyny görüň.',
        ar: 'طلبك قيد المعالجة. يرجى مراجعة صفحة /basvurum/ للاطلاع على التفاصيل الحالية.'
    }),
    multipleReferences: Object.freeze({
        tr: 'Lütfen tek seferde yalnızca bir başvuru numarası (örneğin ITU-XXXX-XXXX) gönderin.',
        en: 'Please send only one application reference number at a time (for example, ITU-XXXX-XXXX).',
        ru: 'Пожалуйста, отправляйте за один раз только один номер заявки (например, ITU-XXXX-XXXX).',
        tk: 'Bir gezekde diňe bir arza belgisini (mysal üçin, ITU-XXXX-XXXX) iberiň.',
        ar: 'يرجى إرسال رقم مرجعي واحد فقط للطلب في كل مرة (مثال: ITU-XXXX-XXXX).'
    })
});

const STATUS_SUMMARY_TEMPLATES = Object.freeze({
    tr: (statusLabel, counts) =>
        `Başvuru durumu: ${statusLabel}. Belgeler: ${counts.approved} onaylandı, ${counts.waiting} inceleme bekliyor, ${counts.actionNeeded} işlem gerektiriyor. Ayrıntılar ve belge mesajları için /basvurum/ sayfasını inceleyebilirsiniz.`,
    en: (statusLabel, counts) =>
        `Application status: ${statusLabel}. Documents: ${counts.approved} approved, ${counts.waiting} waiting for review, ${counts.actionNeeded} needing action. You can view full details and office messages on /basvurum/.`,
    ru: (statusLabel, counts) =>
        `Статус заявки: ${statusLabel}. Документы: ${counts.approved} одобрено, ${counts.waiting} ожидают проверки, ${counts.actionNeeded} требуют действий. Подробности и сообщения офиса доступны на странице /basvurum/.`,
    tk: (statusLabel, counts) =>
        `Arzanyň ýagdaýy: ${statusLabel}. Resminamalar: ${counts.approved} tassyklandy, ${counts.waiting} barlaga garaşýar, ${counts.actionNeeded} hereket talap edýär. Jikme-jik maglumatlar we ofis habarlary üçin /basvurum/ sahypasyny görüň.`,
    ar: (statusLabel, counts) =>
        `حالة الطلب: ${statusLabel}. المستندات: ${counts.approved} تمت الموافقة عليها، ${counts.waiting} بانتظار المراجعة، ${counts.actionNeeded} تتطلب إجراءً. يمكنك الاطلاع على التفاصيل الكاملة ورسائل المكتب في صفحة /basvurum/.`
});

const STATUS_SUMMARY_PREFIXES = Object.freeze({
    tr: 'Başvuru durumu: ',
    en: 'Application status: ',
    ru: 'Статус заявки: ',
    tk: 'Arzanyň ýagdaýy: ',
    ar: 'حالة الطلب: '
});

// DRAFT: needs office approval
export const STATUS_NEXT_STEP_TEXTS = Object.freeze({
    draft: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Başvurunuz henüz taslak aşamasındadır ve Uluslararası Öğrenci Ofisine gönderilmemiştir. Başvurunuzu tamamlayıp göndermek için ITU başvuru numaranız ve öğrenci numaranızla /basvuruya-devam-et/ sayfasından devam edin.',
        // DRAFT: needs office approval
        en: 'Your application is still a draft and has not been submitted to the International Student Office yet. Continue via /basvuruya-devam-et/ using your ITU application number and student number to complete and submit it.',
        // DRAFT: needs office approval
        ru: 'Ваша заявка всё ещё находится в статусе черновика и пока не отправлена в Международный студенческий офис. Чтобы завершить и отправить её, перейдите на страницу /basvuruya-devam-et/ с номером ITU и номером студента.',
        // DRAFT: needs office approval
        tk: 'Arzaňyz heniz taslama tapgyrynda we Halkara talyplar ofisine iberilmedi. Onuň doldurylyşyny tamamlap ibermek üçin ITU arza belgiňiz we talyp belgiňiz bilen /basvuruya-devam-et/ sahypasyndan dowam ediň.',
        // DRAFT: needs office approval
        ar: 'طلبك لا يزال في مرحلة المسودة ولم يُرسل بعد إلى مكتب الطلاب الدوليين. للمتابعة وإكمال الطلب وإرساله، استخدم صفحة /basvuruya-devam-et/ برقم الطلب ITU ورقم الطالب.'
    }),
    submitted: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Başvurunuz Uluslararası Öğrenci Ofisine iletilmiştir ve inceleme sırasındadır; şu an yapmanız gereken ek bir işlem yoktur. Güncel durum ve olası ofis mesajları için /basvurum/ sayfasını takip edebilirsiniz.',
        // DRAFT: needs office approval
        en: 'Your application has been submitted to the International Student Office and is waiting for review; no action is needed from you right now. You can follow /basvurum/ for updates and any office messages.',
        // DRAFT: needs office approval
        ru: 'Ваша заявка отправлена в Международный студенческий офис и ожидает проверки; сейчас от вас не требуется дополнительных действий. Следите за обновлениями и возможными сообщениями офиса на странице /basvurum/.',
        // DRAFT: needs office approval
        tk: 'Arzaňyz Halkara talyplar ofisine iberildi we barlaga garaşýar; häzirki wagtda sizden goşmaça hereket talap edilmeýär. Täzelikleri we ofis habarlaryny /basvurum/ sahypasyndan yzarlap bilersiňiz.',
        // DRAFT: needs office approval
        ar: 'تم إرسال طلبك إلى مكتب الطلاب الدوليين وهو بانتظار المراجعة، ولا يلزمك القيام بأي إجراء إضافي حالياً. يمكنك متابعة التحديثات وأي رسائل من المكتب عبر صفحة /basvurum/.'
    }),
    under_review: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Başvurunuz ve belgeleriniz şu anda Uluslararası Öğrenci Ofisi tarafından incelenmektedir; ek bir belge istenmedikçe yapmanız gereken bir işlem yoktur. Gelişmeler ve ofis notları için /basvurum/ sayfasını kontrol edebilirsiniz.',
        // DRAFT: needs office approval
        en: 'The International Student Office is currently reviewing your application and documents; no action is needed unless a document update is requested. Check /basvurum/ for updates and office messages.',
        // DRAFT: needs office approval
        ru: 'Международный студенческий офис сейчас проверяет вашу заявку и документы; никаких действий не требуется, если только не будет запрошено обновление документа. Проверяйте ход рассмотрения и сообщения офиса на странице /basvurum/.',
        // DRAFT: needs office approval
        tk: 'Arzaňyz we resminamalaryňyz häzir Halkara talyplar ofisi tarapyndan gözden geçirilýär; resminama täzelenmegi soralmasa, etmeli işiňiz ýokdur. Öňegidişlik we ofis bellikleri üçin /basvurum/ sahypasyny barlaň.',
        // DRAFT: needs office approval
        ar: 'يقوم مكتب الطلاب الدوليين حالياً بمراجعة طلبك ومستنداتك، ولا يلزمك القيام بأي إجراء ما لم يُطلب منك تحديث مستند. تابع التطورات وملاحظات المكتب عبر صفحة /basvurum/.'
    }),
    resubmission_required: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Ofis, incelemenin devam edebilmesi için bir veya daha fazla belgenin yeniden yüklenmesini istemiştir. ITU başvuru numaranız ve öğrenci numaranızla /basvurum/ sayfasına girip ofis açıklamasını okuyun ve yalnızca istenen belge kartından yeni dosyayı yükleyin.',
        // DRAFT: needs office approval
        en: 'The office has requested a replacement upload for one or more documents before review can continue. Sign in on /basvurum/ with your ITU application number and student number, read the office message, and upload the requested document there.',
        // DRAFT: needs office approval
        ru: 'Офис запросил повторную загрузку одного или нескольких документов, чтобы продолжить проверку. Войдите на страницу /basvurum/ с номером ITU и номером студента, прочитайте комментарий офиса и загрузите запрашиваемый документ.',
        // DRAFT: needs office approval
        tk: 'Barlagyň dowam etmegi üçin ofis bir ýa-da birnäçe resminamany täzeden ýüklemegi sorady. ITU arza belgiňiz we talyp belgiňiz bilen /basvurum/ sahypasyna girip, ofis belliklerini okaň we soralan resminamany şol ýerden ýükläň.',
        // DRAFT: needs office approval
        ar: 'طلب المكتب إعادة رفع مستند واحد أو أكثر حتى تتمكن المراجعة من الاستمرار. سجّل الدخول في صفحة /basvurum/ برقم الطلب ITU ورقم الطالب، واقرأ ملاحظة المكتب، ثم ارفع المستند المطلوب هناك.'
    }),
    approved_for_processing: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Belgeleriniz Uluslararası Öğrenci Ofisi tarafından işleme alınmak üzere onaylanmıştır ve dosyanız Göç İdaresine iletilmeyi beklemektedir. Şu an yapmanız gereken bir işlem yoktur; güncellemeleri /basvurum/ sayfasından izleyebilirsiniz.',
        // DRAFT: needs office approval
        en: 'Your documents have been approved for processing by the International Student Office and your file is awaiting forwarding to the Migration Authority. No action is needed from you right now; follow /basvurum/ for updates.',
        // DRAFT: needs office approval
        ru: 'Ваши документы одобрены Международным студенческим офисом для обработки, и дело ожидает передачи в Миграционное управление. Сейчас от вас ничего не требуется; отслеживайте обновления на странице /basvurum/.',
        // DRAFT: needs office approval
        tk: 'Resminamalaryňyz Halkara talyplar ofisi tarapyndan işlemek üçin tassyklandy we faýlyňyz Migrasiýa edarasyna iberilmäge garaşýar. Häzir sizden hereket talap edilmeýär; täzelikleri /basvurum/ sahypasyndan yzarlaň.',
        // DRAFT: needs office approval
        ar: 'تمت الموافقة على مستنداتك للمعالجة من قِبل مكتب الطلاب الدوليين، وينتظر ملفك الإحالة إلى إدارة الهجرة. لا يلزمك أي إجراء حالياً؛ تابع التحديثات عبر صفحة /basvurum/.'
    }),
    sent_to_migration: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Dosyanız Göç İdaresine iletilmiştir; ikamet izni kararı yalnızca Göç İdaresine aittir. Bu aşamada portal üzerinden yapmanız gereken başka bir işlem yoktur; güncellemeleri /basvurum/ sayfasından takip edebilirsiniz.',
        // DRAFT: needs office approval
        en: 'Your file is with the Migration Authority (Göç İdaresi), and the residence permit decision belongs solely to it. No further action is needed from you on this portal; you can follow /basvurum/ for updates.',
        // DRAFT: needs office approval
        ru: 'Ваше дело передано в Миграционное управление (Göç İdaresi), и решение по ВНЖ принимает исключительно оно. На этом этапе от вас больше не требуется действий на портале; следите за обновлениями на странице /basvurum/.',
        // DRAFT: needs office approval
        tk: 'Faýlyňyz Migrasiýa edarasyna (Göç İdaresi) iberildi we ýaşaýyş rugsady boýunça karar diňe şol edara degişlidir. Bu tapgyrda portalda sizden başga hereket talap edilmeýär; täzelikleri /basvurum/ sahypasyndan yzarlap bilersiňiz.',
        // DRAFT: needs office approval
        ar: 'ملفك لدى إدارة الهجرة (Göç İdaresi)، وقرار تصريح الإقامة يعود لها وحدها. لا يُطلب منك أي إجراء إضافي عبر البوابة في هذه المرحلة؛ ويمكنك متابعة التحديثات في صفحة /basvurum/.'
    }),
    migration_approved: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Başvurunuz Göç İdaresi tarafından onaylanmıştır ve dosyanız tamamlanma aşamasındadır. Ayrıntılar ve olası ofis mesajları için /basvurum/ sayfasını kontrol edebilirsiniz.',
        // DRAFT: needs office approval
        en: 'Your application has been approved by the Migration Authority and is moving to completion. Check /basvurum/ for full details and any office messages.',
        // DRAFT: needs office approval
        ru: 'Ваша заявка одобрена Миграционным управлением и переходит к завершению. Проверьте страницу /basvurum/, чтобы увидеть подробности и возможные сообщения офиса.',
        // DRAFT: needs office approval
        tk: 'Arzaňyz Migrasiýa edarasy tarapyndan tassyklandy we tamamlanma tapgyryna geçýär. Jikme-jik maglumatlar we ofis habarlary üçin /basvurum/ sahypasyny barlaň.',
        // DRAFT: needs office approval
        ar: 'وافقت إدارة الهجرة على طلبك وينتقل الملف إلى مرحلة الإكمال. راجع صفحة /basvurum/ للاطلاع على التفاصيل وأي رسائل من المكتب.'
    }),
    completed: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Bu portaldaki başvuru süreciniz tamamlanmıştır; portal üzerinden yapmanız gereken başka bir işlem yoktur. Ayrıntılar için /basvurum/ sayfasını inceleyebilir, özel bir sorunuz varsa ana sayfadaki soru formunu kullanabilirsiniz.',
        // DRAFT: needs office approval
        en: 'Your application process on this portal is completed, and no further portal action is needed. You can review details on /basvurum/ or send any specific question through the home page question form.',
        // DRAFT: needs office approval
        ru: 'Обработка вашей заявки на этом портале завершена, и дополнительных действий на портале не требуется. Вы можете посмотреть детали на странице /basvurum/ или задать конкретный вопрос через форму на главной странице.',
        // DRAFT: needs office approval
        tk: 'Bu portaldaky arza işiňiz tamamlandy we portalda başga hereket gerek däl. Jikme-jik maglumatlary /basvurum/ sahypasyndan görüp ýa-da aýratyn soragyňyz bolsa baş sahypadaky sorag formasyndan iberip bilersiňiz.',
        // DRAFT: needs office approval
        ar: 'اكتملت إجراءات طلبك على هذه البوابة ولا يلزمك أي إجراء آخر عبرها. يمكنك مراجعة التفاصيل في صفحة /basvurum/ أو إرسال أي استفسار خاص عبر نموذج الأسئلة في الصفحة الرئيسية.'
    }),
    cancelled: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Bu başvuru iptal edilmiştir ve artık aktif değildir. Ayrıntılar ve ofis mesajları için /basvurum/ sayfasını inceleyebilir veya ana sayfadaki soru formundan Uluslararası Öğrenci Ofisine ulaşabilirsiniz.',
        // DRAFT: needs office approval
        en: 'This application has been cancelled and is no longer active. You can check /basvurum/ for any office messages or contact the International Student Office through the question form on the home page.',
        // DRAFT: needs office approval
        ru: 'Эта заявка отменена и больше не активна. Вы можете проверить сообщения офиса на странице /basvurum/ или обратиться в Международный студенческий офис через форму вопросов на главной странице.',
        // DRAFT: needs office approval
        tk: 'Bu arza ýatyryldy we indi işjeň däl. Ofis habarlary üçin /basvurum/ sahypasyny görüp ýa-da baş sahypadaky sorag formasy arkaly Halkara talyplar ofisine ýüz tutup bilersiňiz.',
        // DRAFT: needs office approval
        ar: 'تم إلغاء هذا الطلب ولم يعد نشطاً. يمكنك مراجعة صفحة /basvurum/ للاطلاع على أي ملاحظات من المكتب، أو التواصل مع مكتب الطلاب الدوليين عبر نموذج الأسئلة في الصفحة الرئيسية.'
    }),
    rejected: Object.freeze({
        // DRAFT: needs office approval
        tr: 'Başvurunuz reddedildi olarak görünmektedir. Ayrıntılar ve ofis notları için /basvurum/ sayfasına giriş yapabilir, durumunuzla ilgili bilgi almak için ana sayfadaki soru formunu kullanarak Uluslararası Öğrenci Ofisine ulaşabilirsiniz.',
        // DRAFT: needs office approval
        en: 'Your application shows as rejected. Sign in on /basvurum/ to view office notes, and use the question form on the home page to contact the International Student Office for guidance on your situation.',
        // DRAFT: needs office approval
        ru: 'По вашей заявке указан статус «Отклонена». Войдите на страницу /basvurum/, чтобы посмотреть комментарии офиса, и обратитесь в Международный студенческий офис через форму вопросов на главной странице.',
        // DRAFT: needs office approval
        tk: 'Arzaňyz ret edilen hökmünde görkezilýär. Ofis belliklerini görmek üçin /basvurum/ sahypasyna giriň we ýagdaýyňyz barada maglumat almak üçin baş sahypadaky sorag formasyndan Halkara talyplar ofisine ýüz tutuň.',
        // DRAFT: needs office approval
        ar: 'تظهر حالة طلبك كمرفوض. سجّل الدخول في صفحة /basvurum/ للاطلاع على ملاحظات المكتب، واستخدم نموذج الأسئلة في الصفحة الرئيسية للتواصل مع مكتب الطلاب الدوليين للاستفسار عن وضعك.'
    })
});

function resolveLanguage(language) {
    const normalized = typeof language === 'string' ? language.trim().toLowerCase() : '';
    return CHATBOT_LANGUAGES.includes(normalized) ? normalized : 'tr';
}

function summarizeDocumentCounts(documents) {
    const counts = { approved: 0, waiting: 0, actionNeeded: 0 };
    if (!Array.isArray(documents)) return counts;

    for (const document of documents) {
        const status = document?.status;
        if (status === 'approved') {
            counts.approved += 1;
        } else if (status === 'waiting_review' || status === 'under_review') {
            counts.waiting += 1;
        } else if (status === 'resubmission_required' || status === 'contact_office') {
            counts.actionNeeded += 1;
        }
    }
    return counts;
}

/**
 * Returns a fixed localized message for status-lookup edge cases.
 * @param {'notFound'|'unknownStatus'|'multipleReferences'} kind Fixed status text category.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {string} Localized fixed response text.
 */
export function getChatbotStatusFixedText(kind, language = 'tr') {
    const entry = CHATBOT_STATUS_FIXED_TEXTS[kind];
    if (!entry) {
        throw new Error(`Unknown chatbot status text kind: ${String(kind)}`);
    }
    return entry[resolveLanguage(language)];
}

/**
 * Renders a deterministic, privacy-minimized status summary from a public tracking lookup result.
 * Never echoes raw DTO strings, rejection reasons, free-text office messages, or personal fields.
 * @param {{found?: boolean, application?: {status?: string}|null, documents?: Array<{status?: string}>}|null} result Public tracking lookup result.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {string} Fixed-template localized summary pointing to `/basvurum/`.
 */
export function renderStatusSummary(result, language = 'tr') {
    const resolvedLanguage = resolveLanguage(language);
    if (!result || result.found !== true || !result.application || typeof result.application !== 'object') {
        return CHATBOT_STATUS_FIXED_TEXTS.notFound[resolvedLanguage];
    }

    const rawStatus = result.application.status;
    const labels = APPLICATION_STATUS_LABELS[resolvedLanguage];
    const statusLabel = typeof rawStatus === 'string' && Object.hasOwn(labels, rawStatus)
        ? labels[rawStatus]
        : null;
    if (!statusLabel) {
        return CHATBOT_STATUS_FIXED_TEXTS.unknownStatus[resolvedLanguage];
    }

    const counts = summarizeDocumentCounts(result.documents);
    return STATUS_SUMMARY_TEMPLATES[resolvedLanguage](statusLabel, counts);
}

/**
 * Extracts the canonical application status key from a fixed status-summary assistant message
 * by matching the exact localized label in `APPLICATION_STATUS_LABELS[language]`.
 * @param {string} replyText Assistant message text.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {string|null} Canonical status key or `null` when not a recognized status summary.
 */
export function extractStatusFromSummaryReply(replyText, language = 'tr') {
    if (typeof replyText !== 'string') return null;
    const resolvedLanguage = resolveLanguage(language);
    const trimmed = replyText.trim();
    const prefix = STATUS_SUMMARY_PREFIXES[resolvedLanguage];
    if (!prefix || !trimmed.startsWith(prefix) || !trimmed.includes('/basvurum/')) {
        return null;
    }
    const labels = APPLICATION_STATUS_LABELS[resolvedLanguage];
    for (const [status, label] of Object.entries(labels)) {
        if (trimmed.startsWith(`${prefix}${label}.`)) {
            return status;
        }
    }
    return null;
}

/**
 * Finds the status key from the most recent fixed assistant status summary in conversation history.
 * Stops if a newer `notFound` or `unknownStatus` lookup reply appears after an older status summary.
 * @param {Array<{role?: string, content?: string}>} messages Conversation messages prior to the current user turn.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {string|null} Most recent known status key, or `null` if none applies.
 */
export function extractMostRecentStatusFromHistory(messages, language = 'tr') {
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const resolvedLanguage = resolveLanguage(language);
    const notFoundText = CHATBOT_STATUS_FIXED_TEXTS.notFound[resolvedLanguage];
    const unknownStatusText = CHATBOT_STATUS_FIXED_TEXTS.unknownStatus[resolvedLanguage];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== 'assistant' || typeof message.content !== 'string') continue;
        const trimmed = message.content.trim();
        const status = extractStatusFromSummaryReply(trimmed, resolvedLanguage);
        if (status) return status;
        if (trimmed === notFoundText || trimmed === unknownStatusText) {
            return null;
        }
    }
    return null;
}

/**
 * Returns the fixed localized next-step explanation for one canonical application status.
 * @param {string} status Canonical status key in `STATUS_NEXT_STEP_TEXTS`.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {string|null} Localized next-step text, or `null` when `status` is unknown.
 */
export function getStatusNextStepText(status, language = 'tr') {
    if (typeof status !== 'string' || !Object.hasOwn(STATUS_NEXT_STEP_TEXTS, status)) {
        return null;
    }
    return STATUS_NEXT_STEP_TEXTS[status][resolveLanguage(language)];
}

/**
 * Returns true when a reply equals one of the fixed localized `status_next_step` texts.
 * @param {string} replyText Candidate reply text.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {boolean} True if `replyText` matches a known next-step text for `language`.
 */
export function isStatusNextStepReply(replyText, language = 'tr') {
    if (typeof replyText !== 'string') return false;
    const resolvedLanguage = resolveLanguage(language);
    const trimmed = replyText.trim();
    return Object.values(STATUS_NEXT_STEP_TEXTS).some(
        (entry) => entry[resolvedLanguage] === trimmed
    );
}
