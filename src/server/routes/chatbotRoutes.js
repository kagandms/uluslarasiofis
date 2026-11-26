import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from '../../public/i18n/messages.js';
import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../../shared/document-conditions.js';
import { isValidApplicationReference, normalizeApplicationReference } from '../auth/applicationAccessCode.js';
import * as evidence from '../domain/chatbotEvidence.js';
import { CHATBOT_LANGUAGES, readKnowledge } from '../domain/chatbotKnowledge.js';
import {
    CHATBOT_REFUSAL_MARKER,
    buildChatbotSystemPrompt,
    buildMissingDocumentsQuestion,
    buildUnderstoodFactsLine,
    getChatbotFixedText,
    getChatbotGreetingReply,
    isGreetingOnlyMessage
} from '../domain/chatbotPrompt.js';
import {
    extractMostRecentStatusFromHistory,
    getChatbotStatusFixedText,
    getStatusNextStepText,
    renderStatusSummary
} from '../domain/chatbotStatusText.js';
import {
    CHATBOT_TOOL_DEFINITIONS,
    CHATBOT_TOOLS,
    executeChatbotTool
} from '../domain/chatbotTools.js';
import { listPublicDocumentOverview } from '../domain/documentPolicy.js';
import {
    generateChatLogId,
    normalizeOptionalSessionId,
    prepareChatTurnRecord
} from '../domain/chatLog.js';
import { ApiError } from '../domain/errors.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import { createChatLogRepository } from '../repositories/d1/chatLogRepository.js';
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
const CHATBOT_REQUEST_DEADLINE_MS = 15_000;
const CHATBOT_MAX_REPLY_CHARS = 1200;

const CHATBOT_ALLOWED_ROLES = Object.freeze(['user', 'assistant']);
const CHATBOT_ROOT_KEYS = Object.freeze(['messages', 'language', 'session_id']);
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
        status: Object.freeze([/(?:^|[^\p{L}])(?:durum[\p{L}\p{N}]*|sonuc[\p{L}\p{N}]*|onay(?!li\s+(?:kira|taahhut|sozlesme|belge|evrak|cevir|tercume))[\p{L}\p{N}]*|gonderildi[\p{L}\p{N}]*|iletildi[\p{L}\p{N}]*|goc(?:\s+idaresinde\s+mi|\s+idaresine|e\s+(?:gonder|iletil|gitti|ulast|aktar))|kontrol[\p{L}\p{N}]*|incele[\p{L}\p{N}]*|kabul(?!\s+mektu)(?:\s+edil[\p{L}\p{N}]*)?|cikti\s*mi|belli\s+oldu\s*mu|hazir\s*mi|ne\s+oldu|nerede)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:basvuru[\p{L}\p{N}]*|(?:^|[^\p{L}])(?:dosya[\p{L}\p{N}]*|ikamet(?:im|\s+iznim)?|oturma\s+iznim|iznim)(?:[^\p{L}]|$))/u])
    }),
    en: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:status[\p{L}\p{N}]*|results?|accepted|approved|sent|migration|check(?:ed|ing)?|track(?:ing)?|where\s+is|what\s+happened)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])(?:applications?|files?|permits?|residence(?:\s+permit)?|ikamet)(?:[^\p{L}]|$)/u])
    }),
    ru: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:статус[\p{L}\p{N}]*|результат[\p{L}\p{N}]*|одобр[\p{L}\p{N}]*|принят[\p{L}\p{N}]*|отправ[\p{L}\p{N}]*|миграц[\p{L}\p{N}]*|провер[\p{L}\p{N}]*|готов[\p{L}\p{N}]*|вышел|вышл[\p{L}\p{N}]*|где\s+мо[\p{L}\p{N}]*|что\s+с\s+мо[\p{L}\p{N}]*|status[\p{L}\p{N}]*|prinyat[\p{L}\p{N}]*|odobren[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])(?:заявк[\p{L}\p{N}]*|заявлен[\p{L}\p{N}]*|дел(?:о|а|у|ом|е)|досье|внж|vnzh|икамет[\p{L}\p{N}]*|ikamet[\p{L}\p{N}]*|вид[\p{L}\p{N}]*\s+на\s+жительств[\p{L}\p{N}]*|zayavk[\p{L}\p{N}]*|zayavl[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u])
    }),
    tk: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:yagday[\p{L}\p{N}]*|netije[\p{L}\p{N}]*|(?<!notariusda\s+)tassyk(?!lanan\s+(?:kira|karende|kirey|borcnama|sertname|sertnama|resminama|dokument|terjime))[\p{L}\p{N}]*|iberildi[\p{L}\p{N}]*|migrasiya[\p{L}\p{N}]*|barla[\p{L}\p{N}]*|cykdymy|tayynmy|kabul(?:\s+edil[\p{L}\p{N}]*)?|nirede|name\s+boldy)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])(?:arza[\p{L}\p{N}]*|fayl[\p{L}\p{N}]*|dosye[\p{L}\p{N}]*|rugsa[td][\p{L}\p{N}]*|ikamet[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u])
    }),
    ar: Object.freeze({
        status: Object.freeze([
            /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:حاله|نتيجه|موافقه|وافق[\p{L}\p{N}]*|قبول[\p{L}\p{N}]*|مقبول[\p{L}\p{N}]*|ارسل[\p{L}\p{N}]*|ارسال[\p{L}\p{N}]*|هجره|الهجره|راجع[\p{L}\p{N}]*|مراجع[\p{L}\p{N}]*|تراجع[\p{L}\p{N}]*|يراجع[\p{L}\p{N}]*|طلع[\p{L}\p{N}]*|صدر[\p{L}\p{N}]*|جاهز[\p{L}\p{N}]*|اين|وين|ما\s+صار)(?:[^\p{L}]|$)/u,
            /(?:^|[^\p{L}])(?:natij[\p{L}\p{N}]*|ma2bul[\p{L}\p{N}]*|qabul[\p{L}\p{N}]*|halat|halet|hala(?=\s+(?:el\s+|al\s+)?(?:talab|iqam|igam))|wad3|wada3|m[uo]wafaq[\p{L}\p{N}]*|tala3|tla3|wasal|arsal|irsal|hijra)(?:[^\p{L}]|$)/u
        ]),
        application: Object.freeze([/(?:طلب[\p{L}\p{N}]*|(?:^|[^\p{L}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:ملف[\p{L}\p{N}]*|اقامت[\p{L}\p{N}]*)|talab[\p{L}\p{N}]*|iqamt[\p{L}\p{N}]*|igamt[\p{L}\p{N}]*)(?:[^\p{L}]|$))/u])
    })
});

const STAGE_STATUS_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:hangi\s+)?asama(?:da[\p{L}\p{N}]*|si[\p{L}\p{N}]*|sina|lar[\p{L}\p{N}]*)?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])stages?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:этап[\p{L}\p{N}]*|etap[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])tapgyr[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مرحل|مراحل)[\p{L}\p{N}]*|marhal[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
]);

const STANDALONE_STATUS_PHRASES = Object.freeze([
    'basvurum ne durumda',
    'basvurum ne alemde',
    'what is my application status',
    'whats my status',
    'what is my status',
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
    /(?:^|[^\p{L}])(?:basvurum[\p{L}\p{N}]*|dosyam[\p{L}\p{N}]*|ikametim[\p{L}\p{N}]*|ikamet\s+iznim[\p{L}\p{N}]*|oturma\s+iznim[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:yukledigim|gonderdigim|verdigim|ekledigim|ilettigim)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:dosya|belge|evrak|basvuru)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])my\s+(?:applications?|file(?!\s+size)s?|(?:student\s+)?(?:residence\s+)?permits?|ikamet)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:the\s+|my\s+)?(?:files?|applications?|documents?|docs)\s+(?:that\s+|which\s+)?i\s+(?:uploaded|sent|submitted)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:мо(?:я|еи|ю)\s+заявк[\p{L}\p{N}]*|мо(?:е|его|ему|им|ем)\s+(?:дел(?:о|а|у|ом|е)|заявлен[\p{L}\p{N}]*)|мо(?:и|его|ему|им|ем)\s+(?:внж|икамет[\p{L}\p{N}]*|вид[\p{L}\p{N}]*\s+на\s+жительств[\p{L}\p{N}]*)|на\s+каком\s+этапе\s+мо(?:я|еи|ю|е))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])mo(?:ya|ey|yey|yu)\s+zayavk[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:документ[\p{L}\p{N}]*|фаил[\p{L}\p{N}]*|дел[\p{L}\p{N}]*|заявк[\p{L}\p{N}]*|заявлен[\p{L}\p{N}]*),?\s+котор(?:ыи|ую|ое|ые)\s+я\s+(?:отправил[\p{L}\p{N}]*|загрузил[\p{L}\p{N}]*|подал[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:arzam[\p{L}\p{N}]*|rugsadym[\p{L}\p{N}]*|ikametim[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:yuklan|iberen|tabsyran|beren)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:fayl|arza|resminama|dosye)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:و|ف|ب|ل)?(?:طلبي|ملفي|اقامتي)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:talabi|iqamti|igamti)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:ملف|طلب|مستند)\s+الذي|(?:مستندات|وثايق)\s+التي)\s+(?:ارسلته|ارسلتها|رفعته|رفعتها|قدمته|قدمتها)(?:[^\p{L}]|$)/u
]);

const STATUS_IDENTIFIER_OR_PARTIAL_REF_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}\p{N}])(?:ogrenci\s*(?:numara[\p{L}\p{N}]*|no)|student\s*(?:number|num|no|id)|номер\s+(?:студента|паспорта|заявки)|nomer\s+(?:pasporta|studenta|zayavki)|talyp\s+belgi[\p{L}\p{N}]*|ra2mi?\s+(?:el\s+)?jam3i|رقم[\p{L}\p{N}]*\s+(?:ال)?(?:جامع[\p{L}\p{N}]*|طالب|جواز)|pasaport[\p{L}\p{N}]*|passport[\p{L}\p{N}]*|паспорт[\p{L}\p{N}]*|pasport[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?جواز[\p{L}\p{N}]*)(?:[^\p{L}\p{N}]|$)/u,
    /(?:^|[^\p{L}\p{N}])(?:itu\s*-\s*[\p{L}\p{N}]{0,4}(?:\s*-\s*[\p{L}\p{N}]{0,4})?|ref(?:erence)?(?:\s+(?:number|num|no|code))?|referans[\p{L}\p{N}]*)(?:[^\p{L}\p{N}]|$)/u,
    /(?:^|[^\p{L}\p{N}])(?:\d{6,12}|[a-z]{1,2}\d{6,9})(?:[^\p{L}\p{N}]|$)/u
]);

const OTHER_PERSON_MARKER_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:arkadasim[\p{L}\p{N}]*|kardesim[\p{L}\p{N}]*|abim[\p{L}\p{N}]*|ablam[\p{L}\p{N}]*|agabeyim[\p{L}\p{N}]*|oglum[\p{L}\p{N}]*|kizim[\p{L}\p{N}]*|esim[\p{L}\p{N}]*|karim[\p{L}\p{N}]*|kocam[\p{L}\p{N}]*|kuzenim[\p{L}\p{N}]*|baskasinin|baska\s+biri[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:my\s+)?(?:friend|brother|sister|sibling|roommate|classmate|colleague|partner|spouse|husband|wife|cousin|son|daughter)(?:'s|s)?|someone\s+else(?:'s)?|another\s+(?:person|student)(?:'s)?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:мо(?:его|ему|им|ем|еи|и)?\s+)?(?:друг(?:а|у|ом|е)?|подруг[\p{L}\p{N}]*|брат[\p{L}\p{N}]*|сестр[\p{L}\p{N}]*|сосед[\p{L}\p{N}]*|одногрупп[\p{L}\p{N}]*|однокурс[\p{L}\p{N}]*|муж[\p{L}\p{N}]*|жен(?:а|ы|е|у|ои)|сын[\p{L}\p{N}]*|доч[\p{L}\p{N}]*|чуж(?:ую|ои|ого|ому|еи)|другого\s+(?:человека|студента)|brat[\p{L}\p{N}]*|sestr[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:dostum[\p{L}\p{N}]*|yoldasym[\p{L}\p{N}]*|doganym[\p{L}\p{N}]*|agam[\p{L}\p{N}]*|inim[\p{L}\p{N}]*|uyam[\p{L}\p{N}]*|basga\s+(?:birinin|talybyn))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:و|ف|ب|ل)?(?:صديق(?:ي|تي|ه|ها)?|صاحب(?:ي|تي)?|اخ(?:ي|وي|ويا)|اخت(?:ي)?|شقيق(?:ي|تي)?|زميل(?:ي|تي)?|زوج(?:ي|تي)?|ابن(?:ي)?|بنت(?:ي)?|شخص\s+اخر|طالب\s+اخر|sadiq(?:i)?|akhi|okhti|sahbi)(?:[^\p{L}]|$)/u
]);

