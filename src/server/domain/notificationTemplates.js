export const NOTIFICATION_LANGUAGES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);

export const NOTIFICATION_TEMPLATES = Object.freeze({
    application_received: Object.freeze({
        tr: 'Başvurunuz alınmıştır. Güncel bilgileri güvenli başvuru portalından kontrol edebilirsiniz.',
        en: 'Your application has been received. You can check current information in the secure application portal.',
        ru: 'Ваше заявление получено. Проверить актуальную информацию можно на защищённом портале заявлений.',
        tk: 'Arzaňyz kabul edildi. Täze maglumatlary howpsuz arzalar portalyndan barlap bilersiňiz.',
        ar: 'تم استلام طلبك. يمكنك الاطلاع على المعلومات الحالية عبر بوابة الطلبات الآمنة.'
    }),
    document_update_needed: Object.freeze({
        tr: 'Başvurunuz için belge güncellemesi isteniyor. Lütfen güvenli başvuru portalını kontrol edin.',
        en: 'A document update is requested for your application. Please check the secure application portal.',
        ru: 'Для вашего заявления требуется обновить документ. Проверьте защищённый портал заявлений.',
        tk: 'Arzaňyz üçin resminamany täzelemek talap edilýär. Howpsuz arzalar portalyndan barlaň.',
        ar: 'مطلوب تحديث مستند لطلبك. يرجى مراجعة بوابة الطلبات الآمنة.'
    }),
    status_updated: Object.freeze({
        tr: 'Başvurunuzun durumunda güncelleme var. Ayrıntıları güvenli başvuru portalından kontrol edin.',
        en: 'There is an update to your application status. Check the details in the secure application portal.',
        ru: 'Статус вашего заявления обновлён. Подробности доступны на защищённом портале заявлений.',
        tk: 'Arzaňyzyň ýagdaýy täzelendi. Jikme-jiklikleri howpsuz arzalar portalyndan görüň.',
        ar: 'يوجد تحديث على حالة طلبك. راجع التفاصيل عبر بوابة الطلبات الآمنة.'
    }),
    forwarded_to_migration: Object.freeze({
        tr: 'Başvurunuz Göç İdaresine iletilmiştir. Güncel bilgileri güvenli başvuru portalından kontrol edin.',
        en: 'Your application has been forwarded to the Migration Authority. Check current information in the secure application portal.',
        ru: 'Ваше заявление передано в Управление миграции. Актуальная информация доступна на защищённом портале.',
        tk: 'Arzaňyz Migrasiýa edarasyna iberildi. Täze maglumatlary howpsuz portaldan barlaň.',
        ar: 'تمت إحالة طلبك إلى إدارة الهجرة. يمكنك مراجعة المعلومات الحالية عبر البوابة الآمنة.'
    }),
    application_completed: Object.freeze({
        tr: 'Başvurunuz tamamlanmıştır. Son bilgileri güvenli başvuru portalından kontrol edin.',
        en: 'Your application is complete. Check the final information in the secure application portal.',
        ru: 'Работа с вашим заявлением завершена. Итоговую информацию проверьте на защищённом портале.',
        tk: 'Arzaňyz tamamlandy. Jemleýji maglumatlary howpsuz portaldan barlaň.',
        ar: 'اكتمل طلبك. يرجى مراجعة المعلومات النهائية عبر بوابة الطلبات الآمنة.'
    })
});

const TEMPLATE_STATUS_RULES = Object.freeze({
    application_received: new Set(['submitted', 'under_review', 'resubmission_required', 'approved_for_processing',
        'sent_to_migration', 'migration_approved', 'completed']),
    document_update_needed: new Set(['resubmission_required']),
    status_updated: new Set(['submitted', 'under_review', 'resubmission_required', 'approved_for_processing',
        'sent_to_migration', 'migration_approved', 'completed', 'cancelled', 'rejected']),
    forwarded_to_migration: new Set(['sent_to_migration', 'migration_approved', 'completed']),
    application_completed: new Set(['completed'])
});

/** Builds the allowlisted static message and a normal same-origin tracking link. */
export function buildNotificationMessage({ templateKey, language, origin }) {
    const message = NOTIFICATION_TEMPLATES[templateKey]?.[language];
    if (!message) throw new TypeError('Unsupported notification template or language.');
    const portalOrigin = new URL(origin);
    if (!['https:', 'http:'].includes(portalOrigin.protocol) || portalOrigin.username || portalOrigin.password) {
        throw new TypeError('Unsupported notification portal origin.');
    }
    return `${message}\n${new URL('/basvurum/', portalOrigin.origin).href}`;
}

/** Checks that a selected template is truthful for the current application state. */
export function canUseNotificationTemplate(templateKey, applicationStatus) {
    return TEMPLATE_STATUS_RULES[templateKey]?.has(applicationStatus) === true;
}
