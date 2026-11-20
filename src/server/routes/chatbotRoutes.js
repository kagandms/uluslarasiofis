import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from '../../public/i18n/messages.js';
import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../../shared/document-conditions.js';
import { isValidApplicationReference, normalizeApplicationReference } from '../auth/applicationAccessCode.js';
import * as evidence from '../domain/chatbotEvidence.js';
import { CHATBOT_LANGUAGES } from '../domain/chatbotKnowledge.js';
import {
    CHATBOT_REFUSAL_MARKER,
    buildChatbotSystemPrompt,
    buildMissingDocumentsQuestion,
    getChatbotFixedText
} from '../domain/chatbotPrompt.js';
import { getChatbotStatusFixedText, renderStatusSummary } from '../domain/chatbotStatusText.js';
import {
    CHATBOT_TOOL_DEFINITIONS,
    CHATBOT_TOOLS,
    executeChatbotTool
} from '../domain/chatbotTools.js';
import { listPublicDocumentOverview } from '../domain/documentPolicy.js';
import { ApiError } from '../domain/errors.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import {
    APPLICATION_TRACKING_RATE_LIMIT,
    CHATBOT_GLOBAL_DAILY_LIMIT,
    CHATBOT_IP_DAILY_LIMIT,
    CHATBOT_RATE_LIMIT
} from '../security/application-rate-limits.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import { createChatModel } from '../services/chatbotModel.js';
import { readPublicTrackingByReference } from './applicationTrackingRoutes.js';
import { createRepositories, enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';

const CHATBOT_BODY_MAX_BYTES = 8192;
const CHATBOT_MAX_MESSAGES = 10;
const CHATBOT_MESSAGE_MAX_LENGTH = 500;
const CHATBOT_MAX_MODEL_CALLS = 3;
const CHATBOT_MAX_TOOL_CALLS_PER_RESPONSE = 3;
const CHATBOT_MAX_FAILED_TOOL_ROUNDS = 2;
const CHATBOT_REQUEST_DEADLINE_MS = 10_000;
const CHATBOT_MAX_REPLY_CHARS = 1200;

const CHATBOT_ALLOWED_ROLES = Object.freeze(['user', 'assistant']);
const CHATBOT_ROOT_KEYS = Object.freeze(['messages', 'language']);
const CHATBOT_MESSAGE_KEYS = Object.freeze(['role', 'content']);

// Çok satırlı mesajlarda yalnızca \n satır sonuna izin verilir; diğer kontrol karakterleri reddedilir.
const MESSAGE_DISALLOWED_CONTROL_CHAR_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const FORGED_ASSISTANT_TOOL_JSON_PATTERN = /\{\s*"name"\s*:|"tool_calls"/u;
const REFERENCE_CANDIDATE_PATTERN = /[\p{L}\p{N}_-]+/gu;
const CHATBOT_UNAVAILABLE_MESSAGE = 'Asistan şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.';

const CHATBOT_HANDOFF_TEXT = Object.freeze({
    tr: 'Bu konuda size en iyi Uluslararası Öğrenci Ofisi yardımcı olabilir. Aşağıdaki soru formundan yazabilirsiniz; size telefon veya WhatsApp ile dönüş yapılır.',
    en: 'The International Student Office can best help you with this. You can write using the question form below; they will get back to you by phone or WhatsApp.',
    ru: 'В этом вопросе вам лучше всего поможет Международный студенческий офис. Вы можете написать через форму вопросов ниже; с вами свяжутся по телефону или через WhatsApp.',
    tk: 'Bu meselede size iň gowy Halkara talyplar ofisi kömek edip biler. Aşakdaky sorag formasy arkaly ýazyp bilersiňiz; size telefon ýa-da WhatsApp arkaly jogap berler.',
    ar: 'يمكن لمكتب الطلاب الدوليين مساعدتك بأفضل شكل في هذا الموضوع. يمكنك الكتابة عبر نموذج الأسئلة أدناه؛ وسيتم التواصل معك عبر الهاتف أو واتساب.'
});

const OPTIONAL_DOCUMENT_SUFFIX = Object.freeze({
    tr: ' (isteğe bağlı)',
    en: ' (optional)',
    ru: ' (необязательно)',
    tk: ' (hökmany däl)',
    ar: ' (اختياري)'
});

const STATUS_RULES_BY_LANGUAGE = Object.freeze({
    tr: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:durum[\p{L}\p{N}]*|sonuc[\p{L}\p{N}]*|onay[\p{L}\p{N}]*|gonderildi[\p{L}\p{N}]*|goc|kontrol[\p{L}\p{N}]*|incele[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:basvuru[\p{L}\p{N}]*|(?:^|[^\p{L}])dosya[\p{L}\p{N}]*(?:[^\p{L}]|$))/u])
    }),
    en: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:status[\p{L}\p{N}]*|results?|approved|sent|migration|check(?:ed|ing)?)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])(?:applications?|files?)(?:[^\p{L}]|$)/u])
    }),
    ru: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:статус[\p{L}\p{N}]*|результат[\p{L}\p{N}]*|одобр[\p{L}\p{N}]*|отправ[\p{L}\p{N}]*|миграц[\p{L}\p{N}]*|провер[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])(?:заявк[\p{L}\p{N}]*|заявлен[\p{L}\p{N}]*|дел(?:о|а|у|ом|е)|досье)(?:[^\p{L}]|$)/u])
    }),
    tk: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:yagday[\p{L}\p{N}]*|netije[\p{L}\p{N}]*|tassyk[\p{L}\p{N}]*|iberildi[\p{L}\p{N}]*|migrasiya[\p{L}\p{N}]*|barla[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])(?:arza[\p{L}\p{N}]*|fayl[\p{L}\p{N}]*|dosye[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u])
    }),
    ar: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:حاله|نتيجه|موافقه|ارسل[\p{L}\p{N}]*|ارسال[\p{L}\p{N}]*|هجره|الهجره|راجع[\p{L}\p{N}]*|مراجع[\p{L}\p{N}]*|تراجع[\p{L}\p{N}]*|يراجع[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:طلب[\p{L}\p{N}]*|(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?ملف[\p{L}\p{N}]*(?:[^\p{L}]|$))/u])
    })
});

