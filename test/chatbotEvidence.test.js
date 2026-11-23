import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    EVIDENCE_PATTERN_LISTS,
    QUOTED_FACT_VALUE_STEMS,
    extractSupportedDocumentFacts,
    filterDocumentArgsByEvidence,
    hasEvidenceRisk,
    normalizeForEvidence,
    verifyQuotedFact
} from '../src/server/domain/chatbotEvidence.js';
import { executeChatbotTool } from '../src/server/domain/chatbotTools.js';
import {
    CHATBOT_ROUTE_NORMALIZED_PATTERNS,
    isAskingWhichDocumentsAreNeeded,
    isDeterministicHandoffRequest,
    isOtherStudentsDataRequest,
    isStatusQuestionWithoutReference,
    isStudentCardQuestion,
    isVeryShortDocumentQuestion
} from '../src/server/routes/chatbotRoutes.js';

test('E1 examples extract only facts actually stated by the student', () => {
    assert.deepEqual(
        extractSupportedDocumentFacts(['İkamet için hangi belgeler lazım? İlk başvuru, 20 yaşındayım.'], 'tr'),
        { application_type: 'initial', is_under_18: false }
    );

    assert.deepEqual(
        extractSupportedDocumentFacts(['Taahhütname ile kalıyorum, uzatma, 19 yaşındayım'], 'tr'),
        { application_type: 'renewal', is_under_18: false, accommodation_type: 'undertaking' }
    );

    assert.deepEqual(extractSupportedDocumentFacts(['документы?'], 'ru'), {});
    assert.deepEqual(extractSupportedDocumentFacts(['المستندات؟'], 'ar'), {});
});

test('application_type lexicon recognizes at least two phrasings per language including missing diacritics', () => {
    const cases = [
        // tr
        { lang: 'tr', text: 'İlk başvuru yapacağım', expected: 'initial' },
        { lang: 'tr', text: 'ilk kez ikamet basvurusu', expected: 'initial' },
        { lang: 'tr', text: 'Uzatma başvurusu', expected: 'renewal' },
        { lang: 'tr', text: 'ikametimi yenileme istiyorum', expected: 'renewal' },
        { lang: 'tr', text: 'Geçiş başvurusu yapacağım', expected: 'transition' },
        { lang: 'tr', text: 'ogrenci ikametine gecis', expected: 'transition' },
        // en
        { lang: 'en', text: 'Initial application documents', expected: 'initial' },
        { lang: 'en', text: 'applying for the first time', expected: 'initial' },
        { lang: 'en', text: 'Renewal of student permit', expected: 'renewal' },
        { lang: 'en', text: 'I want to extend my residence', expected: 'renewal' },
        { lang: 'en', text: 'Transition to student permit', expected: 'transition' },
        { lang: 'en', text: 'switching from another permit', expected: 'transition' },
        // ru
        { lang: 'ru', text: 'Первичная подача на ВНЖ', expected: 'initial' },
        { lang: 'ru', text: 'подаю документы впервые', expected: 'initial' },
        { lang: 'ru', text: 'Продление студенческого ВНЖ', expected: 'renewal' },
        { lang: 'ru', text: 'нужно продлить икамет', expected: 'renewal' },
        { lang: 'ru', text: 'Переход на студенческий ВНЖ', expected: 'transition' },
        { lang: 'ru', text: 'хочу перейти на учебный ВНЖ', expected: 'transition' },
        // tk
        { lang: 'tk', text: 'Ilkinji arza berjek', expected: 'initial' },
        { lang: 'tk', text: 'ilkinji gezek ikamet aljak', expected: 'initial' },
        { lang: 'tk', text: 'Uzatma arzasy üçin', expected: 'renewal' },
        { lang: 'tk', text: 'ikametimi uzaltmak isleýärin', expected: 'renewal' },
        { lang: 'tk', text: 'Geçiş arzasy tabşyrjak', expected: 'transition' },
        { lang: 'tk', text: 'gecis ucin resminamalar', expected: 'transition' },
        // ar
        { lang: 'ar', text: 'أقدم طلباً أولياً للإقامة', expected: 'initial' },
        { lang: 'ar', text: 'للمرة الأولى أقدم على الإقامة', expected: 'initial' },
        { lang: 'ar', text: 'طلب تمديد إقامة', expected: 'renewal' },
        { lang: 'ar', text: 'أريد تجديد الإقامة الطلابية', expected: 'renewal' },
        { lang: 'ar', text: 'طلب تحويل إلى إقامة طالب', expected: 'transition' },
        { lang: 'ar', text: 'انتقال إلى إقامة الطالب', expected: 'transition' }
    ];

    for (const item of cases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.application_type, item.expected, `Failed for ${item.lang}: ${item.text}`);
    }
});

test('accommodation_type lexicon recognizes at least two phrasings per language and avoids false positives', () => {
    const cases = [
        // dormitory
        { lang: 'tr', text: 'Öğrenci yurdunda kalıyorum', expected: 'dormitory' },
        { lang: 'tr', text: 'yurt belgesi lazım', expected: 'dormitory' },
        { lang: 'en', text: 'staying in a dormitory', expected: 'dormitory' },
        { lang: 'en', text: 'crashing in a university dorm', expected: 'dormitory' },
        { lang: 'ru', text: 'живу в общежитии', expected: 'dormitory' },
        { lang: 'ru', text: 'живу в общаге', expected: 'dormitory' },
        { lang: 'tk', text: 'umumy ýaşaýyş jaýynda galýaryn', expected: 'dormitory' },
        { lang: 'tk', text: 'obshagada galyan', expected: 'dormitory' },
        { lang: 'ar', text: 'أقيم في السكن الطلابي', expected: 'dormitory' },
        { lang: 'ar', text: 'اسكن في سكن جامعي', expected: 'dormitory' },
        // rental_contract
        { lang: 'tr', text: 'Kira sözleşmesi ile kalıyorum', expected: 'rental_contract' },
        { lang: 'tr', text: 'kirada oturuyorum', expected: 'rental_contract' },
        { lang: 'en', text: 'living with a rental contract', expected: 'rental_contract' },
        { lang: 'en', text: 'I am renting a flat', expected: 'rental_contract' },
        { lang: 'ru', text: 'по договору аренды', expected: 'rental_contract' },
        { lang: 'ru', text: 'снимаю квартиру в Стамбуле', expected: 'rental_contract' },
        { lang: 'tk', text: 'kärende şertnamasy bilen', expected: 'rental_contract' },
        { lang: 'tk', text: 'kireýine öýde ýaşaýaryn', expected: 'rental_contract' },
        { lang: 'ar', text: 'لدي عقد إيجار', expected: 'rental_contract' },
        { lang: 'ar', text: 'أسكن في شقة مستأجرة بإيجار', expected: 'rental_contract' },
        // own_home
        { lang: 'tr', text: 'Kendi evimde kalıyorum', expected: 'own_home' },
        { lang: 'tr', text: 'tapum var', expected: 'own_home' },
        { lang: 'en', text: 'living in my own home', expected: 'own_home' },
        { lang: 'en', text: 'I have a title deed', expected: 'own_home' },
        { lang: 'ru', text: 'живу в собственном жилье', expected: 'own_home' },
        { lang: 'ru', text: 'квартира в собственности (тапу)', expected: 'own_home' },
        { lang: 'tk', text: 'öz öýümde ýaşaýaryn', expected: 'own_home' },
        { lang: 'tk', text: 'oz oyum bar', expected: 'own_home' },
        { lang: 'ar', text: 'أقيم في منزل أملكه', expected: 'own_home' },
        { lang: 'ar', text: 'لدي سند ملكية لمنزلي', expected: 'own_home' },
        // hotel
        { lang: 'tr', text: 'Otelde kalıyorum', expected: 'hotel' },
        { lang: 'tr', text: 'otel rezervasyonum var', expected: 'hotel' },
        { lang: 'en', text: 'staying at a hotel', expected: 'hotel' },
        { lang: 'en', text: 'hotel accommodation', expected: 'hotel' },
        { lang: 'ru', text: 'живу в отеле', expected: 'hotel' },
        { lang: 'ru', text: 'остановился в гостинице', expected: 'hotel' },
        { lang: 'tk', text: 'myhmanhanada galýaryn', expected: 'hotel' },
        { lang: 'tk', text: 'myhmanhana resminamasy', expected: 'hotel' },
        { lang: 'ar', text: 'أسكن في فندق', expected: 'hotel' },
        { lang: 'ar', text: 'إقامتي في الفندق', expected: 'hotel' },
        // undertaking
        { lang: 'tr', text: 'Taahhütname ile kalıyorum', expected: 'undertaking' },
        { lang: 'tr', text: 'akrabamın yanında kalıyorum', expected: 'undertaking' },
        { lang: 'en', text: 'staying with a host via undertaking', expected: 'undertaking' },
        { lang: 'en', text: 'living with a relative', expected: 'undertaking' },
        { lang: 'ru', text: 'живу по нотариальному обязательству', expected: 'undertaking' },
        { lang: 'ru', text: 'остановился у родственников', expected: 'undertaking' },
        { lang: 'tk', text: 'borçnama bilen galýaryn', expected: 'undertaking' },
        { lang: 'tk', text: 'garyndaşymyň öýünde ýaşaýaryn', expected: 'undertaking' },
        { lang: 'ar', text: 'أسكن بتعهد لدى شخص', expected: 'undertaking' },
        { lang: 'ar', text: 'أقيم لدى قريب بكفالة', expected: 'undertaking' },
        // residence_certificate
        { lang: 'tr', text: 'adres kaydı ile başvuracağım', expected: 'residence_certificate' },
        { lang: 'tr', text: 'yerleşim yeri belgesi kullanacağım', expected: 'residence_certificate' },
        { lang: 'en', text: 'using a residence certificate', expected: 'residence_certificate' },
        { lang: 'en', text: 'my registered address from e-Devlet', expected: 'residence_certificate' },
        { lang: 'ru', text: 'справка о месте жительства из e-Devlet', expected: 'residence_certificate' },
        { lang: 'ru', text: 'регистрация по адресу', expected: 'residence_certificate' },
        { lang: 'tk', text: 'hasaba alnan salgy bilen', expected: 'residence_certificate' },
        { lang: 'tk', text: 'ýaşaýan ýeri şahadatnamasy', expected: 'residence_certificate' },
        { lang: 'ar', text: 'أستخدم شهادة محل الإقامة', expected: 'residence_certificate' },
        { lang: 'ar', text: 'لدي العنوان المسجل في e-Devlet', expected: 'residence_certificate' }
    ];

    for (const item of cases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.accommodation_type, item.expected, `Failed for ${item.lang}: ${item.text}`);
    }

    // False positive checks: "yurtdışı" != dormitory; "kira... arkadaşla" != undertaking.
    assert.equal(extractSupportedDocumentFacts(['Yurtdışından geldim belgeler neler?'], 'tr').accommodation_type, undefined);
    assert.equal(
        extractSupportedDocumentFacts(['arkadasla kira sozlesmesi yaptik'], 'tr').accommodation_type,
        'rental_contract'
    );
});

test('age (is_under_18) lexicon recognizes numbers and minor/adult phrases across all five languages', () => {
    const cases = [
        // tr
        { lang: 'tr', text: '17 yaşındayım', expected: true },
        { lang: 'tr', text: '18 yaşından küçüğüm', expected: true },
        { lang: 'tr', text: '20 yasindayim', expected: false },
        { lang: 'tr', text: '18 yaşından küçük değilim', expected: false },
        // en
        { lang: 'en', text: 'I am 16 years old', expected: true },
        { lang: 'en', text: 'I am a minor (under 18)', expected: true },
        { lang: 'en', text: 'I am 22', expected: false },
        { lang: 'en', text: 'I am not under 18, I am an adult', expected: false },
        // ru
        { lang: 'ru', text: 'Мне 17 лет', expected: true },
        { lang: 'ru', text: 'я несовершеннолетний, до 18 лет', expected: true },
        { lang: 'ru', text: 'Мне 21 год', expected: false },
        { lang: 'ru', text: 'я совершеннолетний, старше 18', expected: false },
        // tk
        { lang: 'tk', text: 'Men 17 ýaşymda', expected: true },
        { lang: 'tk', text: 'kämillik ýaşyna ýetmedik (18 ýaşdan kiçi)', expected: true },
        { lang: 'tk', text: '23 yasymda', expected: false },
        { lang: 'tk', text: '18 ýaşdan uly', expected: false },
        // ar
        { lang: 'ar', text: 'عمري 17 سنة', expected: true },
        { lang: 'ar', text: 'أنا قاصر أقل من 18', expected: true },
        { lang: 'ar', text: 'عمري 20 سنة', expected: false },
        { lang: 'ar', text: 'لست أقل من 18 أنا بالغ', expected: false }
    ];

    for (const item of cases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.is_under_18, item.expected, `Failed for ${item.lang}: ${item.text}`);
    }

    // Non-age numbers must not trigger age detection.
    assert.equal(extractSupportedDocumentFacts(['10 MB ve 20 dosya sınırı nedir?'], 'tr').is_under_18, undefined);
});

