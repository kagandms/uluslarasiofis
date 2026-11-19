import { isValidApplicationReference, normalizeApplicationReference } from '../auth/applicationAccessCode.js';
import { CHATBOT_LANGUAGES } from '../domain/chatbotKnowledge.js';
import {
    CHATBOT_REFUSAL_MARKER,
    buildChatbotSystemPrompt,
    getChatbotFixedText
} from '../domain/chatbotPrompt.js';
import { getChatbotStatusFixedText, renderStatusSummary } from '../domain/chatbotStatusText.js';
import {
    CHATBOT_TOOL_DEFINITIONS,
    CHATBOT_TOOLS,
    executeChatbotTool
} from '../domain/chatbotTools.js';
import { ApiError } from '../domain/errors.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import {
    APPLICATION_TRACKING_RATE_LIMIT,
    CHATBOT_GLOBAL_DAILY_LIMIT,
    CHATBOT_IP_DAILY_LIMIT,
    CHATBOT_RATE_LIMIT
} from '../security/application-rate-limits.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import { createChatModel } from '../services/chatbotModel.js';
import { readPublicTrackingByReference } from './applicationTrackingRoutes.js';
import { createRepositories, enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';

const CHATBOT_BODY_MAX_BYTES = 8192;
const CHATBOT_MAX_MESSAGES = 10;
const CHATBOT_MESSAGE_MAX_LENGTH = 500;
const CHATBOT_MAX_MODEL_CALLS = 3;
const CHATBOT_MAX_REPLY_CHARS = 1200;

const CHATBOT_ALLOWED_ROLES = Object.freeze(['user', 'assistant']);
const CHATBOT_ROOT_KEYS = Object.freeze(['messages', 'language']);
const CHATBOT_MESSAGE_KEYS = Object.freeze(['role', 'content']);

// Çok satırlı mesajlarda yalnızca \n satır sonuna izin verilir; diğer kontrol karakterleri reddedilir.
const MESSAGE_DISALLOWED_CONTROL_CHAR_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const REFERENCE_CANDIDATE_PATTERN = /[\p{L}\p{N}_-]+/gu;
const CHATBOT_UNAVAILABLE_MESSAGE = 'Asistan şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.';

const OPTIONAL_DOCUMENT_SUFFIX = Object.freeze({
    tr: ' (isteğe bağlı)',
    en: ' (optional)',
    ru: ' (необязательно)',
    tk: ' (hökmany däl)',
    ar: ' (اختياري)'
});

const STATUS_KEYWORDS_BY_LANGUAGE = Object.freeze({
    tr: Object.freeze(['durum', 'başvurum', 'göç', 'göç idaresi', 'gönderildi', 'onaylandı', 'sonuç', 'sonucu']),
    en: Object.freeze(['status', 'my application', 'migration', 'sent', 'approved', 'result']),
    ru: Object.freeze(['статус', 'моя заявка', 'миграц', 'отправ', 'одобр']),
    tk: Object.freeze(['ýagdaý', 'arzam', 'migrasiýa', 'iberildi']),
    ar: Object.freeze(['حالة', 'طلبي', 'الهجرة', 'أرسل', 'أُرسل', 'ارسل', 'موافقة'])
});

const DOCUMENT_KEYWORDS_BY_LANGUAGE = Object.freeze({
    tr: Object.freeze(['belge', 'evrak']),
    en: Object.freeze(['document']),
    ru: Object.freeze(['документ']),
    tk: Object.freeze(['resminama']),
    ar: Object.freeze(['مستند'])
});

const STATUS_KEYWORDS = Object.freeze(Object.values(STATUS_KEYWORDS_BY_LANGUAGE).flat());
const DOCUMENT_KEYWORDS = Object.freeze(Object.values(DOCUMENT_KEYWORDS_BY_LANGUAGE).flat());
const SENT_WORD_PATTERN = /(?:^|[^\p{L}\p{N}])sent(?:[^\p{L}\p{N}]|$)/u;

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireOnlyKeys(value, allowedKeys) {
    if (!isPlainObject(value) || Object.keys(value).some((key) => !allowedKeys.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sohbet isteğini kontrol edip tekrar deneyin.');
    }
}

function validateChatMessage(rawMessage) {
    requireOnlyKeys(rawMessage, CHATBOT_MESSAGE_KEYS);
    if (typeof rawMessage.role !== 'string' || !CHATBOT_ALLOWED_ROLES.includes(rawMessage.role)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj rolü geçersiz.');
    }
    if (typeof rawMessage.content !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj içeriği geçersiz.');
    }
    const normalized = rawMessage.content.replace(/\r\n/g, '\n');
    if (MESSAGE_DISALLOWED_CONTROL_CHAR_PATTERN.test(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesajda geçersiz kontrol karakteri bulunamaz.');
    }
    const trimmed = normalized.trim();
    const charLength = [...trimmed].length;
    if (charLength < 1 || charLength > CHATBOT_MESSAGE_MAX_LENGTH) {
        throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `Mesaj 1 ile ${CHATBOT_MESSAGE_MAX_LENGTH} karakter arasında olmalıdır.`
        );
    }
    return {
        role: rawMessage.role,
        content: trimmed
    };
}

function validateChatInput(body) {
    requireOnlyKeys(body, CHATBOT_ROOT_KEYS);
    if (typeof body.language !== 'string' || !CHATBOT_LANGUAGES.includes(body.language)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dil seçimini kontrol edip tekrar deneyin.');
    }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > CHATBOT_MAX_MESSAGES) {
        throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `Mesaj listesi 1 ile ${CHATBOT_MAX_MESSAGES} öğe arasında olmalıdır.`
        );
    }
    const validatedMessages = body.messages.map(validateChatMessage);
    if (validatedMessages[validatedMessages.length - 1].role !== 'user') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Son mesaj kullanıcıya ait olmalıdır.');
    }
    return {
        messages: validatedMessages,
        language: body.language
    };
}

