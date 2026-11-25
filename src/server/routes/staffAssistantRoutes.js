/**
 * HTTP route handler for `POST /api/staff/assistant`.
 * Enforces staff auth, same-origin, bounded input, per-staff rate limits, deterministic intent parsing,
 * at most one tool-selection model call (never receiving DB results), and strict contract validation.
 */

import {
    validateStaffAssistantRequest,
    validateStaffAssistantResponse
} from '../../shared/staff-assistant-contract.js';
import { requireStaff } from '../auth/staffAuth.js';
import { ApiError } from '../domain/errors.js';
import { isRedLineStaffMessage, parseStaffIntent } from '../domain/staffAssistantIntent.js';
import {
    STAFF_ASSISTANT_TOOLS,
    runStaffAssistantTool,
    validateStaffToolArgs
} from '../domain/staffAssistantTools.js';
import { readJsonBody } from '../http/requestBody.js';
import {
    STAFF_ASSISTANT_DAILY_LIMIT,
    STAFF_ASSISTANT_RATE_LIMIT
} from '../security/application-rate-limits.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import { STAFF_ASSISTANT_MODEL_DEFAULT, createChatModel } from '../services/chatbotModel.js';
import { createRepositories, requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ASSISTANT_BODY_MAX_BYTES = 4096;
const STAFF_ASSISTANT_MODEL_TIMEOUT_MS = 8_000;
const STAFF_ASSISTANT_MODEL_MAX_OUTPUT_TOKENS = 256;
const STAFF_ASSISTANT_UNAVAILABLE_MESSAGE = 'Asistan şu anda kullanılamıyor.';

const FIXED_REFUSAL_REPLY = 'Ne yazık ki bu işlemi yapamam. Size şu konularda memnuniyetle yardımcı olabilirim: başvuru sorgulama, YÖKSİS eksik evrak kontrolü, YKN zincirini başlatma (YÖKSİS\'te Kaydet ve Apply\'a talep gönderme olmadan), tebligat arama, belge yazdırma önerisi, bugün için çalışma saati önerisi ve ekranlar arası geçiş.';

const STAFF_ASSISTANT_SYSTEM_PROMPT = [
    'Sen Uluslararası Öğrenci Ofisi yetkili panelindeki saygılı, yardımsever ve ekip arkadaşı odaklı Topi asistanısın.',
    'Yalnızca tanımlı araçlardan birini seçerek yanıt ver.',
    'Tanımlı araçların dışındaki hiçbir isteği yerine getirme, serbest sohbet üretme, yetkisiz kişilere veri paylaşma ve sahte kayıt uydurma.',
    'Onay olmadan hiçbir kayıt değişikliği yapma; silme, arşivleme, Apply\'a talep gönderme, başvuru durumu onaylama veya YÖKSİS\'te Kaydet tuşuna basma işlemleri kesinlikle yasaktır ve bu isteklerde hiçbir araç çağırma.',
    'Çalışma saati yalnızca bugün için ve 30 dakikalık adımlarla önerilir.'
].join(' ');

function buildAssistantJsonResponse(payload, requestId) {
    const validated = validateStaffAssistantResponse(payload);
    return new Response(JSON.stringify(validated), {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Request-Id': requestId
        }
    });
}

function buildRefusalResponse(requestId) {
    return buildAssistantJsonResponse({
        reply: FIXED_REFUSAL_REPLY,
        state: 'confused'
    }, requestId);
}

async function enforceStaffRateLimit(repositories, policy, staffId, nowSeconds) {
    let allowed;
    try {
        allowed = await consumePublicRateLimit(repositories.rateLimits, {
            endpoint: policy.endpoint,
            identity: staffId,
            nowSeconds,
            windowSeconds: policy.windowSeconds,
            maxRequests: policy.maxRequests
        });
    } catch {
        throw new ApiError(503, 'STAFF_ASSISTANT_UNAVAILABLE', STAFF_ASSISTANT_UNAVAILABLE_MESSAGE, true);
    }
    if (!allowed) {
        throw new ApiError(429, 'RATE_LIMITED', 'Çok fazla istek yapıldı. Bir süre sonra tekrar deneyin.', true);
    }
}

function outcomeForError(error) {
    if (error instanceof ApiError) {
        if (error.status === 401) return 'unauthorized';
        if (error.status === 403) return 'forbidden';
        if (error.status === 405) return 'method_not_allowed';
        if (error.status === 400 || error.status === 413) return 'invalid_request';
        if (error.status === 429) return 'rate_limited';
        if (error.status === 503) return 'unavailable';
    }
    return 'error';
}

