/**
 * @fileoverview Belge politikası kehanet (oracle) ve beş dil tutarlılık testleri (Aile B1/B2).
 * `documentPolicy.js` ve `document-conditions.js` tarafından kabul edilen tüm girdi bileşimlerini
 * sabit liste yazmadan üretir ve sohbet aracının döndürdüğü belge kodları, sırası ve i18n etiketleriyle
 * birebir eşleştiğini beş dilde (`tr`, `en`, `ru`, `tk`, `ar`) doğrular.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from '../src/public/i18n/messages.js';
import { CHATBOT_LANGUAGES } from '../src/server/domain/chatbotKnowledge.js';
import {
    CHATBOT_FIXED_TEXTS,
    buildUnderstoodFactsLine,
    getChatbotFixedText
} from '../src/server/domain/chatbotPrompt.js';
import {
    CHATBOT_TOOLS,
    executeChatbotTool,
    listCatalogDocumentTitles
} from '../src/server/domain/chatbotTools.js';
import {
    listApplicationDocumentPolicies,
    listPublicDocumentOverview
} from '../src/server/domain/documentPolicy.js';
import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../src/shared/document-conditions.js';

/**
 * Politika modülünden ve araç şemasından olası tüm geçerli senaryo bileşimlerini üretir.
 * @returns {Array<{toolArgs: object, equivalentApplication: object}>} Tüm belge politikası senaryoları.
 */
function buildAllDocumentPolicyScenarios() {
    const props = CHATBOT_TOOLS.get_required_documents.parameters.properties;
    const applicationTypes = props.application_type.enum;
    const accommodationTypes = props.accommodation_type.enum;
    const hostMarriedOptions = props.host_is_married.enum;
    const hostTurkishOptions = props.host_is_turkish.enum;
    const fingerprintOptions = props.fingerprint_status.enum;
    const ageOptions = [false, true];

    const scenarios = [];
    for (const applicationType of applicationTypes) {
        const fingerprints = applicationType === 'transition' ? fingerprintOptions : [undefined];
        for (const isUnder18 of ageOptions) {
            for (const fingerprintStatus of fingerprints) {
                for (const accommodationType of accommodationTypes) {
                    const hostVariants = accommodationType === 'undertaking'
                        ? hostMarriedOptions.flatMap((hostIsMarried) =>
                            hostTurkishOptions.map((hostIsTurkish) => ({
                                host_is_married: hostIsMarried,
                                host_is_turkish: hostIsTurkish
                            }))
                        )
                        : [{ host_is_married: undefined, host_is_turkish: undefined }];

                    for (const hostVariant of hostVariants) {
                        const toolArgs = {
                            application_type: applicationType,
                            is_under_18: isUnder18,
                            accommodation_type: accommodationType,
                            ...(hostVariant.host_is_married !== undefined
                                ? { host_is_married: hostVariant.host_is_married }
                                : {}),
                            ...(hostVariant.host_is_turkish !== undefined
                                ? { host_is_turkish: hostVariant.host_is_turkish }
                                : {}),
                            ...(fingerprintStatus !== undefined
                                ? { fingerprint_status: fingerprintStatus }
                                : {})
                        };

                        const equivalentApplication = {
                            application_type: applicationType === 'transition' ? 'renewal' : applicationType,
                            application_route: applicationType === 'transition' ? 'transition' : 'standard',
                            is_under_18: isUnder18 ? 1 : 0,
                            address_evidence_type: accommodationType,
                            accommodation_type: accommodationType !== 'residence_certificate'
                                ? accommodationType
                                : null,
                            host_is_married: hostVariant.host_is_married ?? null,
                            host_is_turkish: hostVariant.host_is_turkish ?? null,
                            fingerprint_status: fingerprintStatus ?? null,
                            fingerprint_code: fingerprintStatus === 'registered' ? 'FP-ORACLE-1' : null
                        };

                        scenarios.push({ toolArgs, equivalentApplication });
                    }
                }
            }
        }
    }
    return scenarios;
}

test('policy enumeration matches documentPolicy and document-conditions exports', () => {
    const overviewAddressTypes = [...new Set(
        listPublicDocumentOverview()
            .map((policy) => policy.address_evidence_type)
            .filter(Boolean)
    )].sort();

    assert.deepEqual(overviewAddressTypes, [...ACCOMMODATION_TYPES].sort());
    assert.deepEqual(
        CHATBOT_TOOLS.get_required_documents.parameters.properties.host_is_married.enum,
        DOCUMENT_ANSWER_OPTIONS.host_is_married
    );
    assert.deepEqual(
        CHATBOT_TOOLS.get_required_documents.parameters.properties.host_is_turkish.enum,
        DOCUMENT_ANSWER_OPTIONS.host_is_turkish
    );

    const scenarios = buildAllDocumentPolicyScenarios();
    assert.ok(scenarios.length > 0);
});