async function runFailClosedRateLimit(action) {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ApiError && error.status === 429) throw error;
        throw new ApiError(503, 'CHATBOT_UNAVAILABLE', CHATBOT_UNAVAILABLE_MESSAGE, true);
    }
}

async function consumeDailyBudgetSlot(repositories, policy, identity, nowSeconds) {
    return runFailClosedRateLimit(() => consumePublicRateLimit(repositories.rateLimits, {
        endpoint: policy.endpoint,
        identity,
        nowSeconds,
        windowSeconds: policy.windowSeconds,
        maxRequests: policy.maxRequests
    }));
}

function renderDeterministicDocumentList(labels, language) {
    const optionalSuffix = OPTIONAL_DOCUMENT_SUFFIX[language] || OPTIONAL_DOCUMENT_SUFFIX.tr;
    return labels
        .map((item) => `- ${item.title}${item.required === false ? optionalSuffix : ''}`)
        .join('\n');
}

function buildDocumentReply(labels, language) {
    const intro = getChatbotFixedText('documentListIntro', language);
    const renderedList = renderDeterministicDocumentList(labels, language);
    const closing = getChatbotFixedText('documentListClosing', language);
    return `${intro}\n\n${renderedList}\n\n${closing}`;
}

function extractApplicationReferences(messageContent) {
    if (typeof messageContent !== 'string') return [];
    const matches = messageContent.match(REFERENCE_CANDIDATE_PATTERN);
    if (!matches) return [];
    const validReferences = [];
    const seen = new Set();
    for (const token of matches) {
        const candidate = token.replace(/^[_-]+|[_-]+$/g, '');
        if (!candidate) continue;
        const normalized = normalizeApplicationReference(candidate);
        if (!isValidApplicationReference(normalized) || seen.has(normalized)) continue;
        seen.add(normalized);
        validReferences.push(normalized);
    }
    return validReferences;
}

function normalizeMessageForKeywordMatch(messageContent) {
    return [
        messageContent.toLowerCase().replace(/\u0307/g, ''),
        messageContent.toLocaleLowerCase('tr-TR')
    ];
}

function matchesKeyword(normalizedVariants, keyword) {
    if (keyword === 'sent') {
        return normalizedVariants.some((text) => SENT_WORD_PATTERN.test(text));
    }
    return normalizedVariants.some((text) => text.includes(keyword));
}

function isStatusQuestionWithoutReference(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalizedVariants = normalizeMessageForKeywordMatch(messageContent);
    if (DOCUMENT_KEYWORDS.some((keyword) => matchesKeyword(normalizedVariants, keyword))) {
        return false;
    }
    return STATUS_KEYWORDS.some((keyword) => matchesKeyword(normalizedVariants, keyword));
}

