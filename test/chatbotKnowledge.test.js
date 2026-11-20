import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ACCOMMODATION_TYPES } from '../src/shared/document-conditions.js';
import { PUBLIC_MESSAGES } from '../src/public/i18n/messages.js';
import { listApplicationDocumentPolicies, listPublicDocumentOverview } from '../src/server/domain/documentPolicy.js';
import { listCatalogDocumentTitles } from '../src/server/domain/chatbotTools.js';
import { ApiError } from '../src/server/domain/errors.js';
import {
    CHATBOT_LANGUAGES,
    CHATBOT_TOPICS,
    readKnowledge
} from '../src/server/domain/chatbotKnowledge.js';

const NEW_TOPICS = [
    'application_types',
    'document_format',
    'document_resubmission',
    'forgot_reference',
    'tracking',
    'address_evidence',
    'fingerprint',
    'privacy',
    'fees_and_appointment'
];

test('CHATBOT_TOPICS exposes the fixed fourteen-topic enum and all five portal languages', () => {
    assert.deepEqual(CHATBOT_TOPICS, [
        'application_steps',
        'residence_permit_basics',
        'application_types',
        'document_format',
        'document_resubmission',
        'forgot_reference',
        'tracking',
        'address_evidence',
        'fingerprint',
        'privacy',
        'fees_and_appointment',
        'office_hours',
        'student_card',
        'contact'
    ]);
    assert.deepEqual(CHATBOT_LANGUAGES, ['tr', 'en', 'ru', 'tk', 'ar']);
});

test('readKnowledge returns non-empty curated text and sources for every topic in all five languages', () => {
    for (const topic of CHATBOT_TOPICS) {
        for (const language of CHATBOT_LANGUAGES) {
            const entry = readKnowledge(topic, language);
            assert.equal(typeof entry.text, 'string', `${topic}/${language} must return string text`);
            assert.ok(entry.text.trim().length > 20, `${topic}/${language} text must not be empty`);
            assert.ok([...entry.text].length <= 1200, `${topic}/${language} must fit within 1200 chars`);
            if (NEW_TOPICS.includes(topic)) {
                assert.ok([...entry.text].length <= 700, `${topic}/${language} new topic must stay within 700 chars`);
            }
            assert.ok(Array.isArray(entry.sources) && entry.sources.length > 0, `${topic}/${language} must cite sources`);
            for (const source of entry.sources) {
                assert.equal(typeof source, 'string');
                assert.ok(source.length > 0);
            }
        }
    }
});

test('readKnowledge rejects unknown or non-string topics', () => {
    for (const invalidTopic of ['unknown_topic', '', '   ', '__proto__', 'constructor', null, undefined, 42]) {
        assert.throws(
            () => readKnowledge(invalidTopic, 'tr'),
            (error) => error instanceof ApiError && error.status === 400 && error.code === 'VALIDATION_ERROR'
        );
    }
});

test('readKnowledge falls back to Turkish when language is omitted or unsupported', () => {
    const turkish = readKnowledge('application_steps', 'tr');
    assert.deepEqual(readKnowledge('application_steps'), turkish);
    assert.deepEqual(readKnowledge('application_steps', 'de'), turkish);
    assert.deepEqual(readKnowledge('application_steps', null), turkish);
});

test('office_hours states confirmed 09:00-18:00 hours and contact uses only owner-supplied office channels', () => {
    const allowedWhatsappPattern = /(?<!\d)(?:\+90 535 455 94 09|0535 455 94 09)(?!\d)/g;
    const trOfficeHours = readKnowledge('office_hours', 'tr');
    assert.equal(
        trOfficeHours.text,
        'Uluslararası Öğrenci Ofisi hafta içi 09:00–18:00 saatleri arasında açıktır. Sorularınızı ana sayfadaki soru formundan da iletebilirsiniz. Bu saatler dışında da WhatsApp veya e-posta üzerinden yazabilirsiniz.'
    );

    for (const language of CHATBOT_LANGUAGES) {
        const officeHours = readKnowledge('office_hours', language);
        assert.ok(officeHours.text.includes('09:00–18:00'), `${language} office_hours must include 09:00–18:00`);
        assert.deepEqual(
            officeHours.text.match(/\b\d{1,2}[:.]\d{2}\b/g),
            ['09:00', '18:00'],
            `${language} office_hours must contain only 09:00 and 18:00`
        );
        assert.ok(officeHours.text.includes('WhatsApp'), `${language} office_hours must mention WhatsApp`);
        assert.equal(officeHours.text.includes('0535 455 94 09'), false, `${language} office_hours must not repeat phone numbers`);
        assert.equal(officeHours.text.includes('goc.topkapiuni@gmail.com'), false, `${language} office_hours must not repeat e-mail`);

        const contact = readKnowledge('contact', language);
        const contactWithoutAllowedPhone = contact.text.replace(allowedWhatsappPattern, ' ');
        assert.equal(
            /(\+90|0\s*5\d{2}|\d{3}[-\s]\d{3})/.test(contactWithoutAllowedPhone),
            false,
            `${language} contact must not invent phone numbers`
        );
        assert.equal(contact.text.includes('international.office.topkapi@topkapi.edu.tr'), false);
    }
});

