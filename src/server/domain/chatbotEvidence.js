import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../../shared/document-conditions.js';
import { CHATBOT_LANGUAGES } from './chatbotKnowledge.js';

const TOOL_APPLICATION_TYPES = Object.freeze(['initial', 'renewal', 'transition']);
const FINGERPRINT_STATUSES = Object.freeze(['registered', 'not_registered']);

const COMBINING_MARKS_PATTERN = /\p{M}+/gu;
const FORMAT_CHARS_PATTERN = /\p{Cf}+/gu;
const ARABIC_DIACRITICS_PATTERN = /[\u064B-\u065F\u0670\u0640]/gu;
const APOSTROPHE_VARIANTS_PATTERN = /[\u2018\u2019\u02BC\uFF07]/g;
const TURKISH_INTRAWORD_APOSTROPHE_PATTERN = /(?<=\p{L})'(?=(?!(?:t|m|s|re|ve|ll|d)(?![\p{L}\p{N}]))[\p{L}]{2,}|[aeiuo](?![\p{L}\p{N}]))/gu;

const CLAUSE_SPLIT_PATTERN = /(?:[!?;,\n\r\u061f\u061b\u060c]+|(?<!(?<![\p{L}\p{N}])y)\.(?=\s|$))/u;
const WORD_TOKEN_PATTERN = /[\p{L}\p{N}']+/gu;
const NEGATION_WINDOW_WORDS = 4;

/**
 * Normalizes user text across tr/en/ru/tk/ar so missing diacritics, Turkish İ/ı,
 * Turkmen letters, Russian ё, Arabic letter variants, format characters, and apostrophe variants match consistently.
 * @param {string} text Raw user message text.
 * @returns {string} Normalized lowercase text.
 */
export function normalizeForEvidence(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(FORMAT_CHARS_PATTERN, '')
        .replace(APOSTROPHE_VARIANTS_PATTERN, "'")
        .replace(/İ/g, 'i')
        .replace(/I/g, 'i')
        .replace(/ı/g, 'i')
        .toLowerCase()
        .replace(/ğ/g, 'g')
        .replace(/ş/g, 's')
        .replace(/ç/g, 'c')
        .replace(/ö/g, 'o')
        .replace(/ü/g, 'u')
        .replace(/ý/g, 'y')
        .replace(/ň/g, 'n')
        .replace(/ä/g, 'a')
        .replace(/ž/g, 'z')
        .replace(/ё/g, 'е')
        .replace(ARABIC_DIACRITICS_PATTERN, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .normalize('NFKD')
        .replace(COMBINING_MARKS_PATTERN, '')
        .replace(FORMAT_CHARS_PATTERN, '')
        .replace(TURKISH_INTRAWORD_APOSTROPHE_PATTERN, '');
}

const RU_LATIN_NEGATION_PATTERNS = Object.freeze([
    /^ne$/u,
    /^net$/u,
    /^bez$/u
]);

const NEGATION_LEXICON_BY_LANGUAGE = Object.freeze({
    tr: Object.freeze([
        /^degil[\p{L}\p{N}]*$/u,
        /^yok(?:tur)?$/u,
        /^[\p{L}]+(?:miyorum|muyorum|miyor|muyor|madim|medim)$/u,
        /^hic(?:bir[\p{L}\p{N}]*)?$/u
    ]),
    en: Object.freeze([
        /^not$/u,
        /^no$/u,
        /^don'?t$/u,
        /^doesn'?t$/u,
        /^didn'?t$/u,
        /^isn'?t$/u,
        /^aren'?t$/u,
        /^haven'?t$/u,
        /^hasn'?t$/u,
        /^wasn'?t$/u,
        /^weren'?t$/u,
        /^never$/u,
        /^without$/u
    ]),
    ru: Object.freeze([
        /^не$/u,
        /^нет$/u,
        /^без$/u,
        /^никогда$/u,
        ...RU_LATIN_NEGATION_PATTERNS
    ]),
    tk: Object.freeze([
        /^dal$/u,
        /^yok$/u,
        /^[\p{L}]+(?:mayar[\p{L}\p{N}]*|meyar[\p{L}\p{N}]*|amok|emok|anok|enok|madym|medim|madyk|medik)$/u
    ]),
    ar: Object.freeze([
        /^(?:و)?(?:لا|ليس|ليست|لست|غير|لم|لن|بدون|مش|مو)$/u
    ])
});

const ARABIC_DIALECT_NEGATION_PARTICLE_PATTERN = /^(?:و)?(?:ما|مش|مو)$/u;
const ARABIC_MA_NON_VERB_NOUN_PATTERN = /^(?:ال[\p{L}\p{N}]*|نوع|نتيجه|تاريخ|تكلفه|بيانات|بصم[\p{L}\p{N}]*|تعهد|اوراق|اجراءات|انواع|اسباب|اوقات|ارقام|اسماء|اسم|اقامه|ايجار|اجار|استماره|اتفاقيه|افاده|امكانيه|احجام|اماكن)$/u;
const ARABIC_DIALECT_VERB_AFTER_MA_PATTERN = /^(?:[بتينا][\p{L}]{2,}|ساكن[\p{L}]*|عايش[\p{L}]*|قاعد[\p{L}]*|مقيم[\p{L}]*|عند[\p{L}]*|لدي[\p{L}]*|مع[\p{L}]*|سجل[\p{L}]*|تم[\p{L}]*)$/u;

const COMMON_NEGATION_TOKEN_PATTERNS = Object.freeze([
    ...NEGATION_LEXICON_BY_LANGUAGE.tr,
    ...NEGATION_LEXICON_BY_LANGUAGE.en,
    ...NEGATION_LEXICON_BY_LANGUAGE.ru.filter((pattern) => !RU_LATIN_NEGATION_PATTERNS.includes(pattern)),
    ...NEGATION_LEXICON_BY_LANGUAGE.tk,
    ...NEGATION_LEXICON_BY_LANGUAGE.ar
]);

const APPLICATION_TYPE_PATTERNS = Object.freeze({
    initial: Object.freeze([
        /(?<![\p{L}\p{N}])ilk\s+(?:(?:ikamet\s+)?basvur[\p{L}\p{N}]*|kez|kere|defa)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])ilkinj[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:first\s+(?:time|(?:permit\s+)?application)|initial)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:вперв[\p{L}\p{N}]*|первич[\p{L}\p{N}]*|перв(?:ая|ыи|ое)\s+подач[\p{L}\p{N}]*|первыи\s+раз)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:اول|اولي|اوليا|اوليه|الاول|الاولي|الاوليه|اول\s+مره|للمره\s+الاولي|طلب[\p{L}\p{N}]*\s+اول[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u
    ]),
    renewal: Object.freeze([
        /(?<![\p{L}\p{N}])(?:uzat[\p{L}\p{N}]*|yenile[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:uzalt[\p{L}\p{N}]*|tazele[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:exten[\p{L}\p{N}]*|renew[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])продл[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تمديد|تجديد|امدد|اجدد)(?![\p{L}\p{N}])/u
    ]),
    transition: Object.freeze([
        /(?<![\p{L}\p{N}])(?:gecis[\p{L}\p{N}]*|tur\s+degis[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:uytget[\p{L}\p{N}]*|gecish[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:transition[\p{L}\p{N}]*|switch[\p{L}\p{N}]*|transfer)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:переход[\p{L}\p{N}]*|переи[\p{L}\p{N}]*|перевест[\p{L}\p{N}]*|смен(?:ить|а)\s+вид[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تحويل|انتقال|الانتقال|احول|انقل)(?![\p{L}\p{N}])/u
    ])
});

const TRANSITION_PEREVOD_PATTERN = /(?<![\p{L}\p{N}])перевод[\p{L}\p{N}]*(?![\p{L}\p{N}])/u;
const TRANSITION_PEREVOD_CONTEXT_PATTERN = /(?<![\p{L}\p{N}])(?:внж|вид[\p{L}\p{N}]*|статус[\p{L}\p{N}]*|разрешени[\p{L}\p{N}]*|на\s+студенческ[\p{L}\p{N}]*|vnzh|vid[\p{L}\p{N}]*|status[\p{L}\p{N}]*|na\s+studenchesk[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u;

const ACCOMMODATION_PATTERNS = Object.freeze({
    dormitory: Object.freeze([
        /(?<![\p{L}\p{N}])(?:ogrenci\s+)?yurt(?:ta|da|tan|dan|um|umuz|u|a|lar)?(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])yurdu(?:n|m|nda|ndan)?(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])kyk(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])dorm(?:itory|itories|s)?(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:общежит[\p{L}\p{N}]*|общаг[\p{L}\p{N}]*|obshag[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:umumy\s+yasayys[\p{L}\p{N}]*|yasayys\s+jay[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?سكن\s+(?:ال)?طلاب[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?سكن\s+(?:ال)?جامع[\p{L}\p{N}]*|sakan\s+jami[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u
    ]),
    rental_contract: Object.freeze([
        /(?<![\p{L}\p{N}])kira(?:da|lik|ci|yi|ladim|sozlesme[\p{L}\p{N}]*|\s+sozlesme[\p{L}\p{N}]*)?(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])rent(?:al|ing|ed|s)?(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:аренд[\p{L}\p{N}]*|договор[\p{L}\p{N}]*\s+наима|снима[\p{L}\p{N}]*\s+кварт[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:karend[\p{L}\p{N}]*|kirey[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:ايجار|عقد\s+(?:ال)?ايجار|عقد\s+(?:ال)?اجار|مستاجر[\p{L}\p{N}]*|استاجر[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u
    ]),
    own_home: Object.freeze([
        /(?<![\p{L}\p{N}])(?:kendi\s+ev[\p{L}\p{N}]*|tapu[\p{L}\p{N}]*|ev\s+benim)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:own\s+(?:home|house|flat|apartment|place)|title\s+deed)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:собственн[\p{L}\p{N}]*\s+(?:жил[\p{L}\p{N}]*|дом[\p{L}\p{N}]*|кварт[\p{L}\p{N}]*)|сво(?:е|еи|я|ем)\s+(?:жил[\p{L}\p{N}]*|дом[\p{L}\p{N}]*|кварт[\p{L}\p{N}]*)|тапу|в\s+собственности)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:oz\s+oy[\p{L}\p{N}]*|eyecilik[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:منزل|بيت|شقه)\s+املك[\p{L}\p{N}]*|سند\s+(?:ال)?ملكي[\p{L}\p{N}]*|ملك\s+خاص|ملكي|(?:منزل|بيت)[\p{L}\p{N}]*\s+مملوك[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u
    ]),
    hotel: Object.freeze([
        /(?<![\p{L}\p{N}])(?:otel[\p{L}\p{N}]*|pansiyon[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])hotel[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:гостиниц[\p{L}\p{N}]*|отел[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])myhmanhana[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?فندق[\p{L}\p{N}]*(?![\p{L}\p{N}])/u
    ]),
    undertaking: Object.freeze([
        /(?<![\p{L}\p{N}])(?:taahhut[\p{L}\p{N}]*|akraba[\p{L}\p{N}]*|tanidig[\p{L}\p{N}]*|tanidik[\p{L}\p{N}]*|(?:arkadas|aile)[\p{L}\p{N}]*\s+yan[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:undertaking[\p{L}\p{N}]*|relative|(?:stay|staying|live|living)\s+with\s+(?:a\s+|an\s+|my\s+|our\s+)?(?:host|relative|friend|family|someone))(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:обязательств[\p{L}\p{N}]*|поручител[\p{L}\p{N}]*|родственник[\p{L}\p{N}]*|(?:жив(?:у|ем)|остановил[\p{L}\p{N}]*)\s+у)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:borcnama[\p{L}\p{N}]*|garyndas[\p{L}\p{N}]*|(?:dost|tanys|adam|garyndas|dayza|dayy|kaka|eje|dogan|aga)[\p{L}\p{N}]*\s+(?:yanynda|oyunde))(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تعهد|التعهد|كفاله|مقدم\s+(?:ال)?تعهد)|(?:اسكن|بسكن|تسكن|يسكن|نسكن|اقيم|بقيم|تقيم|يقيم|نقيم|ساكن[\p{L}\p{N}]*|مقيم[\p{L}\p{N}]*|عايش[\p{L}\p{N}]*|اعيش|بعيش|تعيش|يعيش|نعيش|قاعد[\p{L}\p{N}]*)\s+(?:مع|عند|لدي))(?![\p{L}\p{N}])/u
    ]),
    residence_certificate: Object.freeze([
        /(?<![\p{L}\p{N}])(?:adres\s+kayd[\p{L}\p{N}]*|yerlesim\s+yeri(?:\s+belge[\p{L}\p{N}]*)?|ikametgah\s+belge[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:residence\s+certificate|registered\s+address|address\s+registration)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:справк[\p{L}\p{N}]*\s+о\s+месте(?:\s+жительств[\p{L}\p{N}]*)?|регистрац[\p{L}\p{N}]*\s+по\s+адресу)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:hasaba\s+alnan\s+salg[\p{L}\p{N}]*|yasayan\s+yeri\s+sahadatnama[\p{L}\p{N}]*|salgy\s+sahadatnama[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
        /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:شهاده\s+(?:محل\s+)?(?:ال)?اقامه|(?:ال)?عنوان\s+(?:ال)?مسجل|بيان\s+(?:ال)?عنوان)(?![\p{L}\p{N}])/u
    ])
});

const ACCOMMODATION_CONTRAST_CORRECTION_PATTERN = /(?<![\p{L}\p{N}])(?:ama|fakat|ancak|aslinda|artik|su\s*an(?:da)?|but|actually|now|any\s*more|но|на\s+самом\s+деле|сеичас|уже\s+не|yone|emma|hazir[\p{L}\p{N}]*|(?:و)?لكن[\p{L}\p{N}]*|(?:و)?بس|حاليا|(?:و|ف)?الان)(?![\p{L}\p{N}])/u;
const ACCOMMODATION_MOVEOUT_PATTERN = /(?<![\p{L}\p{N}])(?:cikti(?:m|k)|tasindi(?:m|k)|ayrildi(?:m|k)|moved\s+(?:out|to)|left|съехал[\p{L}\p{N}]*|переехал[\p{L}\p{N}]*|gocd(?:um|uk)|cykd(?:ym|yk)|ayryld(?:ym|yk)|(?:و|ف)?(?:طلع(?:ت|نا)|انتقل(?:ت|نا)|خرج(?:ت|نا)|ترك(?:ت|نا)))(?![\p{L}\p{N}])/u;
const FRIEND_STAY_LOCATION_PATTERNS = Object.freeze([
    /(?<![\p{L}\p{N}])arkadas(?:im)?in\s+ev[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])friend(?:'s|s)?\s+(?:place|house|home|flat|apartment)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])у\s+(?:друг[\p{L}\p{N}]*|подруг[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])dost[\p{L}\p{N}]*\s+oy[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:عند|لدي|بيت|منزل)\s+(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?صديق[\p{L}\p{N}]*(?![\p{L}\p{N}])/u
]);

const ARABIC_QARIB_PATTERN = /(?<![\p{L}\p{N}])(?!قريبا(?![\p{L}\p{N}]))(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?قريب(?:ي|ه|ها|نا)?(?![\p{L}\p{N}])/u;
const ARABIC_QARIB_CONTEXT_PATTERN = /(?<![\p{L}\p{N}])(?:عند|لدي|مع|بيت|منزل)(?![\p{L}\p{N}])/u;

const UNDER_18_PHRASES = Object.freeze([
    /(?<![\p{L}\p{N}])18\s*(?:yasindan|yastan)?\s*kucug?[\p{L}\p{N}]*(?!\s+degil)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])18\s*(?:yas)?\s*alti(?:nda)?(?!\s+degil)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])resit\s+degil[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!not\s+)(?:under|below|less\s+than|younger\s+than)\s+18(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!not\s+(?:a\s+)?)minor(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:(?<!не\s+)(?:младше|меньше)\s+18|до\s+18\s*(?:лет)?|несовершеннолет[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:18\s*yasdan\s*kici[\p{L}\p{N}]*(?!\s+dal)|kamillik\s*yasyna\s*yetmedik[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:(?<!(?:لست|ليس|ليست)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:اقل|اصغر|دون)\s+(?:من\s+)?18|(?<!(?:لست|ليس|ليست)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?قاصر[اه]?)(?![\p{L}\p{N}])/u
]);

const ADULT_PHRASES = Object.freeze([
    /(?<![\p{L}\p{N}])18\s*(?:(?:yasindan|yastan|'?den|'?dan)?\s*kucuk|(?:yas)?\s*alti(?:nda)?)\s*degil[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])18\s*(?:yasindan|yastan|'?den|'?dan)?\s*buyu[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])18\s*(?:yas\s*)?(?:ve\s*)?uzeri[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:resitim|yetiskin[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])not\s+(?:(?:under|below|less\s+than|younger\s+than)\s+18|(?:a\s+)?minor)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:over|above|older\s+than)\s+18(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])18\s*(?:or\s+older|and\s+over|\+)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])adult(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:не\s+(?:младше|меньше)\s+18|старше\s+18|больше\s+18|совершеннолет[\p{L}\p{N}]*|взросл[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:18\s*yasdan\s*(?:uly|kici\s+dal[\p{L}\p{N}]*)|kamillik\s*yasyna\s*yeten[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:(?:و)?(?:لست|ليس|ليست|غير)\s+(?:(?:اقل|اصغر|دون)\s+(?:من\s+)?18|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?قاصر[اه]?)|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:اكبر|فوق|اعلي)\s+(?:من\s+)?18|بالغ|راشد))(?![\p{L}\p{N}])/u
]);

// Explicit negation included in adult phrases above (these mean "adult", not uncertainty).
const EXPLICIT_DOUBLE_NEG_ADULT_PATTERN = /(?<![\p{L}\p{N}])(?:(?:kucuk|alti(?:nda)?)\s*degil[\p{L}\p{N}]*|not\s+(?:(?:under|below|less\s+than|younger\s+than)\s+18|(?:a\s+)?minor)|не\s+(?:младше|меньше)\s+18|kici\s+dal[\p{L}\p{N}]*|(?:و)?(?:لست|ليس|ليست|غير)\s+(?:(?:اقل|اصغر|دون)\s+(?:من\s+)?18|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?قاصر[اه]?))(?![\p{L}\p{N}])/u;
const QUOTE_AGE_CONTEXT_PATTERN = /(?<![\p{L}\p{N}])(?:yas[\p{L}\p{N}]*|years?|yrs?\s+old|y\.?o\.?|old|age[\p{L}\p{N}]*|лет|года?|let|goda?|omr[\p{L}\p{N}]*|umr[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:عمر[\p{L}\p{N}]*|سن(?:ي|ه|ين|وات)?))(?![\p{L}\p{N}])/u;

const NUMERIC_AGE_PATTERNS = Object.freeze([
    // tr / tk suffix age units
    /(?<![\p{L}\p{N}])(1[4-9]|[2-9]\d)\s*(?:yasindayim|yasinda|yasimda|yasim|yasymda|yasym)(?![\p{L}\p{N}])/gu,
    // en explicit age units ("years old", "yrs old", "y.o.")
    /(?<![\p{L}\p{N}])(1[4-9]|[2-9]\d)\s*(?:years?\s+old|yrs?\s+old|y\.?o\.?)(?![\p{L}\p{N}])/gu,
    // en "I am N" / "I'm N" only at end of clause (allowing trailing delimiter/comma) or followed by "years" or "and"
    /(?<![\p{L}\p{N}])(?:i\s+am|i'm|im)(?:\s+not)?\s+(1[4-9]|[2-9]\d)(?=(?:\s*(?:years(?=\s*(?:and(?![\p{L}\p{N}])|[,.;!?\u061f\u061b\u060c]|$))|and(?![\p{L}\p{N}])|[,.;!?\u061f\u061b\u060c]|$)))/gu,
    // ru explicit age statements ("мне [уже|исполнилось] N [лет/года/год]" or "N лет/года/год от роду")
    /(?<![\p{L}\p{N}])(?:мне|mne)(?:\s+еще)?(?:\s+(?:не|ne))?(?:\s+(?:уже|uzhe))?(?:\s+исполнилось)?\s+(1[4-9]|[2-9]\d)(?:\s*(?:лет|года|год|let|goda|god)(?![\p{L}\p{N}])|(?=\s*(?:(?:и|а|i|a)(?![\p{L}\p{N}])|[,.;!?\u061f\u061b\u060c]|$)))/gu,
    /(?<![\p{L}\p{N}])(1[4-9]|[2-9]\d)\s*(?:лет|года|год)\s+от\s+роду(?![\p{L}\p{N}])/gu,
    // ru standalone age phrase between clause delimiters (e.g. ", 19 лет,")
    /^\s*(?:не\s+)?(1[4-9]|[2-9]\d)\s*(?:лет|года|год)\s*[!?;,.\n\r\u061f\u061b\u060c]*$/gu,
    // tr / tk / en / ar prefix age ("yaşım N", "ýaşym N", "age N", "عمري/عمر/سني N [سنة/عاماً]")
    /(?<![\p{L}\p{N}])(?:yasim|yasym|age|omri|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:عمري|عمر|سني))\s*[:=]?\s*(?:(?:degil[\p{L}\p{N}]*|not|ليس|ليست|لست|غير|مش|مو)\s+)?(1[4-9]|[2-9]\d)(?:\s*(?:سنه|سنوات|عاما|عام|sana))?(?![\p{L}\p{N}])/gu
]);

const RUSSIAN_START_AGE_PATTERN = /^\s*(?:не\s+)?(1[4-9]|[2-9]\d)\s*(?:лет|года|год)(?!\s*(?:назад|спустя|подряд|здесь|живу|прожил[\p{L}\p{N}]*))(?![\p{L}\p{N}])/gu;

const DURATION_PREFIX_WORDS = Object.freeze([
    /^for$/u, /^since$/u, /^during$/u, /^за$/u, /^на$/u, /^уже$/u,
    /^لمده$/u, /^منذ$/u, /^خلال$/u, /^boyunca$/u, /^beri$/u
]);

const DURATION_SUFFIX_WORDS = Object.freeze([
    /^yildir$/u, /^aydir$/u, /^gundur$/u, /^haftadir$/u, /^saattir$/u,
    /^yyldyr$/u, /^aydyr$/u, /^gundir$/u, /^beri$/u, /^late$/u, /^days?$/u
]);

const HOST_CONTEXT_PATTERNS = Object.freeze([
    // tr
    /(?<![\p{L}\p{N}])(?:ev\s+sahib[\p{L}\p{N}]*|taahhut(?:name)?\s+veren[\p{L}\p{N}]*|yaninda\s+kaldig[\p{L}\p{N}]*|akraba[\p{L}\p{N}]*|teyze[\p{L}\p{N}]*|amca[\p{L}\p{N}]*|dayi[\p{L}\p{N}]*|halam[\p{L}\p{N}]*|arkadasim[\p{L}\p{N}]*|(?:arkadas|aile|tanidik|tanidig)[\p{L}\p{N}]*\s+yan[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    // en
    /(?<![\p{L}\p{N}])(?:host[\p{L}\p{N}]*|landlord[\p{L}\p{N}]*|(?:relatives?|uncles?|aunts?)(?:'s)?|(?:the\s+)?person\s+(?:i\s+)?stay\s+with|(?:stay|staying|live|living)\s+with\s+(?:a\s+|an\s+|my\s+|our\s+)?(?:host|relative|friend|family|someone))(?![\p{L}\p{N}])/u,
    // ru
    /(?<![\p{L}\p{N}])(?:хозяин[\p{L}\p{N}]*|хозяик[\p{L}\p{N}]*|принимающ[\p{L}\p{N}]*|родственни(?:к|ц)[\p{L}\p{N}]*|тет(?:я|и|е|еи|ю|ин[\p{L}\p{N}]*)|дяд[\p{L}\p{N}]*|у\s+(?:кого|которого|которои)\s+живу|(?:жив(?:у|ем)|остановил[\p{L}\p{N}]*)\s+у\s+(?:[\p{L}\p{N}]+\s+)?(?:друг[\p{L}\p{N}]*|подруг[\p{L}\p{N}]*|знаком[\p{L}\p{N}]*))(?![\p{L}\p{N}])/u,
    // tk
    /(?<![\p{L}\p{N}])(?:hojayyn[\p{L}\p{N}]*|garyndas[\p{L}\p{N}]*|dayza[\p{L}\p{N}]*|dayy[\p{L}\p{N}]*|borcnama\s+beryan[\p{L}\p{N}]*|(?:dost|tanys|adam|garyndas|dayza|dayy|kaka|eje|dogan|aga)[\p{L}\p{N}]*\s+(?:yanynda|oyunde))(?![\p{L}\p{N}])/u,
    // ar
    /(?<![\p{L}\p{N}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مضيف[\p{L}\p{N}]*|صاحب\s+(?:ال)?سكن|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?قريب(?:ي|ه|ها|نا)?|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:خال|عم)(?:ي|ه|ها|نا|تي|ته|تها|تنا)?|(?:الشخص\s+)?(?:الذي|اللي)\s+(?:اسكن|بسكن|اقيم|بقيم|ساكن[\p{L}\p{N}]*|مقيم[\p{L}\p{N}]*|عايش[\p{L}\p{N}]*|اعيش|بعيش)\s+(?:عنده|عندها|معه|معها|لديه|لديها)|(?:اسكن|بسكن|تسكن|يسكن|نسكن|اقيم|بقيم|تقيم|يقيم|نقيم|ساكن[\p{L}\p{N}]*|مقيم[\p{L}\p{N}]*|عايش[\p{L}\p{N}]*|اعيش|بعيش|تعيش|يعيش|نعيش|قاعد[\p{L}\p{N}]*)\s+(?:مع|عند|لدي)\s+(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:صديق|شخص)[\p{L}\p{N}]*|مقدم\s+(?:ال)?تعهد)(?![\p{L}\p{N}])/u
]);

const HOST_THIRD_PERSON_PRONOUN_PATTERN = /(?<![\p{L}\p{N}])(?:o(?!\s+(?:zaman|yuzden|belge|evrak|konu|durum|halde))|onun|he(?:'s)?|she(?:'s)?|his|her|он|она|его|ее|ol|(?<!(?:ما|من|هل|اين|كيف)\s+)(?:و|ف)?(?:هو|هي))(?![\p{L}\p{N}])/gu;
const STUDENT_SUBJECT_PATTERN = /(?<![\p{L}\p{N}])(?:ben(?:im)?|esim|karim|kocam|i\s+am|i'm|im|i|my|я|мне|у\s+меня|мо(?:я|и|еи|его|ему|им|ем)|men(?:in)?|(?:و|ف)?(?:انا|لست|عندي|لدي|زوجتي|زوجي))(?![\p{L}\p{N}])/gu;
const FIRST_PERSON_TURKISH_PREDICATE_PATTERN = /^(?:evliyim|bekarim|vatandasim|vatandasiyim|turkum|tcliyim|yabanciyim|uyrukluyum|degilim|bosandim|dulum|ogrenciyim|yasindayim|yasimdayim|resitim|kucugum|buyugum)$/u;
const FIRST_PERSON_TURKISH_VERB_PATTERN = /^[\p{L}]{2,}(?:iyorum|uyorum|miyorum|muyorum|madim|medim|acagim|ecegim)$/u;

const HOST_MARRIED_NEGATIVE = Object.freeze([
    /(?<![\p{L}\p{N}])evli\s+degil[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])bekar[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:(?:not|isn't|isnt|aren't|arent)\s+married|unmarried|single)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:не\s+женат|не\s+замужем|не\s+состоит\s+в\s+браке|холост[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:oylenmedik[\p{L}\p{N}]*|durmusa\s+cykmadyk[\p{L}\p{N}]*|oylenen\s+dal|durmusa\s+cykan\s+dal)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:غير|ليس|ليست|مش|مو)\s+متزوج[\p{L}\p{N}]*|اعزب|عزباء)(?![\p{L}\p{N}])/u
]);

const HOST_MARRIED_POSITIVE = Object.freeze([
    /(?<![\p{L}\p{N}])evli(?!\s+degil)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!(?:not|isn't|isnt|aren't|arent)\s+)married(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!не\s+)(?:женат|замужем|состоит\s+в\s+браке|в\s+браке)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:oylenen|durmusa\s+cykan)(?!\s+dal(?![\p{L}\p{N}]))(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!(?:غير|ليس|ليست|مش|مو)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?متزوج[\p{L}\p{N}]*(?![\p{L}\p{N}])/u
]);

const HOST_TURKISH_NEGATIVE = Object.freeze([
    /(?<![\p{L}\p{N}])(?:turk(?:\s+vatandasi)?|turkiye\s+vatandasi)\s+degil[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])yabanci\s+vatandas[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:not|isn't|isnt)\s+(?:a\s+)?turkish(?:\s+citizen)?(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:не\s+(?:является\s+)?граждан[\p{L}\p{N}]*\s+турции|не\s+турок|не\s+турецк[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:turk(?:iyanin)?\s+(?:rayaty\s+)?dal|dasary\s+yurtly)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:غير|ليس|ليست|مش|مو)\s+(?:مواطن[\p{L}\p{N}]*\s+)?تركي[\p{L}\p{N}]*(?![\p{L}\p{N}])/u
]);

const HOST_TURKISH_POSITIVE = Object.freeze([
    /(?<![\p{L}\p{N}])(?:turk|turkiye|tc)\s+vatandas[\p{L}\p{N}]*(?!\s+degil)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])turk(?!\s*(?:ce(?![\p{L}\p{N}])|ikamet|ogrenci|vize|pasaport|telekom|lira|degil|vatandas[\p{L}\p{N}]*\s+degil))(?![\p{L}\p{N}'])/u,
    /(?<![\p{L}\p{N}])(?<!(?:not|isn't|isnt)\s+(?:a\s+)?)turkish(?:\s+citizen)?(?!\s+(?:residence|student|permit|visa|passport|lira|language))(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!не\s+(?:является\s+)?)граждан[\p{L}\p{N}]*\s+турции(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:turkiyanin|turk)\s+rayat[\p{L}\p{N}]*(?!\s+dal)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!(?:غير|ليس|ليست|مش|مو)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مواطن\s+تركي[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!(?:غير|ليس|ليست|مش|مو)(?:\s+مواطن[\p{L}\p{N}]*)?\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?تركي[\p{L}\p{N}]*(?![\p{L}\p{N}])/u
]);

const FINGERPRINT_NEGATIVE = Object.freeze([
    /(?<![\p{L}\p{N}])parmak\s+iz[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:yok|kayd[\p{L}\p{N}]*\s+yok|kayitli\s+degil[\p{L}\p{N}]*|alinmadi[\p{L}\p{N}]*|vermedim|verilmedi[\p{L}\p{N}]*|yaptirmadim|yaptirilmadi[\p{L}\p{N}]*|bulunmuyor[\p{L}\p{N}]*|bulunmamakta[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:kayd[\p{L}\p{N}]*\s+yok|kayitli\s+olmayan|kayitli\s+degil[\p{L}\p{N}]*|alinmadi[\p{L}\p{N}]*|alinmamis[\p{L}\p{N}]*|vermedim|verilmedi[\p{L}\p{N}]*|yaptirmadim|bulunmayan)\s+(?:[\p{L}\p{N}]+\s+){0,6}parmak\s+iz[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:no|not|never|dont|don't|do\s+not|didnt|didn't|did\s+not|doesnt|doesn't|does\s+not|havent|haven't|have\s+not|hasnt|hasn't|has\s+not|unregistered|missing)\s+(?:[\p{L}\p{N}]+\s+){0,6}fingerprints?(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])fingerprints?(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:not\s+registered|not\s+recorded|not\s+taken|unregistered|missing|not\s+yet|not\s+available|unavailable)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])fingerprints?(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:not|never|haven't|have\s+not|hasn't|has\s+not|aren't|arent|isn't|isnt|wasn't|wasnt|weren't|werent)(?:\s+[\p{L}\p{N}]+){0,3}\s+(?:registered|recorded|taken|done|available|found)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])отпечат[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:не\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:зарегистрирован[\p{L}\p{N}]*|сда[\p{L}\p{N}]*|внесен[\p{L}\p{N}]*|брал[\p{L}\p{N}]*|взят[\p{L}\p{N}]*|имеются|есть)|нет|отсутств[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:нет|отсутств[\p{L}\p{N}]*|не\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:зарегистрирован[\p{L}\p{N}]*|сдава[\p{L}\p{N}]*|сдал[\p{L}\p{N}]*|сданы|внесен[\p{L}\p{N}]*|брал[\p{L}\p{N}]*|имеются|есть))\s+(?:[\p{L}\p{N}]+\s+){0,6}отпечат[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])barmak\s+yz[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:yok|hasapda\s+yok|hasab[\p{L}\p{N}]*\s+yok|hasap[\p{L}\p{N}]*\s+yok|hasaba\s+alynmadyk|hasaba\s+alyn?mady[\p{L}\p{N}]*|hasaba\s+alyn?anok|hasaba\s+alyn?an\s+dal[\p{L}\p{N}]*|bermedim|bermedik|berilmedi[\p{L}\p{N}]*|tabsyrmad[\p{L}\p{N}]*|tabsyrmady[\p{L}\p{N}]*|tabsyrman[\p{L}\p{N}]*|tabsyrylmady[\p{L}\p{N}]*|tapsyrmadym|tapsyrmadyk|tapsyrylmady[\p{L}\p{N}]*|alynmady[\p{L}\p{N}]*|alnan\s+dal[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:hasapda\s+yok|hasab[\p{L}\p{N}]*\s+yok|hasap[\p{L}\p{N}]*\s+yok|hasaba\s+alynmadyk|hasaba\s+alyn?mady[\p{L}\p{N}]*|hasaba\s+alyn?anok|hasaba\s+alyn?an\s+dal[\p{L}\p{N}]*|bermedim|bermedik|berilmedi[\p{L}\p{N}]*|tabsyrmad[\p{L}\p{N}]*|tabsyrmady[\p{L}\p{N}]*|tabsyrman[\p{L}\p{N}]*|tabsyrylmady[\p{L}\p{N}]*|tapsyrmadym|tapsyrmadyk|tapsyrylmady[\p{L}\p{N}]*|alynmady[\p{L}\p{N}]*)\s+(?:[\p{L}\p{N}]+\s+){0,6}barmak\s+yz[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:غير\s+مسجل[\p{L}\p{N}]*|ليست\s+مسجل[\p{L}\p{N}]*|ليس\s+مسجل[\p{L}\p{N}]*|لم\s+(?:تسجل|اسجل|يتم\s+تسجيل[\p{L}\p{N}]*)|لا\s+يوجد|لا\s+توجد|غير\s+موجود[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:غير\s+مسجل[\p{L}\p{N}]*|ليست\s+مسجل[\p{L}\p{N}]*|ليس\s+مسجل[\p{L}\p{N}]*|لا\s+يوجد|لا\s+توجد|ليس\s+لدي|لم\s+(?:تسجل|اسجل|يتم\s+تسجيل[\p{L}\p{N}]*))\s+(?:[\p{L}\p{N}]+\s+){0,6}(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?![\p{L}\p{N}])/u
]);

const FINGERPRINT_POSITIVE = Object.freeze([
    /(?<![\p{L}\p{N}])parmak\s+iz[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:var|kayd[\p{L}\p{N}]*\s+var|kayitli[\p{L}\p{N}]*|alindi[\p{L}\p{N}]*|alinmis[\p{L}\p{N}]*|verdim|verildi[\p{L}\p{N}]*|yaptirdim|mevcut)(?!\s+degil)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:kayitli|alinmis[\p{L}\p{N}]*|alindi[\p{L}\p{N}]*|verdim|yaptirdim)(?!\s+degil)\s+(?:[\p{L}\p{N}]+\s+){0,6}parmak\s+iz[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!no\s+|not\s+)fingerprints?(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?<!no\s+|not\s+|never\s+)(?:registered|recorded|taken|done|available|exists?)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!not\s+|never\s+|don't\s+|dont\s+|do\s+not\s+|didn't\s+|didnt\s+|did\s+not\s+|haven't\s+|have\s+not\s+)(?:registered|recorded|taken)\s+(?:[\p{L}\p{N}]+\s+){0,6}fingerprints?(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!not\s+|never\s+|don't\s+|dont\s+|do\s+not\s+|didn't\s+|didnt\s+|did\s+not\s+|doesn't\s+|doesnt\s+|does\s+not\s+|haven't\s+|have\s+not\s+)(?:have|has|got)\s+(?!to\s+)(?:[\p{L}\p{N}]+\s+){0,2}fingerprints?(?:\s+(?:registered|recorded|taken))?(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!не\s+)отпечат[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?<!не\s+)(?:зарегистрирован[\p{L}\p{N}]*|сданы|сдал[\p{L}\p{N}]*|сдавал[\p{L}\p{N}]*|есть|имеются|внесены|взяты)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!не\s+)(?:есть|имеются|зарегистрирован[\p{L}\p{N}]*|сдал[\p{L}\p{N}]*|сданы|внесены|взяты)\s+(?:[\p{L}\p{N}]+\s+){0,6}отпечат[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])barmak\s+yz[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:bar|hasab[\p{L}\p{N}]*\s+bar|hasaba\s+alyn?(?:an|dy[\p{L}\p{N}]*)|tapsyrdym|tapsyryldy|alyn?(?:an|dy[\p{L}\p{N}]*))(?!\s+dal)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:hasaba\s+alyn?(?:an|dy[\p{L}\p{N}]*)|tapsyrdym|tapsyryldy|alyn?(?:an|dy[\p{L}\p{N}]*))(?!\s+dal)\s+(?:[\p{L}\p{N}]+\s+){0,6}barmak\s+yz[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!غير\s+|ليست\s+|ليس\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?<!غير\s+|ليست\s+|ليس\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مسجل[\p{L}\p{N}]*|موجود[\p{L}\p{N}]*|تمت|تم\s+تسجيل[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?<!لم\s+|ليس\s+|ليست\s+|غير\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:لدي|عندي|سجلت|مسجل[\p{L}\p{N}]*|تم\s+تسجيل[\p{L}\p{N}]*|تمت)\s+(?:[\p{L}\p{N}]+\s+){0,6}(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?![\p{L}\p{N}])/u
]);

const YESNO_QUESTION_PARTICLES_BY_LANGUAGE = Object.freeze({
    tr: /(?<![\p{L}\p{N}])(?:mi|mu|midir|mudur|miyim|muyum|misin|musun|misiniz|musunuz|miyiz|muyuz)(?![\p{L}\p{N}])|[\p{L}\p{N}](?:mi|mu)\s*\?/u,
    tk: /(?<![\p{L}\p{N}])(?:my|mi|mydyr|midir)(?![\p{L}\p{N}])|[\p{L}\p{N}](?:my|mi|mydyr|midir)\s*\?/u,
    ru: /(?<![\p{L}\p{N}])ли(?![\p{L}\p{N}])/u,
    ar: /(?<![\p{L}\p{N}])هل(?![\p{L}\p{N}])/u
});
const ENGLISH_AUX_QUESTION_PATTERN = /^(?:(?:and|or|but)\s+)?(?:is|are|am|do|does|did|should|can|could|would|will)(?![\p{L}\p{N}])/u;
const CONDITIONAL_QUESTION_CLAUSE_PATTERN = /^(?:(?:and|or|but)\s+)?(?:whether|if|are\s+you\s+asking|do\s+you\s+mean)(?![\p{L}\p{N}])/u;
const WH_WORDS_BY_LANGUAGE = Object.freeze({
    tr: /(?<![\p{L}\p{N}])(?:ne|neler|nedir|hangi|nasil|nerede|nereden|nereye|ne\s+zaman|kac(?:ta)?)(?![\p{L}\p{N}])/u,
    en: /(?<![\p{L}\p{N}])(?:what|which|how|where|when)(?![\p{L}\p{N}])/u,
    ru: /(?<![\p{L}\p{N}])(?:что|какие|какои|как|где|куда|откуда|когда|сколько)(?![\p{L}\p{N}])/u,
    tk: /(?<![\p{L}\p{N}])(?:name|haysy|nahili|nirede|nireden|hacan|nace)(?![\p{L}\p{N}])/u,
    ar: /(?<![\p{L}\p{N}])(?:ما(?!\s+(?!ال[\p{L}\p{N}]*|(?:نوع|نتيجه|تاريخ|تكلفه|بيانات|بصم[\p{L}\p{N}]*|تعهد|اوراق|اجراءات|انواع|اسباب|اوقات|ارقام|اسماء|اسم|اقامه|ايجار|اجار|استماره|اتفاقيه|افاده|امكانيه|احجام|اماكن)(?![\p{L}\p{N}]))(?:[بتينا][\p{L}]{2,}|ساكن[\p{L}]*|عايش[\p{L}]*|قاعد[\p{L}]*|مقيم[\p{L}]*|عند[\p{L}]*|لدي[\p{L}]*|مع[\p{L}]*|سجل[\p{L}]*|تم[\p{L}]*)(?![\p{L}\p{N}]))|ماذا|اي|كيف|اين|متي|كم)(?![\p{L}\p{N}])/u
});
const TURKMEN_NON_NAME_WH_PATTERN = /(?<![\p{L}\p{N}])(?:haysy|nahili|nirede|nireden|hacan|nace)(?![\p{L}\p{N}])/u;
const NON_LIST_WH_WORD_PATTERN = /(?<![\p{L}\p{N}])(?:nedir|nasil|nerede|nereden|nereye|ne\s+zaman|kac[\p{L}\p{N}]*|how|where|when|why|what\s+is|как|где|куда|откуда|когда|сколько|почему|что\s+такое|nahili|nirede|nireden|hacan|nace|كيف|اين|متي|لماذا|كم|ما\s+هو|ما\s+هي\s+(?!المستندات|الوثايق|الاوراق|مستندات|وثايق|اوراق|المطلوب))(?![\p{L}\p{N}])/u;
const ELLIPTICAL_DOCUMENT_REQUEST_PATTERN = /(?:^(?:belge[\p{L}\p{N}]*|evrak[\p{L}\p{N}]*|dokuman[\p{L}\p{N}]*|documents?|docs?|paperwork|документ[\p{L}\p{N}]*|бумаг[\p{L}\p{N}]*|resminama[\p{L}\p{N}]*|dokument[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مستندات|وثايق|اوراق))\s+(?:for|icin|ucin|для|ل[\p{L}\p{N}]|(?:ال)?(?:تمديد|تجديد|تحويل|انتقال|طلب))|(?<![\p{L}\p{N}])(?:belge[\p{L}\p{N}]*|evrak[\p{L}\p{N}]*|dokuman[\p{L}\p{N}]*|documents?|docs?|paperwork|документ[\p{L}\p{N}]*|бумаг[\p{L}\p{N}]*|resminama[\p{L}\p{N}]*|dokument[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مستندات|وثايق|اوراق))(?:\s+(?:pls|please|lutfen))?\s*[?\u061f]$)/u;
const DOCUMENT_KEYWORD_PATTERNS = Object.freeze([
    /(?<![\p{L}\p{N}])(?:belge[\p{L}\p{N}]*|evrak[\p{L}\p{N}]*|dokuman[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:documents?|docs?|paperwork)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:документ[\p{L}\p{N}]*|бумаг[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:resminama[\p{L}\p{N}]*|dokument[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مستند[\p{L}\p{N}]*|وثايق[\p{L}\p{N}]*|وثيقه[\p{L}\p{N}]*|اوراق[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u
]);
const POLITE_REQUEST_PATTERNS_BY_LANGUAGE = Object.freeze({
    tr: /(?<![\p{L}\p{N}])(?:soyle(?:r|yebilir)\s+misin(?:iz)?|yardimci\s+ol(?:ur|abilir)\s+m[iu]s[iu]n(?:[iu]z)?|acikla(?:r|yabilir)\s+misin(?:iz)?)(?![\p{L}\p{N}])/gu,
    en: /(?<![\p{L}\p{N}])(?:can|could)\s+you\s+(?:please\s+)?(?:tell\s+me|list)(?![\p{L}\p{N}])/gu
});
const LIST_INTENT_PHRASE_PATTERNS = Object.freeze([
    /(?<![\p{L}\p{N}])(?:hangi\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:belge|evrak|dokuman)[\p{L}\p{N}]*|(?:belge|evrak|dokuman)[\p{L}\p{N}]*\s+(?:neler[\p{L}\p{N}]*|nelr[\p{L}\p{N}]*|list[\p{L}\p{N}]*)|ne(?:ler)?\s+(?:[\p{L}\p{N}]+\s+){0,3}(?:gerek[\p{L}\p{N}]*|lazim)|ne(?:ler)?\s+(?:getirmeli[\p{L}\p{N}]*|getireyim|hazirlamali[\p{L}\p{N}]*|yuklemeli[\p{L}\p{N}]*|yuklemem\s+gerek[\p{L}\p{N}]*)|(?:gerekli|gereken|istenen)\s+(?:belge|evrak|dokuman)[\p{L}\p{N}]*|lazim)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:(?:which|what)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:documents?|docs|paperwork)(?!\s+(?:format|size|types?))|what\s+(?:(?:should|do)\s+i|to)\s+(?:bring|prepare|upload|submit)|required\s+(?:documents?|docs|paperwork)|(?:documents?|docs|paperwork)\s+(?:are\s+)?(?:required|needed)|(?:document|documents|doc|docs|paperwork)\s+list|list\s+(?:of\s+|the\s+)?(?:required\s+)?(?:documents?|docs|paperwork)|do\s+i\s+need(?!\s+to\s+(?:upload|resubmit|replace|scan|convert|compress|resize)))(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:какие\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:документ|бумаг)[\p{L}\p{N}]*|список\s+(?:[\p{L}\p{N}]+\s+){0,2}документ[\p{L}\p{N}]*|необходим[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|нужн[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|документ[\p{L}\p{N}]*\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:нужн|необходим)[\p{L}\p{N}]*|что\s+(?:нужно|принести|подготовить|загрузить))(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:haysy\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:resminama|dokument)[\p{L}\p{N}]*|name\s+(?:(?:resminama|dokument)[\p{L}\p{N}]*\s+)?gerek[\p{L}\p{N}]*|name\s+(?:getirmeli|tayyarlamaly|yuklemeli)|gerekli\s+(?:resminama|dokument)[\p{L}\p{N}]*|(?:resminama|dokument)[\p{L}\p{N}]*\s+(?:gerek[\p{L}\p{N}]*|sanaw[\p{L}\p{N}]*))(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:ما\s+(?:هي\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مستندات|وثايق|اوراق|مطلوب[\p{L}\p{N}]*)|ماذا\s+(?:احضر|اجهز|ارفع)|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مستندات|وثايق|اوراق)\s+(?:ال)?(?:مطلوب[\p{L}\p{N}]*|لازم[\p{L}\p{N}]*)|قايمه\s+(?:ال)?(?:مستندات|وثايق|اوراق))(?![\p{L}\p{N}])/u
]);

const HOST_MARRIED_YES_STEMS = Object.freeze([
    'evli',
    'married',
    'wife',
    'husband',
    'spouse',
    'жена',
    'женат',
    'замуж',
    'супруг',
    'брак',
    'zhena',
    'zhenat',
    'zamuzh',
    'suprug',
    'brak',
    'oylenen',
    'durmusa cykan',
    'متزوج',
    'زوج',
    'mutazawwij'
]);

const HOST_MARRIED_NO_INHERENT_STEMS = Object.freeze([
    'bekar',
    'bosan',
    'dul',
    'single',
    'unmarried',
    'divorced',
    'widow',
    'холост',
    'неженат',
    'незамуж',
    'holost',
    'kholost',
    'nezhenat',
    'nezamuzh',
    'oylenmedik',
    'durmusa cykmadyk',
    'اعزب',
    'عزباء',
    'مطلق',
    'ارمل',
    'azab'
]);

const HOST_MARRIED_NO_STEMS = Object.freeze([
    ...HOST_MARRIED_NO_INHERENT_STEMS,
    'evli',
    'married',
    'женат',
    'замуж',
    'брак',
    'zhenat',
    'zamuzh',
    'brak',
    'oylen',
    'durmus',
    'متزوج',
    'mutazawwij'
]);

const HOST_TURKISH_YES_STEMS = Object.freeze([
    'turk',
    'tc',
    'турц',
    'турок',
    'турец',
    'турчанк',
    'turts',
    'turok',
    'turets',
    'turk rayat',
    'ترك',
    'تركي'
]);

const HOST_TURKISH_NO_INHERENT_STEMS = Object.freeze([
    'yabanci',
    'foreign',
    'иностран',
    'inostran',
    'dasary yurt',
    'اجنبي',
    'ajnabi',
    'citizen',
    'vatandas',
    'граждан',
    'гражданин',
    'grazhdan',
    'rayat',
    'مواطن',
    'muwatin'
]);

const HOST_TURKISH_NO_STEMS = Object.freeze([
    ...HOST_TURKISH_NO_INHERENT_STEMS,
    ...HOST_TURKISH_YES_STEMS
]);

const FINGERPRINT_CORE_STEMS = Object.freeze([
    'parmak',
    'finger',
    'отпечат',
    'otpechat',
    'barmak',
    'بصم',
    'basma'
]);

const RU_LATIN_FINGERPRINT_NEGATIVE_STEMS = Object.freeze([
    'ne sdaval',
    'ne sdala',
    'ne registrir'
]);

const FINGERPRINT_NEGATIVE_ONLY_STEMS = Object.freeze([
    'unregistered',
    'missing',
    'unavailable',
    'отсутств',
    'otsutstv',
    ...RU_LATIN_FINGERPRINT_NEGATIVE_STEMS,
    'alynmady',
    'alinmadi',
    'alinmamis',
    'verilmedi',
    'yaptirilmadi',
    'tapsyrylmady',
    'tabsyrylmady',
    'berilmedi',
    'bulunmuyor',
    'bulunmamakta',
    'bulunmayan',
    'olmayan'
]);

const COMMON_FINGERPRINT_NEGATIVE_ONLY_STEMS = Object.freeze(
    FINGERPRINT_NEGATIVE_ONLY_STEMS.filter((stem) => !RU_LATIN_FINGERPRINT_NEGATIVE_STEMS.includes(stem))
);

function getFingerprintNegativeOnlyStems(language = 'tr') {
    return language === 'ru' ? FINGERPRINT_NEGATIVE_ONLY_STEMS : COMMON_FINGERPRINT_NEGATIVE_ONLY_STEMS;
}

const FINGERPRINT_NOT_REGISTERED_STEMS = Object.freeze([
    ...FINGERPRINT_CORE_STEMS,
    ...FINGERPRINT_NEGATIVE_ONLY_STEMS
]);

export const QUOTED_FACT_VALUE_STEMS = Object.freeze({
    application_type: Object.freeze({
        initial: Object.freeze([
            'ilk',
            'first',
            'initial',
            'perv',
            'vperv',
            'перв',
            'вперв',
            'ilkinji',
            'ilkinj',
            'اول',
            'awal',
            'awwal',
            '1st'
        ]),
        renewal: Object.freeze([
            'uzat',
            'yenile',
            'renew',
            'exten',
            'prodl',
            'продл',
            'uzalt',
            'tazele',
            'تمديد',
            'تجديد',
            'امدد',
            'اجدد',
            'jadd',
            'tamdid',
            'tajdid'
        ]),
        transition: Object.freeze([
            'gecis',
            'gecish',
            'tur degis',
            'uytget',
            'transit',
            'switch',
            'change to student',
            'transfer',
            'perehod',
            'perekhod',
            'переход',
            'perei',
            'perey',
            'переи',
            'perevod',
            'perevod на',
            'перевод',
            'perevest',
            'перевест',
            'сменить вид',
            'смена вид',
            'ziyaret',
            'تحويل',
            'انتقال',
            'احول',
            'انقل',
            'tahwil',
            'intiqal'
        ])
    }),
    accommodation_type: Object.freeze({
        dormitory: Object.freeze([
            'yurt',
            'yurd',
            'dorm',
            'kyk',
            'hostel',
            'хостел',
            'obshag',
            'общаг',
            'общеж',
            'obshezh',
            'obshchezh',
            'umumy yasayys',
            'yasayys jay',
            'سكن طلاب',
            'سكن الطلاب',
            'سكن جامع',
            'سكن الجامع',
            'السكن الجامعي',
            'sakan jami',
            'sakan tullab'
        ]),
        rental_contract: Object.freeze([
            'kira',
            'kiral',
            'kirey',
            'rent',
            'lease',
            'arend',
            'аренд',
            'snim',
            'сним',
            'kvartir',
            'квартир',
            'договор наима',
            'dogovor naima',
            'dogovor nayma',
            'karende',
            'karend',
            'ijar',
            'ايجار',
            'اجار',
            'مستاجر',
            'استاجر'
        ]),
        own_home: Object.freeze([
            'kendi ev',
            'ev benim',
            'own home',
            'own house',
            'own flat',
            'own apartment',
            'own place',
            'my house',
            'tapu',
            'тапу',
            'title deed',
            'sobstven',
            'собствен',
            'svoei kvartir',
            'svoey kvartir',
            'своеи квартир',
            'своя квартир',
            'свое жил',
            'свои дом',
            'своем дом',
            'oz oy',
            'eyecilik',
            'ملك خاص',
            'ملكي',
            'املك',
            'مملوك',
            'طابو',
            'tabu'
        ]),
        hotel: Object.freeze([
            'otel',
            'pansiyon',
            'hotel',
            'гостиниц',
            'gostinits',
            'gostinic',
            'отел',
            'myhmanhana',
            'فندق',
            'fundu'
        ]),
        undertaking: Object.freeze([
            'taahhut',
            'undertaking',
            'host',
            'relative',
            'uncle',
            'aunt',
            'friend',
            'akraba',
            'teyze',
            'hala',
            'amca',
            'dayi',
            'arkadas',
            'tanidik',
            'tanidig',
            'aile yan',
            'родствен',
            'rodstven',
            'тет',
            'дяд',
            'друг',
            'подруг',
            'drug',
            'podrug',
            'tyot',
            'dyad',
            'обязательств',
            'obyazatelstv',
            'поручител',
            'poruchitel',
            'borcnama',
            'garyndas',
            'dayza',
            'dayy',
            'kakam',
            'dost',
            'tanys',
            'تعهد',
            'كفاله',
            'قريب',
            'خال',
            'عمي',
            'عمت',
            'عمه',
            'عند عم',
            'عند خال',
            'عند قريب',
            'عند صديق',
            'صديق',
            'taahhud'
        ]),
        residence_certificate: Object.freeze([
            'adres kayd',
            'yerlesim',
            'ikametgah',
            'residence certificate',
            'registered address',
            'address registration',
            'e-devlet',
            'edevlet',
            'справк',
            'spravk',
            'регистрац',
            'registrats',
            'адрес',
            'adres',
            'salgy',
            'sahadatnama',
            'شهاده اقامه',
            'شهاده الاقامه',
            'شهاده محل',
            'عنوان',
            'نفوس',
            'nufus'
        ])
    }),
    host_is_married: Object.freeze({
        yes: HOST_MARRIED_YES_STEMS,
        no: HOST_MARRIED_NO_STEMS
    }),
    host_is_turkish: Object.freeze({
        yes: HOST_TURKISH_YES_STEMS,
        no: HOST_TURKISH_NO_STEMS
    }),
    fingerprint_status: Object.freeze({
        registered: FINGERPRINT_CORE_STEMS,
        not_registered: FINGERPRINT_NOT_REGISTERED_STEMS
    })
});

export const EVIDENCE_PATTERN_LISTS = Object.freeze({
    NEGATION_LEXICON_BY_LANGUAGE,
    ARABIC_DIALECT_NEGATION_PARTICLE_PATTERN,
    ARABIC_MA_NON_VERB_NOUN_PATTERN,
    ARABIC_DIALECT_VERB_AFTER_MA_PATTERN,
    APPLICATION_TYPE_PATTERNS,
    TRANSITION_PEREVOD_PATTERN,
    TRANSITION_PEREVOD_CONTEXT_PATTERN,
    ACCOMMODATION_PATTERNS,
    ACCOMMODATION_CONTRAST_CORRECTION_PATTERN,
    ACCOMMODATION_MOVEOUT_PATTERN,
    FRIEND_STAY_LOCATION_PATTERNS,
    ARABIC_QARIB_PATTERN,
    ARABIC_QARIB_CONTEXT_PATTERN,
    UNDER_18_PHRASES,
    ADULT_PHRASES,
    EXPLICIT_DOUBLE_NEG_ADULT_PATTERN,
    QUOTE_AGE_CONTEXT_PATTERN,
    NUMERIC_AGE_PATTERNS,
    RUSSIAN_START_AGE_PATTERN,
    DURATION_PREFIX_WORDS,
    DURATION_SUFFIX_WORDS,
    HOST_CONTEXT_PATTERNS,
    HOST_THIRD_PERSON_PRONOUN_PATTERN,
    STUDENT_SUBJECT_PATTERN,
    FIRST_PERSON_TURKISH_PREDICATE_PATTERN,
    FIRST_PERSON_TURKISH_VERB_PATTERN,
    HOST_MARRIED_NEGATIVE,
    HOST_MARRIED_POSITIVE,
    HOST_TURKISH_NEGATIVE,
    HOST_TURKISH_POSITIVE,
    FINGERPRINT_NEGATIVE,
    FINGERPRINT_POSITIVE,
    YESNO_QUESTION_PARTICLES_BY_LANGUAGE,
    ENGLISH_AUX_QUESTION_PATTERN,
    CONDITIONAL_QUESTION_CLAUSE_PATTERN,
    WH_WORDS_BY_LANGUAGE,
    TURKMEN_NON_NAME_WH_PATTERN,
    NON_LIST_WH_WORD_PATTERN,
    ELLIPTICAL_DOCUMENT_REQUEST_PATTERN,
    DOCUMENT_KEYWORD_PATTERNS,
    POLITE_REQUEST_PATTERNS_BY_LANGUAGE,
    LIST_INTENT_PHRASE_PATTERNS,
    QUOTED_FACT_VALUE_STEMS
});

function isNegationToken(cleanToken, language = 'tr') {
    if (!cleanToken) return false;
    if (COMMON_NEGATION_TOKEN_PATTERNS.some((pattern) => pattern.test(cleanToken))) {
        return true;
    }
    if (language === 'ru' && RU_LATIN_NEGATION_PATTERNS.some((pattern) => pattern.test(cleanToken))) {
        return true;
    }
    return false;
}

function isArabicVerbLikeAfterNegation(cleanToken) {
    if (!cleanToken) return false;
    if (ARABIC_MA_NON_VERB_NOUN_PATTERN.test(cleanToken)) return false;
    return ARABIC_DIALECT_VERB_AFTER_MA_PATTERN.test(cleanToken);
}

function tokenizeClause(clauseText, language = 'tr') {
    const tokens = [];
    for (const match of clauseText.matchAll(WORD_TOKEN_PATTERN)) {
        const clean = match[0].replace(/^'+|'+$/g, '');
        tokens.push({
            raw: match[0],
            clean,
            start: match.index,
            end: match.index + match[0].length,
            isNegation: isNegationToken(clean, language),
            index: tokens.length
        });
    }
    for (let i = 0; i < tokens.length - 1; i += 1) {
        if (
            ARABIC_DIALECT_NEGATION_PARTICLE_PATTERN.test(tokens[i].clean)
            && isArabicVerbLikeAfterNegation(tokens[i + 1].clean)
        ) {
            tokens[i].isNegation = true;
        }
    }
    return tokens;
}

const DECLARATIVE_FIRST_PERSON_CLAUSE_PATTERN = /(?<![\p{L}\p{N}])(?:i\s+am|i'm|im|i\s+(?:live|stay|want|need|apply|have)|мне|живу|подаю|снимаю|galyaryn|yasayaryn|اسكن|بسكن|اقيم|بقيم|عمري)(?![\p{L}\p{N}])/u;
const ANY_YESNO_PARTICLE_PATTERN = /(?<![\p{L}\p{N}])(?:mi|mu|midir|mudur|miyim|muyum|misin|musun|misiniz|musunuz|miyiz|muyuz|my|mydyr|ли|هل)(?![\p{L}\p{N}])|[\p{L}\p{N}](?:mi|mu|my|mydyr|midir)\s*\?/u;

function hasDeclarativeFirstPersonMarker(clause) {
    if (DECLARATIVE_FIRST_PERSON_CLAUSE_PATTERN.test(clause.text)) return true;
    return clause.tokens.some(
        (t) => FIRST_PERSON_TURKISH_PREDICATE_PATTERN.test(t.clean)
            || FIRST_PERSON_TURKISH_VERB_PATTERN.test(t.clean)
    );
}

function annotateSentenceQuestionContext(clauses) {
    let sentenceStart = 0;
    for (let i = 0; i < clauses.length; i += 1) {
        const isSentenceEnd = /[.!?\n\r\u061f]$/u.test(clauses[i].text.trim()) || i === clauses.length - 1;
        if (!isSentenceEnd) continue;

        const lastClauseText = clauses[i].text.trim();
        const sentenceEndsWithQuestion = /[?\u061f]$/u.test(lastClauseText);
        let sentenceHasListIntent = false;
        for (let k = sentenceStart; k <= i; k += 1) {
            const trimmedK = clauses[k].text.trim();
            if (
                hasListIntentPhrase(trimmedK)
                || (ELLIPTICAL_DOCUMENT_REQUEST_PATTERN.test(trimmedK) && !NON_LIST_WH_WORD_PATTERN.test(trimmedK))
            ) {
                sentenceHasListIntent = true;
                break;
            }
        }
        const trailingClauseHasYesNoParticle = sentenceEndsWithQuestion
            && !sentenceHasListIntent
            && ANY_YESNO_PARTICLE_PATTERN.test(lastClauseText);

        for (let k = sentenceStart; k <= i; k += 1) {
            clauses[k].sentenceEndsWithQuestion = sentenceEndsWithQuestion;
            clauses[k].isCoordinatedYesNoClause = (
                k < i
                && trailingClauseHasYesNoParticle
                && !hasDeclarativeFirstPersonMarker(clauses[k])
            );
        }
        sentenceStart = i + 1;
    }
    return clauses;
}

/**
 * Splits normalized text into clauses keeping delimiter punctuation attached at each clause end
 * so question marks remain visible on the clause they terminate while preventing cross-clause bleed.
 */
function parseClauses(normalizedText, language = 'tr') {
    const clauses = [];
    let cursor = 0;
    const splitGlobal = new RegExp(CLAUSE_SPLIT_PATTERN.source, 'gu');
    for (const match of normalizedText.matchAll(splitGlobal)) {
        const end = match.index + match[0].length;
        const rawSlice = normalizedText.slice(cursor, end);
        const leadingTrim = rawSlice.length - rawSlice.trimStart().length;
        const text = rawSlice.trim();
        if (text) {
            const start = cursor + leadingTrim;
            clauses.push({
                text,
                start,
                end: start + text.length,
                tokens: tokenizeClause(text, language)
            });
        }
        cursor = end;
    }
    const rawTail = normalizedText.slice(cursor);
    const tailLeadingTrim = rawTail.length - rawTail.trimStart().length;
    const tail = rawTail.trim();
    if (tail) {
        const start = cursor + tailLeadingTrim;
        clauses.push({
            text: tail,
            start,
            end: start + tail.length,
            tokens: tokenizeClause(tail, language)
        });
    }
    return annotateSentenceQuestionContext(clauses);
}

function findOverlappingTokenRange(tokens, matchStart, matchEnd) {
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i].end > matchStart && tokens[i].start < matchEnd) {
            if (firstIdx === -1) firstIdx = i;
            lastIdx = i;
        }
    }
    return { firstIdx, lastIdx };
}

function hasNegationInWindow(clause, matchStart, matchEnd, ignoredSpans = []) {
    const { firstIdx, lastIdx } = findOverlappingTokenRange(clause.tokens, matchStart, matchEnd);
    if (firstIdx === -1) return false;
    const from = Math.max(0, firstIdx - NEGATION_WINDOW_WORDS);
    const to = Math.min(clause.tokens.length - 1, lastIdx + NEGATION_WINDOW_WORDS);
    for (let i = from; i <= to; i += 1) {
        const token = clause.tokens[i];
        if (!token.isNegation) continue;
        const insideIgnored = ignoredSpans.some(
            (span) => token.end > span.start && token.start < span.end
        );
        if (!insideIgnored) return true;
    }
    return false;
}

function hasWhQuestionWord(clauseText, language = 'tr') {
    for (const [lang, pattern] of Object.entries(WH_WORDS_BY_LANGUAGE)) {
        if (lang === 'tk' && language !== 'tk') {
            if (TURKMEN_NON_NAME_WH_PATTERN.test(clauseText)) return true;
            continue;
        }
        if (pattern.test(clauseText)) return true;
    }
    return false;
}

function hasListIntentPhrase(clauseText) {
    return LIST_INTENT_PHRASE_PATTERNS.some((pattern) => pattern.test(clauseText));
}

function isYesNoQuestionClause(clauseText, language = 'tr', clause = null) {
    if (clause?.isCoordinatedYesNoClause) return true;
    const hasWhOrList = hasWhQuestionWord(clauseText, language) || hasListIntentPhrase(clauseText);
    let candidate = clauseText;
    if (hasWhOrList) {
        const politePattern = POLITE_REQUEST_PATTERNS_BY_LANGUAGE[language];
        if (politePattern) {
            candidate = clauseText.replace(new RegExp(politePattern.source, 'gu'), ' ');
        }
    }
    const particlePattern = YESNO_QUESTION_PARTICLES_BY_LANGUAGE[language];
    if (particlePattern && particlePattern.test(candidate)) return true;
    const trimmed = candidate.trim();
    if (CONDITIONAL_QUESTION_CLAUSE_PATTERN.test(trimmed)) return true;
    const inQuestionSentence = /[?\u061f]$/u.test(trimmed) || Boolean(clause?.sentenceEndsWithQuestion);
    return inQuestionSentence && ENGLISH_AUX_QUESTION_PATTERN.test(trimmed);
}

function isQuestionClause(clauseText, language = 'tr', clause = null) {
    if (isYesNoQuestionClause(clauseText, language, clause)) return true;
    const trimmed = clauseText.trim();
    const endsWithQuestion = /[?\u061f]$/u.test(trimmed);
    const isWhClauseInQuestionSentence = Boolean(clause?.sentenceEndsWithQuestion) && hasWhQuestionWord(trimmed, language);
    if (!endsWithQuestion && !isWhClauseInQuestionSentence) return false;
    if (hasListIntentPhrase(trimmed)) return false;
    if (ELLIPTICAL_DOCUMENT_REQUEST_PATTERN.test(trimmed) && !NON_LIST_WH_WORD_PATTERN.test(trimmed)) return false;
    return true;
}

function findAllMatches(text, patterns) {
    const matches = [];
    for (const pattern of patterns) {
        const globalFlags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
        const regex = new RegExp(pattern.source, globalFlags);
        for (const match of text.matchAll(regex)) {
            matches.push({
                text: match[0],
                group1: match[1],
                start: match.index,
                end: match.index + match[0].length
            });
        }
    }
    return matches;
}

function detectApplicationType(clauses, language) {
    const positiveKeys = new Set();
    const negatedKeys = new Set();
    let questioned = false;

    for (const clause of clauses) {
        const isQuestion = isQuestionClause(clause.text, language, clause);
        for (const [key, patterns] of Object.entries(APPLICATION_TYPE_PATTERNS)) {
            const matches = findAllMatches(clause.text, patterns);
            if (key === 'transition' && TRANSITION_PEREVOD_CONTEXT_PATTERN.test(clause.text)) {
                matches.push(...findAllMatches(clause.text, [TRANSITION_PEREVOD_PATTERN]));
            }
            for (const match of matches) {
                if (isQuestion) {
                    questioned = true;
                } else if (hasNegationInWindow(clause, match.start, match.end)) {
                    negatedKeys.add(key);
                } else {
                    positiveKeys.add(key);
                }
            }
        }
    }

    if (questioned) {
        return { value: undefined, uncertain: true };
    }
    const effectivePositiveKeys = [...positiveKeys].filter((key) => !negatedKeys.has(key));
    if (effectivePositiveKeys.length === 1) {
        return { value: effectivePositiveKeys[0], uncertain: false };
    }
    if (effectivePositiveKeys.length > 1 || negatedKeys.size > 0) {
        return { value: undefined, uncertain: true };
    }
    return { value: undefined, uncertain: false };
}

function detectAccommodationType(clauses, language) {
    const positiveKeys = new Set();
    const negatedKeys = new Set();
    let questioned = false;
    let retractedOrMovedOut = false;

    const turnHasFriendStayLocation = new Set();
    for (const clause of clauses) {
        if (findAllMatches(clause.text, FRIEND_STAY_LOCATION_PATTERNS).length > 0) {
            turnHasFriendStayLocation.add(clause.turnIndex ?? 0);
        }
    }

    for (let i = 0; i < clauses.length; i += 1) {
        const clause = clauses[i];
        const turnIndex = clause.turnIndex ?? 0;
        const nextClauseInTurn = (i + 1 < clauses.length && (clauses[i + 1].turnIndex ?? 0) === turnIndex)
            ? clauses[i + 1]
            : null;
        const isQuestion = isQuestionClause(clause.text, language, clause);
        const hostNegSpans = [
            ...findAllMatches(clause.text, HOST_MARRIED_NEGATIVE),
            ...findAllMatches(clause.text, HOST_TURKISH_NEGATIVE)
        ];

        for (const [key, patterns] of Object.entries(ACCOMMODATION_PATTERNS)) {
            const matches = findAllMatches(clause.text, patterns);
            if (key === 'undertaking' && ARABIC_QARIB_CONTEXT_PATTERN.test(clause.text)) {
                matches.push(...findAllMatches(clause.text, [ARABIC_QARIB_PATTERN]));
            }
            for (const match of matches) {
                const ignoredSpans = key === 'undertaking' ? hostNegSpans : [];
                if (isQuestion) {
                    questioned = true;
                } else if (hasNegationInWindow(clause, match.start, match.end, ignoredSpans)) {
                    negatedKeys.add(key);
                } else {
                    const tailInClause = clause.text.slice(match.end);
                    const nextText = nextClauseInTurn ? nextClauseInTurn.text : '';
                    const hasContrastOrMoveOut = (
                        ACCOMMODATION_CONTRAST_CORRECTION_PATTERN.test(tailInClause)
                        || ACCOMMODATION_CONTRAST_CORRECTION_PATTERN.test(nextText)
                        || ACCOMMODATION_MOVEOUT_PATTERN.test(clause.text)
                        || ACCOMMODATION_MOVEOUT_PATTERN.test(nextText)
                        || (key !== 'undertaking' && turnHasFriendStayLocation.has(turnIndex))
                    );
                    if (hasContrastOrMoveOut) {
                        retractedOrMovedOut = true;
                    } else {
                        positiveKeys.add(key);
                    }
                }
            }
        }
    }

    if (questioned || retractedOrMovedOut) {
        return { value: undefined, uncertain: true };
    }
    const effectivePositiveKeys = [...positiveKeys].filter((key) => !negatedKeys.has(key));
    if (effectivePositiveKeys.length === 1) {
        return { value: effectivePositiveKeys[0], uncertain: false };
    }
    if (effectivePositiveKeys.length > 1 || negatedKeys.size > 0) {
        return { value: undefined, uncertain: true };
    }
    return { value: undefined, uncertain: false };
}

function isDurationNumericMatch(clause, matchStart, matchEnd) {
    const { firstIdx, lastIdx } = findOverlappingTokenRange(clause.tokens, matchStart, matchEnd);
    if (firstIdx === -1) return false;
    const prefixStart = Math.max(0, firstIdx - 3);
    for (let i = prefixStart; i < firstIdx; i += 1) {
        const clean = clause.tokens[i].clean;
        if (clean === 'уже' && i > 0 && /^(?:мне|mne|mnye)$/u.test(clause.tokens[i - 1].clean)) {
            continue;
        }
        if (DURATION_PREFIX_WORDS.some((p) => p.test(clean))) {
            return true;
        }
    }
    const suffixEnd = Math.min(clause.tokens.length - 1, lastIdx + 2);
    for (let i = lastIdx + 1; i <= suffixEnd; i += 1) {
        if (DURATION_SUFFIX_WORDS.some((p) => p.test(clause.tokens[i].clean))) {
            return true;
        }
    }
    return false;
}

function maskSpans(text, spans) {
    let masked = text;
    for (const span of spans) {
        masked = masked.slice(0, span.start) + ' '.repeat(span.end - span.start) + masked.slice(span.end);
    }
    return masked;
}

const CONDITIONAL_AGE_PREFIX_PATTERN = /(?<![\p{L}\p{N}])(?:if|whether)(?:\s+(?:you\s+are|i\s+am|i'm|im|a\s+student\s+is|student\s+is))?\s*$/u;

function isConditionalAgeMatch(clauseText, matchStart) {
    return CONDITIONAL_AGE_PREFIX_PATTERN.test(clauseText.slice(0, matchStart));
}

function detectUnder18(clauses, language) {
    let under18Matched = false;
    let adultMatched = false;
    let uncertain = false;

    for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
        const clause = clauses[clauseIndex];
        const isQuestion = isQuestionClause(clause.text, language, clause);

        const adultMatches = findAllMatches(clause.text, ADULT_PHRASES);
        for (const match of adultMatches) {
            if (
                hasNegationInWindow(clause, match.start, match.end, [match])
                || isQuestion
                || isConditionalAgeMatch(clause.text, match.start)
            ) {
                uncertain = true;
            } else {
                adultMatched = true;
            }
        }

        // Mask adult phrases before minor/numeric checks so negated-minor phrases (e.g. "not under 18")
        // are not re-matched as under-18 or age=18.
        const textWithoutAdult = maskSpans(clause.text, adultMatches);

        const under18Matches = findAllMatches(textWithoutAdult, UNDER_18_PHRASES);
        const explicitMinorSpans = under18Matches.filter((match) =>
            /(?<![\p{L}\p{N}])(?:resit\s+degil|несовершеннолет|kamillik\s*yasyna\s*yetmedik)/u.test(match.text)
        );
        for (const match of under18Matches) {
            const isExplicitMinor = explicitMinorSpans.includes(match);
            if (
                (!isExplicitMinor && hasNegationInWindow(clause, match.start, match.end, explicitMinorSpans))
                || isQuestion
                || isConditionalAgeMatch(clause.text, match.start)
            ) {
                uncertain = true;
            } else {
                under18Matched = true;
            }
        }

        const maskedText = maskSpans(textWithoutAdult, under18Matches);
        const numericMatches = findAllMatches(maskedText, NUMERIC_AGE_PATTERNS);
        if (clauseIndex === 0 && numericMatches.length === 0) {
            numericMatches.push(...findAllMatches(maskedText, [RUSSIAN_START_AGE_PATTERN]));
        }

        for (const match of numericMatches) {
            const parsed = Number.parseInt(match.group1, 10);
            if (!Number.isInteger(parsed) || parsed < 14 || parsed > 99) continue;
            if (isDurationNumericMatch(clause, match.start, match.end)) continue;
            if (
                hasNegationInWindow(clause, match.start, match.end)
                || isQuestion
                || isConditionalAgeMatch(clause.text, match.start)
            ) {
                uncertain = true;
            } else if (parsed < 18) {
                under18Matched = true;
            } else {
                adultMatched = true;
            }
        }
    }

    if (uncertain || (under18Matched && adultMatched)) {
        return { value: undefined, uncertain: true };
    }
    if (under18Matched) return { value: true, uncertain: false };
    if (adultMatched) return { value: false, uncertain: false };
    return { value: undefined, uncertain: false };
}

const STEM_REGEX_CACHE = new Map();

function getStemTokenStartRegex(stem) {
    let cached = STEM_REGEX_CACHE.get(stem);
    if (cached) return cached;
    const parts = stem.trim().split(/\s+/u).map((part) => {
        const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (/^[\u0600-\u06ff]/u.test(part)) {
            return `(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?${escaped}`;
        }
        if (part === 'yurt') {
            return `${escaped}(?!disi)`;
        }
        return escaped;
    });
    cached = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\p{L}\\p{N}]*\\s+')}`, 'u');
    STEM_REGEX_CACHE.set(stem, cached);
    return cached;
}

function hasStemFromList(normalizedText, stems) {
    return stems.some((stem) => getStemTokenStartRegex(stem).test(normalizedText));
}

function clauseHasHostFactSignal(clauseText) {
    return (
        findAllMatches(clauseText, HOST_MARRIED_NEGATIVE).length > 0
        || findAllMatches(clauseText, HOST_MARRIED_POSITIVE).length > 0
        || findAllMatches(clauseText, HOST_TURKISH_NEGATIVE).length > 0
        || findAllMatches(clauseText, HOST_TURKISH_POSITIVE).length > 0
        || hasStemFromList(clauseText, HOST_MARRIED_NO_STEMS)
        || hasStemFromList(clauseText, HOST_MARRIED_YES_STEMS)
        || hasStemFromList(clauseText, HOST_TURKISH_NO_STEMS)
        || hasStemFromList(clauseText, HOST_TURKISH_YES_STEMS)
    );
}

function clauseHasExplicitStudentSelfMarker(clause) {
    if (findAllMatches(clause.text, [STUDENT_SUBJECT_PATTERN]).length > 0) {
        return true;
    }
    return clause.tokens.some(
        (t) => FIRST_PERSON_TURKISH_PREDICATE_PATTERN.test(t.clean)
            || FIRST_PERSON_TURKISH_VERB_PATTERN.test(t.clean)
    );
}

function annotateTurnHostContext(turnClauses, prevTurnHasDirectHost = false) {
    let seenDirectHostInTurn = false;
    for (let i = 0; i < turnClauses.length; i += 1) {
        const clause = turnClauses[i];
        const directHostMatches = findAllMatches(clause.text, HOST_CONTEXT_PATTERNS);
        const pronounMatches = findAllMatches(clause.text, [HOST_THIRD_PERSON_PRONOUN_PATTERN]);
        const validPronounMatches = pronounMatches.filter((m) => {
            if (seenDirectHostInTurn || (directHostMatches.length > 0 && m.start > directHostMatches[0].start)) {
                return true;
            }
            if (prevTurnHasDirectHost) {
                return clauseHasHostFactSignal(clause.text) && !clauseHasExplicitStudentSelfMarker(clause);
            }
            return false;
        });
        clause.directHostMatches = directHostMatches;
        clause.hostMatches = [...directHostMatches, ...validPronounMatches].sort((a, b) => a.start - b.start);
        if (directHostMatches.length > 0) {
            seenDirectHostInTurn = true;
        }
    }
    const turnAnchorMatch = turnClauses.find((c) => c.hostMatches.length > 0)?.hostMatches[0] || null;
    if (prevTurnHasDirectHost && !seenDirectHostInTurn && turnAnchorMatch) {
        for (const clause of turnClauses) {
            if (
                clause.hostMatches.length === 0
                && clauseHasHostFactSignal(clause.text)
                && !clauseHasExplicitStudentSelfMarker(clause)
                && /^(?:нет|да|evet|hayir|yok|yes|no|hawa|نعم|لا)(?![\p{L}\p{N}])/u.test(clause.text.trim())
            ) {
                clause.hostMatches = [{ ...turnAnchorMatch, start: -1, end: -1 }];
            }
        }
    }
    for (let i = 0; i < turnClauses.length; i += 1) {
        turnClauses[i].prevClauseHasHostContext = i > 0 && (
            turnClauses[i - 1].directHostMatches.length > 0
            || (seenDirectHostInTurn && turnClauses[i - 1].hostMatches.length > 0)
        );
    }
    return turnClauses;
}

function parseTurnsIntoClauses(turns, language = 'tr') {
    const allClauses = [];
    let prevTurnHasDirectHost = false;
    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
        const normalizedTurn = normalizeForEvidence(turns[turnIndex]);
        const turnClauses = annotateTurnHostContext(parseClauses(normalizedTurn, language), prevTurnHasDirectHost);
        for (const clause of turnClauses) {
            clause.turnIndex = turnIndex;
            allClauses.push(clause);
        }
        prevTurnHasDirectHost = turnClauses.some((clause) => clause.directHostMatches.length > 0);
    }
    return allClauses;
}

function isStudentSelfDescriptionClause(clause) {
    if (Array.isArray(clause.hostMatches) && clause.hostMatches.length > 0) {
        return false;
    }
    return clauseHasExplicitStudentSelfMarker(clause);
}

function isStudentSelfPredicate(clause, matchStart, matchEnd, matchText, hostMatches = clause.hostMatches || []) {
    const tokensInMatch = tokenizeClause(matchText);
    if (tokensInMatch.some((t) => FIRST_PERSON_TURKISH_PREDICATE_PATTERN.test(t.clean))) {
        return true;
    }
    const { firstIdx, lastIdx } = findOverlappingTokenRange(clause.tokens, matchStart, matchEnd);
    if (firstIdx !== -1) {
        const checkTo = Math.min(clause.tokens.length - 1, lastIdx + 1);
        for (let i = firstIdx; i <= checkTo; i += 1) {
            const clean = clause.tokens[i].clean;
            if (i <= lastIdx && FIRST_PERSON_TURKISH_PREDICATE_PATTERN.test(clean)) {
                return true;
            }
            if (i === lastIdx + 1 && clean === 'degilim') {
                return true;
            }
        }
    }
    if (hostMatches.length === 0 && isStudentSelfDescriptionClause(clause)) {
        return true;
    }
    const studentMatches = findAllMatches(clause.text, [STUDENT_SUBJECT_PATTERN])
        .filter((s) => !hostMatches.some((h) => s.start >= h.start && s.end <= h.end))
        .filter((s) => s.start < matchEnd);
    if (studentMatches.length === 0) return false;
    const latestStudent = studentMatches[studentMatches.length - 1];
    const hasInterveningHost = hostMatches.some(
        (h) => h.end > latestStudent.start && h.start < matchEnd
    );
    return !hasInterveningHost;
}

function isPositiveMatchCoveredByNegative(match, negMatches) {
    // Require matching end offset so an embedded positive sub-match (e.g. "kayıtlı" in
    // "kayıtlı olmayan parmak izim", or "в браке" in "не состоит в браке") is ignored,
    // while a separate earlier positive statement inside a greedy {0,6} span still conflicts.
    return negMatches.some((neg) => match.start >= neg.start && match.end === neg.end);
}

function detectHostFacts(clauses, language) {
    let marriedYes = false;
    let marriedNo = false;
    let marriedUncertain = false;
    let turkishYes = false;
    let turkishNo = false;
    let turkishUncertain = false;

    for (const clause of clauses) {
        const hostMatches = clause.hostMatches ?? findAllMatches(clause.text, HOST_CONTEXT_PATTERNS);
        if (hostMatches.length === 0) continue;

        const isQuestion = isQuestionClause(clause.text, language, clause);
        const marriedNegMatches = findAllMatches(clause.text, HOST_MARRIED_NEGATIVE);
        const turkishNegMatches = findAllMatches(clause.text, HOST_TURKISH_NEGATIVE);

        const activeMarriedNegMatches = [];
        for (const match of marriedNegMatches) {
            if (isStudentSelfPredicate(clause, match.start, match.end, match.text, hostMatches)) continue;
            activeMarriedNegMatches.push(match);
            if (isQuestion) marriedUncertain = true;
            else marriedNo = true;
        }
        for (const match of findAllMatches(clause.text, HOST_MARRIED_POSITIVE)) {
            if (isStudentSelfPredicate(clause, match.start, match.end, match.text, hostMatches)) continue;
            if (isPositiveMatchCoveredByNegative(match, activeMarriedNegMatches)) continue;
            if (isQuestion || hasNegationInWindow(clause, match.start, match.end, turkishNegMatches)) {
                marriedUncertain = true;
            } else {
                marriedYes = true;
            }
        }

        const activeTurkishNegMatches = [];
        for (const match of turkishNegMatches) {
            if (isStudentSelfPredicate(clause, match.start, match.end, match.text, hostMatches)) continue;
            activeTurkishNegMatches.push(match);
            if (isQuestion) turkishUncertain = true;
            else turkishNo = true;
        }
        for (const match of findAllMatches(clause.text, HOST_TURKISH_POSITIVE)) {
            if (isStudentSelfPredicate(clause, match.start, match.end, match.text, hostMatches)) continue;
            if (isPositiveMatchCoveredByNegative(match, activeTurkishNegMatches)) continue;
            if (isQuestion || hasNegationInWindow(clause, match.start, match.end, marriedNegMatches)) {
                turkishUncertain = true;
            } else {
                turkishYes = true;
            }
        }
    }

    const resolve = (yes, no, uncertain) => {
        if (uncertain || (yes && no)) return { value: undefined, uncertain: true };
        if (no) return { value: 'no', uncertain: false };
        if (yes) return { value: 'yes', uncertain: false };
        return { value: undefined, uncertain: false };
    };

    return {
        married: resolve(marriedYes, marriedNo, marriedUncertain),
        turkish: resolve(turkishYes, turkishNo, turkishUncertain)
    };
}

function detectFingerprintStatus(clauses, language) {
    let negativeMatched = false;
    let positiveMatched = false;
    let uncertain = false;

    for (const clause of clauses) {
        const isQuestion = isQuestionClause(clause.text, language, clause);
        const negMatches = findAllMatches(clause.text, FINGERPRINT_NEGATIVE);
        const posMatches = findAllMatches(clause.text, FINGERPRINT_POSITIVE);

        if (negMatches.length > 0) {
            if (isQuestion) uncertain = true;
            else negativeMatched = true;
        }
        for (const match of posMatches) {
            if (isPositiveMatchCoveredByNegative(match, negMatches)) continue;
            if (isQuestion) {
                uncertain = true;
            } else if (hasNegationInWindow(clause, match.start, match.end)) {
                // Negated positive phrasing (e.g. "are not yet registered") must not trigger conflict if negative matched.
                if (negMatches.length === 0) uncertain = true;
            } else {
                positiveMatched = true;
            }
        }
    }

    if (uncertain || (negativeMatched && positiveMatched)) {
        return { value: undefined, uncertain: true };
    }
    if (negativeMatched) return { value: 'not_registered', uncertain: false };
    if (positiveMatched) return { value: 'registered', uncertain: false };
    return { value: undefined, uncertain: false };
}

function attachUncertainKey(target, uncertainKeys) {
    Object.defineProperty(target, '__uncertain', {
        value: uncertainKeys,
        enumerable: false,
        configurable: true,
        writable: true
    });
    return target;
}

/**
 * Extracts only the document-policy facts clearly supported by the student's own user turns.
 * Conservative by design: ambiguous, negated, or questioned facts are omitted and listed on
 * the non-enumerable `__uncertain` property so the server asks instead of guessing.
 * @param {string[]|string} userTurns All user turn contents in chronological order.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {object} Supported subset of `get_required_documents` arguments with non-enumerable `__uncertain`.
 */
export function extractSupportedDocumentFacts(userTurns, language = 'tr') {
    const resolvedLanguage = CHATBOT_LANGUAGES.includes(language) ? language : 'tr';
    const turns = Array.isArray(userTurns)
        ? userTurns.filter((item) => typeof item === 'string')
        : (typeof userTurns === 'string' ? [userTurns] : []);
    if (turns.length === 0) return attachUncertainKey({}, []);

    // Parse clauses per turn so adjacency and pronoun-host-context rules never bridge across separate turns.
    const clauses = parseTurnsIntoClauses(turns, resolvedLanguage);

    const supported = {};
    const uncertain = [];

    const applicationType = detectApplicationType(clauses, resolvedLanguage);
    if (applicationType.uncertain) uncertain.push('application_type');
    else if (applicationType.value) supported.application_type = applicationType.value;

    const isUnder18 = detectUnder18(clauses, resolvedLanguage);
    if (isUnder18.uncertain) uncertain.push('is_under_18');
    else if (typeof isUnder18.value === 'boolean') supported.is_under_18 = isUnder18.value;

    const accommodationType = detectAccommodationType(clauses, resolvedLanguage);
    if (accommodationType.uncertain) uncertain.push('accommodation_type');
    else if (accommodationType.value) supported.accommodation_type = accommodationType.value;

    const hostFacts = detectHostFacts(clauses, resolvedLanguage);
    if (hostFacts.married.uncertain) uncertain.push('host_is_married');
    else if (hostFacts.married.value) supported.host_is_married = hostFacts.married.value;

    if (hostFacts.turkish.uncertain) uncertain.push('host_is_turkish');
    else if (hostFacts.turkish.value) supported.host_is_turkish = hostFacts.turkish.value;

    const fingerprintStatus = detectFingerprintStatus(clauses, resolvedLanguage);
    if (fingerprintStatus.uncertain) uncertain.push('fingerprint_status');
    else if (fingerprintStatus.value) supported.fingerprint_status = fingerprintStatus.value;

    return attachUncertainKey(supported, uncertain);
}

/**
 * Returns true when the student turns contain any negation word from the evidence lexicons
 * anywhere in the text, or when `extractSupportedDocumentFacts` flagged any `__uncertain` fact.
 * @param {string[]|string} userTurns All user turn contents in chronological order.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {boolean} True if evidence carries negation or uncertainty risk.
 */
export function hasEvidenceRisk(userTurns, language = 'tr') {
    const resolvedLanguage = CHATBOT_LANGUAGES.includes(language) ? language : 'tr';
    const turns = Array.isArray(userTurns)
        ? userTurns.filter((item) => typeof item === 'string')
        : (typeof userTurns === 'string' ? [userTurns] : []);
    if (turns.length === 0) return false;

    const supported = extractSupportedDocumentFacts(turns, resolvedLanguage);
    if (Array.isArray(supported.__uncertain) && supported.__uncertain.length > 0) {
        return true;
    }

    const normalizedText = turns.map(normalizeForEvidence).join('\n');
    const tokens = tokenizeClause(normalizedText, resolvedLanguage);
    return tokens.some((token) => token.isNegation);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

const VALID_FACT_CHECKS = Object.freeze({
    application_type: (v) => typeof v === 'string' && TOOL_APPLICATION_TYPES.includes(v),
    is_under_18: (v) => typeof v === 'boolean',
    accommodation_type: (v) => typeof v === 'string' && ACCOMMODATION_TYPES.includes(v),
    host_is_married: (v) => typeof v === 'string' && DOCUMENT_ANSWER_OPTIONS.host_is_married.includes(v),
    host_is_turkish: (v) => typeof v === 'string' && DOCUMENT_ANSWER_OPTIONS.host_is_turkish.includes(v),
    fingerprint_status: (v) => typeof v === 'string' && FINGERPRINT_STATUSES.includes(v)
});

const POSITIVE_VALUED_DOCUMENT_FACTS = Object.freeze({
    application_type: () => true,
    accommodation_type: () => true,
    fingerprint_status: (v) => v === 'registered',
    host_is_married: (v) => v === 'yes',
    host_is_turkish: (v) => v === 'yes',
    is_under_18: (v) => v === true
});

const QUOTE_MAX_CHARS = 160;

function verifyUnder18QuoteContent(normalizedQuote, quoteTokens, value) {
    for (let i = 0; i < quoteTokens.length; i += 1) {
        const clean = quoteTokens[i].clean;
        if (clean === 'уже' && i > 0 && /^(?:мне|mne|mnye)$/u.test(quoteTokens[i - 1].clean)) {
            continue;
        }
        if (
            DURATION_PREFIX_WORDS.some((p) => p.test(clean))
            || DURATION_SUFFIX_WORDS.some((p) => p.test(clean))
            || /^(?:назад|спустя|подряд)$/u.test(clean)
        ) {
            return false;
        }
    }

    const adultMatches = findAllMatches(normalizedQuote, ADULT_PHRASES);
    const textWithoutAdult = maskSpans(normalizedQuote, adultMatches);
    const under18Matches = findAllMatches(textWithoutAdult, UNDER_18_PHRASES);
    const textForNumbers = maskSpans(textWithoutAdult, under18Matches);

    let hasMinorAgeNumber = false;
    let hasAdultAgeNumber = false;
    const numericPatternMatches = findAllMatches(textForNumbers, [...NUMERIC_AGE_PATTERNS, RUSSIAN_START_AGE_PATTERN]);
    for (const match of numericPatternMatches) {
        const parsed = Number.parseInt(match.group1, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) continue;
        if (parsed < 18) hasMinorAgeNumber = true;
        else hasAdultAgeNumber = true;
    }

    if (QUOTE_AGE_CONTEXT_PATTERN.test(textForNumbers)) {
        for (const match of textForNumbers.matchAll(/(?<![\p{L}\p{N}])(\d+)(?![\p{L}\p{N}])/gu)) {
            const parsed = Number.parseInt(match[1], 10);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) continue;
            if (parsed < 18) {
                hasMinorAgeNumber = true;
            } else {
                hasAdultAgeNumber = true;
            }
        }
    }

    const hasMinorSignal = under18Matches.length > 0 || hasMinorAgeNumber;
    const hasAdultSignal = adultMatches.length > 0 || hasAdultAgeNumber;
    if (hasMinorSignal && hasAdultSignal) return false;
    return value === true ? hasMinorSignal : hasAdultSignal;
}

function hasRelevantQuoteStem(fact, value, normalizedQuote, language = 'tr') {
    if (!Object.hasOwn(QUOTED_FACT_VALUE_STEMS, fact)) return true;
    const stemsByValue = QUOTED_FACT_VALUE_STEMS[fact];
    const stems = stemsByValue?.[value];
    if (!Array.isArray(stems) || stems.length === 0) return false;
    if (fact === 'fingerprint_status' && !hasStemFromList(normalizedQuote, FINGERPRINT_CORE_STEMS)) {
        return false;
    }
    return stems.some((stem) => {
        if (
            fact === 'fingerprint_status'
            && value === 'not_registered'
            && language !== 'ru'
            && RU_LATIN_FINGERPRINT_NEGATIVE_STEMS.includes(stem)
        ) {
            return false;
        }
        if (
            fact === 'application_type'
            && value === 'transition'
            && (stem === 'перевод' || stem === 'perevod' || stem === 'perevod на')
            && !TRANSITION_PEREVOD_CONTEXT_PATTERN.test(normalizedQuote)
        ) {
            return false;
        }
        return getStemTokenStartRegex(stem).test(normalizedQuote);
    });
}

function getQuoteNegationIgnoredSpans(fact, value, clauseText) {
    if (fact === 'accommodation_type' && value === 'undertaking') {
        return [
            ...findAllMatches(clauseText, HOST_MARRIED_NEGATIVE),
            ...findAllMatches(clauseText, HOST_TURKISH_NEGATIVE)
        ];
    }
    if (fact === 'host_is_married' && value === 'yes') {
        return findAllMatches(clauseText, HOST_TURKISH_NEGATIVE);
    }
    if (fact === 'host_is_turkish' && value === 'yes') {
        return findAllMatches(clauseText, HOST_MARRIED_NEGATIVE);
    }
    if (fact === 'is_under_18' && value === true) {
        return findAllMatches(clauseText, [
            /(?<![\p{L}\p{N}])(?:resit\s+degil[\p{L}\p{N}]*|несовершеннолет[\p{L}\p{N}]*|kamillik\s*yasyna\s*yetmedik[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u
        ]);
    }
    if (fact === 'is_under_18' && value === false) {
        return findAllMatches(clauseText, [EXPLICIT_DOUBLE_NEG_ADULT_PATTERN]);
    }
    return [];
}

/**
 * Verifies a model-supplied document fact against the student's own user turns using a verbatim quote.
 * Never logs quotes or message content.
 * @param {string} fact Document fact key (`application_type`, `is_under_18`, `accommodation_type`, `host_is_married`, `host_is_turkish`, `fingerprint_status`).
 * @param {unknown} value Candidate fact value.
 * @param {unknown} quote Verbatim substring copied from the student's own messages (max 160 chars).
 * @param {string[]|string} userTurns All user turn contents in chronological order (excluding assistant turns).
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {boolean} True when the quote and value pass all verification rules.
 */
export function verifyQuotedFact(fact, value, quote, userTurns, language = 'tr') {
    if (typeof fact !== 'string' || !Object.hasOwn(VALID_FACT_CHECKS, fact)) return false;
    if (!VALID_FACT_CHECKS[fact](value)) return false;
    if (typeof quote !== 'string') return false;
    const trimmedRawQuote = quote.trim();
    if (!trimmedRawQuote || [...quote].length > QUOTE_MAX_CHARS) return false;

    const resolvedLanguage = CHATBOT_LANGUAGES.includes(language) ? language : 'tr';
    const turns = Array.isArray(userTurns)
        ? userTurns.filter((item) => typeof item === 'string')
        : (typeof userTurns === 'string' ? [userTurns] : []);
    if (turns.length === 0) return false;

    const normalizedQuote = normalizeForEvidence(trimmedRawQuote).trim();
    if ([...normalizedQuote].length < 2) return false;
    const quoteTokens = tokenizeClause(normalizedQuote, resolvedLanguage);
    if (quoteTokens.length === 0) return false;

    // Rule d: Lexicon veto — reject if extractSupportedDocumentFacts has a different value or lists the fact in __uncertain.
    const supported = extractSupportedDocumentFacts(turns, resolvedLanguage);
    const uncertainKeys = Array.isArray(supported.__uncertain) ? supported.__uncertain : [];
    if (uncertainKeys.includes(fact)) return false;
    if (Object.hasOwn(supported, fact) && supported[fact] !== undefined && supported[fact] !== value) {
        return false;
    }

    // Rule c: is_under_18 must contain an age number 1-99 with age context consistent with value or a lexicon minor/adult phrase, and no duration words.
    if (fact === 'is_under_18' && !verifyUnder18QuoteContent(normalizedQuote, quoteTokens, value)) {
        return false;
    }

    // Rule f: for non-age facts, the normalized quote must contain at least one stem at token start associated with the claimed value.
    if (fact !== 'is_under_18' && !hasRelevantQuoteStem(fact, value, normalizedQuote, resolvedLanguage)) {
        return false;
    }

    const isPositiveValued = POSITIVE_VALUED_DOCUMENT_FACTS[fact](value);
    const isHostFact = fact === 'host_is_married' || fact === 'host_is_turkish';
    const isFingerprintFact = fact === 'fingerprint_status';
    const fpNegativeOnlyStems = getFingerprintNegativeOnlyStems(resolvedLanguage);

    const normalizedTurns = turns.map(normalizeForEvidence);
    const turnHasDirectHostFlags = normalizedTurns.map(
        (normalizedTurn) => findAllMatches(normalizedTurn, HOST_CONTEXT_PATTERNS).length > 0
    );

    // Rule a, b, c (clause duration), e (yes/no question), g (host context & student self-description):
    // quote must occur in normalized user turns and pass clause checks.
    for (let turnIndex = 0; turnIndex < normalizedTurns.length; turnIndex += 1) {
        const normalizedTurn = normalizedTurns[turnIndex];
        if (!normalizedTurn.includes(normalizedQuote)) continue;

        const prevTurnHasDirectHost = turnIndex > 0 && turnHasDirectHostFlags[turnIndex - 1];
        const clauses = annotateTurnHostContext(parseClauses(normalizedTurn, resolvedLanguage), prevTurnHasDirectHost);
        let searchFrom = 0;
        while (searchFrom <= normalizedTurn.length - normalizedQuote.length) {
            const quoteStart = normalizedTurn.indexOf(normalizedQuote, searchFrom);
            if (quoteStart === -1) break;
            const quoteEnd = quoteStart + normalizedQuote.length;
            searchFrom = quoteStart + 1;

            const overlappingClauses = clauses.filter(
                (clause) => clause.end > quoteStart && clause.start < quoteEnd
            );
            if (overlappingClauses.length === 0) continue;

            let tokenClauseCount = 0;
            let hostStemClauseCount = 0;
            let fingerprintStemClauseCount = 0;
            let occurrenceValid = true;

            for (const clause of overlappingClauses) {
                const localStart = Math.max(0, quoteStart - clause.start);
                const localEnd = Math.min(clause.text.length, quoteEnd - clause.start);
                const { firstIdx } = findOverlappingTokenRange(clause.tokens, localStart, localEnd);
                if (firstIdx === -1) continue;
                tokenClauseCount += 1;

                // Rule e: reject if the quote lies inside a clause treated as a question.
                if (isQuestionClause(clause.text, resolvedLanguage, clause)) {
                    occurrenceValid = false;
                    break;
                }

                // Rule b: for positive-valued facts (and is_under_18: false), a negation in the window rejects the fact.
                if (isPositiveValued) {
                    const ignoredSpans = getQuoteNegationIgnoredSpans(fact, value, clause.text);
                    if (hasNegationInWindow(clause, localStart, localEnd, ignoredSpans)) {
                        occurrenceValid = false;
                        break;
                    }
                } else if (fact === 'is_under_18' && value === false) {
                    const isStandaloneNoClause = /^(?:no|нет|hayir|yok|لا|كلا)[!?;,.\u061f\u061b\u060c]*$/u.test(clause.text.trim());
                    if (!isStandaloneNoClause) {
                        const ignoredSpans = getQuoteNegationIgnoredSpans(fact, value, clause.text);
                        if (hasNegationInWindow(clause, localStart, localEnd, ignoredSpans)) {
                            occurrenceValid = false;
                            break;
                        }
                    }
                }

                // Rule c: reject if the numeric age match in its clause is a duration expression.
                if (fact === 'is_under_18' && isDurationNumericMatch(clause, localStart, localEnd)) {
                    occurrenceValid = false;
                    break;
                }

                const clauseSlice = clause.text.slice(localStart, localEnd);

                if (isFingerprintFact && hasStemFromList(clauseSlice, FINGERPRINT_CORE_STEMS)) {
                    fingerprintStemClauseCount += 1;
                    if (value === 'not_registered') {
                        const hasFpNegation = (
                            hasNegationInWindow(clause, localStart, localEnd)
                            || findAllMatches(clause.text, FINGERPRINT_NEGATIVE).length > 0
                            || hasStemFromList(clauseSlice, fpNegativeOnlyStems)
                            || hasStemFromList(clause.text, fpNegativeOnlyStems)
                        );
                        if (!hasFpNegation) {
                            occurrenceValid = false;
                            break;
                        }
                    } else if (
                        findAllMatches(clause.text, FINGERPRINT_NEGATIVE).length > 0
                        || hasStemFromList(clauseSlice, fpNegativeOnlyStems)
                    ) {
                        occurrenceValid = false;
                        break;
                    }
                }

                // Rule g: for host_is_married and host_is_turkish, require host context in the quote's clause
                // (or immediately preceding clause in the same user turn) and reject student self-description.
                if (isHostFact) {
                    if (hasRelevantQuoteStem(fact, value, clauseSlice, resolvedLanguage)) {
                        hostStemClauseCount += 1;
                        const hasHostContext = clause.hostMatches.length > 0 || clause.prevClauseHasHostContext;
                        if (
                            !hasHostContext
                            || isStudentSelfPredicate(clause, localStart, localEnd, clauseSlice, clause.hostMatches)
                        ) {
                            occurrenceValid = false;
                            break;
                        }

                        if (fact === 'host_is_married' && value === 'no') {
                            const hasNegativeMarriedSignal = (
                                hasStemFromList(clauseSlice, HOST_MARRIED_NO_INHERENT_STEMS)
                                || findAllMatches(clause.text, HOST_MARRIED_NEGATIVE).length > 0
                                || hasNegationInWindow(clause, localStart, localEnd, findAllMatches(clause.text, HOST_TURKISH_NEGATIVE))
                            );
                            if (!hasNegativeMarriedSignal) {
                                occurrenceValid = false;
                                break;
                            }
                        } else if (fact === 'host_is_turkish' && value === 'no') {
                            const hasTurkishStemInClause = (
                                hasStemFromList(clauseSlice, HOST_TURKISH_YES_STEMS)
                                || hasStemFromList(clause.text, HOST_TURKISH_YES_STEMS)
                            );
                            if (hasTurkishStemInClause) {
                                const hasNegatedTurkish = (
                                    findAllMatches(clause.text, HOST_TURKISH_NEGATIVE).length > 0
                                    || hasNegationInWindow(clause, localStart, localEnd, findAllMatches(clause.text, HOST_MARRIED_NEGATIVE))
                                );
                                if (!hasNegatedTurkish) {
                                    occurrenceValid = false;
                                    break;
                                }
                            } else if (
                                hasNegationInWindow(clause, localStart, localEnd, findAllMatches(clause.text, HOST_MARRIED_NEGATIVE))
                            ) {
                                occurrenceValid = false;
                                break;
                            }
                        }
                    }
                }
            }

            if (
                occurrenceValid
                && tokenClauseCount > 0
                && (!isHostFact || hostStemClauseCount > 0)
                && (!isFingerprintFact || fingerprintStemClauseCount > 0)
            ) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Keeps model-supplied `get_required_documents` facts when supported by the lexicon without uncertainty
 * or when accompanied by a quote that passes `verifyQuotedFact`, and fills omitted lexicon-supported facts.
 * If both the model and the lexicon have a value and they differ, the fact is omitted (asked).
 * Invalid non-null field values are preserved so `executeChatbotTool` still rejects them with VALIDATION_ERROR.
 * @param {unknown} rawArgs Untrusted arguments produced by the model.
 * @param {string[]|string} userTurns All user turns in the conversation.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {unknown} Filtered and evidence-completed arguments safe to pass to `executeChatbotTool`.
 */
export function filterDocumentArgsByEvidence(rawArgs, userTurns, language = 'tr') {
    if (!isPlainObject(rawArgs)) return rawArgs;
    const supported = extractSupportedDocumentFacts(userTurns, language);
    const uncertainKeys = new Set(Array.isArray(supported.__uncertain) ? supported.__uncertain : []);
    const rawQuotes = isPlainObject(rawArgs.quotes) ? rawArgs.quotes : {};
    const filtered = { ...rawArgs };

    for (const [key, isValidValue] of Object.entries(VALID_FACT_CHECKS)) {
        const hasRawValue = Object.hasOwn(filtered, key) && filtered[key] !== undefined && filtered[key] !== null;
        if (hasRawValue && !isValidValue(filtered[key])) {
            continue;
        }
        if (uncertainKeys.has(key)) {
            delete filtered[key];
            continue;
        }
        const hasLexiconValue = Object.hasOwn(supported, key) && supported[key] !== undefined;
        if (hasLexiconValue) {
            if (hasRawValue && filtered[key] !== supported[key]) {
                delete filtered[key];
            } else {
                filtered[key] = supported[key];
            }
            continue;
        }
        if (hasRawValue) {
            const quote = rawQuotes[key];
            if (typeof quote !== 'string' || !verifyQuotedFact(key, filtered[key], quote, userTurns, language)) {
                delete filtered[key];
            }
        }
    }

    return filtered;
}