function outcomeForError(error) {
    if (!(error instanceof ApiError)) return 'error';
    if (error.status === 405) return 'method_not_allowed';
    if (error.status === 403) return 'forbidden';
    if (error.status === 413) return 'payload_too_large';
    if (error.status === 400) return 'validation_error';
    if (error.status === 429) return 'rate_limited';
    if (error.status === 503) return 'unavailable';
    return 'error';
}

/**
 * Durumsuz ana sayfa sohbet uç noktası (`POST /api/public/chat`).
 * Kontrol sırası: yöntem -> aynı köken -> 8 KB boyut sınırı -> hız sınırları -> doğrulama -> başvuru numarasıyla durum sorgusu -> günlük bütçe -> model/araç döngüsü.
 * Kişisel veri, başvuru numarası, durum içeriği, mesaj içeriği, araç argümanları ve model çıktısı hiçbir zaman günlüğe yazılmaz veya saklanmaz.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları (`DB`, `AI`, isteğe bağlı `CHATBOT_MODEL`).
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<object>} `{ reply, actions }` gövdeli rota sonucu.
 * @throws {ApiError} Yöntem, köken, boyut, hız sınırı, doğrulama veya hizmet hatasında uygun HTTP hatası fırlatır.
 */
export async function handlePublicChat(request, environment, requestId) {
    const startedAt = Date.now();
    const executedToolNames = [];
    let outcome = 'error';

    try {
        requireMethod(request, 'POST');
        requireSameOrigin(request);
        const body = await readJsonBody(request, CHATBOT_BODY_MAX_BYTES);

        const repositories = await runFailClosedRateLimit(() => createRepositories(environment));
        await runFailClosedRateLimit(() => enforceRateLimit(repositories, request, CHATBOT_RATE_LIMIT));

        const validated = validateChatInput(body);
        const lastUserMessage = validated.messages[validated.messages.length - 1].content;
        const referencedApplications = extractApplicationReferences(lastUserMessage);
        if (referencedApplications.length > 1) {
            outcome = 'status_multiple_references';
            return routeResult({
                reply: getChatbotStatusFixedText('multipleReferences', validated.language),
                actions: []
            });
        }
        if (referencedApplications.length === 1) {
            // Başvuru durumu sorguları modeli ve günlük bütçeyi kullanmaz; herkese açık takip sayacıyla sınırlanır.
            await runFailClosedRateLimit(() => enforceRateLimit(repositories, request, APPLICATION_TRACKING_RATE_LIMIT));
            const trackingResult = await readPublicTrackingByReference(repositories, referencedApplications[0]);
            outcome = 'status_lookup';
            return routeResult({
                reply: renderStatusSummary(trackingResult, validated.language),
                actions: trackingResult.found
                    ? [{ type: 'link', href: '/basvurum/', label_key: 'chatbotOpenTracking' }]
                    : [{ type: 'inquiry' }]
            });
        }
        if (isStatusQuestionWithoutReference(lastUserMessage)) {
            outcome = 'status_needs_reference';
            return routeResult({
                reply: getChatbotFixedText('statusNeedsReference', validated.language),
                actions: []
            });
        }

        const clientAddress = request.headers.get('CF-Connecting-IP') || 'unknown-client';
        const nowSeconds = Math.floor(Date.now() / 1000);

        const withinIpDailyBudget = await consumeDailyBudgetSlot(
            repositories,
            CHATBOT_IP_DAILY_LIMIT,
            clientAddress,
            nowSeconds
        );
        if (!withinIpDailyBudget) {
            outcome = 'daily_ip_limit';
            return routeResult({
                reply: getChatbotFixedText('dailyLimit', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        const withinGlobalDailyBudget = await consumeDailyBudgetSlot(
            repositories,
            CHATBOT_GLOBAL_DAILY_LIMIT,
            CHATBOT_GLOBAL_DAILY_LIMIT.identity,
            nowSeconds
        );
        if (!withinGlobalDailyBudget) {
            outcome = 'daily_global_limit';
            return routeResult({
                reply: getChatbotFixedText('dailyLimit', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        const model = createChatModel(environment);
        const conversation = [
            { role: 'system', content: buildChatbotSystemPrompt(validated.language) },
            ...validated.messages
        ];

        let finalText = null;
        let exhaustedModelCalls = false;
        let handoffRequested = false;
        let lastDocumentLabels = null;
        let lastKnowledgeText = null;

        for (let modelCall = 1; modelCall <= CHATBOT_MAX_MODEL_CALLS; modelCall += 1) {
            // 3. çağrı son izin verilen çağrıdır; aracısız gönderilir ki model metin yanıtı üretmeye zorlansın.
            const allowTools = modelCall < CHATBOT_MAX_MODEL_CALLS;
            const result = await model.complete({
                messages: conversation,
                ...(allowTools ? { tools: CHATBOT_TOOL_DEFINITIONS } : {})
            });

            if (!result.toolCalls || result.toolCalls.length === 0) {
                finalText = result.text;
                break;
            }

            if (!allowTools) {
                exhaustedModelCalls = true;
                break;
            }

            const assistantToolCalls = [];
            const toolResultMessages = [];

            for (let index = 0; index < result.toolCalls.length; index += 1) {
                const call = result.toolCalls[index];
                const callId = `call_${modelCall}_${index + 1}`;
                const isKnownTool = typeof call.name === 'string' && Object.hasOwn(CHATBOT_TOOLS, call.name);
                const safeToolName = isKnownTool ? call.name : 'unknown_tool';
                executedToolNames.push(safeToolName);

                assistantToolCalls.push({
                    id: callId,
                    type: 'function',
                    function: {
                        name: safeToolName,
                        arguments: JSON.stringify(call.arguments ?? {})
                    }
                });

                let toolPayload;
                try {
                    const output = executeChatbotTool(call.name, call.arguments, { language: validated.language });
                    if (call.name === 'handoff_to_office' || output?.action?.type === 'inquiry') {
                        handoffRequested = true;
                    }
                    if (call.name === 'get_required_documents' && Array.isArray(output?.labels) && output.labels.length > 0) {
                        lastDocumentLabels = output.labels;
                    }
                    if (call.name === 'lookup_knowledge' && typeof output?.text === 'string' && output.text.trim()) {
                        lastKnowledgeText = output.text;
                    }
                    toolPayload = output;
                } catch {
                    toolPayload = { ok: false, error: 'INVALID_TOOL_CALL' };
                }

                toolResultMessages.push({
                    role: 'tool',
                    name: safeToolName,
                    tool_call_id: callId,
                    content: JSON.stringify(toolPayload)
                });
            }

            // Belge ve bilgi tabanı yanıtları model metni olmadan deterministik döndürüldüğü için ek model çağrısı gerekmez.
            if (lastDocumentLabels || lastKnowledgeText) {
                break;
            }

            conversation.push({
                role: 'assistant',
                content: result.text || '',
                tool_calls: assistantToolCalls
            });
            conversation.push(...toolResultMessages);
        }

        if (exhaustedModelCalls) {
            outcome = 'fallback';
            return routeResult({
                reply: getChatbotFixedText('fallback', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        if (lastDocumentLabels) {
            outcome = 'ok';
            const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
            return routeResult({
                reply: buildDocumentReply(lastDocumentLabels, validated.language),
                actions
            });
        }

        if (lastKnowledgeText) {
            outcome = 'ok';
            const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
            return routeResult({
                reply: lastKnowledgeText,
                actions
            });
        }

        const trimmedText = typeof finalText === 'string' ? finalText.trim() : '';
        if (!trimmedText || [...trimmedText].length > CHATBOT_MAX_REPLY_CHARS) {
            outcome = 'fallback';
            return routeResult({
                reply: getChatbotFixedText('fallback', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        if (trimmedText === CHATBOT_REFUSAL_MARKER || trimmedText.includes(CHATBOT_REFUSAL_MARKER)) {
            outcome = 'refusal';
            return routeResult({
                reply: getChatbotFixedText('refusal', validated.language),
                actions: [{ type: 'inquiry' }]
            });
        }

        outcome = 'ok';
        const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
        return routeResult({ reply: trimmedText, actions });
    } catch (error) {
        outcome = outcomeForError(error);
        throw error;
    } finally {
        console.info('Public chat request completed.', {
            requestId,
            outcome,
            tools: executedToolNames,
            latencyMs: Date.now() - startedAt
        });
    }
}