test('contact in every language provides the WhatsApp number with a message-only note, the office e-mail, office hours, and does not offer phone calls', () => {
    const whatsappNextToNumber = /(?:WhatsApp[^.\n]{0,45}(?:\+90 535 455 94 09|0535 455 94 09)|(?:\+90 535 455 94 09|0535 455 94 09)[^.\n]{0,45}WhatsApp)/;
    const whatsappOnlyNotes = {
        tr: /yalnızca mesaj.*aramayın/i,
        en: /WhatsApp message only.*do not call/i,
        ru: /только сообщением в WhatsApp.*не звоните/i,
        tk: /diňe hat ýazyp.*jaň etmäň/i,
        ar: /رسالة WhatsApp فقط.*عدم الاتصال/
    };
    const callOfferedPatterns = {
        tr: /(?:bizi )?arayabilirsiniz|telefonla arayın/i,
        en: /\bcall us\b|\bplease call\b|\byou can call\b|\bby phone\b/i,
        ru: /позвоните|можете позвонить|по телефону/i,
        tk: /jaň ediň|jaň edip bilersiňiz/i,
        ar: /اتصلوا|يمكنكم الاتصال/
    };

    for (const language of CHATBOT_LANGUAGES) {
        const { text } = readKnowledge('contact', language);
        assert.ok([...text].length <= 600, `${language} contact must stay within 600 chars`);
        assert.ok(
            text.includes('0535 455 94 09') || text.includes('+90 535 455 94 09'),
            `${language} contact must include the WhatsApp number`
        );
        assert.ok(
            whatsappNextToNumber.test(text),
            `${language} contact must mention WhatsApp next to the number`
        );
        assert.ok(
            text.includes('goc.topkapiuni@gmail.com'),
            `${language} contact must include goc.topkapiuni@gmail.com`
        );
        assert.ok(
            text.includes('kisiselverilerim@topkapi.edu.tr'),
            `${language} contact must include kisiselverilerim@topkapi.edu.tr`
        );
        assert.ok(
            text.includes('09:00–18:00'),
            `${language} contact must include 09:00–18:00 office hours`
        );
        assert.match(
            text,
            whatsappOnlyNotes[language],
            `${language} contact must include a WhatsApp message-only / do-not-call note`
        );
        assert.equal(
            callOfferedPatterns[language].test(text),
            false,
            `${language} contact must not offer phone calls as an option`
        );
    }
});

test('every remaining draft topic entry in chatbotKnowledge.js carries the office-approval DRAFT comment and office_hours does not', () => {
    const source = fs.readFileSync(
        new URL('../src/server/domain/chatbotKnowledge.js', import.meta.url),
        'utf8'
    );
    const draftTopics = CHATBOT_TOPICS.filter((topic) => topic !== 'office_hours');
    const draftCommentCount = source.match(/\/\/ DRAFT: needs office approval/g)?.length || 0;
    assert.ok(
        draftCommentCount >= draftTopics.length * CHATBOT_LANGUAGES.length,
        'Expected every remaining draft topic and language entry to carry // DRAFT: needs office approval'
    );

    for (const topic of draftTopics) {
        const blockMatch = source.match(new RegExp(`    ${topic}: Object\\.freeze\\(\\{[\\s\\S]*?\\n    \\}\\)`));
        assert.ok(blockMatch, `Expected to locate ${topic} block in chatbotKnowledge.js`);
        const blockDraftCount = blockMatch[0].match(/\/\/ DRAFT: needs office approval/g)?.length || 0;
        assert.ok(
            blockDraftCount >= CHATBOT_LANGUAGES.length,
            `${topic} must carry // DRAFT: needs office approval for every language`
        );
    }

    const officeHoursBlock = source.match(/office_hours:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/)?.[0] || '';
    assert.ok(officeHoursBlock.length > 0, 'Expected to locate office_hours block in chatbotKnowledge.js');
    assert.equal(officeHoursBlock.includes('DRAFT: needs office approval'), false);
});

