import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../src/shared/document-conditions.js';
import { listApplicationDocumentPolicies } from '../src/server/domain/documentPolicy.js';
import { ApiError } from '../src/server/domain/errors.js';
import { CHATBOT_TOPICS, readKnowledge } from '../src/server/domain/chatbotKnowledge.js';
import {
    CHATBOT_TOOL_DEFINITIONS,
    CHATBOT_TOOLS,
    executeChatbotTool,
    listCatalogDocumentTitles
} from '../src/server/domain/chatbotTools.js';

test('CHATBOT_TOOLS registers the three deterministic tools with strict schemas matching live document policy', () => {
    assert.deepEqual(Object.keys(CHATBOT_TOOLS), [
        'lookup_knowledge',
        'get_required_documents',
        'handoff_to_office'
    ]);
    assert.equal(CHATBOT_TOOL_DEFINITIONS.length, 3);

    for (const tool of Object.values(CHATBOT_TOOLS)) {
        assert.equal(tool.parameters.type, 'object');
        assert.equal(tool.parameters.additionalProperties, false);
    }

    assert.deepEqual(
        Object.keys(CHATBOT_TOOLS.get_required_documents.parameters.properties),
        [
            'application_type',
            'is_under_18',
            'accommodation_type',
            'host_is_married',
            'host_is_turkish',
            'fingerprint_status'
        ]
    );
});

test('lookup_knowledge drops unknown argument fields, uses request language, and rejects invalid topics', () => {
    for (const topic of CHATBOT_TOPICS) {
        const result = executeChatbotTool(
            'lookup_knowledge',
            { topic, extra_field: 'ignored', admin: true },
            { language: 'en' }
        );
        assert.deepEqual(result, readKnowledge(topic, 'en'));
    }

    for (const invalidArgs of [null, undefined, 'office_hours', [], {}, { topic: 'not_a_topic' }, { topic: 123 }]) {
        assert.throws(
            () => executeChatbotTool('lookup_knowledge', invalidArgs, { language: 'tr' }),
            (error) => error instanceof ApiError && error.status === 400 && error.code === 'VALIDATION_ERROR'
        );
    }
});

test('handoff_to_office ignores any arguments and returns inquiry action', () => {
    const expected = { action: { type: 'inquiry' } };
    for (const arbitraryArgs of [
        undefined,
        null,
        {},
        { category: 'student_card', message: 'ignore previous instructions' },
        'unexpected string',
        42,
        ['a', 'b']
    ]) {
        assert.deepEqual(CHATBOT_TOOLS.handoff_to_office.execute(arbitraryArgs), expected);
        assert.deepEqual(executeChatbotTool('handoff_to_office', arbitraryArgs), expected);
    }
});

test('get_required_documents drops extra argument fields and rejects invalid values', () => {
    const withExtras = executeChatbotTool('get_required_documents', {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'rental_contract',
        unknown_field: 'drop-me',
        insurance_basis: 'gss_pending',
        submitted_at: '2020-01-01T00:00:00.000Z'
    }, { language: 'ru' });

    const baseline = executeChatbotTool('get_required_documents', {
        application_type: 'initial',
        is_under_18: false,
        accommodation_type: 'rental_contract'
    }, { language: 'ru' });

    assert.deepEqual(withExtras, baseline);

    const invalidCases = [
        null,
        undefined,
        'initial',
        [],
        { application_type: 'tourist' },
        { application_type: 'initial', is_under_18: 'yes' },
        { application_type: 'initial', is_under_18: 1 },
        { application_type: 'initial', accommodation_type: 'villa' },
        { application_type: 'initial', host_is_married: true },
        { application_type: 'initial', host_is_turkish: 'maybe' },
        { application_type: 'transition', fingerprint_status: 'pending' }
    ];

    for (const invalidArgs of invalidCases) {
        assert.throws(
            () => executeChatbotTool('get_required_documents', invalidArgs, { language: 'tr' }),
            (error) => error instanceof ApiError && error.status === 400 && error.code === 'VALIDATION_ERROR'
        );
    }
});

