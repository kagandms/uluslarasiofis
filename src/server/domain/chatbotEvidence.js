import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../../shared/document-conditions.js';
import { CHATBOT_LANGUAGES } from './chatbotKnowledge.js';

const TOOL_APPLICATION_TYPES = Object.freeze(['initial', 'renewal', 'transition']);
const FINGERPRINT_STATUSES = Object.freeze(['registered', 'not_registered']);

const COMBINING_MARKS_PATTERN = /\p{M}+/gu;
const ARABIC_DIACRITICS_PATTERN = /[\u064B-\u065F\u0670\u0640]/gu;

/**
 * Normalizes user text across tr/en/ru/tk/ar so missing diacritics, Turkish İ/ı,
 * Turkmen letters, Russian ё, and Arabic letter variants match consistently.
 * @param {string} text Raw user message text.
 * @returns {string} Normalized lowercase text.
 */
export function normalizeForEvidence(text) {
    if (typeof text !== 'string') return '';
    return text
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

const APPLICATION_TYPE_PATTERNS = Object.freeze({
    initial: Object.freeze([
        /(?:^|[^\p{L}])ilk(?:\s+(?:basvur[\p{L}\p{N}]*|kez|defa|ikamet|olarak))?(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])ilkinj[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:first(?:\s+time)?|initial)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:вперв[\p{L}\p{N}]*|первич[\p{L}\p{N}]*|перв(?:ая|ыи|ое)\s+подач[\p{L}\p{N}]*|первыи\s+раз)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:اول|اولي|اوليا|اوليه|الاول|الاولي|الاوليه|اول\s+مره|للمره\s+الاولي|طلب[\p{L}\p{N}]*\s+اول[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
    ]),
    renewal: Object.freeze([
        /(?:^|[^\p{L}])(?:uzat[\p{L}\p{N}]*|yenile[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:uzalt[\p{L}\p{N}]*|tazele[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:exten[\p{L}\p{N}]*|renew[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])продл[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تمديد|تجديد|امدد|اجدد)(?:[^\p{L}]|$)/u
    ]),
    transition: Object.freeze([
        /(?:^|[^\p{L}])(?:gecis[\p{L}\p{N}]*|tur\s+degis[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:uytget[\p{L}\p{N}]*|gecish[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:transition[\p{L}\p{N}]*|switch[\p{L}\p{N}]*|transfer)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:переход[\p{L}\p{N}]*|переи[\p{L}\p{N}]*|перевест[\p{L}\p{N}]*|перевод[\p{L}\p{N}]*|смен(?:ить|а)\s+вид[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تحويل|انتقال|الانتقال|احول|انقل)(?:[^\p{L}]|$)/u
    ])
});

const ACCOMMODATION_PATTERNS = Object.freeze({
    dormitory: Object.freeze([
        /(?:^|[^\p{L}])(?:ogrenci\s+)?yurt(?:ta|da|tan|dan|um|umuz|u|a|lar)?(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])yurdu(?:n|m|nda|ndan)?(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?<![\p{L}\p{N}])kyk(?![\p{L}\p{N}])(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])dorm(?:itory|itories|s)?(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:общежит[\p{L}\p{N}]*|общаг[\p{L}\p{N}]*|obshag[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:umumy\s+yasayys[\p{L}\p{N}]*|yasayys\s+jay[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?سكن\s+(?:ال)?طلاب[\p{L}\p{N}]*|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?سكن\s+(?:ال)?جامع[\p{L}\p{N}]*|sakan\s+jami[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
    ]),
    rental_contract: Object.freeze([
        /(?:^|[^\p{L}])kira(?:da|lik|ci|yi|ladim|sozlesme[\p{L}\p{N}]*|\s+sozlesme[\p{L}\p{N}]*)?(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])rent(?:al|ing|ed|s)?(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:аренд[\p{L}\p{N}]*|договор[\p{L}\p{N}]*\s+наима|снима[\p{L}\p{N}]*\s+кварт[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:karend[\p{L}\p{N}]*|kirey[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:ايجار|عقد\s+(?:ال)?ايجار|عقد\s+(?:ال)?اجار|مستاجر[\p{L}\p{N}]*|استاجر[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
    ]),
    own_home: Object.freeze([
        /(?:^|[^\p{L}])(?:kendi\s+ev[\p{L}\p{N}]*|tapu[\p{L}\p{N}]*|ev\s+benim)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:own\s+(?:home|house|flat|apartment|place)|title\s+deed)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:собственн[\p{L}\p{N}]*\s+(?:жил[\p{L}\p{N}]*|дом[\p{L}\p{N}]*|кварт[\p{L}\p{N}]*)|сво(?:е|еи|я|ем)\s+(?:жил[\p{L}\p{N}]*|дом[\p{L}\p{N}]*|кварт[\p{L}\p{N}]*)|тапу|в\s+собственности)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:oz\s+oy[\p{L}\p{N}]*|eyecilik[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:منزل|بيت|شقه)\s+املك[\p{L}\p{N}]*|سند\s+(?:ال)?ملكي[\p{L}\p{N}]*|ملك\s+خاص|ملكي|(?:منزل|بيت)[\p{L}\p{N}]*\s+مملوك[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
    ]),
    hotel: Object.freeze([
        /(?:^|[^\p{L}])(?:otel[\p{L}\p{N}]*|pansiyon[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])hotel[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:гостиниц[\p{L}\p{N}]*|отел[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])myhmanhana[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?فندق[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
    ]),
    undertaking: Object.freeze([
        /(?:^|[^\p{L}])(?:taahhut[\p{L}\p{N}]*|akraba[\p{L}\p{N}]*\s+yan[\p{L}\p{N}]*|tanidig?[\p{L}\p{N}]*\s+yan[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:undertaking[\p{L}\p{N}]*|host|relative)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:обязательств[\p{L}\p{N}]*|поручител[\p{L}\p{N}]*|родственник[\p{L}\p{N}]*|принимающ[\p{L}\p{N}]*\s+лиц[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:borcnama[\p{L}\p{N}]*|garyndas[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تعهد|التعهد|كفاله|مضيف|مقدم\s+التعهد|قريب[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u
    ]),
    residence_certificate: Object.freeze([
        /(?:^|[^\p{L}])(?:adres\s+kayd[\p{L}\p{N}]*|yerlesim\s+yeri(?:\s+belge[\p{L}\p{N}]*)?|ikametgah\s+belge[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:residence\s+certificate|registered\s+address|address\s+registration)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:справк[\p{L}\p{N}]*\s+о\s+месте(?:\s+жительств[\p{L}\p{N}]*)?|регистрац[\p{L}\p{N}]*\s+по\s+адресу)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:hasaba\s+alnan\s+salg[\p{L}\p{N}]*|yasayan\s+yeri\s+sahadatnama[\p{L}\p{N}]*|salgy\s+sahadatnama[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
        /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:شهاده\s+(?:محل\s+)?(?:ال)?اقامه|(?:ال)?عنوان\s+(?:ال)?مسجل|بيان\s+(?:ال)?عنوان)(?:[^\p{L}]|$)/u
    ])
});

const UNDER_18_PHRASES = Object.freeze([
    /(?:^|[^\p{L}])18\s*(?:yasindan|yastan)?\s*kucug?[\p{L}\p{N}]*(?!\s+degil)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])18\s*(?:yas)?\s*alti(?:nda)?(?!\s+degil)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])resit\s+degil[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!not\s+)(?:under|below|less\s+than|younger\s+than)\s+18(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!not\s+(?:a\s+)?)minor(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?<!не\s+)младше\s+18|до\s+18\s*(?:лет)?|несовершеннолет[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:18\s*yasdan\s*kici[\p{L}\p{N}]*(?!\s+dal)|kamillik\s*yasyna\s*yetmedik[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?<!(?:لست|ليس|ليست)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:اقل|اصغر|دون)\s+(?:من\s+)?18|(?<!(?:لست|ليس|ليست)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?قاصر)(?:[^\p{L}]|$)/u
]);

const ADULT_PHRASES = Object.freeze([
    /(?:^|[^\p{L}])18\s*(?:yasindan|yastan|den|dan)?\s*kucuk\s*degil[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])18\s*(?:yasindan|yastan|den|dan)?\s*buyu[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])18\s*(?:yas\s*)?(?:ve\s*)?uzeri[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:resitim|yetiskin[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])not\s+(?:under\s+18|(?:a\s+)?minor)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:over|above|older\s+than)\s+18(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])18\s*(?:or\s+older|and\s+over|\+)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])adult(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:не\s+младше\s+18|старше\s+18|больше\s+18|совершеннолет[\p{L}\p{N}]*|взросл[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:18\s*yasdan\s*(?:uly|kici\s+dal)|kamillik\s*yasyna\s*yeten[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:لست|ليس|ليست)\s+(?:اقل|اصغر|دون)\s+(?:من\s+)?18|(?:اكبر|فوق|اعلي)\s+(?:من\s+)?18|بالغ|راشد)(?:[^\p{L}]|$)/u
]);

const NUMERIC_AGE_PATTERNS = Object.freeze([
    /(?:^|[^\p{N}])([1-9]\d?)\s*(?:yasindayim|yasinda|yasimda|yasymda|yasim|yasym|yas(?![\p{L}\p{N}])|years?(?:\s+old)?|yrs?\s+old|y\.?o\.?|лет|года?|год|omri|sana|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:سنه|سنوات|عاما|عام))(?:[^\p{L}]|$)/gu,
    /(?:^|[^\p{L}])(?:yasim|yasym|yas|age|omri|(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:عمر|عمري))\s*[:=]?\s*([1-9]\d?)(?:[^\p{N}]|$)/gu,
    /(?:^|[^\p{L}])(?:i\s+am|i'm|im|мне)\s+([1-9]\d?)(?=[\s,.;:!?]|$)/gu
]);

const HOST_MARRIED_NEGATIVE = Object.freeze([
    /(?:^|[^\p{L}])evli\s+degil[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])bekar[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:(?:not|isn't|isnt|aren't|arent)\s+married|unmarried|single)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:не\s+женат|не\s+замужем|не\s+состоит\s+в\s+браке|холост[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:oylenmedik[\p{L}\p{N}]*|durmusa\s+cykmadyk[\p{L}\p{N}]*|oylenen\s+dal|durmusa\s+cykan\s+dal)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:(?:غير|ليس|ليست|مش)\s+متزوج[\p{L}\p{N}]*|اعزب|عزباء)(?:[^\p{L}]|$)/u
]);

const HOST_MARRIED_POSITIVE = Object.freeze([
    /(?:^|[^\p{L}])evli(?!\s+(?:degil|mi(?![\p{L}\p{N}])|midir(?![\p{L}\p{N}])))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!(?:not|isn't|isnt|aren't|arent)\s+)married(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!не\s+)(?:женат|замужем|состоит\s+в\s+браке|в\s+браке)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:oylenen|durmusa\s+cykan)(?!\s+dal(?![\p{L}\p{N}]))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!(?:غير|ليس|ليست|مش)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?متزوج[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
]);

const HOST_TURKISH_NEGATIVE = Object.freeze([
    /(?:^|[^\p{L}])(?:turk(?:\s+vatandasi)?|turkiye\s+vatandasi)\s+degil[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])yabanci\s+vatandas[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:not|isn't|isnt)\s+(?:a\s+)?turkish(?:\s+citizen)?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:не\s+(?:является\s+)?граждан[\p{L}\p{N}]*\s+турции|не\s+турок|не\s+турецк[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:turk(?:iyanin)?\s+(?:rayaty\s+)?dal|dasary\s+yurtly)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:غير|ليس|ليست|مش)\s+(?:مواطن[\p{L}\p{N}]*\s+)?تركي[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
]);

const HOST_TURKISH_POSITIVE = Object.freeze([
    /(?:^|[^\p{L}])(?:turk|turkiye|tc)\s+vatandas[\p{L}\p{N}]*(?!\s+(?:degil|mi(?![\p{L}\p{N}])|midir(?![\p{L}\p{N}])))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])turk(?!\s*(?:ce(?![\p{L}\p{N}])|ikamet|ogrenci|vize|pasaport|telekom|lira|degil|vatandas[\p{L}\p{N}]*\s+degil|mu(?![\p{L}\p{N}])|mudur(?![\p{L}\p{N}])))(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!(?:not|isn't|isnt)\s+(?:a\s+)?)turkish\s+citizen(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!not\s+(?:a\s+)?)(?:host|he|she|they|person)\s+(?:is|are)\s+turkish(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!не\s+(?:является\s+)?)граждан[\p{L}\p{N}]*\s+турции(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:turkiyanin|turk)\s+rayat[\p{L}\p{N}]*(?!\s+dal)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!(?:غير|ليس|ليست|مش)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مواطن\s+تركي(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!(?:غير|ليس|ليست|مش)\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مقدم\s+التعهد|المضيف|هو|هي)\s+تركي(?:[^\p{L}]|$)/u
]);

const FINGERPRINT_NEGATIVE = Object.freeze([
    /(?:^|[^\p{L}])parmak\s+izi[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?:yok|kaydim\s+yok|kayitli\s+degil|alinmadi|vermedim|yaptirmadim|bulunmuyor)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:no|not|never|dont|don't|haven't|have\s+not)\s+(?:[\p{L}\p{N}]+\s+){0,4}fingerprints?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])fingerprints?(?:\s+[\p{L}\p{N}]+){0,4}\s+(?:not\s+registered|not\s+recorded|unregistered|missing|not\s+yet|not\s+taken)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])отпечат[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?:не\s+зарегистрирован[\p{L}\p{N}]*|нет|отсутств[\p{L}\p{N}]*|не\s+сда[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:нет|не\s+сдава[\p{L}\p{N}]*)\s+(?:[\p{L}\p{N}]+\s+){0,3}отпечат[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])barmak\s+yz[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?:yok|hasaba\s+alynmadyk|hasaba\s+alnan\s+dal|tapsyrmadym)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?:غير\s+مسجل[\p{L}\p{N}]*|ليست\s+مسجل[\p{L}\p{N}]*|لا\s+يوجد|لا\s+توجد)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:لا\s+يوجد|ليس\s+لدي|لم\s+اسجل)\s+(?:[\p{L}\p{N}]+\s+){0,3}(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
]);