test('host_is_married and host_is_turkish lexicons recognize affirmative and negative phrasings across all five languages', () => {
    const cases = [
        // tr
        { lang: 'tr', text: 'Taahhüt veren kişi evli ve Türk vatandaşı', married: 'yes', turkish: 'yes' },
        { lang: 'tr', text: 'Taahhüt veren kişi evli değil ve Türk vatandaşı değil', married: 'no', turkish: 'no' },
        // en
        { lang: 'en', text: 'My host is married and is a Turkish citizen', married: 'yes', turkish: 'yes' },
        { lang: 'en', text: 'host is not married and not a Turkish citizen', married: 'no', turkish: 'no' },
        // ru
        { lang: 'ru', text: 'Принимающее лицо состоит в браке и является гражданином Турции', married: 'yes', turkish: 'yes' },
        { lang: 'ru', text: 'Принимающее лицо не женат и не гражданин Турции', married: 'no', turkish: 'no' },
        // tk
        { lang: 'tk', text: 'Borçnama berýän adam öýlenen we Türkiýäniň raýaty', married: 'yes', turkish: 'yes' },
        { lang: 'tk', text: 'Borçnama berýän adam öýlenmedik we Türkiýäniň raýaty däl', married: 'no', turkish: 'no' },
        // ar
        { lang: 'ar', text: 'مقدم التعهد متزوج ومواطن تركي', married: 'yes', turkish: 'yes' },
        { lang: 'ar', text: 'مقدم التعهد غير متزوج وليس مواطن تركي', married: 'no', turkish: 'no' }
    ];

    for (const item of cases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.host_is_married, item.married, `Married failed for ${item.lang}: ${item.text}`);
        assert.equal(result.host_is_turkish, item.turkish, `Turkish failed for ${item.lang}: ${item.text}`);
    }

    // Bare married/nationality phrases without host context must not produce host facts.
    for (const item of [
        { lang: 'tr', text: 'evli değil, Türk vatandaşı değil' },
        { lang: 'ru', text: 'не женат и не гражданин Турции' },
        { lang: 'tk', text: 'öýlenmedik, Türkiýäniň raýaty däl' },
        { lang: 'ar', text: 'غير متزوج وليس مواطن تركي' }
    ]) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.host_is_married, undefined, `Expected no host_is_married without host context: ${item.text}`);
        assert.equal(result.host_is_turkish, undefined, `Expected no host_is_turkish without host context: ${item.text}`);
    }

    // "Turkish residence permit" must not falsely imply host_is_turkish.
    assert.equal(extractSupportedDocumentFacts(['Turkish student residence permit, initial, 20'], 'en').host_is_turkish, undefined);
    assert.equal(extractSupportedDocumentFacts(['Türk öğrenci ikamet izni'], 'tr').host_is_turkish, undefined);
});

test('fingerprint_status lexicon recognizes registered and not_registered phrasings across all five languages', () => {
    const cases = [
        // tr
        { lang: 'tr', text: 'Göç İdaresinde parmak izi kaydım var', expected: 'registered' },
        { lang: 'tr', text: 'parmak izi kaydım yok', expected: 'not_registered' },
        // en
        { lang: 'en', text: 'my fingerprints are registered with migration', expected: 'registered' },
        { lang: 'en', text: 'my fingerprint is not registered yet', expected: 'not_registered' },
        // ru
        { lang: 'ru', text: 'отпечатки пальцев уже зарегистрированы', expected: 'registered' },
        { lang: 'ru', text: 'отпечатки пальцев не сдавали, регистрации нет', expected: 'not_registered' },
        // tk
        { lang: 'tk', text: 'barmak yzy hasabym bar', expected: 'registered' },
        { lang: 'tk', text: 'barmak yzy hasabym ýok', expected: 'not_registered' },
        // ar
        { lang: 'ar', text: 'بصماتي مسجلة لدى إدارة الهجرة', expected: 'registered' },
        { lang: 'ar', text: 'بصماتي غير مسجلة', expected: 'not_registered' }
    ];

    for (const item of cases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.fingerprint_status, item.expected, `Failed for ${item.lang}: ${item.text}`);
    }
});

test('ambiguous user statements are omitted and filterDocumentArgsByEvidence strips unsupported defaults', () => {
    assert.deepEqual(
        extractSupportedDocumentFacts(['İlk başvuru mu uzatma mı için belge lazım?'], 'tr'),
        {}
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['Yurt veya kiralık ev için, 20 yaşındayım'], 'tr'),
        { is_under_18: false }
    );

    const modelArgs = {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'dormitory'
    };
    const filtered = filterDocumentArgsByEvidence(
        modelArgs,
        ['İkamet için hangi belgeler lazım? İlk başvuru, 20 yaşındayım.'],
        'tr'
    );
    assert.deepEqual(filtered, {
        application_type: 'initial',
        is_under_18: false
    });

    // Invalid non-null enum values remain intact so tool validation rejects them.
    const invalidPreserved = filterDocumentArgsByEvidence(
        { application_type: 'tourist', accommodation_type: 'dormitory' },
        ['İlk başvuru'],
        'tr'
    );
    assert.deepEqual(invalidPreserved, { application_type: 'tourist' });
});

test('regression: combined Russian and Arabic renewal+dormitory+adult sentences extract all supported facts', () => {
    assert.deepEqual(
        extractSupportedDocumentFacts(['живу в общежитии, продление, мне 20 лет'], 'ru'),
        {
            application_type: 'renewal',
            is_under_18: false,
            accommodation_type: 'dormitory'
        }
    );

    assert.deepEqual(
        extractSupportedDocumentFacts(
            ['ما المستندات المطلوبة لتمديد الإقامة؟ عمري 21 سنة وأقيم في السكن الطلابي'],
            'ar'
        ),
        {
            application_type: 'renewal',
            is_under_18: false,
            accommodation_type: 'dormitory'
        }
    );
});

test('regression: every E3 handoff phrase and non-ASCII handoff keyword matches isDeterministicHandoffRequest', () => {
    const e3HandoffPhrases = [
        'I want to talk to a real person',
        'need help from staff',
        'Я хочу поговорить с человеком',
        'У меня жалоба, нужна помощь сотрудника',
        'لدي شكوى وأريد التحدث مع موظف',
        'Acil bir durumum var, insanla görüşmek istiyorum',
        'Özel durumum için ofise ulaşmak istiyorum',
        'Adam bilen gürleşmek isleýärin, arzam barada'
    ];

    for (const phrase of e3HandoffPhrases) {
        assert.equal(isDeterministicHandoffRequest(phrase), true, `Expected handoff match for: ${phrase}`);
    }

    assert.equal(isDeterministicHandoffRequest('У меня жалоба'), true);
    assert.equal(isDeterministicHandoffRequest('нужна помощь сотрудника'), true);
    assert.equal(isDeterministicHandoffRequest('لدي شكوى'), true);
    assert.equal(isDeterministicHandoffRequest('الأمر عاجل'), true);
});

function collectNormalizedPatternSources(value, path, out = []) {
    if (value instanceof RegExp) {
        out.push({ path, raw: value.source });
        return out;
    }
    if (typeof value === 'string') {
        out.push({ path, raw: value });
        return out;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectNormalizedPatternSources(item, `${path}[${index}]`, out));
        return out;
    }
    if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
            collectNormalizedPatternSources(entry, `${path}.${key}`, out);
        }
    }
    return out;
}

test('guard: all evidence and route pattern literals are already in normalizeForEvidence form', () => {
    assert.equal(Object.isFrozen(QUOTED_FACT_VALUE_STEMS), true);
    for (const stemsByValue of Object.values(QUOTED_FACT_VALUE_STEMS)) {
        assert.equal(Object.isFrozen(stemsByValue), true);
        for (const stemList of Object.values(stemsByValue)) {
            assert.equal(Object.isFrozen(stemList), true);
        }
    }

    const unnormalizedCharPattern = /[йёýňäüžşçğöıİأإآٱةىؤئ\u064B-\u065F\u0670\u0640]/u;
    const entries = [
        ...collectNormalizedPatternSources(EVIDENCE_PATTERN_LISTS, 'EVIDENCE_PATTERN_LISTS'),
        ...collectNormalizedPatternSources(QUOTED_FACT_VALUE_STEMS, 'QUOTED_FACT_VALUE_STEMS'),
        ...collectNormalizedPatternSources(CHATBOT_ROUTE_NORMALIZED_PATTERNS, 'CHATBOT_ROUTE_NORMALIZED_PATTERNS')
    ];

    assert.ok(entries.length > 0, 'Expected at least one pattern entry to check');

    for (const { path, raw } of entries) {
        assert.equal(
            unnormalizedCharPattern.test(raw),
            false,
            `Unnormalized character found in ${path}: ${raw}`
        );
        const withoutUnicodePropertyEscapes = raw.replace(/\\p\{[LN]\}/g, '');
        assert.equal(
            normalizeForEvidence(withoutUnicodePropertyEscapes),
            withoutUnicodePropertyEscapes,
            `Pattern source changed under normalizeForEvidence in ${path}: ${raw}`
        );
    }
});

test('regression: normalized Cyrillic and Turkmen phrasings match transition, initial, dormitory, rental, age, and standalone status', () => {
    assert.deepEqual(
        extractSupportedDocumentFacts(['хочу перейти на учебный ВНЖ'], 'ru'),
        { application_type: 'transition' }
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['подаю на ВНЖ первый раз'], 'ru'),
        { application_type: 'initial' }
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['живу в общежитии'], 'ru'),
        { accommodation_type: 'dormitory' }
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['договор найма квартиры'], 'ru'),
        { accommodation_type: 'rental_contract' }
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['мне 17 лет'], 'ru'),
        { is_under_18: true }
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['Men 17 ýaşymda'], 'tk'),
        { is_under_18: true }
    );
    assert.equal(
        CHATBOT_ROUTE_NORMALIZED_PATTERNS.STANDALONE_STATUS_PHRASES.some((phrase) =>
            normalizeForEvidence('Статус моей заявки?').includes(phrase)
        ),
        true
    );
});

test('filterDocumentArgsByEvidence fills missing facts from evidence across tr/en/ru/ar without filling unsupported keys', () => {
    const cases = [
        { lang: 'tr', text: 'İlk başvuru yapacağım, 20 yaşındayım ve öğrenci yurdunda kalıyorum. Hangi belgeler gerekli?' },
        { lang: 'en', text: 'I am applying for the first time, I am 22 and staying in a dormitory. Which documents do I need?' },
        { lang: 'ru', text: 'Первичная подача, мне 20 лет, живу в общежитии. Какие документы нужны?' },
        { lang: 'ar', text: 'طلب أولي، عمري 20 سنة وأقيم في السكن الطلابي. ما المستندات المطلوبة؟' }
    ];

    for (const item of cases) {
        const filled = filterDocumentArgsByEvidence(
            { application_type: 'initial', accommodation_type: 'dormitory' },
            [item.text],
            item.lang
        );
        assert.deepEqual(
            filled,
            { application_type: 'initial', accommodation_type: 'dormitory', is_under_18: false },
            `Failed to fill is_under_18 for ${item.lang}`
        );
    }

    // Unsupported facts must never be filled.
    const partial = filterDocumentArgsByEvidence(
        { application_type: 'initial' },
        ['İlk başvuru yapacağım, 20 yaşındayım. Hangi belgeler gerekli?'],
        'tr'
    );
    assert.deepEqual(partial, { application_type: 'initial', is_under_18: false });
    assert.equal(Object.hasOwn(partial, 'accommodation_type'), false);
});

test('file/migration status questions match status rule, bare office/migration words do not trigger handoff, and status beats office-only handoff', () => {
    const fileStatusQueries = [
        'Dosyam Göç İdaresine gönderildi mi?',
        'Was my file sent to the migration authority yet?',
        'hey did the office check my file yet? waiting for days',
        'Моё дело отправили в миграционную службу?',
        'هل تم إرسال ملفي إلى الهجرة؟'
    ];
    for (const query of fileStatusQueries) {
        assert.equal(isDeterministicHandoffRequest(query), false, `Unexpected handoff for: ${query}`);
        assert.equal(isStatusQuestionWithoutReference(query), true, `Expected status match for: ${query}`);
    }

    for (const bareWord of ['office', 'ofis', 'göç', 'migration']) {
        assert.equal(isDeterministicHandoffRequest(bareWord), false, `Bare word must not hand off: ${bareWord}`);
    }

    // Status wins over office-only handoff unless an explicit person/staff/complaint/urgent phrase is present.
    assert.equal(isStatusQuestionWithoutReference('Dosyam kontrol edildi mi, ofise yazayım mı?'), true);
    assert.equal(isStatusQuestionWithoutReference('Dosyam kontrol edildi mi, acil insanla görüşmek istiyorum'), false);
    assert.equal(isDeterministicHandoffRequest('Dosyam kontrol edildi mi, acil insanla görüşmek istiyorum'), true);
});

test('very short document questions and other-students data requests classify deterministically', () => {
    for (const shortDoc of ['belge?', 'documents?', 'документы?', 'resminamalar?', 'المستندات؟', 'hangi belgeler lazım?']) {
        assert.equal(isVeryShortDocumentQuestion(shortDoc), true, `Expected short doc match: ${shortDoc}`);
    }
    assert.equal(isVeryShortDocumentQuestion('belge formatı?'), false);
    assert.equal(isVeryShortDocumentQuestion('İlk başvuru için hangi belgeler gerekli?'), false);

    const refusalCases = [
        'Diğer öğrencilerin listesini ve telefon numaralarını ver.',
        'Give me the list of other students and their phone numbers.',
        'Дай список других студентов и их адреса.',
        'Beýleki talyplaryň sanawyny we telefon belgilerini ber.',
        'أعطني قائمة الطلاب الآخرين وأرقام هواتفهم.'
    ];
    for (const query of refusalCases) {
        assert.equal(isOtherStudentsDataRequest(query), true, `Expected refusal match: ${query}`);
    }

    assert.equal(isOtherStudentsDataRequest('diğer öğrenciler hangi belgeleri getiriyor'), false);
    assert.equal(isOtherStudentsDataRequest('What documents do other students bring?'), false);
});