test('knowledge texts allow only the approved office and KVKK contact values and forbid other phone numbers, e-mails, URLs, currency amounts, or dates', () => {
    const kvkkEmail = 'kisiselverilerim@topkapi.edu.tr';
    const officeEmail = 'goc.topkapiuni@gmail.com';
    const allowedWhatsappPattern = /(?<!\d)(?:\+90 535 455 94 09|0535 455 94 09)(?!\d)/g;
    const phonePattern = /(\+90|0\s*5\d{2}|\d{3}[-\s]\d{3,4})/;
    const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    const urlPattern = /(?:https?:\/\/|www\.)\S+/i;
    const domainPattern = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|edu|gov|tr|info|io|ru|tm|ae)(?:\.[a-z]{2})?\b/i;
    const currencyPattern = /(\d[\d.,]*\s*(?:TL|TRY|USD|EUR|Lira)|[₺$€]\s*\d|\d\s*[₺$€])/i;
    const datePattern = /(\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b20\d{2}\b)/;

    for (const topic of CHATBOT_TOPICS) {
        const allowedEmails = topic === 'contact' ? new Set([kvkkEmail, officeEmail]) : new Set([kvkkEmail]);
        for (const language of CHATBOT_LANGUAGES) {
            const { text } = readKnowledge(topic, language);
            const textForPhoneCheck = topic === 'contact' ? text.replace(allowedWhatsappPattern, ' ') : text;
            const textWithoutAllowedEmails = text.replaceAll(kvkkEmail, ' ').replaceAll(officeEmail, ' ');

            assert.equal(phonePattern.test(textForPhoneCheck), false, `${topic}/${language} must not contain unapproved phone numbers`);
            assert.equal(urlPattern.test(textWithoutAllowedEmails), false, `${topic}/${language} must not contain URLs`);
            assert.equal(domainPattern.test(textWithoutAllowedEmails), false, `${topic}/${language} must not contain domain names`);
            assert.equal(currencyPattern.test(text), false, `${topic}/${language} must not contain currency amounts`);
            assert.equal(datePattern.test(text), false, `${topic}/${language} must not contain calendar dates`);

            const emails = text.match(emailPattern) || [];
            for (const email of emails) {
                assert.ok(allowedEmails.has(email), `${topic}/${language} must only use allowed e-mail addresses, found ${email}`);
            }
        }
    }
});

test('fingerprint topic directs students without fingerprint registration to the university International Student Office across all five languages', () => {
    const officeMarkers = {
        tr: 'Uluslararası Öğrenci Ofisine',
        en: 'International Student Office at the university',
        ru: 'Международный студенческий офис в университете',
        tk: 'Halkara talyplar ofisine',
        ar: 'مكتب الطلاب الدوليين في الجامعة'
    };

    for (const language of CHATBOT_LANGUAGES) {
        const { text } = readKnowledge('fingerprint', language);
        assert.ok(text.includes(officeMarkers[language]), `${language} fingerprint topic must direct to ${officeMarkers[language]}`);
    }
});

test('application_types states no required documents and contains no catalog document titles in any language', () => {
    const legacyDocumentKeys = [
        'documentVisa',
        'documentResidenceCard',
        'documentAddressHotelReceipt',
        'documentHostIdentityCopy'
    ];

    for (const language of CHATBOT_LANGUAGES) {
        const { text } = readKnowledge('application_types', language);
        const normalizedText = text.toLocaleLowerCase(language);
        const catalogTitles = listCatalogDocumentTitles(language);
        assert.ok(catalogTitles.length >= 20, `Expected catalog titles for ${language}`);

        for (const title of catalogTitles) {
            assert.equal(
                normalizedText.includes(title.toLocaleLowerCase(language)),
                false,
                `application_types/${language} must not mention catalog document "${title}"`
            );
        }

        for (const key of legacyDocumentKeys) {
            const legacyTitle = PUBLIC_MESSAGES[language]?.[key];
            if (!legacyTitle) continue;
            assert.equal(
                normalizedText.includes(legacyTitle.toLocaleLowerCase(language)),
                false,
                `application_types/${language} must not mention legacy document "${legacyTitle}"`
            );
        }
    }
});