const STANDALONE_STATUS_PHRASES = Object.freeze([
    'basvurum ne durumda',
    'basvurum ne alemde',
    'what is my application status',
    'статус моеи заявки',
    'arzamyn yagdayy',
    'arzam name yagdayda',
    'ما حاله طلبي',
    'ما هي حاله طلبي'
]);

const HOW_TO_OR_WHAT_IS_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:nasil|nedir|ne\s+zaman|kac(?:ta)?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:how|what\s+(?:is|are)|when|size)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:как|что\s+такое|когда|сколько)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:nahili|name|hacan)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:كيف|ما\s+هو|ما\s+هي|متي|كم)(?:[^\p{L}]|$)/u
]);

const FIRST_PERSON_STATUS_PHRASE_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:basvurum[\p{L}\p{N}]*|dosyam[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:yukledigim|gonderdigim|verdigim|ekledigim|ilettigim)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:dosya|belge|evrak|basvuru)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])my\s+(?:applications?|file(?!\s+size)s?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:the\s+|my\s+)?(?:files?|applications?|documents?|docs)\s+(?:that\s+|which\s+)?i\s+(?:uploaded|sent|submitted)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:мо(?:я|еи|ю)\s+заявк[\p{L}\p{N}]*|мо(?:е|его|ему|им|ем)\s+(?:дел(?:о|а|у|ом|е)|заявлен[\p{L}\p{N}]*))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:документ[\p{L}\p{N}]*|фаил[\p{L}\p{N}]*|дел[\p{L}\p{N}]*|заявк[\p{L}\p{N}]*|заявлен[\p{L}\p{N}]*),?\s+котор(?:ыи|ую|ое|ые)\s+я\s+(?:отправил[\p{L}\p{N}]*|загрузил[\p{L}\p{N}]*|подал[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])arzam[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:yuklan|iberen|tabsyran|beren)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:fayl|arza|resminama|dosye)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:و|ف|ب|ل)?(?:طلبي|ملفي)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:ملف|طلب|مستند)\s+الذي|(?:مستندات|وثايق)\s+التي)\s+(?:ارسلته|ارسلتها|رفعته|رفعتها|قدمته|قدمتها)(?:[^\p{L}]|$)/u
]);

const DOCUMENT_KEYWORD_PATTERNS = Object.freeze([
    /belge[\p{L}\p{N}]*/u,
    /evrak[\p{L}\p{N}]*/u,
    /document[\p{L}\p{N}]*/u,
    /dokument[\p{L}\p{N}]*/u,
    /(?:^|[^\p{L}])docs?(?:[^\p{L}]|$)/u,
    /документ[\p{L}\p{N}]*/u,
    /resminama[\p{L}\p{N}]*/u,
    /مستند[\p{L}\p{N}]*/u,
    /وثايق[\p{L}\p{N}]*/u,
    /وثيقه/u
]);

const SHORT_DOCUMENT_EXCLUDE_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:format[\p{L}\p{N}]*|boyut[\p{L}\p{N}]*|yukle[\p{L}\p{N}]*|yeniden[\p{L}\p{N}]*|pdf|jpe?g|png|webp|mb|sayfa)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:size|upload[\p{L}\p{N}]*|resubmit[\p{L}\p{N}]*|replace[\p{L}\p{N}]*|pages?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:формат[\p{L}\p{N}]*|размер[\p{L}\p{N}]*|загруз[\p{L}\p{N}]*|повтор[\p{L}\p{N}]*|замен[\p{L}\p{N}]*|страниц[\p{L}\p{N}]*|мб)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:gornus[\p{L}\p{N}]*|yukle[\p{L}\p{N}]*|tazeden[\p{L}\p{N}]*|sahypa)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:صيغه|حجم|رفع|اعاده\s+رفع|صفح[\p{L}\p{N}]*|ميغابايت)(?:[^\p{L}]|$)/u
]);

const DOCUMENT_LIST_INTENT_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:hangi\s+(?:belge|evrak)[\p{L}\p{N}]*|(?:belge|evrak)[\p{L}\p{N}]*\s+neler|ne(?:ler)?\s+gerek[\p{L}\p{N}]*|gerekli\s+(?:belge|evrak)[\p{L}\p{N}]*|(?:belge|evrak)[\p{L}\p{N}]*\s+listesi|lazim)(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:(?:which|what)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:documents?|docs)(?!\s+(?:format|size|types?))|required\s+(?:documents?|docs)|(?:documents?|docs)\s+(?:are\s+)?(?:required|needed)|(?:document|documents|doc|docs)\s+list|list\s+(?:of\s+|the\s+)?(?:required\s+)?(?:documents?|docs)|do\s+i\s+need(?!\s+to\s+(?:upload|resubmit|replace|scan|convert|compress|resize)))(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:какие\s+(?:[\p{L}\p{N}]+\s+){0,2}документ[\p{L}\p{N}]*|список\s+(?:[\p{L}\p{N}]+\s+){0,2}документ[\p{L}\p{N}]*|необходим[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|нужн[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|документ[\p{L}\p{N}]*\s+(?:[\p{L}\p{N}]+\s+){0,2}нужн[\p{L}\p{N}]*|что\s+нужно)(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])(?:haysy\s+(?:[\p{L}\p{N}]+\s+){0,2}resminama[\p{L}\p{N}]*|name\s+(?:resminama[\p{L}\p{N}]*\s+)?gerek|gerekli\s+resminama[\p{L}\p{N}]*|resminama[\p{L}\p{N}]*\s+(?:gerek|sanaw[\p{L}\p{N}]*))(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:ما\s+(?:هي\s+)?(?:المستندات|الوثايق|مستندات|وثايق)|(?:المستندات|الوثايق)\s+المطلوب[\p{L}\p{N}]*|قايمه\s+(?:المستندات|الوثايق))(?:[^\p{L}]|$)/u
]);

