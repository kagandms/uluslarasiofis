import { isValidApplicationReference, normalizeApplicationReference } from '../auth/applicationAccessCode.js';
import {
    extractSupportedDocumentFacts,
    filterDocumentArgsByEvidence,
    normalizeForEvidence
} from '../domain/chatbotEvidence.js';
import { CHATBOT_LANGUAGES } from '../domain/chatbotKnowledge.js';
import {
    CHATBOT_REFUSAL_MARKER,
    buildChatbotSystemPrompt,
    buildMissingDocumentsQuestion,
    getChatbotFixedText
} from '../domain/chatbotPrompt.js';
import { getChatbotStatusFixedText, renderStatusSummary } from '../domain/chatbotStatusText.js';
import {
    CHATBOT_TOOL_DEFINITIONS,
    CHATBOT_TOOLS,
    executeChatbotTool,
    listCatalogDocumentTitles
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
const CHATBOT_MAX_TOOL_CALLS_PER_RESPONSE = 3;
const CHATBOT_MAX_FAILED_TOOL_ROUNDS = 2;
const CHATBOT_REQUEST_DEADLINE_MS = 10_000;
const CHATBOT_MAX_REPLY_CHARS = 1200;

const CHATBOT_ALLOWED_ROLES = Object.freeze(['user', 'assistant']);
const CHATBOT_ROOT_KEYS = Object.freeze(['messages', 'language']);
const CHATBOT_MESSAGE_KEYS = Object.freeze(['role', 'content']);

// Çok satırlı mesajlarda yalnızca \n satır sonuna izin verilir; diğer kontrol karakterleri reddedilir.
const MESSAGE_DISALLOWED_CONTROL_CHAR_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const FORGED_ASSISTANT_TOOL_JSON_PATTERN = /\{\s*"name"\s*:|"tool_calls"/u;
const REFERENCE_CANDIDATE_PATTERN = /[\p{L}\p{N}_-]+/gu;
const CHATBOT_UNAVAILABLE_MESSAGE = 'Asistan şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.';

const CHATBOT_HANDOFF_TEXT = Object.freeze({
    tr: 'Bu konuda size en iyi Uluslararası Öğrenci Ofisi yardımcı olabilir. Aşağıdaki soru formundan yazabilirsiniz; size telefon veya WhatsApp ile dönüş yapılır.',
    en: 'The International Student Office can best help you with this. You can write using the question form below; they will get back to you by phone or WhatsApp.',
    ru: 'В этом вопросе вам лучше всего поможет Международный студенческий офис. Вы можете написать через форму вопросов ниже; с вами свяжутся по телефону или через WhatsApp.',
    tk: 'Bu meselede size iň gowy Halkara talyplar ofisi kömek edip biler. Aşakdaky sorag formasy arkaly ýazyp bilersiňiz; size telefon ýa-da WhatsApp arkaly jogap berler.',
    ar: 'يمكن لمكتب الطلاب الدوليين مساعدتك بأفضل شكل في هذا الموضوع. يمكنك الكتابة عبر نموذج الأسئلة أدناه؛ وسيتم التواصل معك عبر الهاتف أو واتساب.'
});

const OPTIONAL_DOCUMENT_SUFFIX = Object.freeze({
    tr: ' (isteğe bağlı)',
    en: ' (optional)',
    ru: ' (необязательно)',
    tk: ' (hökmany däl)',
    ar: ' (اختياري)'
});

const STATUS_RULES_BY_LANGUAGE = Object.freeze({
    tr: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:durum[\p{L}\p{N}]*|sonuc[\p{L}\p{N}]*|onay[\p{L}\p{N}]*|gonderildi[\p{L}\p{N}]*|goc)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/basvuru[\p{L}\p{N}]*/u])
    }),
    en: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:status[\p{L}\p{N}]*|results?|approved|sent|migration)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])applications?(?:[^\p{L}]|$)/u])
    }),
    ru: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:статус[\p{L}\p{N}]*|результат[\p{L}\p{N}]*|одобр[\p{L}\p{N}]*|отправ[\p{L}\p{N}]*|миграц[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])(?:заявк[\p{L}\p{N}]*|заявлен[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u])
    }),
    tk: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:yagday[\p{L}\p{N}]*|netije[\p{L}\p{N}]*|tassyk[\p{L}\p{N}]*|iberildi[\p{L}\p{N}]*|migrasiya[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/(?:^|[^\p{L}])arza[\p{L}\p{N}]*(?:[^\p{L}]|$)/u])
    }),
    ar: Object.freeze({
        status: Object.freeze([/(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:حاله|نتيجه|موافقه|ارسل[\p{L}\p{N}]*|هجره|الهجره)(?:[^\p{L}]|$)/u]),
        application: Object.freeze([/طلب[\p{L}\p{N}]*/u])
    })
});