const OTHER_PERSON_STATUS_VERB_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:ne\s+durumda|ne\s+alemde|cikti\s*mi|oldu\s*mu|bitti\s*mi|bakabilir\s+misin[\p{L}\p{N}]*|ogrenebilir\s+miyim|soyler\s+misin[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:check|look\s+up|what\s+happened|tell\s+me\s+(?:about|if)|gave\s+permission|asked\s+me\s+to\s+check)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:узнать|посмотреть|проверить|разрешил[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:barla[\p{L}\p{N}]*|bilmek|aydyp\s+bilersinizmi|rugsat\s+berdi)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:و|ف|ب|ل)?(?:استعلم|الاستعلام|اعرف|شوف|سمح\s+لي|سمحت\s+لي)(?:[^\p{L}]|$)/u
]);

const GUARANTEE_OR_LEGAL_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:garanti[\p{L}\p{N}]*|kesin(?:likle)?\s+(?:cik[\p{L}\p{N}]*|onay[\p{L}\p{N}]*)|yuzde\s+yuz\s+(?:cik[\p{L}\p{N}]*|onay[\p{L}\p{N}]*)|%100\s+(?:cik[\p{L}\p{N}]*|onay[\p{L}\p{N}]*)|itiraz\s+dilekce[\p{L}\p{N}]*|dilekce[\p{L}\p{N}]*\s+yaz[\p{L}\p{N}]*|hukuki\s+(?:danisman[\p{L}\p{N}]*|tavsiye[\p{L}\p{N}]*|gorus[\p{L}\p{N}]*|yardim[\p{L}\p{N}]*|destek[\p{L}\p{N}]*)|avukat[\p{L}\p{N}]*|dava\s+ac[\p{L}\p{N}]*|mahkeme[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:guarantee[\p{L}\p{N}]*|promise\s+(?:[\p{L}\p{N}]+\s+){0,3}(?:permit|approv[\p{L}\p{N}]*|visa|ikamet)|legal\s+(?:advice|counsel|opinion|representation)|appeal\s+(?:letter|petition)|(?:write|draft)\s+(?:an?\s+|my\s+)?(?:appeal|petition|legal\s+[\p{L}\p{N}]+)|lawyers?|attorneys?|lawsuits?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:гарантир[\p{L}\p{N}]*|гаранти(?:я|ю|и|е)|обеща[\p{L}\p{N}]*\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:одобр[\p{L}\p{N}]*|внж|получен[\p{L}\p{N}]*)|точно\s+(?:одобр[\p{L}\p{N}]*|выдадут|дадут|получу)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:внж|икамет[\p{L}\p{N}]*|разрешени[\p{L}\p{N}]*)|юридическ[\p{L}\p{N}]*\s+(?:консультац[\p{L}\p{N}]*|совет[\p{L}\p{N}]*|помощ[\p{L}\p{N}]*)|адвокат[\p{L}\p{N}]*|апелляц[\p{L}\p{N}]*|обжалован[\p{L}\p{N}]*|подать\s+в\s+суд)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:kepillendir[\p{L}\p{N}]*|kepillik[\p{L}\p{N}]*|hokman\s+(?:cyk[\p{L}\p{N}]*|tassyklan[\p{L}\p{N}]*)|hukuk\s+(?:maslahat[\p{L}\p{N}]*|komek[\p{L}\p{N}]*)|adwokat[\p{L}\p{N}]*|sikayat\s+(?:hat|arza)[\p{L}\p{N}]*\s+yaz[\p{L}\p{N}]*|kazy[y]?et[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:و|ف)?(?:تضمن[\p{L}\p{N}]*|اضمن[\p{L}\p{N}]*|ضمان[\p{L}\p{N}]*|تعدني|استشاره\s+قانوني[\p{L}\p{N}]*|نصيحه\s+قانوني[\p{L}\p{N}]*|راي\s+قانوني[\p{L}\p{N}]*|محامي[\p{L}\p{N}]*|طعن[\p{L}\p{N}]*|استيناف[\p{L}\p{N}]*|عريضه[\p{L}\p{N}]*|محكمه[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
]);

const STANDALONE_LIST_INTENT_WITHOUT_KEYWORD_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])ne(?:ler)?\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:lazim|gerek(?:li|iyor|ir|ecek|mektedir)?|getirmeli[\p{L}\p{N}]*|hazirlamali[\p{L}\p{N}]*|isteniyor)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])what\s+(?:do\s+i\s+need|should\s+i\s+(?:bring|prepare|upload|submit)|is\s+(?:needed|required))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:что\s+(?:нужно|необходимо|принести|подготовить|загрузить)|chto\s+nuzhno)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])name\s+(?:gerek[\p{L}\p{N}]*|tapsyrmaly|getirmeli|tayyarlamaly)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:ما\s+(?:هو\s+)?المطلوب|شو\s+(?:لازم|مطلوب)|شنو\s+(?:لازم|مطلوب)|ماذا\s+(?:احتاج|احضر|اجهز))(?:[^\p{L}]|$)/u
]);

const CONTACT_CHANNEL_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:whatsapp|whatsap|watsap|واتساب|واتس\s+اب)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:e-?pocta|e-?posta|e-?mail|email|электронн[\p{L}\p{N}]*\s+почт[\p{L}\p{N}]*|(?:ال)?بريد\s+(?:ال)?الكتروني|ايميل)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:telefon\s+(?:numara[\p{L}\p{N}]*|belgi[\p{L}\p{N}]*)|iletisim\s+bilgi[\p{L}\p{N}]*|habarlas[\p{L}\p{N}]*\s+salg[\p{L}\p{N}]*|contact\s+(?:number|email|info|details)|номер\s+телефона\s+офиса|رقم\s+(?:هاتف|تواصل)\s+(?:ال)?مكتب)(?:[^\p{L}]|$)/u
]);

const CONTACT_CHANNEL_EXCLUSION_PATTERN = /(?:^|[^\p{L}])(?:unuttum|unut[\p{L}\p{N}]*|gelmedi|onay\s+e-?posta|forgot|confirmation|spam|забыл[\p{L}\p{N}]*|подтвержд[\p{L}\p{N}]*|не\s+пришл[\p{L}\p{N}]*|unutd[\p{L}\p{N}]*|tassyklama|نسيت|تاكيد|لم\s+يصل|سبام)(?:[^\p{L}]|$)/u;

const FINGERPRINT_TOPIC_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:parmak\s+iz[\p{L}\p{N}]*|fingerprints?|отпечат[\p{L}\p{N}]*|otpechat[\p{L}\p{N}]*|barmak\s+yz[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*|basma)(?:[^\p{L}]|$)/u
]);

const DOCUMENT_KEYWORD_PATTERNS = Object.freeze([
    /belge[\p{L}\p{N}]*/u,
    /evrak[\p{L}\p{N}]*/u,
    /dokuman[\p{L}\p{N}]*/u,
    /document[\p{L}\p{N}]*/u,
    /dokument[\p{L}\p{N}]*/u,
    /(?:^|[^\p{L}])(?:docs?|paperwork)(?:[^\p{L}]|$)/u,
    /документ[\p{L}\p{N}]*/u,
    /бумаг[\p{L}\p{N}]*/u,
    /resminama[\p{L}\p{N}]*/u,
    /مستند[\p{L}\p{N}]*/u,
    /وثايق[\p{L}\p{N}]*/u,
    /وثيقه/u,
    /(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?اوراق[\p{L}\p{N}]*/u,
    /(?:^|[^\p{L}])(?:awra(?:2|q)|mustanad[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
]);

const SHORT_DOCUMENT_EXCLUDE_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:format[\p{L}\p{N}]*|boyut[\p{L}\p{N}]*|yukle[\p{L}\p{N}]*|yeniden[\p{L}\p{N}]*|nerede[\p{L}\p{N}]*|nereden|nereye|pdf|jpe?g|png|webp|mb|sayfa)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:size|upload[\p{L}\p{N}]*|resubmit[\p{L}\p{N}]*|replace[\p{L}\p{N}]*|where|pages?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:формат[\p{L}\p{N}]*|размер[\p{L}\p{N}]*|загруз[\p{L}\p{N}]*|повтор[\p{L}\p{N}]*|замен[\p{L}\p{N}]*|где|куда|откуда|страниц[\p{L}\p{N}]*|мб)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:gornus[\p{L}\p{N}]*|yukle[\p{L}\p{N}]*|tazeden[\p{L}\p{N}]*|nirede[\p{L}\p{N}]*|nireden|nira|sahypa)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:صيغه|حجم|رفع|اعاده\s+رفع|صفح[\p{L}\p{N}]*|ميغابايت)|(?:و|ف)?(?:اين|وين|من\s+اين))(?:[^\p{L}]|$)/u
]);

const NON_LIST_KNOWLEDGE_OR_QUESTION_PATTERNS = Object.freeze([
    ...HOW_TO_OR_WHAT_IS_PATTERNS,
    ...SHORT_DOCUMENT_EXCLUDE_PATTERNS,
    /(?:^|[^\p{L}])(?:adim[\p{L}\p{N}]*|asama[\p{L}\p{N}]*|surec[\p{L}\p{N}]*|saat[\p{L}\p{N}]*|iletisim|unuttum|sifremi|kvkk|gizlilik|ogrenci\s+karti[\p{L}\p{N}]*|kimlik\s+karti[\p{L}\p{N}]*|harc[\p{L}\p{N}]*|ucret[\p{L}\p{N}]*|odeme[\p{L}\p{N}]*|fiyat[\p{L}\p{N}]*|ne\s+kadar|randevu[\p{L}\p{N}]*|neden|niye|nelerdir)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:steps?|stages?|process|hours?|contact|forgot|privacy|student\s+(?:id\s+)?card|fees?|cost[\p{L}\p{N}]*|pay(?:ment|ing)?|how\s+much|appointments?|booking|why)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:этап[\p{L}\p{N}]*|шаг[\p{L}\p{N}]*|процесс[\p{L}\p{N}]*|час[\p{L}\p{N}]*|контакт[\p{L}\p{N}]*|забыл[\p{L}\p{N}]*|конфиденциальност[\p{L}\p{N}]*|студенческ[\p{L}\p{N}]*\s+карт[\p{L}\p{N}]*|пошлин[\p{L}\p{N}]*|оплат[\p{L}\p{N}]*|стоимост[\p{L}\p{N}]*|цен[\p{L}\p{N}]*|плат[\p{L}\p{N}]*|запис[\p{L}\p{N}]*|прием[\p{L}\p{N}]*|рандеву|почему|зачем|etap[\p{L}\p{N}]*|shag[\p{L}\p{N}]*|poshlin[\p{L}\p{N}]*|oplat[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:adim[\p{L}\p{N}]*|tapgyr[\p{L}\p{N}]*|sagat[\p{L}\p{N}]*|habarlas[\p{L}\p{N}]*|unutd[\p{L}\p{N}]*|talyp\s+kart[\p{L}\p{N}]*|toreg[\p{L}\p{N}]*|toleg[\p{L}\p{N}]*|pac[\p{L}\p{N}]*|baha[\p{L}\p{N}]*|nace|randewu[\p{L}\p{N}]*|name\s+ucin)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:خطو[\p{L}\p{N}]*|مراحل|مرحله|ساعات|تواصل|نسيت|خصوصيه|بطاقه\s+(?:ال)?طالب|رسوم|دفع|تكلفه|مبلغ|موعد|مواعيد|حجز)|(?:و|ف)?(?:لماذا|ليش))(?:[^\p{L}]|$)/u
]);

