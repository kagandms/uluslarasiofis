import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/server/domain/errors.js';
import {
    CHATBOT_MODEL_DEFAULT,
    CHATBOT_MODEL_MAX_OUTPUT_TOKENS,
    CHATBOT_MODEL_TIMEOUT_MS,
    createChatModel
} from '../src/server/services/chatbotModel.js';
import { createFakeAiBinding } from './helpers/fakeAiBinding.js';

test('createChatModel returns text reply and passes bounded payload without streaming', async () => {
    const fakeAi = createFakeAiBinding({ response: 'Başvurunuzu ana sayfadan başlatabilirsiniz.' });
    const model = createChatModel({ AI: fakeAi });
    const messages = [{ role: 'user', content: 'Nasıl başvuru yaparım?' }];

    const result = await model.complete({ messages });

    assert.equal(model.provider, 'workers-ai');
    assert.equal(model.model, CHATBOT_MODEL_DEFAULT);
    assert.deepEqual(result, {
        text: 'Başvurunuzu ana sayfadan başlatabilirsiniz.',
        toolCalls: []
    });
    assert.equal(fakeAi.callCount, 1);
    assert.equal(fakeAi.calls[0].model, CHATBOT_MODEL_DEFAULT);
    assert.equal(fakeAi.calls[0].input.stream, false);
    assert.equal(fakeAi.calls[0].input.max_tokens, CHATBOT_MODEL_MAX_OUTPUT_TOKENS);
    assert.deepEqual(fakeAi.calls[0].input.messages, messages);
    assert.equal(Object.hasOwn(fakeAi.calls[0].input, 'tools'), false);
});

test('CHATBOT_MODEL environment variable overrides CHATBOT_MODEL_DEFAULT', async () => {
    const fakeAi = createFakeAiBinding({ response: 'Hello!' });
    const customModel = '@cf/qwen/qwen2.5-72b-instruct';
    const model = createChatModel({ AI: fakeAi, CHATBOT_MODEL: `  ${customModel}  ` });

    await model.complete({ messages: [{ role: 'user', content: 'Hi' }] });

    assert.equal(model.model, customModel);
    assert.equal(fakeAi.calls[0].model, customModel);
});

test('createChatModel parses tool_calls with object and JSON-string arguments and strips tool executors', async () => {
    const fakeAi = createFakeAiBinding([
        {
            response: '',
            tool_calls: [
                { name: 'lookup_knowledge', arguments: { topic: 'office_hours' } }
            ]
        },
        {
            choices: [
                {
                    message: {
                        content: null,
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'get_required_documents',
                                    arguments: '{"application_type":"initial","is_under_18":false}'
                                }
                            }
                        ]
                    }
                }
            ]
        }
    ]);
    const model = createChatModel({ AI: fakeAi });
    const tools = [
        {
            name: 'lookup_knowledge',
            description: 'Read curated knowledge.',
            parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
            execute() {
                throw new Error('Executor must not be serialized or invoked by model adapter.');
            }
        }
    ];

    const first = await model.complete({
        messages: [{ role: 'user', content: 'Ofis saatleri nedir?' }],
        tools
    });
    const second = await model.complete({
        messages: [{ role: 'user', content: 'Hangi belgeler gerekli?' }],
        tools
    });

    assert.deepEqual(first, {
        text: null,
        toolCalls: [{ name: 'lookup_knowledge', arguments: { topic: 'office_hours' } }]
    });
    assert.deepEqual(second, {
        text: null,
        toolCalls: [{
            name: 'get_required_documents',
            arguments: { application_type: 'initial', is_under_18: false }
        }]
    });
    assert.deepEqual(fakeAi.calls[0].input.tools, [
        {
            type: 'function',
            function: {
                name: 'lookup_knowledge',
                description: 'Read curated knowledge.',
                parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] }
            }
        }
    ]);
});

test('thrown AI binding error becomes retryable 503 CHATBOT_UNAVAILABLE without retries or message leakage', async () => {
    const userSecret = 'SENSITIVE_PASSPORT_12345';
    const fakeAi = createFakeAiBinding(new Error(`Upstream failed for ${userSecret}`));
    const model = createChatModel({ AI: fakeAi });

    await assert.rejects(
        () => model.complete({ messages: [{ role: 'user', content: userSecret }] }),
        (error) => error instanceof ApiError
            && error.status === 503
            && error.code === 'CHATBOT_UNAVAILABLE'
            && error.retryable === true
            && !error.message.includes(userSecret)
    );
    assert.equal(fakeAi.callCount, 1);
});

test('missing AI binding or malformed model response throws 503 CHATBOT_UNAVAILABLE', async () => {
    const missingBindingModel = createChatModel({});
    await assert.rejects(
        () => missingBindingModel.complete({ messages: [{ role: 'user', content: 'Merhaba' }] }),
        (error) => error instanceof ApiError
            && error.status === 503
            && error.code === 'CHATBOT_UNAVAILABLE'
            && error.retryable === true
    );

    const malformedModel = createChatModel({
        AI: createFakeAiBinding({
            response: '',
            tool_calls: [{ name: 'lookup_knowledge', arguments: '{not-valid-json' }]
        })
    });
    await assert.rejects(
        () => malformedModel.complete({ messages: [{ role: 'user', content: 'Merhaba' }] }),
        (error) => error instanceof ApiError
            && error.status === 503
            && error.code === 'CHATBOT_UNAVAILABLE'
            && error.retryable === true
    );
});

test('8-second default timeout aborts a hanging AI binding call without retries', async (t) => {
    assert.equal(CHATBOT_MODEL_TIMEOUT_MS, 8000);
    t.mock.timers.enable({ apis: ['setTimeout'] });

    let observedSignal = null;
    const fakeAi = createFakeAiBinding((_model, _input, options) => {
        observedSignal = options.signal;
        return new Promise(() => {});
    });
    const model = createChatModel({ AI: fakeAi });

    const pending = model.complete({ messages: [{ role: 'user', content: 'Merhaba' }] });
    assert.ok(observedSignal instanceof AbortSignal);

    t.mock.timers.tick(CHATBOT_MODEL_TIMEOUT_MS - 1);
    assert.equal(observedSignal.aborted, false);

    t.mock.timers.tick(1);
    assert.equal(observedSignal.aborted, true);

    await assert.rejects(
        pending,
        (error) => error instanceof ApiError
            && error.status === 503
            && error.code === 'CHATBOT_UNAVAILABLE'
            && error.retryable === true
    );
    assert.equal(fakeAi.callCount, 1);
});

test('pre-aborted caller signal fails immediately without calling AI binding', async () => {
    const fakeAi = createFakeAiBinding({ response: 'Should not be called' });
    const model = createChatModel({ AI: fakeAi });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
        () => model.complete({
            messages: [{ role: 'user', content: 'Merhaba' }],
            signal: controller.signal
        }),
        (error) => error instanceof ApiError
            && error.status === 503
            && error.code === 'CHATBOT_UNAVAILABLE'
            && error.retryable === true
    );
    assert.equal(fakeAi.callCount, 0);
});
