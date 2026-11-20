import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../../shared/document-conditions.js';
import { CHATBOT_LANGUAGES } from './chatbotKnowledge.js';

const TOOL_APPLICATION_TYPES = Object.freeze(['initial', 'renewal', 'transition']);
const FINGERPRINT_STATUSES = Object.freeze(['registered', 'not_registered']);

const COMBINING_MARKS_PATTERN = /\p{M}+/gu;
const ARABIC_DIACRITICS_PATTERN = /[\u064B-\u065F\u0670\u0640]/gu;
const APOSTROPHE_VARIANTS_PATTERN = /[\u2018\u2019\u02BC\uFF07]/g;

const CLAUSE_SPLIT_PATTERN = /(?:[!?;,\n\r\u061f\u061b\u060c]+|(?<!(?<![\p{L}\p{N}])y)\.(?=\s|$))/u;
const WORD_TOKEN_PATTERN = /[\p{L}\p{N}']+/gu;
const NEGATION_WINDOW_WORDS = 4;

/**
 * Normalizes user text across tr/en/ru/tk/ar so missing diacritics, Turkish İ/ı,
 * Turkmen letters, Russian ё, Arabic letter variants, and apostrophe variants match consistently.
 * @param {string} text Raw user message text.
 * @returns {string} Normalized lowercase text.
 */
export function normalizeForEvidence(text) {
    if (typeof text !== 'string') return '';
    return text
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
        .replace(COMBINING_MARKS_PATTERN, '');
}

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
        /^никогда$/u
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

const ALL_NEGATION_TOKEN_PATTERNS = Object.freeze([
    ...NEGATION_LEXICON_BY_LANGUAGE.tr,
    ...NEGATION_LEXICON_BY_LANGUAGE.en,
    ...NEGATION_LEXICON_BY_LANGUAGE.ru,
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
const TRANSITION_PEREVOD_CONTEXT_PATTERN = /(?<![\p{L}\p{N}])(?:внж|вид[\p{L}\p{N}]*|статус[\p{L}\p{N}]*|разрешени[\p{L}\p{N}]*|на\s+студенческ[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u;

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
        /(?<![\p{L}\p{N}])(?:borcnama[\p{L}\p{N}]*|garyndas[\p{L}\p{N}]*|[\p{L}\p{N}]+\s+yanynda)(?![\p{L}\p{N}])/u,
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

const NUMERIC_AGE_PATTERNS = Object.freeze([
    // tr / tk suffix age units
    /(?<![\p{L}\p{N}])(1[4-9]|[2-9]\d)\s*(?:yasindayim|yasinda|yasimda|yasim|yasymda|yasym)(?![\p{L}\p{N}])/gu,
    // en explicit age units ("years old", "yrs old", "y.o.")
    /(?<![\p{L}\p{N}])(1[4-9]|[2-9]\d)\s*(?:years?\s+old|yrs?\s+old|y\.?o\.?)(?![\p{L}\p{N}])/gu,
    // en "I am N" / "I'm N" only at end of clause (allowing trailing delimiter) or followed by "years" or "and"
    /(?<![\p{L}\p{N}])(?:i\s+am|i'm|im)(?:\s+not)?\s+(1[4-9]|[2-9]\d)(?=(?:\s*(?:years(?=\s*(?:and(?![\p{L}\p{N}])|[,.;!?\u061f\u061b\u060c]*$))|and(?![\p{L}\p{N}])|[,.;!?\u061f\u061b\u060c]*$)))/gu,
    // ru explicit age statements ("мне [уже|исполнилось] N лет/года/год" or "N лет/года/год от роду")
    /(?<![\p{L}\p{N}])мне(?:\s+еще)?(?:\s+не)?(?:\s+уже)?(?:\s+исполнилось)?\s+(1[4-9]|[2-9]\d)\s*(?:лет|года|год)(?![\p{L}\p{N}])/gu,
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
    /(?<![\p{L}\p{N}])(?:ev\s+sahib[\p{L}\p{N}]*|taahhut(?:name)?\s+veren[\p{L}\p{N}]*|yaninda\s+kaldig[\p{L}\p{N}]*|akrabam[\p{L}\p{N}]*|arkadasim[\p{L}\p{N}]*|tanidig[\p{L}\p{N}]*\s+yan[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    // en
    /(?<![\p{L}\p{N}])(?:host[\p{L}\p{N}]*|landlord[\p{L}\p{N}]*|relatives?|(?:the\s+)?person\s+(?:i\s+)?stay\s+with)(?![\p{L}\p{N}])/u,
    // ru
    /(?<![\p{L}\p{N}])(?:хозяин[\p{L}\p{N}]*|хозяик[\p{L}\p{N}]*|принимающ[\p{L}\p{N}]*|родственни(?:к|ц)[\p{L}\p{N}]*|у\s+(?:кого|которого|которои)\s+живу)(?![\p{L}\p{N}])/u,
    // tk
    /(?<![\p{L}\p{N}])(?:hojayyn[\p{L}\p{N}]*|garyndas[\p{L}\p{N}]*|borcnama\s+beryan[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    // ar
    /(?<![\p{L}\p{N}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مضيف[\p{L}\p{N}]*|صاحب\s+(?:ال)?سكن|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?قريب(?:ي|ه|ها|نا)?|(?:الشخص\s+)?(?:الذي|اللي)\s+(?:اسكن|بسكن|اقيم|بقيم|ساكن[\p{L}\p{N}]*|مقيم[\p{L}\p{N}]*|عايش[\p{L}\p{N}]*|اعيش|بعيش)\s+(?:عنده|عندها|معه|معها|لديه|لديها)|مقدم\s+(?:ال)?تعهد)(?![\p{L}\p{N}])/u
]);

const STUDENT_SUBJECT_PATTERN = /(?<![\p{L}\p{N}])(?:ben|i\s+am|i'm|im|я|men|انا)(?![\p{L}\p{N}])/gu;
const FIRST_PERSON_TURKISH_PREDICATE_PATTERN = /^(?:evliyim|bekarim|vatandasim|turkum)$/u;

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
    /(?<![\p{L}\p{N}])turk(?!\s*(?:ce(?![\p{L}\p{N}])|ikamet|ogrenci|vize|pasaport|telekom|lira|degil|vatandas[\p{L}\p{N}]*\s+degil))(?![\p{L}\p{N}])/u,
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
    /(?<![\p{L}\p{N}])barmak\s+yz[\p{L}\p{N}]*(?:,?\s+[\p{L}\p{N}]+){0,6},?\s+(?:yok|hasab[\p{L}\p{N}]*\s+yok|hasaba\s+alyn?mady[\p{L}\p{N}]*|hasaba\s+alyn?anok|hasaba\s+alyn?an\s+dal[\p{L}\p{N}]*|tapsyrmadym|tapsyrylmady[\p{L}\p{N}]*|alynmady[\p{L}\p{N}]*|alnan\s+dal[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:hasab[\p{L}\p{N}]*\s+yok|hasaba\s+alyn?mady[\p{L}\p{N}]*|hasaba\s+alyn?anok|hasaba\s+alyn?an\s+dal[\p{L}\p{N}]*|tapsyrmadym|tapsyrylmady[\p{L}\p{N}]*|alynmady[\p{L}\p{N}]*)\s+(?:[\p{L}\p{N}]+\s+){0,6}barmak\s+yz[\p{L}\p{N}]*(?![\p{L}\p{N}])/u,
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
const ENGLISH_AUX_QUESTION_PATTERN = /^(?:is|are|am|do|does|did|should|can|could|would|will)(?![\p{L}\p{N}])/u;
const WH_WORDS_BY_LANGUAGE = Object.freeze({
    tr: /(?<![\p{L}\p{N}])(?:ne|neler|nedir|hangi|nasil|nerede|ne\s+zaman|kac(?:ta)?)(?![\p{L}\p{N}])/u,
    en: /(?<![\p{L}\p{N}])(?:what|which|how|where|when)(?![\p{L}\p{N}])/u,
    ru: /(?<![\p{L}\p{N}])(?:что|какие|какои|как|где|когда|сколько)(?![\p{L}\p{N}])/u,
    tk: /(?<![\p{L}\p{N}])(?:name|haysy|nahili|nirede|hacan|nace)(?![\p{L}\p{N}])/u,
    ar: /(?<![\p{L}\p{N}])(?:ما(?!\s+(?!ال[\p{L}\p{N}]*|(?:نوع|نتيجه|تاريخ|تكلفه|بيانات|بصم[\p{L}\p{N}]*|تعهد|اوراق|اجراءات|انواع|اسباب|اوقات|ارقام|اسماء|اسم|اقامه|ايجار|اجار|استماره|اتفاقيه|افاده|امكانيه|احجام|اماكن)(?![\p{L}\p{N}]))(?:[بتينا][\p{L}]{2,}|ساكن[\p{L}]*|عايش[\p{L}]*|قاعد[\p{L}]*|مقيم[\p{L}]*|عند[\p{L}]*|لدي[\p{L}]*|مع[\p{L}]*|سجل[\p{L}]*|تم[\p{L}]*)(?![\p{L}\p{N}]))|ماذا|اي|كيف|اين|متي|كم)(?![\p{L}\p{N}])/u
});
const TURKMEN_NON_NAME_WH_PATTERN = /(?<![\p{L}\p{N}])(?:haysy|nahili|nirede|hacan|nace)(?![\p{L}\p{N}])/u;
const ELLIPTICAL_DOCUMENT_REQUEST_PATTERN = /(?:^(?:belge[\p{L}\p{N}]*|evrak[\p{L}\p{N}]*|documents?|docs?|документ[\p{L}\p{N}]*|resminama[\p{L}\p{N}]*|(?:ال)?(?:مستندات|وثايق))\s+(?:for|icin|ucin|для|ل[\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:belge[\p{L}\p{N}]*|evrak[\p{L}\p{N}]*|documents?|docs?|документ[\p{L}\p{N}]*|resminama[\p{L}\p{N}]*|(?:ال)?(?:مستندات|وثايق))\s*[?\u061f]$)/u;
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
    /(?<![\p{L}\p{N}])(?:hangi\s+(?:belge|evrak)[\p{L}\p{N}]*|(?:belge|evrak)[\p{L}\p{N}]*\s+neler|ne(?:ler)?\s+gerek[\p{L}\p{N}]*|gerekli\s+(?:belge|evrak)[\p{L}\p{N}]*|(?:belge|evrak)[\p{L}\p{N}]*\s+listesi|lazim)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:(?:which|what)\s+(?:[\p{L}\p{N}]+\s+){0,2}(?:documents?|docs)(?!\s+(?:format|size|types?))|required\s+(?:documents?|docs)|(?:documents?|docs)\s+(?:are\s+)?(?:required|needed)|(?:document|documents|doc|docs)\s+list|list\s+(?:of\s+|the\s+)?(?:required\s+)?(?:documents?|docs)|do\s+i\s+need(?!\s+to\s+(?:upload|resubmit|replace|scan|convert|compress|resize)))(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:какие\s+(?:[\p{L}\p{N}]+\s+){0,2}документ[\p{L}\p{N}]*|список\s+(?:[\p{L}\p{N}]+\s+){0,2}документ[\p{L}\p{N}]*|необходим[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|нужн[\p{L}\p{N}]*\s+документ[\p{L}\p{N}]*|документ[\p{L}\p{N}]*\s+(?:[\p{L}\p{N}]+\s+){0,2}нужн[\p{L}\p{N}]*|что\s+нужно)(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:haysy\s+(?:[\p{L}\p{N}]+\s+){0,2}resminama[\p{L}\p{N}]*|name\s+(?:resminama[\p{L}\p{N}]*\s+)?gerek|gerekli\s+resminama[\p{L}\p{N}]*|resminama[\p{L}\p{N}]*\s+(?:gerek|sanaw[\p{L}\p{N}]*))(?![\p{L}\p{N}])/u,
    /(?<![\p{L}\p{N}])(?:ما\s+(?:هي\s+)?(?:المستندات|الوثايق|مستندات|وثايق)|(?:المستندات|الوثايق)\s+المطلوب[\p{L}\p{N}]*|قايمه\s+(?:المستندات|الوثايق))(?![\p{L}\p{N}])/u
]);

export const EVIDENCE_PATTERN_LISTS = Object.freeze({
    NEGATION_LEXICON_BY_LANGUAGE,
    ARABIC_DIALECT_NEGATION_PARTICLE_PATTERN,
    ARABIC_MA_NON_VERB_NOUN_PATTERN,
    ARABIC_DIALECT_VERB_AFTER_MA_PATTERN,
    APPLICATION_TYPE_PATTERNS,
    TRANSITION_PEREVOD_PATTERN,
    TRANSITION_PEREVOD_CONTEXT_PATTERN,
    ACCOMMODATION_PATTERNS,
    ARABIC_QARIB_PATTERN,
    ARABIC_QARIB_CONTEXT_PATTERN,
    UNDER_18_PHRASES,
    ADULT_PHRASES,
    EXPLICIT_DOUBLE_NEG_ADULT_PATTERN,
    NUMERIC_AGE_PATTERNS,
    RUSSIAN_START_AGE_PATTERN,
    DURATION_PREFIX_WORDS,
    DURATION_SUFFIX_WORDS,
    HOST_CONTEXT_PATTERNS,
    STUDENT_SUBJECT_PATTERN,
    FIRST_PERSON_TURKISH_PREDICATE_PATTERN,
    HOST_MARRIED_NEGATIVE,
    HOST_MARRIED_POSITIVE,
    HOST_TURKISH_NEGATIVE,
    HOST_TURKISH_POSITIVE,
    FINGERPRINT_NEGATIVE,
    FINGERPRINT_POSITIVE,
    YESNO_QUESTION_PARTICLES_BY_LANGUAGE,
    ENGLISH_AUX_QUESTION_PATTERN,
    WH_WORDS_BY_LANGUAGE,
    TURKMEN_NON_NAME_WH_PATTERN,
    ELLIPTICAL_DOCUMENT_REQUEST_PATTERN,
    DOCUMENT_KEYWORD_PATTERNS,
    POLITE_REQUEST_PATTERNS_BY_LANGUAGE,
    LIST_INTENT_PHRASE_PATTERNS
});

function isNegationToken(cleanToken) {
    if (!cleanToken) return false;
    return ALL_NEGATION_TOKEN_PATTERNS.some((pattern) => pattern.test(cleanToken));
}

function isArabicVerbLikeAfterNegation(cleanToken) {
    if (!cleanToken) return false;
    if (ARABIC_MA_NON_VERB_NOUN_PATTERN.test(cleanToken)) return false;
    return ARABIC_DIALECT_VERB_AFTER_MA_PATTERN.test(cleanToken);
}

function tokenizeClause(clauseText) {
    const tokens = [];
    for (const match of clauseText.matchAll(WORD_TOKEN_PATTERN)) {
        const clean = match[0].replace(/^'+|'+$/g, '');
        tokens.push({
            raw: match[0],
            clean,
            start: match.index,
            end: match.index + match[0].length,
            isNegation: isNegationToken(clean),
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

/**
 * Splits normalized text into clauses keeping delimiter punctuation attached at each clause end
 * so question marks remain visible on the clause they terminate while preventing cross-clause bleed.
 */
function parseClauses(normalizedText) {
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
                tokens: tokenizeClause(text)
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
            tokens: tokenizeClause(tail)
        });
    }
    return clauses;
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

function hasDocumentKeyword(clauseText) {
    return DOCUMENT_KEYWORD_PATTERNS.some((pattern) => pattern.test(clauseText));
}

function isYesNoQuestionClause(clauseText, language = 'tr') {
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
    return /[?\u061f]$/u.test(trimmed) && ENGLISH_AUX_QUESTION_PATTERN.test(trimmed);
}

function isQuestionClause(clauseText, language = 'tr') {
    if (isYesNoQuestionClause(clauseText, language)) return true;
    const trimmed = clauseText.trim();
    if (!/[?\u061f]$/u.test(trimmed)) return false;
    if (hasWhQuestionWord(trimmed, language)) return false;
    if (hasListIntentPhrase(trimmed)) return false;
    if (ELLIPTICAL_DOCUMENT_REQUEST_PATTERN.test(trimmed)) return false;
    if (hasDocumentKeyword(trimmed)) return false;
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
    const matchedKeys = new Set();
    let uncertain = false;

    for (const clause of clauses) {
        const isQuestion = isQuestionClause(clause.text, language);
        for (const [key, patterns] of Object.entries(APPLICATION_TYPE_PATTERNS)) {
            const matches = findAllMatches(clause.text, patterns);
            if (key === 'transition' && TRANSITION_PEREVOD_CONTEXT_PATTERN.test(clause.text)) {
                matches.push(...findAllMatches(clause.text, [TRANSITION_PEREVOD_PATTERN]));
            }
            for (const match of matches) {
                if (hasNegationInWindow(clause, match.start, match.end) || isQuestion) {
                    uncertain = true;
                } else {
                    matchedKeys.add(key);
                }
            }
        }
    }

    if (uncertain || matchedKeys.size > 1) {
        return { value: undefined, uncertain: true };
    }
    if (matchedKeys.size === 1) {
        return { value: [...matchedKeys][0], uncertain: false };
    }
    return { value: undefined, uncertain: false };
}

function detectAccommodationType(clauses, language) {
    const matchedKeys = new Set();
    let uncertain = false;

    for (const clause of clauses) {
        const isQuestion = isQuestionClause(clause.text, language);
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
                if (hasNegationInWindow(clause, match.start, match.end, ignoredSpans) || isQuestion) {
                    uncertain = true;
                } else {
                    matchedKeys.add(key);
                }
            }
        }
    }

    if (uncertain || matchedKeys.size > 1) {
        return { value: undefined, uncertain: true };
    }
    if (matchedKeys.size === 1) {
        return { value: [...matchedKeys][0], uncertain: false };
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

function detectUnder18(clauses, language) {
    let under18Matched = false;
    let adultMatched = false;
    let uncertain = false;

    for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
        const clause = clauses[clauseIndex];
        const isQuestion = isQuestionClause(clause.text, language);

        const adultMatches = findAllMatches(clause.text, ADULT_PHRASES);
        for (const match of adultMatches) {
            if (hasNegationInWindow(clause, match.start, match.end, [match]) || isQuestion) {
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
            if ((!isExplicitMinor && hasNegationInWindow(clause, match.start, match.end, explicitMinorSpans)) || isQuestion) {
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
            if (hasNegationInWindow(clause, match.start, match.end) || isQuestion) {
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

function isStudentSelfPredicate(clauseText, matchStart, matchText, hostMatches) {
    const tokensInMatch = tokenizeClause(matchText);
    if (tokensInMatch.some((t) => FIRST_PERSON_TURKISH_PREDICATE_PATTERN.test(t.clean))) {
        return true;
    }
    const studentMatches = findAllMatches(clauseText, [STUDENT_SUBJECT_PATTERN])
        .filter((m) => m.start < matchStart);
    if (studentMatches.length === 0) return false;
    const latestStudent = studentMatches[studentMatches.length - 1];
    const hasInterveningHost = hostMatches.some(
        (h) => h.start > latestStudent.start && h.start < matchStart
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
        const hostMatches = findAllMatches(clause.text, HOST_CONTEXT_PATTERNS);
        if (hostMatches.length === 0) continue;

        const isQuestion = isQuestionClause(clause.text, language);
        const marriedNegMatches = findAllMatches(clause.text, HOST_MARRIED_NEGATIVE);
        const turkishNegMatches = findAllMatches(clause.text, HOST_TURKISH_NEGATIVE);

        const activeMarriedNegMatches = [];
        for (const match of marriedNegMatches) {
            if (isStudentSelfPredicate(clause.text, match.start, match.text, hostMatches)) continue;
            activeMarriedNegMatches.push(match);
            if (isQuestion) marriedUncertain = true;
            else marriedNo = true;
        }
        for (const match of findAllMatches(clause.text, HOST_MARRIED_POSITIVE)) {
            if (isStudentSelfPredicate(clause.text, match.start, match.text, hostMatches)) continue;
            if (isPositiveMatchCoveredByNegative(match, activeMarriedNegMatches)) continue;
            if (isQuestion || hasNegationInWindow(clause, match.start, match.end, turkishNegMatches)) {
                marriedUncertain = true;
            } else {
                marriedYes = true;
            }
        }

        const activeTurkishNegMatches = [];
        for (const match of turkishNegMatches) {
            if (isStudentSelfPredicate(clause.text, match.start, match.text, hostMatches)) continue;
            activeTurkishNegMatches.push(match);
            if (isQuestion) turkishUncertain = true;
            else turkishNo = true;
        }
        for (const match of findAllMatches(clause.text, HOST_TURKISH_POSITIVE)) {
            if (isStudentSelfPredicate(clause.text, match.start, match.text, hostMatches)) continue;
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
        const isQuestion = isQuestionClause(clause.text, language);
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

    // Join turns with newlines so adjacency rules never bridge across separate turns.
    const normalizedText = turns.map(normalizeForEvidence).join('\n');
    const clauses = parseClauses(normalizedText);

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
    const turns = Array.isArray(userTurns)
        ? userTurns.filter((item) => typeof item === 'string')
        : (typeof userTurns === 'string' ? [userTurns] : []);
    if (turns.length === 0) return false;

    const supported = extractSupportedDocumentFacts(turns, language);
    if (Array.isArray(supported.__uncertain) && supported.__uncertain.length > 0) {
        return true;
    }

    const normalizedText = turns.map(normalizeForEvidence).join('\n');
    const tokens = tokenizeClause(normalizedText);
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
    for (const match of textForNumbers.matchAll(/(?<![\p{L}\p{N}])(\d+)(?![\p{L}\p{N}])/gu)) {
        const parsed = Number.parseInt(match[1], 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) continue;
        if (parsed < 18) {
            hasMinorAgeNumber = true;
        } else {
            hasAdultAgeNumber = true;
        }
    }

    const hasMinorSignal = under18Matches.length > 0 || hasMinorAgeNumber;
    const hasAdultSignal = adultMatches.length > 0 || hasAdultAgeNumber;
    if (hasMinorSignal && hasAdultSignal) return false;
    return value === true ? hasMinorSignal : hasAdultSignal;
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
    const quoteTokens = tokenizeClause(normalizedQuote);
    if (quoteTokens.length === 0) return false;

    // Rule d: Lexicon veto — reject if extractSupportedDocumentFacts has a different value or lists the fact in __uncertain.
    const supported = extractSupportedDocumentFacts(turns, resolvedLanguage);
    const uncertainKeys = Array.isArray(supported.__uncertain) ? supported.__uncertain : [];
    if (uncertainKeys.includes(fact)) return false;
    if (Object.hasOwn(supported, fact) && supported[fact] !== undefined && supported[fact] !== value) {
        return false;
    }

    // Rule c: is_under_18 must contain an age number 1-99 consistent with value or a lexicon minor/adult phrase, and no duration words.
    if (fact === 'is_under_18' && !verifyUnder18QuoteContent(normalizedQuote, quoteTokens, value)) {
        return false;
    }

    const isPositiveValued = POSITIVE_VALUED_DOCUMENT_FACTS[fact](value);

    // Rule a, b, c (clause duration), e (yes/no question): quote must occur in normalized user turns and pass clause checks.
    for (const turn of turns) {
        const normalizedTurn = normalizeForEvidence(turn);
        if (!normalizedTurn.includes(normalizedQuote)) continue;

        const clauses = parseClauses(normalizedTurn);
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
            let occurrenceValid = true;

            for (const clause of overlappingClauses) {
                const localStart = Math.max(0, quoteStart - clause.start);
                const localEnd = Math.min(clause.text.length, quoteEnd - clause.start);
                const { firstIdx } = findOverlappingTokenRange(clause.tokens, localStart, localEnd);
                if (firstIdx === -1) continue;
                tokenClauseCount += 1;

                // Rule e: reject if the quote lies inside a clause the lexicon treats as a yes/no question.
                if (isQuestionClause(clause.text, resolvedLanguage)) {
                    occurrenceValid = false;
                    break;
                }

                // Rule b: for positive-valued facts, a negation in the window rejects the fact.
                if (isPositiveValued) {
                    const ignoredSpans = getQuoteNegationIgnoredSpans(fact, value, clause.text);
                    if (hasNegationInWindow(clause, localStart, localEnd, ignoredSpans)) {
                        occurrenceValid = false;
                        break;
                    }
                }

                // Rule c: reject if the numeric age match in its clause is a duration expression.
                if (fact === 'is_under_18' && isDurationNumericMatch(clause, localStart, localEnd)) {
                    occurrenceValid = false;
                    break;
                }
            }

            if (occurrenceValid && tokenClauseCount > 0) {
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