const STANDALONE_STATUS_PHRASES = Object.freeze([
    'basvurum ne durumda',
    'basvurum ne alemde',
    'what is my application status',
    'статус моеи заявки',
    'arzamyn yagdayy',
    'arzam name yagdayda',
    'ما حاله طلبي',
    'ما هي حاله طلبي'
]);

const DOCUMENT_KEYWORD_PATTERNS = Object.freeze([
    /belge[\p{L}\p{N}]*/u,
    /evrak[\p{L}\p{N}]*/u,
    /document[\p{L}\p{N}]*/u,
    /(?:^|[^\p{L}])docs?(?:[^\p{L}]|$)/u,
    /документ[\p{L}\p{N}]*/u,
    /resminama[\p{L}\p{N}]*/u,
    /مستند[\p{L}\p{N}]*/u,
    /وثايق[\p{L}\p{N}]*/u,
    /وثيقه/u
]);

const HANDOFF_PATTERNS = Object.freeze([
    // tr
    /(?:^|[^\p{L}])(?:insanla|yetkiliyle|personelle|biriyle|ofisle|calisanla[\p{L}\p{N}]*)\s*(?:gorus[\p{L}\p{N}]*|konus[\p{L}\p{N}]*|iletisim[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])gercek\s*(?:bir\s*)?(?:insan|kisi)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])ofise\s*(?:ulas[\p{L}\p{N}]*|yaz[\p{L}\p{N}]*)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])sikayet[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])acil(?:\s+durum[\p{L}\p{N}]*)?(?:[^\p{L}]|$)/u,
    // en
    /(?:^|[^\p{L}])(?:talk|speak|chat|connect[\p{L}\p{N}]*)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:person|human|staff|advisor|representative|agent|someone|office)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:need|want)\s+help\s+from\s+(?:the\s+)?(?:staff|office)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])real\s+person(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])complaint[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])urgent(?:ly)?(?:[^\p{L}]|$)/u,
    // ru
    /(?:^|[^\p{L}])(?:поговорить|связаться|пообщаться|соединить)\s+с\s+(?:живым\s+|реальным\s+)?(?:человеком|сотрудником|оператором|специалистом|представителем|офисом)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])помощь\s+сотрудник[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])жалоб[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])срочн[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    // tk
    /(?:^|[^\p{L}])adam\s+bilen\s+gurles[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:ofis\s+)?isgar[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])sikayat[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])gyssagly(?:[^\p{L}]|$)/u,
    // ar
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:تحدث|التحدث|اتحدث|تكلم|التكلم|اتكلم|تواصل|التواصل|اتواصل)\s+مع\s+(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:شخص|انسان|موظف|احد|مكتب|المكتب)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?شخص\s+حقيقي(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?مساعده\s+(?:من\s+)?(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?(?:موظف|مكتب)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?شكو[\p{L}\p{N}]*(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?عاجل[\p{L}\p{N}]*(?:[^\p{L}]|$)/u
]);

export const CHATBOT_ROUTE_NORMALIZED_PATTERNS = Object.freeze({
    STATUS_RULES_BY_LANGUAGE,
    STANDALONE_STATUS_PHRASES,
    DOCUMENT_KEYWORD_PATTERNS,
    HANDOFF_PATTERNS
});

const PROSE_LIST_LINE_PATTERN = /^\s*(?:[-*•◦▪‣]|\d+[.)])\s+\S/u;
const ANY_LETTER_PATTERN = /\p{L}/gu;
const ARABIC_LETTER_PATTERN = /\p{Script=Arabic}/gu;
const CYRILLIC_LETTER_PATTERN = /\p{Script=Cyrillic}/gu;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;

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
    if (rawMessage.role === 'assistant' && (
        trimmed.includes(CHATBOT_REFUSAL_MARKER) || FORGED_ASSISTANT_TOOL_JSON_PATTERN.test(trimmed)
    )) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj geçmişi geçersiz.');
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
    let firstUserIndex = 0;
    while (firstUserIndex < validatedMessages.length && validatedMessages[firstUserIndex].role === 'assistant') {
        firstUserIndex += 1;
    }
    const normalizedMessages = validatedMessages.slice(firstUserIndex);
    if (normalizedMessages.length < 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj sırası geçersiz.');
    }
    for (let index = 0; index < normalizedMessages.length; index += 1) {
        const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
        if (normalizedMessages[index].role !== expectedRole) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Mesaj sırası geçersiz.');
        }
    }
    if (normalizedMessages[normalizedMessages.length - 1].role !== 'user') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Son mesaj kullanıcıya ait olmalıdır.');
    }
    return {
        messages: normalizedMessages,
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

function extractLatestUserReferences(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'user') continue;
        const references = extractApplicationReferences(message.content);
        if (references.length > 0) {
            return references;
        }
    }
    return [];
}