const FINGERPRINT_POSITIVE = Object.freeze([
    /(?:^|[^\p{L}])parmak\s+izi[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?:var|kaydim\s+var|kayitli|alindi|verdim|yaptirdim|mevcut)(?!\s+degil)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!no\s+|not\s+)fingerprints?(?:\s+[\p{L}\p{N}]+){0,4}\s+(?<!no\s+|not\s+|never\s+)(?:registered|recorded|taken|done|available|exists?)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!not\s+|never\s+|don't\s+|dont\s+|do\s+not\s+)(?:have|has|got)\s+(?:[\p{L}\p{N}]+\s+){0,3}fingerprints?(?:\s+(?:registered|recorded|taken))?(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!не\s+)отпечат[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?<!не\s+)(?:зарегистрирован[\p{L}\p{N}]*|сданы|сдал[\p{L}\p{N}]*|есть|имеются|внесены)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!не\s+)(?:есть|имеются|сдал[\p{L}\p{N}]*)\s+(?:[\p{L}\p{N}]+\s+){0,3}отпечат[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])barmak\s+yz[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?:bar|hasaba\s+alnan|tapsyrdym|alnan)(?!\s+dal)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!غير\s+|ليست\s+|ليس\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\s+(?<!غير\s+|ليست\s+|ليس\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:مسجل[\p{L}\p{N}]*|موجود[\p{L}\p{N}]*|تمت)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?<!لم\s+|ليس\s+)(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:لدي|عندي|سجلت)\s+(?:[\p{L}\p{N}]+\s+){0,3}(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:بصم|بصمات)[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
]);