const DOCUMENT_LIST_INTENT_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:hangi\s+(?:belge|evrak|dokuman)[\p{L}\p{N}]*|(?:belge|evrak|dokuman)[\p{L}\p{N}]*\s+(?:neler(?:dir)?|nelr|listesi|listele|soyle[\p{L}\p{N}]*)|ne(?:ler)?\s+gerek[\p{L}\p{N}]*|(?:gerekli|gereken|istenen)\s+(?:belge|evrak|dokuman)[\p{L}\p{N}]*|lazim|neler\s+(?:lazim|gerek[\p{L}\p{N}]*|getirmeli[\p{L}\p{N}]*|hazirlamali[\p{L}\p{N}]*|isteniyor)|(?:basvuru[\p{L}\p{N}]*\s+icin\s+|icin\s+)(?:belge|evrak|dokuman)[\p{L}\p{N}]*\s*\??$)(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:(?:which|what)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:documents?|docs|paperwork)(?!\s+(?:format|size|types?))|required\s+(?:documents?|docs|paperwork)|(?:documents?|docs|paperwork)\s+(?:are\s+)?(?:required|needed|i\s+need)|(?:document|documents|doc|docs|paperwork)\s+list|list\s+(?:of\s+|the\s+)?(?:required\s+)?(?:documents?|docs|paperwork)|do\s+i\s+need(?!\s+to\s+(?:upload|resubmit|replace|scan|convert|compress|resize))|^(?:documents?|docs|paperwork)\s+for\s+)(?:[^\p{L}]|$)/u,
    // ru (Cyrillic and Latin-script)
    /(?:^|[^\p{L}])(?:какие\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:документ|бумаг)[\p{L}\p{N}]*|список\s+(?:[\p{L}\p{N}]+\s+){0,2}документ[\p{L}\p{N}]*|необходим[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|нужн[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|документ[\p{L}\p{N}]*\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:нужн|необходим)[\p{L}\p{N}]*|что\s+нужно|kakie\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:dokument|bumag)[\p{L}\p{N}]*|spisok\s+(?:[\p{L}\p{N}]+\s+){0,2}dokument[\p{L}\p{N}]*|neobhodim[\p{L}\p{N}]*\s+dokument[\p{L}\p{N}]*|nuzhn[\p{L}\p{N}]*\s+dokument[\p{L}\p{N}]*|dokument[\p{L}\p{N}]*\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:nuzhn|neobhodim)[\p{L}\p{N}]*|chto\s+nuzhno)(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])(?:haysy\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:resminama|dokument)[\p{L}\p{N}]*|name\s+(?:(?:resminama|dokument)[\p{L}\p{N}]*\s+)?(?:gerek[\p{L}\p{N}]*|tapsyrmaly)|gerekli\s+(?:resminama|dokument)[\p{L}\p{N}]*|(?:resminama|dokument)[\p{L}\p{N}]*\s+(?:gerek[\p{L}\p{N}]*|sanaw[\p{L}\p{N}]*|tapsyrmaly))(?:[^\p{L}]|$)/u,
    // ar (Arabic and Arabizi)
    /(?:^|[^\p{L}])(?:(?:ما|شو|شنو|وش|ايش)\s+(?:هي\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مستندات|وثايق|اوراق)|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مستندات|وثايق|اوراق)\s+(?:ال)?(?:مطلوب[\p{L}\p{N}]*|لازم[\p{L}\p{N}]*|ضروري[\p{L}\p{N}]*)|قايمه\s+(?:ال)?(?:مستندات|وثايق|اوراق)|(?:بدي|اريد|احتاج)\s+(?:اعرف\s+)?(?:ال)?(?:مستندات|وثايق|اوراق)|(?:chou|shu|shnu|ay|ma)\s+(?:el\s+|al\s+)?(?:awra(?:2|q)|mustanad[\p{L}\p{N}]*|wathayeq))(?:[^\p{L}]|$)/u
]);

const OTHER_STUDENTS_DATA_RULES_BY_LANGUAGE = Object.freeze({
    tr: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:diger|baska(?:\s+bir)?|tum|butun)\s+ogrenci[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:liste[\p{L}\p{N}]*|telefon[\p{L}\p{N}]*|numara[\p{L}\p{N}]*|bilgi[\p{L}\p{N}]*|adres[\p{L}\p{N}]*|isim[\p{L}\p{N}]*|ism[\p{L}\p{N}]*|adlar[\p{L}\p{N}]*|adini|veriler[\p{L}\p{N}]*|pasaport[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:ver(?:ir|ebilir|in|iniz|sene|senize)?|goster(?:ir|ebilir|in|iniz)?|listele(?:r|yebilir|yin|yiniz)?|gonder(?:ir|ebilir|in|iniz)?)(?:[^\p{L}]|$)/u
        ])
    }),
    en: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:other\s+students?(?:'s|s')?|another\s+student(?:'s)?|all\s+students?(?:'s|s')?)(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:lists?|data|phones?|numbers?|address(?:es)?|names?|passports?)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:give|show|list|send)(?:[^\p{L}]|$)/u
        ])
    }),
    ru: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:друг(?:ие|их|им|ими|ои|ого|ому)|всех)\s+студент[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:спис(?:ок|ки|ка|ке|ком|ков)|данн[\p{L}\p{N}]*|телефон[\p{L}\p{N}]*|номер[\p{L}\p{N}]*|адрес[\p{L}\p{N}]*|имя|имен[\p{L}\p{N}]*|фамили[\p{L}\p{N}]*|паспорт[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:даи(?:те)?|покажи(?:те)?|пришли(?:те)?|список)(?:[^\p{L}]|$)/u
        ])
    }),
    tk: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:beyleki|basga|ahli)\s+talyp[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:sanaw[\p{L}\p{N}]*|telefon[\p{L}\p{N}]*|belgi[\p{L}\p{N}]*|nomer[\p{L}\p{N}]*|maglumat[\p{L}\p{N}]*|salgy[\p{L}\p{N}]*|atlar[\p{L}\p{N}]*|adyny|pasport[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:ber(?:in)?|gorkez(?:in)?)(?:[^\p{L}]|$)/u
        ])
    }),
    ar: Object.freeze({
        otherStudents: Object.freeze([
            /(?:^|[^\p{L}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:طلاب\s+(?:ال)?اخر(?:ين|ون)|طالب\s+(?:ال)?اخر)|(?:كل|جميع)\s+(?:ال)?طلاب)(?:[^\p{L}]|$)/u
        ]),
        personalData: Object.freeze([
            /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:قايمه|قوايم|بيانات|معلومات|هاتف|هواتف|تليفون|جوال|موبايل|رقم|ارقام|عنوان|عناوين|اسم|اسماء|جواز[\p{L}\p{N}]*)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
        ]),
        requestVerb: Object.freeze([
            /(?:^|[^\p{L}])(?:و|ف)?(?:اعطني|اعطيني|اعطونا|ارني|اريني|ارسل(?:ي|وا)?)(?:[^\p{L}]|$)/u
        ])
    })
});

const EXPLICIT_HANDOFF_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:insanla|yetkiliyle|personelle|biriyle|calisanla[\p{L}\p{N}]*)\s*(?:gorus[\p{L}\p{N}]*|konus[\p{L}\p{N}]*|iletisim[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:danisman(?:la|a)?|yetkili\s+biri(?:yle|ne)?|gorevli(?:yle|ye)?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])gercek\s*(?:bir\s*)?(?:insan|kisi)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])sikayet[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])acil(?:\s+durum[\p{L}\p{N}]*)?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:eksik\s+(?:belge|evrak|dokuman)[\p{L}\p{N}]*|(?:belge|evrak|dokuman)[\p{L}\p{N}]*\s+eksik(?:ti|tir)?|belgem\s+eksik|evragim\s+eksik)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:ofis(?:ten)?\s+(?:cevap|yanit|donus)\s+(?:yok|gelmedi|vermiyor|alamadim)|(?:cevap|yanit|donus)\s+(?:yok|gelmedi|vermiyor|alamadim)|kimse\s+(?:cevap|yanit|donus)\s+vermiyor)(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:talk|speak|chat|connect[\p{L}\p{N}]*)\s+(?:to|with)\s+(?:an?\s+)?(?:real\s+|human\s+)?(?:person|human|staff|advisor|representative|agent|someone)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:need|want)\s+(?:to\s+(?:talk|speak|chat|connect)\s+(?:to|with)\s+)?(?:an?\s+)?(?:human\s+)?advisor(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:a\s+human|connect\s+me(?:\s+to)?|case[\s-]+specific\s+help|review\s+my\s+case)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:need|want)\s+help\s+from\s+(?:the\s+)?staff(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])real\s+person(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])complaint[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])urgent(?:ly)?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:missing\s+(?:a\s+|my\s+|some\s+)?(?:documents?|docs?|files?|papers?)|(?:documents?|docs?|files?)\s+(?:is|are)\s+missing)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:no\s+(?:reply|response|answer)\s+from\s+(?:the\s+)?office|office\s+(?:has\s+not|hasn't|did\s+not|didn't|is\s+not|isn't)\s+(?:replied|responded|answering|responding|replying)|nobody\s+(?:is\s+)?(?:replying|responding|answering))(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:поговорить|связаться|пообщаться|соединить)\s+с\s+(?:живым\s+|реальным\s+)?(?:человеком|сотрудником|оператором|специалистом|представителем)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:консультант[\p{L}\p{N}]*|соедините|свяжите\s+меня)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])помощь\s+сотрудник[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])жалоб[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])срочн[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:не\s+хватает\s+(?:документ[\p{L}\p{N}]*|фаил[\p{L}\p{N}]*)|отсутству[\p{L}\p{N}]*\s+(?:документ[\p{L}\p{N}]*|фаил[\p{L}\p{N}]*)|пропущен[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:нет\s+ответа\s+(?:от\s+офиса|из\s+офиса)|офис\s+не\s+отвечает|никто\s+не\s+отвечает)(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])adam\s+bilen\s+gurles[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:ofis\s+)?isgar[\p{L}\p{N}]*(?:\s+bilen)?|maslahatcy[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])sikayat[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])gyssagly(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:kem\s+resminama[\p{L}\p{N}]*|resminama[\p{L}\p{N}]*\s+kem|yetmezcilik\s+edyan\s+resminama)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:ofis(?:den)?\s+jogap\s+(?:yok|gelmedi|bermeyar)|jogap\s+(?:yok|gelmedi|bermeyar))(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تحدث|التحدث|اتحدث|تكلم|التكلم|اتكلم|تواصل|التواصل|اتواصل)\s+مع\s+(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:شخص|انسان|موظف|احد)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:و|ف)?(?:احكي\s+مع|بدي\s+احكي|اتكلم\s+مع|اتحدث\s+مع)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:و|ف)?(?:بدي|اريد|احتاج|ممكن)\s+(?:(?:احكي|اتكلم|اتحدث|التحدث|تحدث|تواصل)\s+مع\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?موظف[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?شخص\s+حقيقي(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مساعده\s+(?:من\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?موظف(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?شكو[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?عاجل[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:مستند|مستندات|وثيقه|وثايق|اوراق)\s+ناقص[\p{L}\p{N}]*|نقص\s+(?:في\s+)?(?:ال)?(?:مستندات|وثايق|اوراق))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:لا\s+(?:يوجد\s+)?رد\s+من\s+(?:ال)?مكتب|(?:ال)?مكتب\s+(?:لا\s+يرد|لم\s+يرد)|ما\s+في\s+رد\s+من\s+(?:ال)?مكتب)(?:[^\p{L}]|$)/u
]);

const OFFICE_HANDOFF_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])ofisle\s*(?:gorus[\p{L}\p{N}]*|konus[\p{L}\p{N}]*|iletisim[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])ofise\s*(?:ulas[\p{L}\p{N}]*|yaz[\p{L}\p{N}]*|baglan[\p{L}\p{N}]*|aktar[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:talk|speak|chat|connect[\p{L}\p{N}]*|reach|contact|message|write|get\s+in\s+touch)\s+(?:to\s+|with\s+)?(?:the\s+)?office(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])office\s+team(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:need|want)\s+help\s+from\s+(?:the\s+)?office(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:поговорить|связаться|пообщаться|соединить)\s+с\s+офисом(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:написать|обратиться|дозвониться)\s+(?:в\s+офис|до\s+офиса)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])ofis(?:e|bilen)\s+(?:habarlas|yuz\s+tut|yet)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تحدث|التحدث|اتحدث|تكلم|التكلم|اتكلم|تواصل|التواصل|اتواصل)\s+مع\s+(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مكتب(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:الوصول|مراسله)\s+(?:الي\s+|ل)?(?:ال)?مكتب(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مساعده\s+(?:من\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مكتب(?:[^\p{L}]|$)/u
]);

const HANDOFF_PATTERNS = Object.freeze([
    ...EXPLICIT_HANDOFF_PATTERNS,
    ...OFFICE_HANDOFF_PATTERNS
]);

const PROMPT_OVERRIDE_MARKER_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:(?:onceki|tum|butun)\s+){0,2}(?:kurallar[\p{L}\p{N}]*|talimatlar[\p{L}\p{N}]*|yonergeler[\p{L}\p{N}]*)\s*(?:(?:[\p{L}\p{N}]+\s+){0,2})?(?:unut[\p{L}\p{N}]*|yok\s*say[\p{L}\p{N}]*|ihmal[\p{L}\p{N}]*|bos\s*ver[\p{L}\p{N}]*|dikkate\s+alma[\p{L}\p{N}]*|gormezden\s+gel[\p{L}\p{N}]*|uyma[\p{L}\p{N}]*|birak[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:sistem\s+prompt[\p{L}\p{N}]*|gelistirici\s+modu[\p{L}\p{N}]*|(?:(?:sistem|gizli|dahili|ic)\s+(?:talimatlar[\p{L}\p{N}]*|yonergeler[\p{L}\p{N}]*)|(?:sistem\s+)?prompt[\p{L}\p{N}]*)\s*(?:goster[\p{L}\p{N}]*|yaz[\p{L}\p{N}]*|soyle[\p{L}\p{N}]*)|(?:goster|yaz|soyle)[\p{L}\p{N}]*\s+(?:(?:sistem|gizli|dahili|ic)\s+(?:talimatlar[\p{L}\p{N}]*|yonergeler[\p{L}\p{N}]*)|(?:sistem\s+)?prompt[\p{L}\p{N}]*))(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:system\s+override|(?:ignore|disregard|forget|override|bypass|skip)\s+(?:(?:all|any|the|your|these|previous|prior|earlier|above|system)\s+){0,3}(?:rules|restrictions|instructions|guidelines|policy|policies|prompt))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:system|hidden|internal)\s+(?:prompt|instructions)|(?:reveal|show|print|display|output|repeat)\s+(?:your\s+|the\s+)?(?:(?:system|hidden|internal)\s+instructions|(?:system\s+|hidden\s+|internal\s+)?prompts?)|developer\s+mode|act\s+as\s+(?:a\s+|an\s+|the\s+)?(?:system|developer|admin|administrator|root|unrestricted|jailbroken|evil|dan))(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:(?:про)?игнориру[\p{L}\p{N}]*|забуд[\p{L}\p{N}]*|отмен[\p{L}\p{N}]*|обоид[\p{L}\p{N}]*|отключ[\p{L}\p{N}]*|не\s+следу[\p{L}\p{N}]*)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:правил[\p{L}\p{N}]*|инструкци[\p{L}\p{N}]*|ограничени[\p{L}\p{N}]*|указани[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:системн[\p{L}\p{N}]*\s+промпт[\p{L}\p{N}]*|(?:покажи[\p{L}\p{N}]*|раскрои[\p{L}\p{N}]*|выведи[\p{L}\p{N}]*)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:промпт[\p{L}\p{N}]*|(?:системн[\p{L}\p{N}]*|скрыт[\p{L}\p{N}]*|внутренн[\p{L}\p{N}]*)\s+инструкци[\p{L}\p{N}]*)|режим\s+разработчика)(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])(?:(?:onki|ahli)\s+){0,2}(?:gor[\p{L}\p{N}]*|duzgun[\p{L}\p{N}]*|gorkezme[\p{L}\p{N}]*|kada[\p{L}\p{N}]*)\s*(?:yatdan\s+cykar[\p{L}\p{N}]*|unut[\p{L}\p{N}]*|asgerme[\p{L}\p{N}]*|hasaba\s+alma[\p{L}\p{N}]*|eyerme[\p{L}\p{N}]*|boz[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:ulgam\s+prompt[\p{L}\p{N}]*|(?:(?:ulgam|gizlin|icki)\s+gorkezme[\p{L}\p{N}]*|prompt[\p{L}\p{N}]*)\s+gorkez[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:و|ف)?(?:تجاهل[\p{L}\p{N}]*|انسي|انس|اترك[\p{L}\p{N}]*|الغ[\p{L}\p{N}]*|احذف[\p{L}\p{N}]*)\s+(?:(?:كل|جميع|هذه|تلك)\s+){0,2}(?:ال)?(?:قواعد|قوانين|تعليمات|قيود|اوامر|توجيهات|شروط)(?:\s+(?:ال)?سابقه)?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:موجه\s+النظام|(?:ال)?تعليمات\s+(?:ال)?سابقه|(?:اكشف|اظهر|اعرض|وريني)\s+(?:لي\s+)?(?:(?:ال)?تعليمات\s+(?:ال)?(?:نظام|داخليه|مخفيه|سريه)|موجه\s+النظام|(?:ال)?برومبت)|وضع\s+المطور)(?:[^\p{L}]|$)/u
]);

