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
