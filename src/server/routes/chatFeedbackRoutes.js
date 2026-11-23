/**
 * Halka açık sohbet yanıtı Evet/Hayır oylama uç noktası (`POST /api/public/chat/feedback`).
 */
import { CHAT_FEEDBACK_BODY_MAX_BYTES, validateChatFeedbackInput } from '../domain/chatLog.js';
import { ApiError } from '../domain/errors.js';
import { readJsonBody } from '../http/requestBody.js';
import { createChatLogRepository } from '../repositories/d1/chatLogRepository.js';
import { CHAT_FEEDBACK_RATE_LIMIT } from '../security/application-rate-limits.js';
import { createRepositories, enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';

async function runFailClosedRateLimit(action) {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.', true);
    }
}

/**
 * Halka açık sohbet yanıtı için Evet/Hayır (`up`/`down`) geri bildirimini doğrular ve kaydeder.
 * Kontrol sırası: yöntem -> aynı köken -> 2 KB gövde sınırı -> DB varlığı -> IP hız sınırı (hata verirse kapalı) -> doğrulama -> D1 güncellemesi.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} _requestId İstek izleme kimliği.
 * @returns {Promise<Response>} 204 boş yanıt.
 * @throws {ApiError} Yöntem, köken, boyut, hız sınırı, doğrulama, bulunamama veya DB hatasında uygun HTTP hatası fırlatır.
 */
export async function handlePublicChatFeedback(request, environment, _requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const body = await readJsonBody(request, CHAT_FEEDBACK_BODY_MAX_BYTES);
    const repositories = createRepositories(environment);

    await runFailClosedRateLimit(() => enforceRateLimit(repositories, request, CHAT_FEEDBACK_RATE_LIMIT));

    const validated = validateChatFeedbackInput(body);
    const chatLogs = createChatLogRepository(environment.DB);

    let updated;
    try {
        updated = await chatLogs.setFeedback({
            turnId: validated.turn_id,
            value: validated.value,
            nowIso: new Date().toISOString()
        });
    } catch {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.', true);
    }

    if (!updated) {
        throw new ApiError(404, 'NOT_FOUND', 'Sohbet kaydı bulunamadı.');
    }

    return new Response(null, { status: 204 });
}