const UNHELPFUL_MODEL_REPLY_PATTERNS = Object.freeze([
    // en
    /(?:^|[^\p{L}])(?:input\s+is\s+(?:not\s+sufficient|incomplete)|(?:more|additional|further)\s+(?:information|info|details)\s+(?:is|are)\s+(?:needed|required)|(?:insufficient|not\s+enough)\s+(?:information|info|details)|please\s+provide\s+(?:further|more|additional)\s+(?:details|information))(?:[^\p{L}]|$)/u,
    // tr
    /(?:^|[^\p{L}])(?:girdiniz\s+(?:eksik|yetersiz)|daha\s+fazla\s+bilgi\s+(?:gerek[\p{L}\p{N}]*|lazim)|yeterli\s+bilgi\s+(?:yok|degil|bulunmuyor)|bilgi\s+yetersiz|eksik\s+bilgi)(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:недостаточно\s+(?:информаци[\p{L}\p{N}]*|данных|сведении)|требуется\s+(?:больше|дополнительн[\p{L}\p{N}]*)\s+информаци[\p{L}\p{N}]*|нужно\s+больше\s+информаци[\p{L}\p{N}]*|(?:ваш\s+запрос|ввод)\s+неполн[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])(?:maglumat\s+(?:yeterlik|yeterli)\s+dal|(?:has\s+kop|gosmaca)\s+maglumat\s+gerek|(?:girizen\s+maglumatynyz|soragynyz)\s+doly\s+dal)(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:(?:ال)?معلومات\s+غير\s+كافيه|(?:يلزم|تحتاج|نحتاج|مطلوب)\s+(?:الي\s+)?(?:مزيد\s+من\s+)?معلومات\s+(?:اضافيه|اكثر)|(?:ال)?مدخلات\s+(?:غير\s+كافيه|ناقصه)|يرجي\s+تقديم\s+(?:مزيد\s+من\s+|المزيد\s+من\s+)?(?:التفاصيل|المعلومات))(?:[^\p{L}]|$)/u
]);