export const EVIDENCE_PATTERN_LISTS = Object.freeze({
    APPLICATION_TYPE_PATTERNS,
    ACCOMMODATION_PATTERNS,
    UNDER_18_PHRASES,
    ADULT_PHRASES,
    NUMERIC_AGE_PATTERNS,
    HOST_MARRIED_NEGATIVE,
    HOST_MARRIED_POSITIVE,
    HOST_TURKISH_NEGATIVE,
    HOST_TURKISH_POSITIVE,
    FINGERPRINT_NEGATIVE,
    FINGERPRINT_POSITIVE
});

function matchesAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
}

function detectUniqueEnumMatch(text, patternMap) {
    const matchedKeys = [];
    for (const [key, patterns] of Object.entries(patternMap)) {
        if (matchesAny(text, patterns)) {
            matchedKeys.push(key);
        }
    }
    return matchedKeys.length === 1 ? matchedKeys[0] : undefined;
}

function detectUnder18(text) {
    let under18Matched = matchesAny(text, UNDER_18_PHRASES);
    let adultMatched = matchesAny(text, ADULT_PHRASES);

    // Mask comparative age-18 phrases so "до 18 лет" or "under 18" is not also parsed as age = 18.
    let strippedForAge = text;
    for (const pattern of [...UNDER_18_PHRASES, ...ADULT_PHRASES]) {
        const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        strippedForAge = strippedForAge.replace(globalPattern, ' ');
    }

    for (const pattern of NUMERIC_AGE_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        for (const match of strippedForAge.matchAll(regex)) {
            const parsed = Number.parseInt(match[1], 10);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) continue;
            if (parsed < 18) under18Matched = true;
            else adultMatched = true;
        }
    }

    if (under18Matched && !adultMatched) return true;
    if (adultMatched && !under18Matched) return false;
    return undefined;
}