function hasDocumentKeyword(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = normalizeForEvidence(messageContent);
    return DOCUMENT_KEYWORD_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true when the user message explicitly asks for a human/office handoff or reports an urgent/complaint case.
 * @param {string} messageContent Raw user message text.
 * @returns {boolean} True if deterministic handoff applies.
 */
export function isDeterministicHandoffRequest(messageContent) {
    if (typeof messageContent !== 'string') return false;
    const normalized = normalizeForEvidence(messageContent);
    return HANDOFF_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isStatusQuestionWithoutReference(messageContent) {
    if (typeof messageContent !== 'string') return false;
    if (isDeterministicHandoffRequest(messageContent)) {
        return false;
    }
    if (hasDocumentKeyword(messageContent)) {
        return false;
    }
    const normalized = normalizeForEvidence(messageContent);
    if (STANDALONE_STATUS_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return true;
    }
    return Object.values(STATUS_RULES_BY_LANGUAGE).some(({ status, application }) =>
        status.some((pattern) => pattern.test(normalized))
        && application.some((pattern) => pattern.test(normalized))
    );
}

function looksLikeProseDocumentReply(replyText, lastUserMessage, language) {
    const bulletLineCount = replyText
        .split('\n')
        .filter((line) => PROSE_LIST_LINE_PATTERN.test(line))
        .length;
    if (bulletLineCount >= 2) {
        return true;
    }
    if (hasDocumentKeyword(lastUserMessage)) {
        return true;
    }
    const normalizedReply = normalizeForEvidence(replyText);
    const catalogTitles = listCatalogDocumentTitles(language);
    return catalogTitles.some((title) => {
        const normalizedTitle = normalizeForEvidence(title);
        return normalizedTitle && normalizedReply.includes(normalizedTitle);
    });
}

function isReplyInExpectedScript(replyText, language) {
    if (language === 'ar') {
        const allLetters = replyText.match(ANY_LETTER_PATTERN) || [];
        if (allLetters.length === 0) return false;
        const arabicLetters = replyText.match(ARABIC_LETTER_PATTERN) || [];
        return arabicLetters.length / allLetters.length >= 0.3;
    }
    if (language === 'ru') {
        const allLetters = replyText.match(ANY_LETTER_PATTERN) || [];
        if (allLetters.length === 0) return false;
        const cyrillicLetters = replyText.match(CYRILLIC_LETTER_PATTERN) || [];
        return cyrillicLetters.length / allLetters.length >= 0.3;
    }
    return LATIN_LETTER_PATTERN.test(replyText);
}

function isInsufficientOrWrongScriptReply(replyText, language) {
    if (replyText.toLowerCase().includes('input is not sufficient')) {
        return true;
    }
    return !isReplyInExpectedScript(replyText, language);
}

function renderDocumentToolReply(toolOutput, language, handoffRequested = false) {
    const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
    if (Array.isArray(toolOutput?.labels) && toolOutput.labels.length > 0) {
        return routeResult({
            reply: buildDocumentReply(toolOutput.labels, language),
            actions
        });
    }
    return routeResult({
        reply: buildMissingDocumentsQuestion(toolOutput?.missing || [], language),
        actions
    });
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
        const referencedApplications = extractLatestUserReferences(validated.messages);
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
        if (isDeterministicHandoffRequest(lastUserMessage)) {
            outcome = 'handoff';
            return routeResult({
                reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                actions: [{ type: 'inquiry' }]
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
        const requestSignal = AbortSignal.timeout(CHATBOT_REQUEST_DEADLINE_MS);
        const conversation = [
            { role: 'system', content: buildChatbotSystemPrompt(validated.language) },
            ...validated.messages
        ];

        const userTurns = validated.messages
            .filter((message) => message.role === 'user')
            .map((message) => message.content);

        let finalText = null;
        let exhaustedModelCalls = false;
        let handoffRequested = false;
        let lastDocumentLabels = null;
        let lastMissingDocumentFields = null;
        let lastKnowledgeText = null;
        let failedToolRounds = 0;

        for (let modelCall = 1; modelCall <= CHATBOT_MAX_MODEL_CALLS; modelCall += 1) {
            // 3. çağrı son izin verilen çağrıdır; aracısız gönderilir ki model metin yanıtı üretmeye zorlansın.
            const allowTools = modelCall < CHATBOT_MAX_MODEL_CALLS;
            const result = await model.complete({
                messages: conversation,
                signal: requestSignal,
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
            const toolCallCount = Math.min(result.toolCalls.length, CHATBOT_MAX_TOOL_CALLS_PER_RESPONSE);
            let roundHadInvalidTool = false;

            for (let index = 0; index < toolCallCount; index += 1) {
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
                    const effectiveArgs = call.name === 'get_required_documents'
                        ? filterDocumentArgsByEvidence(call.arguments, userTurns, validated.language)
                        : call.arguments;
                    const output = executeChatbotTool(call.name, effectiveArgs, { language: validated.language });
                    if (call.name === 'handoff_to_office' || output?.action?.type === 'inquiry') {
                        handoffRequested = true;
                    }
                    if (call.name === 'get_required_documents') {
                        if (Array.isArray(output?.labels) && output.labels.length > 0) {
                            lastDocumentLabels = output.labels;
                            lastMissingDocumentFields = null;
                        } else if (Array.isArray(output?.missing) && output.missing.length > 0) {
                            lastMissingDocumentFields = output.missing;
                            lastDocumentLabels = null;
                        }
                    }
                    if (call.name === 'lookup_knowledge' && typeof output?.text === 'string' && output.text.trim()) {
                        lastKnowledgeText = output.text;
                    }
                    toolPayload = output;
                } catch {
                    roundHadInvalidTool = true;
                    toolPayload = { ok: false, error: 'INVALID_TOOL_CALL' };
                }

                toolResultMessages.push({
                    role: 'tool',
                    name: safeToolName,
                    tool_call_id: callId,
                    content: JSON.stringify(toolPayload)
                });
            }

            // Belge, eksik bilgi, bilgi tabanı ve yönlendirme sonuçları model metni olmadan deterministik döndürüldüğü için ek model çağrısı gerekmez.
            if (lastDocumentLabels || lastMissingDocumentFields || lastKnowledgeText || handoffRequested) {
                break;
            }

            if (roundHadInvalidTool) {
                failedToolRounds += 1;
                if (failedToolRounds >= CHATBOT_MAX_FAILED_TOOL_ROUNDS) {
                    exhaustedModelCalls = true;
                    break;
                }
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

        if (lastMissingDocumentFields) {
            outcome = 'ok';
            const actions = handoffRequested ? [{ type: 'inquiry' }] : [];
            return routeResult({
                reply: buildMissingDocumentsQuestion(lastMissingDocumentFields, validated.language),
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

        if (handoffRequested) {
            outcome = 'ok';
            return routeResult({
                reply: CHATBOT_HANDOFF_TEXT[validated.language] || CHATBOT_HANDOFF_TEXT.tr,
                actions: [{ type: 'inquiry' }]
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

        if (looksLikeProseDocumentReply(trimmedText, lastUserMessage, validated.language)) {
            const supportedFacts = extractSupportedDocumentFacts(userTurns, validated.language);
            const docOutput = executeChatbotTool('get_required_documents', supportedFacts, {
                language: validated.language
            });
            outcome = 'ok';
            return renderDocumentToolReply(docOutput, validated.language, handoffRequested);
        }

        if (isInsufficientOrWrongScriptReply(trimmedText, validated.language)) {
            outcome = 'fallback';
            return routeResult({
                reply: getChatbotFixedText('fallback', validated.language),
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