test('address_evidence mentions only documents present in the policy list for some accommodation type', () => {
    const overviewByCode = new Map(listPublicDocumentOverview().map((entry) => [entry.code, entry]));
    const policiesByAccommodation = new Map();
    const allAccommodationPolicyCodes = new Set();

    for (const accommodationType of ACCOMMODATION_TYPES) {
        const policies = listApplicationDocumentPolicies({
            application_type: 'initial',
            application_route: 'standard',
            is_under_18: 0,
            address_evidence_type: accommodationType,
            accommodation_type: accommodationType !== 'residence_certificate' ? accommodationType : null,
            host_is_married: accommodationType === 'undertaking' ? 'yes' : null,
            host_is_turkish: accommodationType === 'undertaking' ? 'yes' : null
        }).filter((policy) => overviewByCode.get(policy.code)?.address_evidence_type === accommodationType);

        const codes = new Set(policies.map((policy) => policy.code));
        policiesByAccommodation.set(accommodationType, codes);
        for (const code of codes) {
            allAccommodationPolicyCodes.add(code);
        }
    }

    const nonAccommodationKeys = listPublicDocumentOverview()
        .filter((entry) => !entry.address_evidence_type)
        .map((entry) => entry.label_key);
    const forbiddenKeys = [
        ...nonAccommodationKeys,
        'documentVisa',
        'documentResidenceCard',
        'documentAddressHotelReceipt',
        'documentHostIdentityCopy',
        'documentMinorFamilyEvidence',
        'documentParentPermitCopy',
        'documentBirthCertificateUnder18'
    ];

    const clauseExpectations = [
        {
            accommodationType: 'rental_contract',
            mentions: {
                tr: [['kira sözleşmesi', 'address_rental_contract']],
                en: [['rental contract', 'address_rental_contract']],
                ru: [['договор аренды', 'address_rental_contract']],
                tk: [['kärende şertnamasy', 'address_rental_contract']],
                ar: [['عقد إيجار', 'address_rental_contract']]
            }
        },
        {
            accommodationType: 'own_home',
            mentions: {
                tr: [
                    ['tapu fotokopisi', 'address_title_deed'],
                    ['numarataj belgesi', 'address_numbering'],
                    ['dask', 'address_dask']
                ],
                en: [
                    ['title deed copy', 'address_title_deed'],
                    ['numbering document', 'address_numbering'],
                    ['dask', 'address_dask']
                ],
                ru: [
                    ['копия документа о собственности', 'address_title_deed'],
                    ['нумерация адреса', 'address_numbering'],
                    ['dask', 'address_dask']
                ],
                tk: [
                    ['eýeçilik nusgasy', 'address_title_deed'],
                    ['belgilenme resminamasy', 'address_numbering'],
                    ['dask', 'address_dask']
                ],
                ar: [
                    ['نسخة سند الملكية', 'address_title_deed'],
                    ['ترقيم العنوان', 'address_numbering'],
                    ['dask', 'address_dask']
                ]
            }
        },
        {
            accommodationType: 'dormitory',
            mentions: {
                tr: [
                    ['yurtta kalış belgesi', 'address_dormitory'],
                    ['yurdun vergi levhası', 'dormitory_tax_certificate'],
                    ['imza sirküleri', 'dormitory_signature_circular']
                ],
                en: [
                    ['dormitory residence document', 'address_dormitory'],
                    ['tax certificate', 'dormitory_tax_certificate'],
                    ['signature circular', 'dormitory_signature_circular']
                ],
                ru: [
                    ['справка о проживании', 'address_dormitory'],
                    ['налоговое свидетельство', 'dormitory_tax_certificate'],
                    ['циркуляр подписей', 'dormitory_signature_circular']
                ],
                tk: [
                    ['galýanlyk resminamasy', 'address_dormitory'],
                    ['salgyt şahadatnamasy', 'dormitory_tax_certificate'],
                    ['gol nusgalary', 'dormitory_signature_circular']
                ],
                ar: [
                    ['إثبات الإقامة', 'address_dormitory'],
                    ['الشهادة الضريبية', 'dormitory_tax_certificate'],
                    ['تعميم التوقيعات', 'dormitory_signature_circular']
                ]
            }
        },
        {
            accommodationType: 'hotel',
            mentions: {
                tr: [['konaklama belgesi', 'address_hotel']],
                en: [['accommodation document', 'address_hotel']],
                ru: [['подтверждение проживания', 'address_hotel']],
                tk: [['galýan ýeri we seneleri görkezýän resminama', 'address_hotel']],
                ar: [['وثيقة الإقامة', 'address_hotel']]
            }
        },
        {
            accommodationType: 'undertaking',
            mentions: {
                tr: [
                    ['noter onaylı taahhütname', 'address_undertaking'],
                    ['eşinin de taahhütnamesi', 'host_spouse_undertaking'],
                    ['yerleşim yeri belgesi', 'host_residence_certificate'],
                    ['adına fatura', 'home_utility_bill'],
                    ['vukuatlı nüfus kayıt örneği', 'host_population_record']
                ],
                en: [
                    ['notarized undertaking', 'address_undertaking'],
                    ['spouse’s', 'host_spouse_undertaking'],
                    ['host’s address certificate', 'host_residence_certificate'],
                    ['utility bill', 'home_utility_bill'],
                    ['detailed population record', 'host_population_record']
                ],
                ru: [
                    ['нотариальное обязательство', 'address_undertaking'],
                    ['супруга', 'host_spouse_undertaking'],
                    ['справка о месте жительства', 'host_residence_certificate'],
                    ['счёт', 'home_utility_bill'],
                    ['выписка реестра населения', 'host_population_record']
                ],
                tk: [
                    ['notarial borçnama', 'address_undertaking'],
                    ['ýanýoldaşynyňky', 'host_spouse_undertaking'],
                    ['ýaşaýan ýeri şahadatnamasy', 'host_residence_certificate'],
                    ['töleg hasaby', 'home_utility_bill'],
                    ['giňişleýin ilat ýazgysy', 'host_population_record']
                ],
                ar: [
                    ['تعهد موثق', 'address_undertaking'],
                    ['من زوجه', 'host_spouse_undertaking'],
                    ['شهادة محل إقامته', 'host_residence_certificate'],
                    ['فاتورة باسمه', 'home_utility_bill'],
                    ['قيد نفوس مفصل', 'host_population_record']
                ]
            }
        },
        {
            accommodationType: 'residence_certificate',
            mentions: {
                tr: [['yerleşim yeri belgesi', 'address_residence_certificate']],
                en: [['residence certificate', 'address_residence_certificate']],
                ru: [['справка о месте жительства', 'address_residence_certificate']],
                tk: [['ýaşaýan ýeri şahadatnamasy', 'address_residence_certificate']],
                ar: [['شهادة محل الإقامة', 'address_residence_certificate']]
            }
        }
    ];

    for (const language of CHATBOT_LANGUAGES) {
        const { text } = readKnowledge('address_evidence', language);
        const normalizedText = text.toLocaleLowerCase(language);

        for (const key of forbiddenKeys) {
            const title = PUBLIC_MESSAGES[language]?.[key];
            if (!title) continue;
            assert.equal(
                normalizedText.includes(title.toLocaleLowerCase(language)),
                false,
                `address_evidence/${language} must not mention non-accommodation document "${title}"`
            );
        }

        const clauses = [...text.matchAll(/([1-6])\)\s*([^.]+)\./g)];
        assert.equal(clauses.length, 6, `address_evidence/${language} must list 6 numbered options`);

        for (let index = 0; index < clauseExpectations.length; index += 1) {
            const { accommodationType, mentions } = clauseExpectations[index];
            const clauseNumber = Number(clauses[index][1]);
            assert.equal(clauseNumber, index + 1);
            const clauseText = clauses[index][2].toLocaleLowerCase(language);
            const expectedCodes = policiesByAccommodation.get(accommodationType);
            const matchedCodes = new Set();

            for (const [phrase, code] of mentions[language]) {
                assert.ok(
                    clauseText.includes(phrase.toLocaleLowerCase(language)),
                    `address_evidence/${language} option ${index + 1} (${accommodationType}) should mention "${phrase}"`
                );
                assert.ok(
                    allAccommodationPolicyCodes.has(code) && expectedCodes.has(code),
                    `Document "${phrase}" (${code}) must appear in policy list for ${accommodationType}`
                );
                matchedCodes.add(code);
            }

            assert.deepEqual(
                [...matchedCodes].sort(),
                [...expectedCodes].sort(),
                `address_evidence/${language} option ${index + 1} (${accommodationType}) must cover exact policy documents`
            );
        }
    }
});
