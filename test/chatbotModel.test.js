import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/server/domain/errors.js';
import {
    CHATBOT_MODEL_DEFAULT,
    CHATBOT_MODEL_MAX_OUTPUT_TOKENS,
    CHATBOT_MODEL_TIMEOUT_MS,
    STAFF_ASSISTANT_MODEL_DEFAULT,
    createChatModel
} from '../src/server/services/chatbotModel.js';
import { createFakeAiBinding } from './helpers/fakeAiBinding.js';

test('createChatModel returns text reply and passes bounded payload without streaming', async () => {
    const fakeAi = createFakeAiBinding({ response: 'Başvurunuzu ana sayfadan başlatabilirsiniz.' });
    const model = createChatModel({ AI: fakeAi });
    const messages = [{ role: 'user', content: 'Nasıl başvuru yaparım?' }];

    const result = await model.complete({ messages });

    assert.equal(model.provider, 'workers-ai');
    assert.equal(CHATBOT_MODEL_DEFAULT, '@cf/google/gemma-4-26b-a4b-it');
    assert.equal(model.model, CHATBOT_MODEL_DEFAULT);
    assert.deepEqual(result, {
        text: 'Başvurunuzu ana sayfadan başlatabilirsiniz.',
        toolCalls: []
    });
    assert.equal(fakeAi.callCount, 1);
    assert.equal(fakeAi.calls[0].model, CHATBOT_MODEL_DEFAULT);
    assert.strictEqual(fakeAi.calls[0].input.chat_template_kwargs?.enable_thinking, false);
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

test('options.model overrides CHATBOT_MODEL and CHATBOT_MODEL_DEFAULT, and blank options.model falls back', async () => {
    const fakeAi = createFakeAiBinding([{ response: 'Gemma reply' }, { response: 'Qwen reply' }]);
    const envModel = '@cf/qwen/qwen2.5-72b-instruct';

    const overrideModel = createChatModel(
        { AI: fakeAi, CHATBOT_MODEL: envModel },
        { model: `  ${STAFF_ASSISTANT_MODEL_DEFAULT}  ` }
    );
    await overrideModel.complete({ messages: [{ role: 'user', content: 'Hi' }] });

    assert.equal(overrideModel.model, STAFF_ASSISTANT_MODEL_DEFAULT);
    assert.equal(fakeAi.calls[0].model, STAFF_ASSISTANT_MODEL_DEFAULT);
    assert.strictEqual(fakeAi.calls[0].input.chat_template_kwargs?.enable_thinking, false);

    const blankOverrideModel = createChatModel(
        { AI: fakeAi, CHATBOT_MODEL: envModel },
        { model: '   ' }
    );
    await blankOverrideModel.complete({ messages: [{ role: 'user', content: 'Hi' }] });

    assert.equal(blankOverrideModel.model, envModel);
    assert.equal(fakeAi.calls[1].model, envModel);
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

test('12-second default timeout aborts a hanging AI binding call without retries', async (t) => {
    assert.equal(CHATBOT_MODEL_TIMEOUT_MS, 12000);
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

test('createChatModel converts plain, fenced, <|python_tag|>, and array JSON text tool calls and coerces string booleans for is_under_18', async () => {
    const rawToolCall = {
        type: 'function',
        name: 'get_required_documents',
        parameters: {
            application_type: 'transition',
            is_under_18: 'false',
            accommodation_type: 'dormitory',
            fingerprint_status: 'not_registered',
            quotes: {
                application_type: 'geçiş başvurusu',
                is_under_18: '20 yaşındayım',
                accommodation_type: 'yurtta kalıyorum',
                fingerprint_status: 'parmak izim yok'
            }
        }
    };
    const serialized = JSON.stringify(rawToolCall);
    const fakeAi = createFakeAiBinding([
        { response: serialized },
        { response: `\`\`\`json\n${serialized}\n\`\`\`` },
        { response: `<|python_tag|>${serialized}` },
        {
            choices: [{
                message: {
                    content: JSON.stringify([
                        {
                            name: 'get_required_documents',
                            arguments: { application_type: 'initial', is_under_18: 'true' }
                        },
                        {
                            type: 'function',
                            name: 'handoff_to_office',
                            parameters: {}
                        }
                    ])
                }
            }]
        },
        {
            response: JSON.stringify({
                name: 'get_required_documents',
                parameters: { is_under_18: 'maybe' }
            })
        }
    ]);
    const model = createChatModel({ AI: fakeAi });
    const expectedArguments = {
        application_type: 'transition',
        is_under_18: false,
        accommodation_type: 'dormitory',
        fingerprint_status: 'not_registered',
        quotes: {
            application_type: 'geçiş başvurusu',
            is_under_18: '20 yaşındayım',
            accommodation_type: 'yurtta kalıyorum',
            fingerprint_status: 'parmak izim yok'
        }
    };

    for (let index = 0; index < 3; index += 1) {
        const result = await model.complete({
            messages: [{ role: 'user', content: 'Hangi belgeler gerekli?' }]
        });
        assert.equal(result.text, null);
        assert.deepEqual(result.toolCalls, [{
            name: 'get_required_documents',
            arguments: expectedArguments
        }]);
        assert.strictEqual(result.toolCalls[0].arguments.is_under_18, false);
    }

    const arrayResult = await model.complete({
        messages: [{ role: 'user', content: 'Belgeler?' }]
    });
    assert.deepEqual(arrayResult, {
        text: null,
        toolCalls: [
            {
                name: 'get_required_documents',
                arguments: { application_type: 'initial', is_under_18: true }
            },
            {
                name: 'handoff_to_office',
                arguments: {}
            }
        ]
    });
    assert.strictEqual(arrayResult.toolCalls[0].arguments.is_under_18, true);

    const nonBooleanResult = await model.complete({
        messages: [{ role: 'user', content: 'Belgeler?' }]
    });
    assert.deepEqual(nonBooleanResult, {
        text: null,
        toolCalls: [{
            name: 'get_required_documents',
            arguments: { is_under_18: 'maybe' }
        }]
    });
});

test('createChatModel drops unknown tool names from text JSON and preserves non-tool JSON text', async () => {
    const nonToolJson = '{"status":"ok","message":"not a tool call"}';
    const fakeAi = createFakeAiBinding([
        { response: JSON.stringify({ type: 'function', name: 'unknown_tool', parameters: { foo: 'bar' } }) },
        {
            response: JSON.stringify([
                { type: 'function', name: 'unknown_tool', parameters: {} },
                { type: 'function', name: 'lookup_knowledge', parameters: { topic: 'office_hours' } }
            ])
        },
        { response: nonToolJson }
    ]);
    const model = createChatModel({ AI: fakeAi });

    const unknownOnly = await model.complete({ messages: [{ role: 'user', content: 'Merhaba' }] });
    assert.deepEqual(unknownOnly, { text: null, toolCalls: [] });

    const mixed = await model.complete({ messages: [{ role: 'user', content: 'Ofis saatleri?' }] });
    assert.deepEqual(mixed, {
        text: null,
        toolCalls: [{ name: 'lookup_knowledge', arguments: { topic: 'office_hours' } }]
    });

    const plainJson = await model.complete({ messages: [{ role: 'user', content: 'Merhaba' }] });
    assert.deepEqual(plainJson, { text: nonToolJson, toolCalls: [] });
});

test('gemma-4 models disable thinking via chat_template_kwargs and still pass tools', async () => {
    const recorded = [];
    const recorder = async (modelId, input) => {
        recorded.push({ model: modelId, input: structuredClone(input) });
        return { response: 'Merhaba.' };
    };
    const messages = [{ role: 'user', content: 'Merhaba' }];

    const gemmaModel = createChatModel({
        AI: { run: recorder },
        CHATBOT_MODEL: '@cf/google/gemma-4-26b-a4b-it'
    });
    await gemmaModel.complete({ messages });

    assert.equal(recorded[0].model, '@cf/google/gemma-4-26b-a4b-it');
    assert.strictEqual(recorded[0].input.chat_template_kwargs.enable_thinking, false);
    assert.deepEqual(recorded[0].input, {
        chat_template_kwargs: { enable_thinking: false },
        messages,
        max_tokens: 512,
        stream: false
    });

    const tools = [
        {
            name: 'lookup_knowledge',
            description: 'Read curated knowledge.',
            parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] }
        }
    ];
    await gemmaModel.complete({ messages, tools });

    assert.strictEqual(recorded[1].input.chat_template_kwargs.enable_thinking, false);
    assert.deepEqual(recorded[1].input.tools, [
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

test('non-gemma models and non-prefix gemma-4 substrings do not receive chat_template_kwargs', async () => {
    const recorded = [];
    const recorder = async (modelId, input) => {
        recorded.push({ model: modelId, input: structuredClone(input) });
        return { response: 'Merhaba.' };
    };
    const messages = [{ role: 'user', content: 'Merhaba' }];

    for (const env of [
        { AI: { run: recorder }, CHATBOT_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
        { AI: { run: recorder }, CHATBOT_MODEL: '@cf/qwen/qwen2.5-72b-instruct' },
        { AI: { run: recorder }, CHATBOT_MODEL: 'x/@cf/google/gemma-4' }
    ]) {
        const model = createChatModel(env);
        await model.complete({ messages });
    }

    assert.equal(recorded.length, 3);
    for (const call of recorded) {
        assert.equal(Object.hasOwn(call.input, 'chat_template_kwargs'), false);
        assert.deepEqual(call.input, {
            messages,
            max_tokens: 512,
            stream: false
        });
    }
});

test('options.sessionAffinity sends x-session-affinity extraHeaders only for valid ids and preserves signal', async () => {
    const fakeAi = createFakeAiBinding({ response: 'Merhaba.' });
    const messages = [{ role: 'user', content: 'Merhaba' }];

    const validIds = [
        'topi-public-tr',
        'topi-public-en',
        'topi-public-ru',
        'topi-public-tk',
        'topi-public-ar',
        'topi-staff',
        'a',
        'a'.repeat(64)
    ];
    for (const id of validIds) {
        const model = createChatModel({ AI: fakeAi }, { sessionAffinity: id });
        await model.complete({ messages });
        const lastCall = fakeAi.calls[fakeAi.calls.length - 1];
        assert.deepEqual(lastCall.options.extraHeaders, { 'x-session-affinity': id });
        assert.ok(lastCall.options.signal instanceof AbortSignal);
    }

    const invalidOrMissing = [
        undefined,
        null,
        123,
        '',
        '   ',
        'Topi-Public-Tr',
        'topi_public_tr',
        '-leading-dash',
        ' topi-staff ',
        'a'.repeat(65)
    ];
    for (const id of invalidOrMissing) {
        const model = createChatModel({ AI: fakeAi }, id === undefined ? {} : { sessionAffinity: id });
        await model.complete({ messages });
        const lastCall = fakeAi.calls[fakeAi.calls.length - 1];
        assert.equal(Object.hasOwn(lastCall.options, 'extraHeaders'), false);
        assert.ok(lastCall.options.signal instanceof AbortSignal);
    }
});

test('normalizeModelResponse exposes usage with defensive field-name parsing and omits it when absent', async () => {
    const fakeAi = createFakeAiBinding([
        {
            response: 'Merhaba.',
            usage: {
                prompt_tokens: 120,
                completion_tokens: 35,
                prompt_tokens_details: { cached_tokens: 80 }
            }
        },
        {
            response: '',
            tool_calls: [{ name: 'lookup_knowledge', arguments: { topic: 'office_hours' } }],
            usage: {
                input_tokens: 200,
                output_tokens: 40,
                cached_tokens: 50
            }
        },
        {
            response: JSON.stringify({ type: 'function', name: 'handoff_to_office', parameters: {} }),
            usage: {
                input_tokens: 150,
                output_tokens: 25,
                cached_input_tokens: 90
            }
        },
        {
            response: 'Defensive defaults.',
            usage: {
                prompt_tokens: -5,
                completion_tokens: 'invalid',
                prompt_tokens_details: null
            }
        },
        {
            response: 'No usage object.',
            usage: null
        }
    ]);
    const model = createChatModel({ AI: fakeAi });
    const messages = [{ role: 'user', content: 'Merhaba' }];

    const openAiStyle = await model.complete({ messages });
    assert.deepEqual(openAiStyle.usage, { inputTokens: 120, outputTokens: 35, cachedInputTokens: 80 });

    const nativeToolStyle = await model.complete({ messages });
    assert.deepEqual(nativeToolStyle.toolCalls, [{ name: 'lookup_knowledge', arguments: { topic: 'office_hours' } }]);
    assert.deepEqual(nativeToolStyle.usage, { inputTokens: 200, outputTokens: 40, cachedInputTokens: 50 });

    const textToolStyle = await model.complete({ messages });
    assert.deepEqual(textToolStyle.toolCalls, [{ name: 'handoff_to_office', arguments: {} }]);
    assert.deepEqual(textToolStyle.usage, { inputTokens: 150, outputTokens: 25, cachedInputTokens: 90 });

    const defensiveStyle = await model.complete({ messages });
    assert.deepEqual(defensiveStyle.usage, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });

    const nullUsageStyle = await model.complete({ messages });
    assert.equal(Object.hasOwn(nullUsageStyle, 'usage'), false);
    assert.deepEqual(nullUsageStyle, { text: 'No usage object.', toolCalls: [] });
});
