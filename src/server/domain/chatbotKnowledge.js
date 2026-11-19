import { ApiError } from './errors.js';

export const CHATBOT_TOPICS = Object.freeze([
    'application_steps',
    'residence_permit_basics',
    'office_hours',
    'student_card',
    'contact'
]);

export const CHATBOT_LANGUAGES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);

const KNOWLEDGE_ENTRIES = Object.freeze({
    application_steps: Object.freeze({
        sources: Object.freeze([
            'index.html',
            'src/public/publicGuideModal.js',
            'src/public/i18n/messages.js',
            'README.md'
        ]),
        // DRAFT: needs office approval
        text: Object.freeze({
            // DRAFT: needs office approval
            tr: 'Başvuru adımları: 1) Ana sayfadaki "Başvuruya Başla" (/basvuru/) bölümünde öğrenci numaranızı, e-postanızı, telefonunuzu ve başvuru türünüzü (ilk başvuru, uzatma veya geçiş) girin; kaydedince ITU ile başlayan başvuru numaranız oluşturulur. 2) Kişisel bilgilerinizi, pasaport ve doğum tarihi bilgilerinizi, kaldığınız yeri ve parmak izi kaydı durumunuzu ekleyin. 3) Gerekli belgeleri PDF veya fotoğraf (en fazla 10 MB; birden çok sayfa tek PDF olur) olarak yükleyin. 4) Başvuru bilgilendirmesini onaylayın. 5) Son kontrolü yapıp başvuruyu gönderin ve zorunlu A4 kapak PDF belgesini indirin. Taslağınıza başka cihazdan "Başvuruma Devam Et" (/basvuruya-devam-et/) ile devam edebilir, sürecinizi "Başvurumu Sorgula" (/basvurum/) bölümünden takip edebilirsiniz. Başvuru numaranızı unutursanız ana sayfadaki "Başvuru Numaramı Unuttum" seçeneğini kullanın.',
            // DRAFT: needs office approval
            en: 'Application steps: 1) Open "Start My Application" (/basvuru/) from the home page and enter your student number, e-mail, phone number, and application type (initial, extension/renewal, or transition); saving generates an application number starting with ITU. 2) Complete your personal, passport, and date-of-birth details, accommodation type, and fingerprint registration status. 3) Upload the required documents as PDF or photos (up to 10 MB; multiple pages combine into one PDF). 4) Accept the application acknowledgement. 5) Review and submit, then download the required application cover PDF. You can continue a draft from another device via "Continue My Application" (/basvuruya-devam-et/) and check status via "Track my application" (/basvurum/). If you forget your application number, use "I Forgot My Application Number" on the home page.',
            // DRAFT: needs office approval
            ru: 'Этапы подачи заявки: 1) Откройте «Başvuruya Başla» (/basvuru/) на главной странице и укажите номер студента, e-mail, телефон и тип заявки (первичная подача, продление или переход); после сохранения появится номер заявки, начинающийся с ITU. 2) Заполните личные данные, сведения паспорта и дату рождения, место проживания и статус регистрации отпечатков пальцев. 3) Загрузите необходимые документы в формате PDF или фото (до 10 МБ; несколько страниц объединяются в один PDF). 4) Примите подтверждение данных заявки. 5) Проверьте данные, отправьте заявку и обязательно скачайте итоговый PDF-документ заявки. Продолжить черновик с другого устройства можно через «Продолжить заявку» (/basvuruya-devam-et/), а проверить статус — через «Проверить статус заявки» (/basvurum/). Если вы забыли номер заявки, воспользуйтесь напоминанием на главной странице.',
            // DRAFT: needs office approval
            tk: 'Arza ädimleri: 1) Baş sahypadaky «Başvuruya Başla» (/basvuru/) bölüminde talyp belgiňizi, e-poçtaňyzy, telefonyňyzy we arza görnüşini (ilkinji, uzaltma ýa-da geçiş) giriziň; ýazdyrylandan soň ITU bilen başlaýan arza belgiňiz berilýär. 2) Şahsy maglumatlaryňyzy, pasport we doglan sene maglumatlaryny, ýaşaýan ýeriňizi hem-de barmak yzy ýagdaýyňyzy dolduryň. 3) Gerekli resminamalary PDF ýa-da surat görnüşinde (iň köp 10 MB; birnäçe sahypa bir PDF bolýar) ýükläň. 4) Arza baradaky habary tassyklaň. 5) Soňky barlagy geçirip arzany iberiň we hökmany arza resminamasyny (PDF) ýükläp alyň. Taslamany başga enjamdan «Arzama dowam et» (/basvuruya-devam-et/) arkaly dowam etdirip, ýagdaýy «Arzamyň ýagdaýyny barla» (/basvurum/) bölüminden yzarlap bilersiňiz. Arza belgiňizi unutsaňyz, baş sahypadaky ýatlatma düwmesini ulanyň.',
            // DRAFT: needs office approval
            ar: 'خطوات التقديم: 1) افتح صفحة بدء الطلب (/basvuru/) من الصفحة الرئيسية وأدخل رقم الطالب والبريد الإلكتروني والهاتف ونوع الطلب (أولي أو تمديد أو انتقال)؛ عند الحفظ يظهر رقم طلب يبدأ بـ ITU. 2) أكمل البيانات الشخصية وبيانات الجواز وتاريخ الميلاد ومكان الإقامة وحالة تسجيل البصمات. 3) ارفع المستندات المطلوبة بصيغة PDF أو صور (حتى 10 ميغابايت، وتُدمج الصفحات المتعددة في ملف PDF واحد). 4) وافق على إقرار الطلب. 5) راجع البيانات وأرسل الطلب ثم حمّل ملف PDF الخاص بالطلب. يمكنك متابعة المسودة من جهاز آخر عبر (/basvuruya-devam-et/) وتتبع حالة طلبك عبر (/basvurum/). وإذا نسيت رقم الطلب، استخدم خيار استرجاع رقم الطلب في الصفحة الرئيسية.'
        })
    }),
    residence_permit_basics: Object.freeze({
        sources: Object.freeze([
            'index.html',
            'src/public/i18n/messages.js',
            'src/public/publicGuideModal.js',
            'docs/2026-10-17-conditional-student-documents.md'
        ]),
        // DRAFT: needs office approval
        text: Object.freeze({
            // DRAFT: needs office approval
            tr: 'Bu portal, İstanbul Topkapı Üniversitesi öğrencilerinin öğrenci ikamet izni belgelerini Uluslararası Öğrenci Ofisine iletmesi ve inceleme sürecini takip etmesi içindir. İlk başvuru, uzatma/yenileme ve öğrenci ikamet iznine geçiş başvuruları desteklenir. Resmî ikamet izni başvurusu ayrıca e-İkamet sistemi üzerinden tamamlanır; portal üzerinden gönderim yapmak başvurunun üniversite ofisine ulaştığını gösterir, Göç İdaresinin ikamet izni kararı değildir. Başvurular Taslak, İncelemede, Belge güncellemesi (gerekirse), Göç İdaresine iletildi ve Tamamlandı aşamalarından geçer.',
            // DRAFT: needs office approval
            en: 'This portal lets İstanbul Topkapı University students submit their student residence permit documents to the International Student Office and track review progress. It supports initial, extension/renewal, and student-permit transition applications. The official residence permit application must still be completed separately in the e-İkamet system; submitting on this portal delivers your file to the university office and is not a residence permit decision by the Migration Authority. Portal stages include Draft, Under review, Document update (when requested), Sent to Migration Authority, and Completed.',
            // DRAFT: needs office approval
            ru: 'Этот портал предназначен для подачи студентами İstanbul Topkapı Üniversitesi документов на студенческий ВНЖ в Международный студенческий офис и отслеживания их проверки. Поддерживаются первичная подача, продление и переход на студенческий ВНЖ. Официальное заявление дополнительно оформляется в системе e-İkamet; отправка на портале означает передачу дела в офис университета, а не решение миграционной службы (Göç İdaresi). Этапы на портале: Черновик, На рассмотрении, Обновление документа (при запросе), Передано в миграционную службу и Завершено.',
            // DRAFT: needs office approval
            tk: 'Bu portal İstanbul Topkapı Uniwersitetiniň talyplaryna talyp ýaşaýyş rugsady resminamalaryny Halkara talyplar ofisine ibermek we barlag tapgyryny yzarlamak üçindir. Ilkinji arza, uzaltma/täzeleme we talyp ýaşaýyş rugsadyna geçiş arzalary goldanylýar. Resmi ýaşaýyş rugsady arzasy e-İkamet ulgamynda aýratyn tamamlanýar; portalda ibermek arzanyň ofise ýetendigini görkezýär we Migrasiýa edarasynyň karary däldir. Portal tapgyrlary: Taslama, Barlagda, Resminamany täzelemek (soralsa), Migrasiýa edarasyna iberildi we Tamamlandy.',
            // DRAFT: needs office approval
            ar: 'تتيح هذه البوابة لطلاب جامعة إسطنبول توبكابي رفع مستندات تصريح إقامة الطالب إلى مكتب الطلاب الدوليين ومتابعة مراجعتها. تدعم البوابة الطلب الأولي وطلب التمديد/التجديد وطلب الانتقال إلى إقامة الطالب. يجب استكمال طلب الإقامة الرسمي بشكل منفصل في نظام e-İkamet؛ فالإرسال عبر البوابة يعني وصول الملف إلى مكتب الجامعة وليس قراراً من إدارة الهجرة. تمر الطلبات بمراحل: مسودة، قيد المراجعة، تحديث مستند (عند الطلب)، أُرسل إلى إدارة الهجرة، ومكتمل.'
        })
    }),
    office_hours: Object.freeze({
        sources: Object.freeze(['index.html']),
        // DRAFT: needs office approval
        text: Object.freeze({
            // DRAFT: needs office approval
            tr: 'Uluslararası Öğrenci Ofisinin çalışma ve görüşme saatleri bu portalda belirtilmemektedir. Güncel çalışma saatlerini öğrenmek için ana sayfadaki soru formunu kullanarak ofise soru gönderebilirsiniz.',
            // DRAFT: needs office approval
            en: 'The International Student Office’s working and visiting hours are not listed on this portal. To ask about current office hours, please send a message using the question form on the home page.',
            // DRAFT: needs office approval
            ru: 'Часы работы и приёма Международного студенческого офиса на этом портале не указаны. Чтобы уточнить актуальное расписание, отправьте вопрос через форму вопросов на главной странице.',
            // DRAFT: needs office approval
            tk: 'Halkara talyplar ofisiniň iş we kabul ediş sagatlary bu portalda görkezilmeýär. Häzirki iş sagatlaryny soramak üçin baş sahypadaky sorag formasy arkaly ofise habar iberip bilersiňiz.',
            // DRAFT: needs office approval
            ar: 'ساعات عمل واستقبال مكتب الطلاب الدوليين غير مذكورة في هذه البوابة. للاستفسار عن ساعات العمل الحالية، يرجى إرسال سؤالك عبر نموذج الأسئلة في الصفحة الرئيسية.'
        })
    }),
    student_card: Object.freeze({
        sources: Object.freeze(['index.html', 'README.md']),
        // DRAFT: needs office approval
        text: Object.freeze({
            // DRAFT: needs office approval
            tr: 'Bu portal yalnızca öğrenci ikamet izni belgelerinin iletilmesi ve başvuru takibi içindir; üniversite öğrenci kimlik kartı işlemleri bu portalda yer almamaktadır. Öğrenci kartınızla ilgili bilgi ve yönlendirme için ana sayfadaki soru formundan Uluslararası Öğrenci Ofisine ulaşabilirsiniz.',
            // DRAFT: needs office approval
            en: 'This portal only handles student residence permit document submissions and tracking; university student ID card procedures are not listed here. Please use the question form on the home page to ask the International Student Office for guidance on your student card.',
            // DRAFT: needs office approval
            ru: 'Этот портал предназначен только для подачи и отслеживания документов на студенческий ВНЖ; порядок оформления студенческого билета университета здесь не указан. Чтобы получить разъяснение или направление по студенческой карте, задайте вопрос через форму на главной странице.',
            // DRAFT: needs office approval
            tk: 'Bu portal diňe talyp ýaşaýyş rugsady resminamalaryny tabşyrmak we yzarlamak üçindir; uniwersitet talyp şahadatnama kartynyň işleri bu ýerde görkezilmeýär. Talyp kartyňyz barada maglumat we ugrukdyrma almak üçin baş sahypadaky sorag formasyndan peýdalanyň.',
            // DRAFT: needs office approval
            ar: 'هذه البوابة مخصصة فقط لتقديم مستندات تصريح إقامة الطالب ومتابعة الطلب، ولا تتضمن إجراءات بطاقة الطالب الجامعية. للحصول على توجيه بشأن بطاقة الطالب، يرجى استخدام نموذج الأسئلة في الصفحة الرئيسية للتواصل مع مكتب الطلاب الدوليين.'
        })
    }),
    contact: Object.freeze({
        sources: Object.freeze(['index.html', 'src/public/privacyNoticeModal.js']),
        // DRAFT: needs office approval
        text: Object.freeze({
            // DRAFT: needs office approval
            tr: 'Uluslararası Öğrenci Ofisinin genel telefon numarası veya genel iletişim e-postası bu portalda yayımlanmamaktadır. Sorularınız için ana sayfadaki soru formunu doldurup telefon numaranızı bırakarak ofisin size dönüş yapmasını isteyebilirsiniz. Yalnızca KVKK kapsamındaki kişisel veri talepleri için kisiselverilerim@topkapi.edu.tr adresi paylaşılmıştır.',
            // DRAFT: needs office approval
            en: 'A general phone number or general e-mail address for the International Student Office is not published on this portal. To reach the office with your questions, please use the question form on the home page and leave your phone number so staff can reply. For personal data protection (KVKK) requests only, kisiselverilerim@topkapi.edu.tr is listed in the privacy notice.',
            // DRAFT: needs office approval
            ru: 'Общий телефон и общий адрес электронной почты Международного студенческого офиса на этом портале не опубликованы. Чтобы задать вопрос, заполните форму вопросов на главной странице и укажите свой номер телефона для обратной связи. Только для обращений по защите персональных данных (KVKK) в уведомлении указан адрес kisiselverilerim@topkapi.edu.tr.',
            // DRAFT: needs office approval
            tk: 'Halkara talyplar ofisiniň umumy telefon belgisi ýa-da umumy e-poçta salgysy bu portalda berilmeýär. Soraglaryňyz üçin baş sahypadaky sorag formasyny dolduryp telefon belgiňizi goýup bilersiňiz. Diňe şahsy maglumatlary goramak (KVKK) baradaky ýüz tutmalar üçin gizlinlik bildirişinde kisiselverilerim@topkapi.edu.tr salgysy görkezilendir.',
            // DRAFT: needs office approval
            ar: 'لا ينشر هذا الموقع رقم هاتف عاماً أو بريداً إلكترونياً عاماً لمكتب الطلاب الدوليين. لطرح أسئلتك، يمكنك تعبئة نموذج الأسئلة في الصفحة الرئيسية وترك رقم هاتفك ليتواصل معك المكتب. ولطلبات حماية البيانات الشخصية (KVKK) فقط، يرد البريد kisiselverilerim@topkapi.edu.tr في إشعار الخصوصية.'
        })
    })
});

/**
 * Returns the curated knowledge entry for one fixed topic in the requested portal language.
 * @param {string} topic Fixed topic key in `CHATBOT_TOPICS`.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {{text: string, sources: string[]}} Curated topic text and source paths.
 * @throws {ApiError} When `topic` is not in `CHATBOT_TOPICS`.
 */
export function readKnowledge(topic, language = 'tr') {
    if (typeof topic !== 'string' || !Object.hasOwn(KNOWLEDGE_ENTRIES, topic)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geçersiz bilgi konusu.');
    }
    const entry = KNOWLEDGE_ENTRIES[topic];
    const normalizedLanguage = typeof language === 'string' ? language.trim().toLowerCase() : '';
    const resolvedLanguage = Object.hasOwn(entry.text, normalizedLanguage) ? normalizedLanguage : 'tr';
    return {
        text: entry.text[resolvedLanguage],
        sources: [...entry.sources]
    };
}
