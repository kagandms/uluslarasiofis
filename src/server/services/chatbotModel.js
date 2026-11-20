import { ApiError } from '../domain/errors.js';

// @cf/meta/llama-3.3-70b-instruct-fp8-fast: checked 2026-11-19, unverified against the live Cloudflare catalog.
export const CHATBOT_MODEL_DEFAULT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CHATBOT_MODEL_TIMEOUT_MS = 12_000;
export const CHATBOT_MODEL_MAX_OUTPUT_TOKENS = 512;

const GENERIC_UNAVAILABLE_MESSAGE = 'Asistan şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function createUnavailableError() {
    return new ApiError(503, 'CHATBOT_UNAVAILABLE', GENERIC_UNAVAILABLE_MESSAGE, true);
}

function formatTools(tools) {
    if (!Array.isArray(tools) || tools.length === 0) return [];
    return tools.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }
    }));
}

function normalizeMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj listesi geçersiz.');
    }
    return messages.map((message) => {
        if (!isPlainObject(message) || typeof message.role !== 'string') {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj biçimi geçersiz.');
        }
        const normalized = {
            role: message.role,
            content: typeof message.content === 'string' ? message.content : (message.content ?? '')
        };
        if (typeof message.name === 'string') normalized.name = message.name;
        if (Array.isArray(message.tool_calls)) normalized.tool_calls = message.tool_calls;
        if (typeof message.tool_call_id === 'string') normalized.tool_call_id = message.tool_call_id;
        return normalized;
    });
}

function parseToolArguments(rawArguments) {
    if (rawArguments === undefined || rawArguments === null || rawArguments === '') return {};
    if (typeof rawArguments === 'string') {
        const parsed = JSON.parse(rawArguments);
        if (!isPlainObject(parsed)) throw new Error('Tool arguments must be a JSON object.');
        return parsed;
    }
    if (isPlainObject(rawArguments)) return { ...rawArguments };
    throw new Error('Unsupported tool arguments value.');
}

function normalizeToolCall(rawCall) {
    const name = typeof rawCall?.name === 'string' && rawCall.name.trim()
        ? rawCall.name.trim()
        : (typeof rawCall?.function?.name === 'string' && rawCall.function.name.trim()
            ? rawCall.function.name.trim() : null);
    if (!name) throw new Error('Tool call is missing a valid function name.');
    const rawArguments = Object.hasOwn(rawCall || {}, 'arguments')
        ? rawCall.arguments
        : rawCall?.function?.arguments;
    return {
        name,
        arguments: parseToolArguments(rawArguments)
    };
}

function normalizeModelResponse(raw) {
    if (!isPlainObject(raw)) throw new Error('Model response must be an object.');
    const choiceMessage = raw.choices?.[0]?.message;
    const rawText = raw.response ?? choiceMessage?.content ?? null;
    const text = typeof rawText === 'string' && rawText.trim().length > 0 ? rawText : null;
    const rawToolCalls = Array.isArray(raw.tool_calls)
        ? raw.tool_calls
        : (Array.isArray(choiceMessage?.tool_calls) ? choiceMessage.tool_calls : []);
    return {
        text,
        toolCalls: rawToolCalls.map(normalizeToolCall)
    };
}

/**
 * Creates a swappable model adapter backed by the Cloudflare Workers AI binding.
 * @param {object} environment Worker bindings containing `AI` and optional `CHATBOT_MODEL`.
 * @param {{timeoutMs?: number, maxOutputTokens?: number}} [options] Adapter bounds.
 * @returns {{provider: string, model: string, complete: (input: {messages: Array<object>, tools?: Array<object>, signal?: AbortSignal}) => Promise<{text: string|null, toolCalls: Array<{name: string, arguments: object}>}>}} Model adapter.
 */
export function createChatModel(environment, options = {}) {
    const configuredModel = typeof environment?.CHATBOT_MODEL === 'string'
        ? environment.CHATBOT_MODEL.trim() : '';
    const model = configuredModel || CHATBOT_MODEL_DEFAULT;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs : CHATBOT_MODEL_TIMEOUT_MS;
    const maxOutputTokens = Number.isSafeInteger(options.maxOutputTokens) && options.maxOutputTokens > 0
        ? options.maxOutputTokens : CHATBOT_MODEL_MAX_OUTPUT_TOKENS;

    return Object.freeze({
        provider: 'workers-ai',
        model,
        async complete({ messages, tools = [], signal } = {}) {
            const normalizedMessages = normalizeMessages(messages);
            if (!environment?.AI || typeof environment.AI.run !== 'function') {
                throw createUnavailableError();
            }
            if (signal?.aborted) {
                throw createUnavailableError();
            }

            const formattedTools = formatTools(tools);
            const payload = {
                messages: normalizedMessages,
                max_tokens: maxOutputTokens,
                stream: false,
                ...(formattedTools.length > 0 ? { tools: formattedTools } : {})
            };

            const controller = new AbortController();
            let onExternalAbort = null;
            if (signal) {
                onExternalAbort = () => controller.abort(signal.reason || new DOMException('Aborted', 'AbortError'));
                signal.addEventListener('abort', onExternalAbort, { once: true });
            }

            const timer = setTimeout(() => {
                controller.abort(new DOMException('Chatbot model request timed out.', 'TimeoutError'));
            }, timeoutMs);

            let abortListener = null;
            const abortPromise = new Promise((_, reject) => {
                abortListener = () => reject(controller.signal.reason || new DOMException('Aborted', 'AbortError'));
                controller.signal.addEventListener('abort', abortListener, { once: true });
            });

            try {
                const rawResponse = await Promise.race([
                    environment.AI.run(model, payload, { signal: controller.signal }),
                    abortPromise
                ]);
                return normalizeModelResponse(rawResponse);
            } catch {
                // Binding errors, timeouts, and malformed provider responses are mapped without retries or content logging.
                throw createUnavailableError();
            } finally {
                clearTimeout(timer);
                if (abortListener) controller.signal.removeEventListener('abort', abortListener);
                if (signal && onExternalAbort) signal.removeEventListener('abort', onExternalAbort);
            }
        }
    });
}