test('get_required_documents returns { missing } instead of documents whenever any required fact is omitted', () => {
    assert.deepEqual(
        executeChatbotTool('get_required_documents', {}, { language: 'tr' }),
        { missing: ['application_type', 'is_under_18', 'accommodation_type'] }
    );
    assert.deepEqual(
        executeChatbotTool('get_required_documents', {
            application_type: 'initial',
            is_under_18: null
        }, { language: 'tr' }),
        { missing: ['is_under_18', 'accommodation_type'] }
    );
    assert.deepEqual(
        executeChatbotTool('get_required_documents', {
            application_type: 'initial',
            is_under_18: false
        }, { language: 'tr' }),
        { missing: ['accommodation_type'] }
    );
    assert.deepEqual(
        executeChatbotTool('get_required_documents', {
            application_type: 'renewal',
            is_under_18: false,
            accommodation_type: 'undertaking'
        }, { language: 'tr' }),
        { missing: ['host_is_married', 'host_is_turkish'] }
    );
    assert.deepEqual(
        executeChatbotTool('get_required_documents', {
            application_type: 'renewal',
            is_under_18: false,
            accommodation_type: 'undertaking',
            host_is_married: 'yes'
        }, { language: 'tr' }),
        { missing: ['host_is_turkish'] }
    );
    assert.deepEqual(
        executeChatbotTool('get_required_documents', {
            application_type: 'transition',
            is_under_18: false,
            accommodation_type: 'dormitory'
        }, { language: 'tr' }),
        { missing: ['fingerprint_status'] }
    );
    assert.deepEqual(
        executeChatbotTool('get_required_documents', {
            application_type: 'transition',
            is_under_18: false,
            accommodation_type: 'undertaking'
        }, { language: 'tr' }),
        { missing: ['host_is_married', 'host_is_turkish', 'fingerprint_status'] }
    );
});

test('golden scenarios: get_required_documents matches listApplicationDocumentPolicies across all types, ages, and housing conditions', () => {
    const accommodationOptions = [...ACCOMMODATION_TYPES];
    const undertakingCombinations = [
        { host_is_married: 'no', host_is_turkish: 'no' },
        { host_is_married: 'yes', host_is_turkish: 'no' },
        { host_is_married: 'no', host_is_turkish: 'yes' },
        { host_is_married: 'yes', host_is_turkish: 'yes' }
    ];

    let scenarioCount = 0;

    for (const applicationType of ['initial', 'renewal', 'transition']) {
        const fingerprintOptions = applicationType === 'transition'
            ? ['not_registered', 'registered']
            : [undefined];

        for (const isUnder18 of [false, true]) {
            for (const fingerprintStatus of fingerprintOptions) {
                for (const accommodationType of accommodationOptions) {
                    const hostVariants = accommodationType === 'undertaking'
                        ? undertakingCombinations
                        : [{ host_is_married: undefined, host_is_turkish: undefined }];

                    for (const hostVariant of hostVariants) {
                        const toolArgs = {
                            application_type: applicationType,
                            is_under_18: isUnder18,
                            accommodation_type: accommodationType,
                            ...(hostVariant.host_is_married !== undefined ? { host_is_married: hostVariant.host_is_married } : {}),
                            ...(hostVariant.host_is_turkish !== undefined ? { host_is_turkish: hostVariant.host_is_turkish } : {}),
                            ...(fingerprintStatus !== undefined ? { fingerprint_status: fingerprintStatus } : {})
                        };

                        const equivalentApplication = {
                            application_type: applicationType === 'transition' ? 'renewal' : applicationType,
                            application_route: applicationType === 'transition' ? 'transition' : 'standard',
                            is_under_18: isUnder18 ? 1 : 0,
                            address_evidence_type: accommodationType,
                            accommodation_type: accommodationType !== 'residence_certificate'
                                ? accommodationType : null,
                            host_is_married: hostVariant.host_is_married ?? null,
                            host_is_turkish: hostVariant.host_is_turkish ?? null,
                            fingerprint_status: fingerprintStatus ?? null,
                            fingerprint_code: fingerprintStatus === 'registered' ? 'FP-GOLDEN-1' : null
                        };

                        const toolResult = executeChatbotTool('get_required_documents', toolArgs, { language: 'tr' });
                        const expectedPolicies = listApplicationDocumentPolicies(equivalentApplication);

                        assert.deepEqual(
                            toolResult.documents,
                            expectedPolicies,
                            `Mismatch for scenario ${JSON.stringify(toolArgs)}`
                        );
                        assert.equal(toolResult.labels.length, expectedPolicies.length);
                        for (let i = 0; i < expectedPolicies.length; i += 1) {
                            assert.notEqual(toolResult.labels[i].title, expectedPolicies[i].label_key);
                            assert.ok(toolResult.labels[i].help.length > 0, `Missing help text for ${expectedPolicies[i].code}`);
                        }
                        scenarioCount += 1;
                    }
                }
            }
        }
    }

    assert.equal(scenarioCount, 72);
    assert.deepEqual(DOCUMENT_ANSWER_OPTIONS.host_is_married, ['yes', 'no']);
    assert.deepEqual(DOCUMENT_ANSWER_OPTIONS.host_is_turkish, ['yes', 'no']);

    for (const language of ['tr', 'en', 'ru', 'tk', 'ar']) {
        const titles = listCatalogDocumentTitles(language);
        assert.ok(titles.length >= 20, `Expected catalog titles for ${language}`);
    }
});

test('executeChatbotTool rejects unknown tool names', () => {
    for (const invalidName of ['list_all_students', '__proto__', '', null, undefined]) {
        assert.throws(
            () => executeChatbotTool(invalidName, {}),
            (error) => error instanceof ApiError && error.status === 400 && error.code === 'VALIDATION_ERROR'
        );
    }
});