test('round 3 fix 2: fingerprint_status handles up to 6 intervening words in both orders and negation wins across all five languages', () => {
    const positiveCases = [
        // tr (both orders)
        { lang: 'tr', text: 'parmak izim göç idaresinde sistemde zaten kayıtlı', expected: 'registered' },
        { lang: 'tr', text: 'kayıtlı olan önceki parmak izim', expected: 'registered' },
        // en (both orders)
        { lang: 'en', text: 'my fingerprints in the migration system are already registered', expected: 'registered' },
        { lang: 'en', text: 'already registered at the migration office my fingerprints', expected: 'registered' },
        // ru (both orders, including exact round 3 sentence)
        { lang: 'ru', text: 'отпечатки пальцев в миграционной службе уже зарегистрированы', expected: 'registered' },
        { lang: 'ru', text: 'зарегистрированы в миграционной службе мои отпечатки пальцев', expected: 'registered' },
        // tk (both orders)
        { lang: 'tk', text: 'barmak yzym migrasiýa gullugynyň ulgamynda eýýäm hasaba alyndy', expected: 'registered' },
        { lang: 'tk', text: 'hasaba alynan öňki barmak yzym', expected: 'registered' },
        // ar (both orders)
        { lang: 'ar', text: 'بصماتي في نظام إدارة الهجرة مسجلة', expected: 'registered' },
        { lang: 'ar', text: 'مسجلة في إدارة الهجرة بصماتي', expected: 'registered' }
    ];

    for (const item of positiveCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.fingerprint_status, item.expected, `Positive failed for ${item.lang}: ${item.text}`);
    }

    const negatedCases = [
        // tr
        { lang: 'tr', text: 'parmak izim göç idaresinde henüz kayıtlı değil', expected: 'not_registered' },
        { lang: 'tr', text: 'kayıtlı olmayan parmak izim', expected: 'not_registered' },
        // en
        { lang: 'en', text: 'my fingerprints in the migration system are not yet registered', expected: 'not_registered' },
        { lang: 'en', text: 'not registered at the office my fingerprints', expected: 'not_registered' },
        // ru
        { lang: 'ru', text: 'отпечатки пальцев в миграционной службе не зарегистрированы', expected: 'not_registered' },
        { lang: 'ru', text: 'не были зарегистрированы в службе отпечатки пальцев', expected: 'not_registered' },
        // tk
        { lang: 'tk', text: 'barmak yzym migrasiýa gullugynda entek hasaba alynmady', expected: 'not_registered' },
        { lang: 'tk', text: 'hasaba alynan däl barmak yzym', expected: 'not_registered' },
        // ar
        { lang: 'ar', text: 'بصماتي في إدارة الهجرة غير مسجلة', expected: 'not_registered' },
        { lang: 'ar', text: 'لم يتم تسجيل بصماتي بعد', expected: 'not_registered' }
    ];

    for (const item of negatedCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.fingerprint_status, item.expected, `Negation failed for ${item.lang}: ${item.text}`);
    }

    // Question asking whether fingerprints are needed must not trigger registered.
    assert.equal(extractSupportedDocumentFacts(['Do I have to give fingerprints?'], 'en').fingerprint_status, undefined);
    const trFpQuestion = extractSupportedDocumentFacts(['Parmak izim kayıtlı mı?'], 'tr');
    assert.equal(trFpQuestion.fingerprint_status, undefined);
    assert.ok(trFpQuestion.__uncertain.includes('fingerprint_status'));
});

test('normalizeForEvidence maps U+2018, U+2019, U+02BC, and U+FF07 apostrophe variants to ASCII', () => {
    const raw = 'host isn\u2019t married, don\u2018t have, I\u02BCm 20, didn\uFF07t';
    assert.equal(normalizeForEvidence(raw), "host isn't married, don't have, i'm 20, didn't");
});

test('__uncertain is non-enumerable and omitted keys are never returned as facts', () => {
    const clean = extractSupportedDocumentFacts(['İlk başvuru, 20 yaşındayım, yurtta kalıyorum'], 'tr');
    assert.deepEqual(clean, {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'dormitory'
    });
    assert.deepEqual(Object.keys(clean), ['application_type', 'is_under_18', 'accommodation_type']);
    assert.deepEqual(clean.__uncertain, []);
    assert.equal(hasEvidenceRisk(['İlk başvuru, 20 yaşındayım, yurtta kalıyorum'], 'tr'), false);

    const empty = extractSupportedDocumentFacts([], 'tr');
    assert.deepEqual(empty, {});
    assert.deepEqual(empty.__uncertain, []);
    assert.equal(hasEvidenceRisk([], 'tr'), false);
});

test('hardening: negated accommodation and application_type go to __uncertain and never become facts', () => {
    const dormPartial = extractSupportedDocumentFacts(
        ['İlk başvuru, 20 yaşındayım, yurtta kalmıyorum, hangi belgeler lazım?'],
        'tr'
    );
    assert.deepEqual(dormPartial, { application_type: 'initial', is_under_18: false });
    assert.deepEqual(dormPartial.__uncertain, ['accommodation_type']);
    assert.equal(hasEvidenceRisk(['İlk başvuru, 20 yaşındayım, yurtta kalmıyorum, hangi belgeler lazım?'], 'tr'), true);

    const negatedAccomCases = [
        { lang: 'ru', text: 'не живу в общежитии' },
        { lang: 'en', text: 'I do not live in a dorm' },
        { lang: 'tr', text: 'kira sözleşmem yok' },
        { lang: 'tr', text: 'otelde kalmıyorum' },
        { lang: 'tr', text: 'taahhütnamem yok' },
        { lang: 'tr', text: 'adres kaydım yok' },
        { lang: 'tk', text: 'umumy ýaşaýyş jaýynda ýaşamok' },
        { lang: 'tk', text: 'borçnama bilen galmaýaryn' },
        { lang: 'ar', text: 'لا أسكن في السكن الطلابي' }
    ];
    for (const item of negatedAccomCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.accommodation_type, undefined, `Expected no accommodation_type for: ${item.text}`);
        assert.ok(result.__uncertain.includes('accommodation_type'), `Expected __uncertain accommodation_type for: ${item.text}`);
        assert.equal(hasEvidenceRisk([item.text], item.lang), true, `Expected hasEvidenceRisk true for: ${item.text}`);
    }

    const negatedAppCases = [
        { lang: 'tr', text: 'İlk başvuru değil…' },
        { lang: 'tr', text: 'İlk başvuru değil, hangi belgeler lazım?' },
        { lang: 'en', text: 'Not an initial application…' },
        { lang: 'ru', text: 'Не первичная подача…' },
        { lang: 'tk', text: 'Ilkinji arza däl' },
        { lang: 'ar', text: 'ليس طلباً أولياً' }
    ];
    for (const item of negatedAppCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.application_type, undefined, `Expected no application_type for: ${item.text}`);
        assert.ok(result.__uncertain.includes('application_type'), `Expected __uncertain application_type for: ${item.text}`);
        assert.equal(hasEvidenceRisk([item.text], item.lang), true, `Expected hasEvidenceRisk true for: ${item.text}`);
    }
});

test('hardening: durations and non-age numbers never trigger is_under_18, and negated ages go to __uncertain', () => {
    const durationCases = [
        {
            lang: 'en',
            text: 'Initial application, I live in a dorm for 1 year',
            expected: { application_type: 'initial', accommodation_type: 'dormitory' }
        },
        {
            lang: 'ru',
            text: 'живу в общежитии 2 года',
            expected: { accommodation_type: 'dormitory' }
        },
        {
            lang: 'ar',
            text: 'سكن طلابي لمدة 4 سنوات',
            expected: { accommodation_type: 'dormitory' }
        },
        { lang: 'en', text: 'I am 2 days late', expected: {} },
        { lang: 'ru', text: 'мне 1 документ нужно заменить', expected: {} },
        {
            lang: 'tr',
            text: '15 yıldır yurtta kalıyorum',
            expected: { accommodation_type: 'dormitory' }
        },
        {
            lang: 'en',
            text: 'I have lived in a dorm for 15 years',
            expected: { accommodation_type: 'dormitory' }
        },
        {
            lang: 'ru',
            text: 'живу в общежитии 15 лет',
            expected: { accommodation_type: 'dormitory' }
        },
        {
            lang: 'ar',
            text: 'سكن طلابي لمدة 15 سنة',
            expected: { accommodation_type: 'dormitory' }
        }
    ];
    for (const item of durationCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, item.expected, `Duration leaked into age for ${item.lang}: ${item.text}`);
        assert.equal(result.is_under_18, undefined);
    }

    const negatedAgeCases = [
        { lang: 'tr', text: '18 yaşında değilim' },
        { lang: 'en', text: 'I am not 18' },
        { lang: 'ru', text: 'Мне не 18 лет' },
        { lang: 'en', text: 'I am not an adult' },
        { lang: 'tr', text: 'yetişkin değilim' }
    ];
    for (const item of negatedAgeCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.is_under_18, undefined, `Expected no is_under_18 for negated age: ${item.text}`);
        assert.ok(result.__uncertain.includes('is_under_18'), `Expected __uncertain is_under_18 for: ${item.text}`);
        assert.equal(hasEvidenceRisk([item.text], item.lang), true);
    }

    // Explicit Russian and English age variants continue to work when unambiguous.
    assert.equal(extractSupportedDocumentFacts(['мне уже 17 лет'], 'ru').is_under_18, true);
    assert.equal(extractSupportedDocumentFacts(['мне исполнилось 18 лет'], 'ru').is_under_18, false);
    assert.equal(extractSupportedDocumentFacts(['19 лет от роду'], 'ru').is_under_18, false);
    assert.equal(extractSupportedDocumentFacts(['I am 20 years'], 'en').is_under_18, false);
    assert.equal(extractSupportedDocumentFacts(['I am 17 y.o.'], 'en').is_under_18, true);
});

test('hardening: apostrophe normalization, host-only context, host questions, and fingerprint conflicts', () => {
    const curlyHost = extractSupportedDocumentFacts(['the host isn\u2019t married and isn\u2019t Turkish'], 'en');
    assert.deepEqual(curlyHost, {
        host_is_married: 'no',
        host_is_turkish: 'no'
    });
    assert.equal(curlyHost.accommodation_type, undefined);
    assert.deepEqual(curlyHost.__uncertain, []);
    assert.equal(hasEvidenceRisk(['the host isn\u2019t married and isn\u2019t Turkish'], 'en'), true);

    const curlyFp1 = extractSupportedDocumentFacts(['I don\u2019t have fingerprints'], 'en');
    assert.deepEqual(curlyFp1, { fingerprint_status: 'not_registered' });
    assert.deepEqual(curlyFp1.__uncertain, []);
    assert.equal(hasEvidenceRisk(['I don\u2019t have fingerprints'], 'en'), true);

    const curlyFp2 = extractSupportedDocumentFacts(["I didn't have fingerprints taken"], 'en');
    assert.deepEqual(curlyFp2, { fingerprint_status: 'not_registered' });
    assert.deepEqual(curlyFp2.__uncertain, []);
    assert.equal(hasEvidenceRisk(["I didn't have fingerprints taken"], 'en'), true);

    const hostQuestion = extractSupportedDocumentFacts(['Taahhüt veren kişi Türk vatandaşı mı?'], 'tr');
    assert.equal(hostQuestion.host_is_turkish, undefined);
    assert.ok(hostQuestion.__uncertain.includes('host_is_turkish'));
    assert.equal(hasEvidenceRisk(['Taahhüt veren kişi Türk vatandaşı mı?'], 'tr'), true);

    const hostQuestionRu = extractSupportedDocumentFacts(['Хозяин женат ли?'], 'ru');
    assert.equal(hostQuestionRu.host_is_married, undefined);
    assert.ok(hostQuestionRu.__uncertain.includes('host_is_married'));

    const selfDesc = extractSupportedDocumentFacts(
        ['Ben bekarım, yabancı vatandaşım, … akrabamın yanında taahhütname ile kalıyorum'],
        'tr'
    );
    assert.deepEqual(selfDesc, { accommodation_type: 'undertaking' });
    assert.equal(selfDesc.host_is_married, undefined);
    assert.equal(selfDesc.host_is_turkish, undefined);
    assert.deepEqual(selfDesc.__uncertain, []);

    const selfDescSingleClause = extractSupportedDocumentFacts(
        ['I am single and not Turkish and staying with a relative'],
        'en'
    );
    assert.equal(selfDescSingleClause.accommodation_type, 'undertaking');
    assert.equal(selfDescSingleClause.host_is_married, undefined);
    assert.equal(selfDescSingleClause.host_is_turkish, undefined);

    const fpConflict = extractSupportedDocumentFacts(
        ['parmak izim kayıtlı ama parmak izi kaydım yok'],
        'tr'
    );
    assert.equal(fpConflict.fingerprint_status, undefined);
    assert.ok(fpConflict.__uncertain.includes('fingerprint_status'));
    assert.equal(hasEvidenceRisk(['parmak izim kayıtlı ama parmak izi kaydım yok'], 'tr'), true);

    const fpConflictEn = extractSupportedDocumentFacts(
        ["my fingerprints are registered, wait I didn't have fingerprints taken"],
        'en'
    );
    assert.equal(fpConflictEn.fingerprint_status, undefined);
    assert.ok(fpConflictEn.__uncertain.includes('fingerprint_status'));
});

test('hardening: tightened homographs and conflicting values', () => {
    assert.deepEqual(extractSupportedDocumentFacts(['перевод документов'], 'ru'), {});
    assert.deepEqual(
        extractSupportedDocumentFacts(['перевод ВНЖ на студенческий'], 'ru'),
        { application_type: 'transition' }
    );

    assert.deepEqual(extractSupportedDocumentFacts(['قريب'], 'ar'), {});
    assert.deepEqual(extractSupportedDocumentFacts(['سأقدم قريباً'], 'ar'), {});
    assert.deepEqual(
        extractSupportedDocumentFacts(['أسكن عند قريبي'], 'ar'),
        { accommodation_type: 'undertaking' }
    );

    assert.deepEqual(extractSupportedDocumentFacts(['ilk olarak ne yapmalıyım'], 'tr'), {});
    assert.deepEqual(extractSupportedDocumentFacts(['first page of passport'], 'en'), {});
    assert.deepEqual(
        extractSupportedDocumentFacts(['ilk kere başvuru'], 'tr'),
        { application_type: 'initial' }
    );

    const appConflict = extractSupportedDocumentFacts(['İlk başvuru mu uzatma mı için belge lazım?'], 'tr');
    assert.equal(appConflict.application_type, undefined);
    assert.ok(appConflict.__uncertain.includes('application_type'));
    assert.equal(hasEvidenceRisk(['İlk başvuru mu uzatma mı için belge lazım?'], 'tr'), true);

    // filterDocumentArgsByEvidence strips model-supplied values when fact is uncertain.
    const filteredUncertain = filterDocumentArgsByEvidence(
        { application_type: 'initial', is_under_18: false, accommodation_type: 'dormitory' },
        ['İlk başvuru, 20 yaşındayım, yurtta kalmıyorum, hangi belgeler lazım?'],
        'tr'
    );
    assert.deepEqual(filteredUncertain, { application_type: 'initial', is_under_18: false });
});