function detectYesNo(text, positivePatterns, negativePatterns) {
    const isNo = matchesAny(text, negativePatterns);
    const isYes = matchesAny(text, positivePatterns);
    if (isNo && !isYes) return 'no';
    if (isYes && !isNo) return 'yes';
    return undefined;
}

function detectFingerprintStatus(text) {
    const isNotRegistered = matchesAny(text, FINGERPRINT_NEGATIVE);
    const isRegistered = matchesAny(text, FINGERPRINT_POSITIVE);
    if (isNotRegistered && !isRegistered) return 'not_registered';
    if (isRegistered && !isNotRegistered) return 'registered';
    return undefined;
}

/**
 * Extracts only the document-policy facts clearly supported by the student's own user turns.
 * Conservative by design: ambiguous or unsupported facts are omitted so the server asks instead of guessing.
 * @param {string[]|string} userTurns All user turn contents in chronological order.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {object} Supported subset of `get_required_documents` arguments.
 */
export function extractSupportedDocumentFacts(userTurns, language = 'tr') {
    const resolvedLanguage = CHATBOT_LANGUAGES.includes(language) ? language : 'tr';
    void resolvedLanguage;
    const turns = Array.isArray(userTurns)
        ? userTurns.filter((item) => typeof item === 'string')
        : (typeof userTurns === 'string' ? [userTurns] : []);
    if (turns.length === 0) return {};

    // Join turns with newlines so adjacency rules never bridge across separate turns.
    const normalizedText = turns.map(normalizeForEvidence).join('\n');

    const supported = {};
    const applicationType = detectUniqueEnumMatch(normalizedText, APPLICATION_TYPE_PATTERNS);
    if (applicationType) supported.application_type = applicationType;

    const isUnder18 = detectUnder18(normalizedText);
    if (typeof isUnder18 === 'boolean') supported.is_under_18 = isUnder18;

    const accommodationType = detectUniqueEnumMatch(normalizedText, ACCOMMODATION_PATTERNS);
    if (accommodationType) supported.accommodation_type = accommodationType;

    const hostMarried = detectYesNo(normalizedText, HOST_MARRIED_POSITIVE, HOST_MARRIED_NEGATIVE);
    if (hostMarried) supported.host_is_married = hostMarried;

    const hostTurkish = detectYesNo(normalizedText, HOST_TURKISH_POSITIVE, HOST_TURKISH_NEGATIVE);
    if (hostTurkish) supported.host_is_turkish = hostTurkish;

    const fingerprintStatus = detectFingerprintStatus(normalizedText);
    if (fingerprintStatus) supported.fingerprint_status = fingerprintStatus;

    return supported;
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Keeps model-supplied `get_required_documents` facts only when supported by the student's own words.
 * Invalid non-null field values are preserved so `executeChatbotTool` still rejects them with VALIDATION_ERROR.
 * @param {unknown} rawArgs Untrusted arguments produced by the model.
 * @param {string[]|string} userTurns All user turns in the conversation.
 * @param {string} [language='tr'] Portal language (`tr`, `en`, `ru`, `tk`, `ar`).
 * @returns {unknown} Filtered arguments safe to pass to `executeChatbotTool`.
 */
export function filterDocumentArgsByEvidence(rawArgs, userTurns, language = 'tr') {
    if (!isPlainObject(rawArgs)) return rawArgs;
    const supported = extractSupportedDocumentFacts(userTurns, language);
    const filtered = { ...rawArgs };

    const validChecks = {
        application_type: (v) => typeof v === 'string' && TOOL_APPLICATION_TYPES.includes(v),
        is_under_18: (v) => typeof v === 'boolean',
        accommodation_type: (v) => typeof v === 'string' && ACCOMMODATION_TYPES.includes(v),
        host_is_married: (v) => typeof v === 'string' && DOCUMENT_ANSWER_OPTIONS.host_is_married.includes(v),
        host_is_turkish: (v) => typeof v === 'string' && DOCUMENT_ANSWER_OPTIONS.host_is_turkish.includes(v),
        fingerprint_status: (v) => typeof v === 'string' && FINGERPRINT_STATUSES.includes(v)
    };

    for (const [key, isValidValue] of Object.entries(validChecks)) {
        if (!Object.hasOwn(filtered, key) || filtered[key] === undefined || filtered[key] === null) {
            continue;
        }
        if (!isValidValue(filtered[key])) {
            continue;
        }
        if (supported[key] !== filtered[key]) {
            delete filtered[key];
        }
    }

    return filtered;
}
