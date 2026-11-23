import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHATBOT_LANGUAGES } from '../src/server/domain/chatbotKnowledge.js';
import { buildChatbotSystemPrompt } from '../src/server/domain/chatbotPrompt.js';
import {
    APPLICATION_STATUS_LABELS,
    CHATBOT_STATUS_FIXED_TEXTS,
    getChatbotStatusFixedText,
    renderStatusSummary
} from '../src/server/domain/chatbotStatusText.js';

const EXPECTED_STATUSES = [
    'draft',
    'submitted',
    'under_review',
    'resubmission_required',
    'approved_for_processing',
    'sent_to_migration',
    'migration_approved',
    'completed',
    'cancelled',
    'rejected'
];

test('APPLICATION_STATUS_LABELS maps every application status in all five portal languages', () => {
    for (const language of CHATBOT_LANGUAGES) {
        assert.deepEqual(Object.keys(APPLICATION_STATUS_LABELS[language]).sort(), [...EXPECTED_STATUSES].sort());
        for (const status of EXPECTED_STATUSES) {
            assert.equal(typeof APPLICATION_STATUS_LABELS[language][status], 'string');
            assert.ok(APPLICATION_STATUS_LABELS[language][status].trim().length > 0);
        }
    }
});

test('renderStatusSummary renders fixed templates with status label, document counts, and /basvurum/ in all five languages', () => {
    const sampleResult = {
        found: true,
        application: {
            status: 'resubmission_required',
            application_type: 'renewal',
            created_at: '2026-10-01T08:00:00.000Z',
            updated_at: '2026-10-02T09:00:00.000Z',
            submitted_at: '2026-10-01T09:00:00.000Z'
        },
        documents: [
            { code: 'passport', label_key: 'documentPassport', required: true, status: 'approved' },
            { code: 'visa', label_key: 'documentVisa', required: false, status: 'not_uploaded' },
            { code: 'health_insurance', label_key: 'documentHealthInsurance', required: true, status: 'waiting_review' },
            { code: 'uets', label_key: 'documentUets', required: true, status: 'under_review' },
            {
                code: 'student_certificate',
                label_key: 'documentStudentCertificate',
                required: true,
                status: 'resubmission_required',
                student_message: 'PRIVATE-STAFF-NOTE-123'
            },
            { code: 'residence_card', label_key: 'documentResidenceCard', required: true, status: 'contact_office' }
        ]
    };

    for (const language of CHATBOT_LANGUAGES) {
        const summary = renderStatusSummary(sampleResult, language);
        assert.ok(summary.includes(APPLICATION_STATUS_LABELS[language].resubmission_required));
        assert.ok(summary.includes('1'), `${language} should include 1 approved`);
        assert.ok(summary.includes('2'), `${language} should include 2 waiting/under review`);
        assert.ok(summary.includes('2'), `${language} should include 2 needing action`);
        assert.ok(summary.includes('/basvurum/'), `${language} should direct to /basvurum/`);
        assert.equal(summary.includes('PRIVATE-STAFF-NOTE-123'), false);
        assert.equal(summary.includes('resubmission_required'), false);
        assert.ok(summary.length <= 1200);
    }

    assert.equal(renderStatusSummary(sampleResult, 'de'), renderStatusSummary(sampleResult, 'tr'));
});

test('renderStatusSummary maps every known status and falls back safely for unknown or prototype status strings', () => {
    for (const language of CHATBOT_LANGUAGES) {
        for (const status of EXPECTED_STATUSES) {
            const summary = renderStatusSummary({
                found: true,
                application: { status },
                documents: []
            }, language);
            assert.ok(summary.includes(APPLICATION_STATUS_LABELS[language][status]));
            assert.ok(summary.includes('/basvurum/'));
        }

        for (const unknownStatus of ['unexpected_future_status', '__proto__', 'toString', 'constructor', null, 42]) {
            const summary = renderStatusSummary({
                found: true,
                application: { status: unknownStatus },
                documents: [{ code: 'passport', status: 'approved' }]
            }, language);
            assert.equal(summary, CHATBOT_STATUS_FIXED_TEXTS.unknownStatus[language]);
            assert.ok(summary.includes('/basvurum/'));
            if (typeof unknownStatus === 'string') {
                assert.equal(summary.includes(unknownStatus), false);
            }
        }
    }
});

test('renderStatusSummary returns fixed localized not-found and multi-reference texts and never leaks sensitive fields', () => {
    for (const language of CHATBOT_LANGUAGES) {
        assert.equal(
            renderStatusSummary({ found: false, application: null, documents: [] }, language),
            getChatbotStatusFixedText('notFound', language)
        );
        assert.equal(renderStatusSummary(null, language), getChatbotStatusFixedText('notFound', language));
        assert.ok(getChatbotStatusFixedText('multipleReferences', language).length > 10);

        const rejectedWithCanaries = {
            found: true,
            application: {
                status: 'rejected',
                application_type: 'CANARY-TYPE',
                rejection_reason: 'CANARY-REJECTION-REASON',
                first_name: 'CANARY-FIRST-NAME',
                passport_number: 'CANARY-PASSPORT',
                student_number: 'CANARY-STUDENT',
                reference_number: 'ITU-7K9M-4X2P'
            },
            documents: [
                {
                    code: 'passport',
                    status: 'resubmission_required',
                    student_message: 'CANARY-DOC-MESSAGE'
                }
            ]
        };

        const summary = renderStatusSummary(rejectedWithCanaries, language);
        for (const canary of [
            'CANARY-TYPE',
            'CANARY-REJECTION-REASON',
            'CANARY-FIRST-NAME',
            'CANARY-PASSPORT',
            'CANARY-STUDENT',
            'ITU-7K9M-4X2P',
            'CANARY-DOC-MESSAGE'
        ]) {
            assert.equal(summary.includes(canary), false, `${language} summary leaked ${canary}`);
        }
    }
});

test('buildChatbotSystemPrompt instructs the model to ask for ITU-XXXX-XXXX and never guess a status', () => {
    const prompt = buildChatbotSystemPrompt('tr');
    assert.match(prompt, /ITU-XXXX-XXXX/);
    assert.match(prompt, /never guess/i);
});