test('corrective A: question particles are language-specific so English "my" extracts facts while Turkmen "my" remains a question', () => {
    const enExtend = extractSupportedDocumentFacts(['I want to extend my residence'], 'en');
    assert.deepEqual(enExtend, { application_type: 'renewal' });
    assert.deepEqual(enExtend.__uncertain, []);

    const enOwnHome = extractSupportedDocumentFacts(['living in my own home'], 'en');
    assert.deepEqual(enOwnHome, { accommodation_type: 'own_home' });
    assert.deepEqual(enOwnHome.__uncertain, []);

    const enHost = extractSupportedDocumentFacts(['My host is married and is a Turkish citizen'], 'en');
    assert.deepEqual(enHost, { host_is_married: 'yes', host_is_turkish: 'yes' });
    assert.deepEqual(enHost.__uncertain, []);

    const enFingerprint = extractSupportedDocumentFacts(['my fingerprints are registered with migration'], 'en');
    assert.deepEqual(enFingerprint, { fingerprint_status: 'registered' });
    assert.deepEqual(enFingerprint.__uncertain, []);

    const tkQuestionApp = extractSupportedDocumentFacts(['Uzatma my?'], 'tk');
    assert.equal(tkQuestionApp.application_type, undefined);
    assert.ok(tkQuestionApp.__uncertain.includes('application_type'));

    const tkQuestionAccom = extractSupportedDocumentFacts(['Umumy ýaşaýyş jaýynda galýar my?'], 'tk');
    assert.equal(tkQuestionAccom.accommodation_type, undefined);
    assert.ok(tkQuestionAccom.__uncertain.includes('accommodation_type'));

    const tkQuestionFp = extractSupportedDocumentFacts(['Barmak yzy hasaby bar my?'], 'tk');
    assert.equal(tkQuestionFp.fingerprint_status, undefined);
    assert.ok(tkQuestionFp.__uncertain.includes('fingerprint_status'));

    const enAuxQuestion = extractSupportedDocumentFacts(['Is my host married?'], 'en');
    assert.equal(enAuxQuestion.host_is_married, undefined);
    assert.ok(enAuxQuestion.__uncertain.includes('host_is_married'));
});

test('corrective B: negated minor phrases resolve to is_under_18=false across all five languages without uncertainty', () => {
    const combinedTr = extractSupportedDocumentFacts(['18 yaşından küçük değilim, uzatma, yurtta kalıyorum'], 'tr');
    assert.deepEqual(combinedTr, {
        application_type: 'renewal',
        is_under_18: false,
        accommodation_type: 'dormitory'
    });
    assert.deepEqual(combinedTr.__uncertain, []);

    const cases = [
        { lang: 'tr', text: '18 yaşından küçük değilim' },
        { lang: 'en', text: 'I am not under 18' },
        { lang: 'ru', text: 'мне не меньше 18' },
        { lang: 'tk', text: '18 ýaşdan kiçi däl' },
        { lang: 'ar', text: 'لست قاصراً' }
    ];
    for (const item of cases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.is_under_18, false, `Expected is_under_18=false for ${item.lang}: ${item.text}`);
        assert.deepEqual(result.__uncertain, [], `Expected no __uncertain for ${item.lang}: ${item.text}`);
    }
});

test('corrective C: bare host words give host context only, while undertaking/stay-with words produce undertaking', () => {
    const bareHostCases = [
        { lang: 'tr', text: 'ev sahibi evli ve Türk vatandaşı', married: 'yes', turkish: 'yes' },
        { lang: 'en', text: 'My host is married and is a Turkish citizen', married: 'yes', turkish: 'yes' },
        { lang: 'ru', text: 'Принимающее лицо не женат и не гражданин Турции', married: 'no', turkish: 'no' },
        { lang: 'tk', text: 'Hojaýyn öýlenen we Türkiýäniň raýaty', married: 'yes', turkish: 'yes' },
        { lang: 'ar', text: 'المضيف متزوج ومواطن تركي', married: 'yes', turkish: 'yes' }
    ];
    for (const item of bareHostCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.accommodation_type, undefined, `Bare host must not set undertaking for ${item.lang}: ${item.text}`);
        assert.equal(result.host_is_married, item.married);
        assert.equal(result.host_is_turkish, item.turkish);
    }

    const undertakingCases = [
        { lang: 'tr', text: 'tanıdık yanında kalıyorum' },
        { lang: 'en', text: 'staying with a host' },
        { lang: 'en', text: 'living with a friend' },
        { lang: 'ru', text: 'живу у друга' },
        { lang: 'tk', text: 'tanyşyň ýanynda ýaşaýaryn' },
        { lang: 'ar', text: 'أسكن مع صديق' }
    ];
    for (const item of undertakingCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.accommodation_type, 'undertaking', `Expected undertaking for ${item.lang}: ${item.text}`);
    }
});

test('corrective D: isAskingWhichDocumentsAreNeeded separates list intent from how-to/troubleshooting questions', () => {
    const listQueries = [
        'Parmak izi durumuma göre hangi belgeler gerekir?',
        'İkamet için belgeler neler, gerekli belgeler veya belge listesi lazım',
        'Which documents do I need for renewal?',
        'Please send the required documents list',
        'Какие документы нужны? Список документов, что нужно?',
        'Haýsy resminamalar gerek? Resminamalar sanawy näme?',
        'ما المستندات المطلوبة؟ قائمة المستندات ما الوثائق؟'
    ];
    for (const query of listQueries) {
        assert.equal(isAskingWhichDocumentsAreNeeded(query), true, `Expected list intent for: ${query}`);
    }

    const nonListQueries = [
        'Başka bir öğrenciyle aynı evde kalıyorum, adres belgesi nasıl olmalı?',
        'belge yüklerken hata alıyorum',
        'belge formatı nedir?',
        'What document format should I upload?',
        '20 yaşındayım, kira sözleşmesi ile ilk başvuruda neler gerekir?'
    ];
    for (const query of nonListQueries) {
        assert.equal(isAskingWhichDocumentsAreNeeded(query), false, `Expected non-list intent for: ${query}`);
    }
});

test('corrective E: yes/no question marks route facts to __uncertain while WH-questions preserve presupposed facts', () => {
    const ruFpQuestion = extractSupportedDocumentFacts(['Мои отпечатки пальцев зарегистрированы?'], 'ru');
    assert.deepEqual(ruFpQuestion, {});
    assert.deepEqual(ruFpQuestion.__uncertain, ['fingerprint_status']);

    const tkFpQuestion = extractSupportedDocumentFacts(['Barmak yzym hasaba alyndymy?'], 'tk');
    assert.deepEqual(tkFpQuestion, {});
    assert.deepEqual(tkFpQuestion.__uncertain, ['fingerprint_status']);

    const trAttachedNoFpWord = extractSupportedDocumentFacts(['Yurtta kalıyorum, kayıtlımı?'], 'tr');
    assert.deepEqual(trAttachedNoFpWord, { accommodation_type: 'dormitory' });
    assert.deepEqual(trAttachedNoFpWord.__uncertain, []);

    const trAttachedWithFpWord = extractSupportedDocumentFacts(['Yurtta kalıyorum, parmak izim kayıtlımı?'], 'tr');
    assert.deepEqual(trAttachedWithFpWord, { accommodation_type: 'dormitory' });
    assert.deepEqual(trAttachedWithFpWord.__uncertain, ['fingerprint_status']);

    const arPresupposedWh = extractSupportedDocumentFacts(
        ['عمري 20 سنة، ما المطلوب للطلب الأولي بعقد إيجار؟'],
        'ar'
    );
    assert.deepEqual(arPresupposedWh, {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'rental_contract'
    });
    assert.deepEqual(arPresupposedWh.__uncertain, []);

    const whQuestionCases = [
        { lang: 'tr', text: 'İlk başvuru, 20 yaşındayım, yurtta kalıyorum, hangi belgeler gerekli?' },
        { lang: 'tr', text: 'İlk başvuru 20 yaşındayım yurtta kalıyorum hangi belgeler gerekli?' },
        { lang: 'en', text: 'I am 20, initial application, I live in a dorm, which documents do I need?' },
        { lang: 'ru', text: 'Первичная подача, мне 20 лет, живу в общежитии, какие документы нужны?' },
        { lang: 'tk', text: 'Ilkinji arza, 20 ýaşymda, umumy ýaşaýyş jaýynda galýaryn, haýsy resminamalar gerek?' },
        { lang: 'ar', text: 'طلب أولي، عمري 20 سنة، أسكن في السكن الطلابي، ما المستندات المطلوبة؟' }
    ];
    for (const item of whQuestionCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(
            result,
            {
                application_type: 'initial',
                is_under_18: false,
                accommodation_type: 'dormitory'
            },
            `Unexpected facts for ${item.lang}: ${item.text}`
        );
        assert.deepEqual(result.__uncertain, [], `Expected empty __uncertain for ${item.lang}: ${item.text}`);
    }

    const whInsideSingleClauseCases = [
        {
            lang: 'en',
            text: 'What documents do I need for an initial application with a rental contract?',
            expected: { application_type: 'initial', accommodation_type: 'rental_contract' }
        },
        {
            lang: 'ru',
            text: 'Какие документы нужны для продления в общежитии?',
            expected: { application_type: 'renewal', accommodation_type: 'dormitory' }
        },
        {
            lang: 'tk',
            text: 'Ilkinji arza üçin näme resminama gerek?',
            expected: { application_type: 'initial' }
        },
        {
            lang: 'ar',
            text: 'ما المطلوب للطلب الأولي بعقد إيجار؟',
            expected: { application_type: 'initial', accommodation_type: 'rental_contract' }
        }
    ];
    for (const item of whInsideSingleClauseCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, item.expected, `Unexpected single-clause WH facts for ${item.lang}: ${item.text}`);
        assert.deepEqual(result.__uncertain, [], `Expected empty __uncertain for ${item.lang}: ${item.text}`);
    }

    const ellipticalDocCases = [
        { lang: 'tr', text: 'İlk başvuru için belge?', expected: { application_type: 'initial' } },
        { lang: 'en', text: 'Documents for an initial application?', expected: { application_type: 'initial' } }
    ];
    for (const item of ellipticalDocCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, item.expected, `Unexpected elliptical doc facts for ${item.lang}: ${item.text}`);
        assert.deepEqual(result.__uncertain, [], `Expected empty __uncertain for ${item.lang}: ${item.text}`);
    }

    const yesNoWithoutParticleCases = [
        { lang: 'en', text: 'Initial application?', uncertainKey: 'application_type' },
        { lang: 'ru', text: 'В общежитии?', uncertainKey: 'accommodation_type' }
    ];
    for (const item of yesNoWithoutParticleCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, {});
        assert.deepEqual(result.__uncertain, [item.uncertainKey]);
    }
});

test('round 5 fix 4: Turkish adult age/polite requests and Russian standalone age extract cleanly without matching durations', () => {
    const trAdultPhrases = ['yaşım 19', '19 yaşım', '18den büyüğüm', '18 yaşından büyüğüm'];
    for (const phrase of trAdultPhrases) {
        const result = extractSupportedDocumentFacts([phrase], 'tr');
        assert.equal(result.is_under_18, false, `Expected is_under_18=false for: ${phrase}`);
        assert.deepEqual(result.__uncertain, [], `Expected empty __uncertain for: ${phrase}`);
    }

    const ramblingTr = extractSupportedDocumentFacts(
        ['selam kanka ya ben yeni geldim istanbula ilk kez ikamet basvurusu yapicam yaşım 19 falan oldu yani 18den buyugum su an kira sozlesmesi yaptik arkadasla evde kaliyoruz bana tam olarak hangi belgeler lazim soyler misin cok karisik geldi'],
        'tr'
    );
    assert.deepEqual(ramblingTr, {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'rental_contract'
    });
    assert.deepEqual(ramblingTr.__uncertain, []);

    const politeCases = [
        {
            lang: 'tr',
            text: 'İlk başvuru yapacağım, hangi belgeler lazım yardımcı olur musun?',
            expected: { application_type: 'initial' }
        },
        {
            lang: 'tr',
            text: 'Uzatma için gerekli belgeleri açıklar mısın?',
            expected: { application_type: 'renewal' }
        },
        {
            lang: 'en',
            text: 'Can you tell me what documents I need for an initial application?',
            expected: { application_type: 'initial' }
        },
        {
            lang: 'en',
            text: 'Could you list the required documents for a renewal application?',
            expected: { application_type: 'renewal' }
        }
    ];
    for (const item of politeCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, item.expected, `Failed polite request for ${item.lang}: ${item.text}`);
        assert.deepEqual(result.__uncertain, []);
    }

    const ruStandaloneCases = [
        { text: 'Первичная заявка, 19 лет, живу в общежитии', expected: { application_type: 'initial', is_under_18: false, accommodation_type: 'dormitory' } },
        { text: '19 лет, первичная заявка', expected: { application_type: 'initial', is_under_18: false } },
        { text: '19 лет первичная заявка', expected: { application_type: 'initial', is_under_18: false } }
    ];
    for (const item of ruStandaloneCases) {
        const result = extractSupportedDocumentFacts([item.text], 'ru');
        assert.deepEqual(result, item.expected, `Failed Russian standalone age: ${item.text}`);
        assert.deepEqual(result.__uncertain, []);
    }

    const ruDurationCases = [
        'живу в общежитии 2 года',
        'за 2 года',
        'уже 3 года здесь',
        'живу в общежитии 15 лет',
        'за 15 лет',
        'уже 15 лет здесь'
    ];
    for (const text of ruDurationCases) {
        const result = extractSupportedDocumentFacts([text], 'ru');
        assert.equal(result.is_under_18, undefined, `Duration must not set is_under_18: ${text}`);
    }
});

test('round 5 fix 5: first-person relative uploaded/sent forms override how-to exclusion for statusNeedsReference', () => {
    assert.equal(
        isStatusQuestionWithoutReference('Geçen hafta yüklediğim dosyayı kontrol ettiler mi, ne zaman biter?'),
        true
    );
    assert.equal(
        isStatusQuestionWithoutReference('Yüklediğim belgeyi kontrol ettiler mi, ne zaman onaylanır?'),
        true
    );
    assert.equal(
        isStatusQuestionWithoutReference('The file I uploaded was checked, when will it finish?'),
        true
    );
    assert.equal(
        isStatusQuestionWithoutReference('Документы которые я отправил проверили, когда будет готово?'),
        true
    );
    assert.equal(
        isStatusQuestionWithoutReference('iberen faýlym barlandymy, haçan gutarar?'),
        true
    );
    assert.equal(
        isStatusQuestionWithoutReference('الملف الذي أرسلته تمت مراجعته، متى ينتهي؟'),
        true
    );
    assert.equal(
        isStatusQuestionWithoutReference('Yüklediğim belgeyi nasıl değiştirebilirim?'),
        false
    );
});