const OTHER_STUDENTS_DATA_RULES_BY_LANGUAGE = Object.freeze({
    tr: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:diger|baska(?:\s+bir)?)\s+ogrenci[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:liste[\p{L}\p{N}]*|telefon[\p{L}\p{N}]*|numara[\p{L}\p{N}]*|bilgi[\p{L}\p{N}]*|adres[\p{L}\p{N}]*|isim[\p{L}\p{N}]*|ism[\p{L}\p{N}]*|adlar[\p{L}\p{N}]*|adini|veriler[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:ver(?:ir|ebilir|in|iniz|sene|senize)?|goster(?:ir|ebilir|in|iniz)?|listele(?:r|yebilir|yin|yiniz)?|gonder(?:ir|ebilir|in|iniz)?)(?:[^\p{L}]|$)/u
        ])
    }),
    en: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:other\s+students?(?:'s|s')?|another\s+student(?:'s)?)(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:lists?|data|phones?|numbers?|address(?:es)?|names?)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:give|show|list|send)(?:[^\p{L}]|$)/u
        ])
    }),
    ru: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])друг(?:ие|их|им|ими|ои|ого|ому)\s+студент[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:спис(?:ок|ки|ка|ке|ком|ков)|данн[\p{L}\p{N}]*|телефон[\p{L}\p{N}]*|номер[\p{L}\p{N}]*|адрес[\p{L}\p{N}]*|имя|имен[\p{L}\p{N}]*|фамили[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:даи(?:те)?|покажи(?:те)?|пришли(?:те)?|список)(?:[^\p{L}]|$)/u
        ])
    }),
    tk: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:beyleki|basga)\s+talyp[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:sanaw[\p{L}\p{N}]*|telefon[\p{L}\p{N}]*|belgi[\p{L}\p{N}]*|nomer[\p{L}\p{N}]*|maglumat[\p{L}\p{N}]*|salgy[\p{L}\p{N}]*|atlar[\p{L}\p{N}]*|adyny)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:ber(?:in)?|gorkez(?:in)?)(?:[^\p{L}]|$)/u
        ])
    }),
    ar: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:طلاب\s+(?:ال)?اخر(?:ين|ون)|طالب\s+(?:ال)?اخر)(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:قايمه|قوايم|بيانات|معلومات|هاتف|هواتف|تليفون|جوال|موبايل|رقم|ارقام|عنوان|عناوين|اسم|اسماء)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:و|ف)?(?:اعطني|اعطيني|اعطونا|ارني|اريني|ارسل(?:ي|وا)?)(?:[^\p{L}]|$)/u
        ])
    })
});

const EXPLICIT_HANDOFF_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:insanla|yetkiliyle|personelle|biriyle|calisanla[\p{L}\p{N}]*)\s*(?:gorus[\p{L}\p{N}]*|konus[\p{L}\p{N}]*|iletisim[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])gercek\s*(?:bir\s*)?(?:insan|kisi)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])sikayet[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])acil(?:\s+durum[\p{L}\p{N}]*)?(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:talk|speak|chat|connect[\p{L}\p{N}]*)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:person|human|staff|advisor|representative|agent|someone)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:need|want)\s+help\s+from\s+(?:the\s+)?staff(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])real\s+person(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])complaint[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])urgent(?:ly)?(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:поговорить|связаться|пообщаться|соединить)\s+с\s+(?:живым\s+|реальным\s+)?(?:человеком|сотрудником|оператором|специалистом|представителем)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])помощь\s+сотрудник[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])жалоб[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])срочн[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])adam\s+bilen\s+gurles[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:ofis\s+)?isgar[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])sikayat[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])gyssagly(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تحدث|التحدث|اتحدث|تكلم|التكلم|اتكلم|تواصل|التواصل|اتواصل)\s+مع\s+(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:شخص|انسان|موظف|احد)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?شخص\s+حقيقي(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مساعده\s+(?:من\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?موظف(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?شكو[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?عاجل[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
]);

const OFFICE_HANDOFF_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])ofisle\s*(?:gorus[\p{L}\p{N}]*|konus[\p{L}\p{N}]*|iletisim[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])ofise\s*(?:ulas[\p{L}\p{N}]*|yaz[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:talk|speak|chat|connect[\p{L}\p{N}]*)\s+(?:to|with)\s+(?:the\s+)?office(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:need|want)\s+help\s+from\s+(?:the\s+)?office(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:поговорить|связаться|пообщаться|соединить)\s+с\s+офисом(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تحدث|التحدث|اتحدث|تكلم|التكلم|اتكلم|تواصل|التواصل|اتواصل)\s+مع\s+(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مكتب(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مساعده\s+(?:من\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مكتب(?:[^\p{L}]|$)/u
]);

const HANDOFF_PATTERNS = Object.freeze([
    ...EXPLICIT_HANDOFF_PATTERNS,
    ...OFFICE_HANDOFF_PATTERNS
]);

const PROMPT_OVERRIDE_MARKER_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:kurallar[\p{L}\p{N}]*|talimatlar[\p{L}\p{N}]*)\s*(?:unut|yoksay|ihmal)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:system\s+override|(?:ignore|disregard|forget)\s+(?:all\s+|previous\s+)?(?:rules|restrictions|instructions))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:игнорируи|забудь)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:правила|инструкци[\p{L}\p{N}]*|ограничени[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:gor[\p{L}\p{N}]*|duzgun[\p{L}\p{N}]*|gorkezme[\p{L}\p{N}]*)\s*(?:yatdan\s+cykar|unut)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:تجاهل|انسي|انس)\s+(?:كل\s+|جميع\s+)?(?:ال)?(?:قواعد|تعليمات|قيود)(?:[^\p{L}]|$)/u
]);

export const CHATBOT_ROUTE_NORMALIZED_PATTERNS = Object.freeze({
    STATUS_RULES_BY_LANGUAGE,
    STANDALONE_STATUS_PHRASES,
    HOW_TO_OR_WHAT_IS_PATTERNS,
    FIRST_PERSON_STATUS_PHRASE_PATTERNS,
    DOCUMENT_KEYWORD_PATTERNS,
    SHORT_DOCUMENT_EXCLUDE_PATTERNS,
    DOCUMENT_LIST_INTENT_PATTERNS,
    OTHER_STUDENTS_DATA_RULES_BY_LANGUAGE,
    EXPLICIT_HANDOFF_PATTERNS,
    OFFICE_HANDOFF_PATTERNS,
    HANDOFF_PATTERNS,
    PROMPT_OVERRIDE_MARKER_PATTERNS
});

