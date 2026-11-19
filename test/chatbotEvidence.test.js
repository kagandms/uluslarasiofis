import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    EVIDENCE_PATTERN_LISTS,
    extractSupportedDocumentFacts,
    filterDocumentArgsByEvidence,
    normalizeForEvidence
} from '../src/server/domain/chatbotEvidence.js';
import {
    CHATBOT_ROUTE_NORMALIZED_PATTERNS,
    isDeterministicHandoffRequest,
    isOtherStudentsDataRequest,
    isStatusQuestionWithoutReference,
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
        { lang: 'tr', text: 'evli değil, Türk vatandaşı değil', married: 'no', turkish: 'no' },
        // en
        { lang: 'en', text: 'My host is married and is a Turkish citizen', married: 'yes', turkish: 'yes' },
        { lang: 'en', text: 'host is not married and not a Turkish citizen', married: 'no', turkish: 'no' },
        // ru
        { lang: 'ru', text: 'Принимающее лицо состоит в браке и является гражданином Турции', married: 'yes', turkish: 'yes' },
        { lang: 'ru', text: 'не женат и не гражданин Турции', married: 'no', turkish: 'no' },
        // tk
        { lang: 'tk', text: 'Borçnama berýän adam öýlenen we Türkiýäniň raýaty', married: 'yes', turkish: 'yes' },
        { lang: 'tk', text: 'öýlenmedik, Türkiýäniň raýaty däl', married: 'no', turkish: 'no' },
        // ar
        { lang: 'ar', text: 'مقدم التعهد متزوج ومواطن تركي', married: 'yes', turkish: 'yes' },
        { lang: 'ar', text: 'غير متزوج وليس مواطن تركي', married: 'no', turkish: 'no' }
    ];

    for (const item of cases) {
        const result = extractSupportedDocumentFacts([item.text], item.lang);
        assert.equal(result.host_is_married, item.married, `Married failed for ${item.lang}: ${item.text}`);
        assert.equal(result.host_is_turkish, item.turkish, `Turkish failed for ${item.lang}: ${item.text}`);
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
    const unnormalizedCharPattern = /[йёýňäüžşçğöıİأإآٱةىؤئ\u064B-\u065F\u0670\u0640]/u;
    const entries = [
        ...collectNormalizedPatternSources(EVIDENCE_PATTERN_LISTS, 'EVIDENCE_PATTERN_LISTS'),
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
    assert.equal(extractSupportedDocumentFacts(['Parmak izim kayıtlı mı?'], 'tr').fingerprint_status, undefined);
});
