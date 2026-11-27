import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    CHATBOT_LANGUAGES,
    readKnowledge
} from '../src/server/domain/chatbotKnowledge.js';
import {
    buildChatbotSystemPrompt,
    getChatbotFixedText
} from '../src/server/domain/chatbotPrompt.js';
import {
    isInvalidReferenceOrStudentNumberAttempt,
    isStatusQuestionWithoutReference
} from '../src/server/routes/chatbotRoutes.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { createFakeAiBinding } from './helpers/fakeAiBinding.js';

function createEnvironment(aiScript = { response: 'Genel yanıt.' }) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const fakeAi = createFakeAiBinding(aiScript);
    return {
        database,
        fakeAi,
        environment: {
            DB: database,
            AI: fakeAi,
            APP_ENV: 'test'
        }
    };
}

function createChatRequest(body, address = '198.51.130.10') {
    return new Request('https://portal.test/api/public/chat', {
        method: 'POST',
        headers: {
            Origin: 'https://portal.test',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': address
        },
        body: JSON.stringify(body)
    });
}

test('status without valid ITU number deterministically includes forgot_reference steps in TR and EN (and all languages)', async () => {
    const queriesByLanguage = {
        tr: 'Başvurum ne durumda?',
        en: 'What is my application status?',
        ru: 'Статус моей заявки?',
        tk: 'Arzamyň ýagdaýy nähili?',
        ar: 'ما حالة طلبي؟'
    };

    for (const [idx, language] of CHATBOT_LANGUAGES.entries()) {
        const { fakeAi, environment } = createEnvironment(() => {
            throw new Error(`Model must not be called for status-without-number (${language}).`);
        });
        const response = await worker.fetch(
            createChatRequest({
                language,
                messages: [{ role: 'user', content: queriesByLanguage[language] }]
            }, `198.51.131.${10 + idx}`),
            environment,
            {}
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(fakeAi.callCount, 0);
        assert.equal(payload.reply, getChatbotFixedText('statusNeedsReference', language));
        assert.ok(
            payload.reply.includes(readKnowledge('forgot_reference', language).text),
            `${language} statusNeedsReference must include forgot_reference knowledge text`
        );
        assert.ok(payload.reply.includes('ITU-XXXX-XXXX'));
    }

    assert.equal(isStatusQuestionWithoutReference('Başvurum ne oldu?'), true);
    assert.equal(isStatusQuestionWithoutReference('Where is my application?'), true);

    const trLikeEnv = createEnvironment(() => {
        throw new Error('Model must not be called for status-like TR query.');
    });
    const trLikeRes = await worker.fetch(
        createChatRequest({
            language: 'tr',
            messages: [{ role: 'user', content: 'Başvurum ne oldu?' }]
        }, '198.51.131.30'),
        trLikeEnv.environment,
        {}
    );
    const trLikePayload = await trLikeRes.json();
    assert.equal(trLikeRes.status, 200);
    assert.equal(trLikeEnv.fakeAi.callCount, 0);
    assert.ok(trLikePayload.reply.includes(readKnowledge('forgot_reference', 'tr').text));
    assert.ok(trLikePayload.reply.includes('Başvuru Numaramı Unuttum'));

    const enLikeEnv = createEnvironment(() => {
        throw new Error('Model must not be called for status-like EN query.');
    });
    const enLikeRes = await worker.fetch(
        createChatRequest({
            language: 'en',
            messages: [{ role: 'user', content: 'Where is my application?' }]
        }, '198.51.131.31'),
        enLikeEnv.environment,
        {}
    );
    const enLikePayload = await enLikeRes.json();
    assert.equal(enLikeRes.status, 200);
    assert.equal(enLikeEnv.fakeAi.callCount, 0);
    assert.ok(enLikePayload.reply.includes(readKnowledge('forgot_reference', 'en').text));
    assert.ok(enLikePayload.reply.includes('I Forgot My Application Number'));
});

test('invalid application number format or student number gets format example, where-to-find, and forgot_reference steps', async () => {
    assert.equal(isInvalidReferenceOrStudentNumberAttempt('ITU-1234-5678'), true);
    assert.equal(isInvalidReferenceOrStudentNumberAttempt('ITU-ABCD-EFGO'), true);
    assert.equal(isInvalidReferenceOrStudentNumberAttempt('220104567'), true);
    assert.equal(isInvalidReferenceOrStudentNumberAttempt('ITU-7K9M-4X2P'), false);

    // TR: student number instead of ITU reference gets format example, where-to-find, and forgot_reference steps
    const trEnv = createEnvironment(() => {
        throw new Error('Model must not be called for student number attempt.');
    });
    const trRes = await worker.fetch(
        createChatRequest({
            language: 'tr',
            messages: [{ role: 'user', content: 'Öğrenci numaram 220104567' }]
        }, '198.51.132.10'),
        trEnv.environment,
        {}
    );
    const trPayload = await trRes.json();
    assert.equal(trRes.status, 200);
    assert.equal(trEnv.fakeAi.callCount, 0);
    assert.equal(trPayload.reply, getChatbotFixedText('invalidReferenceFormat', 'tr'));
    assert.ok(trPayload.reply.includes('ITU-XXXX-XXXX'));
    assert.ok(trPayload.reply.includes('ITU-7K9M-4X2P'));
    assert.ok(trPayload.reply.includes('onay e-postanızda'));
    assert.ok(trPayload.reply.includes('başvuru belgenizde'));
    assert.ok(trPayload.reply.includes(readKnowledge('forgot_reference', 'tr').text));
    assert.deepEqual(trPayload.actions, []);

    // EN: student number instead of ITU reference
    const enEnv = createEnvironment(() => {
        throw new Error('Model must not be called for student number attempt.');
    });
    const enRes = await worker.fetch(
        createChatRequest({
            language: 'en',
            messages: [{ role: 'user', content: 'My student number is 220104567' }]
        }, '198.51.132.11'),
        enEnv.environment,
        {}
    );
    const enPayload = await enRes.json();
    assert.equal(enRes.status, 200);
    assert.equal(enEnv.fakeAi.callCount, 0);
    assert.equal(enPayload.reply, getChatbotFixedText('invalidReferenceFormat', 'en'));
    assert.ok(enPayload.reply.includes('ITU-XXXX-XXXX'));
    assert.ok(enPayload.reply.includes('ITU-7K9M-4X2P'));
    assert.ok(enPayload.reply.includes('confirmation e-mail'));
    assert.ok(enPayload.reply.includes('application document'));
    assert.ok(enPayload.reply.includes(readKnowledge('forgot_reference', 'en').text));
    assert.deepEqual(enPayload.actions, []);
});

test('third invalid reference or student number attempt in one conversation offers the question form and stops repeating format advice', async () => {
    const firstFormatReply = getChatbotFixedText('invalidReferenceFormat', 'en');
    const { fakeAi, environment } = createEnvironment(() => {
        throw new Error('Model must not be called on 3rd invalid attempt.');
    });

    const response = await worker.fetch(
        createChatRequest({
            language: 'en',
            messages: [
                { role: 'user', content: 'ITU-1234' },
                { role: 'assistant', content: firstFormatReply.slice(0, 500) },
                { role: 'user', content: '220104567' },
                { role: 'assistant', content: firstFormatReply.slice(0, 500) },
                { role: 'user', content: 'ITU-ABCD-EFGO' }
            ]
        }, '198.51.133.10'),
        environment,
        {}
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(fakeAi.callCount, 0);
    assert.equal(payload.reply, getChatbotFixedText('invalidReferenceEscalation', 'en'));
    assert.deepEqual(payload.actions, [{ type: 'inquiry' }]);
    assert.equal(payload.reply.includes('ITU-XXXX-XXXX'), false);
    assert.equal(payload.reply.includes('ITU-7K9M-4X2P'), false);
    assert.equal(payload.reply.includes(readKnowledge('forgot_reference', 'en').text), false);
    assert.match(payload.reply, /question form/i);
});

test('escalation for missing documents, no reply from office, complaint, and reaching the office always includes the question form action', async () => {
    const cases = [
        { language: 'tr', content: 'Eksik belgem var, ne yapmalıyım?' },
        { language: 'en', content: 'My document is missing in the portal.' },
        { language: 'tr', content: 'Ofisten cevap yok, kimse dönüş yapmıyor.' },
        { language: 'en', content: 'There is no reply from the office.' },
        { language: 'tr', content: 'Başvuru süreciyle ilgili şikayetim var.' },
        { language: 'en', content: 'I have a complaint about my application.' },
        { language: 'tr', content: 'Ofise ulaşmak istiyorum.' },
        { language: 'en', content: 'I want to reach the office.' }
    ];

    for (const [idx, item] of cases.entries()) {
        const { fakeAi, environment } = createEnvironment(() => {
            throw new Error(`Model must not be called for deterministic escalation: ${item.content}`);
        });
        const response = await worker.fetch(
            createChatRequest({
                language: item.language,
                messages: [{ role: 'user', content: item.content }]
            }, `198.51.134.${10 + idx}`),
            environment,
            {}
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(fakeAi.callCount, 0);
        assert.deepEqual(payload.actions, [{ type: 'inquiry' }]);
        if (item.language === 'tr') {
            assert.match(payload.reply, /soru form/i);
        } else {
            assert.match(payload.reply, /question form/i);
        }
    }
});

test('bare transfer offer from model without handoff_to_office is converted to handoff reply with inquiry form action', async () => {
    const enEnv = createEnvironment({
        response: 'Would you like me to transfer you to the office?'
    });
    const enRes = await worker.fetch(
        createChatRequest({
            language: 'en',
            messages: [{ role: 'user', content: 'My situation is complicated.' }]
        }, '198.51.135.10'),
        enEnv.environment,
        {}
    );
    const enPayload = await enRes.json();

    assert.equal(enRes.status, 200);
    assert.deepEqual(enPayload.actions, [{ type: 'inquiry' }]);
    assert.match(enPayload.reply, /question form/i);
    assert.equal(enPayload.reply.includes('Would you like me to transfer'), false);

    const prompt = buildChatbotSystemPrompt('en');
    assert.match(prompt, /Never end with a bare question/i);
});
