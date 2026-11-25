import { CHATBOT_TOOLS } from '../domain/chatbotTools.js';
import { ApiError } from '../domain/errors.js';

// @cf/google/gemma-4-26b-a4b-it: checked 2026-11-25 against the live Cloudflare catalog (wrangler ai models list).
// Local eval (2026-11-25, real Workers AI binding, thinking OFF): 609-case packs 98.2/97.6/97.2/100% (0 safety/doc errors)
// and 340-case adversarial 84.7% vs Llama 73.2%; 0 fallbacks, p95 ~3 s (Llama 18, p95 ~12 s), $0.10/$0.30 vs $0.293/$2.253 per 1M.
// Thinking is switched off for this model family through MODEL_PAYLOAD_EXTRAS below.
export const CHATBOT_MODEL_DEFAULT = '@cf/google/gemma-4-26b-a4b-it';
// Staff assistant stays on Llama until it has its own evaluation pack (tool calling on Gemma is untested there).
export const STAFF_ASSISTANT_MODEL_DEFAULT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CHATBOT_MODEL_TIMEOUT_MS = 12_000;
export const CHATBOT_MODEL_MAX_OUTPUT_TOKENS = 512;

const GENERIC_UNAVAILABLE_MESSAGE = 'Asistan şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.';
const REGISTERED_TOOL_NAMES = Object.freeze(new Set(Object.keys(CHATBOT_TOOLS)));
const PYTHON_TAG_PREFIX = '<|python_tag|>';

// Thinking/reasoning models burn the output token budget and 12 s timeout on
// internal reasoning by default; this table disables thinking per model-id prefix.
// To add a model family, verify the parameter is supported via
// `wrangler ai models schema <id>` before adding its prefix entry here.
const MODEL_PAYLOAD_EXTRAS = Object.freeze({
    '@cf/google/gemma-4': Object.freeze({
        chat_template_kwargs: Object.freeze({ enable_thinking: false })
    })
});

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

function buildRegisteredToolNameSet(tools) {
    if (!Array.isArray(tools) || tools.length === 0) return REGISTERED_TOOL_NAMES;
    const names = new Set(REGISTERED_TOOL_NAMES);
    for (const tool of tools) {
        if (typeof tool?.name === 'string' && tool.name.trim()) {
            names.add(tool.name.trim());
        }
    }
    return names;
}

function coerceToolCallArguments(args) {
    if (!isPlainObject(args)) return args;
    if (!Object.hasOwn(args, 'is_under_18') || typeof args.is_under_18 !== 'string') {
        return args;
    }
    const normalized = args.is_under_18.trim().toLowerCase();
    if (normalized === 'true') {
        return { ...args, is_under_18: true };
    }
    if (normalized === 'false') {
        return { ...args, is_under_18: false };
    }
    return args;
}

function extractRawToolArguments(rawCall) {
    if (Object.hasOwn(rawCall || {}, 'arguments')) return rawCall.arguments;
    if (Object.hasOwn(rawCall || {}, 'parameters')) return rawCall.parameters;
    if (Object.hasOwn(rawCall?.function || {}, 'arguments')) return rawCall.function.arguments;
    if (Object.hasOwn(rawCall?.function || {}, 'parameters')) return rawCall.function.parameters;
    return undefined;
}

function normalizeToolCall(rawCall) {
    const name = typeof rawCall?.name === 'string' && rawCall.name.trim()
        ? rawCall.name.trim()
        : (typeof rawCall?.function?.name === 'string' && rawCall.function.name.trim()
            ? rawCall.function.name.trim() : null);
    if (!name) throw new Error('Tool call is missing a valid function name.');
    const rawArguments = extractRawToolArguments(rawCall);
    return {
        name,
        arguments: coerceToolCallArguments(parseToolArguments(rawArguments))
    };
}