const STUDENT_CARD_PATTERNS = Object.freeze([
    // tr
    /(?<![\p{L}\p{N}])(?:ogrenci(?:\s+kimlik)?|okul)\s+kart[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    // en
    /(?<![\p{L}\p{N}])student\s+(?:(?:id\s+)?cards?|id(?!\s*(?:[:=]\s*\d|number|num|no|code|\d)))(?![\p{L}\p{N}])/u,
    // ru
    /(?<![\p{L}\p{N}])(?:(?:студенческ|studenchesk)[\p{L}\p{N}]*\s+(?:карт|билет|kart|bilet)[\p{L}\p{N}]*|(?:карт|билет)[\p{L}\p{N}]*\s+студент[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    // tk
    /(?<![\p{L}\p{N}])talyp(?:\s+sahadatnama)?\s+kart[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    // ar
    /(?<![\p{L}\p{N}])(?:و|ف|ب|ل)?بطاقه\s+(?:ال)?طالب(?![\p{L}\p{N}])/u
]);

const STUDENT_CARD_RESIDENCE_EXCLUSION_PATTERN = /(?<![\p{L}\p{N}])(?:e-?ikamet[\p{L}\p{N}]*|ikamet[\p{L}\p{N}]*|oturma\s+izn[\p{L}\p{N}]*|residence\s+permit[\p{L}\p{N}]*|вид[\p{L}\p{N}]*\s+на\s+жительств[\p{L}\p{N}]*|внж|vnzh|ruhsat[\p{L}\p{N}]*|rugsa[td][\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?اقام(?:ه|ت[\p{L}\p{N}]*))(?![\p{L}\p{N}])/u;

const PROCESSING_TIME_EXCLUSION_PATTERNS = Object.freeze([
    // office hours
    /(?:^|[^\p{L}])(?:saat\s+kac|kac(?:ta)?\s+(?:acik|acilir|kapan|basl|bit)|mesai|calisma\s+saat[\p{L}\p{N}]*|ofis\s+saat[\p{L}\p{N}]*|(?:opening|office|working|business)\s+hours|(?:open|close)s?\s+(?:at|until)|часы\s+работы|во\s+сколько\s+(?:откры|закры)|работает\s+офис|is\s+sagat[\p{L}\p{N}]*|acyk\s+sagat|haysy\s+sagat|ساعات\s+(?:ال)?عمل|اوقات\s+(?:ال)?عمل|متي\s+(?:يفتح|يغلق|مفتوح)|كم\s+ساعه\s+يعمل|(?:ofis|office|офис|مكتب)(?:\s+[\p{L}\p{N}-]+){0,3}\s+(?:acik|open|работает|acyk|مفتوح|يفتح|يغلق)|(?:acik|open|работает|acyk|مفتوح)(?:\s+[\p{L}\p{N}-]+){0,3}\s+(?:saat|hours|часов|sagat|ساعه|ساعات))(?:[^\p{L}]|$)/u,
    // validity, expiry, upload size, and file format
    /(?:^|[^\p{L}])(?:gecerli(?:lik)?|son\s+kullanma|valid(?:ity)?|expir[\p{L}\p{N}]*|деиствител[\p{L}\p{N}]*|срок\s+деиствия|mohletli|صلاحي[\p{L}\p{N}]*|ساري[\p{L}\p{N}]*|format[\p{L}\p{N}]*|boyut[\p{L}\p{N}]*|pdf|jpe?g|png|webp|mb|sayfa|size|pages?|upload\s+(?:size|limit|time)|to\s+upload|yukleme\s+(?:boyut|sinir)|формат[\p{L}\p{N}]*|размер[\p{L}\p{N}]*|страниц[\p{L}\p{N}]*|мб|загрузки\s+фаил|gornus[\p{L}\p{N}]*|sahypa|صيغه|حجم|صفح[\p{L}\p{N}]*|ميغابايت)(?:[^\p{L}]|$)/u,
    // fees and appointments
    /(?:^|[^\p{L}])(?:harc[\p{L}\p{N}]*|ucret[\p{L}\p{N}]*|odeme[\p{L}\p{N}]*|fiyat[\p{L}\p{N}]*|randevu[\p{L}\p{N}]*|fees?|cost[\p{L}\p{N}]*|pay(?:ment|ing)?|price|how\s+much|appointments?|booking|пошлин[\p{L}\p{N}]*|оплат[\p{L}\p{N}]*|стоимост[\p{L}\p{N}]*|цен[\p{L}\p{N}]*|рандеву|запис[\p{L}\p{N}]*|прием[\p{L}\p{N}]*|toleg[\p{L}\p{N}]*|pac[\p{L}\p{N}]*|baha[\p{L}\p{N}]*|randewu[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:رسوم|دفع|تكلفه|مبلغ|سعر|موعد|مواعيد|حجز))(?:[^\p{L}]|$)/u,
    // past status checks of uploaded/sent files
    /(?:^|[^\p{L}])(?:kontrol\s+ettiler\s+mi|kontrol\s+edildi\s+mi|gonderildi\s+mi|iletildi\s+mi|did\s+(?:the\s+office\s+|they\s+)?check|was\s+checked|have\s+they\s+checked|проверили|отправили|barlandymy|iberildimi|تمت\s+مراجعته|تم\s+ارسال)(?:[^\p{L}]|$)/u
]);

const PROCESSING_TIME_PASSPORT_OR_INSURANCE_PATTERN = /(?:^|[^\p{L}])(?:pasaport[\p{L}\p{N}]*|sigorta[\p{L}\p{N}]*|vize[\p{L}\p{N}]*|passports?|insurance|visa|паспорт[\p{L}\p{N}]*|страхов[\p{L}\p{N}]*|виз[\p{L}\p{N}]*|pasport[\p{L}\p{N}]*|atiyaclandyr[\p{L}\p{N}]*|wiza[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:جواز[\p{L}\p{N}]*|تامين[\p{L}\p{N}]*|تاشير[\p{L}\p{N}]*))(?:[^\p{L}]|$)/u;
const PROCESSING_TIME_PERMIT_TARGET_PATTERN = /(?:^|[^\p{L}])(?:ikamet[\p{L}\p{N}]*|oturma\s+izn[\p{L}\p{N}]*|basvuru[\p{L}\p{N}]*|kart[\p{L}\p{N}]*|ofis[\p{L}\p{N}]*|goc(?:\s+idares[\p{L}\p{N}]*)?|residence\s+permit|permit|application|card|office|migration|внж|икамет[\p{L}\p{N}]*|заявк[\p{L}\p{N}]*|заявлен[\p{L}\p{N}]*|карт[\p{L}\p{N}]*|офис[\p{L}\p{N}]*|миграц[\p{L}\p{N}]*|rugsa[td][\p{L}\p{N}]*|arza[\p{L}\p{N}]*|migrasiya[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:اقامه|اقامت[\p{L}\p{N}]*|طلب[\p{L}\p{N}]*|بطاقه|مكتب|هجره))(?:[^\p{L}]|$)/u;

const PROCESSING_TIME_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:ne\s+kadar\s+(?:surer|suruyor|surecek|surede|bekle[\p{L}\p{N}]*|zaman\s+alir)|kac\s+(?:gun|hafta|ay)(?:de|da)?(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:surer|suruyor|ceker|gel[\p{L}\p{N}]*|cik[\p{L}\p{N}]*|onay[\p{L}\p{N}]*|sonuclan[\p{L}\p{N}]*|teslim|hazir|biter|cevap|donus)|kac\s+(?:gun|hafta|ay)\s+(?:bekle[\p{L}\p{N}]*|surer|suruyor|ceker)|ne\s+zaman(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:gel(?:ir|iyor|iyo|ecek|mesi|mesini)|cik(?:ar|iyor|iyo|acak|masi)|teslim(?:\s+edil[\p{L}\p{N}]*)?|cevap\s+ver[\p{L}\p{N}]*|donus\s+(?:yap|ol)[\p{L}\p{N}]*|basilir|gonderilir)|(?:islem|degerlendirme|inceleme|bekleme)\s+sure(?:si|leri)|hizlandir[\p{L}\p{N}]*|cabuk\s+(?:cik[\p{L}\p{N}]*|gel[\p{L}\p{N}]*|onay[\p{L}\p{N}]*)|erken\s+(?:cik[\p{L}\p{N}]*|gel[\p{L}\p{N}]*|onay[\p{L}\p{N}]*)|(?:haftalardir|aylardir|gunlerdir)\s+bekl[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:how\s+lo?ng(?:\s+[\p{L}\p{N}-]+){0,6}\s+(?:take|wait[\p{L}\p{N}]*|get|receive|arrive|deliver[\p{L}\p{N}]*|delivry|process[\p{L}\p{N}]*|review[\p{L}\p{N}]*|approv[\p{L}\p{N}]*|decid[\p{L}\p{N}]*|decision|permit|card|application|office|migration|ready|answer|reply)|how\s+many\s+(?:days|weeks|months)(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:take|wait[\p{L}\p{N}]*|until|for|to|get|receive|approv[\p{L}\p{N}]*|process[\p{L}\p{N}]*|review[\p{L}\p{N}]*|deliver[\p{L}\p{N}]*|arrive|ready)|when\s+(?:will|would|can|do)(?:\s+[\p{L}\p{N}-]+){0,5}\s+(?:get|receive|arrive|come|deliver[\p{L}\p{N}]*|issue[\p{L}\p{N}]*|ready|answer|reply|respond|card|permit|decision)|how\s+soon(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:get|receive|arrive|approv[\p{L}\p{N}]*|decision|card|permit|ready|answer|reply)|(?:wait(?:ing)?|processing|review|decision|approval|delivery)\s+times?|sped\s+up|speed(?:ing)?\s+up|expedite|waiting\s+(?:for\s+)?(?:weeks|months|forever|so\s+long))(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:ск[оа]?лько\s+(?:жд[\p{L}\p{N}]*|ожидать|длит[\p{L}\p{N}]*|занима[\p{L}\p{N}]*|заим[\p{L}\p{N}]*|времени\s+(?:ждать|заимет|занима[\p{L}\p{N}]*|длит[\p{L}\p{N}]*|уходит|нужно\s+(?:на|чтобы)))|(?:через\s+)?ск[оа]?лько\s+(?:днеи|недель|месяц[\p{L}\p{N}]*)(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:жд[\p{L}\p{N}]*|занима[\p{L}\p{N}]*|заим[\p{L}\p{N}]*|придет|будет\s+готов[\p{L}\p{N}]*|выдадут|получу|достав[\p{L}\p{N}]*|одобр[\p{L}\p{N}]*|рассм[\p{L}\p{N}]*|провер[\p{L}\p{N}]*|ответ[\p{L}\p{N}]*)|как\s+долго(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:ждать|длит[\p{L}\p{N}]*|рассматр[\p{L}\p{N}]*|провер[\p{L}\p{N}]*|дела[\p{L}\p{N}]*|одобр[\p{L}\p{N}]*|готов[\p{L}\p{N}]*|придет|идет|занима[\p{L}\p{N}]*|решени[\p{L}\p{N}]*)|когда(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:придет|будет\s+готов[\p{L}\p{N}]*|выдадут|получу|достав[\p{L}\p{N}]*|ответит|ответят|одобр[\p{L}\p{N}]*|прим(?:ет|ут)\s+решени[\p{L}\p{N}]*)|(?:срок(?:и)?|время)\s+(?:рассмотрения|проверки|одобрения|принятия\s+решения|изготовления|доставки|ожидания)|ускор[\p{L}\p{N}]*|жду\s+(?:уже\s+)?(?:недел[\p{L}\p{N}]*|месяц[\p{L}\p{N}]*|вечность|долго))(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])(?:na[c]?h?e\s+(?:wagt(?:da)?|gun(?:de|e)?|hepde(?:de)?|ay(?:da)?)(?:\s+[\p{L}\p{N}-]+){0,5}\s+(?:garas[\p{L}\p{N}]*|cekyar|ceker|alyar|alar|geler|c[h]?ykar|tassyk[\p{L}\p{N}]*|barla[\p{L}\p{N}]*|jogap|tayy?(?:ar|n)|berler|gow(?:us|sur)[\p{L}\p{N}]*|bolar)|ha[c]?h?an(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:geler|c[h]?ykar|jogap\s+ber[\p{L}\p{N}]*|tassyk[\p{L}\p{N}]*|tayy?(?:ar|n)\s+bol[\p{L}\p{N}]*|berler|gow(?:us|sur)[\p{L}\p{N}]*)|c[h]?altla(?:s|n)dyr[\p{L}\p{N}]*|tizrak\s+(?:c[h]?yk[\p{L}\p{N}]*|gel[\p{L}\p{N}]*|tassyk[\p{L}\p{N}]*)|(?:islenis|barlag|karar)\s+mohlet[\p{L}\p{N}]*|(?:bir\s+(?:ay|hepde)\s+boldy\s+garasyan|(?:hepdelap|aylap)\s+garasyan))(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:(?:كم|بكم)\s+(?:يستغرق|تستغرق|ياخذ|تاخذ|انتظر|ننتظر|(?:ال)?مده|(?:ال)?وقت|(?:يوم[\p{L}\p{N}]*|اسبوع[\p{L}\p{N}]*|شهر[\p{L}\p{N}]*)(?:\s+[\p{L}\p{N}-]+){0,5}\s+(?:تستغرق|يستغرق|ياخذ|تاخذ|تصل|يصل|توصل|يوصل|تطلع|يطلع|تجهز|يجهز|انتظر|ننتظر|للموافقه|للمراجعه|للاصدار|للتسليم))|متي(?:\s+[\p{L}\p{N}-]+){0,4}\s+(?:تصل|يصل|توصل|يوصل|استلم|تجهز|يجهز|تطلع|يطلع|تصدر|يصدر|ترد|يرد|توافق|يوافق|الرد|الموافقه|البطاقه)|تسريع|استعجال|(?:مده|فتره)\s+(?:المراجعه|المعالجه|الموافقه|الانتظار|التسليم)|انتظر\s+منذ\s+(?:اسابيع|اشهر|ايام|مده))(?:[^\p{L}]|$)/u
]);

const STATUS_NEXT_STEP_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:siradaki(?:\s+adim|\s+ne)?|bundan\s+sonra(?:ki)?(?:\s+adim|\s+ne)?|simdi\s+ne\s+yap[\p{L}\p{N}]*|su\s+an\s+ne\s+yap[\p{L}\p{N}]*|ne\s+yapmali[\p{L}\p{N}]*|ne\s+yapmam\s+gerek[\p{L}\p{N}]*|yapmam\s+gereken\s+ne|ne\s+yapabilirim|ne\s+yapca[\p{L}\p{N}]*|ne\s+yapacagim|(?:simdi|bundan\s+sonra|sonra)\s+ne\s+olacak|ya\s+sonra|sonra\s+ne(?:\s+yap[\p{L}\p{N}]*)?|^\s*(?:ee\s+|peki\s+)?sonra[\s?!.]*$|sonrasi(?:\s+ne)?|(?:baska\s+)?yapmam\s+gereken\s+(?:bir\s+sey\s+)?var\s+mi)(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:what(?:'?s|\s+is)?\s+(?:the\s+)?next(?:\s+step)?|wh?t\s+next(?:\s+now)?|what\s+now|what\s+(?:should|do|can|must)\s+i\s+do(?:\s+(?:now|next))?|what\s+to\s+do(?:\s+(?:now|next))?|what\s+happens\s+(?:now|next)|and\s+then|next\s+step|(?:do\s+i\s+need|need\s+i)\s+to\s+do\s+anything(?:\s+else)?|anything\s+else\s+(?:to\s+do|i\s+(?:need|should)\s+do))(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:что\s+дальше(?:\s+делать)?|что\s+(?:мне\s+)?(?:делать|сделать)\s+(?:дальше|теперь|сеичас)|что\s+(?:мне\s+)?(?:теперь|сеичас|дальше)\s+(?:делать|сделать|предпринять)|(?:а\s+дальше\s+что|и\s+что\s+дальше)|как\s+(?:мне\s+)?(?:теперь|дальше)\s+поступить|а\s+потом|какои\s+(?:следующии|дальнеишии)\s+шаг|следующии\s+шаг|(?:мне\s+)?нужно\s+(?:ли\s+)?(?:сеичас\s+)?(?:еще\s+)?что-?то\s+делать|что-?то\s+(?:еще\s+)?нужно\s+делать)(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])(?:indiki\s+adim[\p{L}\p{N}]*|indi\s+na?me\s+(?:etmeli|etsem\s+bolar|etjek|edeyin|gerek)|hazir\s+name\s+(?:etmeli|etsem|gerek)|na?me\s+(?:etmeli|edeyin|etsem\s+bolar)(?:\s+(?:indi|hazir|son))?|mundan\s+(?:son|beylak)\s+name|son\s+name|ondan\s+son|basga\s+etmeli\s+(?:zadym|zat)\s+bar\s*my|etmeli\s+zadym\s+bar\s*my)(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:ما\s+(?:هو\s+|هي\s+)?(?:ال)?(?:تالي|خطوه\s+(?:ال)?تاليه)|(?:و)?ما\s+الذي\s+يجب\s+(?:علي\s+)?فعله(?:\s+(?:ال)?ان)?|(?:و)?ماذا\s+(?:بعد|(?:(?:علي|يجب)\s+(?:ان\s+)?)?(?:افعل|اعمل)\s+(?:بعد(?:\s+ذلك)?|(?:ال)?ان|تاليا))|(?:و)?بعد\s+(?:ذلك|كده|هيك)|(?:طيب\s+)?(?:و)?بعدين|(?:شو|ايش)\s+(?:اسوي|اعمل)(?:\s+(?:بعدين|الحين|(?:ال)?ان))?|شو\s+(?:الخطوه\s+(?:ال)?جايه|بعد)|هل\s+(?:علي(?:\s+ان\s+(?:افعل|اعمل)|\s+(?:فعل|عمل))|يجب\s+(?:علي\s+)?(?:ان\s+(?:افعل|اعمل)|(?:فعل|عمل)))\s+شي(?:ء|ي)?ا?(?:\s+اخر)?(?:\s+(?:ال)?ان)?|هل\s+(?:يوجد|هناك)\s+(?:شيي|اجراء)(?:\s+اخر)?\s*(?:مطلوب|افعله))(?:[^\p{L}]|$)/u
]);

const STATUS_NEXT_STEP_NEW_TOPIC_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}])(?:harc[\p{L}\p{N}]*|ucret[\p{L}\p{N}]*|odeme[\p{L}\p{N}]*|randevu[\p{L}\p{N}]*|parmak\s+iz[\p{L}\p{N}]*|saat[\p{L}\p{N}]*|kvkk|gizlilik|unuttum|adres[\p{L}\p{N}]*|kira[\p{L}\p{N}]*|yurt[\p{L}\p{N}]*|otel[\p{L}\p{N}]*|taahhut[\p{L}\p{N}]*|e-?ikamet|(?:ilk|yeni)\s+basvuru)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:fees?|cost[\p{L}\p{N}]*|pay(?:ment|ing)?|appointments?|fingerprints?|hours?|privacy|forgot|address|rental|dorm(?:itory)?|hotel|undertaking|e-?ikamet|(?:initial|new|first)\s+application)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:пошлин[\p{L}\p{N}]*|оплат[\p{L}\p{N}]*|рандеву|прием[\p{L}\p{N}]*|отпечат[\p{L}\p{N}]*|час[\p{L}\p{N}]*|конфиденциальност[\p{L}\p{N}]*|забыл[\p{L}\p{N}]*|адрес[\p{L}\p{N}]*|аренд[\p{L}\p{N}]*|общежит[\p{L}\p{N}]*|гостиниц[\p{L}\p{N}]*|отел[\p{L}\p{N}]*|обязательств[\p{L}\p{N}]*|первичн[\p{L}\p{N}]*|нов(?:ая|ую)\s+заявк[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:toleg[\p{L}\p{N}]*|randewu[\p{L}\p{N}]*|barmak\s+yz[\p{L}\p{N}]*|sagat[\p{L}\p{N}]*|unutd[\p{L}\p{N}]*|salgy[\p{L}\p{N}]*|karend[\p{L}\p{N}]*|umumy\s+yasayys|myhmanhana[\p{L}\p{N}]*|borcnama[\p{L}\p{N}]*|(?:ilkinji|taze)\s+arza)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:رسوم|دفع|موعد|مواعيد|بصم[\p{L}\p{N}]*|ساعات|خصوصيه|نسيت|عنوان|ايجار|سكن|فندق|تعهد)|طلب\s+(?:اولي|جديد)|تقديم\s+جديد)(?:[^\p{L}]|$)/u
]);