const DOCUMENT_FACT_KEYS = Object.freeze([
    'application_type',
    'is_under_18',
    'accommodation_type',
    'host_is_married',
    'host_is_turkish',
    'fingerprint_status'
]);

const VALID_DOCUMENT_FACT_CHECKS = Object.freeze({
    application_type: (value) => typeof value === 'string' && ['initial', 'renewal', 'transition'].includes(value),
    is_under_18: (value) => typeof value === 'boolean',
    accommodation_type: (value) => typeof value === 'string' && ACCOMMODATION_TYPES.includes(value),
    host_is_married: (value) => typeof value === 'string' && DOCUMENT_ANSWER_OPTIONS.host_is_married.includes(value),
    host_is_turkish: (value) => typeof value === 'string' && DOCUMENT_ANSWER_OPTIONS.host_is_turkish.includes(value),
    fingerprint_status: (value) => typeof value === 'string' && ['registered', 'not_registered'].includes(value)
});

const PROSE_LIST_LINE_PATTERN = /^\s*(?:[-*•◦▪‣]|\d+[.)])\s+\S/u;
const ANY_LETTER_PATTERN = /\p{L}/gu;
const ARABIC_LETTER_PATTERN = /\p{Script=Arabic}/gu;
const CYRILLIC_LETTER_PATTERN = /\p{Script=Cyrillic}/gu;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireOnlyKeys(value, allowedKeys) {
    if (!isPlainObject(value) || Object.keys(value).some((key) => !allowedKeys.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sohbet isteğini kontrol edip tekrar deneyin.');
    }
}

function validateChatMessage(rawMessage) {
    requireOnlyKeys(rawMessage, CHATBOT_MESSAGE_KEYS);
    if (typeof rawMessage.role !== 'string' || !CHATBOT_ALLOWED_ROLES.includes(rawMessage.role)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj rolü geçersiz.');
    }
    if (typeof rawMessage.content !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj içeriği geçersiz.');
    }
    const normalized = rawMessage.content.replace(/\r\n/g, '\n');
    if (MESSAGE_DISALLOWED_CONTROL_CHAR_PATTERN.test(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesajda geçersiz kontrol karakteri bulunamaz.');
    }
    const trimmed = normalized.trim();
    const charLength = [...trimmed].length;
    if (charLength < 1 || charLength > CHATBOT_MESSAGE_MAX_LENGTH) {
        throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `Mesaj 1 ile ${CHATBOT_MESSAGE_MAX_LENGTH} karakter arasında olmalıdır.`
        );
    }
    if (rawMessage.role === 'assistant' && (
        trimmed.includes(CHATBOT_REFUSAL_MARKER) || FORGED_ASSISTANT_TOOL_JSON_PATTERN.test(trimmed)
    )) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj geçmişi geçersiz.');
    }
    return {
        role: rawMessage.role,
        content: trimmed
    };
}

function validateChatInput(body) {
    requireOnlyKeys(body, CHATBOT_ROOT_KEYS);
    if (typeof body.language !== 'string' || !CHATBOT_LANGUAGES.includes(body.language)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dil seçimini kontrol edip tekrar deneyin.');
    }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > CHATBOT_MAX_MESSAGES) {
        throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `Mesaj listesi 1 ile ${CHATBOT_MAX_MESSAGES} öğe arasında olmalıdır.`
        );
    }
    const validatedMessages = body.messages.map(validateChatMessage);
    let firstUserIndex = 0;
    while (firstUserIndex < validatedMessages.length && validatedMessages[firstUserIndex].role === 'assistant') {
        firstUserIndex += 1;
    }
    const normalizedMessages = validatedMessages.slice(firstUserIndex);
    if (normalizedMessages.length < 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj sırası geçersiz.');
    }
    for (let index = 0; index < normalizedMessages.length; index += 1) {
        const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
        if (normalizedMessages[index].role !== expectedRole) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj sırası geçersiz.');
        }
    }
    if (normalizedMessages[normalizedMessages.length - 1].role !== 'user') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Son mesaj kullanıcıya ait olmalıdır.');
    }
    return {
        messages: normalizedMessages,
        language: body.language
    };
}

async function runFailClosedRateLimit(action) {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ApiError && error.status === 429) throw error;
        throw new ApiError(503, 'CHATBOT_UNAVAILABLE', CHATBOT_UNAVAILABLE_MESSAGE, true);
    }
}

async function consumeDailyBudgetSlot(repositories, policy, identity, nowSeconds) {
    return runFailClosedRateLimit(() => consumePublicRateLimit(repositories.rateLimits, {
        endpoint: policy.endpoint,
        identity,
        nowSeconds,
        windowSeconds: policy.windowSeconds,
        maxRequests: policy.maxRequests
    }));
}

function renderDeterministicDocumentList(labels, language) {
    const optionalSuffix = OPTIONAL_DOCUMENT_SUFFIX[language] || OPTIONAL_DOCUMENT_SUFFIX.tr;
    return labels
        .map((item) => `- ${item.title}${item.required === false ? optionalSuffix : ''}`)
        .join('\n');
}

function buildDocumentReply(labels, language) {
    const intro = getChatbotFixedText('documentListIntro', language);
    const renderedList = renderDeterministicDocumentList(labels, language);
    const closing = getChatbotFixedText('documentListClosing', language);
    return `${intro}\n\n${renderedList}\n\n${closing}`;
}