test('round 5 fix 6: eval runner supports --cases <path> resolved from cwd with default cases.json and documents it in --help', () => {
    const runnerSource = readFileSync(new URL('../scripts/chatbot-eval/run.mjs', import.meta.url), 'utf8');
    assert.match(runnerSource, /--cases <path>/);
    assert.match(runnerSource, /token === '--cases'/);
    assert.match(runnerSource, /resolve\(process\.cwd\(\), args\.cases\)/);
    assert.match(runnerSource, /const CASES_PATH = resolve\(SCRIPT_DIR, 'cases\.json'\)/);
});

test('document-keyword questions with typos or no WH-word preserve facts as statements while yes/no fact questions stay uncertain', () => {
    const trTypo = extractSupportedDocumentFacts(['ilk basvuru icin belgeler nelr?'], 'tr');
    assert.deepEqual(trTypo, { application_type: 'initial' });
    assert.deepEqual(trTypo.__uncertain, []);

    const docKeywordCases = [
        { lang: 'tr', text: 'uzatma evraklari nelerdr?', expected: { application_type: 'renewal' } },
        { lang: 'tr', text: 'ilk basvuru dokuman list?', expected: { application_type: 'initial' } },
        { lang: 'en', text: 'initial application paperwork?', expected: { application_type: 'initial' } },
        { lang: 'en', text: 'renewal docs pls?', expected: { application_type: 'renewal' } },
        { lang: 'ru', text: 'продление бумаги?', expected: { application_type: 'renewal' } },
        { lang: 'tk', text: 'uzatma dokumentler?', expected: { application_type: 'renewal' } },
        { lang: 'ar', text: 'أوراق التمديد؟', expected: { application_type: 'renewal' } },
        { lang: 'ar', text: 'وثائق الطلب الأولي؟', expected: { application_type: 'initial' } }
    ];
    for (const item of docKeywordCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, item.expected, `Failed document-keyword question for ${item.lang}: ${item.text}`);
        assert.deepEqual(result.__uncertain, [], `Expected empty __uncertain for ${item.lang}: ${item.text}`);
    }

    const trFpQuestion = extractSupportedDocumentFacts(['Parmak izim kayıtlı mı?'], 'tr');
    assert.deepEqual(trFpQuestion, {});
    assert.deepEqual(trFpQuestion.__uncertain, ['fingerprint_status']);

    const ruFpQuestion = extractSupportedDocumentFacts(['Мои отпечатки пальцев зарегистрированы?'], 'ru');
    assert.deepEqual(ruFpQuestion, {});
    assert.deepEqual(ruFpQuestion.__uncertain, ['fingerprint_status']);
});

test('Arabic dialect negation (ما/مش/مو + verb) routes negated facts to __uncertain while keeping ما + noun as WH-question and supporting dialect living verbs', () => {
    const levantineBlind = extractSupportedDocumentFacts(
        ['ما بسكن بالسكن الطلابي، أول مرة بقدم، عمري 20'],
        'ar'
    );
    assert.deepEqual(levantineBlind, {
        application_type: 'initial',
        is_under_18: false
    });
    assert.deepEqual(levantineBlind.__uncertain, ['accommodation_type']);
    assert.equal(hasEvidenceRisk(['ما بسكن بالسكن الطلابي، أول مرة بقدم، عمري 20'], 'ar'), true);

    const dialectNegatedAccomCases = [
        'ما بسكن بالسكن الطلابي',
        'مش ساكن بالسكن الطلابي',
        'مش ساكنة في السكن الجامعي',
        'مو عايش بالسكن الطلابي',
        'ما أسكن في السكن الطلابي',
        'ما بعيش في فندق',
        'ما تسكن في السكن الطلابي',
        'ما يسكن في السكن الطلابي',
        'ما نسكن في السكن الطلابي'
    ];
    for (const text of dialectNegatedAccomCases) {
        const result = extractSupportedDocumentFacts([text], 'ar');
        assert.equal(result.accommodation_type, undefined, `Expected no accommodation_type for: ${text}`);
        assert.ok(result.__uncertain.includes('accommodation_type'), `Expected __uncertain accommodation_type for: ${text}`);
        assert.equal(hasEvidenceRisk([text], 'ar'), true, `Expected evidence risk for: ${text}`);
    }

    // 'ما' followed by a noun/question word stays a WH-word and does not trigger negation risk.
    const whCases = [
        {
            text: 'ما هي المستندات المطلوبة لتمديد الإقامة؟ عمري 21 سنة وأقيم في السكن الطلابي',
            expected: { application_type: 'renewal', is_under_18: false, accommodation_type: 'dormitory' }
        },
        {
            text: 'ما المستندات المطلوبة للطلب الأولي بعقد إيجار؟ عمري 20 سنة',
            expected: { application_type: 'initial', is_under_18: false, accommodation_type: 'rental_contract' }
        }
    ];
    for (const item of whCases) {
        const result = extractSupportedDocumentFacts([item.text], 'ar');
        assert.deepEqual(result, item.expected);
        assert.deepEqual(result.__uncertain, []);
        assert.equal(hasEvidenceRisk([item.text], 'ar'), false);
    }

    // Dialect living verbs ('ساكن/ساكنة/بسكن/عايش') in undertaking and host context.
    for (const text of [
        'ساكن مع صديق',
        'ساكنة عند صديقتي',
        'بسكن عند قريبي',
        'عايش مع صديق',
        'عايشة عند قريبي'
    ]) {
        const result = extractSupportedDocumentFacts([text], 'ar');
        assert.equal(result.accommodation_type, 'undertaking', `Expected undertaking for: ${text}`);
    }
});

test('verifyQuotedFact verifies the three blind evaluation examples, substring bounds, negation window, age rules, lexicon veto, and yes/no questions', () => {
    // 1. Blind example 1 (English with "first residence permit application")
    const blindEn = ['hi im doing my first residence permit application, im 19 and i live in the uni dorm'];
    assert.equal(verifyQuotedFact('application_type', 'initial', 'first residence permit application', blindEn, 'en'), true);
    assert.equal(verifyQuotedFact('is_under_18', false, 'im 19', blindEn, 'en'), true);
    assert.equal(verifyQuotedFact('accommodation_type', 'dormitory', 'i live in the uni dorm', blindEn, 'en'), true);

    // 2. Blind example 2 (Latin-script Russian)
    const blindRuLat = ['privet, mne nado prodlit ikamet, mne 22, snimayu kvartiru, dogovor arendy zaverennyi u notariusa est'];
    assert.equal(verifyQuotedFact('application_type', 'renewal', 'prodlit ikamet', blindRuLat, 'ru'), true);
    assert.equal(verifyQuotedFact('is_under_18', false, 'mne 22', blindRuLat, 'ru'), true);
    assert.equal(verifyQuotedFact('accommodation_type', 'rental_contract', 'snimayu kvartiru, dogovor arendy', blindRuLat, 'ru'), true);

    // 3. Blind example 3 (Turkmen)
    const blindTk = ['ikamet uzaltjak 21 yasym kireyde yasayan notariusda tassyklanan kira sertnamasy bar'];
    assert.equal(verifyQuotedFact('application_type', 'renewal', 'ikamet uzaltjak', blindTk, 'tk'), true);
    assert.equal(verifyQuotedFact('is_under_18', false, '21 yasym', blindTk, 'tk'), true);
    assert.equal(
        verifyQuotedFact(
            'accommodation_type',
            'rental_contract',
            'kireyde yasayan notariusda tassyklanan kira sertnamasy bar',
            blindTk,
            'tk'
        ),
        true
    );

    // Rule a: quote not present in userTurns, too short (<2 chars), or >160 chars -> false
    assert.equal(verifyQuotedFact('accommodation_type', 'dormitory', 'not in message', blindRuLat, 'ru'), false);
    assert.equal(verifyQuotedFact('application_type', 'renewal', 'p', blindRuLat, 'ru'), false);
    assert.equal(verifyQuotedFact('application_type', 'renewal', 'a'.repeat(161), ['a'.repeat(200)], 'en'), false);

    // Rule b: negation window rejects positive-valued facts and allows negative-valued facts
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'بالسكن الطلابي', ['ما بسكن بالسكن الطلابي، أول مرة بقدم، عمري 20'], 'ar'),
        false
    );
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'ما بسكن بالسكن الطلابي', ['ما بسكن بالسكن الطلابي'], 'ar'),
        false
    );
    assert.equal(
        verifyQuotedFact('application_type', 'initial', 'first residence permit', ['not my first residence permit'], 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('fingerprint_status', 'registered', 'barmak yzy', ['barmak yzy yok'], 'tk'),
        false
    );
    assert.equal(
        verifyQuotedFact('fingerprint_status', 'not_registered', 'ne sdaval otpechatki', ['ya ne sdaval otpechatki'], 'ru'),
        true
    );
    assert.equal(
        verifyQuotedFact('host_is_married', 'no', 'not married', ['the person i stay with is not married'], 'en'),
        true
    );
    assert.equal(
        verifyQuotedFact('host_is_turkish', 'no', 'not turkish', ['the person i stay with is not turkish'], 'en'),
        true
    );
    assert.equal(
        verifyQuotedFact('is_under_18', false, 'no, im 20', ['no, im 20'], 'en'),
        true
    );

    // Rule c: is_under_18 requires digit age 1-99 consistent with value or lexicon minor/adult phrase, and rejects duration words
    assert.equal(
        verifyQuotedFact('is_under_18', false, 'im a university student', ['im a university student in istanbul'], 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('is_under_18', true, 'im 19', blindEn, 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('is_under_18', false, 'im 16', ['im 16 and in a dorm'], 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('is_under_18', true, 'im 16', ['im 16 and in a dorm'], 'en'),
        true
    );
    assert.equal(
        verifyQuotedFact('is_under_18', true, 'for 15 years', ['i lived here for 15 years'], 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('is_under_18', true, '15 years', ['i lived here for 15 years'], 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('is_under_18', true, '15 yıldır', ['15 yıldır yurtta kalıyorum'], 'tr'),
        false
    );

    // Rule d: lexicon veto when lexicon has a different value or __uncertain
    assert.equal(
        verifyQuotedFact('application_type', 'renewal', 'İlk başvuru yapacağım', ['İlk başvuru yapacağım'], 'tr'),
        false
    );
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'Yurt', ['Yurt veya kiralık ev için'], 'tr'),
        false
    );

    // Rule e: quote inside a yes/no question clause -> false
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'v obshchezhitii', ['mne 22. v obshchezhitii li?'], 'ru'),
        false
    );
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'uni dorm', ['is uni dorm accepted?'], 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('application_type', 'initial', 'ilk basvuru', ['ilk basvuru mu?'], 'tr'),
        false
    );

    // Rule f: quote relevance stem check for application_type, accommodation_type, host_is_married, host_is_turkish, fingerprint_status
    const auntTurns = ['İlk başvuru, 20 yaşındayım, teyzemde kalıyorum, hangi belgeler?'];
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'teyzemde kalıyorum', auntTurns, 'tr'),
        false
    );
    assert.equal(
        verifyQuotedFact('accommodation_type', 'undertaking', 'teyzemde kalıyorum', auntTurns, 'tr'),
        true
    );
    const auntFiltered = filterDocumentArgsByEvidence(
        {
            application_type: 'initial',
            is_under_18: false,
            accommodation_type: 'dormitory',
            quotes: {
                application_type: 'İlk başvuru',
                is_under_18: '20 yaşındayım',
                accommodation_type: 'teyzemde kalıyorum'
            }
        },
        auntTurns,
        'tr'
    );
    assert.deepEqual(auntFiltered, {
        application_type: 'initial',
        is_under_18: false,
        quotes: {
            application_type: 'İlk başvuru',
            is_under_18: '20 yaşındayım',
            accommodation_type: 'teyzemde kalıyorum'
        }
    });
    assert.equal(Object.hasOwn(auntFiltered, 'accommodation_type'), false);

    assert.equal(
        verifyQuotedFact('accommodation_type', 'rental_contract', 'snimayu kvartiru', ['snimayu kvartiru'], 'ru'),
        true
    );
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'kyk yurdunda kaliyorum', ['kyk yurdunda kaliyorum'], 'tr'),
        true
    );

    // A quote with no relevant stem for application_type is rejected
    assert.equal(
        verifyQuotedFact('application_type', 'initial', 'istanbulda ogrenciyim', ['istanbulda ogrenciyim'], 'tr'),
        false
    );
    assert.equal(
        verifyQuotedFact('application_type', 'renewal', 'istanbulda ogrenciyim', ['istanbulda ogrenciyim'], 'tr'),
        false
    );
    assert.equal(
        verifyQuotedFact('application_type', 'transition', 'istanbulda ogrenciyim', ['istanbulda ogrenciyim'], 'tr'),
        false
    );

    // Quotes with no relevant stem for host_is_married, host_is_turkish, and fingerprint_status are rejected
    assert.equal(
        verifyQuotedFact('host_is_married', 'yes', 'teyzemde kaliyorum', ['teyzemde kaliyorum'], 'tr'),
        false
    );
    assert.equal(
        verifyQuotedFact('host_is_turkish', 'yes', 'teyzemde kaliyorum', ['teyzemde kaliyorum'], 'tr'),
        false
    );
    assert.equal(
        verifyQuotedFact('fingerprint_status', 'registered', 'teyzemde kaliyorum', ['teyzemde kaliyorum'], 'tr'),
        false
    );
});