test('oracle: get_required_documents matches listApplicationDocumentPolicies in code and order across all 5 languages', () => {
    const scenarios = buildAllDocumentPolicyScenarios();

    for (const { toolArgs, equivalentApplication } of scenarios) {
        const expectedPolicies = listApplicationDocumentPolicies(equivalentApplication);
        const expectedCodes = expectedPolicies.map((policy) => policy.code);
        const expectedRequired = expectedPolicies.map((policy) => policy.required);

        for (const language of CHATBOT_LANGUAGES) {
            const toolResult = executeChatbotTool('get_required_documents', toolArgs, { language });

            assert.deepEqual(
                toolResult.documents,
                expectedPolicies,
                `Politika uyuşmazlığı (${language}): ${JSON.stringify(toolArgs)}`
            );
            assert.equal(toolResult.labels.length, expectedPolicies.length);
            assert.deepEqual(
                toolResult.labels.map((label) => label.code),
                expectedCodes,
                `Kod sırası uyuşmazlığı (${language}): ${JSON.stringify(toolArgs)}`
            );
            assert.deepEqual(
                toolResult.labels.map((label) => label.required),
                expectedRequired,
                `Zorunluluk bayrağı uyuşmazlığı (${language}): ${JSON.stringify(toolArgs)}`
            );

            const messages = {
                ...(SESSION3_MESSAGES[language] || {}),
                ...(PUBLIC_MESSAGES[language] || {})
            };

            for (let index = 0; index < expectedPolicies.length; index += 1) {
                const policy = expectedPolicies[index];
                const label = toolResult.labels[index];

                assert.equal(
                    typeof messages[policy.label_key],
                    'string',
                    `Eksik i18n etiket anahtarı (${language}): ${policy.label_key}`
                );
                assert.ok(
                    messages[policy.label_key].trim().length > 0,
                    `Boş i18n etiketi (${language}): ${policy.label_key}`
                );
                assert.equal(label.title, messages[policy.label_key]);
                assert.notEqual(label.title, policy.label_key);
                assert.equal(
                    typeof label.help,
                    'string',
                    `Eksik açıklama metni (${language}): ${policy.description_key}`
                );
                assert.ok(
                    label.help.trim().length > 0,
                    `Boş açıklama metni (${language}): ${policy.description_key}`
                );
            }

            const understoodLine = buildUnderstoodFactsLine(toolArgs, language);
            assert.ok(
                understoodLine.trim().length > 0,
                `Boş anlaşılan bilgiler satırı (${language}): ${JSON.stringify(toolArgs)}`
            );
        }
    }
});

test('five-language consistency: fixed texts, catalog titles, and public overview labels have no missing keys', () => {
    const fixedKinds = Object.keys(CHATBOT_FIXED_TEXTS);
    assert.ok(fixedKinds.length > 0);

    for (const kind of fixedKinds) {
        for (const language of CHATBOT_LANGUAGES) {
            const text = getChatbotFixedText(kind, language);
            assert.equal(typeof text, 'string', `Eksik sabit metin: ${kind}/${language}`);
            assert.ok(text.trim().length > 0, `Boş sabit metin: ${kind}/${language}`);
        }
    }

    const overview = listPublicDocumentOverview();
    const baseTitlesCount = listCatalogDocumentTitles(CHATBOT_LANGUAGES[0]).length;
    assert.equal(baseTitlesCount, overview.length);

    for (const language of CHATBOT_LANGUAGES) {
        const titles = listCatalogDocumentTitles(language);
        assert.equal(titles.length, baseTitlesCount, `Katalog başlık sayısı uyuşmuyor: ${language}`);

        const messages = {
            ...(SESSION3_MESSAGES[language] || {}),
            ...(PUBLIC_MESSAGES[language] || {})
        };
        for (const policy of overview) {
            assert.equal(
                typeof messages[policy.label_key],
                'string',
                `Genel görünüm etiket anahtarı eksik (${language}): ${policy.label_key}`
            );
            assert.ok(
                messages[policy.label_key].trim().length > 0,
                `Genel görünüm etiketi boş (${language}): ${policy.label_key}`
            );
            assert.equal(
                typeof messages[policy.description_key],
                'string',
                `Genel görünüm açıklama anahtarı eksik (${language}): ${policy.description_key}`
            );
        }
    }
});