function extractApplicationReferences(messageContent) {
    if (typeof messageContent !== 'string') return [];
    const matches = messageContent.match(REFERENCE_CANDIDATE_PATTERN);
    if (!matches) return [];
    const validReferences = [];
    const seen = new Set();
    for (const token of matches) {
        const candidate = token.replace(/^[_-]+|[_-]+$/g, '');
        if (!candidate) continue;
        const normalized = normalizeApplicationReference(candidate);
        if (!isValidApplicationReference(normalized) || seen.has(normalized)) continue;
        seen.add(normalized);
        validReferences.push(normalized);
    }
    return validReferences;
}

function extractScopedUserReferences(messages, lastUserMessage) {
    const lastTurnReferences = extractApplicationReferences(lastUserMessage);
    if (lastTurnReferences.length > 0) {
        return lastTurnReferences;
    }
    if (!isStatusQuestionWithoutReference(lastUserMessage)) {
        return [];
    }
    for (let index = messages.length - 2; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'user') continue;
        const references = extractApplicationReferences(message.content);
        if (references.length === 1) {
            return references;
        }
        if (references.length > 1) {
            return [];
        }
    }
    return [];
}

function hasDocumentKeyword(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return DOCUMENT_KEYWORD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isAnsweringMissingFactsQuestion(previousAssistantMessage, language) {
    if (previousAssistantMessage?.role !== 'assistant' || typeof previousAssistantMessage.content !== 'string') {
        return false;
    }
    const missingFactsPrefix = getChatbotFixedText('missingDocumentsIntro', language);
    return previousAssistantMessage.content.startsWith(missingFactsPrefix);
}

function hasExplicitPersonComplaintUrgentHandoff(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return EXPLICIT_HANDOFF_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true when the user message explicitly asks for a human/office handoff or reports an urgent/complaint case.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic handoff applies.
 */
export function isDeterministicHandoffRequest(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return HANDOFF_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true when the user message explicitly requests to receive other students' lists or personal data.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic refusal applies.
 */
export function isOtherStudentsDataRequest(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return Object.values(OTHER_STUDENTS_DATA_RULES_BY_LANGUAGE).some(({ otherStudents, personalData, requestVerb }) =>
        otherStudents.some((pattern) => pattern.test(normalized))
        && personalData.some((pattern) => pattern.test(normalized))
        && requestVerb.some((pattern) => pattern.test(normalized))
    );
}

/**
 * Returns true when the user message is a very short document question (document keyword and at most 3 words).
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic missing-facts/document lookup applies.
 */
export function isVeryShortDocumentQuestion(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (!hasDocumentKeyword(messageContent)) return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (SHORT_DOCUMENT_EXCLUDE_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
    return words.length >= 1 && words.length <= 3;
}

/**
 * Returns true when the user message explicitly asks which documents are needed (list intent),
 * distinguishing document-list queries from how-to or troubleshooting questions about documents.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if user asks for a list of required documents.
 */
export function isAskingWhichDocumentsAreNeeded(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (!hasDocumentKeyword(messageContent)) return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return DOCUMENT_LIST_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasPromptOverrideMarker(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return PROMPT_OVERRIDE_MARKER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isStatusQuestionWithoutReference(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (hasExplicitPersonComplaintUrgentHandoff(messageContent)) {
        return false;
    }
    if (isVeryShortDocumentQuestion(messageContent) || isAskingWhichDocumentsAreNeeded(messageContent)) {
        return false;
    }
    const normalized = evidence.normalizeForEvidence(messageContent);
    const hasFirstPersonStatusContext = FIRST_PERSON_STATUS_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized));
    if (hasDocumentKeyword(messageContent) && !hasFirstPersonStatusContext) {
        return false;
    }
    if (
        HOW_TO_OR_WHAT_IS_PATTERNS.some((pattern) => pattern.test(normalized))
        && !hasFirstPersonStatusContext
    ) {
        return false;
    }
    if (STANDALONE_STATUS_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return true;
    }
    return Object.values(STATUS_RULES_BY_LANGUAGE).some(({ status, application }) =>
        status.some((pattern) => pattern.test(normalized))
        && (hasFirstPersonStatusContext || application.some((pattern) => pattern.test(normalized)))
    );
}

function listCatalogDocumentEntries(language) {
    const messages = {
        ...(SESSION3_MESSAGES[language] || SESSION3_MESSAGES.tr),
        ...(PUBLIC_MESSAGES[language] || PUBLIC_MESSAGES.tr)
    };
    const entries = [];
    const seen = new Set();
    for (const policy of listPublicDocumentOverview()) {
        const rawTitle = messages[policy.label_key];
        if (typeof rawTitle !== 'string') continue;
        const normalizedTitle = evidence.normalizeForEvidence(rawTitle).trim();
        if (!normalizedTitle || seen.has(normalizedTitle)) continue;
        seen.add(normalizedTitle);
        entries.push({
            title: normalizedTitle,
            addressType: policy.address_evidence_type || null
        });
    }
    return entries.sort((a, b) => b.title.length - a.title.length);
}

function looksLikeProseDocumentReply(replyText, language) {
    if (typeof replyText !== 'string' || !replyText.trim()) return false;
    const catalogEntries = listCatalogDocumentEntries(language);
    if (catalogEntries.length === 0) return false;

    const normalizedReply = evidence.normalizeForEvidence(replyText);
    let remaining = normalizedReply;
    let nonAddressCount = 0;
    const addressTypeCounts = new Map();
    for (const entry of catalogEntries) {
        if (!remaining.includes(entry.title)) continue;
        remaining = remaining.split(entry.title).join(' ');
        if (!entry.addressType) {
            nonAddressCount += 1;
        } else {
            addressTypeCounts.set(entry.addressType, (addressTypeCounts.get(entry.addressType) || 0) + 1);
        }
    }
    const maxAddressTypeCount = addressTypeCounts.size > 0 ? Math.max(...addressTypeCounts.values()) : 0;
    // Mutually exclusive address-evidence alternatives (e.g. "kira sözleşmesi veya taahhütname")
    // alone do not form a required-documents list.
    if (nonAddressCount + maxAddressTypeCount >= 2) {
        return true;
    }

    const bulletLines = replyText
        .split('\n')
        .filter((line) => PROSE_LIST_LINE_PATTERN.test(line));
    if (bulletLines.length < 2) {
        return false;
    }
    return bulletLines.some((line) => {
        const normalizedLine = evidence.normalizeForEvidence(line);
        return catalogEntries.some((entry) => normalizedLine.includes(entry.title));
    });
}

function isReplyInExpectedScript(replyText, language) {
    if (language === 'ar') {
        const allLetters = replyText.match(ANY_LETTER_PATTERN) || [];
        if (allLetters.length === 0) return false;
        const arabicLetters = replyText.match(ARABIC_LETTER_PATTERN) || [];
        return arabicLetters.length / allLetters.length >= 0.3;
    }
    if (language === 'ru') {
        const allLetters = replyText.match(ANY_LETTER_PATTERN) || [];
        if (allLetters.length === 0) return false;
        const cyrillicLetters = replyText.match(CYRILLIC_LETTER_PATTERN) || [];
        return cyrillicLetters.length / allLetters.length >= 0.3;
    }
    return LATIN_LETTER_PATTERN.test(replyText);
}

function isInsufficientOrWrongScriptReply(replyText, language) {
    if (replyText.toLowerCase().includes('input is not sufficient')) {
        return true;
    }
    return !isReplyInExpectedScript(replyText, language);
}

function hasEvidenceRiskSafe(userTurns, language) {
    return typeof evidence.hasEvidenceRisk === 'function'
        ? Boolean(evidence.hasEvidenceRisk(userTurns, language))
        : false;
}

function readSupportedDocumentFacts(userTurns, language) {
    const rawFacts = evidence.extractSupportedDocumentFacts(userTurns, language);
    const uncertainKeys = new Set(
        Array.isArray(rawFacts?.__uncertain)
            ? rawFacts.__uncertain.filter((key) => typeof key === 'string')
            : []
    );
    const facts = {};
    if (rawFacts && typeof rawFacts === 'object') {
        for (const key of DOCUMENT_FACT_KEYS) {
            if (!Object.hasOwn(rawFacts, key) || uncertainKeys.has(key)) continue;
            if (rawFacts[key] !== undefined && rawFacts[key] !== null) {
                facts[key] = rawFacts[key];
            }
        }
    }
    return { facts, uncertainKeys };
}

function resolveToolDocumentArgs(rawArgs, { supportedFacts, uncertainKeys }) {
    if (!isPlainObject(rawArgs)) return rawArgs;

    const resolved = {};
    for (const key of DOCUMENT_FACT_KEYS) {
        const hasRawValue = Object.hasOwn(rawArgs, key) && rawArgs[key] !== undefined && rawArgs[key] !== null;
        if (hasRawValue && !VALID_DOCUMENT_FACT_CHECKS[key](rawArgs[key])) {
            resolved[key] = rawArgs[key];
            continue;
        }
        if (uncertainKeys.has(key)) continue;

        if (Object.hasOwn(supportedFacts, key) && (!hasRawValue || rawArgs[key] === supportedFacts[key])) {
            resolved[key] = supportedFacts[key];
        }
    }
    return resolved;
}

function resolveEvidenceDocumentOutput(supportedFacts, language) {
    return executeChatbotTool('get_required_documents', supportedFacts, { language });
}

function renderDocumentToolReply(toolOutput, language, handoffRequested = false, allowList = true) {
    const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
    if (allowList && Array.isArray(toolOutput?.labels) && toolOutput.labels.length > 0) {
        return routeResult({
            reply: buildDocumentReply(toolOutput.labels, language),
            actions
        });
    }
    return routeResult({
        reply: buildMissingDocumentsQuestion(toolOutput?.missing || [], language),
        actions
    });
}

function renderListIntentFallbackReply(supportedFacts, language, handoffRequested, allowDeterministicEvidence) {
    const docOutput = resolveEvidenceDocumentOutput(supportedFacts, language);
    return renderDocumentToolReply(
        docOutput,
        language,
        handoffRequested,
        allowDeterministicEvidence
    );
}

function outcomeForError(error) {
    if (!(error instanceof ApiError)) return 'error';
    if (error.status === 405) return 'method_not_allowed';
    if (error.status === 403) return 'forbidden';
    if (error.status === 413) return 'payload_too_large';
    if (error.status === 400) return 'validation_error';
    if (error.status === 429) return 'rate_limited';
    if (error.status === 503) return 'unavailable';
    return 'error';
}

/**
 * Durumsuz ana sayfa sohbet uç noktası (`POST /api/public/chat`).
 * Kontrol sırası: yöntem -> aynı köken -> 8 KB boyut sınırı -> hız sınırları -> doğrulama -> başvuru numarasıyla durum sorgusu -> deterministik belge/eksik bilgi yanıtı -> günlük bütçe -> model/araç döngüsü.
 * Kişisel veri, başvuru numarası, durum içeriği, mesaj içeriği, araç argümanları ve model çıktısı hiçbir zaman günlüğe yazılmaz veya saklanmaz.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları (`DB`, `AI`, isteğe bağlı `CHATBOT_MODEL`).
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<object>} `{ reply, actions }` gövdeli rota sonucu.
 * @throws {ApiError} Yöntem, köken, boyut, hız sınırı, doğrulama veya hizmet hatasında uygun HTTP hatası fırlatır.
 */
export async function handlePublicChat(request, environment, requestId) {
    const startedAt = Date.now();
    const executedToolNames = [];
    let outcome = 'error';

    try {
        requireMethod(request, 'POST');
        requireSameOrigin(request);
        const body = await readJsonBody(request, CHATBOT_BODY_MAX_BYTES);

        const repositories = await runFailClosedRateLimit(() => createRepositories(environment));
        await runFailClosedRateLimit(() => enforceRateLimit(repositories, request, CHATBOT_RATE_LIMIT));

        const validated = validateChatInput(body);
        const lastUserMessage = validated.messages[validated.messages.length - 1].content;
        const previousAssistantMessage = validated.messages.length >= 2
            ? validated.messages[validated.messages.length - 2]
            : null;
        const userTurns = validated.messages
            .filter((message) => message.role === 'user')
            .map((message) => message.content);
        const referencedApplications = extractScopedUserReferences(validated.messages, lastUserMessage);
        if (referencedApplications.length > 1) {
            outcome = 'status_multiple_references';
            return routeResult({
                reply: getChatbotStatusFixedText('multipleReferences', validated.language),
                actions: []
            });
        }
        if (referencedApplications.length === 1) {
            // Başvuru durumu sorguları modeli ve günlük bütçeyi kullanmaz; herkese açık takip sayacıyla sınırlanır.
            await runFailClosedRateLimit(() => enforceRateLimit(repositories, request, APPLICATION_TRACKING_RATE_LIMIT));
            const trackingResult = await readPublicTrackingByReference(repositories, referencedApplications[0]);
            outcome = 'status_lookup';
            return routeResult({
                reply: renderStatusSummary(trackingResult, validated.language),
                actions: trackingResult.found
                    ? [{ type: 'link', href: '/basvurum/', label_key: 'chatbotOpenTracking' }]
                    : [{ type: 'inquiry' }]
            });
        }
        if (isOtherStudentsDataRequest(lastUserMessage)) {
            outcome = 'refusal';
            return routeResult({
                reply: getChatbotFixedText('refusal', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }
        if (hasExplicitPersonComplaintUrgentHandoff(lastUserMessage)) {
            outcome = 'handoff';
            return routeResult({
                reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                actions: [{ type: 'inquiry' }]
            });
        }
        if (isStatusQuestionWithoutReference(lastUserMessage)) {
            outcome = 'status_needs_reference';
            return routeResult({
                reply: getChatbotFixedText('statusNeedsReference', validated.language),
                actions: []
            });
        }
        if (isDeterministicHandoffRequest(lastUserMessage)) {
            outcome = 'handoff';
            return routeResult({
                reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                actions: [{ type: 'inquiry' }]
            });
        }

        const evidenceRisk = hasEvidenceRiskSafe(userTurns, validated.language);
        const { facts: supportedFacts, uncertainKeys } = readSupportedDocumentFacts(userTurns, validated.language);
        const allowDeterministicEvidence = !evidenceRisk && uncertainKeys.size === 0;
        const isAnsweringMissingFacts = isAnsweringMissingFactsQuestion(previousAssistantMessage, validated.language);
        const isShortDocumentQuery = isVeryShortDocumentQuestion(lastUserMessage);
        const { facts: lastTurnFacts, uncertainKeys: lastTurnUncertainKeys } = readSupportedDocumentFacts(
            [lastUserMessage],
            validated.language
        );
        const lastTurnHasDocumentFact = Object.keys(lastTurnFacts).length > 0 || lastTurnUncertainKeys.size > 0;
        const previousTwoUserTurns = userTurns.slice(0, -1).slice(-2);
        const previousTurnHadDocumentIntent = previousTwoUserTurns.some((turn) =>
            isVeryShortDocumentQuestion(turn)
            || isAskingWhichDocumentsAreNeeded(turn)
            || hasDocumentKeyword(turn)
        );
        const hasDocumentListIntent =
            isAnsweringMissingFacts
            || isShortDocumentQuery
            || isAskingWhichDocumentsAreNeeded(lastUserMessage)
            || (lastTurnHasDocumentFact && previousTurnHadDocumentIntent);

        if (allowDeterministicEvidence && isShortDocumentQuery) {
            const docOutput = resolveEvidenceDocumentOutput(supportedFacts, validated.language);
            outcome = 'ok';
            return renderDocumentToolReply(docOutput, validated.language);
        }

        if (allowDeterministicEvidence && hasDocumentListIntent) {
            const docOutput = resolveEvidenceDocumentOutput(supportedFacts, validated.language);
            if ((Array.isArray(docOutput?.labels) && docOutput.labels.length > 0) || isAnsweringMissingFacts) {
                outcome = 'ok';
                return renderDocumentToolReply(docOutput, validated.language);
            }
        }

        const clientAddress = request.headers.get('CF-Connecting-IP') || 'unknown-client';
        const nowSeconds = Math.floor(Date.now() / 1000);

        const withinIpDailyBudget = await consumeDailyBudgetSlot(
            repositories,
            CHATBOT_IP_DAILY_LIMIT,
            clientAddress,
            nowSeconds
        );
        if (!withinIpDailyBudget) {
            outcome = 'daily_ip_limit';
            return routeResult({
                reply: getChatbotFixedText('dailyLimit', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        const withinGlobalDailyBudget = await consumeDailyBudgetSlot(
            repositories,
            CHATBOT_GLOBAL_DAILY_LIMIT,
            CHATBOT_GLOBAL_DAILY_LIMIT.identity,
            nowSeconds
        );
        if (!withinGlobalDailyBudget) {
            outcome = 'daily_global_limit';
            return routeResult({
                reply: getChatbotFixedText('dailyLimit', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        const model = createChatModel(environment);
        const requestSignal = AbortSignal.timeout(CHATBOT_REQUEST_DEADLINE_MS);
        const conversation = [
            { role: 'system', content: buildChatbotSystemPrompt(validated.language) },
            ...validated.messages
        ];

        let finalText = null;
        let exhaustedModelCalls = false;
        let handoffRequested = false;
        let lastDocumentLabels = null;
        let lastMissingDocumentFields = null;
        let lastKnowledgeText = null;
        let failedToolRounds = 0;

        for (let modelCall = 1; modelCall <= CHATBOT_MAX_MODEL_CALLS; modelCall += 1) {
            // 3. çağrı son izin verilen çağrıdır; aracısız gönderilir ki model metin yanıtı üretmeye zorlansın.
            const allowTools = modelCall < CHATBOT_MAX_MODEL_CALLS;
            let result;
            try {
                result = await model.complete({
                    messages: conversation,
                    signal: requestSignal,
                    ...(allowTools ? { tools: CHATBOT_TOOL_DEFINITIONS } : {})
                });
            } catch (error) {
                if (hasDocumentListIntent) {
                    outcome = 'ok';
                    return renderListIntentFallbackReply(
                        supportedFacts,
                        validated.language,
                        handoffRequested,
                        allowDeterministicEvidence
                    );
                }
                throw error;
            }

            if (!result.toolCalls || result.toolCalls.length === 0) {
                finalText = result.text;
                break;
            }

            if (!allowTools) {
                exhaustedModelCalls = true;
                break;
            }

            const assistantToolCalls = [];
            const toolResultMessages = [];
            const toolCallCount = Math.min(result.toolCalls.length, CHATBOT_MAX_TOOL_CALLS_PER_RESPONSE);
            let roundHadInvalidTool = false;

            for (let index = 0; index < toolCallCount; index += 1) {
                const call = result.toolCalls[index];
                const callId = `call_${modelCall}_${index + 1}`;
                const isKnownTool = typeof call.name === 'string' && Object.hasOwn(CHATBOT_TOOLS, call.name);
                const safeToolName = isKnownTool ? call.name : 'unknown_tool';
                executedToolNames.push(safeToolName);

                assistantToolCalls.push({
                    id: callId,
                    type: 'function',
                    function: {
                        name: safeToolName,
                        arguments: JSON.stringify(call.arguments ?? {})
                    }
                });

                let toolPayload;
                try {
                    const effectiveArgs = call.name === 'get_required_documents'
                        ? resolveToolDocumentArgs(call.arguments, {
                            supportedFacts,
                            uncertainKeys
                        })
                        : call.arguments;
                    const output = executeChatbotTool(call.name, effectiveArgs, { language: validated.language });
                    if (call.name === 'handoff_to_office' || output?.action?.type === 'inquiry') {
                        handoffRequested = true;
                    }
                    if (call.name === 'get_required_documents') {
                        if (Array.isArray(output?.labels) && output.labels.length > 0) {
                            lastDocumentLabels = output.labels;
                            lastMissingDocumentFields = null;
                        } else if (Array.isArray(output?.missing) && output.missing.length > 0) {
                            lastMissingDocumentFields = output.missing;
                            lastDocumentLabels = null;
                        }
                    }
                    if (call.name === 'lookup_knowledge' && typeof output?.text === 'string' && output.text.trim()) {
                        lastKnowledgeText = output.text;
                    }
                    toolPayload = output;
                } catch {
                    roundHadInvalidTool = true;
                    toolPayload = { ok: false, error: 'INVALID_TOOL_CALL' };
                }

                toolResultMessages.push({
                    role: 'tool',
                    name: safeToolName,
                    tool_call_id: callId,
                    content: JSON.stringify(toolPayload)
                });
            }

            // Belge, eksik bilgi, bilgi tabanı ve yönlendirme sonuçları model metni olmadan deterministik döndürüldüğü için ek model çağrısı gerekmez.
            if (lastDocumentLabels || lastMissingDocumentFields || lastKnowledgeText || handoffRequested) {
                break;
            }

            if (roundHadInvalidTool) {
                failedToolRounds += 1;
                if (failedToolRounds >= CHATBOT_MAX_FAILED_TOOL_ROUNDS) {
                    exhaustedModelCalls = true;
                    break;
                }
            }

            conversation.push({
                role: 'assistant',
                content: result.text || '',
                tool_calls: assistantToolCalls
            });
            conversation.push(...toolResultMessages);
        }

        if (exhaustedModelCalls) {
            if (hasDocumentListIntent) {
                outcome = 'ok';
                return renderListIntentFallbackReply(
                    supportedFacts,
                    validated.language,
                    handoffRequested,
                    allowDeterministicEvidence
                );
            }
            outcome = 'fallback';
            return routeResult({
                reply: getChatbotFixedText('fallback', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        if (lastDocumentLabels) {
            outcome = 'ok';
            const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
            return routeResult({
                reply: buildDocumentReply(lastDocumentLabels, validated.language),
                actions
            });
        }

        if (lastMissingDocumentFields) {
            outcome = 'ok';
            const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
            return routeResult({
                reply: buildMissingDocumentsQuestion(lastMissingDocumentFields, validated.language),
                actions
            });
        }

        if (lastKnowledgeText) {
            outcome = 'ok';
            const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
            return routeResult({
                reply: lastKnowledgeText,
                actions
            });
        }

        if (handoffRequested) {
            outcome = 'ok';
            return routeResult({
                reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                actions: [{ type: 'inquiry' }]
            });
        }

        const trimmedText = typeof finalText === 'string' ? finalText.trim() : '';
        if (!trimmedText || [...trimmedText].length > CHATBOT_MAX_REPLY_CHARS) {
            if (hasDocumentListIntent) {
                outcome = 'ok';
                return renderListIntentFallbackReply(
                    supportedFacts,
                    validated.language,
                    handoffRequested,
                    allowDeterministicEvidence
                );
            }
            outcome = 'fallback';
            return routeResult({
                reply: getChatbotFixedText('fallback', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        if (trimmedText === CHATBOT_REFUSAL_MARKER || trimmedText.includes(CHATBOT_REFUSAL_MARKER)) {
            if (hasDocumentListIntent && !hasPromptOverrideMarker(lastUserMessage)) {
                outcome = 'ok';
                return renderListIntentFallbackReply(
                    supportedFacts,
                    validated.language,
                    handoffRequested,
                    allowDeterministicEvidence
                );
            }
            outcome = 'refusal';
            return routeResult({
                reply: getChatbotFixedText('refusal', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        if (looksLikeProseDocumentReply(trimmedText, validated.language) || hasDocumentListIntent) {
            outcome = 'ok';
            return renderListIntentFallbackReply(
                supportedFacts,
                validated.language,
                handoffRequested,
                allowDeterministicEvidence
            );
        }

        if (isInsufficientOrWrongScriptReply(trimmedText, validated.language)) {
            outcome = 'fallback';
            return routeResult({
                reply: getChatbotFixedText('fallback', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        outcome = 'ok';
        const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
        return routeResult({ reply: trimmedText, actions });
    } catch (error) {
        outcome = outcomeForError(error);
        throw error;
    } finally {
        console.info('Public chat request completed.', {
            requestId,
            outcome,
            tools: executedToolNames,
            latencyMs: Date.now() - startedAt
        });
    }
}
