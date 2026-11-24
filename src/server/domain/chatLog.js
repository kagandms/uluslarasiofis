/**
 * Ana sayfa sohbet günlüğü ve Evet/Hayır oylama doğrulama/kırpma kuralları.
 * Mesajlar maskelenmeden yazıldığı gibi saklanır; yalnızca karakter sınırları uygulanır.
 */
import { CHATBOT_LANGUAGES } from './chatbotKnowledge.js';
import { ApiError } from './errors.js';

export const CHAT_LOG_USER_TEXT_MAX_LENGTH = 500;
export const CHAT_LOG_ASSISTANT_TEXT_MAX_LENGTH = 4000;
export const CHAT_LOG_OUTCOME_MAX_LENGTH = 64;
export const CHAT_LOG_MAX_ID_LENGTH = 64;
export const CHAT_FEEDBACK_BODY_MAX_BYTES = 2048;
export const CHAT_LOG_FEEDBACK_VALUES = Object.freeze(['up', 'down']);

const CHAT_FEEDBACK_ALLOWED_KEYS = Object.freeze(['turn_id', 'value']);
const CHAT_LOG_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_DISALLOWED_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F\s]/u;

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Tahmin edilemez oturum veya tur kimliği üretir.
 * @returns {string} Rastgele UUID v4.
 */
export function generateChatLogId() {
    return crypto.randomUUID();
}

/**
 * İsteğe bağlı `session_id` alanının biçimini doğrular; geçersizse sessizce `null` döner.
 * @param {unknown} value İstek gövdesinden gelen ham oturum kimliği.
 * @returns {string|null} Geçerli UUID ise temizlenmiş kimlik, aksi halde null.
 */
export function normalizeOptionalSessionId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!CHAT_LOG_UUID_PATTERN.test(trimmed)) return null;
    return trimmed;
}

/**
 * Metni Unicode kod noktası sayısına göre üst sınıra kırpar; maskeleme yapmaz.
 * @param {unknown} text Kaydedilecek ham metin.
 * @param {number} maxLength İzin verilen en fazla kod noktası sayısı.
 * @returns {string} Sınır içinde kalmış metin.
 */
export function truncateChatLogText(text, maxLength) {
    if (typeof text !== 'string') return '';
    const chars = [...text];
    if (chars.length <= maxLength) return text;
    return chars.slice(0, maxLength).join('');
}

/**
 * Veritabanına yazılacak sohbet turu kaydını sınırlar ve normalleştirir.
 * @param {{sessionId?: string|null, turnId?: string|null, language?: string, userText: string, assistantText: string, outcome?: string, tools?: string[], latencyMs?: number, nowIso?: string}} input Tur alanları.
 * @returns {{sessionId: string, turnId: string, language: string, userText: string, assistantText: string, outcome: string, tools: string, latencyMs: number, nowIso: string}} Depoya hazır tur kaydı.
 */
export function prepareChatTurnRecord({
    sessionId = null,
    turnId = null,
    language = 'tr',
    userText,
    assistantText,
    outcome = 'ok',
    tools = [],
    latencyMs = 0,
    nowIso = new Date().toISOString()
}) {
    const safeLanguage = typeof language === 'string' && CHATBOT_LANGUAGES.includes(language) ? language : 'tr';
    const rawOutcome = typeof outcome === 'string' && outcome.trim() ? outcome.trim() : 'ok';
    const safeTools = Array.isArray(tools) ? tools.filter((name) => typeof name === 'string') : [];
    const safeLatencyMs = Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0;

    return {
        sessionId: normalizeOptionalSessionId(sessionId) || generateChatLogId(),
        turnId: normalizeOptionalSessionId(turnId) || generateChatLogId(),
        language: safeLanguage,
        userText: truncateChatLogText(userText, CHAT_LOG_USER_TEXT_MAX_LENGTH),
        assistantText: truncateChatLogText(assistantText, CHAT_LOG_ASSISTANT_TEXT_MAX_LENGTH),
        outcome: truncateChatLogText(rawOutcome, CHAT_LOG_OUTCOME_MAX_LENGTH),
        tools: JSON.stringify(safeTools),
        latencyMs: safeLatencyMs,
        nowIso: typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString()
    };
}

/**
 * `POST /api/public/chat/feedback` istek gövdesini doğrular.
 * Bilinmeyen alanları, geçersiz oy değerlerini ve hatalı kimlikleri reddeder; kullanıcı girdisini hata iletisinde yinelemez.
 * @param {unknown} body Ayrıştırılmış JSON istek gövdesi.
 * @returns {{turn_id: string, value: 'up'|'down'}} Doğrulanmış geri bildirim girdisi.
 * @throws {ApiError} Alanlar geçersizse 400 VALIDATION_ERROR fırlatır.
 */
export function validateChatFeedbackInput(body) {
    if (!isPlainObject(body) || Object.keys(body).some((key) => !CHAT_FEEDBACK_ALLOWED_KEYS.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geri bildirim isteğini kontrol edip tekrar deneyin.');
    }
    if (typeof body.turn_id !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sohbet kaydı kimliği geçersiz.');
    }
    const turnId = body.turn_id.trim();
    if (!turnId || [...turnId].length > CHAT_LOG_MAX_ID_LENGTH || ID_DISALLOWED_CHAR_PATTERN.test(body.turn_id)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sohbet kaydı kimliği geçersiz.');
    }
    if (typeof body.value !== 'string' || !CHAT_LOG_FEEDBACK_VALUES.includes(body.value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geri bildirim değeri geçersiz.');
    }
    return {
        turn_id: turnId,
        value: body.value
    };
}