/**
 * Handles `POST /api/staff/assistant` requests for authenticated staff members.
 * @param {Request} request Incoming HTTP request.
 * @param {object} environment Worker bindings containing D1 and AI.
 * @param {string} requestId Correlation ID from the Worker boundary.
 * @returns {Promise<Response>} Validated JSON response matching the staff assistant contract.
 */
export async function handleStaffAssistant(request, environment, requestId) {
    const startedAt = Date.now();
    let toolName = 'none';
    let outcome = 'error';
    let modelInputTokens = 0;
    let modelCachedInputTokens = 0;
    let modelOutputTokens = 0;

    try {
        requireMethod(request, 'POST');
        requireSameOrigin(request);
        const staff = await requireStaff(request, environment);

        const rawBody = await readJsonBody(request, STAFF_ASSISTANT_BODY_MAX_BYTES);
        let validatedRequest;
        try {
            validatedRequest = validateStaffAssistantRequest(rawBody);
        } catch {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Asistan isteğini kontrol edip tekrar deneyin.');
        }

        if (!environment?.AI || typeof environment.AI.run !== 'function') {
            throw new ApiError(503, 'STAFF_ASSISTANT_UNAVAILABLE', STAFF_ASSISTANT_UNAVAILABLE_MESSAGE, true);
        }

        const repositories = createRepositories(environment);
        const nowSeconds = Math.floor(Date.now() / 1000);
        await enforceStaffRateLimit(repositories, STAFF_ASSISTANT_RATE_LIMIT, staff.id, nowSeconds);
        await enforceStaffRateLimit(repositories, STAFF_ASSISTANT_DAILY_LIMIT, staff.id, nowSeconds);

        if (isRedLineStaffMessage(validatedRequest.message)) {
            outcome = 'refusal';
            return buildRefusalResponse(requestId);
        }

        let selected = parseStaffIntent(validatedRequest.message);

        if (!selected) {
            // Staff assistant stays on Llama until it has its own evaluation; also ignores CHATBOT_MODEL for now.
            const model = createChatModel(environment, {
                model: STAFF_ASSISTANT_MODEL_DEFAULT,
                timeoutMs: STAFF_ASSISTANT_MODEL_TIMEOUT_MS,
                maxOutputTokens: STAFF_ASSISTANT_MODEL_MAX_OUTPUT_TOKENS,
                sessionAffinity: 'topi-staff'
            });

            const messages = [
                { role: 'system', content: STAFF_ASSISTANT_SYSTEM_PROMPT },
                ...validatedRequest.history,
                { role: 'user', content: validatedRequest.message }
            ];

            let modelResult;
            try {
                modelResult = await model.complete({
                    messages,
                    tools: STAFF_ASSISTANT_TOOLS
                });
            } catch {
                throw new ApiError(503, 'STAFF_ASSISTANT_UNAVAILABLE', STAFF_ASSISTANT_UNAVAILABLE_MESSAGE, true);
            }
            if (modelResult?.usage) {
                modelInputTokens += modelResult.usage.inputTokens ?? 0;
                modelCachedInputTokens += modelResult.usage.cachedInputTokens ?? 0;
                modelOutputTokens += modelResult.usage.outputTokens ?? 0;
            }

            const firstCall = Array.isArray(modelResult?.toolCalls) ? modelResult.toolCalls[0] : null;
            if (!firstCall) {
                outcome = 'refusal';
                return buildRefusalResponse(requestId);
            }

            try {
                const validatedArgs = validateStaffToolArgs(firstCall.name, firstCall.arguments);
                selected = { tool: firstCall.name, args: validatedArgs };
            } catch {
                outcome = 'refusal';
                return buildRefusalResponse(requestId);
            }
        }

        toolName = selected.tool;
        const toolResult = await runStaffAssistantTool(selected.tool, selected.args, {
            environment,
            request,
            staff
        });

        const candidateResponse = {
            reply: toolResult.reply || toolResult.ask || FIXED_REFUSAL_REPLY,
            state: toolResult.state || (toolResult.action || toolResult.results ? 'understood' : 'confused'),
            ...(toolResult.action !== undefined ? { action: toolResult.action } : {}),
            ...(toolResult.results !== undefined ? { results: toolResult.results } : {})
        };

        outcome = 'ok';
        return buildAssistantJsonResponse(candidateResponse, requestId);
    } catch (error) {
        outcome = outcomeForError(error);
        throw error;
    } finally {
        console.info('Staff assistant request completed.', {
            requestId,
            tool: toolName,
            outcome,
            latencyMs: Date.now() - startedAt,
            modelInputTokens,
            modelCachedInputTokens,
            modelOutputTokens
        });
    }
}