export const CHATBOT_ROUTE_NORMALIZED_PATTERNS = Object.freeze({
    STATUS_RULES_BY_LANGUAGE,
    STAGE_STATUS_PATTERNS,
    STANDALONE_STATUS_PHRASES,
    HOW_TO_OR_WHAT_IS_PATTERNS,
    FIRST_PERSON_STATUS_PHRASE_PATTERNS,
    STATUS_IDENTIFIER_OR_PARTIAL_REF_PATTERNS,
    OTHER_PERSON_MARKER_PATTERNS,
    OTHER_PERSON_STATUS_VERB_PATTERNS,
    GUARANTEE_OR_LEGAL_PATTERNS,
    STANDALONE_LIST_INTENT_WITHOUT_KEYWORD_PATTERNS,
    CONTACT_CHANNEL_PATTERNS,
    CONTACT_CHANNEL_EXCLUSION_PATTERN,
    FINGERPRINT_TOPIC_PATTERNS,
    DOCUMENT_KEYWORD_PATTERNS,
    SHORT_DOCUMENT_EXCLUDE_PATTERNS,
    NON_LIST_KNOWLEDGE_OR_QUESTION_PATTERNS,
    DOCUMENT_LIST_INTENT_PATTERNS,
    OTHER_STUDENTS_DATA_RULES_BY_LANGUAGE,
    EXPLICIT_HANDOFF_PATTERNS,
    OFFICE_HANDOFF_PATTERNS,
    HANDOFF_PATTERNS,
    PROMPT_OVERRIDE_MARKER_PATTERNS,
    UNHELPFUL_MODEL_REPLY_PATTERNS,
    STUDENT_CARD_PATTERNS,
    STUDENT_CARD_RESIDENCE_EXCLUSION_PATTERN,
    PROCESSING_TIME_EXCLUSION_PATTERNS,
    PROCESSING_TIME_PASSPORT_OR_INSURANCE_PATTERN,
    PROCESSING_TIME_PERMIT_TARGET_PATTERN,
    PROCESSING_TIME_PATTERNS,
    STATUS_NEXT_STEP_PATTERNS,
    STATUS_NEXT_STEP_NEW_TOPIC_PATTERNS
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
        language: body.language,
        sessionId: normalizeOptionalSessionId(body.session_id)
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

function buildDocumentReply(labels, language, facts = null) {
    const understoodLine = buildUnderstoodFactsLine(facts, language);
    const intro = getChatbotFixedText('documentListIntro', language);
    const renderedList = renderDeterministicDocumentList(labels, language);
    const closing = getChatbotFixedText('documentListClosing', language);
    return understoodLine
        ? `${understoodLine}\n\n${intro}\n\n${renderedList}\n\n${closing}`
        : `${intro}\n\n${renderedList}\n\n${closing}`;
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

const INVALID_APPLICATION_REF_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}\p{N}])it[uü]\s*[-_:]\s*[a-z0-9]{2,}(?:\s*[-_]\s*[a-z0-9]{1,})*/iu,
    /(?:^|[^\p{L}\p{N}])it[uü]\s*(?=[a-z0-9\s-]*\d)[a-z0-9]{4,}(?:\s+[a-z0-9]{2,})*/iu
]);