function stripTextToolCallWrappers(text) {
    let candidate = text.trim();
    if (candidate.startsWith(PYTHON_TAG_PREFIX)) {
        candidate = candidate.slice(PYTHON_TAG_PREFIX.length).trim();
    }
    const fenceMatch = candidate.match(/^```(?:[a-zA-Z0-9_-]+(?=\s))?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) {
        candidate = fenceMatch[1].trim();
        if (candidate.startsWith(PYTHON_TAG_PREFIX)) {
            candidate = candidate.slice(PYTHON_TAG_PREFIX.length).trim();
        }
    }
    return candidate;
}

function isTextToolCallShape(item) {
    if (!isPlainObject(item)) return false;
    if (typeof item.name !== 'string' || !item.name.trim()) return false;
    const hasToolType = item.type === 'function';
    if (Object.hasOwn(item, 'type') && item.type !== undefined && !hasToolType) {
        return false;
    }
    return Object.hasOwn(item, 'parameters') || Object.hasOwn(item, 'arguments') || hasToolType;
}

function tryParseTextToolCalls(text, registeredToolNames) {
    const candidate = stripTextToolCallWrappers(text);
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(candidate);
    } catch {
        return null;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (items.length === 0 || !items.every(isTextToolCallShape)) {
        return null;
    }
    const toolCalls = [];
    for (const item of items) {
        const name = item.name.trim();
        if (!registeredToolNames.has(name)) {
            continue;
        }
        try {
            toolCalls.push(normalizeToolCall(item));
        } catch {
            // Drop malformed text tool arguments while still clearing the raw JSON text.
        }
    }
    return {
        text: null,
        toolCalls
    };
}

function normalizeModelResponse(raw, registeredToolNames = REGISTERED_TOOL_NAMES) {
    if (!isPlainObject(raw)) throw new Error('Model response must be an object.');
    const choiceMessage = raw.choices?.[0]?.message;
    const rawText = raw.response ?? choiceMessage?.content ?? null;
    const text = typeof rawText === 'string' && rawText.trim().length > 0 ? rawText : null;
    const rawToolCalls = Array.isArray(raw.tool_calls)
        ? raw.tool_calls
        : (Array.isArray(choiceMessage?.tool_calls) ? choiceMessage.tool_calls : []);
    if (rawToolCalls.length > 0) {
        return {
            text,
            toolCalls: rawToolCalls.map(normalizeToolCall)
        };
    }
    if (text !== null) {
        const parsedFromText = tryParseTextToolCalls(text, registeredToolNames);
        if (parsedFromText) {
            return parsedFromText;
        }
    }
    return {
        text,
        toolCalls: []
    };
}

/**
 * Creates a swappable model adapter backed by the Cloudflare Workers AI binding.
 * @param {object} environment Worker bindings containing `AI` and optional `CHATBOT_MODEL`.
 * @param {{timeoutMs?: number, maxOutputTokens?: number, model?: string}} [options] Adapter bounds and optional model override.
 * @returns {{provider: string, model: string, complete: (input: {messages: Array<object>, tools?: Array<object>, signal?: AbortSignal}) => Promise<{text: string|null, toolCalls: Array<{name: string, arguments: object}>}>}} Model adapter.
 */
export function createChatModel(environment, options = {}) {
    const optionModel = typeof options?.model === 'string'
        ? options.model.trim() : '';
    const configuredModel = typeof environment?.CHATBOT_MODEL === 'string'
        ? environment.CHATBOT_MODEL.trim() : '';
    const model = optionModel || configuredModel || CHATBOT_MODEL_DEFAULT;
    const modelPayloadExtras = Object.entries(MODEL_PAYLOAD_EXTRAS)
        .find(([prefix]) => model.startsWith(prefix))?.[1] ?? null;
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

            const registeredToolNames = buildRegisteredToolNameSet(tools);
            const formattedTools = formatTools(tools);
            const payload = {
                ...(modelPayloadExtras ?? {}),
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
                return normalizeModelResponse(rawResponse, registeredToolNames);
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