test('host context and student self-description guard: wrong-list self-descriptions leave host facts missing while kinship words and third-person host pronouns are accepted', () => {
    // 1. Defect 1a (Turkish): student self-description ('Ben bekarım', 'yabancı vatandaşım') must not satisfy host facts
    const trWrongListTurns = [
        'İlk başvuru, 20 yaşındayım. Ben bekarım, yabancı vatandaşım, akrabamın yanında taahhütname ile kalıyorum. Belgeler neler?'
    ];
    assert.deepEqual(extractSupportedDocumentFacts(trWrongListTurns, 'tr'), {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'undertaking'
    });
    assert.equal(verifyQuotedFact('host_is_married', 'no', 'Ben bekarım', trWrongListTurns, 'tr'), false);
    assert.equal(verifyQuotedFact('host_is_married', 'no', 'bekarım', trWrongListTurns, 'tr'), false);
    assert.equal(verifyQuotedFact('host_is_turkish', 'no', 'yabancı vatandaşım', trWrongListTurns, 'tr'), false);
    assert.equal(
        verifyQuotedFact('host_is_turkish', 'no', 'yabancı vatandaşım, akrabamın yanında', trWrongListTurns, 'tr'),
        false
    );

    const trFiltered = filterDocumentArgsByEvidence(
        {
            application_type: 'initial',
            is_under_18: false,
            accommodation_type: 'undertaking',
            host_is_married: 'no',
            host_is_turkish: 'no',
            quotes: {
                application_type: 'İlk başvuru',
                is_under_18: '20 yaşındayım',
                accommodation_type: 'akrabamın yanında taahhütname ile kalıyorum',
                host_is_married: 'Ben bekarım',
                host_is_turkish: 'yabancı vatandaşım'
            }
        },
        trWrongListTurns,
        'tr'
    );
    assert.equal(Object.hasOwn(trFiltered, 'host_is_married'), false);
    assert.equal(Object.hasOwn(trFiltered, 'host_is_turkish'), false);
    assert.deepEqual(executeChatbotTool('get_required_documents', trFiltered, { language: 'tr' }), {
        missing: ['host_is_married', 'host_is_turkish']
    });

    // 2. Defect 1b (Russian): student self-description ('Я холост', 'не гражданин Турции') must not satisfy host facts
    const ruWrongListTurns = [
        'Первичная подача, мне 21 год. Я холост и не гражданин Турции, живу у родственника по обязательству. Какие документы нужны?'
    ];
    assert.deepEqual(extractSupportedDocumentFacts(ruWrongListTurns, 'ru'), {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'undertaking'
    });
    assert.equal(verifyQuotedFact('host_is_married', 'no', 'Я холост', ruWrongListTurns, 'ru'), false);
    assert.equal(verifyQuotedFact('host_is_married', 'no', 'холост', ruWrongListTurns, 'ru'), false);
    assert.equal(verifyQuotedFact('host_is_turkish', 'no', 'не гражданин Турции', ruWrongListTurns, 'ru'), false);

    const ruFiltered = filterDocumentArgsByEvidence(
        {
            application_type: 'initial',
            is_under_18: false,
            accommodation_type: 'undertaking',
            host_is_married: 'no',
            host_is_turkish: 'no',
            quotes: {
                application_type: 'Первичная подача',
                is_under_18: 'мне 21 год',
                accommodation_type: 'живу у родственника по обязательству',
                host_is_married: 'Я холост',
                host_is_turkish: 'не гражданин Турции'
            }
        },
        ruWrongListTurns,
        'ru'
    );
    assert.equal(Object.hasOwn(ruFiltered, 'host_is_married'), false);
    assert.equal(Object.hasOwn(ruFiltered, 'host_is_turkish'), false);
    assert.deepEqual(executeChatbotTool('get_required_documents', ruFiltered, { language: 'ru' }), {
        missing: ['host_is_married', 'host_is_turkish']
    });

    // Student self-description immediately following a host clause is still rejected across all five languages
    for (const item of [
        {
            lang: 'tr',
            turns: ['Akrabamın yanında kalıyorum, ben bekarım, yabancı vatandaşım'],
            marriedQuote: 'ben bekarım',
            turkishQuote: 'yabancı vatandaşım'
        },
        {
            lang: 'en',
            turns: ['I live with my relative, I am single and not a Turkish citizen'],
            marriedQuote: 'I am single',
            turkishQuote: 'not a Turkish citizen'
        },
        {
            lang: 'ru',
            turns: ['Живу у родственника, я холост и не гражданин Турции'],
            marriedQuote: 'я холост',
            turkishQuote: 'не гражданин Турции'
        },
        {
            lang: 'tk',
            turns: ['Garyndaşymyň ýanynda ýaşaýaryn, men öýlenmedik, daşary ýurtly'],
            marriedQuote: 'men öýlenmedik',
            turkishQuote: 'men öýlenmedik'
        },
        {
            lang: 'ar',
            turns: ['أسكن عند قريبي، أنا أعزب وغير تركي'],
            marriedQuote: 'أنا أعزب',
            turkishQuote: 'غير تركي'
        }
    ]) {
        const extracted = extractSupportedDocumentFacts(item.turns, item.lang);
        assert.equal(extracted.host_is_married, undefined, `Expected no host_is_married for ${item.lang}`);
        assert.equal(extracted.host_is_turkish, undefined, `Expected no host_is_turkish for ${item.lang}`);
        assert.equal(
            verifyQuotedFact('host_is_married', 'no', item.marriedQuote, item.turns, item.lang),
            false,
            `Expected married quote rejection for ${item.lang}`
        );
        assert.equal(
            verifyQuotedFact('host_is_turkish', 'no', item.turkishQuote, item.turns, item.lang),
            false,
            `Expected turkish quote rejection for ${item.lang}`
        );
    }

    // 3. Defect 2a (Turkish kinship host context): 'teyzem Türk vatandaşı ve evli'
    const trAuntTurns = [
        'Teyzemin evinde kalıyorum, teyzem Türk vatandaşı ve evli, noterden taahhütname verecek'
    ];
    assert.deepEqual(extractSupportedDocumentFacts(trAuntTurns, 'tr'), {
        accommodation_type: 'undertaking',
        host_is_married: 'yes',
        host_is_turkish: 'yes'
    });
    assert.equal(
        verifyQuotedFact('host_is_married', 'yes', 'teyzem Türk vatandaşı ve evli', trAuntTurns, 'tr'),
        true
    );
    assert.equal(
        verifyQuotedFact('host_is_turkish', 'yes', 'teyzem Türk vatandaşı ve evli', trAuntTurns, 'tr'),
        true
    );

    // 4. Defect 2b (English kinship + third-person pronoun host context): "he's a Turkish citizen and married"
    const enUncleTurns = [
        "I'm staying at my uncle's place, he's a Turkish citizen and married, he'll sign the notarized undertaking"
    ];
    assert.deepEqual(extractSupportedDocumentFacts(enUncleTurns, 'en'), {
        accommodation_type: 'undertaking',
        host_is_married: 'yes',
        host_is_turkish: 'yes'
    });
    assert.equal(
        verifyQuotedFact('host_is_married', 'yes', "he's a Turkish citizen and married", enUncleTurns, 'en'),
        true
    );
    assert.equal(
        verifyQuotedFact('host_is_turkish', 'yes', "he's a Turkish citizen and married", enUncleTurns, 'en'),
        true
    );

    // 5. Kinship words + third-person pronouns across tr/en/ru/tk/ar when a host word appears earlier in the same turn
    for (const item of [
        {
            lang: 'tr',
            turns: ['Teyzemin evinde kalıyorum, o Türk vatandaşı ve evli'],
            quote: 'o Türk vatandaşı ve evli'
        },
        {
            lang: 'en',
            turns: ["I'm staying with my aunt, she is a Turkish citizen and married"],
            quote: 'she is a Turkish citizen and married'
        },
        {
            lang: 'ru',
            turns: ['Живу у тёти, она гражданка Турции и замужем'],
            quote: 'она гражданка Турции и замужем'
        },
        {
            lang: 'ru',
            turns: ['Живу у дяди, он гражданин Турции и женат'],
            quote: 'он гражданин Турции и женат'
        },
        {
            lang: 'tk',
            turns: ['Daýzamyň öýünde ýaşaýaryn, ol Türkiýäniň raýaty we durmuşa çykan'],
            quote: 'ol Türkiýäniň raýaty we durmuşa çykan'
        },
        {
            lang: 'ar',
            turns: ['أسكن عند خالي، هو مواطن تركي ومتزوج'],
            quote: 'هو مواطن تركي ومتزوج'
        },
        {
            lang: 'ar',
            turns: ['أسكن عند عمتي، هي مواطنة تركية ومتزوجة'],
            quote: 'هي مواطنة تركية ومتزوجة'
        }
    ]) {
        const extracted = extractSupportedDocumentFacts(item.turns, item.lang);
        assert.equal(extracted.host_is_married, 'yes', `Expected host_is_married=yes for ${item.lang}: ${item.turns[0]}`);
        assert.equal(extracted.host_is_turkish, 'yes', `Expected host_is_turkish=yes for ${item.lang}: ${item.turns[0]}`);
        assert.equal(
            verifyQuotedFact('host_is_married', 'yes', item.quote, item.turns, item.lang),
            true,
            `Expected verifyQuotedFact married=true for ${item.lang}: ${item.quote}`
        );
        assert.equal(
            verifyQuotedFact('host_is_turkish', 'yes', item.quote, item.turns, item.lang),
            true,
            `Expected verifyQuotedFact turkish=true for ${item.lang}: ${item.quote}`
        );
    }

    // Third-person pronoun without an earlier host word in the same turn does not count as host context
    assert.equal(extractSupportedDocumentFacts(['He is a Turkish citizen and married'], 'en').host_is_married, undefined);
    assert.equal(
        verifyQuotedFact('host_is_married', 'yes', 'He is a Turkish citizen and married', ['He is a Turkish citizen and married'], 'en'),
        false
    );
});

test('round 8 fix 2: stage words count as status only with first-person application context, never in plural or how-to questions', () => {
    const nonStatusStageQuestions = [
        'Какие этапы нужно пройти на портале для подачи заявки?',
        'этапы подачи',
        'başvuru aşamaları nelerdir',
        'what are the stages',
        'What are the application stages on the portal?',
        'Arza tapgyrlary nähili?',
        'ما هي مراحل تقديم الطلب؟'
    ];
    for (const query of nonStatusStageQuestions) {
        assert.equal(
            isStatusQuestionWithoutReference(query),
            false,
            `Expected stage how-to/plural question not to match statusNeedsReference: ${query}`
        );
    }

    const firstPersonStageQuestions = [
        'На каком этапе моя заявка?',
        'на каком этапе моя',
        'başvurum hangi aşamada',
        'Öğrenci numaram 2201045, başvurum hangi aşamada?',
        'What stage is my application in?',
        'Arzam haýsy tapgyrda?',
        'في أي مرحلة طلبي؟'
    ];
    for (const query of firstPersonStageQuestions) {
        assert.equal(
            isStatusQuestionWithoutReference(query),
            true,
            `Expected first-person stage question to match statusNeedsReference: ${query}`
        );
    }
});

test('round 8 fix 3: negated value plus a different positive value resolves to the positive value while genuine double positives stay uncertain', () => {
    const multiTurnCorrection = extractSupportedDocumentFacts(
        [
            'ilk başvuru yapacağım, 20 yaşındayım',
            'pardon yanlış yazdım ilk başvuru değil, kısa dönem ikametten öğrenci ikametine geçiş yapacağım',
            'öğrenci yurdunda kalıyorum, Göç İdaresinde parmak izi kaydım var'
        ],
        'tr'
    );
    assert.deepEqual(multiTurnCorrection, {
        application_type: 'transition',
        is_under_18: false,
        accommodation_type: 'dormitory',
        fingerprint_status: 'registered'
    });
    assert.deepEqual(multiTurnCorrection.__uncertain, []);

    const singleTurnCorrections = [
        {
            lang: 'tr',
            turns: ['pardon yanlış yazdım ilk başvuru değil, kısa dönem ikametten öğrenci ikametine geçiş yapacağım'],
            expected: { application_type: 'transition' }
        },
        {
            lang: 'en',
            turns: ['Not an initial application, I am applying for a renewal'],
            expected: { application_type: 'renewal' }
        },
        {
            lang: 'ru',
            turns: ['Не первичная подача, а продление студенческого ВНЖ'],
            expected: { application_type: 'renewal' }
        },
        {
            lang: 'tk',
            turns: ['Ilkinji arza däl, uzatma arzasy'],
            expected: { application_type: 'renewal' }
        },
        {
            lang: 'ar',
            turns: ['ليس طلباً أولياً، بل طلب تمديد'],
            expected: { application_type: 'renewal' }
        },
        {
            lang: 'tr',
            turns: ['Yurtta kalmıyorum, kira sözleşmesi ile kalıyorum'],
            expected: { accommodation_type: 'rental_contract' }
        }
    ];
    for (const item of singleTurnCorrections) {
        const result = extractSupportedDocumentFacts(item.turns, item.lang);
        assert.deepEqual(result, item.expected, `Correction failed for ${item.lang}: ${item.turns[0]}`);
        assert.deepEqual(result.__uncertain, []);
    }

    // Genuine double positives without negation stay uncertain
    const doublePositiveApp = extractSupportedDocumentFacts(['İlk başvuru ve uzatma başvurusu için belgeler'], 'tr');
    assert.equal(doublePositiveApp.application_type, undefined);
    assert.ok(doublePositiveApp.__uncertain.includes('application_type'));

    const doublePositiveAccom = extractSupportedDocumentFacts(['Yurt veya kiralık ev için, 20 yaşındayım'], 'tr');
    assert.equal(doublePositiveAccom.accommodation_type, undefined);
    assert.ok(doublePositiveAccom.__uncertain.includes('accommodation_type'));
});