const STUDENT_NUMBER_ATTEMPT_PATTERNS = Object.freeze([
    /(?:^|[^\p{L}\p{N}])\d{6,12}(?:[^\p{L}\p{N}]|$)/u,
    /(?:^|[^\p{L}\p{N}])(?:ogrenci\s*(?:numara[\p{L}\p{N}]*|no)|student\s*(?:number|num|no|id)|номер\s+студента|talyp\s+belgi[\p{L}\p{N}]*|رقم[\p{L}\p{N}]*\s+(?:ال)?(?:طالب|جامع[\p{L}\p{N}]*))\s*[:#-]?\s*\d{4,12}(?:[^\p{L}\p{N}]|$)/u
]);

const BARE_TRANSFER_OFFER_PATTERNS = Object.freeze([
    /(?:do\s+you\s+want|would\s+you\s+like|shall\s+i|should\s+i)\s+(?:me\s+to\s+|to\s+be\s+)?(?:transfer|connect|forward|escalate|hand\s+off|direct)(?:ed)?\s+(?:you\s+)?(?:to\s+(?:the\s+)?office|to\s+staff|to\s+an?\s+(?:advisor|agent|human))/iu,
    /(?:ofise|yetkiliye|personele)\s+(?:yonlendirmemi|aktarmami|yonlendirilmek|aktarilmak)\s+ister\s+misiniz/iu,
    /(?:хотите|желаете)(?:\s+ли\s+вы)?,?\s+(?:чтобы\s+я\s+)?(?:перевел|передал|соединил|направил)[\p{L}\p{N}]*\s+(?:вас\s+)?(?:в\s+офис|с\s+офисом|к\s+сотруднику)/iu,
    /(?:ofise|isgare)\s+(?:ugrukdyrmagymy|gecirmegimi|ugrukdyrylmak)\s+isleyarsinizmi/iu,
    /(?:هل\s+تريد|هل\s+ترغب)\s+(?:في\s+|ان\s+)?(?:تحويلك|احالتك|توصيلك)\s+(?:الي\s+|ب)?(?:ال)?(?:مكتب|موظف)/iu
]);

function extractScopedUserReferences(messages, lastUserMessage) {
    const lastTurnReferences = extractApplicationReferences(lastUserMessage);
    if (lastTurnReferences.length > 0) {
        return lastTurnReferences;
    }
    if (isInvalidReferenceOrStudentNumberAttempt(lastUserMessage)) {
        return [];
    }
    if (
        isOtherStudentsDataRequest(lastUserMessage)
        || hasPromptOverrideMarker(lastUserMessage)
        || isOtherPersonApplicationStatusRequest(lastUserMessage)
        || isGuaranteeOrLegalAdviceRequest(lastUserMessage)
        || !isStatusQuestionWithoutReference(lastUserMessage)
    ) {
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

/**
 * Returns true when the user asks for an approval guarantee, legal advice, or drafting an appeal/petition.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic guarantee/legal refusal applies.
 */
export function isGuaranteeOrLegalAdviceRequest(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return GUARANTEE_OR_LEGAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true when the user explicitly asks for the office's contact channels (WhatsApp number, e-mail, or phone/contact details),
 * excluding forgot-reference/confirmation e-mail questions, document lists, status queries, student card queries, and refusals.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic contact knowledge lookup applies.
 */
export function isContactChannelQuestion(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (extractApplicationReferences(messageContent).length > 0) return false;
    if (
        isOtherStudentsDataRequest(messageContent)
        || hasPromptOverrideMarker(messageContent)
        || isOtherPersonApplicationStatusRequest(messageContent)
        || isGuaranteeOrLegalAdviceRequest(messageContent)
    ) {
        return false;
    }
    if (isVeryShortDocumentQuestion(messageContent) || isAskingWhichDocumentsAreNeeded(messageContent)) {
        return false;
    }
    if (isStatusQuestionWithoutReference(messageContent) || isStudentCardQuestion(messageContent)) {
        return false;
    }
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (CONTACT_CHANNEL_EXCLUSION_PATTERN.test(normalized)) {
        return false;
    }
    return CONTACT_CHANNEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isFingerprintKnowledgeQuestion(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (isAskingWhichDocumentsAreNeeded(messageContent) || isVeryShortDocumentQuestion(messageContent)) {
        return false;
    }
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (!FINGERPRINT_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    return /[?\u061f]/u.test(messageContent) || HOW_TO_OR_WHAT_IS_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasStandaloneListIntentWithoutKeyword(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (NON_LIST_KNOWLEDGE_OR_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    return STANDALONE_LIST_INTENT_WITHOUT_KEYWORD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isDocumentListAssistantReply(previousAssistantMessage, language) {
    if (previousAssistantMessage?.role !== 'assistant' || typeof previousAssistantMessage.content !== 'string') {
        return false;
    }
    const content = previousAssistantMessage.content;
    if (content.includes(getChatbotFixedText('documentListIntro', language))) {
        return true;
    }
    const sampleUnderstood = buildUnderstoodFactsLine({ application_type: 'initial' }, language);
    const colonIndex = sampleUnderstood.indexOf(':');
    if (colonIndex > 0) {
        const prefix = sampleUnderstood.slice(0, colonIndex + 1);
        if (content.startsWith(prefix)) {
            return true;
        }
    }
    return false;
}

/**
 * Returns true when the user asks about their university student ID card (printing, loss, renewal),
 * excluding document-list requests, application status queries, reference numbers, and residence-permit questions.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic student_card knowledge lookup applies.
 */
export function isStudentCardQuestion(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (extractApplicationReferences(messageContent).length > 0) return false;
    if (
        isOtherStudentsDataRequest(messageContent)
        || hasPromptOverrideMarker(messageContent)
        || isGuaranteeOrLegalAdviceRequest(messageContent)
    ) {
        return false;
    }
    if (isOtherPersonApplicationStatusRequest(messageContent)) return false;
    if (isVeryShortDocumentQuestion(messageContent) || isAskingWhichDocumentsAreNeeded(messageContent)) {
        return false;
    }
    if (isStatusQuestionWithoutReference(messageContent)) return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (STUDENT_CARD_RESIDENCE_EXCLUSION_PATTERN.test(normalized)) return false;
    return STUDENT_CARD_PATTERNS.some((pattern) => pattern.test(normalized));
}

const STATUS_NEXT_STEP_MAX_WORDS = 14;

/**
 * Returns true when the user asks a waiting, duration, delivery, or speed-up question
 * about residence permit processing, card issuance, or office/Migration Authority decisions,
 * while conservatively excluding office hours, document validity/format/size, fees, appointments,
 * student ID cards, references/identifiers, past status checks, document lists, and refusals.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic `processing_time` knowledge lookup applies.
 */
export function isProcessingTimeQuestion(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (extractApplicationReferences(messageContent).length > 0) return false;
    if (
        isOtherStudentsDataRequest(messageContent)
        || hasPromptOverrideMarker(messageContent)
        || isOtherPersonApplicationStatusRequest(messageContent)
        || isGuaranteeOrLegalAdviceRequest(messageContent)
        || isStudentCardQuestion(messageContent)
        || isContactChannelQuestion(messageContent)
        || hasExplicitPersonComplaintUrgentHandoff(messageContent)
    ) {
        return false;
    }
    if (isVeryShortDocumentQuestion(messageContent) || isAskingWhichDocumentsAreNeeded(messageContent)) {
        return false;
    }
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (STATUS_IDENTIFIER_OR_PARTIAL_REF_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    if (PROCESSING_TIME_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    if (
        PROCESSING_TIME_PASSPORT_OR_INSURANCE_PATTERN.test(normalized)
        && !PROCESSING_TIME_PERMIT_TARGET_PATTERN.test(normalized)
    ) {
        return false;
    }
    return PROCESSING_TIME_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true when the user message is a short next-step question (without new references,
 * document keywords, processing-time questions, refusals, or clear new topics).
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if the message asks what to do next.
 */
export function isStatusNextStepQuestion(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (extractApplicationReferences(messageContent).length > 0) return false;
    if (
        isOtherStudentsDataRequest(messageContent)
        || hasPromptOverrideMarker(messageContent)
        || isOtherPersonApplicationStatusRequest(messageContent)
        || isGuaranteeOrLegalAdviceRequest(messageContent)
        || isStudentCardQuestion(messageContent)
        || isContactChannelQuestion(messageContent)
        || hasExplicitPersonComplaintUrgentHandoff(messageContent)
        || isStatusQuestionWithoutReference(messageContent)
        || isDeterministicHandoffRequest(messageContent)
        || isProcessingTimeQuestion(messageContent)
    ) {
        return false;
    }
    if (
        hasDocumentKeyword(messageContent)
        || isVeryShortDocumentQuestion(messageContent)
        || isAskingWhichDocumentsAreNeeded(messageContent)
    ) {
        return false;
    }
    const normalized = evidence.normalizeForEvidence(messageContent).trim();
    if (!normalized) return false;
    const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
    if (words.length === 0 || words.length > STATUS_NEXT_STEP_MAX_WORDS) return false;
    if (STATUS_IDENTIFIER_OR_PARTIAL_REF_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    if (STATUS_NEXT_STEP_NEW_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    return STATUS_NEXT_STEP_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Resolves a deterministic `status_next_step` reply when conversation history contains a fixed
 * assistant status summary with a known localized label and the new user message is a short next-step question.
 * @param {string} lastUserMessage Latest sanitized user turn.
 * @param {Array<{role?: string, content?: string}>} messages Full sanitized conversation messages.
 * @param {string} language Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {string|null} Localized next-step reply or `null` when this route does not apply.
 */
export function resolveStatusNextStepReply(lastUserMessage, messages, language) {
    if (!Array.isArray(messages) || messages.length < 2) return null;
    if (!isStatusNextStepQuestion(lastUserMessage)) return null;
    const priorMessages = messages.slice(0, -1);
    const status = extractMostRecentStatusFromHistory(priorMessages, language);
    if (!status) return null;
    return getStatusNextStepText(status, language);
}

/**
 * Returns true when the user asks for the status of another person's (e.g. friend's or relative's) application
 * without providing a valid ITU reference (with or without a name, student number, or partial reference).
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic third-party status refusal applies.
 */
export function isOtherPersonApplicationStatusRequest(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (extractApplicationReferences(messageContent).length > 0) {
        return false;
    }
    if (isVeryShortDocumentQuestion(messageContent) || isAskingWhichDocumentsAreNeeded(messageContent)) {
        return false;
    }
    if (hasDocumentKeyword(messageContent)) {
        return false;
    }
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (!OTHER_PERSON_MARKER_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    if (STATUS_IDENTIFIER_OR_PARTIAL_REF_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return true;
    }
    if (STANDALONE_STATUS_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return true;
    }
    if (STAGE_STATUS_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return true;
    }
    if (OTHER_PERSON_STATUS_VERB_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return true;
    }
    return Object.values(STATUS_RULES_BY_LANGUAGE).some(({ status }) =>
        status.some((pattern) => pattern.test(normalized))
    );
}

/**
 * Returns true when the user message looks like an application reference that does not match ITU-XXXX-XXXX,
 * or contains a student number instead of a valid ITU-XXXX-XXXX reference.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True when format guidance (or escalation after 3 attempts) applies.
 */
export function isInvalidReferenceOrStudentNumberAttempt(messageContent) {
    if (typeof messageContent !== 'string' || !messageContent.trim()) return false;
    if (extractApplicationReferences(messageContent).length > 0) return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    if (INVALID_APPLICATION_REF_PATTERNS.some((pattern) => pattern.test(messageContent) || pattern.test(normalized))) {
        return true;
    }
    return STUDENT_NUMBER_ATTEMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isStudentNumberAttempt(messageContent) {
    if (typeof messageContent !== 'string' || !messageContent.trim()) return false;
    if (extractApplicationReferences(messageContent).length > 0) return false;
    const normalized = evidence.normalizeForEvidence(messageContent);
    return STUDENT_NUMBER_ATTEMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeBareTransferOffer(replyText) {
    if (typeof replyText !== 'string' || !replyText.trim()) return false;
    const normalized = evidence.normalizeForEvidence(replyText);
    return BARE_TRANSFER_OFFER_PATTERNS.some((pattern) => pattern.test(replyText) || pattern.test(normalized));
}

export function isStatusQuestionWithoutReference(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (hasExplicitPersonComplaintUrgentHandoff(messageContent)) {
        return false;
    }
    if (isOtherPersonApplicationStatusRequest(messageContent)) {
        return false;
    }
    if (isVeryShortDocumentQuestion(messageContent) || isAskingWhichDocumentsAreNeeded(messageContent)) {
        return false;
    }
    const normalized = evidence.normalizeForEvidence(messageContent);
    const hasFirstPersonStatusContext = FIRST_PERSON_STATUS_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized));
    if (hasStandaloneListIntentWithoutKeyword(messageContent) && !hasFirstPersonStatusContext) {
        return false;
    }
    if (hasDocumentKeyword(messageContent) && !hasFirstPersonStatusContext) {
        return false;
    }
    const hasIdentifierOrPartialRef = STATUS_IDENTIFIER_OR_PARTIAL_REF_PATTERNS.some((pattern) => pattern.test(normalized));
    const hasStageWord = STAGE_STATUS_PATTERNS.some((pattern) => pattern.test(normalized));
    const hasStatusWord = Object.values(STATUS_RULES_BY_LANGUAGE).some(({ status }) =>
        status.some((pattern) => pattern.test(normalized))
    ) || (hasStageWord && hasFirstPersonStatusContext);
    if (
        HOW_TO_OR_WHAT_IS_PATTERNS.some((pattern) => pattern.test(normalized))
        && !hasFirstPersonStatusContext
        && !hasIdentifierOrPartialRef
    ) {
        return false;
    }
    if (hasStatusWord && hasIdentifierOrPartialRef) {
        return true;
    }
    if (STANDALONE_STATUS_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return true;
    }
    if (hasStageWord && hasFirstPersonStatusContext) {
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
    const normalized = evidence.normalizeForEvidence(replyText);
    if (UNHELPFUL_MODEL_REPLY_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return true;
    }
    return !isReplyInExpectedScript(replyText, language);
}

function isUnsafeModelReplyText(trimmedText) {
    if (Object.keys(CHATBOT_TOOLS).some((toolName) => trimmedText.includes(toolName))) {
        return true;
    }
    if (trimmedText.startsWith('<|python_tag|>')) {
        return true;
    }
    let jsonCandidate = trimmedText;
    const fenceMatch = jsonCandidate.match(/^```(?:[a-zA-Z0-9_-]+(?=\s))?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) {
        jsonCandidate = fenceMatch[1].trim();
    }
    if (jsonCandidate.startsWith('{') || jsonCandidate.startsWith('[')) {
        try {
            JSON.parse(jsonCandidate);
            return true;
        } catch {
            return false;
        }
    }
    return false;
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

function resolveToolDocumentArgs(rawArgs, { supportedFacts, uncertainKeys, userTurns, language }) {
    if (!isPlainObject(rawArgs)) return rawArgs;

    const rawQuotes = isPlainObject(rawArgs.quotes) ? rawArgs.quotes : {};
    const resolved = {};
    for (const key of DOCUMENT_FACT_KEYS) {
        const hasRawValue = Object.hasOwn(rawArgs, key) && rawArgs[key] !== undefined && rawArgs[key] !== null;
        const hasValidRawValue = hasRawValue && VALID_DOCUMENT_FACT_CHECKS[key](rawArgs[key]);
        if (uncertainKeys.has(key)) continue;

        const hasLexiconValue = Object.hasOwn(supportedFacts, key);
        if (hasLexiconValue) {
            if (!hasValidRawValue || rawArgs[key] === supportedFacts[key]) {
                resolved[key] = supportedFacts[key];
            }
            continue;
        }

        if (
            hasValidRawValue
            && typeof rawQuotes[key] === 'string'
            && typeof evidence.verifyQuotedFact === 'function'
            && evidence.verifyQuotedFact(key, rawArgs[key], rawQuotes[key], userTurns, language)
        ) {
            resolved[key] = rawArgs[key];
        }
    }
    return resolved;
}

function resolveEvidenceDocumentOutput(supportedFacts, language) {
    return executeChatbotTool('get_required_documents', supportedFacts, { language });
}

function renderDocumentToolReply(toolOutput, language, handoffRequested = false, allowList = true, facts = null) {
    if (facts?.fingerprint_status === 'not_registered') {
        return routeResult({
            reply: getChatbotFixedText('fingerprintNeeded', language),
            actions: [{ type: 'inquiry' }]
        });
    }
    const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
    if (allowList && Array.isArray(toolOutput?.labels) && toolOutput.labels.length > 0) {
        return routeResult({
            reply: buildDocumentReply(toolOutput.labels, language, facts),
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
        allowDeterministicEvidence,
        supportedFacts
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

function isUntrustedUserTurn(messageContent) {
    return (
        isOtherStudentsDataRequest(messageContent)
        || hasPromptOverrideMarker(messageContent)
        || isOtherPersonApplicationStatusRequest(messageContent)
    );
}

function stripUntrustedHistoryTurns(messages) {
    if (!Array.isArray(messages) || messages.length <= 1) {
        return Array.isArray(messages) ? [...messages] : [];
    }
    const sanitized = [];
    const lastIndex = messages.length - 1;
    for (let index = 0; index < lastIndex; index += 1) {
        const message = messages[index];
        if (message.role === 'user' && isUntrustedUserTurn(message.content)) {
            if (index + 1 < lastIndex && messages[index + 1].role === 'assistant') {
                index += 1;
            }
            continue;
        }
        sanitized.push(message);
    }
    sanitized.push(messages[lastIndex]);
    return sanitized;
}

async function persistPublicChatTurn({
    environment,
    executionContext,
    requestedSessionId,
    language,
    userText,
    assistantText,
    outcome,
    tools,
    latencyMs
}) {
    if (!environment?.DB) {
        return { sessionId: null, turnId: null, writeStatus: 'skipped' };
    }
    const turnId = generateChatLogId();
    const record = prepareChatTurnRecord({
        sessionId: requestedSessionId,
        turnId,
        language,
        userText,
        assistantText,
        outcome,
        tools,
        latencyMs
    });
    const repository = createChatLogRepository(environment.DB);
    const writeTask = () => repository.appendTurn({
        sessionId: record.sessionId,
        newSessionId: record.sessionId,
        turnId: record.turnId,
        language: record.language,
        userText: record.userText,
        assistantText: record.assistantText,
        outcome: record.outcome,
        tools: record.tools,
        latencyMs: record.latencyMs,
        nowIso: record.nowIso
    });

    const waitUntil = typeof executionContext?.waitUntil === 'function'
        ? executionContext.waitUntil.bind(executionContext)
        : (typeof environment?.waitUntil === 'function' ? environment.waitUntil.bind(environment) : null);

    if (waitUntil) {
        waitUntil(
            Promise.resolve()
                .then(writeTask)
                .catch(() => {})
        );
        return {
            sessionId: record.sessionId,
            turnId: record.turnId,
            writeStatus: 'ok'
        };
    }

    try {
        const stored = await writeTask();
        return {
            sessionId: stored.sessionId,
            turnId: stored.turnId,
            writeStatus: 'ok'
        };
    } catch {
        return { sessionId: null, turnId: null, writeStatus: 'failed' };
    }
}

/**
 * Ana sayfa sohbet uç noktası (`POST /api/public/chat`).
 * Kontrol sırası: yöntem -> aynı köken -> 8 KB boyut sınırı -> hız sınırları -> doğrulama -> başvuru numarasıyla durum sorgusu -> deterministik belge/eksik bilgi yanıtı -> günlük bütçe -> model/araç döngüsü -> en iyi çaba sohbet kaydı.
 * Kişisel veri, başvuru numarası, durum içeriği, mesaj içeriği, araç argümanları ve model çıktısı hiçbir zaman konsol günlüğüne yazılmaz.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları (`DB`, `AI`, isteğe bağlı `CHATBOT_MODEL`).
 * @param {string} requestId İstek izleme kimliği.
 * @param {object|null} [executionContext] İsteğe bağlı Worker yürütme bağlamı (`waitUntil`).
 * @returns {Promise<object>} `{ reply, actions, session_id, turn_id }` gövdeli rota sonucu.
 * @throws {ApiError} Yöntem, köken, boyut, hız sınırı, doğrulama veya hizmet hatasında uygun HTTP hatası fırlatır.
 */
export async function handlePublicChat(request, environment, requestId, executionContext = null) {
    const startedAt = Date.now();
    const executedToolNames = [];
    let outcome = 'error';
    let chatLogWrite = 'skipped';
    let modelInputTokens = 0;
    let modelCachedInputTokens = 0;
    let modelOutputTokens = 0;

    try {
        requireMethod(request, 'POST');
        requireSameOrigin(request);
        const body = await readJsonBody(request, CHATBOT_BODY_MAX_BYTES);

        const repositories = await runFailClosedRateLimit(() => createRepositories(environment));
        await runFailClosedRateLimit(() => enforceRateLimit(repositories, request, CHATBOT_RATE_LIMIT));

        const validated = validateChatInput(body);
        const sanitizedMessages = stripUntrustedHistoryTurns(validated.messages);
        const lastUserMessage = sanitizedMessages[sanitizedMessages.length - 1].content;
        const previousAssistantMessage = sanitizedMessages.length >= 2
            ? sanitizedMessages[sanitizedMessages.length - 2]
            : null;
        const userTurns = sanitizedMessages
            .filter((message) => message.role === 'user')
            .map((message) => message.content);
        const replyResult = await (async () => {
        const referencedApplications = extractScopedUserReferences(sanitizedMessages, lastUserMessage);
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
        if (isOtherStudentsDataRequest(lastUserMessage) || hasPromptOverrideMarker(lastUserMessage)) {
            outcome = 'refusal';
            return routeResult({
                reply: getChatbotFixedText('refusal', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }
        if (isOtherPersonApplicationStatusRequest(lastUserMessage)) {
            outcome = 'refusal';
            return routeResult({
                reply: getChatbotFixedText('otherPersonStatusRefusal', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }
        if (isGuaranteeOrLegalAdviceRequest(lastUserMessage)) {
            outcome = 'refusal';
            return routeResult({
                reply: getChatbotFixedText('guaranteeOrLegalRefusal', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }
        if (isGreetingOnlyMessage(lastUserMessage)) {
            outcome = 'ok';
            return routeResult({
                reply: getChatbotGreetingReply(validated.language),
                actions: []
            });
        }
        if (isStudentCardQuestion(lastUserMessage)) {
            outcome = 'knowledge';
            return routeResult({
                reply: readKnowledge('student_card', validated.language).text,
                actions: []
            });
        }
        if (isContactChannelQuestion(lastUserMessage)) {
            outcome = 'knowledge';
            return routeResult({
                reply: readKnowledge('contact', validated.language).text,
                actions: []
            });
        }
        if (hasExplicitPersonComplaintUrgentHandoff(lastUserMessage)) {
            outcome = 'handoff';
            return routeResult({
                reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                actions: [{ type: 'inquiry' }]
            });
        }
        if (isProcessingTimeQuestion(lastUserMessage)) {
            outcome = 'knowledge';
            return routeResult({
                reply: readKnowledge('processing_time', validated.language).text,
                actions: []
            });
        }
        if (isStatusQuestionWithoutReference(lastUserMessage)) {
            const invalidAttemptCount = sanitizedMessages
                .filter((message) => message.role === 'user' && isInvalidReferenceOrStudentNumberAttempt(message.content))
                .length;
            if (invalidAttemptCount >= 3 && isInvalidReferenceOrStudentNumberAttempt(lastUserMessage)) {
                outcome = 'invalid_reference_handoff';
                return routeResult({
                    reply: getChatbotFixedText('invalidReferenceEscalation', validated.language),
                    actions: [{ type: 'inquiry' }]
                });
            }
            outcome = 'status_needs_reference';
            return routeResult({
                reply: getChatbotFixedText('statusNeedsReference', validated.language),
                actions: []
            });
        }
        if (isInvalidReferenceOrStudentNumberAttempt(lastUserMessage)) {
            const invalidAttemptCount = sanitizedMessages
                .filter((message) => message.role === 'user' && isInvalidReferenceOrStudentNumberAttempt(message.content))
                .length;
            if (invalidAttemptCount >= 3) {
                outcome = 'invalid_reference_handoff';
                return routeResult({
                    reply: getChatbotFixedText('invalidReferenceEscalation', validated.language),
                    actions: [{ type: 'inquiry' }]
                });
            }
            if (isStudentNumberAttempt(lastUserMessage)) {
                outcome = 'invalid_reference_format';
                return routeResult({
                    reply: getChatbotFixedText('invalidReferenceFormat', validated.language),
                    actions: []
                });
            }
        }
        if (isDeterministicHandoffRequest(lastUserMessage)) {
            outcome = 'handoff';
            return routeResult({
                reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                actions: [{ type: 'inquiry' }]
            });
        }
        const statusNextStepReply = resolveStatusNextStepReply(
            lastUserMessage,
            sanitizedMessages,
            validated.language
        );
        if (statusNextStepReply) {
            outcome = 'status_next_step';
            return routeResult({
                reply: statusNextStepReply,
                actions: []
            });
        }

        const evidenceRisk = hasEvidenceRiskSafe(userTurns, validated.language);
        const { facts: supportedFacts, uncertainKeys } = readSupportedDocumentFacts(userTurns, validated.language);
        const allowDeterministicEvidence = !evidenceRisk && uncertainKeys.size === 0;
        const allowLexiconListFallback = uncertainKeys.size === 0;
        const isAnsweringMissingFacts = isAnsweringMissingFactsQuestion(previousAssistantMessage, validated.language);
        const isContinuingDocumentList = isDocumentListAssistantReply(previousAssistantMessage, validated.language);
        const isShortDocumentQuery = isVeryShortDocumentQuestion(lastUserMessage);
        const { facts: lastTurnFacts, uncertainKeys: lastTurnUncertainKeys } = readSupportedDocumentFacts(
            [lastUserMessage],
            validated.language
        );
        const lastTurnHasDocumentFact = Object.keys(lastTurnFacts).length > 0 || lastTurnUncertainKeys.size > 0;
        const normalizedLastUserMessage = evidence.normalizeForEvidence(lastUserMessage);
        const lastTurnHasListIntentPhrase = DOCUMENT_LIST_INTENT_PATTERNS.some((pattern) =>
            pattern.test(normalizedLastUserMessage)
        );
        const previousUserTurns = userTurns.slice(0, -1);
        const previousUserAskedForDocuments = previousUserTurns.some((turn) =>
            isVeryShortDocumentQuestion(turn) || isAskingWhichDocumentsAreNeeded(turn)
        );
        const lastTurnHasKnowledgeOrNonListQuestion =
            NON_LIST_KNOWLEDGE_OR_QUESTION_PATTERNS.some((pattern) => pattern.test(normalizedLastUserMessage))
            || (/[?\u061f]\s*$/u.test(lastUserMessage) && !lastTurnHasListIntentPhrase);
        const lastTurnProvidesFactsOnly =
            (lastTurnHasDocumentFact || lastTurnHasListIntentPhrase) && !lastTurnHasKnowledgeOrNonListQuestion;
        const hasDocumentListIntent =
            (isAnsweringMissingFacts && !lastTurnHasKnowledgeOrNonListQuestion)
            || isShortDocumentQuery
            || isAskingWhichDocumentsAreNeeded(lastUserMessage)
            || (previousUserAskedForDocuments && lastTurnProvidesFactsOnly);
        const hasPostModelDocumentRecoveryIntent =
            hasDocumentListIntent
            || (isContinuingDocumentList && lastTurnProvidesFactsOnly);
        const fingerprintKnowledgeQuestion = !hasDocumentListIntent && isFingerprintKnowledgeQuestion(lastUserMessage);

        if (hasDocumentListIntent && supportedFacts.fingerprint_status === 'not_registered') {
            outcome = 'handoff';
            return routeResult({
                reply: getChatbotFixedText('fingerprintNeeded', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        if (allowDeterministicEvidence && isShortDocumentQuery) {
            const docOutput = resolveEvidenceDocumentOutput(supportedFacts, validated.language);
            outcome = 'ok';
            return renderDocumentToolReply(docOutput, validated.language, false, true, supportedFacts);
        }

        if (allowDeterministicEvidence && hasDocumentListIntent) {
            const docOutput = resolveEvidenceDocumentOutput(supportedFacts, validated.language);
            if ((Array.isArray(docOutput?.labels) && docOutput.labels.length > 0) || isAnsweringMissingFacts) {
                outcome = 'ok';
                return renderDocumentToolReply(docOutput, validated.language, false, true, supportedFacts);
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

        let handoffRequested = false;
        try {
            const model = createChatModel(environment, {
                sessionAffinity: `topi-public-${validated.language}`
            });
            const requestSignal = AbortSignal.timeout(CHATBOT_REQUEST_DEADLINE_MS);
            const conversation = [
                { role: 'system', content: buildChatbotSystemPrompt(validated.language) },
                ...sanitizedMessages
            ];

            let finalText = null;
            let exhaustedModelCalls = false;
            let fingerprintNotRegistered = false;
            let lastDocumentLabels = null;
            let lastDocumentFacts = null;
            let lastMissingDocumentFields = null;
            let lastKnowledgeText = null;
            let failedToolRounds = 0;

            for (let modelCall = 1; modelCall <= CHATBOT_MAX_MODEL_CALLS; modelCall += 1) {
                // 3. çağrı son izin verilen çağrıdır; aracısız gönderilir ki model metin yanıtı üretmeye zorlansın.
                const allowTools = modelCall < CHATBOT_MAX_MODEL_CALLS;
                const result = await model.complete({
                    messages: conversation,
                    signal: requestSignal,
                    ...(allowTools ? { tools: CHATBOT_TOOL_DEFINITIONS } : {})
                });
                if (result?.usage) {
                    modelInputTokens += result.usage.inputTokens ?? 0;
                    modelCachedInputTokens += result.usage.cachedInputTokens ?? 0;
                    modelOutputTokens += result.usage.outputTokens ?? 0;
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
                                uncertainKeys,
                                userTurns,
                                language: validated.language
                            })
                            : call.arguments;
                        const output = executeChatbotTool(call.name, effectiveArgs, { language: validated.language });
                        if (call.name === 'handoff_to_office' || output?.action?.type === 'inquiry') {
                            handoffRequested = true;
                        }
                        if (call.name === 'get_required_documents') {
                            if (effectiveArgs?.fingerprint_status === 'not_registered') {
                                fingerprintNotRegistered = true;
                                lastDocumentLabels = null;
                                lastDocumentFacts = null;
                                lastMissingDocumentFields = null;
                            } else if (Array.isArray(output?.labels) && output.labels.length > 0) {
                                lastDocumentLabels = output.labels;
                                lastDocumentFacts = effectiveArgs;
                                lastMissingDocumentFields = null;
                            } else if (Array.isArray(output?.missing) && output.missing.length > 0) {
                                lastMissingDocumentFields = output.missing;
                                lastDocumentLabels = null;
                                lastDocumentFacts = null;
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
                if (fingerprintNotRegistered || lastDocumentLabels || lastMissingDocumentFields || lastKnowledgeText || handoffRequested) {
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
                if (hasPostModelDocumentRecoveryIntent) {
                    outcome = 'ok';
                    return renderListIntentFallbackReply(
                        supportedFacts,
                        validated.language,
                        handoffRequested,
                        allowLexiconListFallback
                    );
                }
                if (fingerprintKnowledgeQuestion) {
                    outcome = 'knowledge';
                    return routeResult({
                        reply: readKnowledge('fingerprint', validated.language).text,
                        actions: []
                    });
                }
                outcome = 'fallback';
                return routeResult({
                    reply: getChatbotFixedText('fallback', validated.language),
                    actions: [{ type: 'inquiry' }]
                });
            }

            if (fingerprintNotRegistered) {
                outcome = 'handoff';
                return routeResult({
                    reply: getChatbotFixedText('fingerprintNeeded', validated.language),
                    actions: [{ type: 'inquiry' }]
                });
            }

            if (lastDocumentLabels) {
                outcome = 'ok';
                const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
                return routeResult({
                    reply: buildDocumentReply(lastDocumentLabels, validated.language, lastDocumentFacts),
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

            if (lastKnowledgeText && !hasDocumentListIntent) {
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
                if (hasPostModelDocumentRecoveryIntent) {
                    outcome = 'ok';
                    return renderListIntentFallbackReply(
                        supportedFacts,
                        validated.language,
                        handoffRequested,
                        allowLexiconListFallback
                    );
                }
                if (fingerprintKnowledgeQuestion) {
                    outcome = 'knowledge';
                    return routeResult({
                        reply: readKnowledge('fingerprint', validated.language).text,
                        actions: []
                    });
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
                        allowLexiconListFallback
                    );
                }
                outcome = 'refusal';
                return routeResult({
                    reply: getChatbotFixedText('refusal', validated.language),
                    actions: [{ type: 'inquiry' }]
                });
            }

            if (isUnsafeModelReplyText(trimmedText)) {
                if (hasPostModelDocumentRecoveryIntent) {
                    outcome = 'ok';
                    return renderListIntentFallbackReply(
                        supportedFacts,
                        validated.language,
                        handoffRequested,
                        allowLexiconListFallback
                    );
                }
                if (fingerprintKnowledgeQuestion) {
                    outcome = 'knowledge';
                    return routeResult({
                        reply: readKnowledge('fingerprint', validated.language).text,
                        actions: []
                    });
                }
                outcome = 'fallback';
                return routeResult({
                    reply: getChatbotFixedText('fallback', validated.language),
                    actions: [{ type: 'inquiry' }]
                });
            }

            if (looksLikeProseDocumentReply(trimmedText, validated.language) || hasDocumentListIntent) {
                outcome = 'ok';
                return renderListIntentFallbackReply(
                    supportedFacts,
                    validated.language,
                    handoffRequested,
                    allowLexiconListFallback
                );
            }

            if (isInsufficientOrWrongScriptReply(trimmedText, validated.language)) {
                if (hasPostModelDocumentRecoveryIntent) {
                    outcome = 'ok';
                    return renderListIntentFallbackReply(
                        supportedFacts,
                        validated.language,
                        handoffRequested,
                        allowLexiconListFallback
                    );
                }
                if (fingerprintKnowledgeQuestion) {
                    outcome = 'knowledge';
                    return routeResult({
                        reply: readKnowledge('fingerprint', validated.language).text,
                        actions: []
                    });
                }
                outcome = 'fallback';
                return routeResult({
                    reply: getChatbotFixedText('fallback', validated.language),
                    actions: [{ type: 'inquiry' }]
                });
            }

            if (looksLikeBareTransferOffer(trimmedText)) {
                outcome = 'handoff';
                return routeResult({
                    reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                    actions: [{ type: 'inquiry' }]
                });
            }

            outcome = 'ok';
            const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
            return routeResult({ reply: trimmedText, actions });
        } catch (error) {
            if (hasDocumentListIntent) {
                outcome = 'ok';
                return renderListIntentFallbackReply(
                    supportedFacts,
                    validated.language,
                    handoffRequested,
                    allowLexiconListFallback
                );
            }
            throw error;
        }
        })();

        const replyBody = replyResult?.body && typeof replyResult.body === 'object' ? replyResult.body : null;
        if (!replyBody || typeof replyBody.reply !== 'string') {
            return replyResult;
        }
        const { sessionId, turnId, writeStatus } = await persistPublicChatTurn({
            environment,
            executionContext,
            requestedSessionId: validated.sessionId,
            language: validated.language,
            userText: lastUserMessage,
            assistantText: replyBody.reply,
            outcome,
            tools: executedToolNames,
            latencyMs: Date.now() - startedAt
        });
        chatLogWrite = writeStatus;
        return routeResult({
            ...replyBody,
            session_id: sessionId,
            turn_id: turnId
        }, { status: replyResult.status, cookie: replyResult.cookie });
    } catch (error) {
        outcome = outcomeForError(error);
        throw error;
    } finally {
        console.info('Public chat request completed.', {
            requestId,
            outcome,
            tools: executedToolNames,
            latencyMs: Date.now() - startedAt,
            chatLogWrite,
            modelInputTokens,
            modelCachedInputTokens,
            modelOutputTokens
        });
    }
}