test('round 8 fix 4: comma-terminated age phrases, cross-turn host context, and Turkmen negative fingerprint verbs extract cleanly', () => {
    // 1. Comma after age number for мне N / I am N / im N
    assert.deepEqual(
        extractSupportedDocumentFacts(['мне 21, живу у друга'], 'ru'),
        { is_under_18: false, accommodation_type: 'undertaking' }
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['I am 21, living with a friend'], 'en'),
        { is_under_18: false, accommodation_type: 'undertaking' }
    );
    assert.deepEqual(
        extractSupportedDocumentFacts(['im 17, staying in a dorm'], 'en'),
        { is_under_18: true, accommodation_type: 'dormitory' }
    );

    // 2. Host context across turns: host word in previous user turn makes pronouns in current turn host context
    const ruCrossTurnHost = extractSupportedDocumentFacts(
        [
            'первичная подача, мне 21, живу у друга',
            'нет не женат, и он не турок'
        ],
        'ru'
    );
    assert.deepEqual(ruCrossTurnHost, {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'undertaking',
        host_is_married: 'no',
        host_is_turkish: 'no'
    });
    assert.deepEqual(ruCrossTurnHost.__uncertain, []);
    assert.equal(
        verifyQuotedFact(
            'host_is_married',
            'no',
            'не женат',
            ['первичная подача, мне 21, живу у друга', 'нет не женат, и он не турок'],
            'ru'
        ),
        true
    );
    assert.equal(
        verifyQuotedFact(
            'host_is_turkish',
            'no',
            'он не турок',
            ['первичная подача, мне 21, живу у друга', 'нет не женат, и он не турок'],
            'ru'
        ),
        true
    );

    // 3. Turkmen fingerprint negative phrasings (bermedim / bermedik / tabşyrmadym / hasapda ýok)
    const tkFpCases = [
        'Barmak yzymy entek bermedim, hasapda ýok',
        'Barmak yzymy bermedik',
        'Barmak yzymy tabşyrmadym',
        'Barmak yzym hasapda ýok'
    ];
    for (const text of tkFpCases) {
        const result = extractSupportedDocumentFacts([text], 'tk');
        assert.equal(result.fingerprint_status, 'not_registered', `Expected not_registered for: ${text}`);
        assert.deepEqual(result.__uncertain, []);
    }
});

test('R3 finding 1: split positive/negative quote stems, token-start stem boundaries, transition перевод context, and age context/negation in verifyQuotedFact', () => {
    // 1. Non-Turkish citizen / foreign host quotes must not verify host_is_turkish: 'yes', and verify 'no'
    for (const item of [
        { lang: 'en', text: 'My host is a Syrian citizen' },
        { lang: 'tr', text: 'Ev sahibim yabancı' },
        { lang: 'ru', text: 'Хозяин гражданин Казахстана' },
        { lang: 'ar', text: 'المضيف مواطن سوري' }
    ]) {
        assert.equal(
            verifyQuotedFact('host_is_turkish', 'yes', item.text, [item.text], item.lang),
            false,
            `Expected host_is_turkish=yes to be rejected for: ${item.text}`
        );
        assert.equal(
            verifyQuotedFact('host_is_turkish', 'no', item.text, [item.text], item.lang),
            true,
            `Expected host_is_turkish=no to be accepted for: ${item.text}`
        );
    }

    // 2. Positive spouse stem ('wife') must not verify host_is_married: 'no'
    assert.equal(
        verifyQuotedFact('host_is_married', 'no', 'I stay with my uncle and his wife', ['I stay with my uncle and his wife'], 'en'),
        false
    );
    assert.equal(
        verifyQuotedFact('host_is_married', 'yes', 'I stay with my uncle and his wife', ['I stay with my uncle and his wife'], 'en'),
        true
    );

    // 3. Biometric photos must not verify fingerprint_status for either registered or not_registered
    for (const item of [
        { lang: 'tr', text: 'Biyometrik fotoğrafım hazır' },
        { lang: 'en', text: 'I have biometric photos' },
        { lang: 'ru', text: 'Биометрическое фото готово' }
    ]) {
        assert.equal(
            verifyQuotedFact('fingerprint_status', 'registered', item.text, [item.text], item.lang),
            false,
            `Biometric photo must not verify registered: ${item.text}`
        );
        assert.equal(
            verifyQuotedFact('fingerprint_status', 'not_registered', item.text, [item.text], item.lang),
            false,
            `Biometric photo must not verify not_registered: ${item.text}`
        );
    }

    // Bare fingerprint mention without negative stem or negation must not verify not_registered
    assert.equal(
        verifyQuotedFact('fingerprint_status', 'not_registered', 'parmak izi randevusu', ['parmak izi randevusu aldım'], 'tr'),
        false
    );

    // 4. Token-start stem matching: substrings inside unrelated words must never match
    for (const item of [
        { fact: 'accommodation_type', value: 'rental_contract', lang: 'en', text: 'I live with my parents' },
        { fact: 'accommodation_type', value: 'rental_contract', lang: 'en', text: 'my current passport' },
        { fact: 'accommodation_type', value: 'rental_contract', lang: 'en', text: 'different documents' },
        { fact: 'accommodation_type', value: 'hotel', lang: 'ru', text: 'Я хотел узнать какие документы нужны' },
        { fact: 'accommodation_type', value: 'undertaking', lang: 'ru', text: 'Я поступил в университет' },
        { fact: 'accommodation_type', value: 'undertaking', lang: 'ru', text: 'инженерный факультет' },
        { fact: 'accommodation_type', value: 'undertaking', lang: 'ar', text: 'عمري 20' },
        { fact: 'accommodation_type', value: 'undertaking', lang: 'ar', text: 'نعم' },
        { fact: 'accommodation_type', value: 'undertaking', lang: 'ar', text: 'عندي سؤال' },
        { fact: 'accommodation_type', value: 'own_home', lang: 'ar', text: 'المملكة العربية السعودية' },
        { fact: 'application_type', value: 'transition', lang: 'ru', text: 'нотариальный перевод паспорта' }
    ]) {
        assert.equal(
            verifyQuotedFact(item.fact, item.value, item.text, [item.text], item.lang),
            false,
            `Expected token-start rejection for ${item.fact}=${item.value} on: ${item.text}`
        );
    }

    // Russian 'перевод' with transition context still verifies transition
    assert.equal(
        verifyQuotedFact('application_type', 'transition', 'перевод ВНЖ на студенческий', ['перевод ВНЖ на студенческий'], 'ru'),
        true
    );

    // 5. Age from quotes requires age context and applies negation window to is_under_18=false
    for (const item of [
        { value: true, lang: 'tr', text: '1. sınıf öğrencisiyim' },
        { value: true, lang: 'tr', text: '2 belge' },
        { value: false, lang: 'tr', text: "Randevum 25 Kasım'da" },
        { value: false, lang: 'tr', text: '20 yaşında değilim' },
        { value: false, lang: 'en', text: 'I am not 20' },
        { value: false, lang: 'ru', text: 'Мне не 20 лет' }
    ]) {
        assert.equal(
            verifyQuotedFact('is_under_18', item.value, item.text, [item.text], item.lang),
            false,
            `Expected age quote rejection for is_under_18=${item.value} on: ${item.text}`
        );
    }

    // Explicit double-negative adult phrases still verify is_under_18=false
    assert.equal(
        verifyQuotedFact('is_under_18', false, '18 yaşından küçük değilim', ['18 yaşından küçük değilim'], 'tr'),
        true
    );
    assert.equal(
        verifyQuotedFact('is_under_18', false, 'I am not under 18', ['I am not under 18'], 'en'),
        true
    );
});

test('R3 finding 2: informational WH/document questions and comma-split yes/no questions yield no facts', () => {
    const infoQuestions = [
        { lang: 'tr', text: 'Taahhütname nedir?', uncertainKey: 'accommodation_type' },
        { lang: 'tr', text: 'Uzatma başvurusu nasıl yapılır?', uncertainKey: 'application_type' },
        { lang: 'tr', text: 'Yurt belgesi nereden alınır?', uncertainKey: 'accommodation_type' }
    ];
    for (const item of infoQuestions) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, {}, `Expected no facts for informational question: ${item.text}`);
        assert.ok(result.__uncertain.includes(item.uncertainKey), `Expected ${item.uncertainKey} in __uncertain for: ${item.text}`);
    }

    const combinedInfoTurn = extractSupportedDocumentFacts(
        ['How does renewal work, where is the dormitory, and what documents are needed if under 18?'],
        'en'
    );
    assert.deepEqual(combinedInfoTurn, {});
    assert.ok(combinedInfoTurn.__uncertain.includes('application_type'));
    assert.ok(combinedInfoTurn.__uncertain.includes('accommodation_type'));
    assert.ok(combinedInfoTurn.__uncertain.includes('is_under_18'));

    const commaSplitQuestions = [
        {
            lang: 'en',
            text: 'Do I choose initial application, is 17 under 18, and is dormitory valid?',
            uncertainKeys: ['application_type', 'is_under_18', 'accommodation_type']
        },
        {
            lang: 'en',
            text: 'Are you asking if I live in a dorm, or which documents I need?',
            uncertainKeys: ['accommodation_type']
        },
        {
            lang: 'tr',
            text: 'İlk başvuru, 19 yaş, yurt mu?',
            uncertainKeys: ['application_type', 'accommodation_type']
        },
        {
            lang: 'en',
            text: 'Please share: whether you are under 18 (yes / no), and your accommodation type.',
            uncertainKeys: ['is_under_18']
        }
    ];
    for (const item of commaSplitQuestions) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.deepEqual(result, {}, `Expected no facts for comma-split question: ${item.text}`);
        for (const key of item.uncertainKeys) {
            assert.ok(result.__uncertain.includes(key), `Expected ${key} in __uncertain for: ${item.text}`);
        }
    }
});

test('R3 finding 3: normalizeForEvidence strips Unicode format characters (\\p{Cf}) so zero-width/soft-hyphen cannot bypass negation', () => {
    assert.equal(normalizeForEvidence('yurtta de\u200Bğil'), 'yurtta degil');
    assert.equal(normalizeForEvidence('yurtta kalmı\u00ADyorum'), 'yurtta kalmiyorum');
    assert.equal(normalizeForEvidence('\uFEFFuzat\u200C\u200D\u2060mıyorum'), 'uzatmiyorum');

    const zwspDorm = extractSupportedDocumentFacts(['yurtta de\u200Bğil'], 'tr');
    assert.deepEqual(zwspDorm, {});
    assert.deepEqual(zwspDorm.__uncertain, ['accommodation_type']);
    assert.equal(hasEvidenceRisk(['yurtta de\u200Bğil'], 'tr'), true);

    const shyDorm = extractSupportedDocumentFacts(['yurtta kalmı\u00ADyorum'], 'tr');
    assert.deepEqual(shyDorm, {});
    assert.deepEqual(shyDorm.__uncertain, ['accommodation_type']);
    assert.equal(hasEvidenceRisk(['yurtta kalmı\u00ADyorum'], 'tr'), true);

    const zwspRenewal = extractSupportedDocumentFacts(['uzat\u200Bmıyorum'], 'tr');
    assert.deepEqual(zwspRenewal, {});
    assert.deepEqual(zwspRenewal.__uncertain, ['application_type']);
    assert.equal(hasEvidenceRisk(['uzat\u200Bmıyorum'], 'tr'), true);
});

test('R3 finding 6: student self-descriptions (Türk\'üm, моя жена, عندي زوجة, eşim, cross-turn o zaman/o belge/ما هو) never misattribute to host', () => {
    assert.equal(normalizeForEvidence("Türk'üm"), 'turkum');
    assert.equal(normalizeForEvidence('Türk\u2019üm'), 'turkum');
    assert.equal(normalizeForEvidence("TC'liyim"), 'tcliyim');

    const trApostropheTurns = ["Akrabamın yanında kalıyorum, Türk'üm"];
    const trApostropheFacts = extractSupportedDocumentFacts(trApostropheTurns, 'tr');
    assert.deepEqual(trApostropheFacts, { accommodation_type: 'undertaking' });
    assert.equal(trApostropheFacts.host_is_turkish, undefined);
    assert.equal(verifyQuotedFact('host_is_turkish', 'yes', "Türk'üm", trApostropheTurns, 'tr'), false);

    const ruWifeTurns = ['Живу у дяди, моя жена тоже студентка'];
    const ruWifeFacts = extractSupportedDocumentFacts(ruWifeTurns, 'ru');
    assert.deepEqual(ruWifeFacts, { accommodation_type: 'undertaking' });
    assert.equal(ruWifeFacts.host_is_married, undefined);
    assert.equal(verifyQuotedFact('host_is_married', 'yes', 'моя жена', ruWifeTurns, 'ru'), false);

    const arWifeTurns = ['اسكن عند قريبي، عندي زوجة'];
    const arWifeFacts = extractSupportedDocumentFacts(arWifeTurns, 'ar');
    assert.deepEqual(arWifeFacts, { accommodation_type: 'undertaking' });
    assert.equal(arWifeFacts.host_is_married, undefined);
    assert.equal(verifyQuotedFact('host_is_married', 'yes', 'عندي زوجة', arWifeTurns, 'ar'), false);

    const trSpouseTurns = ['Akrabamın yanında kalıyorum, eşim de öğrenci'];
    const trSpouseFacts = extractSupportedDocumentFacts(trSpouseTurns, 'tr');
    assert.deepEqual(trSpouseFacts, { accommodation_type: 'undertaking' });
    assert.equal(trSpouseFacts.host_is_married, undefined);
    assert.equal(verifyQuotedFact('host_is_married', 'yes', 'eşim', trSpouseTurns, 'tr'), false);

    // Cross-turn Turkish demonstrative 'o' before non-host nouns and Arabic copula 'ما هو'
    for (const turns of [
        ['Akrabamın yanında kalıyorum', "O zaman Türk'üm ve bekarım"],
        ['Akrabamın yanında kalıyorum', 'O yüzden ben bekarım'],
        ['Akrabamın yanında kalıyorum', 'O belge hazır, evliyim'],
        ['Akrabamın yanında kalıyorum', 'O evrak tamam, Türk vatandaşıyım'],
        ['Akrabamın yanında kalıyorum', 'O konu hakkında, bekarım'],
        ['Akrabamın yanında kalıyorum', 'O durumda evliyim'],
        ['Akrabamın yanında kalıyorum', 'O halde bekarım']
    ]) {
        const result = extractSupportedDocumentFacts(turns, 'tr');
        assert.equal(result.host_is_married, undefined, `Unexpected host_is_married for: ${turns.join(' | ')}`);
        assert.equal(result.host_is_turkish, undefined, `Unexpected host_is_turkish for: ${turns.join(' | ')}`);
    }

    const arCrossTurnCopula = ['أسكن عند قريبي', 'ما هو المطلوب؟ عندي زوجة'];
    const arCrossTurnFacts = extractSupportedDocumentFacts(arCrossTurnCopula, 'ar');
    assert.equal(arCrossTurnFacts.host_is_married, undefined);
    assert.equal(verifyQuotedFact('host_is_married', 'yes', 'عندي زوجة', arCrossTurnCopula, 'ar'), false);
});

test('R3 finding 7: Turkmen ýanynda counts as undertaking only after a person word, never after places or objects', () => {
    const schoolNextToDorm = extractSupportedDocumentFacts(
        ['Mekdebiň ýanynda umumy ýaşaýyş jaýynda ýaşaýaryn'],
        'tk'
    );
    assert.deepEqual(schoolNextToDorm, { accommodation_type: 'dormitory' });
    assert.deepEqual(schoolNextToDorm.__uncertain, []);

    const besidesPassport = extractSupportedDocumentFacts(
        ['Pasportumyň ýanynda näme resminama gerek?'],
        'tk'
    );
    assert.deepEqual(besidesPassport, {});
    assert.deepEqual(besidesPassport.__uncertain, []);
    assert.equal(
        verifyQuotedFact('accommodation_type', 'undertaking', 'Pasportumyň ýanynda', ['Pasportumyň ýanynda näme resminama gerek?'], 'tk'),
        false
    );

    for (const text of [
        'dostumyň ýanynda ýaşaýaryn',
        'tanyşyň ýanynda ýaşaýaryn',
        'garyndaşymyň ýanynda ýaşaýaryn',
        'daýzamyň ýanynda ýaşaýaryn',
        'daýymyň ýanynda ýaşaýaryn',
        'bir adamyň ýanynda galýaryn'
    ]) {
        const res = extractSupportedDocumentFacts([text], 'tk');
        assert.equal(res.accommodation_type, 'undertaking', `Expected undertaking for: ${text}`);
    }
});

test('R3 finding 8: accommodation followed by contrast/correction marker, move-out verb, or second stay location goes to __uncertain', () => {
    const blindMoveOut = 'Merhaba, ilk başvurumu yapacağım, 19 yaşındayım. Yurtta kalıyorum ama aslında geçen hafta çıktım, şu an bir arkadaşın evindeyim, kira sözleşmesi de yok. Hangi belgeler lazım?';
    const blindResult = extractSupportedDocumentFacts([blindMoveOut], 'tr');
    assert.deepEqual(blindResult, {
        application_type: 'initial',
        is_under_18: false
    });
    assert.equal(blindResult.accommodation_type, undefined);
    assert.deepEqual(blindResult.__uncertain, ['accommodation_type']);
    assert.equal(hasEvidenceRisk([blindMoveOut], 'tr'), true);
    assert.equal(
        verifyQuotedFact('accommodation_type', 'dormitory', 'Yurtta kalıyorum', [blindMoveOut], 'tr'),
        false
    );

    const moveOutCases = [
        // tr
        { lang: 'tr', text: 'Yurtta kalıyorum ama geçen hafta çıktım' },
        { lang: 'tr', text: 'Yurtta kalıyordum, fakat taşındım' },
        { lang: 'tr', text: 'Otelde kalıyordum, ancak ayrıldım' },
        { lang: 'tr', text: 'Yurtta kalıyordum, şu an arkadaşın evindeyim' },
        // en
        { lang: 'en', text: 'I live in a dorm, but actually I moved out last week' },
        { lang: 'en', text: 'I was in a dorm, I left and now I am at a friend\'s place' },
        { lang: 'en', text: 'I stayed at a hotel, not anymore, moved to a friend\'s house' },
        // ru
        { lang: 'ru', text: 'Жил в общежитии, но на самом деле на прошлой неделе съехал' },
        { lang: 'ru', text: 'Жила в общежитии, переехала, сейчас у друга' },
        { lang: 'ru', text: 'Жил в отеле, уже не там' },
        // tk
        { lang: 'tk', text: 'Umumy ýaşaýyş jaýynda galýaryn, ýöne geçen hepde çykdym' },
        { lang: 'tk', text: 'Umumy ýaşaýyş jaýynda galýardym, emma göçdüm, häzir dostumyň öýünde' },
        // ar
        { lang: 'ar', text: 'أسكن في السكن الطلابي لكن طلعت الأسبوع الماضي' },
        { lang: 'ar', text: 'كنت في السكن الطلابي بس انتقلت وحاليا أنا عند صديق' },
        { lang: 'ar', text: 'كنت أسكن في فندق، الآن عند صديق' }
    ];

    for (const item of moveOutCases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.accommodation_type, undefined, `Expected no accommodation_type for ${item.lang}: ${item.text}`);
        assert.ok(
            result.__uncertain.includes('accommodation_type'),
            `Expected accommodation_type in __uncertain for ${item.lang}: ${item.text}`
        );
        assert.equal(hasEvidenceRisk([item.text], item.lang), true, `Expected hasEvidenceRisk=true for ${item.lang}: ${item.text}`);
    }
});

test('recency: newer user turns override older facts, within-turn conflicts stay uncertain, risk and quote verification follow recency, and older host facts require undertaking', () => {
    // 1. 3-turn scenario change: turns 2+3 override turn 1 without turning facts uncertain.
    const threeTurnScenario = [
        'İlk başvuru, 20 yaşındayım, yurtta kalıyorum, hangi belgeler gerekiyor?',
        'Uzatma başvurusu, 17 yaşındayım, bir akrabamın yanında kalıyorum',
        'Akrabam evli ve Türk vatandaşı, taahhütname verecek'
    ];
    const threeTurnFacts = extractSupportedDocumentFacts(threeTurnScenario, 'tr');
    assert.deepEqual(threeTurnFacts, {
        application_type: 'renewal',
        is_under_18: true,
        accommodation_type: 'undertaking',
        host_is_married: 'yes',
        host_is_turkish: 'yes'
    });
    assert.deepEqual(threeTurnFacts.__uncertain, []);
    assert.equal(hasEvidenceRisk(threeTurnScenario, 'tr'), false);

    // Older quotes must not override newer turns' values; newer quotes verify.
    assert.equal(verifyQuotedFact('application_type', 'initial', 'İlk başvuru', threeTurnScenario, 'tr'), false);
    assert.equal(verifyQuotedFact('application_type', 'renewal', 'Uzatma başvurusu', threeTurnScenario, 'tr'), true);
    assert.equal(verifyQuotedFact('is_under_18', false, '20 yaşındayım', threeTurnScenario, 'tr'), false);
    assert.equal(verifyQuotedFact('is_under_18', true, '17 yaşındayım', threeTurnScenario, 'tr'), true);
    assert.equal(verifyQuotedFact('accommodation_type', 'dormitory', 'yurtta kalıyorum', threeTurnScenario, 'tr'), false);
    assert.equal(verifyQuotedFact('accommodation_type', 'undertaking', 'taahhütname verecek', threeTurnScenario, 'tr'), true);
    assert.equal(verifyQuotedFact('host_is_married', 'yes', 'Akrabam evli', threeTurnScenario, 'tr'), true);
    assert.equal(verifyQuotedFact('host_is_turkish', 'yes', 'Akrabam evli ve Türk vatandaşı', threeTurnScenario, 'tr'), true);

    // 2. 2-turn age-only update keeps unchanged facts from turn 1 and overrides only age.
    const twoTurnAgeChange = [
        'İlk başvuru, 20 yaşındayım, yurtta kalıyorum, hangi belgeler gerekiyor?',
        'aslında 17 yaşındayım'
    ];
    const twoTurnFacts = extractSupportedDocumentFacts(twoTurnAgeChange, 'tr');
    assert.deepEqual(twoTurnFacts, {
        application_type: 'initial',
        is_under_18: true,
        accommodation_type: 'dormitory'
    });
    assert.deepEqual(twoTurnFacts.__uncertain, []);
    assert.equal(hasEvidenceRisk(twoTurnAgeChange, 'tr'), false);
    assert.equal(verifyQuotedFact('is_under_18', false, '20 yaşındayım', twoTurnAgeChange, 'tr'), false);
    assert.equal(verifyQuotedFact('is_under_18', true, '17 yaşındayım', twoTurnAgeChange, 'tr'), true);

    // 3. Within-turn conflicts remain uncertain while within-turn negated corrections still resolve.
    const sameTurnAppConflict = extractSupportedDocumentFacts(['İlk başvuru ve uzatma başvurusu'], 'tr');
    assert.equal(sameTurnAppConflict.application_type, undefined);
    assert.deepEqual(sameTurnAppConflict.__uncertain, ['application_type']);
    assert.equal(hasEvidenceRisk(['İlk başvuru ve uzatma başvurusu'], 'tr'), true);

    const sameTurnAgeConflict = extractSupportedDocumentFacts(['17 yaşındayım ve 20 yaşındayım'], 'tr');
    assert.equal(sameTurnAgeConflict.is_under_18, undefined);
    assert.deepEqual(sameTurnAgeConflict.__uncertain, ['is_under_18']);

    const sameTurnAccomConflict = extractSupportedDocumentFacts(['Yurtta ve otelde kalıyorum'], 'tr');
    assert.equal(sameTurnAccomConflict.accommodation_type, undefined);
    assert.deepEqual(sameTurnAccomConflict.__uncertain, ['accommodation_type']);

    const sameTurnCorrection = extractSupportedDocumentFacts(['İlk başvuru değil, uzatma başvurusu'], 'tr');
    assert.deepEqual(sameTurnCorrection, { application_type: 'renewal' });
    assert.deepEqual(sameTurnCorrection.__uncertain, []);

    // 4. hasEvidenceRisk only considers turns whose facts are actually used.
    const supersededNegationTurns = [
        'İlk başvuru, 20 yaşındayım, yurtta kalmıyorum',
        'Uzatma başvurusu, 17 yaşındayım, otelde kalıyorum'
    ];
    const supersededFacts = extractSupportedDocumentFacts(supersededNegationTurns, 'tr');
    assert.deepEqual(supersededFacts, {
        application_type: 'renewal',
        is_under_18: true,
        accommodation_type: 'hotel'
    });
    assert.deepEqual(supersededFacts.__uncertain, []);
    assert.equal(hasEvidenceRisk(supersededNegationTurns, 'tr'), false);

    const retainedNegationTurns = [
        'İlk başvuru, 20 yaşındayım, yurtta kalmıyorum',
        'Kira sözleşmesi ile kalıyorum'
    ];
    const retainedFacts = extractSupportedDocumentFacts(retainedNegationTurns, 'tr');
    assert.deepEqual(retainedFacts, {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'rental_contract'
    });
    assert.deepEqual(retainedFacts.__uncertain, []);
    assert.equal(hasEvidenceRisk(retainedNegationTurns, 'tr'), true);

    // 5. Host facts from an older turn stay valid while accommodation is undertaking, and are dropped when accommodation changes.
    const stillUndertakingTurns = [
        'Akrabamın yanında kalıyorum, akrabam evli ve Türk vatandaşı',
        'Uzatma başvurusu, 17 yaşındayım'
    ];
    assert.deepEqual(extractSupportedDocumentFacts(stillUndertakingTurns, 'tr'), {
        application_type: 'renewal',
        is_under_18: true,
        accommodation_type: 'undertaking',
        host_is_married: 'yes',
        host_is_turkish: 'yes'
    });

    const leftUndertakingTurns = [
        'Akrabamın yanında kalıyorum, akrabam evli değil ve Türk vatandaşı değil',
        'İlk başvuru, 20 yaşındayım, yurtta kalıyorum'
    ];
    const leftUndertakingFacts = extractSupportedDocumentFacts(leftUndertakingTurns, 'tr');
    assert.deepEqual(leftUndertakingFacts, {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'dormitory'
    });
    assert.deepEqual(leftUndertakingFacts.__uncertain, []);
    assert.equal(hasEvidenceRisk(leftUndertakingTurns, 'tr'), false);
    assert.equal(verifyQuotedFact('host_is_married', 'no', 'akrabam evli değil', leftUndertakingTurns, 'tr'), false);
    assert.equal(verifyQuotedFact('host_is_turkish', 'no', 'Türk vatandaşı değil', leftUndertakingTurns, 'tr'), false);
});

test('isStudentCardQuestion matches student ID card phrasings across all five languages and excludes certificates, residence permits, list intent, and status questions', () => {
    const positiveCases = [
        'Öğrenci kartımı kaybettim',
        'Öğrenci kartımı kaybettim”',
        'öğrenci kartı',
        'öğrenci kimlik kartı',
        'okul kartı',
        'Öğrenci kartım kırıldı, nereden yenileyebilirim?',
        'Öğrenci kartının basımı ne kadar sürer?',
        'student card',
        'student ID card',
        'I lost my student id',
        'Where do I apply for my university student ID card?',
        'студенческая карта',
        'студенческий билет',
        'Восстановление студенческой карты',
        'Я потерял студенческий билет',
        'talyp kart',
        'talyp şahadatnama kart',
        'Talyp kartymy ýitirdim',
        'Uniwersitetiň talyp şahadatnama kartyny nireden almaly?',
        'بطاقة الطالب',
        'بطاقة طالب',
        'كيف يمكنني استخراج بطاقة الطالب الجامعية؟'
    ];
    for (const query of positiveCases) {
        assert.equal(isStudentCardQuestion(query), true, `Expected student_card match for: ${query}`);
    }

    const negativeCases = [
        'öğrenci belgesi nedir',
        'student certificate',
        'İkamet izni kartımı kaybettim',
        'student residence permit',
        'ikamet izni için öğrenci kartı',
        'student card for residence permit',
        'студенческая карта для ВНЖ',
        'talyp karty we ýaşaýyş rugsady',
        'بطاقة الطالب للإقامة',
        'My student id number is 2201045',
        'ITU-7K9M-4X2P öğrenci kartı',
        'Başvurum ne durumda, öğrenci kartımı kaybettim',
        'İlk başvuru, 20 yaşındayım, yurtta kalıyorum, öğrenci kartı dahil belgeler neler?',
        'Do I need a student card? Which documents are required?',
        'belge?'
    ];
    for (const query of negativeCases) {
        assert.equal(isStudentCardQuestion(query), false, `Expected no student_card match for: ${query}`);
    }
});
